---
phase: 24-visual-critic-and-re-roll
plan: 01
subsystem: infra
tags: [zod, verification-harness, openrouter, schema, ai-gateway]

# Dependency graph
requires:
  - phase: 21-openrouter-gateway-foundation
    provides: "ai-gateway.service.ts chatCompletion/callImageApi, FallbackCallClass/CallClass routing, ai_models admin-configurable slugs"
  - phase: 23-deterministic-typography-and-edit-fidelity
    provides: "generate.routes.ts pipeline shape the critic/re-roll loop will insert into (Wave 2 plans)"
provides:
  - "scripts/verify-phase-24.ts — the 6-tag Phase 24 gate harness (45 checks), honestly red for unwritten code, self-test proven non-vacuous"
  - "aiModelsSchema.critic (admin-configurable visual-critic model slug, default gemini-2.5-flash, live-verified structured-outputs + image modality)"
  - "generationLogSchema.event_kind 'visual_critic' (CRIT-05 observability target)"
  - "FallbackCallClass 'critic' + DEFAULT_FALLBACKS.critic: [] (fallback-chain-only, no GATE-07 routing widen)"
affects: [24-02, 24-03, 24-04, 24-05, 24-06, 24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase-gate harness pattern (scripts/verify-phase-NN.ts): --only= tag filter, readSafe() for not-yet-written target files, self-test proves the scanner isn't vacuous, PASS/FAIL summary with process.exit(1)"
    - "Additive Zod .default() widen backfills existing stored rows via safeParse — no migration needed for JSONB-backed settings (platform_settings.style_catalog, generation_logs.event_kind TEXT column)"

key-files:
  created:
    - scripts/verify-phase-24.ts
  modified:
    - shared/schema.ts
    - server/services/ai-gateway-settings.service.ts
    - client/src/components/admin/post-creation/ai-models-card.tsx

key-decisions:
  - "verify-phase-24.ts self-test checks 3/4 assert the harness is WIRED to require 24-05's two Wave 0 scripts (not that those scripts already exist) — this keeps --only=self-test green today per the must_haves.truths requirement, while the honest existence assertions live inside [svc-reroll-logic]/[svc-critic-call] where red-until-24-05 is expected and correct"
  - "ai_models.critic defaults to gemini-2.5-flash (flash tier, not planning's Pro tier) because the critic runs 1-3 times per generation vs planning's once — live-verified against the OpenRouter catalog, see evidence below"
  - "FallbackCallClass widened with critic; CallClass (GATE-07 routing union) deliberately NOT widened — 24-CONTEXT.md locks the critic as OpenRouter-only with no direct-Gemini rollback path"

patterns-established:
  - "Wave-1-only plan installs the phase gate + zero-risk type/enum widens before any Wave-2 plan writes real logic against a stable contract"

requirements-completed: [CRIT-01, CRIT-02, CRIT-03, CRIT-04, CRIT-05]

# Metrics
duration: ~15min (this session; Task 1 was completed and committed in a prior session, see Continuation Note)
completed: 2026-07-28
---

# Phase 24 Plan 01: Verification Harness + Schema/Type Widens Summary

**Installed the 6-tag, 45-check `scripts/verify-phase-24.ts` phase gate and three additive, zero-migration widens (`ai_models.critic`, `event_kind: "visual_critic"`, `FallbackCallClass "critic"`) that every later Phase 24 plan compiles and verifies against.**

## Performance

- **Duration:** ~15 min this session (Task 1 executed and committed in a prior, interrupted session — see Continuation Note below)
- **Completed:** 2026-07-28T03:09:16Z
- **Tasks:** 3/3 complete
- **Files modified:** 4 (1 created, 3 modified)

## Continuation Note

This execution resumed mid-plan. On start, `git log` showed Task 1 already committed (`15adf09`), and the working tree already carried an uncommitted Task 2 diff to `shared/schema.ts` matching the plan's exact spec (including the live-verification comment). This agent: (1) verified Task 1's harness still meets every acceptance criterion, (2) discovered and fixed a `npm run check` regression the uncommitted Task 2 diff had introduced, then committed Task 2, (3) executed and committed Task 3 fresh. No task work was redone; no commits were duplicated.

## Accomplishments
- `scripts/verify-phase-24.ts` (650 lines) exists with all 6 tags (`self-test`, `svc-critic-call`, `svc-reroll-logic`, `svc-billing-reroll`, `svc-abort-signal`, `svc-observability`), 45 `check(` call sites, and loads every not-yet-written Phase 24 target file via `readSafe` so it never throws
- `--only=self-test` exits 0 with exactly 5 PASS lines; full suite exits 1 with 11 PASS / 33 FAIL and zero uncaught exceptions — every failure names a real, not-yet-written artifact (visual-critic.service.ts, quota.ts extraMetadata, AbortSignal threading, logVisualCritic, etc.)
- `--only=svc-abort-signal` shows check 9 (the functional `isFallbackWorthy` regex re-execution) as the sole PASS among 10 checks, exactly as specified
- `aiModelsSchema.critic` and `generationLogSchema.event_kind: "visual_critic"` are legal values with zero migration required
- `FallbackCallClass` widened to include `"critic"`; `CallClass` (GATE-07 routing union) explicitly left untouched with an in-code comment explaining the scope boundary
- `npm run check` exits 0; zero regression on `verify-phase-21.ts`, `verify-phase-21.1.ts`, `verify-phase-22.ts`, `verify-phase-23.ts` (all still green)

## Task Commits

1. **Task 1: Create scripts/verify-phase-24.ts — the 6-tag phase gate** - `15adf09` (feat) — completed in a prior session, verified intact this session, no new commit needed
2. **Task 2: Widen shared/schema.ts — ai_models.critic + event_kind "visual_critic"** - `26118d6` (feat) — includes the Rule 3 blocking-issue fix to `ai-models-card.tsx`
3. **Task 3: Widen FallbackCallClass with "critic"** - `61e3ead` (feat)

_Note: no separate TDD-style test→feat commits — this plan is schema/harness widening, not TDD._

## Files Created/Modified
- `scripts/verify-phase-24.ts` - The Phase 24 gate harness: 6 tags, 45 checks, `--only=` filter, `readSafe`-loaded sources, self-test non-vacuity proof
- `shared/schema.ts` - `aiModelsSchema.critic` (default `gemini-2.5-flash`) + `generationLogSchema.event_kind` gains `"visual_critic"`
- `server/services/ai-gateway-settings.service.ts` - `FallbackCallClass` widened with `"critic"`; `DEFAULT_FALLBACKS.critic: []`; scope-boundary comment added
- `client/src/components/admin/post-creation/ai-models-card.tsx` - Local `ai_models` fallback literal gained `critic: "gemini-2.5-flash"` (compile-fix only, no new UI — plan 24-04 owns the selector)

## OpenRouter Catalog Live Re-Verification (24-RESEARCH Pitfall 6)

Per the plan's Task 2 step 2, re-verified live (this session, 2026-07-28) rather than trusting the inherited comment:

```
curl -s "https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs"
```

Result (parsed programmatically, not eyeballed):
- HTTP 200, 254 models returned in the `structured_outputs`-filtered catalog
- `google/gemini-2.5-flash` IS present in that filtered set (confirms `structured_outputs` support)
- Its `architecture.input_modalities` = `["file","image","text","audio","video"]` — contains `"image"`

**Conclusion: `google/gemini-2.5-flash` is confirmed live-capable for both requirements (structured_outputs + image input) as of this session.** The default slug and the in-code comment (which independently claimed the identical "254 models, image modality present" result from the prior session) are consistent — no substitution needed.

## Decisions Made
- Kept the inherited `ai_models.critic` default (`gemini-2.5-flash`) after independently re-confirming it live rather than assuming the prior session's uncommitted comment was accurate
- Fixed the `ai-models-card.tsx` type-check regression as a Rule 3 (blocking issue) auto-fix rather than expanding scope to add a "Visual Critic" selector — that UI is explicitly plan 24-04's responsibility per its own PLAN.md
- Committed the compile-fix together with the schema widen (same causal chain: the widen required it) rather than as a separate commit

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `ai-models-card.tsx` fallback literal missing new required `critic` field**
- **Found during:** Task 2 verification (`npm run check`)
- **Issue:** `aiModelsSchema.critic` uses `z.string().default(...)`, which makes `AIModels` (the `z.infer` OUTPUT type) require `critic: string` unconditionally — not optional. `ai-models-card.tsx`'s local `ai_models` fallback object (used when `catalog.ai_models` is falsy) predates Phase 24 and didn't declare `critic`, so `setCatalog`'s merged object type no longer satisfied `StyleCatalog`, breaking `npm run check`.
- **Fix:** Added `critic: "gemini-2.5-flash"` to the fallback literal, mirroring the existing `planning` field's pattern. No new Select/UI control added — plan 24-04 owns the "Visual Critic" admin selector.
- **Files modified:** `client/src/components/admin/post-creation/ai-models-card.tsx`
- **Verification:** `npm run check` exits 0
- **Committed in:** `26118d6` (part of Task 2 commit)

---

**2. [Judgment call — REQUIREMENTS.md accuracy] Did NOT run `requirements mark-complete` for CRIT-01..05**
- **Found during:** State-update step (post-Task-3)
- **Issue:** This plan's frontmatter lists `requirements: [CRIT-01, CRIT-02, CRIT-03, CRIT-04, CRIT-05]` — the full set for the phase — but the plan's own objective/must_haves only deliver the verification harness and additive schema/type widens (enabling conditions for later plans), not the actual multimodal-critic call, re-roll loop, billing-metadata tracking, AbortSignal threading, or `logVisualCritic` observability those requirements describe. `scripts/verify-phase-24.ts` itself proves this: 33/44 non-self-test checks are honestly red today. The analogous Phase 23 Wave-1 infra plan (23-01) scoped its `requirements:` field narrowly (`[TYPO-02, TYPO-04]`, not all 7 TYPO-*), and even those weren't marked "Complete" in REQUIREMENTS.md until their real delivery plans (23-04, 23-08) landed.
- **Action taken:** Skipped `node gsd-tools.cjs requirements mark-complete CRIT-01 CRIT-02 CRIT-03 CRIT-04 CRIT-05`. REQUIREMENTS.md's CRIT-01..05 rows remain `Pending` — accurate to actual delivery state. The SUMMARY frontmatter's `requirements-completed` field still lists all 5 IDs per the template's literal instruction ("copy ALL requirement IDs from this plan's requirements frontmatter field") — that field tracks association for the dependency graph, not verified completion.
- **Files modified:** None (a non-action)
- **Verification:** `grep CRIT-0 .planning/REQUIREMENTS.md` still shows all 5 as `- [ ]` / `Pending`
- **Committed in:** N/A (no REQUIREMENTS.md change made)

---

**Total deviations:** 1 auto-fixed (1 blocking), 1 judgment call (protecting requirements-traceability accuracy)
**Impact on plan:** The compile-fix was necessary to satisfy the plan's own acceptance criterion ("`npm run check` exits 0"), no scope creep. The requirements decision keeps REQUIREMENTS.md truthful; plans 24-02..24-07 (whichever actually deliver each CRIT-NN's behavior) should mark them complete when their own verification is green.

## Issues Encountered
None beyond the documented deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 2 plans (24-02..24-06) can now write real code against a stable, compiling contract: `"critic"` is legal in both `ai_models` and `FallbackCallClass`, `event_kind: "visual_critic"` is legal, and `scripts/verify-phase-24.ts` exists as the shared, append-only gate they must turn green (they must NOT edit this file themselves — only 24-07 extends it with the 7th `[svc-cross-plan]` tag).
- No blockers. `npx tsx scripts/verify-phase-24.ts` is honestly red today; every one of its 33 failures names a real, not-yet-written artifact from a specific later plan.

---
*Phase: 24-visual-critic-and-re-roll*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: scripts/verify-phase-24.ts
- FOUND: shared/schema.ts
- FOUND: server/services/ai-gateway-settings.service.ts
- FOUND: client/src/components/admin/post-creation/ai-models-card.tsx
- FOUND: 15adf09 (Task 1 commit)
- FOUND: 26118d6 (Task 2 commit)
- FOUND: 61e3ead (Task 3 commit)
