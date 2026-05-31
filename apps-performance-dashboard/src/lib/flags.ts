import { config } from "@/lib/config";
import type { Flag, FlagSeverity, InventoryItem, ServerHealth } from "@/lib/types";

/**
 * Decision-support layer (Final Spec §2.4): surface what needs attention —
 * down / slow / erroring apps, and server pressure (esp. disk near the 80GB
 * prune threshold). Pure function over the snapshot — trivial to unit test.
 */

const SEVERITY_ORDER: Record<FlagSeverity, number> = { critical: 0, warn: 1, info: 2 };

export function computeFlags(inventory: InventoryItem[], server: ServerHealth): Flag[] {
  const flags: Flag[] = [];

  for (const item of inventory) {
    // Probes are only meaningful for apps that expose a domain.
    if (item.kind !== "application") continue;

    if (item.health === "down") {
      flags.push({
        severity: "critical",
        category: "app-down",
        subject: item.name,
        message: `${item.name} is down${item.probe?.error ? ` (${item.probe.error})` : ""}.`,
      });
      continue;
    }

    if (item.health === "degraded") {
      flags.push({
        severity: "warn",
        category: "app-error",
        subject: item.name,
        message: `${item.name} answers HTTP but Coolify reports it not running.`,
      });
    }

    const probe = item.probe;
    if (probe) {
      if (probe.statusCode !== null && probe.statusCode >= 400) {
        flags.push({
          severity: "warn",
          category: "app-error",
          subject: item.name,
          message: `${item.name} returned HTTP ${probe.statusCode}.`,
        });
      }
      if (probe.latencyMs !== null && probe.latencyMs > config.ui.slowLatencyMs) {
        flags.push({
          severity: "warn",
          category: "app-slow",
          subject: item.name,
          message: `${item.name} is slow — ${probe.latencyMs}ms (> ${config.ui.slowLatencyMs}ms).`,
        });
      }
    }
  }

  if (server.available) {
    if (server.diskPct !== null) {
      if (server.diskPct >= config.disk.critPct) {
        flags.push({
          severity: "critical",
          category: "disk",
          subject: "server",
          message: `Disk at ${server.diskPct}% of ${server.diskLimitGb}GB (critical ≥ ${config.disk.critPct}%).`,
        });
      } else if (server.diskPct >= config.disk.warnPct) {
        flags.push({
          severity: "warn",
          category: "disk",
          subject: "server",
          message: `Disk at ${server.diskPct}% of ${server.diskLimitGb}GB (warn ≥ ${config.disk.warnPct}%).`,
        });
      }
    }
    if (server.ramPct !== null) {
      if (server.ramPct >= 90) {
        flags.push({ severity: "critical", category: "ram", subject: "server", message: `RAM at ${server.ramPct}%.` });
      } else if (server.ramPct >= 75) {
        flags.push({ severity: "warn", category: "ram", subject: "server", message: `RAM at ${server.ramPct}%.` });
      }
    }
    if (server.cpuPct !== null && server.cpuPct >= 90) {
      flags.push({ severity: "warn", category: "cpu", subject: "server", message: `CPU at ${server.cpuPct}%.` });
    }
  }

  return flags.sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  );
}
