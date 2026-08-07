import { z } from "zod";
import { config } from "@/lib/config";

/**
 * Read-only Coolify REST client (Blocker B2 supplies the token).
 *
 * SAFETY: this client exposes GET endpoints ONLY — there are intentionally no
 * deploy/stop/restart/delete methods. The dashboard is observability-only and
 * must never mutate Coolify resources (Final Spec §6).
 *
 * Endpoints confirmed against the host (RUNBOOK.md / coolify_api.py):
 *   GET /applications  /services  /databases  /projects  /servers  /version
 * Do NOT add /settings or /sources — both 404 in this Coolify version.
 */

export type CoolifyErrorKind = "no-token" | "timeout" | "network" | "http" | "parse";

export class CoolifyError extends Error {
  readonly kind: CoolifyErrorKind;
  readonly status: number | undefined;
  constructor(kind: CoolifyErrorKind, message: string, status?: number) {
    super(message);
    this.name = "CoolifyError";
    this.kind = kind;
    this.status = status;
  }
}

// Lenient resource shape — extra fields pass through, most fields optional,
// because the exact JSON is verified on first real run (roadmap item 10 / B2).
const RawResource = z
  .object({
    uuid: z.string().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    fqdn: z.string().nullable().optional(),
    domains: z.union([z.string(), z.array(z.string())]).nullable().optional(),
    git_repository: z.string().nullable().optional(),
    git_branch: z.string().nullable().optional(),
    build_pack: z.string().nullable().optional(),
  })
  .passthrough();

export type RawCoolifyResource = z.infer<typeof RawResource>;

const RawResourceArray = z.array(RawResource);

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

async function getRaw(path: string): Promise<Response> {
  const token = config.coolify.token;
  if (!token) {
    throw new CoolifyError("no-token", "COOLIFY_TOKEN is not configured (Blocker B2).");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.probe.timeoutMs);
  try {
    const res = await fetch(`${config.coolify.base}${path}`, {
      method: "GET",
      headers: authHeaders(token),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new CoolifyError("http", `Coolify GET ${path} → HTTP ${res.status}`, res.status);
    }
    return res;
  } catch (err) {
    if (err instanceof CoolifyError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new CoolifyError("timeout", `Coolify GET ${path} timed out after ${config.probe.timeoutMs}ms`);
    }
    throw new CoolifyError("network", `Coolify GET ${path} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function getResourceList(path: string): Promise<RawCoolifyResource[]> {
  const res = await getRaw(path);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new CoolifyError("parse", `Coolify GET ${path} returned non-JSON`);
  }
  // Tolerate both bare arrays and { data: [...] } envelopes.
  const arr = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)
      ? (json as { data: unknown[] }).data
      : null;
  if (arr === null) {
    throw new CoolifyError("parse", `Coolify GET ${path} did not return a resource array`);
  }
  const parsed = RawResourceArray.safeParse(arr);
  if (!parsed.success) {
    throw new CoolifyError("parse", `Coolify GET ${path} shape unexpected: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const coolify = {
  isConfigured(): boolean {
    return config.coolify.configured;
  },

  async getApplications(): Promise<RawCoolifyResource[]> {
    return getResourceList("/applications");
  },

  async getServices(): Promise<RawCoolifyResource[]> {
    return getResourceList("/services");
  },

  async getDatabases(): Promise<RawCoolifyResource[]> {
    return getResourceList("/databases");
  },

  async getVersion(): Promise<string | null> {
    const res = await getRaw("/version");
    const text = (await res.text()).trim();
    if (!text) return null;
    // /version may return a bare string or a JSON-quoted string.
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") return parsed;
      if (parsed && typeof parsed === "object" && "version" in parsed) {
        return String((parsed as { version: unknown }).version);
      }
    } catch {
      /* not JSON — fall through to raw text */
    }
    return text.replace(/^"|"$/g, "");
  },
};
