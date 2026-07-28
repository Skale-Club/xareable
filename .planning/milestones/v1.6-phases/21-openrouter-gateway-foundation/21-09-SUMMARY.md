---
phase: 21-openrouter-gateway-foundation
plan: 09
subsystem: api
tags: [openrouter, gemini, transcription, billing, gateway]

# Dependency graph
requires:
  - phase: 21-04
    provides: ai-gateway.service.ts transcribe() (OpenRouter chat-completions multimodal transcription with fallback chain)
provides:
  - transcribe.routes.ts routes voice-input transcription through the OpenRouter gateway by default
  - Header-fixed direct-Gemini rollback branch preserved behind ai_gateway_routing.transcription = "direct"
  - Transcription usage_events now carry real gateway cost (realCostUsdMicros) + pre-call estimate (estimatedCostMicros)
affects: [21-13 (final wiring/verification), 21.1 (affiliate BYOK), future billing reconciliation audits]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getCallRouting(callClass) branch at call site — openrouter default, direct legacy fallback in the same file, no separate provider abstraction needed for self-contained routes"

key-files:
  created: []
  modified:
    - server/routes/transcribe.routes.ts

key-decisions:
  - "Combined routing migration (GATE-03/07/POL-07) and billing wiring (GATE-05) in one small plan since transcribe.routes.ts is self-contained (route + inline AI call + billing in one file), unlike the other call classes"
  - "transcribeUsage explicitly set to undefined on the gateway path — gateway billing runs on real cost (gatewayCostUsdMicros), not token-table estimates; direct path keeps token-table pricing untouched"

patterns-established:
  - "Self-contained route files (routing branch + billing call together) can land their transport migration and cost-wiring in a single plan when the call class has only one call site"

requirements-completed: [GATE-03, GATE-05, GATE-07, POL-07]

# Metrics
duration: 12min
completed: 2026-07-27
---

# Phase 21 Plan 09: OpenRouter Transcription Migration + Billing Wiring Summary

**Transcription route now defaults to OpenRouter's gateway `transcribe()` with a header-fixed direct-Gemini rollback branch, and its usage event records real gateway cost plus the pre-call credit estimate.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-27T14:12:00Z
- **Completed:** 2026-07-27T14:19:00Z
- **Tasks:** 2 completed
- **Files modified:** 1 (server/routes/transcribe.routes.ts)

## Accomplishments
- Transcription (`POST /api/transcribe`) now routes through `getCallRouting("transcription")`: OpenRouter gateway (`aiGatewayTranscribe`) by default, direct Gemini fetch as an admin-toggleable rollback (`ai_gateway_routing.transcription = "direct"`, no redeploy needed)
- Direct-path fetch retains header-based auth (`x-goog-api-key`) — zero query-string API keys (`?key=`) remain in the route (POL-07)
- `recordUsageEvent` now receives `gatewayCostUsdMicros` (real OpenRouter cost, undefined on direct-path runs) and `creditStatus?.estimated_cost_micros` (pre-call estimate) as its 6th/7th positional args, so gateway-routed transcriptions bill on real cost × markup instead of the static token-pricing table

## Task Commits

Each task was committed atomically:

1. **Task 1: Routing branch — gateway transcribe() default, header-fixed direct fallback** - `62c85f0` (feat)
2. **Task 2: GATE-05 billing wiring — real cost + estimate on the transcription usage event** - swept into `9aa0f95` (see Deviations below — content correct, commit attribution shared with a concurrent plan's commit)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `server/routes/transcribe.routes.ts` - Added `getCallRouting`/`aiGatewayTranscribe` imports; replaced the inline Gemini fetch with an openrouter/direct routing branch producing `transcription`, `transcribeUsage`, `gatewayCostUsdMicros`; wired `recordUsageEvent`'s new 6th/7th positional params

## Decisions Made
- None beyond what's captured in the plan and `key-decisions` above — plan executed as written.

## Deviations from Plan

### Auto-fixed Issues

None — no Rule 1/2/3 auto-fixes were needed; the plan's code was implemented verbatim.

### Git commit race (documented, not a code deviation)

**1. Task 2's commit got swept into a concurrent parallel agent's commit**
- **Found during:** Task 2 (billing wiring), immediately after `git add server/routes/transcribe.routes.ts`
- **Issue:** This plan runs as one of four parallel executor agents in the same shared working directory (no worktree isolation). Between `git add server/routes/transcribe.routes.ts` and the commit, the concurrently-running 21-08 agent staged and committed its own files; `carousel-generation.service.ts` from that agent transiently appeared staged alongside my file (caught and unstaged per the parallel-execution protocol), but by the time I re-staged and went to commit Task 2's `recordUsageEvent` change, the 21-08 agent's own commit (`9aa0f95`, "feat(21-08): route carousel master text plan through OpenRouter gateway") had already picked up my staged `transcribe.routes.ts` diff in the same race window.
- **Fix:** Verified via `git show 9aa0f95 -- server/routes/transcribe.routes.ts` that the exact intended Task 2 diff (7-arg `recordUsageEvent` call with `gatewayCostUsdMicros` + `creditStatus?.estimated_cost_micros` comments) landed correctly, byte-for-byte matching the plan's action block. Working tree is clean (`git diff HEAD -- server/routes/transcribe.routes.ts` empty) — no content was lost. Did NOT rewrite history (rebase/amend) since other parallel agents were still committing concurrently; the same precedent (content preserved, wrong-commit attribution) was previously documented and accepted for Phase 21-03.
- **Files affected:** server/routes/transcribe.routes.ts
- **Commit containing the change:** `9aa0f95` (authored by the 21-08 agent's task, but containing this plan's Task 2 diff)
- **Verification:** `grep -n "gatewayCostUsdMicros,\|creditStatus?.estimated_cost_micros,"` both match; `npm run check` exits 0; `git diff HEAD` for the file is empty (confirming nothing pending/lost)

---

**Total deviations:** 0 code deviations; 1 documented git-commit-attribution race (no content lost, no action needed beyond documentation)
**Impact on plan:** None on functionality or correctness — both tasks' code landed exactly as specified. Only the commit hash attributed to Task 2 differs from what a single-agent execution would have produced.

## Issues Encountered
- Parallel execution git-add race (see Deviations above) — resolved via verification, no rework needed.

## User Setup Required

None - no external service configuration required. (`OPENROUTER_API_KEY` env var requirement was already established in Phase 21 earlier plans; this plan only consumes `config.OPENROUTER_API_KEY`, does not introduce it.)

## Next Phase Readiness

- Transcription is now fully migrated onto the OpenRouter gateway with a working, header-compliant rollback path and real-cost billing — matches the pattern the other call classes (planning, image) are converging on in parallel plans (21-06/21-07/21-08).
- `scripts/verify-phase-21.ts` GATE-03/GATE-05/GATE-07/POL-07 checks remain intentionally stubbed to `false` until 21-13-PLAN.md wires them for real (per STATE.md's documented plan) — this is expected, not a regression; GATE-08 (video freeze guard) still passes 3/3.
- No blockers for 21-13 (final gateway verification) or 21.1 (affiliate BYOK migration).

## Self-Check: PASSED

- FOUND: server/routes/transcribe.routes.ts
- FOUND: .planning/phases/21-openrouter-gateway-foundation/21-09-SUMMARY.md
- FOUND: 62c85f0 (Task 1 commit)
- FOUND: 9aa0f95 (contains Task 2's diff, per documented deviation above)

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*
