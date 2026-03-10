/**
 * Settings Routes
 * Handles application settings (public and admin)
 */

import { Router } from "express";
import { createAdminSupabase } from "../supabase.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import { uploadFile } from "../storage.js";
import {
    DEFAULT_APP_SETTINGS,
    getLatestAppSettingsRow,
    normalizeGtmContainerId,
    isValidGtmContainerId,
    isAppSettingsSingletonConflict,
} from "../services/app-settings.service.js";
import { updateAppSettingsSchema } from "../../shared/schema.js";

const router = Router();

/**
 * GET /api/settings - Get public app settings
 */
router.get("/api/settings", async (_req, res) => {
    const sb = createAdminSupabase();
    const { data: landingContent } = await sb
        .from("landing_content")
        .select("icon_url")
        .single();

    let data: Record<string, any> | null = null;
    try {
        data = await getLatestAppSettingsRow();
    } catch (error: any) {
        console.error("Failed to fetch app settings:", error?.message || error);
        return res.status(500).json({ message: "Failed to load app settings." });
    }

    if (!data) {
        // Return default settings if no record exists
        return res.json({
            id: "",
            app_name: "",
            app_tagline: null,
            app_description: null,
            logo_url: null,
            favicon_url: landingContent?.icon_url || null,
            primary_color: "#8b5cf6",
            secondary_color: "#ec4899",
            success_color: "#10b981",
            error_color: "#ef4444",
            meta_title: null,
            meta_description: null,
            og_image_url: null,
            terms_url: null,
            privacy_url: null,
            gtm_enabled: false,
            gtm_container_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            updated_by: null,
        });
    }

    res.json({
        ...data,
        favicon_url: landingContent?.icon_url || data.favicon_url,
    });
});

/**
 * PATCH /api/admin/settings - Update app settings (admin)
 */
router.patch("/api/admin/settings", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const parseResult = updateAppSettingsSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({
            message:
                "Invalid request: " +
                parseResult.error.errors.map((e) => e.message).join(", "),
        });
    }

    const sb = createAdminSupabase();
    const payload: Record<string, any> = { ...parseResult.data };

    if (payload.gtm_container_id !== undefined) {
        payload.gtm_container_id = normalizeGtmContainerId(payload.gtm_container_id);
        if (
            payload.gtm_container_id &&
            !isValidGtmContainerId(payload.gtm_container_id)
        ) {
            return res
                .status(400)
                .json({ message: "Invalid GTM container ID format. Expected GTM-XXXXXXX." });
        }
    }

    // Check if settings exist
    let existing: Record<string, any> | null = null;
    try {
        existing = await getLatestAppSettingsRow("id, gtm_enabled, gtm_container_id");
    } catch (error: any) {
        return res
            .status(500)
            .json({ message: error.message || "Failed to read app settings." });
    }

    const effectiveGtmEnabled =
        payload.gtm_enabled !== undefined
            ? payload.gtm_enabled
            : Boolean(existing?.gtm_enabled);
    const effectiveGtmContainerId =
        payload.gtm_container_id !== undefined
            ? payload.gtm_container_id
            : normalizeGtmContainerId(existing?.gtm_container_id);

    if (effectiveGtmEnabled && !isValidGtmContainerId(effectiveGtmContainerId)) {
        return res.status(400).json({
            message: "GTM must have a valid container ID before being enabled.",
        });
    }

    if (existing) {
        // Update existing settings
        const { data, error } = await sb
            .from("app_settings")
            .update({
                ...payload,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            })
            .eq("id", existing.id)
            .select()
            .single();
        if (error) return res.status(500).json({ message: error.message });
        res.json(data);
    } else {
        // Insert new settings
        const { data, error } = await sb
            .from("app_settings")
            .insert({
                ...payload,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            })
            .select()
            .single();

        if (error && isAppSettingsSingletonConflict(error)) {
            const canonical = await getLatestAppSettingsRow("id");
            if (!canonical) {
                return res
                    .status(500)
                    .json({ message: "Failed to resolve app settings conflict." });
            }

            const retry = await sb
                .from("app_settings")
                .update({
                    ...payload,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.userId,
                })
                .eq("id", canonical.id)
                .select()
                .single();

            if (retry.error) return res.status(500).json({ message: retry.error.message });
            return res.json(retry.data);
        }

        if (error) return res.status(500).json({ message: error.message });
        res.json(data);
    }
});

/**
 * POST /api/admin/settings/upload-og-image - Upload OG image (admin)
 */
router.post("/api/admin/settings/upload-og-image", async (req, res) => {
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
            "app-settings",
            fileBuffer,
            contentType
        );

        const existing = await getLatestAppSettingsRow("id");

        if (existing) {
            await sb
                .from("app_settings")
                .update({
                    og_image_url: publicUrl,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.userId,
                })
                .eq("id", existing.id);
        } else {
            await sb.from("app_settings").insert({
                og_image_url: publicUrl,
                updated_at: new Date().toISOString(),
                updated_by: admin.userId,
            });
        }

        res.json({ og_image_url: publicUrl });
    } catch (error: any) {
        console.error("OG image upload error:", error);
        res.status(500).json({ message: error.message });
    }
});

export default router;
