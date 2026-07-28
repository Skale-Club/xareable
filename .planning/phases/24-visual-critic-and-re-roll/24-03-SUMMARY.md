---
phase: 24-visual-critic-and-re-roll
plan: 03
subsystem: billing
tags: [billing, observability, quota, generation-logs, supabase]

# Dependency graph
requires:
  - phase: 24-01
    provides: "scripts/verify-phase-24.ts phase gate; generationLogSchema.event_kind widened with 'visual_critic'"
provides:
  - "recordUsageEvent(..., extraMetadata?) — additive 8th param, namespaced platform-side metadata passthrough that provably cannot reach the charged amount"
  - "logVisualCritic(params) + VisualCriticLogParams — fire-and-forget critic-outcome emitter following the logCaptionQuality contract, FK-safe nullable postId"
affects: [24-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive LAST-position optional param on a widely-called billing function (extraMetadata) — all 6 existing call sites keep compiling untouched"
    - "hasGatewayMeta gate widened to also fire on non-empty extraMetadata so platform-only metadata (no cost fields) is never silently dropped to null"

key-files:
  created: []
  modified:
    - server/quota.ts
    - server/services/observability.service.ts

key-decisions:
  - "hasGatewayMeta and its regex-matched acceptance check required the '=' and the first operand to share a line (not '=\\n    typeof...') — restructured to a single-line lead operand so scripts/verify-phase-24.ts's line-based regex (which the plan itself authored) actually captures the expression; functionally identical, purely a formatting fix to satisfy the harness"
  - "Kept extraMetadata spread AFTER the two existing metadata keys (estimated_cost_usd_micros, real_cost_usd_micros) per the plan's explicit ordering requirement, with an in-code comment barring callers from reusing those two key names"

patterns-established:
  - "Billing pricing invariant comment: an explicit code comment on the `pricing` const in recordUsageEvent states extraMetadata is write-only into the metadata JSON column and must never be folded into cost_usd_micros/charged_amount_micros — guards future editors from breaking the CRIT-03 charge-immutability guarantee"

requirements-completed: [CRIT-03, CRIT-05]

# Metrics
duration: ~12min
completed: 2026-07-28
---

# Phase 24 Plan 03: Billing Metadata Passthrough + Visual Critic Observability Summary

**`recordUsageEvent` gained an additive, namespaced `extraMetadata` passthrough that provably cannot influence the charged amount, and `observability.service.ts` gained `logVisualCritic()` — a fourth fire-and-forget emitter following the exact `logCaptionQuality` contract, ready for plan 24-06 to wire into the re-roll loop.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-28T03:18:44Z
- **Tasks:** 2/2 complete
- **Files modified:** 2

## Accomplishments
- `server/quota.ts`'s `recordUsageEvent` gained an 8th, LAST, optional `extraMetadata?: Record<string, unknown>` param — confirmed all 6 real call sites (`generate.routes.ts:880`, `edit.routes.ts:799`, `carousel.routes.ts:510` AND `:1030`, `enhance.routes.ts:438`, `transcribe.routes.ts:210`) plus the declaration remain the only 7 `recordUsageEvent(` matches in `server/`, byte-unchanged except `quota.ts`
- `hasGatewayMeta` widened to also fire on a non-empty `extraMetadata` so platform-only metadata is never silently dropped to `null`
- `extraMetadata` spread into the metadata literal LAST, with an in-code comment barring callers from reusing `estimated_cost_usd_micros`/`real_cost_usd_micros`
- Added an explicit invariant comment on the `pricing` const stating `extraMetadata` is write-only into `metadata` and must never feed the charged amount
- `server/services/observability.service.ts` gained `VisualCriticLogParams` + `logVisualCritic()`, mirroring `logCaptionQuality`'s exact shape (createAdminSupabase, single insert, try/catch swallow, `Promise<void>`, never throws); `postId` is nullable by construction for the hard-fail path since `generation_logs.post_id` is a real FK to `posts(id)`
- Module header comment updated: `logVisualCritic` bullet added in the established style, "all three SWALLOW errors" corrected to "all SWALLOW errors" (now four emitters)
- `scripts/verify-phase-24.ts --only=svc-billing-reroll` 6/6 PASS; `--only=svc-observability` 4/4 PASS (checks 5-6 correctly stay red — call sites land in plan 24-06)
- Zero regression: `verify-phase-16.ts`, `verify-phase-21.ts`, `verify-phase-22.ts`, `verify-phase-23.ts` all exit 0; `npm run check` exits 0

## Task Commits

Each task was committed atomically:

1. **Task 1: recordUsageEvent gains an extraMetadata passthrough** - `9e850de` (feat)
2. **Task 2: Add logVisualCritic to observability.service.ts** - `2f6c451` (feat)

## Files Created/Modified
- `server/quota.ts` - `recordUsageEvent` gains additive `extraMetadata?: Record<string, unknown>` param, widened `hasGatewayMeta` guard, namespaced metadata spread, pricing-invariant comment
- `server/services/observability.service.ts` - New `logVisualCritic()` + `VisualCriticLogParams`; module header comment updated to include the new emitter

## Decisions Made
- Restructured `hasGatewayMeta`'s multi-line boolean expression so its first operand shares the `const hasGatewayMeta = ` line, rather than starting on the next line — `scripts/verify-phase-24.ts`'s `/const hasGatewayMeta = ([^;]+);/` regex (line-anchored on a literal `"= "`) failed to match when the assignment's value started on a new line with no trailing space after `=`. Functionally identical output; pure formatting fix to satisfy the plan's own verification harness. Verified via a standalone Node regex test before and after.
- Kept `extraMetadata` spread strictly LAST in the metadata literal per the plan's explicit anti-shadowing requirement, with an in-code comment enforcing the `reroll_*`/`critic_*` namespace convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `hasGatewayMeta` multi-line formatting broke the plan's own verification regex**
- **Found during:** Task 1 verification (`npx tsx scripts/verify-phase-24.ts --only=svc-billing-reroll`)
- **Issue:** The plan's action block specified `hasGatewayMeta`'s value starting on a new line after `const hasGatewayMeta =`. Written that way, `scripts/verify-phase-24.ts`'s regex `/const hasGatewayMeta = ([^;]+);/` (which requires a literal space immediately after `=`) failed to match, since the next character was a newline, not a space — the check "quota.ts hasGatewayMeta also fires on a non-empty extraMetadata" reported FAIL despite the code being functionally correct.
- **Fix:** Moved the first operand (`typeof realCostUsdMicros === "number" ||`) onto the same line as `const hasGatewayMeta = `, keeping the remaining `||` operands on subsequent lines. No behavior change — same boolean expression, same evaluation order.
- **Files modified:** `server/quota.ts`
- **Verification:** Standalone Node regex test confirmed the match; `npx tsx scripts/verify-phase-24.ts --only=svc-billing-reroll` now shows 6/6 PASS
- **Committed in:** `9e850de` (Task 1 commit)

---

**2. [Judgment call — REQUIREMENTS.md accuracy] Did NOT run `requirements mark-complete` for CRIT-03/CRIT-05**
- **Found during:** State-update step (post-Task-2)
- **Issue:** This plan's frontmatter lists `requirements: [CRIT-03, CRIT-05]`, but the plan's own objective is explicit: it builds "the two support surfaces plan 24-06's re-roll loop writes into" — `extraMetadata` and `logVisualCritic` are additive, unwired mechanisms. CRIT-03 ("platform-side re-roll cost is tracked in the usage event metadata") and CRIT-05 ("critic outcomes ... logged to generation_logs — compliance rate is measurable") both describe an actually-occurring runtime behavior, which only exists once the re-roll loop (24-05/24-06) calls these functions with real data. `verify-phase-24.ts --only=svc-observability` proves this: checks 5-6 (call-site wiring, FK-safe hard-fail invocation) are still red after this plan, by design. Same precedent as 24-01's identical judgment call for CRIT-01..05.
- **Action taken:** Skipped `node gsd-tools.cjs requirements mark-complete CRIT-03 CRIT-05`. REQUIREMENTS.md's CRIT-03/CRIT-05 rows remain `Pending` — accurate to actual delivery state.
- **Files modified:** None (a non-action)
- **Verification:** `grep CRIT-0 .planning/REQUIREMENTS.md` still shows both as `- [ ]` / `Pending`
- **Committed in:** N/A (no REQUIREMENTS.md change made)

---

**Total deviations:** 1 auto-fixed (1 blocking), 1 judgment call (protecting requirements-traceability accuracy)
**Impact on plan:** The formatting fix was necessary to satisfy the plan's own acceptance criterion; no scope creep. The requirements decision keeps REQUIREMENTS.md truthful — plan 24-06 (whichever plan actually wires the call sites) should mark CRIT-03/CRIT-05 complete when its own verification is green.

## Issues Encountered
None beyond the documented deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 24-06 (the re-roll loop in `generate.routes.ts`) can now call `recordUsageEvent(..., { reroll_cost_usd_micros, reroll_attempt_count, ... })` and `logVisualCritic({...})` against stable, verified contracts.
- `scripts/verify-phase-24.ts --only=svc-observability` checks 5-6 (call-site wiring, FK-safety of the hard-fail `postId: null` call) will go green once 24-06 lands — this is expected and by design, not a gap in this plan.
- No blockers. Ran as one of three parallel executor agents (24-02, 24-03, 24-04) in the same working directory; touched only `server/quota.ts` and `server/services/observability.service.ts`, disjoint from the other two plans' files; no git index-lock contention encountered.

---
*Phase: 24-visual-critic-and-re-roll*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/quota.ts
- FOUND: server/services/observability.service.ts
- FOUND: .planning/phases/24-visual-critic-and-re-roll/24-03-SUMMARY.md
- FOUND: 9e850de (Task 1 commit)
- FOUND: 2f6c451 (Task 2 commit)
