import { config } from "@/lib/config";
import type { ServerHealth } from "@/lib/types";

/**
 * Netdata client for host CPU / RAM / disk (Final Spec §2.3, §3).
 *
 * BLOCKER B1: Netdata is not yet installed on the host. Until it is, every
 * fetch here fails and `getServerHealth()` returns { available: false } with a
 * reason — the dashboard renders a "metrics unavailable" panel and everything
 * else (Coolify discovery + HTTP probes) keeps working.
 *
 * Disk is judged against the host's hard limit (config.disk.limitGb, default
 * 80GB) — the single most important server metric on the shared host.
 */

interface NetdataDataResponse {
  labels?: string[];
  data?: number[][];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clampPct = (n: number): number => Math.max(0, Math.min(100, round1(n)));

async function fetchChart(chart: string): Promise<NetdataDataResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.probe.timeoutMs);
  try {
    const url = `${config.netdata.base}/api/v1/data?chart=${encodeURIComponent(chart)}&after=-1&points=1&format=json`;
    const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as NetdataDataResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Newest row of a points=1 chart, keyed by dimension label (skips "time"). */
function latestByLabel(resp: NetdataDataResponse | null): Record<string, number> | null {
  if (!resp?.labels || !resp.data || resp.data.length === 0) return null;
  const row = resp.data[0];
  if (!row) return null;
  const out: Record<string, number> = {};
  resp.labels.forEach((label, i) => {
    if (i === 0) return; // labels[0] is the timestamp
    const v = row[i];
    if (typeof v === "number" && Number.isFinite(v)) out[label] = v;
  });
  return out;
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

export async function getServerHealth(): Promise<ServerHealth> {
  const base: ServerHealth = {
    available: false,
    reason: null,
    cpuPct: null,
    ramPct: null,
    ramUsedMb: null,
    ramTotalMb: null,
    diskUsedGb: null,
    diskTotalGb: null,
    diskLimitGb: config.disk.limitGb,
    diskPct: null,
  };

  const [cpuResp, ramResp, diskResp] = await Promise.all([
    fetchChart("system.cpu"),
    fetchChart("system.ram"),
    fetchChart("disk_space./"),
  ]);

  if (!cpuResp && !ramResp && !diskResp) {
    return {
      ...base,
      reason: `Netdata unreachable at ${config.netdata.base} — install Netdata on the host (Blocker B1).`,
    };
  }

  const result: ServerHealth = { ...base, available: true };

  const cpu = latestByLabel(cpuResp);
  if (cpu && typeof cpu.idle === "number") {
    result.cpuPct = clampPct(100 - cpu.idle);
  }

  const ram = latestByLabel(ramResp);
  if (ram && typeof ram.used === "number") {
    const total = sum(Object.values(ram));
    if (total > 0) {
      result.ramUsedMb = Math.round(ram.used);
      result.ramTotalMb = Math.round(total);
      result.ramPct = clampPct((ram.used / total) * 100);
    }
  }

  const disk = latestByLabel(diskResp);
  if (disk && typeof disk.used === "number") {
    result.diskUsedGb = round1(disk.used);
    result.diskPct = clampPct((disk.used / config.disk.limitGb) * 100);
    const total = sum(Object.values(disk)); // avail + used + reserved
    if (total > 0) result.diskTotalGb = round1(total);
  }

  // TODO (post-B1): Netdata's cgroups plugin (cgroup_*.cpu / .mem charts) gives
  // per-container CPU/RAM, letting us attribute resource use per Coolify app.
  return result;
}
