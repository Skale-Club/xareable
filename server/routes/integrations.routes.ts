/**
 * Integrations Routes - admin integration status endpoints
 */

import { Router, Request, Response } from "express";
import type { User } from "@supabase/supabase-js";
import { config, hasGeminiKey } from "../config/index.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import { createAdminSupabase, createServerSupabase } from "../supabase.js";
import {
    adminFacebookDatasetStatusSchema,
    adminGA4StatusSchema,
    adminIntegrationsStatusSchema,
    adminMarketingEventsResponseSchema,
    saveGHLSettingsRequestSchema,
    saveGA4SettingsRequestSchema,
    saveFacebookDatasetSettingsRequestSchema,
    adminGHLStatusSchema,
    marketingLeadTrackRequestSchema,
    saveTelegramSettingsRequestSchema,
    adminTelegramStatusSchema,
    testGA4RequestSchema,
    testFacebookDatasetRequestSchema,
    testTelegramRequestSchema,
} from "../../shared/schema.js";
import {
    buildGHLContactPayload,
    getOrCreateGHLContact,
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
import { trackMarketingEvent } from "../integrations/marketing.js";

const router = Router();
const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;
const REQUEST_TIMEOUT_MS = 15_000;

function safeTrimmed(value: unknown): string | null {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
}

function parseTelegramMetadata(raw: unknown): { chat_ids: string[]; notify_on_new_signup: boolean } {
    const meta = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
    const hasLegacyNotify = Object.prototype.hasOwnProperty.call(meta, "notify_on_new_chat");
    const hasNotify = Object.prototype.hasOwnProperty.call(meta, "notify_on_new_signup") || hasLegacyNotify;
    return {
        chat_ids: normalizeTelegramChatIds(meta.chat_ids),
        notify_on_new_signup: hasNotify
            ? Boolean(meta.notify_on_new_signup ?? meta.notify_on_new_chat)
            : true,
    };
}

function parseFacebookDatasetMetadata(raw: unknown): { test_event_code: string | null } {
    const meta = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
    return {
        test_event_code: safeTrimmed(meta.test_event_code),
    };
}

function parseStringRecord(raw: unknown): Record<string, string> {
    const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
        const safeKey = key.trim();
        const safeValue = typeof value === "string" ? value.trim() : "";
        if (!safeKey || !safeValue) continue;
        normalized[safeKey] = safeValue;
    }
    return normalized;
}

function maskSecret(secret: string | null | undefined): string | null {
    if (!secret) return null;
    if (secret.length <= 10) return "••••••••";
    return `${secret.slice(0, 4)}${"•".repeat(8)}${secret.slice(-4)}`;
}

function getRequestIp(req: Request): string | null {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || null;
}

function getRequestSourceUrl(req: Request): string | null {
    const referer = safeTrimmed(req.get("referer"));
    if (referer) return referer;

    const host = safeTrimmed(req.get("x-forwarded-host") || req.get("host"));
    const protocol = safeTrimmed(req.get("x-forwarded-proto") || req.protocol || "https");
    if (!host || !protocol) return null;
    return `${protocol}://${host}`;
}

function toConnectionStatus(configured: boolean, enabled: boolean): "connected" | "disconnected" | "not_configured" {
    if (!configured) return "not_configured";
    return enabled ? "connected" : "disconnected";
}

function normalizeFieldKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

const GHL_SOURCE_FIELD_ALIASES: Record<string, string[]> = {
    content_name: ["content_name", "lead_content_name", "contentname", "leadcontentname"],
    content_category: ["content_category", "lead_content_category", "contentcategory", "leadcontentcategory"],
    company_name: ["company_name", "business_name", "brand_name", "company", "business"],
    company_type: ["company_type", "industry", "niche", "segment", "business_type", "company_niche"],
    mood: ["mood", "brand_style", "brand_mood", "style"],
    color_1: ["color_1", "primary_color", "color1", "brand_color_1"],
    color_2: ["color_2", "secondary_color", "color2", "brand_color_2"],
    color_3: ["color_3", "color3", "brand_color_3"],
    color_4: ["color_4", "color4", "brand_color_4"],
    logo_url: ["logo_url", "brand_logo_url", "logo"],
    full_name: ["full_name", "name", "contact_name"],
    phone: ["phone", "phone_number", "mobile", "whatsapp"],
    user_id: ["user_id", "userid", "external_id", "user"],
    email: ["email", "user_email", "contact_email"],
};

const GHL_SOURCE_ALIAS_LOOKUP = (() => {
    const lookup = new Map<string, string>();
    for (const [canonicalKey, aliases] of Object.entries(GHL_SOURCE_FIELD_ALIASES)) {
        lookup.set(canonicalKey, canonicalKey);
        for (const alias of aliases) {
            const normalizedAlias = normalizeFieldKey(alias);
            if (!normalizedAlias) continue;
            lookup.set(normalizedAlias, canonicalKey);
        }
    }
    return lookup;
})();

function canonicalizeGhlSourceFieldKey(rawKey: string): string {
    const normalized = normalizeFieldKey(rawKey);
    if (!normalized) return "";
    return GHL_SOURCE_ALIAS_LOOKUP.get(normalized) || normalized;
}

function normalizeGhlFieldMappings(rawMappings: Record<string, string>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [rawKey, targetFieldKey] of Object.entries(rawMappings)) {
        const sourceKey = canonicalizeGhlSourceFieldKey(rawKey);
        const targetKey = safeTrimmed(targetFieldKey);
        if (!sourceKey || !targetKey) continue;
        normalized[sourceKey] = targetKey;
    }
    return normalized;
}

function normalizeGhlAnswers(rawAnswers: Record<string, string>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(rawAnswers)) {
        const sourceKey = canonicalizeGhlSourceFieldKey(rawKey);
        const value = safeTrimmed(rawValue);
        if (!sourceKey || !value) continue;
        normalized[sourceKey] = value;
    }
    return normalized;
}

async function getLatestIntegrationSetting(
    sb: ReturnType<typeof createAdminSupabase>,
    integrationType: string,
    selectColumns = "*",
): Promise<{ row: Record<string, any> | null; error: { message?: string } | null }> {
    const { data, error } = await sb
        .from("integration_settings")
        .select(selectColumns)
        .eq("integration_type", integrationType)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1);

    if (error) {
        return { row: null, error };
    }

    return { row: data?.[0] || null, error: null };
}

function toUnixMs(dateValue: unknown): number {
    if (typeof dateValue !== "string" || !dateValue.trim()) return 0;
    const time = Date.parse(dateValue);
    return Number.isFinite(time) ? time : 0;
}

function pickLatestIntegrationRows(rows: Array<Record<string, any>>): Record<string, Record<string, any>> {
    const byType: Record<string, Record<string, any>> = {};
    for (const row of rows) {
        const type = safeTrimmed(row.integration_type);
        if (!type) continue;

        const current = byType[type];
        if (!current) {
            byType[type] = row;
            continue;
        }

        const currentUpdatedAt = toUnixMs(current.updated_at) || toUnixMs(current.created_at);
        const nextUpdatedAt = toUnixMs(row.updated_at) || toUnixMs(row.created_at);
        if (nextUpdatedAt >= currentUpdatedAt) {
            byType[type] = row;
        }
    }

    return byType;
}

function isLikelyGHLApiKey(value: string): boolean {
    const normalized = value.trim();
    return normalized.length >= 20 && !/\s/.test(normalized);
}

async function syncLeadToGHL(input: {
    user: User;
    body: {
        content_name?: string;
        content_category?: string;
        phone?: string;
        full_name?: string;
        company_name?: string;
        company_type?: string;
        answers?: Record<string, string>;
    };
}): Promise<void> {
    const sb = createAdminSupabase();

    const { row: settings, error: settingsError } = await getLatestIntegrationSetting(
        sb,
        "ghl",
        "id, enabled, api_key, location_id, custom_field_mappings"
    );

    if (settingsError) {
        console.error("GHL sync skipped: failed to read integration settings", settingsError.message);
        return;
    }

    if (!settings?.enabled || !settings.api_key || !settings.location_id) {
        return;
    }
    if (!settings.id) {
        console.error("GHL sync skipped: latest integration settings row has no id");
        return;
    }

    const { data: brand } = await sb
        .from("brands")
        .select("company_name, company_type, mood, color_1, color_2, color_3, color_4, logo_url")
        .eq("user_id", input.user.id)
        .maybeSingle();

    const fieldMappings = normalizeGhlFieldMappings(parseStringRecord(settings.custom_field_mappings));
    const extraAnswers = normalizeGhlAnswers(input.body.answers || {});

    const meta = (input.user.user_metadata && typeof input.user.user_metadata === "object")
        ? input.user.user_metadata as Record<string, unknown>
        : {};
    const firstName = safeTrimmed(meta.first_name);
    const lastName = safeTrimmed(meta.last_name);
    const fullName = safeTrimmed(input.body.full_name)
        || safeTrimmed(meta.full_name)
        || [firstName, lastName].filter(Boolean).join(" ").trim()
        || safeTrimmed(brand?.company_name)
        || null;
    const phone = safeTrimmed(input.body.phone) || safeTrimmed(input.user.phone);
    const answers: Record<string, string> = {
        user_id: input.user.id,
        email: input.user.email || "",
        full_name: fullName || "",
        phone: phone || "",
        content_name: input.body.content_name || "Brand Setup",
        content_category: input.body.content_category || "Onboarding",
        company_name: input.body.company_name || safeTrimmed(brand?.company_name) || "",
        company_type: input.body.company_type || safeTrimmed(brand?.company_type) || "",
        mood: safeTrimmed(brand?.mood) || "",
        color_1: safeTrimmed(brand?.color_1) || "",
        color_2: safeTrimmed(brand?.color_2) || "",
        color_3: safeTrimmed(brand?.color_3) || "",
        color_4: safeTrimmed(brand?.color_4) || "",
        logo_url: safeTrimmed(brand?.logo_url) || "",
        ...extraAnswers,
    };

    const payload = buildGHLContactPayload(
        answers,
        fieldMappings,
        {
            email: input.user.email || undefined,
            phone: phone || undefined,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            name: fullName || undefined,
        }
    );
    payload.tags = Array.from(new Set([...(payload.tags || []), "lead", "onboarding"]));

    const result = await getOrCreateGHLContact(
        { apiKey: settings.api_key, locationId: settings.location_id },
        payload,
    );

    if (!result.success) {
        console.error("GHL lead sync failed:", result.error || "unknown_error");
        return;
    }

    const { error: updateError } = await sb
        .from("integration_settings")
        .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", settings.id);
    if (updateError) {
        console.error("GHL sync succeeded but failed updating last_sync_at:", updateError.message);
    }
}

async function sendGa4TestEvent(measurementId: string, apiSecret: string): Promise<{ success: boolean; message: string }> {
    const url =
        `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(measurementId)}` +
        `&api_secret=${encodeURIComponent(apiSecret)}`;

    const body = {
        client_id: `admin_test_${Date.now()}`,
        events: [
            {
                name: "admin_integration_test",
                params: { source: "admin", timestamp: new Date().toISOString() },
            },
        ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const raw = await response.text().catch(() => "");
        let parsed: unknown = null;
        try {
            parsed = raw ? JSON.parse(raw) : null;
        } catch {
            parsed = null;
        }

        if (!response.ok) {
            const p = parsed as Record<string, any> | null;
            return {
                success: false,
                message: p?.error?.message || raw || `GA4 request failed (${response.status})`,
            };
        }

        const p = parsed as Record<string, any> | null;
        const validationMessages = Array.isArray(p?.validationMessages)
            ? p.validationMessages
            : [];
        const blockingError = validationMessages.find((item: any) => String(item?.severity || "").toUpperCase() === "ERROR");
        if (blockingError) {
            return {
                success: false,
                message: String(blockingError.description || "GA4 validation failed"),
            };
        }

        return { success: true, message: "Connection successful" };
    } catch (error: unknown) {
        clearTimeout(timeout);
        const isTimeout = error instanceof Error && error.name === "AbortError";
        return {
            success: false,
            message: isTimeout ? "GA4 request timed out" : (error instanceof Error ? error.message : "GA4 request failed"),
        };
    }
}

async function sendFacebookDatasetTestEvent(
    datasetId: string,
    accessToken: string,
    testEventCode: string | null,
): Promise<{ success: boolean; message: string }> {
    const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(datasetId)}/events`;
    const body: Record<string, unknown> = {
        data: [
            {
                event_name: "admin_integration_test",
                event_time: Math.floor(Date.now() / 1000),
                event_id: `admin_test_${Date.now()}`,
                action_source: "website",
                custom_data: { source: "admin" },
            },
        ],
        access_token: accessToken,
    };

    if (testEventCode) {
        body.test_event_code = testEventCode;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const raw = await response.text().catch(() => "");
        let parsed: unknown = null;
        try {
            parsed = raw ? JSON.parse(raw) : null;
        } catch {
            parsed = null;
        }

        const p = parsed as Record<string, any> | null;

        if (!response.ok) {
            return {
                success: false,
                message: p?.error?.message || raw || `Facebook request failed (${response.status})`,
            };
        }

        if (p?.error?.message) {
            return {
                success: false,
                message: String(p.error.message),
            };
        }

        return { success: true, message: "Connection successful" };
    } catch (error: unknown) {
        clearTimeout(timeout);
        const isTimeout = error instanceof Error && error.name === "AbortError";
        return {
            success: false,
            message: isTimeout ? "Facebook request timed out" : (error instanceof Error ? error.message : "Facebook request failed"),
        };
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * GET /api/admin/integrations/status
 * Returns integration health flags for admin visibility
 */
router.get("/api/admin/integrations/status", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();

    // Fetch app_settings and all integration rows in parallel
    const [appSettingsResult, integrationSettingsResult] = await Promise.all([
        sb.from("app_settings")
            .select("gtm_enabled, gtm_container_id, updated_at, created_at")
            .order("updated_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false, nullsFirst: false })
            .limit(1),
        sb.from("integration_settings")
            .select("integration_type, enabled, api_key, location_id, custom_field_mappings, created_at, updated_at")
            .in("integration_type", ["ghl", "telegram", "ga4", "facebook_dataset", "facebook"]),
    ]);

    if (appSettingsResult.error) {
        res.status(500).json({ message: appSettingsResult.error.message });
        return;
    }
    if (integrationSettingsResult.error) {
        res.status(500).json({ message: integrationSettingsResult.error.message });
        return;
    }

    const appSettings = appSettingsResult.data?.[0] ?? null;
    const gtmContainerId = appSettings?.gtm_container_id?.trim()
        ? appSettings.gtm_container_id.trim().toUpperCase()
        : null;
    const gtmEnabled = Boolean(appSettings?.gtm_enabled);
    const gtmActive = Boolean(gtmEnabled && gtmContainerId && GTM_CONTAINER_ID_REGEX.test(gtmContainerId));

    const byType = pickLatestIntegrationRows((integrationSettingsResult.data || []) as Array<Record<string, any>>);

    const ghlSettings = byType.ghl || null;
    const ghlConfigured = Boolean(ghlSettings?.api_key && ghlSettings?.location_id);
    const ghlEnabled = Boolean(ghlSettings?.enabled && ghlConfigured);

    const telegramSettings = byType.telegram || null;
    const telegramMeta = parseTelegramMetadata(telegramSettings?.custom_field_mappings);
    const telegramConfigured = Boolean(telegramSettings?.api_key && telegramMeta.chat_ids.length > 0);
    const telegramEnabled = Boolean(telegramSettings?.enabled && telegramConfigured);

    const ga4Settings = byType.ga4 || null;
    const ga4Configured = Boolean(ga4Settings?.api_key && ga4Settings?.location_id);
    const ga4Enabled = Boolean(ga4Settings?.enabled && ga4Configured);

    const facebookSettings = byType.facebook_dataset || byType.facebook || null;
    const facebookDatasetConfigured = Boolean(facebookSettings?.api_key && facebookSettings?.location_id);
    const facebookDatasetEnabled = Boolean(facebookSettings?.enabled && facebookDatasetConfigured);

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
        ga4_enabled: ga4Enabled,
        ga4_configured: ga4Configured,
        facebook_dataset_enabled: facebookDatasetEnabled,
        facebook_dataset_configured: facebookDatasetConfigured,
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
    const { row: ghlSettings, error } = await getLatestIntegrationSetting(sb, "ghl");

    if (error) {
        res.status(500).json({ message: error.message || "Failed to read GHL settings" });
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
    const enabled = Boolean(settings.enabled && configured);

    res.json(adminGHLStatusSchema.parse({
        configured,
        enabled,
        api_key_masked: maskGHLApiKey(settings.api_key),
        location_id: settings.location_id || null,
        custom_field_mappings: parseStringRecord(settings.custom_field_mappings),
        last_sync_at: settings.last_sync_at || null,
        connection_status: toConnectionStatus(configured, enabled),
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

    const { row: existing, error: existingError } = await getLatestIntegrationSetting(
        sb,
        "ghl",
        "id, enabled, api_key, location_id, custom_field_mappings"
    );
    if (existingError) {
        res.status(500).json({ message: existingError.message || "Failed to read existing GHL settings" });
        return;
    }

    if (api_key !== undefined && !isLikelyGHLApiKey(api_key)) {
        res.status(400).json({ message: "Invalid API key format" });
        return;
    }

    const targetApiKey = api_key !== undefined ? api_key : (existing?.api_key || "");
    const targetLocationId = location_id !== undefined ? location_id : (existing?.location_id || "");
    const targetEnabled = typeof enabled === "boolean" ? enabled : Boolean(existing?.enabled);
    if (targetEnabled) {
        if (!targetApiKey || !targetLocationId) {
            res.status(400).json({ message: "API key and Location ID are required to enable GHL integration" });
            return;
        }

        const testResult = await testGHLConnection({
            apiKey: targetApiKey,
            locationId: targetLocationId,
        });
        if (!testResult.success) {
            res.status(400).json({ message: testResult.error || "Failed to verify GHL connection before enabling" });
            return;
        }
    }

    const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    };

    if (typeof enabled === "boolean") updateData.enabled = enabled;
    if (api_key !== undefined) updateData.api_key = api_key;
    if (location_id !== undefined) updateData.location_id = location_id;
    if (custom_field_mappings !== undefined) {
        updateData.custom_field_mappings = parseStringRecord(custom_field_mappings);
    }

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
    const enabledState = Boolean(settings.enabled && configured);

    res.json({
        configured,
        enabled: enabledState,
        api_key_masked: maskGHLApiKey(settings.api_key),
        location_id: settings.location_id,
        custom_field_mappings: parseStringRecord(settings.custom_field_mappings),
        last_sync_at: settings.last_sync_at,
        connection_status: toConnectionStatus(configured, enabledState),
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
    const { row: ghlSettings, error: settingsError } = await getLatestIntegrationSetting(
        sb,
        "ghl",
        "api_key, location_id"
    );
    if (settingsError) {
        res.status(500).json({
            success: false,
            message: settingsError.message || "Failed to read GHL settings",
        });
        return;
    }

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
    const { row: ghlSettings, error: settingsError } = await getLatestIntegrationSetting(
        sb,
        "ghl",
        "api_key, location_id"
    );

    if (settingsError) {
        console.error("GHL custom fields: Failed to read settings:", settingsError);
        res.status(500).json({
            message: "Failed to read GHL settings",
            error: settingsError.message
        });
        return;
    }

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
        console.error("GHL custom fields fetch failed:", result.error);
        res.status(400).json({
            message: result.error,
            hint: "Make sure you're using the Location ID (not Company ID). Find it in GHL URL or Settings > Business Profile"
        });
        return;
    }

    res.json({ customFields: result.fields });
});

/**
 * GET /api/admin/ga4
 * Get current GA4 integration settings
 */
router.get("/api/admin/ga4", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const { data: settings, error } = await sb
        .from("integration_settings")
        .select("*")
        .eq("integration_type", "ga4")
        .maybeSingle();

    if (error && error.code !== "PGRST116") {
        res.status(500).json({ message: error.message });
        return;
    }

    const current = settings || { enabled: false, api_key: null, location_id: null, last_sync_at: null };
    const configured = Boolean(current.api_key && current.location_id);
    const enabled = Boolean(current.enabled && configured);

    res.json(adminGA4StatusSchema.parse({
        configured,
        enabled,
        measurement_id: current.location_id || null,
        api_secret_masked: maskSecret(current.api_key),
        last_tested_at: current.last_sync_at || null,
        connection_status: toConnectionStatus(configured, enabled),
    }));
});

/**
 * PUT /api/admin/ga4
 * Save GA4 integration settings
 */
router.put("/api/admin/ga4", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = saveGA4SettingsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
        return;
    }

    const { enabled, measurement_id, api_secret } = parseResult.data;
    const sb = createAdminSupabase();
    const { data: existing } = await sb
        .from("integration_settings")
        .select("id")
        .eq("integration_type", "ga4")
        .maybeSingle();

    const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    };
    if (typeof enabled === "boolean") updateData.enabled = enabled;
    if (measurement_id !== undefined) updateData.location_id = measurement_id;
    if (api_secret !== undefined) updateData.api_key = api_secret;

    const result = existing?.id
        ? await sb.from("integration_settings").update(updateData).eq("id", existing.id).select("*").single()
        : await sb.from("integration_settings").insert({ integration_type: "ga4", ...updateData }).select("*").single();

    if (result.error) {
        res.status(500).json({ message: result.error.message });
        return;
    }

    const settings = result.data;
    const configured = Boolean(settings.api_key && settings.location_id);
    const enabledState = Boolean(settings.enabled && configured);

    res.json(adminGA4StatusSchema.parse({
        configured,
        enabled: enabledState,
        measurement_id: settings.location_id || null,
        api_secret_masked: maskSecret(settings.api_key),
        last_tested_at: settings.last_sync_at || null,
        connection_status: toConnectionStatus(configured, enabledState),
    }));
});

/**
 * POST /api/admin/ga4/test
 * Tests GA4 credentials
 */
router.post("/api/admin/ga4/test", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = testGA4RequestSchema.safeParse(req.body || {});
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
        return;
    }

    const sb = createAdminSupabase();
    const { data: settings } = await sb
        .from("integration_settings")
        .select("id, api_key, location_id")
        .eq("integration_type", "ga4")
        .maybeSingle();

    const measurementId = parseResult.data.measurement_id || settings?.location_id || null;
    const apiSecret = parseResult.data.api_secret || settings?.api_key || null;

    if (!measurementId || !apiSecret) {
        res.status(400).json({ success: false, message: "Measurement ID and API Secret are required" });
        return;
    }

    const testResult = await sendGa4TestEvent(measurementId, apiSecret);
    if (!testResult.success) {
        res.status(400).json({ success: false, message: testResult.message });
        return;
    }

    if (settings?.id) {
        await sb.from("integration_settings").update({
            last_sync_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }).eq("id", settings.id);
    }

    res.json({ success: true, message: "Connection successful" });
});

/**
 * GET /api/admin/facebook-dataset
 * Get current Facebook Dataset integration settings
 */
router.get("/api/admin/facebook-dataset", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const { data: settings } = await sb
        .from("integration_settings")
        .select("*")
        .in("integration_type", ["facebook_dataset", "facebook"])
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

    const current = settings || { enabled: false, api_key: null, location_id: null, custom_field_mappings: {}, last_sync_at: null };
    const metadata = parseFacebookDatasetMetadata(current.custom_field_mappings);
    const configured = Boolean(current.api_key && current.location_id);
    const enabled = Boolean(current.enabled && configured);

    res.json(adminFacebookDatasetStatusSchema.parse({
        configured,
        enabled,
        dataset_id: current.location_id || null,
        access_token_masked: maskSecret(current.api_key),
        test_event_code: metadata.test_event_code,
        last_tested_at: current.last_sync_at || null,
        connection_status: toConnectionStatus(configured, enabled),
    }));
});

/**
 * PUT /api/admin/facebook-dataset
 * Save Facebook Dataset integration settings
 */
router.put("/api/admin/facebook-dataset", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = saveFacebookDatasetSettingsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
        return;
    }

    const { enabled, dataset_id, access_token, test_event_code } = parseResult.data;
    const sb = createAdminSupabase();
    const { data: existing } = await sb
        .from("integration_settings")
        .select("*")
        .in("integration_type", ["facebook_dataset", "facebook"])
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

    const existingMeta = parseFacebookDatasetMetadata(existing?.custom_field_mappings);
    const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        custom_field_mappings: {
            test_event_code: test_event_code === undefined ? existingMeta.test_event_code : (test_event_code || null),
        },
    };

    if (typeof enabled === "boolean") updateData.enabled = enabled;
    if (dataset_id !== undefined) updateData.location_id = dataset_id;
    if (access_token !== undefined) updateData.api_key = access_token;

    if (existing?.integration_type && existing.integration_type !== "facebook_dataset") {
        updateData.integration_type = "facebook_dataset";
    }

    const result = existing?.id
        ? await sb.from("integration_settings").update(updateData).eq("id", existing.id).select("*").single()
        : await sb.from("integration_settings").insert({ integration_type: "facebook_dataset", ...updateData }).select("*").single();

    if (result.error) {
        res.status(500).json({ message: result.error.message });
        return;
    }

    const settings = result.data;
    const metadata = parseFacebookDatasetMetadata(settings.custom_field_mappings);
    const configured = Boolean(settings.api_key && settings.location_id);
    const enabledState = Boolean(settings.enabled && configured);

    res.json(adminFacebookDatasetStatusSchema.parse({
        configured,
        enabled: enabledState,
        dataset_id: settings.location_id || null,
        access_token_masked: maskSecret(settings.api_key),
        test_event_code: metadata.test_event_code,
        last_tested_at: settings.last_sync_at || null,
        connection_status: toConnectionStatus(configured, enabledState),
    }));
});

/**
 * POST /api/admin/facebook-dataset/test
 * Tests Facebook Dataset credentials
 */
router.post("/api/admin/facebook-dataset/test", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = testFacebookDatasetRequestSchema.safeParse(req.body || {});
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
        return;
    }

    const sb = createAdminSupabase();
    const { data: settings } = await sb
        .from("integration_settings")
        .select("*")
        .in("integration_type", ["facebook_dataset", "facebook"])
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

    const metadata = parseFacebookDatasetMetadata(settings?.custom_field_mappings);
    const datasetId = parseResult.data.dataset_id || settings?.location_id || null;
    const accessToken = parseResult.data.access_token || settings?.api_key || null;
    const testEventCode = parseResult.data.test_event_code === undefined
        ? metadata.test_event_code
        : (parseResult.data.test_event_code || null);

    if (!datasetId || !accessToken) {
        res.status(400).json({ success: false, message: "Dataset ID and Access Token are required" });
        return;
    }

    const testResult = await sendFacebookDatasetTestEvent(datasetId, accessToken, testEventCode);
    if (!testResult.success) {
        res.status(400).json({ success: false, message: testResult.message });
        return;
    }

    if (settings?.id) {
        await sb.from("integration_settings").update({
            last_sync_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }).eq("id", settings.id);
    }

    res.json({ success: true, message: "Connection successful" });
});

/**
 * GET /api/admin/marketing-events
 * Returns saved marketing event deliveries
 */
router.get("/api/admin/marketing-events", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const requestedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const requestedLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const sb = createAdminSupabase();
    const { count, error: countError } = await sb
        .from("marketing_events")
        .select("id", { count: "exact", head: true });
    if (countError) {
        if (String(countError.code || "") === "42P01") {
            res.json(adminMarketingEventsResponseSchema.parse({ events: [], totalCount: 0 }));
            return;
        }
        const message = String(countError.message || "").toLowerCase();
        if (message.includes("public.marketing_events")) {
            res.json(adminMarketingEventsResponseSchema.parse({ events: [], totalCount: 0 }));
            return;
        }
        res.status(500).json({ message: countError.message });
        return;
    }

    const { data: events, error: eventsError } = await sb
        .from("marketing_events")
        .select("id, event_key, event_name, event_source, user_id, email, event_payload, ga4_status, ga4_response, facebook_status, facebook_response, processed_at, created_at")
        .order("created_at", { ascending: false })
        .range(from, to);
    if (eventsError) {
        if (String(eventsError.code || "") === "42P01") {
            res.json(adminMarketingEventsResponseSchema.parse({ events: [], totalCount: 0 }));
            return;
        }
        const message = String(eventsError.message || "").toLowerCase();
        if (message.includes("public.marketing_events")) {
            res.json(adminMarketingEventsResponseSchema.parse({ events: [], totalCount: 0 }));
            return;
        }
        res.status(500).json({ message: eventsError.message });
        return;
    }

    res.json(adminMarketingEventsResponseSchema.parse({
        events: events || [],
        totalCount: count || 0,
    }));
});

/**
 * GET /api/admin/telegram
 * Get current Telegram integration settings (with masked bot token)
 */
router.get("/api/admin/telegram", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const sb = createAdminSupabase();
    const {
        row: telegramSettings,
        error,
    } = await getLatestIntegrationSetting(sb, "telegram");
    if (error) {
        res.status(500).json({ message: error.message || "Failed to read Telegram settings" });
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
    const enabledState = Boolean(settings.enabled && configured);

    res.json(adminTelegramStatusSchema.parse({
        configured,
        enabled: enabledState,
        bot_token_masked: maskTelegramBotToken(settings.api_key),
        chat_ids: metadata.chat_ids,
        notify_on_new_signup: metadata.notify_on_new_signup,
        last_tested_at: settings.last_sync_at || null,
        connection_status: toConnectionStatus(configured, enabledState),
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

    const { enabled, bot_token, chat_ids, notify_on_new_signup } = parseResult.data;
    const sb = createAdminSupabase();
    const {
        row: existing,
        error: existingError,
    } = await getLatestIntegrationSetting(sb, "telegram");
    if (existingError) {
        res.status(500).json({ message: existingError.message || "Failed to read Telegram settings" });
        return;
    }

    const existingMeta = parseTelegramMetadata(existing?.custom_field_mappings);
    const newMeta = {
        chat_ids: chat_ids ? normalizeTelegramChatIds(chat_ids) : existingMeta.chat_ids,
        notify_on_new_signup: notify_on_new_signup ?? existingMeta.notify_on_new_signup,
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
    const enabledState = Boolean(settings.enabled && configured);

    res.json(adminTelegramStatusSchema.parse({
        configured,
        enabled: enabledState,
        bot_token_masked: maskTelegramBotToken(settings.api_key),
        chat_ids: metadata.chat_ids,
        notify_on_new_signup: metadata.notify_on_new_signup,
        last_tested_at: settings.last_sync_at || null,
        connection_status: toConnectionStatus(configured, enabledState),
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
    const {
        row: existing,
        error: existingError,
    } = await getLatestIntegrationSetting(sb, "telegram");
    if (existingError) {
        res.status(500).json({ message: existingError.message || "Failed to read Telegram settings" });
        return;
    }

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

/**
 * POST /api/telegram/notify-signup
 * Sends a one-time Telegram alert when a user account is created.
 */
router.post("/api/telegram/notify-signup", async (req: Request, res: Response): Promise<void> => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
        res.status(401).json({ message: "Authentication required" });
        return;
    }

    const userSupabase = createServerSupabase(token);
    const {
        data: { user },
        error: userError,
    } = await userSupabase.auth.getUser(token);

    if (userError || !user) {
        res.status(401).json({ message: "Invalid authentication" });
        return;
    }

    const createdAtMs = Date.parse(user.created_at || "");
    const lastSignInAtMs = Date.parse(user.last_sign_in_at || "");
    const looksLikeNewSignup = Number.isFinite(createdAtMs)
        && Number.isFinite(lastSignInAtMs)
        && Math.abs(lastSignInAtMs - createdAtMs) <= 10 * 60 * 1000;

    if (!looksLikeNewSignup) {
        res.json({ success: true, skipped: true, reason: "not_new_signup" });
        return;
    }

    const provider = String(user.app_metadata?.provider || "email");
    const providerList = Array.isArray(user.app_metadata?.providers)
        ? (user.app_metadata?.providers as unknown[])
            .map((p) => String(p || "").trim())
            .filter(Boolean)
            .join(", ")
        : provider;

    void trackMarketingEvent({
        event_name: "CompleteRegistration",
        event_key: `signup:${user.id}`,
        event_source: "auth",
        user_id: user.id,
        email: user.email || null,
        event_payload: {
            provider: providerList || provider,
            created_at: user.created_at || new Date().toISOString(),
        },
        event_source_url: getRequestSourceUrl(req),
        ip_address: getRequestIp(req),
        user_agent: safeTrimmed(req.get("user-agent")),
    }).catch((error) => {
        console.error("Marketing signup tracking failed:", error);
    });

    const sb = createAdminSupabase();
    const {
        row: telegramSettings,
        error: telegramSettingsError,
    } = await getLatestIntegrationSetting(sb, "telegram", "id, enabled, api_key, custom_field_mappings");
    if (telegramSettingsError) {
        console.error("Telegram signup notification skipped: failed to read integration settings", telegramSettingsError.message);
        res.json({ success: true, skipped: true, reason: "settings_read_failed" });
        return;
    }

    const metadata = parseTelegramMetadata(telegramSettings?.custom_field_mappings);
    const isEnabled = Boolean(telegramSettings?.enabled);
    const botToken = telegramSettings?.api_key || "";
    const hasToken = Boolean(botToken);
    const hasChats = metadata.chat_ids.length > 0;
    const notifyOnNewSignup = metadata.notify_on_new_signup;

    if (!isEnabled || !hasToken || !hasChats || !notifyOnNewSignup) {
        res.json({ success: true, skipped: true });
        return;
    }

    const { data: insertedDelivery, error: insertDeliveryError } = await sb
        .from("integration_event_deliveries")
        .insert({
            integration_type: "telegram",
            event_type: "new_signup",
            subject_id: user.id,
        })
        .select("id")
        .maybeSingle();

    if (insertDeliveryError) {
        if (insertDeliveryError.code === "23505") {
            res.json({ success: true, skipped: true, reason: "already_notified" });
            return;
        }
        res.status(500).json({ message: insertDeliveryError.message || "Failed to track signup notification" });
        return;
    }

    if (!insertedDelivery?.id) {
        res.json({ success: true, skipped: true, reason: "already_notified" });
        return;
    }

    const { data: profile } = await sb
        .from("profiles")
        .select("referred_by_affiliate_id, created_at")
        .eq("id", user.id)
        .maybeSingle();

    const lines = [
        "<b>New user signup</b>",
        `Email: <code>${escapeHtml(user.email || "unknown")}</code>`,
        `User ID: <code>${escapeHtml(user.id)}</code>`,
        `Provider: <code>${escapeHtml(providerList || provider)}</code>`,
        `Created at: <code>${escapeHtml(user.created_at || profile?.created_at || new Date().toISOString())}</code>`,
    ];

    if (profile?.referred_by_affiliate_id) {
        lines.push(`Affiliate referrer: <code>${escapeHtml(profile.referred_by_affiliate_id)}</code>`);
    }

    const sendResult = await sendTelegramMessageToMany(
        botToken,
        metadata.chat_ids,
        lines.join("\n"),
    );

    if (sendResult.sent.length === 0) {
        await sb.from("integration_event_deliveries").delete().eq("id", insertedDelivery.id);
        res.status(400).json({
            success: false,
            message: sendResult.failed[0]?.error || "Failed to send Telegram signup notification",
        });
        return;
    }

    res.json({
        success: true,
        sent: sendResult.sent,
        failed: sendResult.failed,
    });
});

// ── Client-side Marketing Event Routes ─────────────────────────────────────────

/**
 * POST /api/marketing/view-content
 * Track ViewContent event when user views a post
 */
router.post("/api/marketing/view-content", async (req: Request, res: Response): Promise<void> => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
        res.status(401).json({ message: "Authentication required" });
        return;
    }

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        res.status(401).json({ message: "Invalid authentication" });
        return;
    }

    const { post_id, content_type, content_name, fbc, fbp } = req.body || {};

    if (!post_id) {
        res.status(400).json({ message: "post_id is required" });
        return;
    }

    void trackMarketingEvent({
        event_name: "ViewContent",
        event_key: `view:${post_id}:${user.id}`,
        event_source: "app",
        user_id: user.id,
        email: user.email || null,
        user_data: {
            fbc: fbc || null,
            fbp: fbp || null,
        },
        event_payload: {
            content_type: content_type || "post",
            content_name: content_name || `Post ${post_id}`,
            post_id,
        },
        event_source_url: getRequestSourceUrl(req),
        ip_address: getRequestIp(req),
        user_agent: safeTrimmed(req.get("user-agent")),
    }).catch((error) => {
        console.error("ViewContent tracking failed:", error);
    });

    res.json({ success: true });
});

/**
 * POST /api/marketing/lead
 * Track Lead event (e.g., brand onboarding completion)
 */
router.post("/api/marketing/lead", async (req: Request, res: Response): Promise<void> => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
        res.status(401).json({ message: "Authentication required" });
        return;
    }

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        res.status(401).json({ message: "Invalid authentication" });
        return;
    }

    const parseResult = marketingLeadTrackRequestSchema.safeParse(req.body || {});
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
        return;
    }
    const { content_name, content_category, fbc, fbp } = parseResult.data;

    void trackMarketingEvent({
        event_name: "Lead",
        event_key: `lead:${user.id}`,
        event_source: "app",
        user_id: user.id,
        email: user.email || null,
        user_data: {
            fbc: fbc || null,
            fbp: fbp || null,
        },
        event_payload: {
            content_name: content_name || "Brand Setup",
            content_category: content_category || "Onboarding",
        },
        event_source_url: getRequestSourceUrl(req),
        ip_address: getRequestIp(req),
        user_agent: safeTrimmed(req.get("user-agent")),
    }).catch((error) => {
        console.error("Lead tracking failed:", error);
    });

    void syncLeadToGHL({ user, body: parseResult.data }).catch((error) => {
        console.error("GHL lead sync failed:", error);
    });

    res.json({ success: true });
});

/**
 * POST /api/marketing/initiate-checkout
 * Track InitiateCheckout event when user opens credit purchase dialog
 */
router.post("/api/marketing/initiate-checkout", async (req: Request, res: Response): Promise<void> => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
        res.status(401).json({ message: "Authentication required" });
        return;
    }

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        res.status(401).json({ message: "Invalid authentication" });
        return;
    }

    const { value, currency, content_name, fbc, fbp } = req.body || {};

    void trackMarketingEvent({
        event_name: "InitiateCheckout",
        event_key: `checkout:initiate:${user.id}:${Date.now()}`,
        event_source: "app",
        user_id: user.id,
        email: user.email || null,
        user_data: {
            fbc: fbc || null,
            fbp: fbp || null,
        },
        event_payload: {
            content_name: content_name || "Credit Purchase",
        },
        value: typeof value === "number" ? value : undefined,
        currency: currency || "USD",
        event_source_url: getRequestSourceUrl(req),
        ip_address: getRequestIp(req),
        user_agent: safeTrimmed(req.get("user-agent")),
    }).catch((error) => {
        console.error("InitiateCheckout tracking failed:", error);
    });

    res.json({ success: true });
});

export default router;
