/**
 * Style Catalog Routes
 * Handles brand styles and post moods configuration
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase";
import { DEFAULT_STYLE_CATALOG, styleCatalogSchema } from "../../shared/schema";
import { requireAdminGuard } from "../middleware/auth.middleware";

const router = Router();

/**
 * Get style catalog from platform settings
 * Exported for use by other modules
 */
export async function getStyleCatalogPayload() {
    const sb = createAdminSupabase();
    const { data } = await sb
        .from("platform_settings")
        .select("setting_value")
        .eq("setting_key", "style_catalog")
        .single();

    const value = data?.setting_value;
    const parsed = styleCatalogSchema.safeParse(value);

    if (!parsed.success) {
        return DEFAULT_STYLE_CATALOG;
    }

    return parsed.data;
}

/**
 * GET /api/style-catalog
 * Returns the public style catalog (styles and post moods)
 */
router.get("/api/style-catalog", async (_req: Request, res: Response) => {
    const catalog = await getStyleCatalogPayload();
    res.json(catalog);
});

/**
 * GET /api/admin/style-catalog
 * Returns the full style catalog for admin editing
 */
router.get("/api/admin/style-catalog", async (req: Request, res: Response) => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const catalog = await getStyleCatalogPayload();
    res.json(catalog);
});

/**
 * PATCH /api/admin/style-catalog
 * Updates the style catalog (admin only)
 */
router.patch("/api/admin/style-catalog", async (req: Request, res: Response) => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = styleCatalogSchema.safeParse(req.body);

    if (!parseResult.success) {
        return res.status(400).json({
            message: "Invalid style catalog: " + parseResult.error.errors.map(e => e.message).join(", ")
        });
    }

    const sb = createAdminSupabase();
    const { error } = await sb
        .from("platform_settings")
        .update({ setting_value: parseResult.data })
        .eq("setting_key", "style_catalog");

    if (error) {
        return res.status(500).json({ message: "Failed to update style catalog" });
    }

    res.json(parseResult.data);
});

export default router;
