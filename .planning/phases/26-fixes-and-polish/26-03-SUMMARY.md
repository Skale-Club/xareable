---
phase: 26-fixes-and-polish
plan: 03
subsystem: media-generation
tags: [canvas, typography-compositor, napi-rs-canvas, sharp, bugfix]

# Dependency graph
requires:
  - phase: 23-deterministic-typography-and-edit-fidelity
    provides: typography-compositor.service.ts (layoutBlocks, drawBlocks, compositeTypography, BlockLayout)
  - phase: 26-fixes-and-polish
    plan: 01
    provides: "scripts/verify-phase-26.ts's [svc-drawblocks-font-fix] tag (3 static/functional checks)"
provides:
  - "drawBlocks() sets ctx.font from each block's own layout.size_px/layout.alias before drawing that block's lines — every text block in a multi-block layout now renders at its OWN font size and weight"
  - "scripts/test-drawblocks-font-state.ts — no-network, real-pixel ink-extent proof of per-block font state (mirrors scripts/test-typography-treatment.ts's harness shape)"
affects: [26-02, 26-06, 26-07, 26-08, 26-09, 26-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-pixel functional proof via sharp raw-buffer greyscale ink-extent measurement (extract + greyscale + raw + row-scan for first/last ink row) instead of font-metrics memorization or golden-image byte comparison — reusable for any future compositor visual-regression check that needs to prove 'this glyph is actually bigger/smaller', not just that a code path was exercised"

key-files:
  created:
    - scripts/test-drawblocks-font-state.ts
  modified:
    - server/services/typography-compositor.service.ts

key-decisions:
  - "Fix is a 1-line ctx.font reassignment (plus explanatory comment) as the first statement of drawBlocks()'s layouts.forEach loop body, placed before the letter-spacing tracking calculation so tracking is computed/applied against the CORRECT font — no new parameters, no new BlockLayout fields (size_px/alias already existed on BlockLayout from layoutBlocks(), drawBlocks just never reused them)."
  - "COMPOSITOR_VERSION deliberately left at 1 — the persisted typography_meta contract (fonts[].size_px/alias/etc.) was never wrong; only the rasterized glyphs were. No consumer needs to distinguish pre-fix from post-fix output by version."
  - "No feature flag / opt-out added. 26-CONTEXT.md and the plan both explicitly frame this as closing a bug, not introducing a mode — every existing and future multi-block render benefits unconditionally."

requirements-completed: [POL-02]

# Metrics
duration: 20min
completed: 2026-07-28
---

# Phase 26 Plan 03: drawBlocks() Per-Block Font-State Bugfix Summary

**Fixed the pre-existing `drawBlocks()` bug where every text block in a multi-block layout silently rendered using whatever font `layoutBlocks()`'s measurement loop left on the canvas context (the LAST block's) — so a headline next to a CTA rendered at CTA size — via a 1-line `ctx.font` reassignment per block, proven by a real-pixel ink-extent harness rather than font-metrics memorization.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-28
- **Tasks:** 2/2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `scripts/test-drawblocks-font-state.ts` (new, 6 assertions) proves the bug and its fix with real rendered pixels against the deterministic `tests/fixtures/typography/high-contrast-1024.png` fixture (flat rgb(12,12,12), white text, no scrim — an unambiguous >128-greyscale ink threshold, itself asserted per-render via `requireUsableMeta` rather than blindly trusted):
  1. A highlight block's first-line ink extent matches within 2px whether rendered alone or as the first of two blocks
  2. That multi-block highlight extent is >= 0.5 × its own `meta.fonts[0].size_px`
  3. A CTA-alone sanity control (passes both before and after the fix — proves the harness isn't vacuously red)
  4. The multi-block highlight is unambiguously bigger than a solo CTA (the "eyeball test")
  5. The zero-text-block pass-through stays byte-identical to the input
  6. `meta.fonts[].size_px` was always strictly descending across `[highlight, cta]` — documenting that the metadata was never the bug, only the raster was
- **Before the fix (Task 1 RED run):** 3/6 passed — assertions 1, 2, and 4 failed with concrete pixel numbers (`soloExtent=62px multiExtent=28px`, etc.); assertion 3 (sanity control) passed as required.
- **The fix (Task 2):** `drawBlocks()`'s `layouts.forEach` loop now sets `ctx.font = \`${layout.size_px}px ${layout.alias}\`` as its first statement, before the letter-spacing tracking calculation. Both values already existed on `BlockLayout` (populated by `layoutBlocks()`) — no new data, no new parameters.
- **After the fix:** all 6 assertions pass (`soloExtent=62px multiExtent=62px`, `multiExtent=62px` vs `soloCtaExtent=28px`).

## Task Commits

1. **Task 1: scripts/test-drawblocks-font-state.ts — RED proof of the bug** - `e2d8d50` (test)
2. **Task 2: Set ctx.font per block in drawBlocks** - `382f8f5` (fix)

_Plan metadata commit follows this summary._

## Files Created/Modified

- `scripts/test-drawblocks-font-state.ts` - no-network unit harness; real-pixel ink-extent proof of per-block font state (230 lines)
- `server/services/typography-compositor.service.ts` - `drawBlocks()`'s `layouts.forEach` loop gained a per-iteration `ctx.font = ...` assignment (8 lines: comment + assignment)

## Decisions Made

- Measured ink extent via `sharp`'s `extract` + `greyscale` + `raw` pixel buffer rather than any snapshot/golden-PNG diff, per the plan's explicit "functional proof that does not depend on font metrics being memorised" requirement.
- Used the `top_stack` layout archetype exclusively for the test because it is the only archetype where the first block's first line is drawn at exactly `(region.left, region.top)` with `textBaseline: "top"`/`textAlign: "left"` — making the extraction region computable once (via the already-exported `computeArchetypeRegion`) and independent of total text height.
- Added a `requireUsableMeta` guard (checked per composite call, not assumed once globally) that throws loudly if `meta.text_color !== "#FFFFFF"` or `meta.scrim !== null`, so a future change to `analyzeRegionContrast`'s thresholds or the fixture's color can never silently produce a meaningless ink-count.

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched their prescribed action/acceptance criteria without needing any Rule 1-3 auto-fixes; no architectural questions arose (Rule 4 N/A).

## Issues Encountered

- `npx tsx scripts/verify-phase-25.ts` (full suite, one of the required Task 2 verification commands) exceeded the interactive 90s shell timeout on this machine due to its own internal `spawnSync` sweep of 6 other verify scripts + `verify-golden-image.ts`. Re-ran it with a longer timeout; it completed in well under that limit and reported the full suite green (all `[svc-cross-plan]` zero-regression checks passed). Not a plan issue — just a slow-harness / short-shell-timeout mismatch in this environment.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `scripts/verify-phase-26.ts --only=svc-drawblocks-font-fix` is now fully green (4/4) — one more of Phase 26's 9 tags closed (POL-02's typography half; the WebP-quality half of POL-02 is separate scope, plans 26-02/26-06/26-08 per the phase's tag ownership).
- Every downstream plan that composites multi-block typography (carousels, single-image, both edit paths) now automatically renders each block at its correct size with zero code changes required on their part — the fix lives entirely inside the shared `drawBlocks()` function all callers already go through.
- Confirmed zero regression: `scripts/verify-golden-image.ts` (22/22, the CI-wired gate), `scripts/test-typography-treatment.ts` (28/28), `scripts/verify-phase-23.ts` (full suite), `scripts/verify-phase-25.ts` (full suite, including its own cross-plan non-regression sweep of Phases 21/21.1/22/23/24 + golden-image). `npm run check` and `npm run build` both clean.
- No blockers for remaining Phase 26 plans (26-02, 26-06 through 26-10).

---
*Phase: 26-fixes-and-polish*
*Completed: 2026-07-28*

## Self-Check: PASSED

Verified `scripts/test-drawblocks-font-state.ts` exists on disk. Verified commits `e2d8d50` and `382f8f5` exist in `git log --oneline --all`.
