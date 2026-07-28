/**
 * Style Reference Photos Routes — Phase 25 (PLAN-07)
 *
 * Platform-curated style/mood reference boards. Ownership is INVERTED vs
 * `brand_reference_photos` (public read / admin write): every route here is
 * admin-only, gated by `requireAdminGuard`, and all data access goes through
 * `createAdminSupabase()` (service role, bypasses RLS) rather than the
 * request-scoped client `brand-references.routes.ts` uses.
 *
 * No public (non-admin) GET route is exposed here: generation-time reads go
 * through `fetchStyleBoardPhotoUrls` in `style-reference.service.ts` using
 * the service-role client, and the creator UI has no need for these images.
 */

import { Router, Request, Response } from "express";
import {
    styleReferencePhotoSchema,
    styleReferencePhotosResponseSchema,
    createStyleReferencePhotoSchema,
    STYLE_REFERENCE_SCOPES,
    MAX_STYLE_REFERENCE_PHOTOS,
} from "../../shared/schema.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import { createAdminSupabase } from "../supabase.js";

const router = Router();

// Copied verbatim from brand-references.routes.ts — pure utility, no shared import needed
function getStorageObjectPathFromPublicUrl(
    publicUrl: string | null | undefined,
    bucket: string
): string | null {
    if (!publicUrl) return null;
    try {
        const url = new URL(publicUrl);
        const marker = `/storage/v1/object/public/${bucket}/`;
        const markerIndex = url.pathname.indexOf(marker);
        if (markerIndex === -1) return null;
        const encodedPath = url.pathname.slice(markerIndex + marker.length);
        const decodedPath = decodeURIComponent(encodedPath).replace(/^\/+/, "");
        return decodedPath || null;
    } catch {
        return null;
    }
}

/** GET /api/admin/style-reference-photos */
router.get("/api/admin/style-reference-photos", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const scopeParam = req.query.scope;
    const styleIdParam = req.query.style_id;

    if (scopeParam !== undefined && !STYLE_REFERENCE_SCOPES.includes(scopeParam as any)) {
        res.status(400).json({
            message: `Invalid scope: must be one of ${STYLE_REFERENCE_SCOPES.join(", ")}`,
        });
        return;
    }

    const supabase = createAdminSupabase();
    let query = supabase
        .from("style_reference_photos")
        .select("id, scope, style_id, photo_url, position, created_at");

    if (scopeParam !== undefined) {
        query = query.eq("scope", scopeParam as string);
    }
    if (styleIdParam !== undefined) {
        query = query.eq("style_id", styleIdParam as string);
    }

    const { data, error } = await query
        .order("style_id", { ascending: true })
        .order("position", { ascending: true });

    if (error) {
        res.status(500).json({ message: "Failed to fetch style reference photos" });
        return;
    }

    res.json(styleReferencePhotosResponseSchema.parse({ photos: data ?? [] }));
});

/** POST /api/admin/style-reference-photos */
router.post("/api/admin/style-reference-photos", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = createStyleReferencePhotoSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: parseResult.error.errors.map((e) => e.message).join(", ") });
        return;
    }
    const body = parseResult.data;

    const supabase = createAdminSupabase();

    // Cap check: max MAX_STYLE_REFERENCE_PHOTOS per (scope, style_id)
    const { count, error: countError } = await supabase
        .from("style_reference_photos")
        .select("id", { count: "exact", head: true })
        .eq("scope", body.scope)
        .eq("style_id", body.style_id);
    if (countError) {
        res.status(500).json({ message: "Failed to check photo count" });
        return;
    }
    if ((count ?? 0) >= MAX_STYLE_REFERENCE_PHOTOS) {
        res.status(400).json({ message: `Maximum ${MAX_STYLE_REFERENCE_PHOTOS} reference images allowed per style` });
        return;
    }

    // Auto-assign position: max(existing position) + 1 for this (scope, style_id); defaults to 0
    const { data: maxRow } = await supabase
        .from("style_reference_photos")
        .select("position")
        .eq("scope", body.scope)
        .eq("style_id", body.style_id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
    const nextPosition = body.position ?? ((maxRow?.position ?? -1) + 1);

    const { data: photo, error: insertError } = await supabase
        .from("style_reference_photos")
        .insert({
            scope: body.scope,
            style_id: body.style_id,
            photo_url: body.photo_url,
            position: nextPosition,
            created_by: adminResult.userId,
        })
        .select("id, scope, style_id, photo_url, position, created_at")
        .single();

    if (insertError || !photo) {
        res.status(500).json({ message: "Failed to save style reference photo" });
        return;
    }

    res.status(201).json(styleReferencePhotoSchema.parse(photo));
});

/** DELETE /api/admin/style-reference-photos/:id */
router.delete("/api/admin/style-reference-photos/:id", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const { id } = req.params;
    const supabase = createAdminSupabase();

    // Fetch first so we can return a clean 404 and know the photo_url for storage cleanup
    const { data: photo, error: fetchError } = await supabase
        .from("style_reference_photos")
        .select("id, photo_url")
        .eq("id", id)
        .single();

    if (fetchError || !photo) {
        res.status(404).json({ message: "Photo not found" });
        return;
    }

    // Delete DB row first (immediate UI consistency)
    const { error: deleteError } = await supabase
        .from("style_reference_photos")
        .delete()
        .eq("id", id);
    if (deleteError) {
        res.status(500).json({ message: "Failed to delete photo" });
        return;
    }

    // Delete storage object best-effort (failure is logged, not surfaced to caller)
    const storagePath = getStorageObjectPathFromPublicUrl(photo.photo_url, "user_assets");
    if (storagePath) {
        const { error: storageError } = await supabase.storage
            .from("user_assets")
            .remove([storagePath]);
        if (storageError) {
            console.warn("[Storage Cleanup] Failed to delete style reference photo:", storageError.message);
        }
    }

    res.json({ success: true });
});

export default router;
