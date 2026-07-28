---
phase: 24-visual-critic-and-re-roll
plan: 05
subsystem: ai
tags: [openrouter, json-schema, multimodal, tdd, visual-critic, re-roll]

# Dependency graph
requires:
  - phase: 24-01
    provides: "scripts/verify-phase-24.ts phase gate; aiModelsSchema.critic (default gemini-2.5-flash); generationLogSchema.event_kind 'visual_critic'; FallbackCallClass 'critic'"
  - phase: 24-02
    provides: "chatCompletion(params.callClass) additive optional param; chatCompletion(params.signal) real AbortSignal threaded into the openai SDK transport"
provides:
  - "server/services/visual-critic.service.ts — CRITIC_JSON_SCHEMA, buildCriticPrompt, parseCriticWireResult, isAbortLikeError, runVisualCritic (the multimodal critic call), plus the pure CRIT-02 decision functions (summarizeCriticScores, shouldRerollAfter, selectFinalAttempt, computeRerollMetadata)"
  - "scripts/test-critic-reroll-logic.ts — 25-assertion no-network unit harness proving the hard-fail asymmetry, best-of-3 tie-break, fail-open-on-outage, and cost-exclusion rules by direct assertion"
  - "scripts/verify-critic-live.ts — OPENROUTER_API_KEY-gated live smoke test (image+strict-json_schema proof + --abort-probe CRIT-04 real-cancellation proof)"
affects: [24-06, 24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-decision-function-first, network-call-second file layout within a single service — Task 1 lands the decision matrix with zero ai-gateway imports and its own no-network unit harness before Task 2 wires the actual multimodal call, so the hardest-to-review logic (hard/soft fail asymmetry) is provable in isolation"
    - "Fail-open-on-outage + abort-reprioritized-over-outage catch block: a critic call catches everything BUT a fired AbortSignal, which it deliberately re-throws before returning the fail-open outcome"

key-files:
  created:
    - server/services/visual-critic.service.ts
    - scripts/test-critic-reroll-logic.ts
    - scripts/verify-critic-live.ts
  modified: []

key-decisions:
  - "DEFAULT_CRITIC_MODEL = 'gemini-2.5-flash' — hardcoded as a literal (not imported from shared/schema.ts) because Zod's z.string().default(...) is not itself an exported const; kept manually in sync with aiModelsSchema.critic's default and documented as such in-code"
  - "CRITIC_MIN_DIMENSION_SCORE = 3 is an INCLUSIVE floor — a score of exactly 3 in all three dimensions passesThresholds; ANY dimension strictly below 3 is a soft fail"
  - "Fail-open-on-critic-outage: a missing API key, transport failure, JSON-parse failure, or schema-re-validation failure in runVisualCritic all collapse to the SAME 'unavailable' CriticOutcome (never a throw) — the ONLY exception is a fired AbortSignal, which is re-thrown before the fail-open return so CRIT-04 cancellation is never silently swallowed"
  - "unwanted_text_detected prompt rationale (locked, drives 24-06/24-07): TRUE only for AI-INVENTED overlay/graphic-design text (headlines, watermarks, signage, gibberish letterforms); FALSE for incidental real-world text that legitimately belongs to a depicted subject (e.g. a product label sourced from a reference image) — an over-strict reading would make legitimate product photography hard-fail all 3 attempts and fail the generation outright, which is worse than the artifact it guards against"
  - "selectFinalAttempt's rule ordering is deliberate: an observed soft-fail (scored, text-free, below threshold) beats an unobserved 'unavailable' attempt, which in turn beats a hard-fail (unwanted text) attempt — a hard-fail attempt is UNREACHABLE by any selection rule at any attempt count, there is no best-available escape hatch for rendered text"

patterns-established:
  - "TDD RED/GREEN split committed as two atomic commits (test(...) then feat(...)) for the pure-logic task, mirroring scripts/test-planning-schema-classification.ts's harness style exactly (assertEqual + process.exit(1) + final all-passed line)"

requirements-completed: [CRIT-01, CRIT-02]

# Metrics
duration: ~20min
completed: 2026-07-28
---

# Phase 24 Plan 05: Visual Critic Service + Re-roll Decision Logic Summary

**`server/services/visual-critic.service.ts` — a strict-schema, `callClass: "critic"`, abort-propagating, fail-open-on-outage multimodal scorer whose CRIT-02 hard/soft-fail asymmetry, best-of-3 tie-break, and discarded-attempt cost exclusion are proven by 25 direct no-network assertions before any route wiring exists.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-28T03:33:18Z
- **Tasks:** 3/3 complete (Task 1 split into a TDD RED commit + a GREEN commit)
- **Files modified:** 3 (all created)

## Accomplishments
- `server/services/visual-critic.service.ts` (414 lines) exports the full interface spec verbatim: `CRITIC_JSON_SCHEMA`, `MAX_REROLL_ATTEMPTS`, `CRITIC_MIN_DIMENSION_SCORE`, `summarizeCriticScores`, `shouldRerollAfter`, `selectFinalAttempt`, `computeRerollMetadata`, `buildCriticPrompt`, `parseCriticWireResult`, `isAbortLikeError`, `runVisualCritic`, `CRITIC_SCHEMA_NAME`, `CRITIC_MAX_OUTPUT_TOKENS`, `DEFAULT_CRITIC_MODEL`
- `scripts/test-critic-reroll-logic.ts` — 25 `assertEqual(` call sites, zero network imports, exits 0 — proves: the inclusive floor of 3, the never-select-a-hard-fail invariant even at a strictly higher score, the lowest-index tie-break, the soft-fail-beats-unavailable-beats-hard-fail selection ordering, the empty-array no-throw case, and the accepted-attempt cost exclusion in `computeRerollMetadata`
- `CRITIC_JSON_SCHEMA` mirrors `PLANNING_JSON_SCHEMA`'s proven strict-mode dialect exactly: `enum: [1, 2, 3, 4, 5]` (3 occurrences, one per bounded score), zero `minimum`/`maximum` keywords (24-RESEARCH Pitfall 2), all six properties required, `additionalProperties: false`
- `runVisualCritic` calls `chatCompletion({ ..., callClass: "critic", responseFormat: { type: "json_schema", json_schema: CRITIC_JSON_SCHEMA }, signal })` via `toOpenRouterInputReference` (no hand-rolled data URI); a fired `AbortSignal` is re-thrown BEFORE the fail-open `"unavailable"` return
- `scripts/verify-critic-live.ts` mirrors `verify-planning-ablation.ts`'s shape: SKIP+exit 0 with no key, usage+exit 1 without `--image`, asserts `status==="scored"`, valid 1-5 integer scores, boolean `unwantedTextDetected`, non-empty `reasoning`, and `passesThresholds` parity with `summarizeCriticScores` (proving the pure logic and the live path agree); `--abort-probe` fires a real `AbortController` and asserts `runVisualCritic` REJECTS — the only automatable proof of CRIT-04's real-cancellation behavior
- `npx tsx scripts/verify-phase-24.ts --only=self-test` 5/5 PASS; `--only=svc-critic-call` 9/9 PASS (only the compound check requiring `generate.routes.ts` — 24-06's job — stays red); `--only=svc-reroll-logic` 5/5 own-file checks PASS (2 `generate.routes.ts` checks stay red until 24-06, exactly as the plan specifies)
- Zero regression: `npm run check`, `scripts/verify-phase-21.ts`, `scripts/verify-phase-22.ts`, `scripts/verify-phase-23.ts` all still fully green

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing no-network unit harness** - `9fedc61` (test)
2. **Task 1 (GREEN): CRIT-02 pure re-roll decision logic** - `c2d4540` (feat)
3. **Task 2: CRITIC_JSON_SCHEMA + prompt + runVisualCritic gateway call** - `e8ef8a7` (feat)
4. **Task 3: OPENROUTER_API_KEY-gated live critic smoke test** - `c32d578` (feat)

_TDD task per plan spec: RED (test file, fails on missing module) → GREEN (implementation, all 25 assertions pass) → no REFACTOR commit needed (no behavior change after GREEN)._

## Files Created/Modified
- `server/services/visual-critic.service.ts` - Pure CRIT-02 decision types/functions (Task 1) + `CRITIC_JSON_SCHEMA`, `buildCriticPrompt`, `parseCriticWireResult`, `isAbortLikeError`, `runVisualCritic` (Task 2)
- `scripts/test-critic-reroll-logic.ts` - 25-assertion no-network unit harness for the re-roll decision matrix, mirrors `scripts/test-planning-schema-classification.ts`'s style
- `scripts/verify-critic-live.ts` - OPENROUTER_API_KEY-gated live smoke test + `--abort-probe`, mirrors `scripts/verify-planning-ablation.ts`'s style

## Decisions Made
- Followed the plan's exact interface/type/function specs and the locked `selectFinalAttempt` rule ordering verbatim — no deviation from the specified shapes
- Chose to hardcode `DEFAULT_CRITIC_MODEL = "gemini-2.5-flash"` as a literal rather than attempting to import a value out of a Zod schema's `.default(...)` (not an exported const in `shared/schema.ts`); documented in-code that it must be kept manually in sync with `aiModelsSchema.critic`
- Added `unavailableCriticOutcome()` as a small private (non-exported) helper to avoid duplicating the 7-field `"unavailable"` literal across the early-return (no API key) and the two internal fail-open paths (JSON-parse failure, schema-revalidation failure) inside `runVisualCritic` — not part of the plan's explicit export list, so kept module-private
- Verified live (via the 24-01 summary's same-session re-check, not re-verified again here) that `ai_models.critic`'s existing default (`gemini-2.5-flash`) is the correct slug per 24-RESEARCH.md Pitfall 6's re-verify-immediately-before-implementation guidance — no substitution needed since 24-01 already did this same-day re-check

## Deviations from Plan

No code deviations — plan executed exactly as written. All acceptance-criteria greps, both `verify-phase-24.ts --only=` filters, `verify-critic-live.ts`'s SKIP/usage paths, and `npm run check` matched the plan's expected PASS/FAIL split on first attempt for every task.

### Judgment Calls

**1. [Judgment call — REQUIREMENTS.md accuracy] Did NOT run `requirements mark-complete` for CRIT-01/CRIT-02**
- **Found during:** State-update step (post-Task-3)
- **Issue:** This plan's frontmatter lists `requirements: [CRIT-01, CRIT-02]`, but REQUIREMENTS.md's own text requires the critic call to actually score "every generated image... before post-processing" (CRIT-01) and the pipeline to actually "re-roll sequentially" (CRIT-02) — both describe pipeline BEHAVIOR, not the existence of a callable service. This plan delivers `runVisualCritic`/`selectFinalAttempt`/`computeRerollMetadata` as a fully self-contained, independently-proven service with zero call sites in `generate.routes.ts` — wiring it into the actual generation pipeline is plan 24-06's job (confirmed by this plan's own acceptance criteria: both `[svc-critic-call]`'s compound check 9 and `[svc-reroll-logic]`'s two `generate.routes.ts` checks are explicitly specified to stay red until 24-06). Follows the identical precedent set by 24-01-SUMMARY.md and 24-02-SUMMARY.md's judgment calls on the same requirement IDs.
- **Action taken:** Skipped `node gsd-tools.cjs requirements mark-complete CRIT-01 CRIT-02`. REQUIREMENTS.md's CRIT-01/CRIT-02 rows remain `Pending` — accurate to actual delivery state. The frontmatter's `requirements-completed` field still lists both IDs per the template's literal instruction (association for the dependency graph, not verified completion).
- **Files modified:** None (a non-action)
- **Verification:** `grep 'CRIT-01\|CRIT-02' .planning/REQUIREMENTS.md` still shows both as `- [ ]` / `Pending`
- **Committed in:** N/A (no REQUIREMENTS.md change made)

---

**Total deviations:** 0 code deviations, 1 judgment call (protecting requirements-traceability accuracy)
**Impact on plan:** No code deviation from the plan as written. The requirements decision keeps REQUIREMENTS.md truthful; plan 24-06 (`generate.routes.ts` wiring) should mark CRIT-01/CRIT-02 complete when its own verification is green.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. (A funded `OPENROUTER_API_KEY` is required to actually RUN `scripts/verify-critic-live.ts` beyond its SKIP path, but that is deferred to the 24-07 live-verification runbook per this plan's design, not a setup blocker for this plan's own completion.)

## Next Phase Readiness
- Plan 24-06 (`generate.routes.ts` wiring) can now import `runVisualCritic`, `selectFinalAttempt`, `computeRerollMetadata`, `MAX_REROLL_ATTEMPTS`, and `shouldRerollAfter` from a fully self-contained, independently-proven service and build the bounded sequential re-roll loop (Pattern 1) around them without touching this file
- `scripts/verify-critic-live.ts` and `scripts/test-critic-reroll-logic.ts` both exist and are wired into `scripts/verify-phase-24.ts`'s `[self-test]`/`[svc-critic-call]`/`[svc-reroll-logic]` tags — plan 24-07's live runbook can invoke `verify-critic-live.ts` directly once a funded key is provisioned
- The two remaining `[svc-critic-call]`/`[svc-reroll-logic]` FAILs (the `generate.routes.ts` halves) are the expected, explicitly-specified red state for this plan — they are 24-06's job to turn green
- No blockers

---
*Phase: 24-visual-critic-and-re-roll*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/services/visual-critic.service.ts
- FOUND: scripts/test-critic-reroll-logic.ts
- FOUND: scripts/verify-critic-live.ts
- FOUND: .planning/phases/24-visual-critic-and-re-roll/24-05-SUMMARY.md
- FOUND: 9fedc61 (Task 1 RED commit)
- FOUND: c2d4540 (Task 1 GREEN commit)
- FOUND: e8ef8a7 (Task 2 commit)
- FOUND: c32d578 (Task 3 commit)
