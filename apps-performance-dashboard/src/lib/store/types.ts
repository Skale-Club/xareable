import type { Snapshot } from "@/lib/types";

/**
 * Storage contract for snapshots. v1 is in-memory; a Supabase-backed
 * implementation is deferred but only has to satisfy this same interface
 * (Final Spec §4 — "drop-in later").
 */
export interface MetricsStore {
  /** Persist the latest snapshot and append it to recent history. */
  save(snapshot: Snapshot): Promise<void>;
  /** Most recent snapshot, or null if none has been collected yet. */
  latest(): Promise<Snapshot | null>;
  /** Up to `limit` most-recent snapshots, newest first. */
  recent(limit: number): Promise<Snapshot[]>;
}
