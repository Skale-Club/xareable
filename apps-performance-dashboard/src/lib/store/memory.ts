import type { Snapshot } from "@/lib/types";
import type { MetricsStore } from "@/lib/store/types";

/**
 * In-memory ring buffer (v1). Holds the latest snapshot plus a short recent
 * history for sparklines/trends. History resets on redeploy — acceptable for
 * v1; it becomes durable when the Supabase store is wired (see store/index.ts).
 */
const DEFAULT_CAPACITY = 240; // ~80 minutes of history at a 20s refresh

export class InMemoryMetricsStore implements MetricsStore {
  private readonly capacity: number;
  private buffer: Snapshot[] = [];

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  async save(snapshot: Snapshot): Promise<void> {
    this.buffer.push(snapshot);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
  }

  async latest(): Promise<Snapshot | null> {
    return this.buffer.at(-1) ?? null;
  }

  async recent(limit: number): Promise<Snapshot[]> {
    if (limit <= 0) return [];
    return this.buffer.slice(-limit).reverse();
  }
}
