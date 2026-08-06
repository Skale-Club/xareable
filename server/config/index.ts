import { z } from "zod";

/**
 * Environment variable schema validation
 * Validates all required environment variables at startup
 */

const envSchema = z.object({
    // Required Supabase configuration
    SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
    SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY is required"),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

    // Phase 12.3: Gemini API key migrated to platform_settings.gemini_api_key
    // (managed in /admin → Platform API Keys). This env entry is kept as an
    // optional legacy field for backward compatibility but is NOT read by any
    // active code path. Safe to leave unset.
    GEMINI_API_KEY: z.string().min(1).optional(),

    // Stripe configuration (optional for development)
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

    // Server configuration
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().regex(/^\d+$/).transform(Number).default("5000"),

    // Cron HTTP trigger secret (Phase 14). 32+ chars; suggest `openssl rand -hex 32`.
    // Optional so dev/staging without the var can boot — endpoints reject with 503 if unset.
    CRON_SECRET: z.string().min(32, "CRON_SECRET must be ≥32 chars (use `openssl rand -hex 32`)").optional(),

    // OpenRouter gateway platform key (Phase 21 — GATE-01/02/03). Optional so
    // dev/CI without the var can still boot; gateway calls fail at call-time
    // if unset. Admin can fall back to "direct" per call class via
    // ai_gateway_routing (GATE-07) when this is not yet provisioned.
    OPENROUTER_API_KEY: z.string().min(1).optional(),

    // Public app origin — used for Stripe redirect/return URLs and as the
    // default CORS allow-origin.
    APP_URL: z.string().url("APP_URL must be a valid URL").optional(),

    // Comma-separated CORS allow-list (e.g. "https://xareable.com,https://www.xareable.com").
    // When unset, falls back to APP_URL + localhost dev origins.
    ALLOWED_ORIGINS: z.string().optional(),

    // Optional external error-tracker DSN (Sentry). When set, bootstrap can wire
    // the forwarder in lib/observability; unset = structured console logging only.
    SENTRY_DSN: z.string().optional(),

    // Safety timeout for SSE generation streams, in ms. The 280s default is a
    // holdover from Vercel's serverless kill window; on long-running hosts
    // (Coolify/Hetzner) it can be raised for large carousels. The carousel
    // route aborts 20s earlier than this to leave room for persistence/billing.
    GENERATION_SAFETY_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).optional(),

    // --- Cloudflare R2 object storage (replaces the Supabase `user_assets` bucket) ---
    // All five must be set together for R2 to activate; when any is missing the
    // storage layer falls back to Supabase Storage so dev boxes and the rollback
    // path keep working. See docs/r2-migration.md.
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    // Public origin the bucket is served from, no trailing slash
    // (e.g. https://cdn.xareable.com). This is what lands in the DB as the
    // asset URL, so changing it later means re-running the URL rewrite.
    R2_PUBLIC_BASE_URL: z
        .string()
        .url("R2_PUBLIC_BASE_URL must be a valid URL")
        .refine((v) => !v.endsWith("/"), "R2_PUBLIC_BASE_URL must not end with a slash")
        .optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables
 * Throws an error with details if validation fails
 */
function validateEnv(): EnvConfig {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        const errors = result.error.issues.map(
            (issue) => `  - ${issue.path.join(".")}: ${issue.message}`
        );

        console.error("\n❌ Environment variable validation failed:\n" + errors.join("\n"));
        console.error("\nPlease check your .env file and ensure all required variables are set.\n");

        // In development, allow the app to start with warnings
        // In production, fail fast
        if (process.env.NODE_ENV === "production") {
            process.exit(1);
        }

        // Return a partial config for development
        return {
            SUPABASE_URL: process.env.SUPABASE_URL || "",
            SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
            SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
            NODE_ENV: "development",
            PORT: 5000,
        };
    }

    return result.data;
}

/**
 * Validated configuration object
 * Use this instead of process.env directly
 */
export const config = validateEnv();

/**
 * Check if running in development mode
 */
export const isDevelopment = config.NODE_ENV === "development";

/**
 * Check if running in production mode
 */
export const isProduction = config.NODE_ENV === "production";

/**
 * Check if Gemini API is configured.
 * Phase 12.3: now reads from platform_settings.gemini_api_key (async).
 * The synchronous boolean export below is kept for backward compatibility
 * with admin status endpoints — call hasGeminiKeyConfigured() for the
 * current truth at runtime.
 */
export const hasGeminiKey = Boolean(config.GEMINI_API_KEY);

export async function hasGeminiKeyConfigured(): Promise<boolean> {
    const { getPlatformSetting } = await import("../services/app-settings.service.js");
    const k = await getPlatformSetting("gemini_api_key");
    return Boolean(k && k.trim().length > 0);
}

/**
 * Check if Stripe is fully configured
 */
export const hasStripeConfig = Boolean(
    config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET
);

/**
 * Check if Cloudflare R2 is fully configured.
 * Partial config is treated as "off" on purpose — a half-set bucket would
 * write objects nobody can read back.
 */
export const hasR2Config = Boolean(
    config.R2_ACCOUNT_ID &&
    config.R2_ACCESS_KEY_ID &&
    config.R2_SECRET_ACCESS_KEY &&
    config.R2_BUCKET &&
    config.R2_PUBLIC_BASE_URL
);

/**
 * Log configuration status on startup
 */
export function logConfigStatus(): void {
    console.log("\n📋 Configuration status:");
    console.log(`  Environment: ${config.NODE_ENV}`);
    console.log(`  Port: ${config.PORT}`);
    console.log(`  Supabase URL: ${config.SUPABASE_URL ? "✓ configured" : "✗ missing"}`);
    console.log(`  Gemini API: managed in /admin → Platform API Keys (was env in pre-12.2)`);
    console.log(`  Stripe: ${hasStripeConfig ? "✓ configured" : "⚠ not configured"}`);
    console.log(
        `  Object storage: ${hasR2Config
            ? `✓ Cloudflare R2 (${config.R2_BUCKET} → ${config.R2_PUBLIC_BASE_URL})`
            : "⚠ Supabase Storage fallback — set R2_* to cut over"
        }`,
    );
    if (config.NODE_ENV === "production" && !hasR2Config) {
        console.warn(
            "  ⚠ R2 not configured in production — new uploads will keep landing in Supabase Storage",
        );
    }
    if (config.NODE_ENV === "production" && !config.CRON_SECRET) {
        console.warn(
            "  ⚠ CRON_SECRET not set — HTTP cron triggers will reject all requests with 503",
        );
    }
    console.log("");
}
