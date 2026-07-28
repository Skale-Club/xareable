---
phase: 26-fixes-and-polish
plan: 02
subsystem: infra
tags: [sharp, webp, image-optimization, typography-compositor, regression-gate]

# Dependency graph
requires:
  - phase: 26-fixes-and-polish (plan 26-01)
    provides: scripts/verify-phase-26.ts (the [svc-webp-quality]/[svc-webp-edge-check] tags this plan turns green)
  - phase: 23-deterministic-typography-and-edit-fidelity
    provides: server/services/typography-compositor.service.ts (compositeTypography, computeArchetypeRegion — this plan's gate renders through the real compositor)
provides:
  - "DEFAULT_IMAGE_QUALITY = 85 (server/services/image-optimization.service.ts) — the main-image WebP quality every generate/edit/carousel call site inherits"
  - "scripts/verify-webp-text-edge.ts — standalone no-network gate proving quality-85 WebP encoding retains composited-text edge sharpness, with a real non-vacuity control at quality 40"
affects: [26-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Edge-energy-ratio regression gate: render real typography via compositeTypography() (lossless PNG ground truth), re-encode through the real optimizeImage() at several qualities, measure Laplacian-convolution stdev in the exact archetype text region, compare each quality's ratio against a measured-and-hardcoded threshold — same golden-image philosophy as scripts/verify-golden-image.ts, scoped to one narrow question"

key-files:
  created:
    - scripts/verify-webp-text-edge.ts
  modified:
    - server/services/image-optimization.service.ts

key-decisions:
  - "WEBP_TEXT_EDGE_MIN_RATIO = 0.996 (not a round 2-decimal value) — this fixture's ratios (q40=0.9934 .. q95=0.9992) are all clustered within ~1% of 1.0, so no 2-decimal value exists strictly between ratios[40] and ratios[85]; moved to 3 significant decimals with real margin on both sides instead of forcing an unusable 2-decimal number"
  - "Threshold was calibrated against the FINAL state of typography-compositor.service.ts (post plan 26-03's per-block ctx.font fix), not the pre-fix renderer, because that fix changes compositeTypography's actual rendered pixels and therefore this gate's own ground truth"

requirements-completed: [POL-02]

# Metrics
duration: ~35min
completed: 2026-07-28
---

# Phase 26 Plan 02: WebP Quality 85 + Text-Edge Regression Gate Summary

**Bumped the main-image WebP encode quality from 80 to 85 (thumbnails stay at 70) and installed `scripts/verify-webp-text-edge.ts`, a standalone Laplacian-edge-energy gate that proves the bump doesn't smear composited typography and provably fails at a deliberately bad quality of 40.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-28
- **Tasks:** 2/2 (plus one recalibration fixup — see Deviations)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `scripts/verify-webp-text-edge.ts` (172 lines) — renders `tests/fixtures/typography/strings.json`'s `pt_br` block set through the REAL `compositeTypography()` onto `high-contrast-1024.png`, re-encodes that lossless PNG through the REAL `optimizeImage()` at qualities 40/80/85/95, and measures edge-energy retention (`sharp().extract(region).greyscale().convolve(Laplacian).stats().stdev`) in the exact `computeArchetypeRegion("bottom_band", ...)` text region relative to the lossless ground truth. Six assertions: quality-85 ratio above threshold, quality-40 ratio below threshold (non-vacuity control), quality-85 not a regression vs quality-80, and three `Buffer.compare` byte-identity proofs that `optimizeImage`/`generateThumbnail`'s defaults are exactly 85/70 respectively — no grep required.
- `server/services/image-optimization.service.ts` — `DEFAULT_IMAGE_QUALITY` changed from 80 to 85 in exactly one line, with a decision comment pointing at the new gate; `DEFAULT_THUMBNAIL_OPTIONS.quality` (70) and every `processImageWithThumbnail(` call site (generate/edit/carousel routes + `carousel-generation.service.ts`, 5 total occurrences) confirmed untouched and single-argument, so the constant genuinely propagates everywhere with no silent override.
- `WEBP_TEXT_EDGE_MIN_RATIO` calibrated by actually running the gate (twice — see Deviations) rather than guessed; the observed ratio table is recorded verbatim in a code comment, matching Phase 23's `BUSY_STDEV_THRESHOLD = 55` documentation convention.
- Zero regression: `scripts/verify-golden-image.ts` (22/22), `scripts/verify-phase-23.ts` (full suite incl. its `[svc-cross-plan]` sweep), `scripts/verify-phase-25.ts` (full suite incl. its `[svc-cross-plan]` sweep) all green; `npm run check` and `npm run build` both clean.

## Task Commits

1. **Task 1: scripts/verify-webp-text-edge.ts — the edge-sharpness regression gate (TDD RED)** - `321d00e` (test)
2. **Task 2: DEFAULT_IMAGE_QUALITY 80 -> 85 (TDD GREEN)** - `12589c8` (feat)
3. **Recalibration fixup (see Deviations)** - `206e9f7` (fix)

_Plan metadata commit follows this summary._

## Files Created/Modified

- `scripts/verify-webp-text-edge.ts` - standalone no-network WebP text-edge-sharpness regression gate (POL-02)
- `server/services/image-optimization.service.ts` - `DEFAULT_IMAGE_QUALITY` 80 -> 85, thumbnail setting and all call sites unchanged

## Decisions Made

- **Threshold precision:** the plan asked for "a 2-decimal value strictly between ratios[40] and ratios[85]." Actual measurement showed all four quality levels landing within ~1% of the lossless ground truth (this fixture's white-text-on-flat-near-black glyph edges are an extreme, WebP-friendly luminance jump), so no 2-decimal value fits between ratios[40]=0.9934 and ratios[85]=0.9977. Used 0.996 (3 significant decimals) instead, with the reasoning and full ratio table recorded in the code comment for future recalibration.
- **Region-scoped edge measurement:** `sharp(buf).extract(region)` runs BEFORE `.greyscale().convolve(...)`, per the plan's own instruction, so the 3x3 Laplacian kernel never samples pixels outside the text region (which would leak unrelated background edge energy into the region's border pixels).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Recalibrated `WEBP_TEXT_EDGE_MIN_RATIO` after a concurrent, disjoint-files plan changed the shared renderer this gate depends on**
- **Found during:** Post-Task-2 final verification pass
- **Issue:** This plan calibrated `WEBP_TEXT_EDGE_MIN_RATIO = 0.99` against the compositor's output as it existed when Task 1 was executed. Plan 26-03 (a parallel executor in this same wave, working on the disjoint file `typography-compositor.service.ts`) landed its `drawBlocks()` per-block `ctx.font` fix concurrently. That fix changes `compositeTypography()`'s actual rendered pixels (previously all blocks in a multi-block layout rendered with one block's leftover font/size), which changed the edge-energy ratios my gate measures: `q40` moved from 0.9894 to 0.9934, `q85` moved from 0.9963 to 0.9977. Re-running the gate against the now-final, committed compositor showed the non-vacuity control (`ratios[40] < threshold`) had flipped to a false PASS — the old `0.99` threshold no longer failed at quality 40, silently blinding the gate.
- **Fix:** Confirmed `typography-compositor.service.ts` was fully committed and stable (plan 26-03's own SUMMARY.md present, zero working-tree diff against HEAD), then recalibrated by re-running `scripts/verify-webp-text-edge.ts` at high precision against that final state. Updated `WEBP_TEXT_EDGE_MIN_RATIO` from `0.99` to `0.996` and rewrote the header comment with the new ratio table and an explanation of why 2-decimal precision doesn't fit this data (same reasoning as the original calibration note, just against corrected numbers).
- **Files modified:** `scripts/verify-webp-text-edge.ts`
- **Verification:** All 6 assertions pass (`6/6 passed`, exit 0); the non-vacuity control genuinely fails at quality 40 again (`0.9934 < 0.996`); `scripts/verify-phase-26.ts --only=svc-webp-edge-check` and `--only=svc-webp-quality` both green; `npm run check` clean.
- **Committed in:** `206e9f7`

**2. [Rule 3 - Blocking, git-mechanics only] A parallel agent's `git commit` momentarily swept up this plan's staged Task 2 change into a foreign commit**
- **Found during:** Post-Task-2 verification (git status check before the next command)
- **Issue:** After staging `server/services/image-optimization.service.ts` for the Task 2 commit, a concurrent commit from plan 26-05 (running in the same shared working directory, per this wave's parallel-execution setup) landed and its diff included my already-staged file (`docs(26-05): cost-reconciliation-runbook.md` initially showed `image-optimization.service.ts | 7 +-` in `git show --stat`). This is the same class of shared-index race the parallel_execution instructions warn about, and the same git-mechanics-only deviation class 25-07's summary logged for an unrelated file.
- **Fix:** No code was ever incorrect — `git show <hash> -- server/services/image-optimization.service.ts` confirmed the diff exactly matched my intended one-line-plus-comments change, byte for byte. The 26-05 agent independently self-corrected via `git reset --mixed HEAD~1` (visible in `git reflog`), which returned my change to the working tree uncommitted. I then re-staged only `server/services/image-optimization.service.ts` (verified via `git status --short` immediately before committing, unstaging nothing else was needed since nothing foreign was staged at that point) and committed it properly as `12589c8`, attributed to this plan.
- **Files modified:** None beyond the original Task 2 change (no code correction needed, only a commit-attribution correction)
- **Verification:** `git show 12589c8 -- server/services/image-optimization.service.ts` shows exactly the intended diff; `git log --oneline -- server/services/image-optimization.service.ts` shows a clean, single commit for this plan's change.
- **Committed in:** `12589c8`

---

**Total deviations:** 2 auto-fixed (1 bug — stale calibration against a concurrently-changed dependency; 1 git-mechanics-only — no code was ever wrong, only which commit it landed in)
**Impact on plan:** Both fixes necessary for correctness of the gate's own non-vacuity guarantee and for clean commit attribution. No scope creep — neither fix touched any file outside this plan's declared `files_modified`.

## Issues Encountered

None beyond the two deviations above, both arising from this plan running as one of four parallel executors sharing one working directory and git index (per the `<parallel_execution>` block in this plan's spawn prompt).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `DEFAULT_IMAGE_QUALITY === 85` everywhere in the codebase; `scripts/verify-phase-26.ts --only=svc-webp-quality` and `--only=svc-webp-edge-check` both green — POL-02 fully closed pending plan 26-10's cross-plan sweep.
- `scripts/verify-webp-text-edge.ts` is now a real, calibrated regression gate any future compositor or image-optimization change should re-run (its own header comment documents exactly how and why to recalibrate if the ratio table shifts again).
- Zero regression on Phases 21/21.1/22/23/24/25 and the golden-image CI gate; `npm run check`/`npm run build` clean.
- Ran as one of four parallel executors (26-02/26-03/26-04/26-05) sharing this working directory — only this plan's own 2 files were ever intentionally staged/committed (see Deviations for the one transient exception, fully corrected).

---
*Phase: 26-fixes-and-polish*
*Completed: 2026-07-28*

## Self-Check: PASSED

All claimed files found on disk (`scripts/verify-webp-text-edge.ts`, `server/services/image-optimization.service.ts`, this SUMMARY.md). All claimed commits (`321d00e`, `12589c8`, `206e9f7`) found in `git log --oneline --all`.
