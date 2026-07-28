---
phase: 22-art-director-planning-upgrade
plan: 06
subsystem: testing
tags: [openrouter, structured-outputs, verification-harness, ablation, art-direction]

# Dependency graph
requires:
  - phase: 22-01
    provides: verify-phase-22.ts harness scaffold, planning-schema.service.ts (PLANNING_JSON_SCHEMA, PLANNING_MAX_OUTPUT_TOKENS)
  - phase: 22-02
    provides: multimodal reference-image attachment on the planning call (toOpenRouterInputReference usage, buildPlanningContentParts)
  - phase: 22-03
    provides: carousel token-budget scaling, ai_models.planning admin selector
  - phase: 22-04
    provides: strict json_schema/responseSchema request wiring + schema-failure hard-fail + logPlanningSchemaFailure
  - phase: 22-05
    provides: dense authoritative image_prompt precedence fix + text_blocks/layout_archetype_id passthrough
provides:
  - Full Phase 22 static/functional gate green (54/54 checks, zero weakened checks) with 3 new cross-plan invariant checks no single earlier plan owned
  - scripts/verify-planning-ablation.ts — OPENROUTER_API_KEY-gated live SC1 ablation harness (CI-safe, exits 0 skip when key absent)
  - Authoritative 6-step MANUAL/LIVE VERIFICATION RUNBOOK embedded at the bottom of verify-phase-22.ts
affects: [23]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SC1 ablation via double-call comparison: same chatCompletion()/PLANNING_JSON_SCHEMA path invoked twice (text-only vs with-images) at low temperature, compared via Jaccard word-overlap — proves multimodal attachment has a measurable effect without requiring subjective human judgment of the output"

key-files:
  created:
    - scripts/verify-planning-ablation.ts
  modified:
    - scripts/verify-phase-22.ts

key-decisions:
  - "The plan's literal header-comment text for verify-planning-ablation.ts mentions toOpenRouterInputReference in prose, causing its acceptance-criteria grep (expected 2 lines: import + use) to actually return 3 (comment + import + use). Not a code defect — same class of plan-authoring grep overcount already documented in 22-03-SUMMARY.md and 22-04-SUMMARY.md. Left the header verbatim as specified rather than editing plan-authored prose to satisfy a miscounted grep."
  - "Did not run the automated `roadmap update-plan-progress`/`state advance-plan` tools for this plan's STATE.md/ROADMAP.md updates — both tools treat 'a SUMMARY.md file exists' as 'plan complete', which would have incorrectly flipped Phase 22 to 100% (6/6) and 'Ready for verification' despite Task 3 being an unresolved blocking checkpoint. Edited both files by hand instead, mirroring the precedent set in Phase 21.1 Plan 07 Task 3."

patterns-established: []

requirements-completed: []  # PLAN-01..04 were already marked Complete in REQUIREMENTS.md by prior plans (22-01..22-05) delivering the static implementation; this plan's OWN scope (live SC1 proof + operator sign-off) is NOT complete — Task 3 is a blocking checkpoint that was not performed. Do not treat this list as re-certifying PLAN-01..04 via live proof.

# Metrics
duration: 8min (Tasks 1-2 only; Task 3 not started)
completed: PARTIAL — Tasks 1-2 of 3 complete, 2026-07-27
---

# Phase 22 Plan 06: Full Harness Green + Live SC1 Ablation Harness Summary

**STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (verify-phase-22.ts is green at 54/54 with zero weakened checks, and the OPENROUTER_API_KEY-gated live ablation harness exists and behaves correctly in both its skip and usage-error paths); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.**

`scripts/verify-phase-22.ts` now carries 3 additional cross-plan invariant checks (video carve-out gates >=4 places, flattening is structurally lazy behind the model's own prompt, and the SC1 live ablation harness exists) plus the authoritative 6-step MANUAL/LIVE VERIFICATION RUNBOOK comment block used by the operator to close the phase. `scripts/verify-planning-ablation.ts` is new: it proves — for a real funded key — that attaching reference images to the planning call measurably changes the resulting `image_prompt` by running the exact same `chatCompletion()`/`PLANNING_JSON_SCHEMA` path twice (text-only vs. with-images) and asserting the two outputs are not byte-identical and score below a 0.95 Jaccard word-overlap threshold. With no key set it prints a SKIP line and exits 0, mirroring `scripts/verify-cron-jobs.ts`'s env-gated pattern, so CI is never blocked by this live-only check. Task 3 — operator sign-off on the 6-step live runbook (SC1 ablation, SC2/SC3 live structured output, schema-failure hard-fail, GATE-07 rollback parity, carousel token budget, GATE-08 video regression) — requires a real funded `OPENROUTER_API_KEY`, staging access, and a paid Veo call, none of which are available in this execution environment.

## Performance

- **Duration:** ~8 min (Tasks 1-2)
- **Started:** 2026-07-27T19:10:30Z
- **Tasks:** 2 of 3 completed (Task 3 is a blocking checkpoint, not started)
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- `scripts/verify-phase-22.ts`: confirmed all 51 pre-existing checks from plans 22-01..22-05 already passed with ZERO regex adjustments needed (no implementation drift since plan authoring) — ran the harness before touching it to establish this baseline. Added the 3 plan-specified cross-plan invariant checks verbatim: `[svc-schema] video planning path excluded from strict schema in BOTH transports` (`isVideoPlanning` appears 7 times, well above the >=4 floor), `[svc-prompt-precedence] flattening computed lazily behind modelImagePrompt` (regex-confirmed against the real `const flattenedPrompt = modelImagePrompt ? "" : (...)` ternary from plan 22-05), and `[svc-multimodal] live ablation harness exists` (green only after Task 2 lands the file). Replaced the trailing runbook comment block with the plan's authoritative 6-step version (SC1 ablation command, SC2/SC3 live structured output, schema-failure hard-fail with the direct-Gemini forcing technique, GATE-07 rollback parity, carousel token budget, GATE-08 video regression).
- `scripts/verify-planning-ablation.ts` (new): reads `OPENROUTER_API_KEY`, prints a SKIP line and exits 0 when absent; requires `--image=<path>` (usage + exit 1 otherwise) with an optional `--model=` (default `gemini-2.5-pro`); base64-encodes the image and derives its MIME type; sends one fixed embedded Aurora Coffee Co. art-direction prompt through `chatCompletion()` twice — once text-only, once with the image attached via `toOpenRouterInputReference()` — both with `fallbackModels: []` (avoids a Supabase round-trip), `temperature: 0.2`, `maxTokens: PLANNING_MAX_OUTPUT_TOKENS`, and `responseFormat: { type: "json_schema", json_schema: PLANNING_JSON_SCHEMA }` — the exact same gateway function and strict schema the production planning call uses. Computes a Jaccard word-overlap ratio (lowercase, `\W+`-split, tokens >=4 chars) between the two `image_prompt` outputs and asserts: both >=40 characters, not byte-identical, and overlap <0.95. Prints `ABLATION PROVEN — ... (overlap=X.XXX)` and exits 0 on success, or itemized `FAIL` lines and exits 1 otherwise. Not wired into `verify-phase-22.ts`'s automated run (costs real money) — the harness only asserts the file's existence.
- Verified no regression: `npx tsx scripts/verify-phase-21.ts` (43/43), `npx tsx scripts/verify-phase-21.1.ts` (54/54), `npx tsx scripts/test-planning-schema-classification.ts` (9/9), `npm run check` (clean), `npm run build` (clean, both client + server bundles). All 8 `--only=<tag>` filters (`self-test`, `svc-schema-module`, `svc-multimodal`, `svc-schema`, `svc-schema-failure-log`, `svc-model-tier`, `svc-token-budget`, `svc-prompt-precedence`) exit 0 individually.

## Task Commits

Each task was committed atomically:

1. **Task 1: Drive the full Phase 22 harness to green** - `c594918` (feat)
2. **Task 2: Build the OPENROUTER_API_KEY-gated live ablation harness (SC1)** - `c8d57bf` (feat)

**Task 3: Operator sign-off on the live Phase 22 verifications** — NOT STARTED. This is a `checkpoint:human-verify` task with `gate="blocking"` requiring a real funded `OPENROUTER_API_KEY`, staging access, and a paid Veo call, none available in this execution environment. See "Checkpoint Details" below.

**Plan metadata:** this commit (STATE.md/ROADMAP.md/SUMMARY.md only — Task 3 still pending, so this is NOT a phase-closure commit)

## Files Created/Modified
- `scripts/verify-phase-22.ts` - Added 3 cross-plan invariant checks; replaced the trailing comment block with the authoritative 6-step MANUAL/LIVE VERIFICATION RUNBOOK
- `scripts/verify-planning-ablation.ts` - New OPENROUTER_API_KEY-gated live SC1 ablation harness (CI-safe skip when key absent)

## Decisions Made

See `key-decisions` in frontmatter. Two notable calls: (1) left the plan's literal header-comment prose in `verify-planning-ablation.ts` untouched even though it causes a benign grep overcount (documented, not fixed, per the 22-03/22-04 precedent for plan-authoring grep inaccuracies); (2) updated STATE.md and ROADMAP.md by hand rather than via `gsd-tools state advance-plan` / `roadmap update-plan-progress`, because both tools infer full completion from SUMMARY.md's mere existence and would have incorrectly marked Phase 22 100% complete despite Task 3's unresolved blocking checkpoint.

## Deviations from Plan

None — both tasks matched the plan's literal action text and all code-level acceptance criteria on first attempt. No implementation fixes were required in any dependency file; every regex, cross-plan check, and grep specified by the plan matched the real codebase exactly (confirmed via direct `node -e` regex testing before editing).

## Issues Encountered

- The plan's own acceptance-criteria grep for `toOpenRouterInputReference` (expected 2 lines) returns 3 in the delivered file, because the mandated header comment's prose also contains the literal function name. This is a plan-authoring artifact (same class as 22-03/22-04's documented grep overcounts), not a functional defect — the import and the one call site are both present and correct. Logged rather than "fixed" since editing the plan-specified header text would only trade one cosmetic mismatch for a deviation from the plan's literal wording.

## User Setup Required

**External/live verification required — Task 3 has NOT been performed.** See "Checkpoint Details" below for the full operator runbook (also embedded at the bottom of `scripts/verify-phase-22.ts`).

## Next Phase Readiness

- All code-level PLAN-01..04 work is done and gated: `verify-phase-22.ts` 54/54 green (zero weakened checks), Phase 21 unregressed (43/43), Phase 21.1 unregressed (54/54), classification fixture (9/9), `npm run check` clean, `npm run build` clean.
- **Phase 22 is NOT yet closable.** Task 3 (operator sign-off on the 6-step live runbook) must run before Phase 22's ROADMAP checkbox is checked. Per the plan's own instruction, PLAN-01..04 are NOT being additionally re-certified via live proof in this plan — their existing "Complete" status in REQUIREMENTS.md reflects prior plans' (22-01..22-05) legitimate static-delivery completion, not this plan's live-verification scope.
- Downstream Phase 23 (Deterministic Typography) depends on the `text_blocks`/`layout_archetype_id` schema fields, which are already delivered and green (Phase 22-05) — Phase 23 planning is not blocked by Task 3's pending status, but the v1.6 milestone cannot be considered fully shipped until it resolves.

---
*Phase: 22-art-director-planning-upgrade*
*Completed: PARTIAL (Tasks 1-2 only) — 2026-07-27*

## Self-Check: PASSED

- FOUND: scripts/verify-phase-22.ts (modified, confirmed via git show --stat on commit c594918)
- FOUND: scripts/verify-planning-ablation.ts (created, confirmed via git show --stat on commit c8d57bf)
- FOUND commit: c594918
- FOUND commit: c8d57bf
- `npx tsx scripts/verify-phase-22.ts` exits 0, 54/54 PASS
- All 8 `--only=<tag>` filters exit 0 individually
- `npx tsx scripts/verify-phase-21.ts` exits 0 (43/43, no regression)
- `npx tsx scripts/verify-phase-21.1.ts` exits 0 (54/54, no regression)
- `npx tsx scripts/test-planning-schema-classification.ts` exits 0 (9/9)
- `npm run check` exits 0
- `npm run build` succeeds
- Task 3 correctly NOT recorded as complete

## Checkpoint Details (Task 3 — not performed)

See the "CHECKPOINT REACHED" report returned to the orchestrator for the full structured checkpoint (type: human-verify, gate: blocking). Summary: the operator must run the 6-step runbook embedded at the bottom of `scripts/verify-phase-22.ts` using a real, funded `OPENROUTER_API_KEY` (plus staging access and one paid Veo call for step 6): (1) `OPENROUTER_API_KEY=... npx tsx scripts/verify-planning-ablation.ts --image=./reference.jpg` and confirm `ABLATION PROVEN` with overlap <0.95; (2) generate one real single-image post in staging and confirm no `planning_schema_failure` row plus gateway cost in `usage_events.metadata`; (3) force a schema failure per the runbook's documented technique and confirm the SSE error text + `generation_logs` row + no post/usage_events rows; (4) GATE-07 rollback parity (direct Gemini with a reference image); (5) an 8-slide carousel with no truncation; (6) one video generation confirming the direct Google path and `ai_models.text_generation` (not `planning`) was used. On resume, a continuation agent should record the operator's per-step outcome in this file under a new "Manual verification (6-step runbook)" heading, and only then mark PLAN-01..04's live-verification scope complete / check the Phase 22 ROADMAP box — or otherwise stop and capture the failure verbatim per the plan's Task 3 instructions.
