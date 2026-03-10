/**
 * Landing Page Routes
 * Handles landing page content and uploads
 */

import { Router } from "express";
import { createAdminSupabase } from "../supabase.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import { uploadFile } from "../storage.js";
import { DEFAULT_LANDING_CONTENT } from "../services/app-settings.service.js";

const router = Router();

/**
 * GET /api/landing/content - Get landing page content (public)
 */
router.get("/api/landing/content", async (req, res) => {
    const sb = createAdminSupabase();
    const { data, error } = await sb.from("landing_content").select("*").single();
    if (error) {
        // Return default content if no record exists
        return res.json({
            id: null,
            ...DEFAULT_LANDING_CONTENT,
            updated_at: new Date().toISOString(),
            updated_by: null,
        });
    }
    res.json(data);
});

/**
 * PATCH /api/admin/landing/content - Update landing page content (admin)
 */
router.patch("/api/admin/landing/content", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    // Check if content exists
    const { data: existing } = await sb
        .from("landing_content")
        .select("id")
        .single();

    if (existing) {
        // Update existing content
        const { data, error } = await sb
            .from("landing_content")
            .update({
                ...req.body,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            })
            .eq("id", existing.id)
            .select()
            .single();
        if (error) return res.status(500).json({ message: error.message });
        res.json(data);
    } else {
        // Insert new content
        const { data, error } = await sb
            .from("landing_content")
            .insert({
                ...DEFAULT_LANDING_CONTENT,
                ...req.body,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            })
            .select()
            .single();
        if (error) return res.status(500).json({ message: error.message });
        res.json(data);
    }
});

/**
 * POST /api/admin/landing/upload-logo - Upload landing page logo
 */
router.post("/api/admin/landing/upload-logo", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    try {
        const { file, contentType } = req.body;
        if (!file || !contentType) {
            return res.status(400).json({ message: "Missing file or contentType" });
        }

        // Validate content type
        const validTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/jpg"];
        if (!validTypes.includes(contentType)) {
            return res
                .status(400)
                .json({ message: "Invalid file type. Only SVG, PNG, and JPEG are supported." });
        }

        const sb = createAdminSupabase();
        const fileBuffer = Buffer.from(file, "base64");

        const publicUrl = await uploadFile(
            sb,
            "user_assets",
            "landing",
            fileBuffer,
            contentType
        );

        // Update landing_content with new logo
        const { data: existing } = await sb
            .from("landing_content")
            .select("id")
            .single();
        if (existing) {
            const { error: updateError } = await sb
                .from("landing_content")
                .update({
                    logo_url: publicUrl,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.userId,
                })
                .eq("id", existing.id);
            if (updateError) {
                throw new Error(updateError.message);
            }
        } else {
            const { error: insertError } = await sb.from("landing_content").insert({
                ...DEFAULT_LANDING_CONTENT,
                logo_url: publicUrl,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            });
            if (insertError) {
                throw new Error(insertError.message);
            }
        }

        res.json({ logo_url: publicUrl });
    } catch (error: any) {
        console.error("Logo upload error:", error);
        res.status(500).json({ message: error.message });
    }
});

/**
 * POST /api/admin/landing/upload-alt-logo - Upload alternative logo
 */
router.post("/api/admin/landing/upload-alt-logo", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    try {
        const { file, contentType } = req.body;
        if (!file || !contentType) {
            return res.status(400).json({ message: "Missing file or contentType" });
        }

        const validTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/jpg"];
        if (!validTypes.includes(contentType)) {
            return res
                .status(400)
                .json({ message: "Invalid file type. Only SVG, PNG, and JPEG are supported." });
        }

        const sb = createAdminSupabase();
        const fileBuffer = Buffer.from(file, "base64");

        const publicUrl = await uploadFile(
            sb,
            "user_assets",
            "landing",
            fileBuffer,
            contentType
        );

        const { data: existing } = await sb
            .from("landing_content")
            .select("id")
            .single();
        if (existing) {
            const { error: updateError } = await sb
                .from("landing_content")
                .update({
                    alt_logo_url: publicUrl,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.userId,
                })
                .eq("id", existing.id);
            if (updateError) {
                throw new Error(updateError.message);
            }
        } else {
            const { error: insertError } = await sb.from("landing_content").insert({
                ...DEFAULT_LANDING_CONTENT,
                alt_logo_url: publicUrl,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            });
            if (insertError) {
                throw new Error(insertError.message);
            }
        }

        res.json({ alt_logo_url: publicUrl });
    } catch (error: any) {
        console.error("Alt Logo upload error:", error);
        res.status(500).json({ message: error.message });
    }
});

/**
 * POST /api/admin/landing/upload-icon - Upload favicon/icon
 */
router.post("/api/admin/landing/upload-icon", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    try {
        const { file, contentType } = req.body;
        if (!file || !contentType) {
            return res.status(400).json({ message: "Missing file or contentType" });
        }

        const validTypes = [
            "image/svg+xml",
            "image/png",
            "image/x-icon",
            "image/vnd.microsoft.icon",
        ];
        if (!validTypes.includes(contentType)) {
            return res
                .status(400)
                .json({ message: "Invalid file type. Only SVG, PNG, and ICO are supported." });
        }

        const sb = createAdminSupabase();
        const fileBuffer = Buffer.from(file, "base64");

        const publicUrl = await uploadFile(
            sb,
            "user_assets",
            "landing",
            fileBuffer,
            contentType
        );

        // Update landing_content with new icon
        const { data: existing } = await sb
            .from("landing_content")
            .select("id")
            .single();
        if (existing) {
            const { error: updateError } = await sb
                .from("landing_content")
                .update({
                    icon_url: publicUrl,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.userId,
                })
                .eq("id", existing.id);
            if (updateError) {
                throw new Error(updateError.message);
            }
        } else {
            const { error: insertError } = await sb.from("landing_content").insert({
                ...DEFAULT_LANDING_CONTENT,
                icon_url: publicUrl,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            });
            if (insertError) {
                throw new Error(insertError.message);
            }
        }

        // Also update app_settings favicon
        const { data: settingsExisting } = await sb
            .from("app_settings")
            .select("id")
            .order("updated_at", { ascending: false })
            .limit(1)
            .single();

        if (settingsExisting) {
            await sb
                .from("app_settings")
                .update({
                    favicon_url: publicUrl,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.userId,
                })
                .eq("id", settingsExisting.id);
        }

        res.json({ icon_url: publicUrl });
    } catch (error: any) {
        console.error("Icon upload error:", error);
        res.status(500).json({ message: error.message });
    }
});

/**
 * POST /api/admin/landing/upload-hero-image - Upload hero image
 */
router.post("/api/admin/landing/upload-hero-image", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    try {
        const { file, contentType } = req.body;
        if (!file || !contentType) {
            return res.status(400).json({ message: "Missing file or contentType" });
        }

        const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
        if (!validTypes.includes(contentType)) {
            return res
                .status(400)
                .json({ message: "Invalid file type. Only PNG, JPEG, and WEBP are supported." });
        }

        const sb = createAdminSupabase();
        const fileBuffer = Buffer.from(file, "base64");

        const publicUrl = await uploadFile(
            sb,
            "user_assets",
            "landing",
            fileBuffer,
            contentType
        );

        const { data: existing } = await sb
            .from("landing_content")
            .select("id")
            .single();
        if (existing) {
            const { error: updateError } = await sb
                .from("landing_content")
                .update({
                    hero_image_url: publicUrl,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.userId,
                })
                .eq("id", existing.id);
            if (updateError) {
                throw new Error(updateError.message);
            }
        } else {
            const { error: insertError } = await sb.from("landing_content").insert({
                ...DEFAULT_LANDING_CONTENT,
                hero_image_url: publicUrl,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            });
            if (insertError) {
                throw new Error(insertError.message);
            }
        }

        res.json({ hero_image_url: publicUrl });
    } catch (error: any) {
        console.error("Hero image upload error:", error);
        res.status(500).json({ message: error.message });
    }
});

/**
 * POST /api/admin/landing/upload-cta-image - Upload CTA image
 */
router.post("/api/admin/landing/upload-cta-image", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    try {
        const { file, contentType } = req.body;
        if (!file || !contentType) {
            return res.status(400).json({ message: "Missing file or contentType" });
        }

        const sb = createAdminSupabase();
        const fileBuffer = Buffer.from(file, "base64");

        const publicUrl = await uploadFile(
            sb,
            "user_assets",
            "landing",
            fileBuffer,
            contentType
        );

        const { data: existing } = await sb
            .from("landing_content")
            .select("id")
            .single();
        if (existing) {
            const { error: updateError } = await sb
                .from("landing_content")
                .update({
                    cta_image_url: publicUrl,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.userId,
                })
                .eq("id", existing.id);
            if (updateError) {
                throw new Error(updateError.message);
            }
        } else {
            const { error: insertError } = await sb.from("landing_content").insert({
                ...DEFAULT_LANDING_CONTENT,
                cta_image_url: publicUrl,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            });
            if (insertError) {
                throw new Error(insertError.message);
            }
        }

        res.json({ cta_image_url: publicUrl });
    } catch (error: any) {
        console.error("CTA image upload error:", error);
        res.status(500).json({ message: error.message });
    }
});

export default router;
