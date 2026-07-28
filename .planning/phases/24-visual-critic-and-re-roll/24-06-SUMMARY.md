---
phase: 24-visual-critic-and-re-roll
plan: 06
subsystem: api
tags: [sse, abortsignal, express, visual-critic, billing, observability]

# Dependency graph
requires:
  - phase: 24-02
    provides: "chatCompletion(params.callClass/.signal) real AbortSignal transport threading; ImageGenerationInput.signal forwarded by OpenRouterImageProvider"
  - phase: 24-03
    provides: "recordUsageEvent(..., extraMetadata?) additive 8th param; logVisualCritic() + VisualCriticLogParams"
  - phase: 24-05
    provides: "runVisualCritic, selectFinalAttempt, computeRerollMetadata, shouldRerollAfter, MAX_REROLL_ATTEMPTS from visual-critic.service.ts"
provides:
  - "server/routes/generate.routes.ts's image branch is now a bounded sequential critic/re-roll loop (1..MAX_REROLL_ATTEMPTS+1) instead of a single-shot provider.generate() call"
  - "A real AbortController replaces the bare setTimeout — its signal is threaded into both provider.generate() and runVisualCritic(), and the outer catch defers to the timer's 504 via a controller.signal.aborted early return"
  - "GENERATION_SAFETY_TIMEOUT_MS now adds a CRITIC_REROLL_BUDGET_MS (~95s) on top of the existing env-tunable base (~375s total default)"
  - "recordUsageEvent's extraMetadata carries reroll_attempt_count/reroll_cost_usd_micros (platform-side, never charged) + critic_outcome/critic_cost_usd_micros/critic_final_scores (accepted attempt, IS charged)"
  - "logVisualCritic wired at exactly 2 call sites: the hard-fail path (postId: null, before any post row exists) and the success path (real postId, immediately before recordUsageEvent)"
affects: [24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Timer-owns-the-response pattern: the setTimeout body sends the user-facing error BEFORE its own DB write, and the surrounding catch block short-circuits on controller.signal.aborted so the timer's response is provably never overwritten by a race"
    - "Bounded bare-for-loop re-roll with early break: 'for (let attempt = 1; attempt <= MAX_REROLL_ATTEMPTS + 1; attempt++) { ...; if (!shouldRerollAfter(outcome)) break; }' — provider/key resolution hoisted once outside the loop, every attempt buffer retained in a Map so the accepted (possibly non-last) attempt's bytes are never re-generated"

key-files:
  created: []
  modified:
    - server/routes/generate.routes.ts

key-decisions:
  - "GENERATION_SAFETY_TIMEOUT_MS's derivation kept its first operand on the SAME line as '= ' (not a bare newline continuation as the plan's literal code sample showed) — otherwise scripts/verify-phase-24.ts's `/const GENERATION_SAFETY_TIMEOUT_MS = ([^;]+);/` regex (which requires a literal space immediately after '=') fails to match, identical root cause to 24-03-SUMMARY.md's hasGatewayMeta fix. Zero behavior change — same expression, reflowed."
  - "critic_cost_usd_micros (the ACCEPTED attempt's critic call) is INSIDE the charged amount: acceptedCriticCostMicros is summed into realCostUsdMicros/gatewayRealCost alongside text/image cost, which becomes usageEvent.cost_usd_micros/charged_amount_micros via deductCredits. Its appearance in extraMetadata.critic_cost_usd_micros is a read-only, informational copy for the compliance-rate query — it does not itself contribute to the charge a second time. reroll_cost_usd_micros (discarded attempts) is the opposite: purely metadata, computed by computeRerollMetadata over every attempt EXCEPT the accepted index, and structurally cannot reach realCostUsdMicros/gatewayRealCost (both expressions were grep-verified to contain zero occurrences of 'reroll')."
  - "logVisualCritic's success-path call placed immediately BEFORE recordUsageEvent (not after) per the plan — the post row is already confirmed inserted by that point, so the postId FK resolves, and the emitter's own try/catch means a failure there can never block billing from running afterward."

patterns-established:
  - "N/A — this plan wires existing infrastructure into the one production code path Phase 24 changes; no new architectural pattern beyond what 24-02/24-03/24-05 already established."

requirements-completed: [CRIT-01, CRIT-02, CRIT-03, CRIT-04, CRIT-05]

# Metrics
duration: ~25min
completed: 2026-07-28
---

# Phase 24 Plan 06: Wire the Critic + Re-roll Loop into generate.routes.ts Summary

**`generate.routes.ts`'s image branch now runs a bounded sequential critic/re-roll loop (1-3 attempts, identical prompt, real AbortSignal cancellation) ahead of Phase 23's crop/typography/logo pipeline, bills the user once for the accepted attempt only, and a real `AbortController` makes the safety timer's 504 provably win the race against the outer catch's generic 500.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-28
- **Tasks:** 3/3 complete
- **Files modified:** 1

## Accomplishments
- Task 1: bare `setTimeout` replaced with a real `AbortController` — the timer body now `controller.abort()`s first, sends the 504 BEFORE its `logGenerationError` DB round-trip (`.catch(() => {})` guarded, since it's now the sole timeout-response owner), and the outer catch's first statement is `if (controller.signal.aborted) return;` so a timed-out request can never emit a duplicate error row or a generic-500 race ahead of the 504. `GENERATION_SAFETY_TIMEOUT_MS` now adds a derived `CRITIC_REROLL_BUDGET_MS` (`(MAX_REROLL_ATTEMPTS + 1) * 15s + MAX_REROLL_ATTEMPTS * 25s` = 95s) on top of the existing env-tunable base.
- Task 2: the image branch's single `provider.generate()` try/catch became a `for (let attempt = 1; attempt <= MAX_REROLL_ATTEMPTS + 1; attempt++)` loop — provider/key resolution hoisted once outside the loop; each attempt calls `provider.generate({ ..., signal: controller.signal })` then `runVisualCritic({ ..., signal: controller.signal })`; `shouldRerollAfter(outcome)` decides whether to continue; every attempt's buffer is retained in a `Map<number, ImageProviderResult>` so `selectFinalAttempt`'s winner (not necessarily the last attempt) never needs re-generating. The hard-fail path (`acceptedIndex === null` — every attempt contained unwanted text) logs a `visual_critic` row with `postId: null` and throws before any post row exists; `imageResult` then flows unchanged into Phase 23's pipeline.
- Task 3: `realCostUsdMicros`/`gatewayRealCost` extended to include the accepted attempt's critic cost (never the discarded attempts' — both expressions grep-verified `reroll`-free); `recordUsageEvent`'s new 8th-arg `extraMetadata` carries `reroll_attempt_count`/`reroll_cost_usd_micros` (platform-side) plus `critic_outcome`/`critic_cost_usd_micros`/`critic_final_scores` (accepted attempt); the success-path `logVisualCritic` call lands immediately before `recordUsageEvent`, skipped entirely for video.
- Full Phase 24 harness green (44/44, `--only=self-test`/`svc-critic-call`/`svc-reroll-logic`/`svc-billing-reroll`/`svc-abort-signal`/`svc-observability` all 100%). Zero regression: `verify-phase-16/21/21.1/22/23.ts` all still exit 0 (Phase 23 at its full 86/86). `npm run check` and `npm run build` both clean. Video branch (`if (content_type === "video") {...}` block) confirmed byte-identical via `git diff` against the pre-plan commit.

## Task Commits

1. **Task 1: AbortController-owned timeout — abort in the timer, and make its 504 win the catch race** - `74e1109` (feat)
2. **Task 2: Replace the single-shot image call with the bounded critic/re-roll loop** - `6bd59fa` (feat)
3. **Task 3: Re-roll billing metadata + the success-path visual_critic log row** - `56e9053` (feat)

## Files Created/Modified
- `server/routes/generate.routes.ts` - Real `AbortController` safety timeout with the timer-owns-the-response ordering + outer-catch abort guard (Task 1); the image branch's single-shot `provider.generate()` replaced by a bounded sequential critic/re-roll loop with hoisted provider/key resolution and a per-attempt buffer `Map` (Task 2); billing cost expression extended with the accepted attempt's critic cost, `extraMetadata` reroll/critic fields, and the success-path `logVisualCritic` call site (Task 3)

## Decisions Made
- Reflowed `const GENERATION_SAFETY_TIMEOUT_MS = (...)  + CRITIC_REROLL_BUDGET_MS;` onto a single leading line (rather than the plan's literal newline-after-`=` sample) so `scripts/verify-phase-24.ts`'s regex actually captures the expression — same class of fix as 24-03's `hasGatewayMeta` formatting correction, zero behavior change.
- `critic_cost_usd_micros` (accepted attempt) is explicitly INSIDE the charged amount; `reroll_cost_usd_micros` (discarded attempts) is explicitly OUTSIDE it — see key-decisions above for the full accounting trail plan 24-07's operator sign-off needs.
- Followed the plan's exact interfaces/ordering/rule text for both the timer-race fix and the re-roll loop verbatim — no structural deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `GENERATION_SAFETY_TIMEOUT_MS` declaration's line-break broke the plan's own verification regex**
- **Found during:** Task 1 verification (`npx tsx scripts/verify-phase-24.ts --only=svc-abort-signal`, check 8)
- **Issue:** The plan's action block showed `const GENERATION_SAFETY_TIMEOUT_MS =` on its own line with the value starting on the next line. `scripts/verify-phase-24.ts`'s `/const GENERATION_SAFETY_TIMEOUT_MS = ([^;]+);/` regex requires a literal space immediately after `=`, so it failed to match when the next character was a newline — check 8 reported FAIL despite functionally correct code (identical root cause to 24-03-SUMMARY.md's `hasGatewayMeta` deviation).
- **Fix:** Moved the first operand (`(config.GENERATION_SAFETY_TIMEOUT_MS ?? 280_000) +`) onto the same line as `const GENERATION_SAFETY_TIMEOUT_MS = `, keeping `CRITIC_REROLL_BUDGET_MS` on the next line. Same expression, no behavior change.
- **Files modified:** `server/routes/generate.routes.ts`
- **Verification:** Standalone Node regex test confirmed the match; `npx tsx scripts/verify-phase-24.ts --only=svc-abort-signal` now shows 10/10 PASS (checks 6, 8, 10 as the plan's acceptance criteria specify)
- **Committed in:** `74e1109` (Task 1 commit)

---

### Judgment Calls

**1. [Judgment call — REQUIREMENTS.md accuracy] Did NOT run `requirements mark-complete` for CRIT-01..05**
- **Found during:** State-update step (post-Task-3)
- **Issue:** This plan's frontmatter lists all five `CRIT-*` requirements, and unlike 24-01/24-02/24-03/24-05's judgment calls (which deferred because their own deliverables were self-admittedly unwired), this plan's static/functional verification IS fully green end-to-end (`verify-phase-24.ts` 44/44, zero red checks). However, `24-07-PLAN.md` (Wave 5, `depends_on` this plan, `autonomous: false`) exists specifically to add the `[svc-cross-plan]` invariant tag and obtain **operator sign-off against real production traffic** — its own `must_haves.truths` states "An operator has confirmed the live critic call, a real re-roll, the hard-fail path, real cancellation, and the compliance query against production data" as a precondition for closing the phase. REQUIREMENTS.md's CRIT-01..05 rows describe live, observed pipeline behavior (a compliance rate that is "measurable" against real data, an abort that "actually cancels" a real socket) which this static plan cannot itself prove. Same phase-closure gate precedent as 22-06/23-11's `Phase NN is NOT closed` pattern.
- **Action taken:** Skipped `node gsd-tools.cjs requirements mark-complete CRIT-01 CRIT-02 CRIT-03 CRIT-04 CRIT-05`. REQUIREMENTS.md's five CRIT rows remain `Pending` — accurate until 24-07's operator sign-off actually happens. The frontmatter's `requirements-completed` field still lists all five IDs per the template's literal instruction (dependency-graph association, not verified completion).
- **Files modified:** None (a non-action)
- **Verification:** `grep 'CRIT-0' .planning/REQUIREMENTS.md` still shows all five as `- [ ]` / `Pending`
- **Committed in:** N/A (no REQUIREMENTS.md change made)

---

**Total deviations:** 1 auto-fixed (1 blocking, cosmetic regex-format fix, zero behavior change), 1 judgment call (protecting requirements-traceability accuracy pending 24-07's operator sign-off)
**Impact on plan:** No functional deviation from the plan as written — every task's acceptance criteria and the full Phase 24 harness pass. The requirements decision keeps REQUIREMENTS.md truthful; plan 24-07 should mark CRIT-01..05 complete once its operator sign-off lands.

## Issues Encountered
None beyond the documented Task 1 formatting fix above. Every other acceptance-criteria grep, both cross-plan regression suites (Phase 16/21/21.1/22/23), `npm run check`, and `npm run build` matched the plan's expected PASS state on first attempt.

Note: the plan's own manual acceptance-criteria text for Task 1 ("`grep -c 'sse.sendError(' server/routes/generate.routes.ts` returns 3") is not literally true — it returns 4, because a pre-existing comment at line 544 ("...turns this into sse.sendError(...) for the user...", part of the PLAN-02 planning-schema-error rationale, present before this plan touched the file) contains the substring `sse.sendError(`. This is NOT enforced by `scripts/verify-phase-24.ts` (no automated check asserts this count), no real call site was added or removed, and the comment predates this plan's edits — confirmed by diffing against `a2493c7` (the pre-24-06 commit).

## User Setup Required
None - no external service configuration required. A funded `OPENROUTER_API_KEY` is required for plan 24-07's live operator sign-off runbook, but that is 24-07's concern, not a setup blocker for this plan's own completion.

## Next Phase Readiness
- Plan 24-07 (Wave 5, phase closure) can now add its `[svc-cross-plan]` tag against a fully-wired `generate.routes.ts` and run its live/manual verification runbook (real critic call, a real re-roll, the hard-fail path, real cancellation via the AbortController this plan wired, and the compliance-rate query against `generation_logs`) against a genuinely complete implementation.
- The critic/re-roll loop, the AbortController timing race fix, and the billing/observability wiring are all committed and static-verified; nothing in Phase 24's production code path is left for 24-07 beyond its own harness-tag + runbook additions and the operator's manual confirmation.
- No blockers.

---
*Phase: 24-visual-critic-and-re-roll*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/routes/generate.routes.ts
- FOUND: .planning/phases/24-visual-critic-and-re-roll/24-06-SUMMARY.md
- FOUND: 74e1109 (Task 1 commit)
- FOUND: 6bd59fa (Task 2 commit)
- FOUND: 56e9053 (Task 3 commit)
