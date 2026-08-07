import { config } from "@/lib/config";
import type { ProbeResult } from "@/lib/types";

/**
 * Active HTTP probe (Final Spec §2.2): hit each app's fqdn for up/down +
 * response time + HTTP code. Needs no per-app cooperation, so it works for
 * every discovered app and reflects performance "up to the current moment".
 */

export async function probeUrl(url: string, timeoutMs: number = config.probe.timeoutMs): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const checkedAt = new Date().toISOString();
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual", // a 3xx still means the app is answering
      signal: controller.signal,
      cache: "no-store",
      headers: { "user-agent": "apps-performance-dashboard/health-probe" },
    });
    const latencyMs = Math.round(performance.now() - start);
    const ok = res.status >= 200 && res.status < 400;
    return {
      url,
      ok,
      statusCode: res.status,
      latencyMs,
      error: ok ? null : `HTTP ${res.status}`,
      checkedAt,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      url,
      ok: false,
      statusCode: null,
      latencyMs: isTimeout ? null : Math.round(performance.now() - start),
      error: isTimeout ? `timeout after ${timeoutMs}ms` : (err as Error).message,
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe many URLs with a bounded concurrency pool. */
export async function probeAll(
  urls: string[],
  concurrency: number = config.probe.concurrency,
): Promise<Map<string, ProbeResult>> {
  const results = new Map<string, ProbeResult>();
  const queue = [...urls];

  async function worker(): Promise<void> {
    for (;;) {
      const url = queue.shift();
      if (url === undefined) return;
      results.set(url, await probeUrl(url));
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, urls.length || 1));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}
