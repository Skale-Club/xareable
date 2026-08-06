/**
 * Browser uploads (R2 migration).
 *
 * Supabase Storage let the browser upload straight to the bucket because RLS
 * scoped writes to `{userId}/…` using the caller's JWT. R2 has no equivalent,
 * so the server becomes the policy layer: the client asks for an upload of a
 * declared *kind*, and the server decides the object key.
 *
 * The client never supplies a path. That is the whole security boundary here —
 * it removes path traversal and cross-tenant writes by construction.
 *
 * Two transports, chosen by the server:
 *
 *   presign — R2 configured. Size AND content-type are signed into the URL, so
 *             the PUT must match the server's decision exactly or R2 rejects
 *             it. Bytes go straight to Cloudflare, never through this process.
 *
 *   proxy   — R2 not configured. The browser posts base64 to `/direct` and the
 *             server writes through the storage layer, which falls back to the
 *             Supabase bucket. Slower and it costs container memory, but it
 *             keeps logo/reference/scenery uploads working on a dev box with no
 *             R2 credentials AND on the rollback path. Without this, unsetting
 *             the R2_* block to roll back would break browser uploads entirely.
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { validateBase64Upload } from "../lib/upload-validation.js";
import {
    presignPut,
    putObject,
    isR2Enabled,
    IMMUTABLE_CACHE_CONTROL,
    MUTABLE_CACHE_CONTROL,
} from "../lib/r2.js";

const router = Router();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB — matches the existing client-side caps

/**
 * Raster only. SVG is deliberately excluded: on the presign path those bytes
 * are never inspected server-side, and an SVG served from our own CDN origin is
 * a stored-XSS / phishing vector. Admin SVG uploads still go through the
 * landing endpoints, which run the sanitiser in lib/upload-validation.ts.
 */
const ALLOWED_IMAGE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
] as const;

const EXT_BY_MIME: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

const uploadKindSchema = z.enum([
    "brand-logo",
    "brand-reference",
    "scenery-preview",
    "style-board",
]);
type UploadKind = z.infer<typeof uploadKindSchema>;

/**
 * Slug guard for the two free-form values that reach an object key
 * (`scope` and `styleId` on style-board uploads). Anything outside this class
 * — dots, slashes, encoded separators — is rejected before it can shape a path.
 */
const slugSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, "must be alphanumeric with - or _");

const signRequestSchema = z.object({
    kind: uploadKindSchema,
    contentType: z.enum(ALLOWED_IMAGE_TYPES),
    contentLength: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    /** Required for `scenery-preview` — the scenery the image belongs to. */
    sceneryId: z.string().uuid().optional(),
    /** Required for `style-board` — which catalog the board hangs off. */
    scope: slugSchema.optional(),
    /** Required for `style-board` — the style/mood the board belongs to. */
    styleId: slugSchema.optional(),
});

const directRequestSchema = z.object({
    kind: uploadKindSchema,
    contentType: z.enum(ALLOWED_IMAGE_TYPES),
    /** Base64-encoded file bytes (no data: prefix). */
    data: z.string().min(1),
    sceneryId: z.string().uuid().optional(),
    scope: slugSchema.optional(),
    styleId: slugSchema.optional(),
});

/** The per-kind extras that shape an object key. */
interface KeyExtras {
    sceneryId?: string;
    scope?: string;
    styleId?: string;
}

interface KeyPolicy {
    key: string;
    cacheControl: string;
}

/**
 * Map an upload kind to its object key + cache policy.
 * Returns a string when the request is invalid for that kind.
 */
function resolveKey(
    kind: UploadKind,
    userId: string,
    ext: string,
    { sceneryId, scope, styleId }: KeyExtras,
): KeyPolicy | string {
    switch (kind) {
        case "brand-logo":
            // Stable key, overwritten in place on every logo change — same as
            // the pre-migration Supabase behaviour, so no orphans accumulate.
            // Cache must therefore be short, or a new logo stays invisible
            // behind the CDN for a year.
            return {
                key: `${userId}/logo.${ext}`,
                cacheControl: MUTABLE_CACHE_CONTROL,
            };

        case "brand-reference":
            return {
                key: `${userId}/references/${randomUUID()}.${ext}`,
                cacheControl: IMMUTABLE_CACHE_CONTROL,
            };

        case "scenery-preview":
            if (!sceneryId) return "sceneryId is required for scenery-preview uploads";
            // sceneryId is UUID-validated by the schema, so it cannot escape the prefix.
            return {
                key: `${userId}/sceneries/${sceneryId}-${Date.now()}.${ext}`,
                cacheControl: IMMUTABLE_CACHE_CONTROL,
            };

        case "style-board":
            if (!scope || !styleId) {
                return "scope and styleId are required for style-board uploads";
            }
            // Both are slug-validated by the schema, so neither can escape the prefix.
            return {
                key: `${userId}/style-boards/${scope}-${styleId}-${Date.now()}.${ext}`,
                cacheControl: IMMUTABLE_CACHE_CONTROL,
            };
    }
}

/**
 * Scenery previews and style boards populate the shared admin catalogs, so
 * they are admin-only. Brand assets belong to the caller and are not.
 */
function kindAllowedFor(kind: UploadKind, isAdmin: boolean): boolean {
    return (kind !== "scenery-preview" && kind !== "style-board") || isAdmin;
}

/**
 * POST /api/uploads/sign
 *
 * Body: { kind, contentType, contentLength, sceneryId? }
 *
 * Returns either
 *   { mode: "presign", uploadUrl, headers, key, publicUrl, expiresIn }
 * or, when R2 is not configured,
 *   { mode: "proxy", uploadPath: "/api/uploads/direct" }
 *
 * The client persists the returned `publicUrl` through the normal API (brand
 * update, reference-photo insert, scenery save). There is no confirm step: a
 * stored object that never gets referenced is just an orphan.
 */
router.post("/api/uploads/sign", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const parsed = signRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            message: "Invalid upload request",
            errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
        return;
    }

    const { kind, contentType, contentLength, ...extras } = parsed.data;

    if (!kindAllowedFor(kind, Boolean(authResult.profile.is_admin))) {
        res.status(403).json({ message: "Admin access required" });
        return;
    }

    // No R2 → tell the client to come back through the proxy transport.
    if (!(await isR2Enabled())) {
        res.json({ mode: "proxy", uploadPath: "/api/uploads/direct" });
        return;
    }

    const ext = EXT_BY_MIME[contentType];
    const policy = resolveKey(kind, authResult.user.id, ext, extras);
    if (typeof policy === "string") {
        res.status(400).json({ message: policy });
        return;
    }

    try {
        const signed = await presignPut({
            key: policy.key,
            contentType,
            contentLength,
            cacheControl: policy.cacheControl,
        });
        res.json({ mode: "presign", ...signed });
    } catch (error) {
        console.error("[Uploads] Failed to presign upload:", error);
        res.status(500).json({ message: "Failed to prepare upload" });
    }
});

/**
 * POST /api/uploads/direct
 *
 * Fallback transport for when R2 is not configured. Body carries the file as
 * base64; the server validates and writes it through the storage layer.
 *
 * Deliberately accepts requests even when R2 *is* configured — a client that
 * cached an older `mode: "proxy"` answer, or one behind a proxy that mangles
 * presigned PUTs, still succeeds. `putObject` routes to whichever backend is
 * live, so the object lands in the right place either way.
 */
router.post("/api/uploads/direct", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const parsed = directRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            message: "Invalid upload request",
            errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
        return;
    }

    const { kind, contentType, data, ...extras } = parsed.data;

    if (!kindAllowedFor(kind, Boolean(authResult.profile.is_admin))) {
        res.status(403).json({ message: "Admin access required" });
        return;
    }

    // Same allow-list and byte cap as the signed path; here we can additionally
    // see the bytes, so the shared validator does the decoding and size check.
    const validated = validateBase64Upload(
        data,
        contentType,
        [...ALLOWED_IMAGE_TYPES],
        MAX_UPLOAD_BYTES,
    );
    if (!validated.ok) {
        res.status(validated.status).json({ message: validated.message });
        return;
    }

    const ext = EXT_BY_MIME[contentType];
    const policy = resolveKey(kind, authResult.user.id, ext, extras);
    if (typeof policy === "string") {
        res.status(400).json({ message: policy });
        return;
    }

    try {
        const publicUrl = await putObject({
            key: policy.key,
            body: validated.buffer,
            contentType: validated.contentType,
            cacheControl: policy.cacheControl,
        });
        res.json({ key: policy.key, publicUrl });
    } catch (error) {
        console.error("[Uploads] Direct upload failed:", error);
        res.status(500).json({ message: "Upload failed" });
    }
});

export default router;
