---
phase: 21-openrouter-gateway-foundation
plan: 10
subsystem: billing
tags: [openrouter, billing, quota, generate, edit, recordUsageEvent]

# Dependency graph
requires:
  - phase: 21-openrouter-gateway-foundation (21-03)
    provides: recordUsageEvent(realCostUsdMicros?, estimatedCostMicros?) extended signature
  - phase: 21-openrouter-gateway-foundation (21-05)
    provides: ImageProviderResult.costUsdMicros field (image-provider.ts)
  - phase: 21-openrouter-gateway-foundation (21-07)
    provides: GeminiTextResponse.costUsdMicros field (gemini.service.ts generateText)
provides:
  - "/api/generate records summed real gateway cost (text + image) + pre-call estimate on completed image posts"
  - "/api/edit-post records the image-edit provider call's real gateway cost + pre-call estimate"
  - "Video generate/edit paths verified to never pass a partial real cost — flat fallback pricing preserved"
affects: [21-13 (final GATE-05 wiring verification), 21.1 (affiliate BYOK billing attribution)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "realCostUsdMicros computed as undefined (not 0) unless at least one leg reports a gateway cost, so token-table/fallback pricing is preserved on direct-path and video runs"
    - "Video content_type/isVideoPost branch always forces the real-cost arg to undefined before calling recordUsageEvent, preventing partial-cost billing on off-gateway video runs"

key-files:
  created: []
  modified:
    - server/routes/generate.routes.ts
    - server/routes/edit.routes.ts

key-decisions:
  - "buildTextFallback's return object gained an explicit costUsdMicros: undefined field so textResult's inferred union type (GeminiTextResponse | fallback) satisfies textResult.costUsdMicros access without a cast"
  - "editCostUsdMicros hoisted above the isVideoPost branch in edit.routes.ts (declared, not just used) so it's in scope at the later recordUsageEvent call regardless of which branch ran"

patterns-established:
  - "Cost-summing pattern for multi-call pipelines: sum optional per-call gateway costs into a single realCostUsdMicros, undefined when no leg reports one"

requirements-completed: [GATE-05]

# Metrics
duration: 5min
completed: 2026-07-27
---

# Phase 21 Plan 10: Wire Real Gateway Cost into Generate + Edit Billing Summary

**Single-image `/api/generate` and `/api/edit-post` now pass OpenRouter's real per-request cost (summed text+image, or edit-call cost) plus the pre-call credit estimate into `recordUsageEvent`, while video stays on flat fallback pricing.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-27T14:26:xxZ (session start)
- **Completed:** 2026-07-27T14:31:08Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments
- `generate.routes.ts` sums `textResult.costUsdMicros` + `imageResult?.costUsdMicros` into `realCostUsdMicros`, forced to `undefined` on video runs (`gatewayRealCost`), and passes it plus `creditStatus?.estimated_cost_micros` as the 6th/7th `recordUsageEvent` args.
- `edit.routes.ts` hoists `editCostUsdMicros` above the video/image branch, captures `result.costUsdMicros` from the image branch's `provider.edit()` call, and passes it plus `creditStatus?.estimated_cost_micros` into `recordUsageEvent`. Video edits leave it `undefined`.
- Both routes' token/model args to `recordUsageEvent` are unchanged — only new trailing args added (git diff hunks are additive-only, confirmed by review).
- `buildTextFallback` (the local text-generation fallback) now returns an explicit `costUsdMicros: undefined` field so its return type satisfies `GeminiTextResponse`-style access on the `textResult` union without needing a type cast.

## Task Commits

Each task was committed atomically:

1. **Task 1: generate.routes.ts — real cost (text + image) + estimate on the usage event** - `7d50b04` (feat)
2. **Task 2: edit.routes.ts — real edit-call cost + estimate on the usage event** - `8d9f5ab` (feat)

**Plan metadata:** (this commit) `docs(21-10): complete Wire Real Gateway Cost plan`

## Files Created/Modified
- `server/routes/generate.routes.ts` - computes `gatewayRealCost` (summed text+image cost, undefined on video) and passes it + `creditStatus?.estimated_cost_micros` into `recordUsageEvent`; `buildTextFallback` return gains `costUsdMicros: undefined`
- `server/routes/edit.routes.ts` - hoists `editCostUsdMicros`, captures it from the image-edit provider result, and passes it + `creditStatus?.estimated_cost_micros` into `recordUsageEvent`

## Decisions Made
- Added `costUsdMicros: undefined` to `buildTextFallback`'s return object (plan's stated contingency for the TypeScript union-type case) rather than casting `textResult` — keeps the fallback object's shape self-documenting and matches `GeminiTextResponse` structurally.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's literal code snippets; no TypeScript errors beyond the one contingency the plan already anticipated (buildTextFallback's `costUsdMicros` field), which was applied as specified.

## Issues Encountered

None. `npm run check` passed on the first attempt after each task; all acceptance-criteria `grep` checks matched on the first try.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- GATE-05's billing wiring is now live for the two highest-traffic paths (single-image generate, image edit). `scripts/verify-phase-21.ts` still reports GATE-05 as FAIL by design — that check is stubbed pending 21-13-PLAN.md's final cross-plan verification pass (per plan's own notes, this is expected and not a regression introduced by this plan).
- Carousel (21-11) and enhancement (21-12) billing wiring proceed independently — this plan touched only `generate.routes.ts` and `edit.routes.ts`, disjoint from their files.
- No blockers for 21-13 (final Phase 21 verification wiring).

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/routes/generate.routes.ts
- FOUND: server/routes/edit.routes.ts
- FOUND: .planning/phases/21-openrouter-gateway-foundation/21-10-SUMMARY.md
- FOUND commit: 7d50b04
- FOUND commit: 8d9f5ab
