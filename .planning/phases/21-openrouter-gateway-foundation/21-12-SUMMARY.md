---
phase: 21-openrouter-gateway-foundation
plan: 12
subsystem: billing
tags: [openrouter, billing, quota, express, enhancement]

# Dependency graph
requires:
  - phase: 21-openrouter-gateway-foundation (21-03)
    provides: recordUsageEvent(realCostUsdMicros?, estimatedCostMicros?) signature
  - phase: 21-openrouter-gateway-foundation (21-08)
    provides: EnhancementResult.costUsdMicrosTotal (aggregated gateway cost across pre-screen + edit + caption)
provides:
  - Enhancement route's recordUsageEvent call now passes real aggregated gateway cost + pre-call estimate
affects: [21-13 (final phase verification/wiring), billing/GATE-05 audit]

# Tech tracking
tech-stack:
  added: []
  patterns: [aggregated realCostUsdMicros + estimatedCostMicros passed positionally to recordUsageEvent, matching 21-09/21-11's pattern]

key-files:
  created: []
  modified: [server/routes/enhance.routes.ts]

key-decisions:
  - "Followed the plan's literal interface exactly — no discovery needed since 21-08 had already added costUsdMicrosTotal to EnhancementResult and 21-03 already added the two trailing params to recordUsageEvent."

patterns-established:
  - "GATE-05 aggregated-cost billing pattern is now uniform across all 6 operation surfaces: result.costUsdMicrosTotal (or equivalent) + creditStatus?.estimated_cost_micros appended positionally to recordUsageEvent."

requirements-completed: [GATE-05]

# Metrics
duration: 4min
completed: 2026-07-27
---

# Phase 21 Plan 12: Enhancement Billing — Aggregated Gateway Cost Summary

**Enhancement's single `recordUsageEvent` call now carries `result.costUsdMicrosTotal` (aggregated pre-screen + edit + caption gateway cost) plus `creditStatus?.estimated_cost_micros`, completing GATE-05 across all six operation surfaces (generate, edit, carousel, slide-edit, enhance, transcribe).**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-27T14:26:xxZ
- **Completed:** 2026-07-27T14:29:15Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Enhancement route's billing call now reflects real per-request OpenRouter cost (when the gateway path ran) instead of only static token-table pricing
- GATE-05 (real per-request cost consumed by billing) is now wired on every paid AI operation surface in the codebase

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhancement usage event — aggregated real cost + estimate** - `2127507` (feat)

**Plan metadata:** (this commit, to follow)

## Files Created/Modified
- `server/routes/enhance.routes.ts` - `recordUsageEvent` call in the `/api/enhance` billing block gained two trailing positional args: `result.costUsdMicrosTotal` (realCostUsdMicros) and `creditStatus?.estimated_cost_micros` (estimatedCostMicros). Tokens/models args unchanged.

## Decisions Made
None - plan executed exactly as written. The interface (`recordUsageEvent`'s trailing params from 21-03, `EnhancementResult.costUsdMicrosTotal` from 21-08) was already correct and verified via read_first before editing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All six operation surfaces (generate, edit, carousel, slide-edit, enhance, transcribe) now pass real gateway cost + pre-call estimate into `recordUsageEvent`. GATE-05 is functionally complete.
- `scripts/verify-phase-21.ts` still reports GATE-05 as FAIL — this is expected per the phase's design: the check is intentionally stubbed to fail until 21-13-PLAN.md performs final phase-wide verification/wiring confirmation. GATE-08 (video freeze) continues to pass (3/3).
- No blockers for 21-13.

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/routes/enhance.routes.ts
- FOUND: .planning/phases/21-openrouter-gateway-foundation/21-12-SUMMARY.md
- FOUND: commit 2127507
