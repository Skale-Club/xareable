import { config } from "@/lib/config";
import { coolify, CoolifyError } from "@/lib/coolify/client";
import { deriveHealth, normalizeInventory } from "@/lib/discovery";
import { getServerHealth } from "@/lib/netdata/client";
import { probeAll } from "@/lib/probe";
import { computeFlags } from "@/lib/flags";
import { getStore } from "@/lib/store";
import type { CoolifyMeta, InventoryItem, Snapshot } from "@/lib/types";

/**
 * The collector assembles one normalized Snapshot from three independent
 * sources, each of which can fail without taking down the others:
 *   1. Coolify discovery (token B2)   → inventory + counts
 *   2. HTTP probes of each app fqdn    → live up/down + latency
 *   3. Netdata (B1)                    → server CPU/RAM/disk
 * A short server-side cache keeps rapid client polls from hammering Coolify.
 */

async function buildCoolifyInventory(): Promise<{ inventory: InventoryItem[]; meta: CoolifyMeta }> {
  const meta: CoolifyMeta = {
    configured: coolify.isConfigured(),
    reachable: false,
    error: null,
    version: null,
    counts: { applications: 0, services: 0, databases: 0 },
  };

  if (!coolify.isConfigured()) {
    meta.error = "COOLIFY_TOKEN not configured (Blocker B2).";
    return { inventory: [], meta };
  }

  try {
    const [applications, services, databases] = await Promise.all([
      coolify.getApplications(),
      coolify.getServices(),
      coolify.getDatabases(),
    ]);
    meta.reachable = true;
    meta.counts = {
      applications: applications.length,
      services: services.length,
      databases: databases.length,
    };
    try {
      meta.version = await coolify.getVersion();
    } catch {
      /* version is best-effort — never fail discovery over it */
    }
    return { inventory: normalizeInventory({ applications, services, databases }), meta };
  } catch (err) {
    meta.error = err instanceof CoolifyError ? `${err.kind}: ${err.message}` : (err as Error).message;
    return { inventory: [], meta };
  }
}

async function probeInventory(inventory: InventoryItem[]): Promise<void> {
  const targets = new Map<string, InventoryItem>(); // primary fqdn → item
  for (const item of inventory) {
    const primary = item.fqdns[0];
    if (item.kind === "application" && primary !== undefined) {
      targets.set(primary, item);
    }
  }

  const results = await probeAll([...targets.keys()]);
  for (const [url, item] of targets) {
    item.probe = results.get(url) ?? null;
  }
  for (const item of inventory) {
    item.health = deriveHealth(item.running, item.probe);
  }
}

export async function collectSnapshot(): Promise<Snapshot> {
  const { inventory, meta } = await buildCoolifyInventory();
  const [, server] = await Promise.all([probeInventory(inventory), getServerHealth()]);
  const flags = computeFlags(inventory, server);

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    coolify: meta,
    inventory,
    server,
    flags,
  };

  await getStore().save(snapshot);
  return snapshot;
}

// ── short-lived server-side cache + in-flight de-duplication ────────────────
let inflight: Promise<Snapshot> | null = null;
let lastCollectedAt = 0;

export async function getSnapshot(force = false): Promise<Snapshot> {
  if (!force) {
    const latest = await getStore().latest();
    if (latest && Date.now() - lastCollectedAt < config.snapshot.cacheTtlMs) {
      return latest;
    }
  }
  if (inflight) return inflight;

  inflight = collectSnapshot()
    .then((snapshot) => {
      lastCollectedAt = Date.now();
      return snapshot;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
