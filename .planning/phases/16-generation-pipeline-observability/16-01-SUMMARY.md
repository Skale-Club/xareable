---
phase: 16-generation-pipeline-observability
plan: 01
subsystem: server-observability
tags:
  - observability
  - generation-logs
  - text-rendering
  - caption-quality
  - schema-migration
requirements:
  - OBS-01
  - OBS-02
  - OBS-03
  - OBS-04
dependency-graph:
  requires:
    - generation_logs table (Phase 06 / 20260306000000_generation_logs.sql)
    - createAdminSupabase factory (server/supabase.ts)
    - enforceExactImageText (server/services/text-rendering.service.ts)
    - ensureCaptionQuality (server/services/caption-quality.service.ts)
  provides:
    - "Three best-effort log emitters: logTextVerification, logCaptionQuality, logSubjectFidelityFailure"
    - "Structured observability rows in generation_logs (event_kind / outcome / attempt_count / duration_ms / metadata)"
    - "Static + dynamic verification harness scripts/verify-phase-16.ts"
    - "Cleaner posts.routes.ts (4 dead caption helpers gone)"
  affects:
    - server/services/text-rendering.service.ts (new postId? param + single log emit per invocation)
    - server/services/caption-quality.service.ts (new postId? param + single log emit per invocation)
    - shared/schema.ts (generationLogSchema widened error_type + 6 new optional fields)
    - server/routes/posts.routes.ts (4 dead helpers deleted; extractPromptField + getStorageObjectPathFromPublicUrl preserved)
tech-stack:
  added: []
  patterns:
    - "Best-effort log-and-swallow pattern (mirrors logGenerationError from generate.routes.ts)"
    - "Single log row per invocation reflecting FINAL outcome (never per repair pass)"
    - "Fire-and-forget via void on logging calls — telemetry must NEVER block or alter generation flow"
    - "First-class structured columns + JSONB metadata for query-friendly observability"
    - "Static-grep verification harness with optional dynamic round-trip (CI-friendly env gating)"
key-files:
  created:
    - supabase/migrations/20260508000000_generation_logs_observability.sql
    - server/services/observability.service.ts
    - scripts/verify-phase-16.ts
  modified:
    - shared/schema.ts
    - server/services/text-rendering.service.ts
    - server/services/caption-quality.service.ts
    - server/routes/posts.routes.ts
decisions:
  - "D-01 (first-class columns over JSONB): generation_logs gets 6 nullable columns + JSONB metadata for type-specific extras. Query-friendly: SELECT outcome, count(*) ... GROUP BY outcome works without ->> casts."
  - "D-02 (OBS-03 scaffolding-only): logSubjectFidelityFailure is exported but has zero call sites this phase. Future detection signal (reverse-image-similarity / Gemini self-evaluation / etc.) plugs in via single import + call."
  - "D-03 (single observability service): all 3 emitters consolidated in server/services/observability.service.ts. No splattering of recordGenerationLog calls into business logic."
  - "D-04 (one log per invocation, final outcome): both enforceExactImageText and ensureCaptionQuality emit exactly one row per invocation reflecting the FINAL state. Never per repair pass — that would multiply rows N times."
  - "D-05 (extractPromptField preserved): the only unique helper in posts.routes.ts (no service equivalent), used by /api/posts/:id/remake-caption. Stays put."
metrics:
  duration: "~13 minutes (executor time)"
  tasks-completed: 5
  files-created: 3
  files-modified: 4
  commits: 5
  completed-date: "2026-05-08"
---

# Phase 16 Plan 01: Generation Pipeline Observability Summary

Added structured observability to the generation pipeline by extending `generation_logs` with first-class columns, creating a consolidated `observability.service.ts` with three best-effort log emitters (text-verification, caption-quality, and a scaffolding-only subject-fidelity emitter), instrumenting `enforceExactImageText` + `ensureCaptionQuality` to emit one log row per invocation reflecting the final outcome (with SHA-256 hash of expected text, attempt count, paragraph count, and duration), removing four dead duplicate caption helpers from `posts.routes.ts`, and shipping a static + dynamic verification harness that confirms all four OBS requirements pass.

## What Shipped

### Files Created (3)

1. **`supabase/migrations/20260508000000_generation_logs_observability.sql`** — additive migration. Adds 6 nullable columns (`post_id`, `event_kind`, `outcome`, `attempt_count`, `duration_ms`, `metadata`), 3 new `error_type` CHECK values (`subject_fidelity`, `text_verification`, `caption_quality`), and 3 partial indexes optimised for typical observability queries (lookup-by-post, group-by-outcome, time-ordered-by-event). Original `20260306000000_generation_logs.sql` byte-identical.

2. **`server/services/observability.service.ts`** — 136-line file consolidating all 3 emitters:
   - `logTextVerification` (OBS-01) — outcome union: `pass | repair_triggered | repair_succeeded | repair_failed`
   - `logCaptionQuality` (OBS-02) — outcome union: `pass | retry_triggered | repair_triggered | fallback_used`
   - `logSubjectFidelityFailure` (OBS-03 scaffolding) — outcome: `failure`
   
   Each wraps a Supabase insert in try/catch. Errors are SWALLOWED. None of them throw. Mirrors the `logGenerationError` pattern from `server/routes/generate.routes.ts`.

3. **`scripts/verify-phase-16.ts`** — 293-line static + dynamic verification harness. Static checks cover all four OBS requirements + schema. Dynamic check (round-trip insert/select/delete via real Supabase admin client) auto-skips when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars are absent (CI-friendly).

### Files Modified (4)

1. **`shared/schema.ts`** — `generationLogSchema` widened: error_type enum extended from 5 to 8 values; 6 new optional fields appended after `created_at`. `adminGenerationLogsResponseSchema` unchanged (composition).

2. **`server/services/text-rendering.service.ts`** (OBS-01) — added `import { createHash } from "node:crypto"`, `import { logTextVerification } from "./observability.service.js"`, and an optional `postId?: string | null` param to `enforceExactImageText`. Wrapped the function body with a `Date.now()` timer + `expectedTextHash` computation + an `emit()` helper called exactly once on EVERY exit path:
   - Empty-expected-text early return → `pass`
   - Verified after pass → `pass` (if attempts=0) or `repair_succeeded` (if attempts >= 1)
   - Exhausted passes → `repair_failed`
   
   Fire-and-forget via `void` so logging cannot delay or break the user-visible return.

3. **`server/services/caption-quality.service.ts`** (OBS-02) — added `import { logCaptionQuality } from "./observability.service.js"` and an optional `postId?: string | null` param. Wrapped `ensureCaptionQuality` with a timer + `emit()` helper called once per exit:
   - Candidate already acceptable + not forceRewrite → `pass` (attempts=0)
   - First Gemini pass acceptable → `pass` (attempts=1)
   - Second pass acceptable → `retry_triggered` (attempts=2)
   - Repair pass acceptable → `repair_triggered` (attempts=3)
   - Final fallback → `fallback_used` (attempts=3)
   
   Final fallback path refactored to assign-then-emit-then-return (instead of inline return) so the emit fires before the return.

4. **`server/routes/posts.routes.ts`** (OBS-04) — deleted 4 dead duplicate caption helpers (`looksTruncatedCaption`, `hasHashtags`, `isAcceptableCaption`, `buildCaptionFallback`). Preserved `extractPromptField` (4 usages by remake-caption endpoint, no service equivalent) and `getStorageObjectPathFromPublicUrl` (used by `/api/posts/cleanup`). No new imports added — the route handlers in this file only call `ensureCaptionQuality` and `normalizeContentLanguage`, both already imported.

## Locked Decisions Honored

| Decision | Rule | How honored |
|---|---|---|
| D-01 | First-class columns over JSONB | 6 nullable columns added (`post_id`, `event_kind`, `outcome`, `attempt_count`, `duration_ms`, `metadata`); type-specific extras live in `metadata` JSONB |
| D-02 | OBS-03 = scaffolding-only | `logSubjectFidelityFailure` exported but ZERO call sites in `server/`. Verification harness explicitly tests this invariant. |
| D-03 | Single observability service | All 3 emitters in `server/services/observability.service.ts`. Business logic doesn't import or know about Supabase row shapes. |
| D-04 | One log per invocation | Both `enforceExactImageText` and `ensureCaptionQuality` use a single `emit()` closure called once per exit path. No per-repair-pass logs. |
| D-05 | Preserve `extractPromptField` | Function declaration unchanged; all 3 call sites in remake-caption handler intact (4 total occurrences including declaration). |

## Verification Proof

`npx tsx scripts/verify-phase-16.ts` final summary:

```
=== Phase 16 Verification ===
  ok  migration file exists
  ok  migration adds new error_type values
  ok  migration adds 6 new nullable columns
  ok  migration creates the 3 new indexes
  ok  generationLogSchema has new optional fields
  ok  generationLogSchema error_type widened
  ok  observability.service.ts exists
  ok  exports logTextVerification
  ok  exports logCaptionQuality
  ok  exports logSubjectFidelityFailure
  ok  all three emitters swallow errors (>=3 'catch {' blocks)
  ok  observability.service.ts never re-throws
  ok  imports createAdminSupabase
  ok  logSubjectFidelityFailure has zero call sites (OBS-03 scaffolding only)
  ok  imports logTextVerification
  ok  imports createHash from node:crypto
  ok  calls logTextVerification at least once
  ok  uses Date.now() for timing wrapper
  ok  computes SHA-256 of expected text
  ok  imports logCaptionQuality
  ok  calls logCaptionQuality at least once
  ok  uses Date.now() for timing wrapper
  ok  emits all four caption outcomes
  ok  looksTruncatedCaption removed
  ok  hasHashtags removed
  ok  isAcceptableCaption removed
  ok  buildCaptionFallback removed
  ok  extractPromptField PRESERVED
  ok  extractPromptField still called by remake-caption (>=3 call sites)
  ok  imports from caption-quality.service.js still present
  skip dynamic check — SUPABASE env vars not set (CI-friendly)

All Phase 16 checks passed.
```

Build / typecheck:
- `npm run check` — exits 0 (after each of 5 tasks).
- `npm run build` — exits 0 (Vercel `dist/index.cjs` 1.2 MB, within previous size).

Original migration:
- `git diff HEAD -- supabase/migrations/20260306000000_generation_logs.sql` — empty (untouched).

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 fixes required, no Rule 4 architectural questions raised. Authentication gates not triggered.

## Deferred Items

- **Dynamic verify-phase-16 check requires runtime Supabase access.** This execution session ran without `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars. The harness correctly auto-skipped the dynamic round-trip and reported `skip` (not `FAIL`). To run end-to-end verification with real DB writes (which proves the new columns actually accept the inserted shape), set the env vars and re-run `npx tsx scripts/verify-phase-16.ts`. **MUST-RUN-BY-USER once the migration is deployed via `supabase db push` to confirm column-shape compatibility against the live schema.**

- **Migration not applied during this execution.** Per the runtime gate note in the plan brief, the migration file lands in `supabase/migrations/` but is NOT applied to production by this plan — that's a deployment-time concern (`supabase db push` after Vercel deploy). Confirming the migration file exists and parses correctly is sufficient for the execution gate.

- **OBS-03 detection signal still doesn't exist** (deliberately, per CONTEXT D-02). `logSubjectFidelityFailure` is ready to wire up; future PR adds the trigger in whatever service grows reverse-image-similarity / Gemini self-evaluation. Tracked as deferred-with-seed in `.planning/phases/16-generation-pipeline-observability/16-CONTEXT.md` deferred section.

- **End-to-end smoke test** (trigger `/api/generate` and confirm a `text_verification` row + `caption_quality` row appear in `generation_logs` for the new post_id) is owner-time-bounded and out of execution scope. Listed as optional manual step in plan `<verification>` step 7.

## Self-Check: PASSED

All claims verified:

- ✓ `supabase/migrations/20260508000000_generation_logs_observability.sql` exists.
- ✓ `server/services/observability.service.ts` exists.
- ✓ `scripts/verify-phase-16.ts` exists.
- ✓ Commits `b72a288`, `65fbfaa`, `813be26`, `4d884e6`, `0e06dae` all present in `git log`.
- ✓ `npm run check` exits 0.
- ✓ `npm run build` exits 0.
- ✓ `npx tsx scripts/verify-phase-16.ts` exits 0.
- ✓ Original migration `20260306000000_generation_logs.sql` byte-identical (`git diff HEAD --` empty).
- ✓ No untracked files left from execution.
