/**
 * Server-side runtime configuration.
 *
 * Design rule: missing optional inputs (Coolify token B2, Netdata B1, auth B4)
 * must NEVER throw. The app boots in a degraded state and the UI reports what
 * is unconfigured, so the scaffold is fully runnable before the blockers clear.
 */

function str(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function num(value: string | undefined, fallback: number): number {
  const s = str(value);
  if (s === undefined) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export interface AppConfig {
  coolify: { base: string; token: string | undefined; configured: boolean };
  netdata: { base: string };
  disk: { limitGb: number; warnPct: number; critPct: number };
  probe: { timeoutMs: number; concurrency: number };
  snapshot: { cacheTtlMs: number };
  ui: { refreshIntervalMs: number; slowLatencyMs: number };
  auth: { basicAuth: string | undefined; enabled: boolean };
  supabase: { url: string | undefined; serviceRoleKey: string | undefined; configured: boolean };
}

function build(): AppConfig {
  const env = process.env;
  const token = str(env.COOLIFY_TOKEN);
  const basicAuth = str(env.DASHBOARD_BASIC_AUTH);
  const supabaseUrl = str(env.SUPABASE_URL);
  const supabaseServiceRoleKey = str(env.SUPABASE_SERVICE_ROLE_KEY);

  return {
    coolify: {
      base: trimTrailingSlash(str(env.COOLIFY_BASE) ?? "https://coolify.skale.club/api/v1"),
      token,
      configured: token !== undefined,
    },
    netdata: {
      base: trimTrailingSlash(str(env.NETDATA_BASE) ?? "http://127.0.0.1:19999"),
    },
    disk: {
      limitGb: num(env.DISK_LIMIT_GB, 80),
      warnPct: num(env.DISK_WARN_PCT, 75),
      critPct: num(env.DISK_CRIT_PCT, 85),
    },
    probe: {
      timeoutMs: num(env.PROBE_TIMEOUT_MS, 5000),
      concurrency: num(env.PROBE_CONCURRENCY, 8),
    },
    snapshot: {
      cacheTtlMs: num(env.SNAPSHOT_CACHE_TTL_MS, 10000),
    },
    ui: {
      refreshIntervalMs: num(env.REFRESH_INTERVAL_MS, 20000),
      slowLatencyMs: num(env.SLOW_LATENCY_MS, 1500),
    },
    auth: {
      basicAuth,
      enabled: basicAuth !== undefined,
    },
    supabase: {
      url: supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      configured: supabaseUrl !== undefined && supabaseServiceRoleKey !== undefined,
    },
  };
}

export const config: AppConfig = build();
