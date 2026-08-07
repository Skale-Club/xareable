import type { RawCoolifyResource } from "@/lib/coolify/client";
import type { AppHealth, CoolifyResourceKind, InventoryItem, ProbeResult } from "@/lib/types";

/**
 * CORE requirement (Final Spec §5): the app inventory is derived live from
 * Coolify on every refresh. Nothing here is hardcoded — add/remove an app on
 * the host and it appears/disappears on the next poll.
 */

function splitDomains(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractFqdns(raw: RawCoolifyResource): string[] {
  const out = new Set<string>();
  if (typeof raw.fqdn === "string") splitDomains(raw.fqdn).forEach((d) => out.add(d));
  if (typeof raw.domains === "string") splitDomains(raw.domains).forEach((d) => out.add(d));
  else if (Array.isArray(raw.domains)) {
    raw.domains.forEach((d) => {
      if (typeof d === "string") splitDomains(d).forEach((x) => out.add(x));
    });
  }
  return [...out].map(toUrl);
}

function toUrl(fqdn: string): string {
  return /^https?:\/\//i.test(fqdn) ? fqdn : `https://${fqdn}`;
}

function deriveRunning(rawStatus: string | null): boolean | null {
  if (!rawStatus) return null;
  const s = rawStatus.toLowerCase();
  if (s.includes("running") || s.includes("healthy")) return true;
  if (s.includes("exited") || s.includes("stopped") || s.includes("degraded") || s.includes("error") || s.includes("failed")) {
    return false;
  }
  return null;
}

function toItem(raw: RawCoolifyResource, kind: CoolifyResourceKind): InventoryItem {
  const uuid = raw.uuid ?? (raw.id !== undefined ? String(raw.id) : `${kind}:${raw.name ?? "unknown"}`);
  const rawStatus = raw.status ?? null;
  return {
    uuid,
    name: raw.name ?? uuid,
    kind,
    rawStatus,
    running: deriveRunning(rawStatus),
    fqdns: extractFqdns(raw),
    gitRepository: raw.git_repository ?? null,
    gitBranch: raw.git_branch ?? null,
    buildPack: raw.build_pack ?? null,
    probe: null, // the collector fills this after probing the primary fqdn
    health: "unknown",
  };
}

export function normalizeInventory(input: {
  applications: RawCoolifyResource[];
  services: RawCoolifyResource[];
  databases: RawCoolifyResource[];
}): InventoryItem[] {
  return [
    ...input.applications.map((r) => toItem(r, "application")),
    ...input.services.map((r) => toItem(r, "service")),
    ...input.databases.map((r) => toItem(r, "database")),
  ];
}

/** Combine the Coolify status with the live probe into one health verdict. */
export function deriveHealth(running: boolean | null, probe: ProbeResult | null): AppHealth {
  if (probe) {
    if (probe.ok) return running === false ? "degraded" : "up";
    return "down";
  }
  if (running === true) return "up";
  if (running === false) return "down";
  return "unknown";
}
