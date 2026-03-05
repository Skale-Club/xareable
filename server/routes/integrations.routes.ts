/**
 * Integrations Routes - admin integration status endpoints
 */

import { Router, Request, Response } from "express";
import { config, hasGeminiKey } from "../config/index.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import { createAdminSupabase } from "../supabase.js";
import {
    adminIntegrationsStatusSchema,
    saveGHLSettingsRequestSchema,
    adminGHLStatusSchema,
    saveTelegramSettingsRequestSchema,
    adminTelegramStatusSchema,
    testTelegramRequestSchema,
    type GHLCustomField,
} from "../../shared/schema.js";
import {
    testGHLConnection,
    getGHLCustomFields,
    maskGHLApiKey,
} from "../integrations/ghl.js";
import {
    maskTelegramBotToken,
    normalizeTelegramChatIds,
    sendTelegramMessageToMany,
    testTelegramConnection,
} from "../integrations/telegram.js";

const router = Router();
const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;

function parseTelegramMetadata(raw: unknown): { chat_ids: string[]; notify_on_new_chat: boolean } {
    const meta = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
    return {
        chat_ids: normalizeTelegramChatIds(meta.chat_ids),
        notify_on_new_chat: Boolean(meta.notify_on_new_chat),
    };
}

/**
 * GET /api/admin/integrations/status
 * Returns integration health flags for admin visibility
 */
router.get("/api/admin/integrations/status", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const { data: appSettingsRows, error: appSettingsError } = await sb
        .from("app_settings")
        .select("gtm_enabled, gtm_container_id, updated_at, created_at")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1);
    if (appSettingsError) {
        res.status(500).json({ message: appSettingsError.message });
        return;
    }
    const appSettings = appSettingsRows?.[0] ?? null;
    const gtmContainerId = appSettings?.gtm_container_id?.trim()
        ? appSettings.gtm_container_id.trim().toUpperCase()
        : null;
    const gtmEnabled = Boolean(appSettings?.gtm_enabled);
    const gtmActive = Boolean(gtmEnabled && gtmContainerId && GTM_CONTAINER_ID_REGEX.test(gtmContainerId));

    // Get GHL integration status
    const { data: ghlSettings } = await sb
        .from("integration_settings")
        .select("enabled, api_key, location_id")
        .eq("integration_type", "ghl")
        .single();

    const ghlConfigured = Boolean(ghlSettings?.api_key && ghlSettings?.location_id);
    const ghlEnabled = Boolean(ghlSettings?.enabled && ghlConfigured);

    // Get Telegram integration status
    const { data: telegramSettings } = await sb
        .from("integration_settings")
        .select("enabled, api_key, custom_field_mappings")
        .eq("integration_type", "telegram")
        .single();

    const telegramMeta = parseTelegramMetadata(telegramSettings?.custom_field_mappings);
    const telegramConfigured = Boolean(telegramSettings?.api_key && telegramMeta.chat_ids.length > 0);
    const telegramEnabled = Boolean(telegramSettings?.enabled && telegramConfigured);

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
        ghl_enabled: ghlEnabled,
        ghl_configured: ghlConfigured,
        telegram_enabled: telegramEnabled,
        telegram_configured: telegramConfigured,
    }));
});

// ── GHL Integration Routes ─────────────────────────────────────────────────────

/**
 * GET /api/admin/ghl
 * Get current GHL integration settings (with masked API key)
 */
router.get("/api/admin/ghl", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const { data: ghlSettings, error } = await sb
        .from("integration_settings")
        .select("*")
        .eq("integration_type", "ghl")
        .single();

    if (error && error.code !== "PGRST116") { // PGRST116 = no rows found
        res.status(500).json({ message: error.message });
        return;
    }

    const settings = ghlSettings || {
        enabled: false,
        api_key: null,
        location_id: null,
        custom_field_mappings: {},
        last_sync_at: null,
    };

    const configured = Boolean(settings.api_key && settings.location_id);

    res.json(adminGHLStatusSchema.parse({
        configured,
        enabled: Boolean(settings.enabled && configured),
        api_key_masked: maskGHLApiKey(settings.api_key),
        location_id: settings.location_id || null,
        last_sync_at: settings.last_sync_at || null,
        connection_status: configured ? "disconnected" : "not_configured",
    }));
});

/**
 * PATCH /api/admin/ghl
 * Save GHL integration settings
 */
router.patch("/api/admin/ghl", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = saveGHLSettingsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
        return;
    }

    const { enabled, api_key, location_id, custom_field_mappings } = parseResult.data;
    const sb = createAdminSupabase();

    // Check if settings exist
    const { data: existing } = await sb
        .from("integration_settings")
        .select("id")
        .eq("integration_type", "ghl")
        .single();

    const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    };

    if (typeof enabled === "boolean") updateData.enabled = enabled;
    if (api_key !== undefined) updateData.api_key = api_key;
    if (location_id !== undefined) updateData.location_id = location_id;
    if (custom_field_mappings !== undefined) updateData.custom_field_mappings = custom_field_mappings;

    let result;
    if (existing?.id) {
        // Update existing
        result = await sb
            .from("integration_settings")
            .update(updateData)
            .eq("id", existing.id)
            .select()
            .single();
    } else {
        // Insert new
        result = await sb
            .from("integration_settings")
            .insert({
                integration_type: "ghl",
                ...updateData,
            })
            .select()
            .single();
    }

    if (result.error) {
        res.status(500).json({ message: result.error.message });
        return;
    }

    const settings = result.data;
    const configured = Boolean(settings.api_key && settings.location_id);

    res.json({
        configured,
        enabled: Boolean(settings.enabled && configured),
        api_key_masked: maskGHLApiKey(settings.api_key),
        location_id: settings.location_id,
        last_sync_at: settings.last_sync_at,
        connection_status: configured ? "disconnected" : "not_configured",
    });
});

/**
 * POST /api/admin/ghl/test
 * Test GHL API connection
 */
router.post("/api/admin/ghl/test", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const { data: ghlSettings } = await sb
        .from("integration_settings")
        .select("api_key, location_id")
        .eq("integration_type", "ghl")
        .single();

    // Allow testing with provided credentials or stored ones
    const apiKey = req.body?.api_key || ghlSettings?.api_key;
    const locationId = req.body?.location_id || ghlSettings?.location_id;

    if (!apiKey || !locationId) {
        res.status(400).json({
            success: false,
            message: "API key and Location ID are required"
        });
        return;
    }

    const testResult = await testGHLConnection({ apiKey, locationId });

    if (testResult.success) {
        res.json({ success: true, message: "Connection successful" });
    } else {
        res.status(400).json({
            success: false,
            message: testResult.error || "Connection failed"
        });
    }
});

/**
 * GET /api/admin/ghl/custom-fields
 * Get available custom fields from GHL
 */
router.get("/api/admin/ghl/custom-fields", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const { data: ghlSettings } = await sb
        .from("integration_settings")
        .select("api_key, location_id")
        .eq("integration_type", "ghl")
        .single();

    if (!ghlSettings?.api_key || !ghlSettings?.location_id) {
        res.status(400).json({
            message: "GHL integration not configured. Please save API key and Location ID first."
        });
        return;
    }

    const result = await getGHLCustomFields({
        apiKey: ghlSettings.api_key,
        locationId: ghlSettings.location_id,
    });

    if (result.error) {
        res.status(400).json({ message: result.error });
        return;
    }

    res.json({ customFields: result.fields });
});

/**
 * GET /api/admin/telegram
 * Get current Telegram integration settings (with masked bot token)
 */
router.get("/api/admin/telegram", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const { data: telegramSettings, error } = await sb
        .from("integration_settings")
        .select("*")
        .eq("integration_type", "telegram")
        .single();

    if (error && error.code !== "PGRST116") {
        res.status(500).json({ message: error.message });
        return;
    }

    const settings = telegramSettings || {
        enabled: false,
        api_key: null,
        custom_field_mappings: {},
        last_sync_at: null,
    };
    const metadata = parseTelegramMetadata(settings.custom_field_mappings);
    const configured = Boolean(settings.api_key && metadata.chat_ids.length > 0);

    res.json(adminTelegramStatusSchema.parse({
        configured,
        enabled: Boolean(settings.enabled && configured),
        bot_token_masked: maskTelegramBotToken(settings.api_key),
        chat_ids: metadata.chat_ids,
        notify_on_new_chat: metadata.notify_on_new_chat,
        last_tested_at: settings.last_sync_at || null,
        connection_status: configured ? "disconnected" : "not_configured",
    }));
});

/**
 * PUT /api/admin/telegram
 * Save Telegram integration settings
 */
router.put("/api/admin/telegram", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = saveTelegramSettingsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
        return;
    }

    const { enabled, bot_token, chat_ids, notify_on_new_chat } = parseResult.data;
    const sb = createAdminSupabase();
    const { data: existing } = await sb
        .from("integration_settings")
        .select("*")
        .eq("integration_type", "telegram")
        .single();

    const existingMeta = parseTelegramMetadata(existing?.custom_field_mappings);
    const newMeta = {
        chat_ids: chat_ids ? normalizeTelegramChatIds(chat_ids) : existingMeta.chat_ids,
        notify_on_new_chat: notify_on_new_chat ?? existingMeta.notify_on_new_chat,
    };

    const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        custom_field_mappings: newMeta,
    };

    if (typeof enabled === "boolean") updateData.enabled = enabled;
    if (bot_token !== undefined) updateData.api_key = bot_token;

    let result;
    if (existing?.id) {
        result = await sb
            .from("integration_settings")
            .update(updateData)
            .eq("id", existing.id)
            .select()
            .single();
    } else {
        result = await sb
            .from("integration_settings")
            .insert({
                integration_type: "telegram",
                enabled: false,
                ...updateData,
            })
            .select()
            .single();
    }

    if (result.error) {
        res.status(500).json({ message: result.error.message });
        return;
    }

    const settings = result.data;
    const metadata = parseTelegramMetadata(settings.custom_field_mappings);
    const configured = Boolean(settings.api_key && metadata.chat_ids.length > 0);

    res.json(adminTelegramStatusSchema.parse({
        configured,
        enabled: Boolean(settings.enabled && configured),
        bot_token_masked: maskTelegramBotToken(settings.api_key),
        chat_ids: metadata.chat_ids,
        notify_on_new_chat: metadata.notify_on_new_chat,
        last_tested_at: settings.last_sync_at || null,
        connection_status: configured ? "disconnected" : "not_configured",
    }));
});

/**
 * POST /api/admin/telegram/test
 * Test Telegram Bot API and send a test message to configured chat IDs
 */
router.post("/api/admin/telegram/test", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = testTelegramRequestSchema.safeParse(req.body || {});
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
        return;
    }

    const sb = createAdminSupabase();
    const { data: existing } = await sb
        .from("integration_settings")
        .select("*")
        .eq("integration_type", "telegram")
        .single();

    const existingMeta = parseTelegramMetadata(existing?.custom_field_mappings);
    const botToken = parseResult.data.bot_token || existing?.api_key;
    const chatIds = parseResult.data.chat_ids
        ? normalizeTelegramChatIds(parseResult.data.chat_ids)
        : existingMeta.chat_ids;

    if (!botToken || chatIds.length === 0) {
        res.status(400).json({
            success: false,
            message: "Bot token and at least one chat ID are required",
        });
        return;
    }

    const testResult = await testTelegramConnection(botToken);
    if (!testResult.success) {
        res.status(400).json({
            success: false,
            message: testResult.error || "Connection failed",
        });
        return;
    }

    const message = `<b>Telegram integration test</b>\nBot: @${testResult.data?.username || "unknown"}\nTime: ${new Date().toISOString()}`;
    const sendResult = await sendTelegramMessageToMany(botToken, chatIds, message);

    if (sendResult.sent.length === 0) {
        res.status(400).json({
            success: false,
            message: sendResult.failed[0]?.error || "Failed to send message to provided chat IDs",
            failed: sendResult.failed,
        });
        return;
    }

    if (existing?.id) {
        await sb
            .from("integration_settings")
            .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", existing.id);
    }

    res.json({
        success: true,
        message: `Connected. Message delivered to ${sendResult.sent.length} chat(s).`,
        sent: sendResult.sent,
        failed: sendResult.failed,
    });
});

export default router;
