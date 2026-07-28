---
phase: 23-deterministic-typography-and-edit-fidelity
plan: 12
subsystem: api
tags: [gemini, typography, prompt-engineering, gap-closure, verification-harness]

# Dependency graph
requires:
  - phase: 23-05
    provides: "buildNegativeSpaceInstruction / buildTextFidelityInstruction / buildTextStyleCopyInstruction and the removal of the text_rendering sub-schema"
  - phase: 23-11
    provides: "the 13-tag, 80-check verify-phase-23.ts harness (including [svc-cross-plan] cross-phase regression proof)"
provides:
  - "buildDefaultCreativePlan()'s required_elements never asks the image model to render typography, on any reachable path"
  - "buildLocalTextFallback() actually returns its negative-space-safe manually-authored image_prompt instead of a shadowing structured-plan flattening"
  - "6 new [svc-text-free-prompt] FUNCTIONAL checks in verify-phase-23.ts that call the real code and assert on RETURNED strings (80 -> 86)"
affects: [24-visual-critic-and-re-roll, 26-fixes-and-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Functional (call-the-real-function) verification checks layered on top of grep-based static checks, with a self-test proving the semantic scanner is not vacuous"

key-files:
  created: []
  modified:
    - server/services/gemini.service.ts
    - scripts/verify-phase-23.ts
    - .planning/ROADMAP.md

key-decisions:
  - "Reworded the plan's literal replacement comments (which quoted the exact banned strings 'clear promotional typography', 'flattenedPrompt || image_prompt', and a third buildImagePromptFromStructuredJson mention) to preserve their explanatory intent without reproducing the literals the task's own acceptance criteria required to be absent (grep -c == 0 / == 2) — a self-consistency bug in the plan's action text vs. its acceptance criteria, fixed per Rule 1."

patterns-established:
  - "Gap-closure plans that add comments documenting a removed literal must avoid quoting that literal verbatim if a grep-count acceptance criterion also forbids its presence."

requirements-completed: [TYPO-01, TYPO-07]

# Metrics
duration: 6min
completed: 2026-07-27
---

# Phase 23 Plan 12: TYPO-01 Local-Fallback Typography Leak Gap Closure Summary

**Removed the last channel through which the image model could be told to render promotional typography — `buildDefaultCreativePlan()`'s `required_elements` literal and `buildLocalTextFallback()`'s always-losing `flattenedPrompt || image_prompt` — and added 6 functional (call-the-real-code) checks that would have caught it.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-27T23:31:08Z
- **Completed:** 2026-07-27T23:37:13Z
- **Tasks:** 3 (all completed)
- **Files modified:** 3 (`server/services/gemini.service.ts`, `scripts/verify-phase-23.ts`, `.planning/ROADMAP.md`)

## Accomplishments

- Closed the single gap recorded in `23-VERIFICATION.md`: the double-transport-failure fallback path no longer instructs the image model to render typography, and the negative-space instruction (the reserved-zone contract the typography compositor depends on) is no longer dead code on that path.
- Added 6 new functional checks that call `buildLocalTextFallback()` and `buildDefaultCreativePlan()` directly and assert on the RETURNED strings — not grep. A self-test check proves the semantic scanner (which distinguishes positive typography directives from negated ones) is not vacuous.
- Full Phase 23 suite is now 86/86 (80 pre-existing + 6 new), zero weakened checks, zero regression on Phases 16/21/21.1/22.

## Proof of Closure — Before/After `image_prompt` (buildLocalTextFallback, `useText=true, contentType="image"`)

**BEFORE (the leak, empirically reproduced against the un-fixed tree in Task 1's RED run):**

```
Create a 1:1 social media image for Acme Foods (restaurant) with promo mood. Visual direction: hero shot of a burger on a wooden board. Preserve the primary subject from the reference if one is provided. Use brand colors #ff0000, #00ff00. hero shot of a burger. Composition: clean commercial composition centered on the main subject, ... Color harmony: brand-aligned commercial palette. MUST INCLUDE these elements: clear promotional typography, reserved clean zone for real logo overlay. Logo placement: position: bottom-right, ... Aspect ratio: 1:1. AVOID: Do not invent or typeset a fake logo..
```

(Two confirmed defects: the literal `"clear promotional typography"` reaching the image model verbatim, AND the negative-space instruction from `buildNegativeSpaceInstruction` completely absent — the manual string was dead code.)

**AFTER (actual value returned post-fix, captured via a direct probe of `buildLocalTextFallback()`):**

```
Create a 1:1 social media image for Acme Foods (restaurant) with promo mood. Visual direction: hero shot of a burger on a wooden board. Preserve the primary subject from the reference if one is provided. Use brand colors #ff0000, #00ff00. CRITICAL: Do NOT render any text, letters, numbers, or typographic marks anywhere in the image — all on-image copy is composited server-side after generation by a deterministic typography engine. Compose the scene so it keeps the lower 40% of the frame calm, uncluttered, and free of important subject detail so a text band can be overlaid, with no important subject detail, faces, or high-frequency texture in that zone. Keep layout clean, commercial, and conversion-focused.
```

The manually authored, negative-space-safe string (the only one that interpolates `buildNegativeSpaceInstruction`) is now the value actually returned. Zero positive typography directives remain (all typography vocabulary appears only inside the negated "Do NOT render..." clause).

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — add the functional returned-string check to verify-phase-23.ts and prove it catches the live defect** - `c4d6ab3` (test)
2. **Task 2: GREEN — remove the typography literal and stop the flattened prompt from shadowing the negative-space-safe string** - `a86ed78` (fix)
3. **Task 3: Full-suite regression + roadmap/requirements reconciliation** - `0632890` (docs)

_Note: Task 1 is the TDD RED commit (harness fails on the live defect: `PASS: 24 / FAIL: 5`, exit 1). Task 2 is the GREEN commit (`PASS: 29`, exit 0). Task 3 is the full-suite regression + ROADMAP reconciliation commit (`PASS: 86`, exit 0)._

## Files Created/Modified

- `scripts/verify-phase-23.ts` - Added 6 new `[svc-text-free-prompt]` FUNCTIONAL checks (positive-directive semantic scanner + self-test + 4 assertions calling `buildLocalTextFallback`/`buildDefaultCreativePlan`/`buildImagePromptFromStructuredJson` directly); amended the file-ownership comment to name plan 23-12.
- `server/services/gemini.service.ts` - `buildDefaultCreativePlan()`'s `required_elements` entry rewritten from `"clear promotional typography"` to a text-free empty-space description; `buildLocalTextFallback()` no longer computes/prefers a flattened prompt — its manually authored, negative-space-safe `image_prompt` is now the value returned.
- `.planning/ROADMAP.md` - Phase 23's `Plans:` line updated to `11/12 plans complete ... 23-12 gap closure complete`; the `23-12-PLAN.md` checklist entry flipped to `[x]`.

## Decisions Made

- **Reworded plan-specified comment text to avoid re-introducing the banned literals.** The plan's own action text for both fixes included explanatory comments that quoted the exact strings the task's acceptance criteria required to be absent (`"clear promotional typography"`, `` `flattenedPrompt || image_prompt` ``, and a 3rd/4th mention of `buildImagePromptFromStructuredJson` pushing its count from 2 to 4). Rather than follow the literal comment prose (which would have failed 3 of the task's own acceptance-criteria greps), the comments were reworded to describe the same removed behavior without quoting the forbidden literals — preserving 100% of the explanatory intent while satisfying every acceptance-criteria grep count (`clear promotional typography` → 0, `flattenedPrompt || image_prompt` → 0, `buildImagePromptFromStructuredJson` → 2, `Phase 23 gap closure (TYPO-01, plan 23-12)` → 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan's own action text] Plan-specified comment prose reproduced the exact literals its own acceptance criteria forbade**
- **Found during:** Task 2 (GREEN fix)
- **Issue:** The plan's `<action>` block specified comment text (documenting what the code used to do) that quoted `"clear promotional typography"` and `` `flattenedPrompt || image_prompt` `` verbatim, and mentioned `buildImagePromptFromStructuredJson` twice more than the plan's own acceptance criteria allowed. Following the action text literally would have left `grep -c "clear promotional typography"` = 1 and `grep -c "flattenedPrompt || image_prompt"` = 1 (both required to be 0), and `grep -c "buildImagePromptFromStructuredJson"` = 4 (required to be 2).
- **Fix:** Reworded the comments to describe the same historical behavior/rationale without quoting the forbidden literals (e.g., "instruct the IMAGE model to render promotional lettering directly" instead of quoting the exact removed string; "the structured-prompt flattener" instead of naming the function a 3rd/4th time). No functional code changed — comments only.
- **Files modified:** `server/services/gemini.service.ts`
- **Verification:** All Task 2 acceptance-criteria greps now pass exactly as specified: `clear promotional typography` → 0, `flattenedPrompt || image_prompt` → 0, `buildImagePromptFromStructuredJson` → 2, `Phase 23 gap closure (TYPO-01, plan 23-12)` → 2, `text_rendering` → 0. `npx tsx scripts/verify-phase-23.ts --only=svc-text-free-prompt` → PASS 29, exit 0. `npm run check` → exit 0.
- **Committed in:** `a86ed78` (part of Task 2 commit — the comment rewording happened before commit, so no separate commit was needed)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in the plan's own action text, not the codebase)
**Impact on plan:** Cosmetic-only fix to comment wording; zero functional/behavioral change beyond what the plan specified. No scope creep — same two functional edits (required_elements literal, flattenedPrompt removal) landed exactly as designed.

## Issues Encountered

None beyond the documented deviation above.

## Verification Results

1. **Task 1 (RED):** `npx tsx scripts/verify-phase-23.ts --only=svc-text-free-prompt` → `PASS: 24` / `FAIL: 5`, exit 1. 5 `✗ [svc-text-free-prompt] FUNCTIONAL` lines confirmed; `"clear promotional typography"` appeared 3 times in failure detail. `git diff --name-only -- server scripts` showed exactly `scripts/verify-phase-23.ts` (gemini.service.ts untouched, as required for RED).
2. **Task 2 (GREEN):** `npx tsx scripts/verify-phase-23.ts --only=svc-text-free-prompt` → `PASS: 29`, exit 0, no FAIL line. `npm run check` exit 0. `git diff --stat` on the 4 explicitly out-of-scope files (`planning-schema.service.ts`, `prompt-builder.service.ts`, `generate.routes.ts`, `edit.routes.ts`) produced empty output — byte-unchanged.
3. **Task 3 (full suite):** `npx tsx scripts/verify-phase-23.ts` → `PASS: 86`, exit 0, `All Phase 23 checks passed.` The 4 `[svc-cross-plan]` "no prior-phase harness regressed" lines (Phases 16/21/21.1/22) all present and `✓`. `npm run check` exit 0.

**Non-weakening proof:** zero `check(` lines were deleted or altered from the pre-existing 80; the new 6 checks are pure additions inside the `[svc-text-free-prompt]` block plus the ownership-comment reword. Zero tag literals added or removed (`[svc-cross-plan]` count unchanged at 8 occurrences before and after).

**Scope proof:** across the full plan (3 atomic commits), the only files touched are `server/services/gemini.service.ts`, `scripts/verify-phase-23.ts`, and `.planning/ROADMAP.md` — matching the plan's `files_modified` frontmatter exactly. `.planning/STATE.md` and `.planning/REQUIREMENTS.md` are untouched (confirmed both already carry TYPO-01/TYPO-07 as `[x]`/Complete, per plan step 4).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Phase 23 is NOT closed.** This gap-closure plan (23-12) is complete and the harness is 86/86 green, but `23-11-PLAN.md`'s Task 3 (operator sign-off against the live Coolify/Hetzner Alpine host, live Supabase project, and real paid AI calls) remains BLOCKING and is entirely independent of this gap — it was not touched or affected by this plan. Phase 24 (Visual Critic & Re-roll) and Phase 26 (Fixes & Polish) both depend on Phase 23; they should not start until the operator sign-off checkpoint clears.

## Self-Check: PASSED

All created/modified files confirmed present on disk (`server/services/gemini.service.ts`, `scripts/verify-phase-23.ts`, `.planning/ROADMAP.md`, this SUMMARY.md); all 3 task commit hashes (`c4d6ab3`, `a86ed78`, `0632890`) confirmed present in `git log`.

---
*Phase: 23-deterministic-typography-and-edit-fidelity*
*Completed: 2026-07-27*
