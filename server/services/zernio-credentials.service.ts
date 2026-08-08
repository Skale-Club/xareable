/**
 * Zernio credential resolution + provisioning.
 *
 * Implements the credential hierarchy from docs/zernio-social-publishing.md:
 *
 *   1. user_zernio_settings.api_key set                    -> BYOK mode
 *   2. else platform_settings.zernio_global_enabled = true
 *      AND platform_settings.zernio_global_api_key set     -> global mode
 *   3. else                                                 -> social publishing unavailable
 *
 * Also owns the two idempotent provisioning steps that run when a key is
 * saved: making sure a Zernio Profile exists for the caller (BYOK: reuse the
 * default/first profile or create "Xareable"; global: one profile per user
 * named "xareable-<userId>"), and auto-registering the Xareable webhook so
 * publish-status updates flow back without any manual Zernio-side setup.
 */

import { randomBytes } from "node:crypto";
import { createAdminSupabase } from "../supabase.js";
import {
    getPlatformSetting,
    getSecurePlatformSetting,
} from "./app-settings.service.js";
import {
    verifyZernioKey,
    listZernioProfiles,
    createZernioProfile,
    listZernioWebhooks,
    createZernioWebhook,
} from "../lib/zernio.js";

export const PLATFORM_KEY_ZERNIO_API = "zernio_global_api_key";
export const PLATFORM_KEY_ZERNIO_ENABLED = "zernio_global_enabled";
export const PLATFORM_KEY_ZERNIO_WEBHOOK_SECRET = "zernio_global_webhook_secret";

/** Events the Xareable webhook subscribes to on every Zernio workspace it registers against. */
export const ZERNIO_WEBHOOK_EVENTS = [
    "post.published",
    "post.failed",
    "post.partial",
    "post.platform.published",
    "post.platform.failed",
];

/** Thrown (as a plain Error with this message) by saveUserZernioKey when the key fails verification. */
export const INVALID_ZERNIO_KEY_ERROR = "invalid_key";

export type ZernioCredentials = {
    apiKey: string;
    mode: "byok" | "global";
    zernioProfileId: string | null;
};

export interface UserZernioSettingsRow {
    user_id: string;
    api_key: string | null;
    zernio_profile_id: string | null;
    global_zernio_profile_id: string | null;
    webhook_secret: string | null;
    created_at: string;
    updated_at: string;
}

/** Fetch the caller's user_zernio_settings row, or null when they have never set one up. */
export async function getUserZernioSettingsRow(
    userId: string,
): Promise<UserZernioSettingsRow | null> {
    const sb = createAdminSupabase();
    const { data, error } = await sb
        .from("user_zernio_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) throw new Error(`getUserZernioSettingsRow(${userId}): ${error.message}`);
    return (data as UserZernioSettingsRow | null) ?? null;
}

/**
 * `getPlatformSetting` returns jsonb values coerced to a string (see
 * app-settings.service.ts), but a value written elsewhere as an already
 * JSON-stringified string ('"true"', '"sk-..."') would otherwise leak its
 * quotes through. Strip a single layer of surrounding quotes defensively.
 */
function unquote(raw: string | null): string | null {
    if (raw == null) return null;
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        return raw.slice(1, -1);
    }
    return raw;
}

function isTruthySetting(raw: string | null): boolean {
    const unquoted = unquote(raw)?.trim().toLowerCase();
    return unquoted === "true";
}

/**
 * Read the platform-wide ("global mode") Zernio config: enabled flag + key.
 * The flag lives in platform_settings (non-secret, publicly readable table);
 * the KEY lives in platform_secure_settings (service-role only — the
 * platform_settings table has a public-read RLS policy and must never hold
 * secrets).
 */
export async function getGlobalZernioConfig(): Promise<{
    enabled: boolean;
    apiKey: string | null;
}> {
    const [enabledRaw, keyRaw] = await Promise.all([
        getPlatformSetting(PLATFORM_KEY_ZERNIO_ENABLED),
        getSecurePlatformSetting(PLATFORM_KEY_ZERNIO_API),
    ]);

    const apiKey = unquote(keyRaw)?.trim() || null;
    return { enabled: isTruthySetting(enabledRaw), apiKey };
}

/**
 * Resolve which Zernio credentials (if any) a user should publish through.
 * See the module header for the exact hierarchy.
 *
 * TENANT ISOLATION INVARIANT: in global mode zernioProfileId is NEVER null —
 * the per-user profile inside the shared workspace is provisioned eagerly
 * here (and cached on user_zernio_settings.global_zernio_profile_id). Every
 * downstream Zernio call that lists or connects accounts scopes by this
 * profile id; an unscoped call against the shared workspace would expose
 * other customers' accounts.
 */
export async function resolveZernioCredentials(
    userId: string,
): Promise<ZernioCredentials | null> {
    const row = await getUserZernioSettingsRow(userId);

    if (row?.api_key) {
        return {
            apiKey: row.api_key,
            mode: "byok",
            zernioProfileId: row.zernio_profile_id ?? null,
        };
    }

    const global = await getGlobalZernioConfig();
    if (global.enabled && global.apiKey) {
        const zernioProfileId =
            row?.global_zernio_profile_id ??
            (await ensureGlobalZernioProfile(userId, global.apiKey));
        return {
            apiKey: global.apiKey,
            mode: "global",
            zernioProfileId,
        };
    }

    return null;
}

/**
 * BYOK profile resolution: reuse the caller's default profile, else their
 * first profile, else create one named "Xareable".
 */
export async function ensureByokZernioProfile(apiKey: string): Promise<string> {
    const { profiles } = await listZernioProfiles(apiKey);
    const defaultProfile = profiles.find((p) => p.isDefault);
    if (defaultProfile) return defaultProfile._id;
    if (profiles.length > 0) return profiles[0]._id;

    const { profileId } = await createZernioProfile(apiKey, "Xareable");
    return profileId;
}

/**
 * Global-mode profile resolution: one dedicated profile per user inside the
 * shared platform workspace, cached on user_zernio_settings.global_zernio_profile_id
 * so repeated calls don't create duplicate profiles.
 */
export async function ensureGlobalZernioProfile(
    userId: string,
    globalApiKey: string,
): Promise<string> {
    const existing = await getUserZernioSettingsRow(userId);
    if (existing?.global_zernio_profile_id) {
        return existing.global_zernio_profile_id;
    }

    const { profileId } = await createZernioProfile(globalApiKey, `xareable-${userId}`);

    const sb = createAdminSupabase();
    const { error } = await sb.from("user_zernio_settings").upsert(
        {
            user_id: userId,
            global_zernio_profile_id: profileId,
            updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
    );
    if (error) throw new Error(`ensureGlobalZernioProfile(${userId}): ${error.message}`);

    return profileId;
}

/** Random per-user (or per-workspace) secret used to verify inbound webhook HMAC signatures. */
export function generateWebhookSecret(): string {
    return randomBytes(32).toString("hex");
}

/**
 * Make sure a Zernio webhook pointing at `webhookUrl` exists, creating one if
 * not. Never throws — webhook registration must never block a key save, so
 * failures are logged and swallowed.
 */
export async function ensureZernioWebhook(
    apiKey: string,
    webhookUrl: string,
    secret: string,
): Promise<void> {
    try {
        const { webhooks } = await listZernioWebhooks(apiKey);
        if (webhooks.some((w) => w.url === webhookUrl)) return;

        await createZernioWebhook(apiKey, {
            name: "Xareable",
            url: webhookUrl,
            secret,
            events: ZERNIO_WEBHOOK_EVENTS,
        });
    } catch (err) {
        console.error(
            `[zernio-credentials] Failed to register webhook (${webhookUrl}):`,
            err instanceof Error ? err.message : err,
        );
    }
}

/**
 * Save (or update) a user's BYOK Zernio key: verify it, resolve/create their
 * profile, keep or generate their webhook secret, upsert the settings row,
 * then auto-register the Xareable webhook against their workspace.
 */
export async function saveUserZernioKey(
    userId: string,
    apiKey: string,
    appOrigin: string,
): Promise<{ zernioProfileId: string }> {
    const verification = await verifyZernioKey(apiKey);
    if (!verification.valid) {
        throw new Error(INVALID_ZERNIO_KEY_ERROR);
    }

    const zernioProfileId = await ensureByokZernioProfile(apiKey);

    const existingRow = await getUserZernioSettingsRow(userId);
    const webhookSecret = existingRow?.webhook_secret ?? generateWebhookSecret();

    const sb = createAdminSupabase();
    const { error } = await sb.from("user_zernio_settings").upsert(
        {
            user_id: userId,
            api_key: apiKey,
            zernio_profile_id: zernioProfileId,
            webhook_secret: webhookSecret,
            updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
    );
    if (error) throw new Error(`saveUserZernioKey(${userId}): ${error.message}`);

    await ensureZernioWebhook(
        apiKey,
        `${appOrigin}/api/social/webhooks/zernio/${userId}`,
        webhookSecret,
    );

    return { zernioProfileId };
}

/**
 * Clear a user's BYOK key. Profile ids and the webhook secret are kept (so
 * re-adding a key later doesn't re-provision anything Zernio-side), and any
 * BYOK-mode social_accounts cache rows are deactivated since they belonged
 * to the key that just got removed.
 */
export async function clearUserZernioKey(userId: string): Promise<void> {
    const sb = createAdminSupabase();

    const { error: settingsError } = await sb
        .from("user_zernio_settings")
        .update({ api_key: null, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    if (settingsError) {
        throw new Error(`clearUserZernioKey(${userId}): ${settingsError.message}`);
    }

    const { error: accountsError } = await sb
        .from("social_accounts")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("connection_mode", "byok");
    if (accountsError) {
        throw new Error(
            `clearUserZernioKey(${userId}) [deactivate accounts]: ${accountsError.message}`,
        );
    }
}

/** Mask a Zernio key for display: first 8 chars + "..." + last 4. Never returns the full key. */
export function maskZernioKey(key: string | null): string | null {
    if (!key) return null;
    return `${key.slice(0, 8)}...${key.slice(-4)}`;
}
