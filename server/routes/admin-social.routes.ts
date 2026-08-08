/**
 * Admin Social (Zernio Global Mode) Routes
 *
 * Mirrors the requireAdminGuard style used by admin-settings.routes.ts.
 * Manages the single platform-wide Zernio API key + `zernio_global_enabled`
 * toggle described in docs/zernio-social-publishing.md ("Global mode").
 * The key itself is never returned in full — only `maskZernioKey(...)`.
 */

import { Router } from "express";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import { adminZernioSettingsPatchSchema, type AdminZernioSettingsResponse } from "../../shared/schema.js";
import { getPlatformSetting, setPlatformSetting, getSiteOrigin } from "../services/app-settings.service.js";
import { verifyZernioKey } from "../lib/zernio.js";
import {
    getGlobalZernioConfig,
    maskZernioKey,
    generateWebhookSecret,
    ensureZernioWebhook,
    PLATFORM_KEY_ZERNIO_API,
    PLATFORM_KEY_ZERNIO_ENABLED,
    PLATFORM_KEY_ZERNIO_WEBHOOK_SECRET,
} from "../services/zernio-credentials.service.js";

const router = Router();

/** Strip one layer of surrounding quotes — same defensive unquote house pattern as zernio-credentials.service.ts. */
function unquoteSetting(raw: string | null): string | null {
    if (raw == null) return null;
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        return raw.slice(1, -1);
    }
    return raw;
}

async function buildZernioAdminResponse(): Promise<AdminZernioSettingsResponse> {
    const { enabled, apiKey } = await getGlobalZernioConfig();

    let verified = false;
    if (apiKey) {
        try {
            const result = await verifyZernioKey(apiKey);
            verified = result.valid;
        } catch (err) {
            console.error("[admin-social] verifyZernioKey failed:", err instanceof Error ? err.message : err);
            verified = false;
        }
    }

    return { enabled, key_masked: maskZernioKey(apiKey), verified };
}

/**
 * GET /api/admin/social/zernio
 * Returns { enabled, key_masked, verified }. `verified` re-checks the stored
 * key against Zernio on every read (tolerates network errors -> verified:false)
 * so the admin panel reflects reality (e.g. a key revoked Zernio-side) rather
 * than a stale "verified at save time" flag.
 */
router.get("/api/admin/social/zernio", async (req, res) => {
    const guard = await requireAdminGuard(req, res);
    if (!guard) return;

    res.json(await buildZernioAdminResponse());
});

/**
 * PATCH /api/admin/social/zernio
 * Body: { api_key?: string | null, enabled?: boolean }
 *   - api_key: null  -> clear the global key AND force-disable global mode.
 *   - api_key: string -> verify first (400 on invalid), store, ensure the
 *     global webhook secret + registration exist.
 *   - enabled: true  -> rejected (400) unless a global key is already stored.
 */
router.patch("/api/admin/social/zernio", async (req, res) => {
    const guard = await requireAdminGuard(req, res);
    if (!guard) return;

    const parsed = adminZernioSettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
        return;
    }
    const { api_key, enabled } = parsed.data;

    if (api_key === null) {
        await setPlatformSetting(PLATFORM_KEY_ZERNIO_API, '""');
        await setPlatformSetting(PLATFORM_KEY_ZERNIO_ENABLED, "false");
        res.json(await buildZernioAdminResponse());
        return;
    }

    if (typeof api_key === "string") {
        const verification = await verifyZernioKey(api_key);
        if (!verification.valid) {
            res.status(400).json({ message: "Invalid Zernio API key" });
            return;
        }

        await setPlatformSetting(PLATFORM_KEY_ZERNIO_API, JSON.stringify(api_key));

        const existingSecretRaw = await getPlatformSetting(PLATFORM_KEY_ZERNIO_WEBHOOK_SECRET);
        let webhookSecret = unquoteSetting(existingSecretRaw)?.trim() || "";
        if (!webhookSecret) {
            webhookSecret = generateWebhookSecret();
            await setPlatformSetting(PLATFORM_KEY_ZERNIO_WEBHOOK_SECRET, JSON.stringify(webhookSecret));
        }

        await ensureZernioWebhook(api_key, `${getSiteOrigin(req)}/api/social/webhooks/zernio/global`, webhookSecret);
    }

    if (typeof enabled === "boolean") {
        if (enabled) {
            const { apiKey: currentKey } = await getGlobalZernioConfig();
            if (!currentKey) {
                res.status(400).json({ message: "Set a global Zernio API key before enabling global mode." });
                return;
            }
        }
        await setPlatformSetting(PLATFORM_KEY_ZERNIO_ENABLED, JSON.stringify(enabled));
    }

    res.json(await buildZernioAdminResponse());
});

export default router;
