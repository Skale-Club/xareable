import { config } from "@/lib/config";
import { InMemoryMetricsStore } from "@/lib/store/memory";
import type { MetricsStore } from "@/lib/store/types";

export type { MetricsStore } from "@/lib/store/types";

/**
 * Process-singleton store. Kept on globalThis so the history buffer survives
 * module re-evaluation (e.g. Next.js dev HMR) within one server process.
 */
declare global {
  // eslint-disable-next-line no-var
  var __metricsStore: MetricsStore | undefined;
}

function create(): MetricsStore {
  if (config.supabase.configured) {
    // DEFERRED (owner instruction "leave it ready for Supabase"): when
    // SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present, construct a
    // SupabaseMetricsStore here so snapshot history is durable across
    // redeploys. It only needs to implement the MetricsStore interface.
    // Until that lands we fall back to memory and make the gap loud.
    console.warn(
      "[store] Supabase env detected, but SupabaseMetricsStore is not implemented yet — using in-memory store.",
    );
  }
  return new InMemoryMetricsStore();
}

export function getStore(): MetricsStore {
  if (!globalThis.__metricsStore) {
    globalThis.__metricsStore = create();
  }
  return globalThis.__metricsStore;
}
