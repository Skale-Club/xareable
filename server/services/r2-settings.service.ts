/**
 * R2 credential resolution.
 *
 * Follows the Phase 12.3 precedent set by the Gemini/OpenRouter platform keys:
 * secrets live in `platform_settings` and are edited in /admin, not baked into
 * the deploy environment. That removes the "set five env vars on the host and
 * redeploy" step entirely — credentials can be rotated from the browser with no
 * deploy at all.
 *
 * Precedence is env-first, DB-second, and deliberately per-field:
 *
 *   - A local .env keeps behaving exactly as before, so dev boxes and the
 *     migration script are unaffected by whatever is in the database.
 *   - Production can leave the env block unset entirely and be configured
 *     through /admin.
 *   - A half-set env (say, only the public base URL) still resolves the rest
 *     from the DB rather than silently disabling storage.
 *
 * Resolution is cached because it sits on the hot path of every upload and
 * every delete. The cache is short-lived AND explicitly invalidated when an
 * admin saves, so a rotated key takes effect immediately rather than after a
 * TTL.
 */

import { config } from "../config/index.js";
import { getPlatformSetting, setPlatformSetting } from "./app-settings.service.js";

export interface R2Settings {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicBaseUrl: string;
}

/** platform_settings keys, paired with the env var that overrides each. */
const FIELDS = [
    { field: "accountId", settingKey: "r2_account_id", env: () => config.R2_ACCOUNT_ID },
    { field: "accessKeyId", settingKey: "r2_access_key_id", env: () => config.R2_ACCESS_KEY_ID },
    {
        field: "secretAccessKey",
        settingKey: "r2_secret_access_key",
        env: () => config.R2_SECRET_ACCESS_KEY,
    },
    { field: "bucket", settingKey: "r2_bucket", env: () => config.R2_BUCKET },
    {
        field: "publicBaseUrl",
        settingKey: "r2_public_base_url",
        env: () => config.R2_PUBLIC_BASE_URL,
    },
] as const;

export const R2_SETTING_KEYS = FIELDS.map((f) => f.settingKey);

/** Cache TTL. Short enough that a missed invalidation self-heals quickly. */
const CACHE_TTL_MS = 30_000;

let cached: { value: R2Settings | null; at: number } | null = null;
let inFlight: Promise<R2Settings | null> | null = null;

/** Drop the cache so the next read re-resolves. Call after any admin write. */
export function invalidateR2SettingsCache(): void {
    cached = null;
    inFlight = null;
}

function normalizeBaseUrl(raw: string): string | null {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed) return null;
    try {
        // Must be an absolute origin; anything else would produce unusable
        // asset URLs that only fail much later, at render time.
        new URL(trimmed);
        return trimmed;
    } catch {
        return null;
    }
}

async function resolve(): Promise<R2Settings | null> {
    const resolved: Record<string, string> = {};

    for (const { field, settingKey, env } of FIELDS) {
        const fromEnv = env();
        let value = typeof fromEnv === "string" ? fromEnv.trim() : "";

        if (!value) {
            try {
                value = (await getPlatformSetting(settingKey))?.trim() ?? "";
            } catch (err) {
                // A settings read failure must not throw on the upload hot
                // path; degrade to "R2 not configured" and let the caller fall
                // back to Supabase Storage.
                console.warn(
                    `[r2-settings] Could not read ${settingKey}:`,
                    err instanceof Error ? err.message : err,
                );
                return null;
            }
        }

        if (!value) return null; // partial config counts as off
        resolved[field] = value;
    }

    const publicBaseUrl = normalizeBaseUrl(resolved.publicBaseUrl);
    if (!publicBaseUrl) {
        console.warn("[r2-settings] r2_public_base_url is not a valid absolute URL — R2 disabled");
        return null;
    }

    return {
        accountId: resolved.accountId,
        accessKeyId: resolved.accessKeyId,
        secretAccessKey: resolved.secretAccessKey,
        bucket: resolved.bucket,
        publicBaseUrl,
    };
}

/**
 * Fully-resolved R2 credentials, or null when storage should fall back to the
 * legacy Supabase bucket. Concurrent callers share one in-flight resolution so
 * a burst of uploads cannot stampede the settings table.
 */
export async function getR2Settings(): Promise<R2Settings | null> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.value;
    }
    if (inFlight) return inFlight;

    inFlight = resolve()
        .then((value) => {
            cached = { value, at: Date.now() };
            return value;
        })
        .finally(() => {
            inFlight = null;
        });

    return inFlight;
}

/** True when uploads should go to R2 rather than the Supabase fallback. */
export async function isR2Enabled(): Promise<boolean> {
    return (await getR2Settings()) !== null;
}

/**
 * Persist one or more R2 credential fields and invalidate the cache.
 * An empty string clears the field, which disables R2 on the next read.
 */
export async function saveR2Settings(
    patch: Partial<Record<(typeof FIELDS)[number]["settingKey"], string>>,
): Promise<void> {
    const writes: Array<Promise<void>> = [];
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
        const value = patch[key];
        if (typeof value === "string") {
            writes.push(setPlatformSetting(key, value.trim()));
        }
    }
    if (writes.length > 0) {
        await Promise.all(writes);
        invalidateR2SettingsCache();
    }
}

/** Which fields are set, and where each came from — for the admin UI. */
export async function describeR2Settings(): Promise<
    Array<{ key: string; configured: boolean; source: "env" | "database" | "unset"; preview: string }>
> {
    const rows = [];
    for (const { settingKey, env } of FIELDS) {
        const fromEnv = (env() ?? "").trim();
        let value = fromEnv;
        let source: "env" | "database" | "unset" = fromEnv ? "env" : "unset";

        if (!value) {
            try {
                const fromDb = (await getPlatformSetting(settingKey))?.trim() ?? "";
                if (fromDb) {
                    value = fromDb;
                    source = "database";
                }
            } catch {
                // Reported as unset rather than failing the admin page.
            }
        }

        // Bucket and public origin are not secrets — show them in full so an
        // admin can actually verify what production is pointing at.
        const isSecret = settingKey === "r2_access_key_id" || settingKey === "r2_secret_access_key";
        const preview = !value
            ? ""
            : isSecret
                ? `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`
                : value;

        rows.push({ key: settingKey, configured: value.length > 0, source, preview });
    }
    return rows;
}
