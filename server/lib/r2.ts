/**
 * Cloudflare R2 object storage.
 *
 * Replaces the Supabase Storage `user_assets` bucket as the destination for
 * every generated image, carousel slide, thumbnail, enhancement, brand logo and
 * landing asset. Motivation is cost at scale: Supabase bills egress at
 * $0.09/GB, R2 bills none.
 *
 * Two invariants make the migration cheap and reversible:
 *
 *   1. **Object keys are unchanged.** A post that lived at
 *      `user_assets/{userId}/generated/{uuid}.png` becomes R2 key
 *      `{userId}/generated/{uuid}.png`. The bucket name was never part of the
 *      key, so the backfill is a straight copy and the DB rewrite is a pure
 *      origin swap.
 *
 *   2. **Reads are dual-mode.** `parseAssetUrl()` recognises both the legacy
 *      Supabase public URL and the new R2 origin, so rows that still carry an
 *      old URL keep resolving (and keep being deletable) while the backfill
 *      runs and after a partial rollback.
 *
 * When the `R2_*` env block is not fully set the module degrades to Supabase
 * Storage, so dev boxes without R2 credentials and the rollback path both work
 * without code changes.
 */

import { randomUUID } from "crypto";
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectsCommand,
    HeadObjectCommand,
    type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config, hasR2Config } from "../config/index.js";

/** The Supabase bucket we are migrating away from. */
export const LEGACY_BUCKET = "user_assets";

/** Long cache for content-addressed keys (UUID filenames are never rewritten). */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Cache for keys that CAN be overwritten in place (deterministic paths such as
 * `{userId}/carousel/{postId}/slide-1.webp`). Short enough that a regenerate is
 * visible quickly, long enough to still absorb the gallery read burst.
 */
export const MUTABLE_CACHE_CONTROL = "public, max-age=300, must-revalidate";

/** True when uploads are going to R2 rather than the Supabase fallback. */
export const usingR2 = hasR2Config;

let client: S3Client | null = null;

/** Lazy S3 client — built once, only when R2 is actually configured. */
export function r2Client(): S3Client {
    if (!hasR2Config) {
        throw new Error(
            "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
            "R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL.",
        );
    }
    if (!client) {
        client = new S3Client({
            // R2 ignores the region but the SDK requires one.
            region: "auto",
            endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: config.R2_ACCESS_KEY_ID!,
                secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
            },
        });
    }
    return client;
}

/** Build the public CDN URL for an object key. */
export function publicUrlForKey(key: string): string {
    const encoded = key
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    return `${config.R2_PUBLIC_BASE_URL}/${encoded}`;
}

export type AssetBackend = "r2" | "supabase";

export interface ParsedAssetUrl {
    backend: AssetBackend;
    key: string;
}

/**
 * Resolve a stored asset URL back to its backend + object key.
 *
 * Handles both shapes so callers never have to care which era a row is from:
 *   - R2:      https://cdn.xareable.com/{key}
 *   - Legacy:  https://{ref}.supabase.co/storage/v1/object/public/user_assets/{key}
 *
 * Returns null for anything unrecognised (external URLs, malformed values) so
 * callers can skip rather than throw — a bad URL must never break a sweep.
 */
export function parseAssetUrl(url: string | null | undefined): ParsedAssetUrl | null {
    if (!url) return null;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    // New-world R2 URL, matched on the configured public origin.
    if (config.R2_PUBLIC_BASE_URL) {
        let base: URL | null = null;
        try {
            base = new URL(config.R2_PUBLIC_BASE_URL);
        } catch {
            base = null;
        }
        if (base && parsed.origin === base.origin) {
            const basePath = base.pathname.replace(/\/$/, "");
            const raw = parsed.pathname.startsWith(basePath)
                ? parsed.pathname.slice(basePath.length)
                : parsed.pathname;
            const key = decodeURIComponent(raw.replace(/^\//, ""));
            return key ? { backend: "r2", key } : null;
        }
    }

    // Legacy Supabase public-object URL.
    const legacy = parsed.pathname.match(
        new RegExp(`/${LEGACY_BUCKET}/(.+)$`),
    );
    if (legacy) {
        return { backend: "supabase", key: decodeURIComponent(legacy[1]) };
    }

    return null;
}

/**
 * Extract just the object key, whichever backend the URL points at.
 * Drop-in replacement for the `extractPathFromUrl` helpers that were duplicated
 * across the cleanup services and post routes.
 */
export function objectKeyFromUrl(url: string | null | undefined): string | null {
    return parseAssetUrl(url)?.key ?? null;
}

/** Build a key with a random filename under `folder`, preserving the extension. */
export function buildKey(folder: string, contentType: string): string {
    const ext = contentType.includes("svg")
        ? "svg"
        : contentType.split("/")[1]?.split(";")[0] || "png";
    const prefix = folder.replace(/^\/+|\/+$/g, "");
    return prefix ? `${prefix}/${randomUUID()}.${ext}` : `${randomUUID()}.${ext}`;
}

export interface PutObjectOptions {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
    /** Defaults to the immutable long cache; pass MUTABLE_CACHE_CONTROL for overwritable keys. */
    cacheControl?: string;
}

/**
 * Upload one object and return its public URL.
 * Falls back to Supabase Storage when R2 is not configured.
 */
export async function putObject({
    key,
    body,
    contentType,
    cacheControl = IMMUTABLE_CACHE_CONTROL,
}: PutObjectOptions): Promise<string> {
    if (!usingR2) {
        return putObjectViaSupabase({ key, body, contentType, cacheControl });
    }

    await r2Client().send(
        new PutObjectCommand({
            Bucket: config.R2_BUCKET!,
            Key: key,
            Body: Buffer.isBuffer(body) ? body : Buffer.from(body),
            ContentType: contentType,
            CacheControl: cacheControl,
        }),
    );

    return publicUrlForKey(key);
}

/** Supabase Storage fallback, kept so unconfigured envs and rollback still work. */
async function putObjectViaSupabase({
    key,
    body,
    contentType,
    cacheControl,
}: Required<Omit<PutObjectOptions, "cacheControl">> & { cacheControl: string }): Promise<string> {
    const { createAdminSupabase } = await import("../supabase.js");
    const admin = createAdminSupabase();

    const { error } = await admin.storage.from(LEGACY_BUCKET).upload(key, body as Buffer, {
        contentType,
        cacheControl: String(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3600),
        upsert: true,
    });
    if (error) {
        throw new Error(`Upload failed: ${error.message}`);
    }

    return admin.storage.from(LEGACY_BUCKET).getPublicUrl(key).data.publicUrl;
}

/** Delete objects by key from R2 (or the Supabase bucket when R2 is off). */
export async function deleteObjects(keys: string[]): Promise<void> {
    const unique = Array.from(new Set(keys.filter(Boolean)));
    if (unique.length === 0) return;

    if (!usingR2) {
        const { createAdminSupabase } = await import("../supabase.js");
        const { error } = await createAdminSupabase()
            .storage.from(LEGACY_BUCKET)
            .remove(unique);
        if (error) throw new Error(error.message);
        return;
    }

    // DeleteObjects caps at 1000 keys per call.
    for (let i = 0; i < unique.length; i += 1000) {
        const chunk = unique.slice(i, i + 1000);
        await r2Client().send(
            new DeleteObjectsCommand({
                Bucket: config.R2_BUCKET!,
                Delete: {
                    Objects: chunk.map((Key): ObjectIdentifier => ({ Key })),
                    Quiet: true,
                },
            }),
        );
    }
}

/**
 * Delete assets given their public URLs, routing each to whichever backend
 * actually holds it. This is what every cleanup path should call: during and
 * after the backfill a single batch can legitimately mix R2 and Supabase URLs.
 *
 * Never throws — cleanup runs on a cron and one bad URL must not abort the
 * sweep. Returns per-backend counts plus `failed`, so callers that retry (the
 * version_cleanup_log worker) can avoid marking a row clean after a failure.
 */
export async function deleteAssetsByUrl(
    urls: (string | null | undefined)[],
): Promise<{ r2: number; supabase: number; skipped: number; failed: boolean }> {
    const r2Keys: string[] = [];
    const supabaseKeys: string[] = [];
    let skipped = 0;
    let failed = false;

    for (const url of urls) {
        const parsed = parseAssetUrl(url);
        if (!parsed) {
            if (url) skipped++;
            continue;
        }
        (parsed.backend === "r2" ? r2Keys : supabaseKeys).push(parsed.key);
    }

    if (r2Keys.length > 0) {
        try {
            // deleteObjects() targets R2 only when it is configured; if a row
            // carries an R2 URL while R2 is switched off we cannot delete it.
            if (usingR2) {
                await deleteObjects(r2Keys);
            } else {
                failed = true;
                console.warn(
                    `[r2] ${r2Keys.length} R2-hosted objects skipped — R2 not configured`,
                );
            }
        } catch (err) {
            failed = true;
            console.warn(
                "[r2] Failed to delete R2 objects:",
                err instanceof Error ? err.message : err,
            );
        }
    }

    if (supabaseKeys.length > 0) {
        try {
            const { createAdminSupabase } = await import("../supabase.js");
            const { error } = await createAdminSupabase()
                .storage.from(LEGACY_BUCKET)
                .remove(supabaseKeys);
            if (error) {
                failed = true;
                console.warn("[r2] Failed to delete legacy Supabase objects:", error.message);
            }
        } catch (err) {
            failed = true;
            console.warn(
                "[r2] Failed to delete legacy Supabase objects:",
                err instanceof Error ? err.message : err,
            );
        }
    }

    return { r2: r2Keys.length, supabase: supabaseKeys.length, skipped, failed };
}

/** HEAD an object; returns its size in bytes, or null when it does not exist. */
export async function objectSize(key: string): Promise<number | null> {
    try {
        const head = await r2Client().send(
            new HeadObjectCommand({ Bucket: config.R2_BUCKET!, Key: key }),
        );
        return head.ContentLength ?? null;
    } catch {
        return null;
    }
}

export interface PresignPutOptions {
    key: string;
    contentType: string;
    /**
     * Exact byte length of the upload. Signed into the request, so the browser
     * PUT must carry precisely this Content-Length or R2 rejects the signature.
     * That is what stops a signed URL from being reused to push a huge object.
     */
    contentLength: number;
    /** Seconds the URL stays valid. Keep short — these are handed to browsers. */
    expiresIn?: number;
    cacheControl?: string;
}

export interface PresignedUpload {
    uploadUrl: string;
    /** Headers the client MUST send verbatim, or the signature check fails. */
    headers: Record<string, string>;
    key: string;
    publicUrl: string;
    expiresIn: number;
}

/**
 * Presign a single-shot PUT so the browser can upload straight to R2 without
 * the bytes transiting the app container.
 */
export async function presignPut({
    key,
    contentType,
    contentLength,
    expiresIn = 300,
    cacheControl = IMMUTABLE_CACHE_CONTROL,
}: PresignPutOptions): Promise<PresignedUpload> {
    const uploadUrl = await getSignedUrl(
        r2Client(),
        new PutObjectCommand({
            Bucket: config.R2_BUCKET!,
            Key: key,
            ContentType: contentType,
            ContentLength: contentLength,
            CacheControl: cacheControl,
        }),
        {
            expiresIn,
            // Without this the SDK signs only `host` + `content-length`, leaving
            // Content-Type unverified — a client could sign for image/png and
            // then PUT text/html, hosting arbitrary markup on the CDN origin.
            // Forcing both into the signature makes the server's MIME decision
            // binding rather than advisory.
            signableHeaders: new Set(["content-type", "cache-control"]),
        },
    );

    return {
        uploadUrl,
        headers: {
            "Content-Type": contentType,
            "Cache-Control": cacheControl,
        },
        key,
        publicUrl: publicUrlForKey(key),
        expiresIn,
    };
}
