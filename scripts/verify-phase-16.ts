/**
 * Phase 16 Verification Script (v1.3 — Generation Pipeline Observability)
 *
 * Statically verifies that the Phase 16 contract is in place:
 *   OBS-01: text-rendering.service.ts imports + calls logTextVerification
 *   OBS-02: caption-quality.service.ts imports + calls logCaptionQuality
 *   OBS-03: observability.service.ts exports logSubjectFidelityFailure (scaffolding — NO call site)
 *   OBS-04: posts.routes.ts has zero copies of looksTruncatedCaption / hasHashtags /
 *           isAcceptableCaption / buildCaptionFallback; extractPromptField preserved
 *   Schema: migration file exists with the 6 new columns and 3 new enum values; Zod schema
 *           extended in shared/schema.ts
 *
 * Dynamic check: invokes each observability emitter against a real Supabase admin client
 * with a deterministic test post_id, asserts a row was written, then deletes it. Skipped
 * if SUPABASE env vars are absent (CI-friendly).
 *
 * Run with: npx tsx scripts/verify-phase-16.ts
 * Exits non-zero if any check fails.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

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

// ── Schema (migration + Zod) ─────────────────────────────────────────────
console.log("\nSchema: migration + shared/schema.ts");
const migDir = resolve(ROOT, "supabase/migrations");
const migMatches = existsSync(migDir)
  ? readdirSync(migDir).filter((n) => /generation_logs_observability\.sql$/.test(n))
  : [];
check(
  "migration file exists",
  migMatches.length === 1,
  "expected exactly one supabase/migrations/*generation_logs_observability.sql",
);

const migration = migMatches[0] ? read(`supabase/migrations/${migMatches[0]}`) : "";
check(
  "migration adds new error_type values",
  /subject_fidelity/.test(migration)
    && /text_verification/.test(migration)
    && /caption_quality/.test(migration),
);
check(
  "migration adds 6 new nullable columns",
  ["post_id", "event_kind", "outcome", "attempt_count", "duration_ms", "metadata"]
    .every((c) => new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${c}\\b`, "i").test(migration)),
);
check(
  "migration creates the 3 new indexes",
  /idx_generation_logs_post_id/.test(migration)
    && /idx_generation_logs_event_kind_outcome/.test(migration)
    && /idx_generation_logs_created_event/.test(migration),
);

const schema = read("shared/schema.ts");
check(
  "generationLogSchema has new optional fields",
  ["post_id", "event_kind", "outcome", "attempt_count", "duration_ms", "metadata"]
    .every((f) => new RegExp(`${f}:\\s*z\\.`, "i").test(schema)),
);
check(
  "generationLogSchema error_type widened",
  /subject_fidelity/.test(schema)
    && /text_verification/.test(schema)
    && /caption_quality/.test(schema),
);

// ── OBS-03 scaffolding (observability.service.ts) ────────────────────────
console.log("\nOBS-03: observability.service.ts scaffolding");
const obsSvc = read("server/services/observability.service.ts");
check("observability.service.ts exists", obsSvc.length > 0);
check(
  "exports logTextVerification",
  /export\s+async\s+function\s+logTextVerification\b/.test(obsSvc),
);
check(
  "exports logCaptionQuality",
  /export\s+async\s+function\s+logCaptionQuality\b/.test(obsSvc),
);
check(
  "exports logSubjectFidelityFailure",
  /export\s+async\s+function\s+logSubjectFidelityFailure\b/.test(obsSvc),
);
check(
  "all three emitters swallow errors (>=3 'catch {' blocks)",
  (obsSvc.match(/} catch \{/g) || []).length >= 3,
);
check(
  "observability.service.ts never re-throws",
  !/^\s*throw /m.test(obsSvc),
);
check(
  "imports createAdminSupabase",
  /import\s*\{\s*createAdminSupabase\s*\}\s*from\s*["']\.\.\/supabase\.js["']/.test(obsSvc),
);

// OBS-03 scaffolding: function exists, but no call site landed this phase.
function countCallSites(needle: string, dir: string): number {
  // Naive recursive walk — sufficient for our small server/ tree.
  let count = 0;
  const walk = (d: string): void => {
    const here = resolve(ROOT, d);
    if (!existsSync(here)) return;
    for (const entry of readdirSync(here, { withFileTypes: true })) {
      const rel = `${d}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const body = read(rel);
        // Strip the export-line itself if this IS observability.service.ts.
        const stripped = rel.endsWith("observability.service.ts")
          ? body.replace(
              /export\s+async\s+function\s+logSubjectFidelityFailure[\s\S]*?\n\}/m,
              "",
            )
          : body;
        count += (stripped.match(new RegExp(`\\b${needle}\\s*\\(`, "g")) || []).length;
      }
    }
  };
  walk(dir);
  return count;
}
check(
  "logSubjectFidelityFailure has zero call sites (OBS-03 scaffolding only)",
  countCallSites("logSubjectFidelityFailure", "server") === 0,
  "OBS-03 is scaffolding-only this phase per CONTEXT D-02; the export exists, the trigger lands later",
);

// ── OBS-01 (text-rendering.service.ts instrumented) ──────────────────────
console.log("\nOBS-01: text-rendering.service.ts instrumentation");
const textRend = read("server/services/text-rendering.service.ts");
check(
  "imports logTextVerification",
  /import\s*\{\s*logTextVerification\s*\}\s*from\s*["']\.\/observability\.service\.js["']/.test(textRend),
);
check(
  "imports createHash from node:crypto",
  /import\s*\{\s*createHash\s*\}\s*from\s*["']node:crypto["']/.test(textRend),
);
check("calls logTextVerification at least once", /logTextVerification\(/.test(textRend));
check("uses Date.now() for timing wrapper", /Date\.now\(\)/.test(textRend));
check("computes SHA-256 of expected text", /createHash\(["']sha256["']\)/.test(textRend));

// ── OBS-02 (caption-quality.service.ts instrumented) ─────────────────────
console.log("\nOBS-02: caption-quality.service.ts instrumentation");
const capQ = read("server/services/caption-quality.service.ts");
check(
  "imports logCaptionQuality",
  /import\s*\{\s*logCaptionQuality\s*\}\s*from\s*["']\.\/observability\.service\.js["']/.test(capQ),
);
check("calls logCaptionQuality at least once", /logCaptionQuality\(/.test(capQ));
check("uses Date.now() for timing wrapper", /Date\.now\(\)/.test(capQ));
check(
  "emits all four caption outcomes",
  /["']pass["']/.test(capQ)
    && /["']retry_triggered["']/.test(capQ)
    && /["']repair_triggered["']/.test(capQ)
    && /["']fallback_used["']/.test(capQ),
);

// ── OBS-04 (posts.routes.ts dead-helper removal) ─────────────────────────
console.log("\nOBS-04: posts.routes.ts dead-helper removal");
const postsRoutes = read("server/routes/posts.routes.ts");
check(
  "looksTruncatedCaption removed",
  !/^\s*function\s+looksTruncatedCaption\b/m.test(postsRoutes),
);
check(
  "hasHashtags removed",
  !/^\s*function\s+hasHashtags\b/m.test(postsRoutes),
);
check(
  "isAcceptableCaption removed",
  !/^\s*function\s+isAcceptableCaption\b/m.test(postsRoutes),
);
check(
  "buildCaptionFallback removed",
  !/^\s*function\s+buildCaptionFallback\b/m.test(postsRoutes),
);
check(
  "extractPromptField PRESERVED",
  /^\s*function\s+extractPromptField\b/m.test(postsRoutes),
);
check(
  "extractPromptField still called by remake-caption (>=3 call sites)",
  (postsRoutes.match(/\bextractPromptField\(/g) || []).length >= 4,
);
check(
  "imports from caption-quality.service.js still present",
  /from\s+["']\.\.\/services\/caption-quality\.service\.js["']/.test(postsRoutes),
);

// ── Dynamic check (optional, requires Supabase env) ──────────────────────
console.log("\nDynamic: round-trip log emission against generation_logs (skipped if no env)");
async function dynamicCheck(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    results.push("  skip dynamic check — SUPABASE env vars not set (CI-friendly)");
    return;
  }
  const { logTextVerification, logCaptionQuality, logSubjectFidelityFailure } = await import(
    "../server/services/observability.service.js"
  );
  const { createAdminSupabase } = await import("../server/supabase.js");

  const testTag = `verify-phase-16-${Date.now()}`;

  // 1) text_verification log row
  await logTextVerification({
    postId: null,
    outcome: "pass",
    expectedTextHash: "0".repeat(64),
    detectedText: testTag,
    repairAttemptCount: 0,
    durationMs: 1,
  });

  // 2) caption_quality log row
  await logCaptionQuality({
    postId: null,
    outcome: "pass",
    attemptCount: 0,
    finalCaptionLength: testTag.length,
    finalCaptionParagraphCount: 1,
    durationMs: 1,
  });

  // 3) subject_fidelity log row (proves OBS-03 scaffolding produces correct shape)
  await logSubjectFidelityFailure({
    postId: null,
    referenceImageCount: 1,
    failureReason: testTag,
  });

  // Verify all three rows exist
  const sb = createAdminSupabase();
  const { data: rows, error } = await sb
    .from("generation_logs")
    .select("id, event_kind, outcome, metadata")
    .or(
      `metadata->>detected_text.eq.${testTag},`
        + `metadata->>final_caption_length.eq.${testTag.length},`
        + `metadata->>failure_reason.eq.${testTag}`,
    );

  check(
    "dynamic: all three log rows written",
    !error && (rows?.length ?? 0) >= 3,
    `error=${error?.message ?? "none"} rows=${rows?.length ?? 0}`,
  );

  // Cleanup
  if (rows && rows.length > 0) {
    const ids = rows.map((r: { id: string }) => r.id);
    await sb.from("generation_logs").delete().in("id", ids);
  }
}

// ── Run + summary ────────────────────────────────────────────────────────
(async () => {
  try {
    await dynamicCheck();
  } catch (e) {
    failed++;
    results.push(`  FAIL dynamic check threw: ${(e as Error).message}`);
  }

  console.log("\n=== Phase 16 Verification ===");
  for (const line of results) console.log(line);
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Phase 16 checks passed.");
})();
