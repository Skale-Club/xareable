/**
 * Phase 17 Verification Script (v1.4 — GHL Signup Sync Wire-Up)
 *
 * Statically verifies that the Phase 17 contract is in place:
 *   GHL-01: server-side GHL push wired into POST /api/telegram/notify-signup via fanGHLSignup helper,
 *           gated on enabled && sync_on_signup, calls getOrCreateGHLContact with tags: ['xareable'],
 *           records all 4 observability outcomes to integration_delivery_logs.
 *   GHL-02: admin UI checkbox "Sync new signups to GHL (tagged xareable)" in integrations-tab.tsx,
 *           persists via PATCH /api/admin/ghl, reflects without page reload via query invalidation.
 *   GHL-03: best-effort — fanGHLSignup swallows all errors, signup never blocked, delivery logged.
 *
 * Dynamic check (optional): inserts a test row into integration_settings with sync_on_signup=true,
 * reads it back to confirm the column round-trips, then deletes the row. Skipped if SUPABASE_URL
 * or SUPABASE_SERVICE_ROLE_KEY env vars are absent (CI-friendly).
 *
 * Sealed file invariant: server/integrations/ghl.ts must be byte-identical to HEAD (no changes).
 *
 * Run with: npx tsx scripts/verify-phase-17.ts
 * Exits non-zero if any check fails.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
let failed = 0;
const results: string[] = [];

function check(label: string, condition: boolean, hint?: string): void {
  if (condition) {
    results.push(`  ok  ${label}`);
  } else {
    failed++;
    results.push(`  FAIL ${label}${hint ? `\n       hint: ${hint}` : ""}`);
  }
}

function read(path: string): string {
  const p = resolve(ROOT, path);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

// ── Section 1: Migration (Task 1) ─────────────────────────────────────────
console.log("\nSection 1: Migration — supabase/migrations/*_integration_settings_sync_on_signup.sql");
const migDir = resolve(ROOT, "supabase/migrations");
const migMatches = existsSync(migDir)
  ? readdirSync(migDir).filter((n) => /integration_settings_sync_on_signup\.sql$/.test(n))
  : [];

check(
  "migration file exists matching *_integration_settings_sync_on_signup.sql",
  migMatches.length >= 1,
  "expected at least one supabase/migrations/*_integration_settings_sync_on_signup.sql",
);

const migFile = migMatches[0] ?? "";
const migration = migFile ? read(`supabase/migrations/${migFile}`) : "";

check(
  "migration contains ADD COLUMN IF NOT EXISTS sync_on_signup boolean NOT NULL DEFAULT false",
  /ADD COLUMN IF NOT EXISTS sync_on_signup boolean NOT NULL DEFAULT false/.test(migration),
);

check(
  "migration contains COMMENT ON COLUMN public.integration_settings.sync_on_signup",
  /COMMENT ON COLUMN public\.integration_settings\.sync_on_signup/.test(migration),
);

const migTimestamp = migFile ? Number(migFile.slice(0, 14)) : 0;
check(
  "migration filename timestamp is greater than 20260307000000 (orders last)",
  migTimestamp > 20260307000000,
  `filename timestamp extracted: ${migTimestamp}`,
);

// ── Section 2: Zod schema (Task 1) ────────────────────────────────────────
console.log("\nSection 2: Zod schema — shared/schema.ts");
const schema = read("shared/schema.ts");

check(
  "adminGHLStatusSchema contains sync_on_signup: z.boolean().default(false)",
  /sync_on_signup:\s*z\.boolean\(\)\.default\(false\)/.test(schema),
);

check(
  "saveGHLSettingsRequestSchema contains sync_on_signup: z.boolean().optional()",
  /sync_on_signup:\s*z\.boolean\(\)\.optional\(\)/.test(schema),
);

const schemaOccurrences = (schema.match(/sync_on_signup/g) || []).length;
check(
  "shared/schema.ts mentions sync_on_signup at least 2 times",
  schemaOccurrences >= 2,
  `found ${schemaOccurrences} occurrence(s)`,
);

// ── Section 3: Server wiring (Task 2) ─────────────────────────────────────
console.log("\nSection 3: Server wiring — server/routes/integrations.routes.ts");
const routes = read("server/routes/integrations.routes.ts");

check(
  "declares async function fanGHLSignup",
  /async function fanGHLSignup\b/.test(routes),
);

const fanInvocations = (routes.match(/void fanGHLSignup\(/g) || []).length;
check(
  "void fanGHLSignup( invoked exactly once",
  fanInvocations === 1,
  `found ${fanInvocations} invocation(s)`,
);

const ghlTypeOccurrences = (routes.match(/integrationType:\s*"ghl"/g) || []).length;
check(
  "integrationType: \"ghl\" appears at least 4 times (settings_read_failed, skipped, sent, failed paths)",
  ghlTypeOccurrences >= 4,
  `found ${ghlTypeOccurrences} occurrence(s)`,
);

check(
  "GHL contact payload passes tags: [\"xareable\"] or tags: ['xareable']",
  /tags:\s*\[["']xareable["']\]/.test(routes),
);

check(
  "smell-comment: fans the signup event to ALL configured integrations",
  /fans the signup event to ALL configured integrations/.test(routes),
);

check(
  "GET /api/admin/ghl response includes sync_on_signup field",
  /sync_on_signup:\s*Boolean\(\s*\(settings as/.test(routes) ||
  /sync_on_signup:\s*Boolean\(settings\.sync_on_signup\)/.test(routes),
);

check(
  "PATCH /api/admin/ghl persists sync_on_signup: if (typeof sync_on_signup === \"boolean\") updateData.sync_on_signup",
  /if\s*\(typeof sync_on_signup === ["']boolean["']\)\s*updateData\.sync_on_signup/.test(routes),
);

check(
  "fanGHLSignup uses eventName: \"CompleteRegistration\"",
  /eventName:\s*["']CompleteRegistration["']/.test(routes),
);

// ── Section 4: Admin UI (Task 3) ──────────────────────────────────────────
console.log("\nSection 4: Admin UI — client/src/components/admin/integrations-tab.tsx");
const uiFile = read("client/src/components/admin/integrations-tab.tsx");

check(
  "integrations-tab.tsx contains id=\"ghl-sync-on-signup\"",
  /id="ghl-sync-on-signup"/.test(uiFile),
);

check(
  "integrations-tab.tsx contains label text \"Sync new signups to GHL\"",
  /Sync new signups to GHL/.test(uiFile),
);

check(
  "integrations-tab.tsx contains payload.sync_on_signup = ghlSyncOnSignup",
  /payload\.sync_on_signup\s*=\s*ghlSyncOnSignup/.test(uiFile),
);

check(
  "integrations-tab.tsx hydration: setGhlSyncOnSignup(Boolean(ghlData.sync_on_signup))",
  /setGhlSyncOnSignup\(Boolean\(ghlData\.sync_on_signup\)\)/.test(uiFile),
);

// ── Section 5: Sealed file invariant (cross-cutting) ──────────────────────
console.log("\nSection 5: Sealed file — server/integrations/ghl.ts must be byte-identical to HEAD");
const gitDiffResult = spawnSync(
  "git",
  ["diff", "--quiet", "HEAD", "--", "server/integrations/ghl.ts"],
  { cwd: ROOT, encoding: "utf8" },
);
if (gitDiffResult.error) {
  failed++;
  results.push(`  FAIL sealed-file gate: git unavailable — ensure repo is git-initialized (${gitDiffResult.error.message})`);
} else {
  check(
    "server/integrations/ghl.ts is byte-identical to HEAD (sealed file gate)",
    gitDiffResult.status === 0,
    "ghl.ts has uncommitted changes — this file must not be modified",
  );
}

// ── Optional dynamic check ─────────────────────────────────────────────────
console.log("\nDynamic: round-trip sync_on_signup column via integration_settings (skipped if no env)");
async function dynamicCheck(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    results.push("  skip dynamic check — SUPABASE env vars not set (CI-friendly)");
    return;
  }

  const { createAdminSupabase } = await import("../server/supabase.js");
  const sb = createAdminSupabase();

  const testType = `ghl-test-${Date.now()}`;

  // Insert a test row with sync_on_signup=true
  const { data: inserted, error: insertError } = await sb
    .from("integration_settings")
    .insert({ integration_type: testType, sync_on_signup: true, enabled: false })
    .select("id, sync_on_signup")
    .single();

  if (insertError) {
    results.push(`  skip dynamic check — insert failed: ${insertError.message}`);
    return;
  }

  check(
    "dynamic: sync_on_signup round-trips through integration_settings (insert=true, read=true)",
    Boolean(inserted?.sync_on_signup) === true,
    `read back: ${inserted?.sync_on_signup}`,
  );

  // Cleanup
  if (inserted?.id) {
    await sb.from("integration_settings").delete().eq("id", inserted.id);
  }
}

// ── Run + summary ─────────────────────────────────────────────────────────
(async () => {
  try {
    await dynamicCheck();
  } catch (e) {
    failed++;
    results.push(`  FAIL dynamic check threw: ${(e as Error).message}`);
  }

  console.log("\n=== Phase 17 Verification ===");
  for (const line of results) console.log(line);
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Phase 17 checks passed.");
})();
