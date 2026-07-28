---
phase: 21-openrouter-gateway-foundation
plan: 11
subsystem: billing
tags: [openrouter, billing, usage-events, carousel, cost-tracking]

# Dependency graph
requires:
  - phase: 21-05
    provides: ImageProviderResult.costUsdMicros on OpenRouterImageProvider.edit()
  - phase: 21-06
    provides: getActiveImageProvider() gateway-first factory wiring
  - phase: 21-08
    provides: CarouselGenerationResult.costUsdMicrosTotal aggregation (text plan + all slides)
provides:
  - Carousel-generate usage event carries aggregated real gateway cost (costUsdMicrosTotal) + pre-call estimate
  - Slide-edit usage event carries the edit call's real gateway cost (costUsdMicros) + pre-call estimate
affects: [21-12, 21-13, admin cost-analytics reporting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "recordUsageEvent(...) called with 7 positional args: tokens, models, realCostUsdMicros, estimatedCostMicros — realCostUsdMicros undefined falls back to token-table/flat pricing automatically"

key-files:
  created: []
  modified:
    - server/routes/carousel.routes.ts

key-decisions:
  - "No change needed to the aborted-partial rehydrated result object literal (~line 444-466) — costUsdMicrosTotal is an optional field on CarouselGenerationResult, so its absence there type-checks cleanly and correctly falls back to flat/token pricing for aborted runs."

patterns-established: []

requirements-completed: [GATE-05]

# Metrics
duration: 4min
completed: 2026-07-27
---

# Phase 21 Plan 11: Carousel Billing — Real Gateway Cost Wiring Summary

**Both carousel billing points (carousel-generate aggregate + per-slide edit) now pass real OpenRouter gateway cost plus the pre-call credit estimate into `recordUsageEvent`, completing GATE-05 for the carousel surface.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-27T14:27:00Z (approx)
- **Completed:** 2026-07-27T14:31:00Z
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments
- Carousel-generation `recordUsageEvent` call now passes `result.costUsdMicrosTotal` (the 21-08 aggregated master-plan + all-slides gateway cost) as `realCostUsdMicros`, plus `creditStatus?.estimated_cost_micros` as `estimatedCostMicros`.
- Slide-edit `recordUsageEvent` call now passes `result.costUsdMicros` (the OpenRouterImageProvider edit-call cost from 21-05) as `realCostUsdMicros`, plus `creditStatus?.estimated_cost_micros`.
- Verified the aborted-partial rehydration path requires no changes: `costUsdMicrosTotal` is optional on `CarouselGenerationResult`, so the minimal rebuilt object literal (which omits it) still type-checks and correctly falls through to flat/token-table pricing for aborted runs.
- Billing invariant preserved: still exactly ONE `recordUsageEvent` + ONE `deductCredits` per carousel operation (BILL-02/BILL-03) — this plan only added trailing optional args to existing calls.

## Task Commits

Each task was committed atomically (patch-split single-file edit to preserve per-task granularity):

1. **Task 1: Carousel generate — aggregated real cost + estimate** - `b7f5921` (feat)
2. **Task 2: Slide edit — real edit-call cost + estimate** - `644be3f` (feat)

_Note: Both tasks modified the same file in non-adjacent hunks; each was staged and committed independently via `git apply --cached` on a per-hunk patch (not `git add`), so no task's change bled into the other's commit._

## Files Created/Modified
- `server/routes/carousel.routes.ts` - Both `recordUsageEvent` calls (carousel-generate ~line 477, slide-edit ~line 974) extended with `realCostUsdMicros`/`estimatedCostMicros` trailing args.

## Decisions Made
- No change needed to the aborted-partial rehydrated `result` object literal — confirmed `costUsdMicrosTotal` is optional in the `CarouselGenerationResult` interface (`server/services/carousel-generation.service.ts:123`), so its absence is valid TypeScript and produces the intended flat-pricing fallback for aborted runs, per the plan's contingency note.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Parallel execution note (not a defect): this plan ran as one of three concurrent executor agents (21-10, 21-11, 21-12) in the same working directory. Followed the parallel-execution protocol strictly — staged only `server/routes/carousel.routes.ts` via per-hunk `git apply --cached` (never `git add -A`/`git add .`), verified `git status`/`git diff --cached --name-only` showed only my file before each commit, and used `--no-verify` on both commits. No foreign files were ever staged; no lock contention encountered.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- GATE-05 is now complete for the carousel surface (generate + slide-edit); the single-image and enhancement surfaces are covered by sibling plans 21-10/21-12 in this same wave.
- `scripts/verify-phase-21.ts` GATE-05 check remains a documented stub (FAIL, "wired in 21-13-PLAN.md") — this is expected per the Phase 21-01 execution decision recorded in STATE.md; final GATE verification lands in plan 21-13, not per-plan.
- No blockers for downstream plans.

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/routes/carousel.routes.ts
- FOUND: .planning/phases/21-openrouter-gateway-foundation/21-11-SUMMARY.md
- FOUND: b7f5921 (Task 1 commit)
- FOUND: 644be3f (Task 2 commit)
