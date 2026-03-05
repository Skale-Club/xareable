/**
 * Integrations Routes - admin integration status endpoints
 */

import { Router, Request, Response } from "express";
import { config, hasGeminiKey } from "../config/index.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import { createAdminSupabase } from "../supabase.js";
import { adminIntegrationsStatusSchema } from "../../shared/schema.js";

const router = Router();
const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;

/**
 * GET /api/admin/integrations/status
 * Returns integration health flags for admin visibility
 */
router.get("/api/admin/integrations/status", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const { data: appSettings } = await sb
        .from("app_settings")
        .select("gtm_enabled, gtm_container_id")
        .single();
    const gtmContainerId = appSettings?.gtm_container_id?.trim()
        ? appSettings.gtm_container_id.trim().toUpperCase()
        : null;
    const gtmEnabled = Boolean(appSettings?.gtm_enabled);
    const gtmActive = Boolean(gtmEnabled && gtmContainerId && GTM_CONTAINER_ID_REGEX.test(gtmContainerId));

    res.json(adminIntegrationsStatusSchema.parse({
        gemini_server_key_configured: hasGeminiKey,
        stripe_secret_key_configured: Boolean(config.STRIPE_SECRET_KEY),
        stripe_webhook_secret_configured: Boolean(config.STRIPE_WEBHOOK_SECRET),
        stripe_fully_configured: Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET),
        supabase_url_configured: Boolean(config.SUPABASE_URL),
        supabase_anon_key_configured: Boolean(config.SUPABASE_ANON_KEY),
        supabase_service_role_key_configured: Boolean(config.SUPABASE_SERVICE_ROLE_KEY),
        gtm_enabled: gtmEnabled,
        gtm_container_id: gtmContainerId,
        gtm_active: gtmActive,
    }));
});

export default router;
