/**
 * Landing Page Routes
 * Handles landing page content and uploads (admin-only mutations).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "../supabase.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import { uploadFile } from "../storage.js";
import { DEFAULT_LANDING_CONTENT } from "../services/app-settings.service.js";
import { validateBase64Upload } from "../lib/upload-validation.js";
import { captureException } from "../lib/observability.js";

const router = Router();

/**
 * Whitelist of editable landing-content fields. Zod strips anything not listed
 * here, so an admin token can't inject arbitrary columns (id, updated_by, …)
 * via `...req.body`. All optional — this is a partial PATCH.
 */
const landingContentUpdateSchema = z
  .object({
    background_variant: z.string(),
    hero_headline: z.string(),
    hero_subtext: z.string(),
    hero_cta_text: z.string(),
    hero_secondary_cta_text: z.string(),
    hero_image_url: z.string().nullable(),
    features_title: z.string(),
    features_subtitle: z.string(),
    how_it_works_title: z.string(),
    how_it_works_subtitle: z.string(),
    testimonials_title: z.string(),
    testimonials_subtitle: z.string(),
    cta_title: z.string(),
    cta_subtitle: z.string(),
    cta_button_text: z.string(),
    cta_image_url: z.string().nullable(),
    logo_url: z.string().nullable(),
    alt_logo_url: z.string().nullable(),
    icon_url: z.string().nullable(),
  })
  .partial();

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const LOGO_TYPES = ["image/svg+xml", "image/png", "image/jpeg", "image/jpg"];
const ICON_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];

/**
 * Upsert a single landing_content field, stamping audit columns server-side.
 * Replaces the per-route update/insert duplication.
 */
async function persistLandingField(
  sb: SupabaseClient,
  field: string,
  value: string,
  adminUserId: string,
): Promise<void> {
  const stamp = { updated_at: new Date().toISOString(), updated_by: adminUserId };
  const { data: existing } = await sb.from("landing_content").select("id").single();
  if (existing) {
    const { error } = await sb
      .from("landing_content")
      .update({ [field]: value, ...stamp })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb
      .from("landing_content")
      .insert({ ...DEFAULT_LANDING_CONTENT, [field]: value, ...stamp });
    if (error) throw new Error(error.message);
  }
}

/**
 * Factory for the simple "validate → upload → persist one field" upload routes.
 */
function makeUploadHandler(
  field: string,
  allowedTypes: string[],
  responseKey: string,
) {
  return async (req: Request, res: Response) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const v = validateBase64Upload(req.body?.file, req.body?.contentType, allowedTypes);
    if (!v.ok) return res.status(v.status).json({ message: v.message });

    try {
      const sb = createAdminSupabase();
      const publicUrl = await uploadFile("landing", v.buffer, v.contentType);
      await persistLandingField(sb, field, publicUrl, admin.userId);
      res.json({ [responseKey]: publicUrl });
    } catch (error: any) {
      captureException(error, { route: `landing_upload:${field}` });
      res.status(500).json({ message: error.message });
    }
  };
}

/**
 * GET /api/landing/content - Get landing page content (public)
 */
router.get("/api/landing/content", async (_req, res) => {
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

  const parsed = landingContentUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid landing content payload",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const sb = createAdminSupabase();
  const stamp = { updated_at: new Date().toISOString(), updated_by: admin.userId };

  const { data: existing } = await sb.from("landing_content").select("id").single();

  if (existing) {
    const { data, error } = await sb
      .from("landing_content")
      .update({ ...parsed.data, ...stamp })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return res.status(500).json({ message: error.message });
    res.json(data);
  } else {
    const { data, error } = await sb
      .from("landing_content")
      .insert({ ...DEFAULT_LANDING_CONTENT, ...parsed.data, ...stamp })
      .select()
      .single();
    if (error) return res.status(500).json({ message: error.message });
    res.json(data);
  }
});

/**
 * Landing asset uploads (admin). Each validates declared MIME, byte size, and
 * (for SVG) active-content hardening via validateBase64Upload.
 */
router.post("/api/admin/landing/upload-logo", makeUploadHandler("logo_url", LOGO_TYPES, "logo_url"));
router.post("/api/admin/landing/upload-alt-logo", makeUploadHandler("alt_logo_url", LOGO_TYPES, "alt_logo_url"));
router.post("/api/admin/landing/upload-hero-image", makeUploadHandler("hero_image_url", IMAGE_TYPES, "hero_image_url"));
router.post("/api/admin/landing/upload-cta-image", makeUploadHandler("cta_image_url", IMAGE_TYPES, "cta_image_url"));

/**
 * POST /api/admin/landing/upload-icon - Upload favicon/icon (also mirrors into
 * app_settings.favicon_url), so it keeps its own handler.
 */
router.post("/api/admin/landing/upload-icon", async (req, res) => {
  const admin = await requireAdminGuard(req, res);
  if (!admin) return;

  const v = validateBase64Upload(req.body?.file, req.body?.contentType, ICON_TYPES);
  if (!v.ok) return res.status(v.status).json({ message: v.message });

  try {
    const sb = createAdminSupabase();
    const publicUrl = await uploadFile("landing", v.buffer, v.contentType);
    await persistLandingField(sb, "icon_url", publicUrl, admin.userId);

    // Also mirror into app_settings favicon (most-recent row).
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
    captureException(error, { route: "landing_upload:icon_url" });
    res.status(500).json({ message: error.message });
  }
});

export default router;
