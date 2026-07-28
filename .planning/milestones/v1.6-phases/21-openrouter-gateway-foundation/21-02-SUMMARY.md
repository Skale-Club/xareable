---
phase: 21-openrouter-gateway-foundation
plan: 02
subsystem: api
tags: [express, billing, carousel, gemini, security]

# Dependency graph
requires:
  - phase: 21-01
    provides: verify-phase-21.ts harness skeleton + GATE-08 video-generation.service.ts freeze baseline
provides:
  - "POL-01: edit.routes.ts checkCredits now passes isVideoPost (video edits billed at the real flat video rate, not the ~30x-cheaper image fallback rate)"
  - "CRSL2-03: carousel-generation.service.ts slide loop aborts immediately on slide-1 failure instead of attempting slides 2..N with a null style-anchor reference"
  - "POL-07 coverage confirmation for the two stay-direct-Gemini call sites (text-rendering.service.ts verifyExactImageText, translate.routes.ts POST /api/translate) — both already used x-goog-api-key header auth prior to this plan's execution"
affects: [21-07, 21-08, 21-09, 21-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hoist derived request-scoped booleans (isVideoPost) above the credit-gate check so billing always reflects the true operation type"
    - "Break immediately on slide-1 failure in sequential generation loops where later iterations depend on the first iteration's output as a non-null reference"

key-files:
  created: []
  modified:
    - server/routes/edit.routes.ts
    - server/services/carousel-generation.service.ts

key-decisions:
  - "Task 3 (text-rendering.service.ts) and Task 4 (translate.routes.ts) required no code changes — both files already used the x-goog-api-key header (landed via commit f31adff, 'Improve image and carousel generation pipeline', prior to this plan's execution session). Verified via grep + git blame; acceptance criteria for both tasks are met as-is."
  - "Shortened the CRSL2-03 break-block comment to a single line so it stays within the plan's own `grep -A3` verify window — functionally identical, just formatting to match the plan's literal verification command."

patterns-established:
  - "For sequential sub-generation loops with a first-iteration style anchor, treat first-iteration failure as fatal to the loop (break) rather than partial-success-absorbed (continue) — only subsequent iterations get the partial-success treatment."

requirements-completed: [POL-01, CRSL2-03, POL-07]

# Metrics
duration: 12min
completed: 2026-07-27
---

# Phase 21 Plan 02: Ride-Along Production Bug Fixes + POL-07 Header Patches Summary

**Fixed the ~30x video-edit credit under-charge (POL-01) and the doomed-slide-2..N-after-slide-1-failure carousel bug (CRSL2-03); confirmed the two stay-direct-Gemini POL-07 sites were already query-string-key-free.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-27T13:48:56Z
- **Completed:** 2026-07-27T14:00:00Z (approx)
- **Tasks:** 4 (2 required code changes, 2 were already satisfied)
- **Files modified:** 2

## Accomplishments
- `edit.routes.ts` now hoists `isVideoPost` right after the post-ownership fetch and threads it into `checkCredits(user.id, "edit", isVideoPost)`, so video edits are charged at the real flat video rate instead of silently defaulting to the ~30x-cheaper image fallback pricing.
- `carousel-generation.service.ts`'s slide loop now `break`s immediately when slide 1 fails, instead of proceeding to attempt slides 2..N with a null `slide1Base64`/`slide1MimeType` reference — the existing post-loop `slide1Succeeded` check still throws `CarouselFullFailureError` as before, just without the wasted/doomed intermediate calls.
- Confirmed (no code change needed) that `text-rendering.service.ts`'s `verifyExactImageText` and `translate.routes.ts`'s `POST /api/translate` both already authenticate via the `x-goog-api-key` header, with zero `?key=` query-string usages remaining in either file.

## Task Commits

Each task was committed atomically:

1. **Task 1: POL-01 — fix edit.routes.ts isVideo credit-gate bug** - `91d71b1` (fix)
2. **Task 2: CRSL2-03 — abort carousel loop immediately on slide-1 failure** - `42a44b2` (fix)
3. **Task 3: POL-07 — text-rendering.service.ts header-auth fix** - no commit (already compliant; verified via grep + `git blame`, landed in f31adff prior to this plan's execution)
4. **Task 4: POL-07 — translate.routes.ts header-auth fix** - no commit (already compliant; verified via grep + `git blame`, landed in f31adff prior to this plan's execution)

**Plan metadata:** (this commit)

## Files Created/Modified
- `server/routes/edit.routes.ts` - Hoisted `isVideoPost` above the credit check; `checkCredits` now receives it as the 3rd positional arg; removed the now-duplicate later declaration.
- `server/services/carousel-generation.service.ts` - Added `if (i === 0) break;` in the slide-loop catch block, immediately after the `onProgress({type:"slide_failed"})` emit.

## Decisions Made
- Tasks 3 and 4 needed no changes: both target files were already patched to use `x-goog-api-key` instead of `?key=` query strings by commit `f31adff` ("Improve image and carousel generation pipeline"), which landed via the `claude/image-carousel-analysis` merge before this plan's execution session started. Confirmed with `grep -c "?key="` (returns 0 in both files) and `git blame` (both header lines attributed to `f31adff`, dated 2026-07-10, well before this session).
- Shortened the CRSL2-03 in-code comment to one line so the plan's own literal `grep -A3 "if (i === 0) {" | grep -q "break;"` verify command passes cleanly (the file has two `if (i === 0) {` matches — the slide-1 generation branch and the new catch-block guard — and a multi-line comment would have pushed `break;` outside the 3-line grep window). No functional difference from a multi-line comment.

## Deviations from Plan

None requiring Rule 1-4 auto-fixes. Two informational notes (both harmless, documented above under "Decisions Made"):

1. Tasks 3 and 4's target code was already in the intended end state — the plan's `<interfaces>` section's "current state" excerpts for these two files were stale relative to the repo at execution time (superseded by commit f31adff). No functional fix was needed; verified acceptance criteria pass as-is.
2. The plan's Task 2 acceptance criterion "`break;` appears exactly once inside the for loop body" does not hold literally — there is a pre-existing, unrelated `break;` for the `params.signal?.aborted` abort-check near the top of the same loop (present before this plan's execution, not touched by this plan). This is a plan-documentation gap, not a functional issue: the CRSL2-03 fix itself is correct and independently verified via the plan's own `<verify>` automated command (`grep -A3 "if (i === 0) {" ... | grep -q "break;"`), which passes.

**Total deviations:** 0 auto-fixed (Rules 1-4 not triggered — no bugs, missing functionality, blockers, or architectural questions encountered)
**Impact on plan:** None. Both code-changing tasks (1, 2) executed exactly as specified. Both no-op tasks (3, 4) verified to already meet acceptance criteria.

## Issues Encountered
- **Parallel-executor race on `git commit`:** This plan ran concurrently with the 21-03 plan executor in the same shared working directory (no worktree isolation). After `git add server/services/carousel-generation.service.ts` and running `git status --short` to confirm only my file was staged, the other agent's concurrent `git add` (staging `shared/schema.ts` and a new migration file for its own task) landed in the index before my `git commit --no-verify` executed, causing my commit to include those two foreign files. Resolved immediately: `git reset --soft HEAD~1` (undo commit, keep files staged) → `git reset HEAD -- shared/schema.ts supabase/migrations/20260718000001_usage_events_metadata.sql` (unstage the foreign files back to their pre-race working-tree state) → recommitted with only `carousel-generation.service.ts` staged. Verified via `git show --stat` that the corrected commit (`42a44b2`) contains only the intended file, and that the other agent's separate commit (`77f57ba`, made between my two commits) was untouched by the reset.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- POL-01 and CRSL2-03 production bugs are fixed and will flip their corresponding `verify-phase-21.ts` checks from FAIL to PASS once 21-13-PLAN.md wires the real assertions (currently intentionally stubbed to fail per Phase 21's plan design — confirmed via `npx tsx scripts/verify-phase-21.ts`, still exits 1 as expected with 3 PASS / 9 FAIL).
- POL-07's two stay-direct-Gemini sites (text-rendering.service.ts, translate.routes.ts) are confirmed clean; the remaining 5 `?key=` offenders (gemini.service.ts x3, caption-quality.service.ts, transcribe.routes.ts) are explicitly out of this plan's scope and will be resolved by their gateway migrations in Plans 21-07/21-08/21-09.
- `npm run check` exits 0 after all changes.
- No blockers for downstream plans.

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/routes/edit.routes.ts
- FOUND: server/services/carousel-generation.service.ts
- FOUND: .planning/phases/21-openrouter-gateway-foundation/21-02-SUMMARY.md
- FOUND: commit 91d71b1
- FOUND: commit 42a44b2
