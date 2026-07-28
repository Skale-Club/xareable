---
phase: 24-visual-critic-and-re-roll
plan: 07
subsystem: testing
tags: [verification-harness, cross-plan-invariants, visual-critic, re-roll, runbook]

# Dependency graph
requires:
  - phase: 24-01
    provides: "scripts/verify-phase-24.ts (the 6-tag Phase 24 gate) + aiModelsSchema.critic/generationLogSchema.event_kind widens"
  - phase: 24-02
    provides: "chatCompletion(params.callClass/.signal) real AbortSignal transport threading"
  - phase: 24-03
    provides: "recordUsageEvent(..., extraMetadata?) + logVisualCritic()/VisualCriticLogParams"
  - phase: 24-05
    provides: "server/services/visual-critic.service.ts (runVisualCritic, selectFinalAttempt, computeRerollMetadata, shouldRerollAfter, MAX_REROLL_ATTEMPTS) + scripts/test-critic-reroll-logic.ts + scripts/verify-critic-live.ts"
  - phase: 24-06
    provides: "generate.routes.ts's image branch wired end-to-end as a bounded critic/re-roll loop with a real AbortController and billing/observability wiring"
provides:
  - "scripts/verify-phase-24.ts's 7th tag, [svc-cross-plan]: pipeline-order, no-bypass, video-fence (GATE-08), gateway backward-compatibility, two-layer billing, prior-phase-regression, and live-harness CI-safety invariants spanning files no single Phase 24 plan owns"
  - "The full Phase 24 gate green at 55/55 checks across all 7 tags, zero weakened or deleted checks"
  - "The authoritative 8-step MANUAL/LIVE VERIFICATION RUNBOOK embedded at the bottom of verify-phase-24.ts (live critic call, real cancellation, happy path, forced re-roll billing split, hard-fail path, safety-timer cancellation under load, compliance-rate query, no-regression sweep)"
affects: [25, 26]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-plan invariant tag ([svc-cross-plan]): mirrors scripts/verify-phase-23.ts's 23-11 precedent exactly — pipeline-order assertions via indexOf, a spawnSync-based proof that prior phases have not regressed (gated behind tagActive), and a spawnSync CI-safety proof that the live smoke script degrades to SKIP/exit-0 with no API key in the child env"
    - "indexOf-based pipeline-order assertion needs a starting offset when an earlier, unrelated branch reuses the same function name — generate.routes.ts's video-completion branch calls processImageWithThumbnail( once before the image branch's real optimize call; searching forward from the logo-overlay marker (not from 0) avoids the false negative, same fix class as 23-11's"

key-files:
  created: []
  modified:
    - scripts/verify-phase-24.ts

key-decisions:
  - "Applied the same indexOf-forward-search fix 23-11 needed for the identical false-positive pattern (an earlier, unrelated processImageWithThumbnail( call inside the video branch shadowing the real image-pipeline occurrence) — documented inline as a deviation rather than treated as a plan-authored bug, since the plan's own action text describes a bare indexOf and this repo's file layout requires the offset variant to be correct."
  - "Reused the [svc-billing-reroll] section's already-declared realCostMatch/gatewayRealCostMatch/realCostExpr/gatewayRealCostExpr consts inside the new [svc-cross-plan] billing-invariant check (same function scope, no re-declaration) rather than re-extracting them — avoids duplicate regex execution and keeps the two related assertions visibly paired."
  - "Did not run `state advance-plan`/`roadmap update-plan-progress`/`requirements mark-complete` for this plan — all three tools infer full completion from this SUMMARY.md's mere existence or the plan's requirements frontmatter, which would incorrectly flip Phase 24 to 100% complete and CRIT-01..05 to Complete despite Task 3 being an unresolved blocking operator checkpoint. Updated STATE.md and ROADMAP.md by hand instead, mirroring the precedent set in 21.1 Plan 07 Task 3, 22 Plan 06 Task 3, and 23 Plan 11 Task 3."

patterns-established: []

requirements-completed: []  # CRIT-01..05 remain Pending in REQUIREMENTS.md — this plan's own scope (7th cross-plan tag + operator sign-off) is NOT complete; Task 3 is a blocking checkpoint that was not performed. Do not treat this list as certifying those IDs.

# Metrics
duration: ~20min (Tasks 1-2 only; Task 3 not started)
completed: PARTIAL — Tasks 1-2 of 3 complete, 2026-07-28
---

# Phase 24 Plan 07: Cross-Plan Invariants + Live Runbook + Operator Sign-off Summary

**STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (`scripts/verify-phase-24.ts` is green at 55/55 across 7 tags with zero weakened checks, and the 8-step MANUAL/LIVE VERIFICATION RUNBOOK is embedded); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.**

`scripts/verify-phase-24.ts` now carries a 7th tag, `[svc-cross-plan]`, with 7 invariant checks that no single earlier Phase 24 plan could assert alone: the critic-before-pipeline ordering (`runVisualCritic` → `cropToExactAspectRatio` → `compositeTypography` → `applyLogoOverlay` → `processImageWithThumbnail`, strictly increasing by source position), the absence of a structural bypass around `selectFinalAttempt` (exactly one `imageResult = ` assignment inside the image branch, reading from `attemptBuffers.get(`), the frozen GATE-08 video branch containing none of `runVisualCritic`/`controller.signal`/`criticAttempts`, backward compatibility of the 6 pre-Phase-24 `chatCompletion` callers (none contains `callClass:`), the two-layer billing invariant (neither `quota.ts`'s `pricing` expression nor `generate.routes.ts`'s `realCostUsdMicros`/`gatewayRealCost` expressions reference re-roll cost), a spawnSync-based proof that Phases 16/21/21.1/22/23 have not regressed, and a spawnSync-based proof that `scripts/verify-critic-live.ts` degrades safely to `SKIP`/exit 0 with `OPENROUTER_API_KEY` absent from the child env. The full suite is 55/55 green (up from 45 baseline checks before this plan; zero checks removed or downgraded). An 8-step operator runbook (live critic call, real `AbortSignal` cancellation, the happy path, forced re-roll with its billing split, the hard-fail path, safety-timer cancellation under real load, the compliance-rate query, and a no-regression sweep across video/carousel/enhancement) is appended as a pure-insertion comment block at the bottom of the file. Task 3 — operator sign-off on that 8-step runbook — requires the real Coolify production host, the live Supabase project, and real paid OpenRouter calls, none of which are available in this execution environment.

## Performance

- **Duration:** ~20 min (Tasks 1-2)
- **Tasks:** 2 of 3 completed (Task 3 is a blocking checkpoint, not started)
- **Files modified:** 1 (`scripts/verify-phase-24.ts`)

## Accomplishments
- Ran the full harness before any change to establish a baseline: 44/44 checks passed (per 24-06-SUMMARY.md), zero failures across the original 6 tags — no implementation drift since plans 24-01..24-06 landed.
- Added `[svc-cross-plan]` (7th tag) with 7 checks (11 PASS lines total, since the regression sweep and CI-safety check spawn one assertion per prior-phase script):
  a) **Pipeline order** — `runVisualCritic(` → `cropToExactAspectRatio(` → `compositeTypography(` → `applyLogoOverlay(` → `processImageWithThumbnail(` in strictly increasing source position, with the optimize marker searched forward from the logo-overlay position (see Deviations below).
  b) **No bypass** — within the image branch (`} else {` preceding `sendProgress("image_generation"` through the next `if (sse.isClosed())`), exactly ONE `imageResult = ` assignment exists and it reads from `attemptBuffers.get(` — the hard-fail gate's only structural escape hatch stays closed.
  c) **Video fence (GATE-08)** — the `content_type === "video"` branch contains none of `runVisualCritic`, `controller.signal`, `criticAttempts`.
  d) **Backward compatibility** — none of `caption-quality.service.ts`, `carousel-generation.service.ts`, `enhancement.service.ts`, `gemini.service.ts` contain the substring `callClass:`.
  e) **Billing invariant, both sides** — `quota.ts`'s `const pricing =` expression contains no `extraMetadata`, and `generate.routes.ts`'s `realCostUsdMicros`/`gatewayRealCost` expressions contain no case-insensitive `reroll`.
  f) **Zero regression** — `scripts/verify-phase-16.ts`, `-21.ts`, `-21.1.ts`, `-22.ts`, `-23.ts` spawned via `spawnSync` and asserted to exit 0, gated behind `tagActive("svc-cross-plan")` so an unrelated `--only` run stays fast.
  g) **CI safety of the live harness** — `scripts/verify-critic-live.ts` spawned with `OPENROUTER_API_KEY` deleted from the child env, asserted to exit 0 and print `SKIP`.
- Updated the `[self-test]` tag-literal list and its assertion text from "6" to "7" tags; updated the file's ownership header comment to note 24-07 has now landed the 7th tag and the trailing runbook.
- Appended the 8-step MANUAL/LIVE VERIFICATION RUNBOOK as a pure-insertion `//`-comment block, transcribing the plan's exact numbered steps verbatim (each with a copy-pasteable command or SQL query and its exact expected result), plus a short preamble recording the committed `ai_models.critic` default (`gemini-2.5-flash`, from 24-01-SUMMARY.md) and the charged-vs-metadata cost split (from 24-06-SUMMARY.md) so steps 3/4's SQL comparisons have a stated expectation to check against.
- Ran the full acceptance-criteria verification suite: `npx tsx scripts/verify-phase-24.ts` (55/55, 0 failures, 7 tags), `npx tsx scripts/test-critic-reroll-logic.ts` (13/13), `npx tsx scripts/verify-phase-16.ts`, `verify-phase-21.ts`, `verify-phase-21.1.ts`, `verify-phase-22.ts`, `verify-phase-23.ts` (all exit 0, also independently re-proven via the new `[svc-cross-plan]` spawnSync checks), `npm run check` (clean), `npm run build` (clean, both client + server bundles).
- Confirmed grep-based acceptance criteria: `grep -c '"\[svc-cross-plan\]"'` = 1 (>=1 required); `grep -c 'MANUAL/LIVE VERIFICATION RUNBOOK'` = 1 (fixed a duplicate-match regression introduced by the header-comment edit — see Deviations below); `git diff` on the file shows only additions apart from the self-test tag array and the header comment (confirmed via `git diff scripts/verify-phase-24.ts | grep "^-"`, 5 removed lines total, all in those two locations).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the 7th [svc-cross-plan] tag with cross-file invariants** - `5d5c2d7` (feat)
2. **Task 2: Embed the MANUAL/LIVE VERIFICATION RUNBOOK** - `545ca5f` (docs)

**Task 3: Operator sign-off on the live runbook** — NOT STARTED. This is a `checkpoint:human-verify` task with `gate="blocking"` requiring the real Coolify production host, the live Supabase project, and real paid OpenRouter calls, none available in this execution environment. See "Checkpoint Details" below.

**Plan metadata:** this commit (STATE.md/ROADMAP.md/SUMMARY.md only — Task 3 still pending, so this is NOT a phase-closure commit)

## Files Created/Modified
- `scripts/verify-phase-24.ts` - Added the `[svc-cross-plan]` 7th tag (7 checks: pipeline order, no-bypass, video fence, backward compatibility, two-layer billing, prior-phase regression via spawnSync, live-harness CI safety via spawnSync), fixed the same indexOf substring-collision class 23-11 hit, updated the self-test tag count from 6 to 7, and appended the 8-step MANUAL/LIVE VERIFICATION RUNBOOK as a pure addition.

## Decisions Made

See `key-decisions` in frontmatter. Three notable calls: (1) applied the identical indexOf-forward-search fix 23-11 needed for the same false-positive class (an earlier, unrelated `processImageWithThumbnail(` call inside the video-completion branch shadowing the real image-pipeline occurrence) — this makes the check MORE precise, not weaker; (2) reused the already-declared `realCostMatch`/`gatewayRealCostMatch` consts from the existing `[svc-billing-reroll]` section rather than re-extracting them for the new cross-plan billing check; (3) updated STATE.md and ROADMAP.md by hand rather than via `gsd-tools state advance-plan` / `roadmap update-plan-progress` / `requirements mark-complete`, because those tools infer full completion from this SUMMARY.md's mere existence and would have incorrectly marked Phase 24 100% complete and CRIT-01..05 Complete despite Task 3's unresolved blocking checkpoint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, check-regex precision] Applied the known indexOf substring-collision fix to the pipeline-order invariant**
- **Found during:** Task 1, first run of the newly-added `[svc-cross-plan]` check group
- **Issue:** `generate.routes.ts`'s video-completion sub-branch (`if (content_type === "video" && videoResult) { ... }`, reached only when uploading the video's own thumbnail) calls `processImageWithThumbnail(firstRefBuffer)` once, earlier in file order (line 733) than the image branch's real crop→typography→logo→optimize sequence's own `processImageWithThumbnail(` call (line 822) — even though the two branches are mutually exclusive at runtime. A bare first-occurrence `indexOf` would find the earlier call and incorrectly report optimize happening before the logo overlay, exactly the same failure class documented in 23-11-SUMMARY.md for `generate.routes.ts`'s crop/typography/logo/optimize check.
- **Fix:** Wrote the check from the start using `const optIdx = logoIdx > -1 ? generateRouteSrc.indexOf("processImageWithThumbnail(", logoIdx) : -1` — searching forward from the confirmed logo-overlay position so the marker found is guaranteed to be the real image-pipeline occurrence. Documented inline with a `NOTE (deviation, mirrors 23-11-SUMMARY.md)` comment.
- **Files modified:** `scripts/verify-phase-24.ts`
- **Verification:** `npx tsx scripts/verify-phase-24.ts --only=svc-cross-plan` — all 11 PASS lines green; full suite 55/55.
- **Committed in:** `5d5c2d7` (Task 1 commit)

**2. [Rule 1 - Bug, self-fixed before commit] Header-comment edit duplicated the runbook title, breaking the `grep -c ... == 1` acceptance criterion**
- **Found during:** Task 2, immediately after appending the runbook — self-check before commit
- **Issue:** Task 1's header-comment update (documenting that 24-07 adds the runbook) used the literal phrase "MANUAL/LIVE VERIFICATION RUNBOOK", which then collided with Task 2's actual runbook title comment, making `grep -c 'MANUAL/LIVE VERIFICATION RUNBOOK' scripts/verify-phase-24.ts` return 2 instead of the required 1.
- **Fix:** Reworded the header-comment sentence to say "the trailing authoritative live-runbook block comment at the bottom of this file" instead of repeating the literal title string. Zero behavior change; the header still accurately documents the runbook's existence and location.
- **Files modified:** `scripts/verify-phase-24.ts`
- **Verification:** `grep -c 'MANUAL/LIVE VERIFICATION RUNBOOK' scripts/verify-phase-24.ts` returns 1.
- **Committed in:** `545ca5f` (Task 2 commit, caught before commit so no separate fix commit was needed)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — check-regex/comment precision fixes, not implementation bugs). Zero weakened checks; zero checks removed. `check(` call count grew from the 24-01 baseline (45) to 55 in the full suite.
**Impact on plan:** Both fixes are confined to the harness's own assertion/comment text (not application code) and make it strictly more accurate. No scope creep.

## Issues Encountered

None beyond the two documented deviations above, both caught and fixed before their respective commits — no false negatives or broken acceptance criteria were ever committed.

## User Setup Required

**External/live verification required — Task 3 has NOT been performed.** See "Checkpoint Details" below for the full operator runbook (also embedded at the bottom of `scripts/verify-phase-24.ts`). A funded `OPENROUTER_API_KEY` and access to the live Coolify host + Supabase project are required.

## Next Phase Readiness

- All code-level CRIT-01..05 work is done and gated: `verify-phase-24.ts` 55/55 green across 7 tags (zero weakened checks), `test-critic-reroll-logic.ts` 13/13, Phases 16/21/21.1/22/23 unregressed, `npm run check` clean, `npm run build` clean.
- **Phase 24 is NOT yet closable.** Task 3 (operator sign-off on the 8-step live runbook) must run before Phase 24's ROADMAP checkbox is checked and before CRIT-01..05 are marked Complete in REQUIREMENTS.md.
- Downstream Phase 25 (Narrative Carousels & Aesthetic DNA) and Phase 26 (Fixes & Polish) both depend on Phase 21/23's static delivery (already complete and green), not on Phase 24's live sign-off specifically — their planning is not blocked by Task 3's pending status, but the v1.6 milestone cannot be considered fully shipped until it, plus the still-open 21.1 Plan 07 Task 3, 22 Plan 06 Task 3, and 23 Plan 11 Task 3 checkpoints, all resolve.

---
*Phase: 24-visual-critic-and-re-roll*
*Completed: PARTIAL (Tasks 1-2 only) — 2026-07-28*

## Self-Check: PASSED

- FOUND: scripts/verify-phase-24.ts (modified, confirmed via commits `5d5c2d7` and `545ca5f`)
- FOUND commit: 5d5c2d7
- FOUND commit: 545ca5f
- `npx tsx scripts/verify-phase-24.ts` exits 0, 55/55 PASS across 7 tags
- `npx tsx scripts/test-critic-reroll-logic.ts` exits 0 (13/13)
- `npx tsx scripts/verify-phase-16.ts` / `verify-phase-21.ts` / `verify-phase-21.1.ts` / `verify-phase-22.ts` / `verify-phase-23.ts` all exit 0 (also re-proven via `[svc-cross-plan]`'s own spawnSync checks)
- `npm run check` exits 0
- `npm run build` succeeds
- Task 3 correctly NOT recorded as complete

## Checkpoint Details (Task 3 — not performed)

See the "CHECKPOINT REACHED" report returned to the orchestrator for the full structured checkpoint (type: human-verify, gate: blocking). Summary: the operator must run the 8-step runbook embedded at the bottom of `scripts/verify-phase-24.ts`, requiring the real Coolify production host, the live Supabase project, and real paid OpenRouter calls:
1. Live critic call (`scripts/verify-critic-live.ts --image=...`), expect exit 0 with all 5 assertions PASS.
2. Real cancellation (`--abort-probe`), expect the call to REJECT.
3. Happy path: one generation, `generation_logs` row `outcome='pass'`/`attempt_count=1`, `usage_events.metadata.reroll_attempt_count=0`.
4. Forced re-roll: `usage_events.cost_usd_micros` close to single-attempt cost, extra only in `metadata.reroll_cost_usd_micros` — CRIT-03's whole point.
5. Hard-fail path: no `posts` row, no `usage_events` row, one `hard_fail_all_attempts` log row.
6. Safety-timer cancellation under load: the aborted request must actually stop (504, not a later 500), exactly one failed log row, no delayed `posts` row.
7. Compliance rate: `select outcome, count(*) from generation_logs where event_kind='visual_critic' group by outcome;` after >=10 generations.
8. No-regression sweep: one video, one carousel, one enhancement all succeed with zero `visual_critic` rows; admin fallback-chain PATCH returns 200, admin routing PATCH for `critic` still returns 400.

On resume, a continuation agent should record the operator's per-step outcome in this file under a new "Manual verification (8-step runbook)" heading (an 8-row table: step / expected / observed / PASS-FAIL, per the plan's Task 3 instruction), and only then mark Phase 24's ROADMAP checkbox / close the phase and run `requirements mark-complete CRIT-01 CRIT-02 CRIT-03 CRIT-04 CRIT-05` — or otherwise stop and capture the failing step verbatim per the plan's Task 3 instructions.
