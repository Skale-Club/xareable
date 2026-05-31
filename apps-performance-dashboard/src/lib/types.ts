/**
 * The single normalized snapshot model the collector produces and the UI
 * consumes. Everything the dashboard shows is derived from a `Snapshot`.
 */

export type AppHealth = "up" | "down" | "degraded" | "unknown";

export type CoolifyResourceKind = "application" | "service" | "database";

export interface ProbeResult {
  url: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string; // ISO-8601
}

export interface InventoryItem {
  /** Coolify uuid — the stable identity used as the React key. */
  uuid: string;
  name: string;
  kind: CoolifyResourceKind;
  /** Raw Coolify status string, untouched. */
  rawStatus: string | null;
  /** Normalized running state derived from rawStatus (null = unknown). */
  running: boolean | null;
  fqdns: string[];
  gitRepository: string | null;
  gitBranch: string | null;
  buildPack: string | null;
  /** Live HTTP probe of the primary fqdn (applications with a domain only). */
  probe: ProbeResult | null;
  /** Derived health = Coolify status combined with the probe result. */
  health: AppHealth;
}

export interface ServerHealth {
  /** False when Netdata is unreachable/uninstalled (Blocker B1). */
  available: boolean;
  reason: string | null;
  cpuPct: number | null;
  ramPct: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  diskUsedGb: number | null;
  diskTotalGb: number | null;
  /** The host's hard limit (default 80GB) — disk is judged against this. */
  diskLimitGb: number;
  /** Disk used as a percentage of diskLimitGb. */
  diskPct: number | null;
}

export type FlagSeverity = "info" | "warn" | "critical";

export type FlagCategory =
  | "app-down"
  | "app-slow"
  | "app-error"
  | "disk"
  | "ram"
  | "cpu"
  | "coolify"
  | "netdata";

export interface Flag {
  severity: FlagSeverity;
  category: FlagCategory;
  subject: string; // app name, or "server"
  message: string;
}

export interface CoolifyMeta {
  configured: boolean; // is a token present (B2)
  reachable: boolean; // did the last API call succeed
  error: string | null;
  version: string | null;
  counts: { applications: number; services: number; databases: number };
}

export interface Snapshot {
  generatedAt: string; // ISO-8601
  coolify: CoolifyMeta;
  inventory: InventoryItem[];
  server: ServerHealth;
  flags: Flag[];
}
