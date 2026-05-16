/**
 * Brand References Routes — Phase 18 (v1.5)
 * Handles brand reference photo CRUD and style description updates.
 */

import { Router, Request, Response } from "express";
import {
    brandReferencePhotosResponseSchema,
    brandReferencePhotoSchema,
    createBrandReferencePhotoSchema,
    updateStyleDescriptionSchema,
} from "../../shared/schema.js";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";

const router = Router();

// Copied from posts.routes.ts — pure utility, no shared import needed in v1.5
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

/** GET /api/brand/reference-photos */
router.get("/api/brand/reference-photos", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;

    const { data: brand, error: brandError } = await supabase
        .from("brands").select("id").eq("user_id", user.id).single();
    if (brandError || !brand) {
        res.status(404).json({ message: "Brand not found" });
        return;
    }

    const { data: photos, error } = await supabase
        .from("brand_reference_photos")
        .select("id, brand_id, user_id, photo_url, position, created_at")
        .eq("brand_id", brand.id)
        .order("position", { ascending: true });

    if (error) {
        res.status(500).json({ message: "Failed to fetch reference photos" });
        return;
    }

    res.json(brandReferencePhotosResponseSchema.parse({ photos: photos ?? [] }));
});

/** POST /api/brand/reference-photos */
router.post("/api/brand/reference-photos", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;

    const parseResult = createBrandReferencePhotoSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: parseResult.error.errors.map((e) => e.message).join(", ") });
        return;
    }
    const body = parseResult.data;

    const { data: brand, error: brandError } = await supabase
        .from("brands").select("id").eq("user_id", user.id).single();
    if (brandError || !brand) {
        res.status(404).json({ message: "Brand not found" });
        return;
    }

    // Enforce 10-photo cap (application-level; non-atomic race is acceptable for v1.5)
    const { count, error: countError } = await supabase
        .from("brand_reference_photos")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brand.id);
    if (countError) {
        res.status(500).json({ message: "Failed to check photo count" });
        return;
    }
    if ((count ?? 0) >= 10) {
        res.status(400).json({ message: "Maximum 10 reference photos allowed" });
        return;
    }

    // Auto-assign position: max(existing position) + 1; defaults to 0 when table empty
    const { data: maxRow } = await supabase
        .from("brand_reference_photos")
        .select("position")
        .eq("brand_id", brand.id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
    const nextPosition = body.position ?? ((maxRow?.position ?? -1) + 1);

    const { data: photo, error: insertError } = await supabase
        .from("brand_reference_photos")
        .insert({
            brand_id: brand.id,
            user_id: user.id,
            photo_url: body.photo_url,
            position: nextPosition,
        })
        .select("id, brand_id, user_id, photo_url, position, created_at")
        .single();

    if (insertError || !photo) {
        res.status(500).json({ message: "Failed to save reference photo" });
        return;
    }

    res.status(201).json(brandReferencePhotoSchema.parse(photo));
});

/** DELETE /api/brand/reference-photos/:id */
router.delete("/api/brand/reference-photos/:id", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { supabase } = authResult;
    const { id } = req.params;

    // Fetch first to confirm ownership (RLS will also reject, but we want a clean 404)
    const { data: photo, error: fetchError } = await supabase
        .from("brand_reference_photos")
        .select("id, photo_url")
        .eq("id", id)
        .single();

    if (fetchError || !photo) {
        res.status(404).json({ message: "Photo not found" });
        return;
    }

    // Delete DB row first (immediate UI consistency)
    const { error: deleteError } = await supabase
        .from("brand_reference_photos")
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
            console.warn("[Storage Cleanup] Failed to delete reference photo:", storageError.message);
        }
    }

    res.json({ success: true });
});

/** PATCH /api/brand/style-description */
router.patch("/api/brand/style-description", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;

    const parseResult = updateStyleDescriptionSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: parseResult.error.errors.map((e) => e.message).join(", ") });
        return;
    }

    const { error } = await supabase
        .from("brands")
        .update({ style_description: parseResult.data.style_description })
        .eq("user_id", user.id);

    if (error) {
        res.status(500).json({ message: "Failed to update style description" });
        return;
    }

    res.json({ success: true });
});

export default router;
