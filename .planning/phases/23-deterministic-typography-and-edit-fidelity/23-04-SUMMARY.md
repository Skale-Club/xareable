---
phase: 23-deterministic-typography-and-edit-fidelity
plan: 04
subsystem: infra
tags: [napi-rs-canvas, sharp, typography, contrast-scrim, glyph-hashing]

# Dependency graph
requires:
  - phase: 23-01
    provides: "@napi-rs/canvas dependency, bundled Inter fonts (server/assets/fonts, copied to dist/assets/fonts), pt-BR/es golden-image fixtures, scripts/verify-phase-23.ts phase gate"
provides:
  - "server/services/typography-compositor.service.ts — the deterministic server-side typography compositor: font registration, archetype geometry/safe-zones, text-block resolution, contrast/scrim analysis, the compositeTypography draw loop (word-wrap + auto-shrink), and a golden-image glyph-raster-hash tofu detector"
  - "ARCHETYPE_NEGATIVE_SPACE_ZONE — the archetype-to-negative-space-copy map plan 23-05 imports so the image-generation prompt and this file's geometry can never drift apart"
affects: [23-05, 23-06, 23-07, 23-08, 23-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-weight font-alias registration (Inter-Regular/Inter-SemiBold/Inter-Bold), memoized once per process via a module-scope let, never per request"
    - "Deterministic WCAG-inspired (not WCAG-conformant) region-contrast scrim decision: raw luminance delta OR busy/high-variance stdev OR a mid-luminance band that always scrims regardless of the raw delta"
    - "Auto-shrink-together (never per-block) layout loop: scale all block font sizes down by AUTOSHRINK_STEP until total height fits the archetype region or MIN_SIZE_RATIO is hit"
    - "Cheap pass-through for the zero-text-blocks case — no canvas re-encode when there is nothing to draw"
    - "Golden-image tofu detection via SHA-256 hash of a rendered glyph, compared against a guaranteed-unmapped codepoint hash and a blank-space hash"

key-files:
  created:
    - server/services/typography-compositor.service.ts
  modified: []

key-decisions:
  - "TypographyMeta type defined locally in typography-compositor.service.ts (not imported from shared/schema.ts) so this file type-checks standalone regardless of parallel plan 23-02's landing order in the same wave; field shape mirrors 23-02's typographyMetaSchema exactly (verified against shared/schema.ts post-merge — no drift)"
  - "registerBundledFonts() uses three explicit GlobalFonts.registerFromPath call expressions (not a loop over an array) so grep -c 'registerFromPath' == 3 exactly, matching the plan's literal acceptance criterion"
  - "BLOCK_GAP_RATIO gap is charged to the block that precedes it (sized from that block's own line_height_px, applied only between blocks, never after the last one) — the plan's phrasing ('gap between blocks, as a fraction of that block's line height') was ambiguous on direction; this reading matches the literal draw-loop step order in the plan (advance y per line, then add the gap before the next block)"
  - "Doc comments describing resolveFontDir/registerBundledFonts avoid restating the literal substrings 'dist/assets/fonts' and 'server/assets/fonts' outside the actual path.resolve() calls, so each appears exactly once in the file per the plan's literal grep -c == 1 criteria"

patterns-established:
  - "Compositor draw-loop decomposition: layoutBlocks (auto-shrink) -> computeScrimRect (per-archetype scrim geometry) -> drawBlocks (per-archetype alignment/anchor) as three small private helpers around one public compositeTypography entry point"

requirements-completed: [TYPO-02, TYPO-03]

# Metrics
duration: 15min
completed: 2026-07-27
---

# Phase 23 Plan 04: Deterministic Typography Compositor Summary

**`typography-compositor.service.ts` — real bundled Inter weights drawn via `@napi-rs/canvas` across 3 layout archetypes, with safe-zone word-wrap/auto-shrink and a `sharp`-driven automatic contrast scrim, replacing AI-rendered on-image text entirely**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-27T21:15:00Z
- **Completed:** 2026-07-27T21:29:56Z
- **Tasks:** 3
- **Files modified:** 1 (created)

## Accomplishments
- `registerBundledFonts()` registers the three bundled Inter weights under distinct per-weight aliases (`Inter-Regular`/`Inter-SemiBold`/`Inter-Bold`), memoized once per process, failing loudly (not silently) if any registration returns falsy
- `computeArchetypeRegion()` + `computeSafeZone()` compute deterministic, safe-zone-intersected text regions for all three layout archetypes (`bottom_band`/`top_stack`/`centered_hero`), with a conservative wider inset for 4:5 (Instagram grid-crop uncertainty)
- `resolveTextBlocks()` resolves the `text_blocks` vs `headline`/`subtext` overlap Phase 22 deferred to this phase
- `analyzeRegionContrast()` samples the target region's luminance/stdev via `sharp`'s `.extract().stats()` and deterministically decides scrim necessity + text color, with a mid-luminance band that always scrims and a fail-toward-legibility default on any error
- `compositeTypography()` draws the base image, lays out text with auto-shrink-together word-wrap, draws the scrim (only when needed) before text, draws the text per archetype alignment/anchor rules, and returns a schema-shaped `typography_meta` record — degrading to a pass-through base image on any failure, and cheaply skipping the canvas entirely when there are no text blocks
- `renderGlyphRasterHash()` — a SHA-256 raster-hash tofu detector for pt-BR/es accented glyphs, used by the golden-image glyph-coverage check
- `ARCHETYPE_NEGATIVE_SPACE_ZONE` exported for plan 23-05 to consume verbatim in the image-generation prompt's negative-space instruction

## Task Commits

Each task was committed atomically:

1. **Task 1: Font registration, archetype geometry, and text-block resolution** - `ddf7b1b` (feat)
2. **Task 2: Contrast analysis and the automatic scrim decision (TYPO-03)** - `13a0dd5` (feat)
3. **Task 3: compositeTypography draw loop, word-wrap, auto-shrink, and glyph raster hashing** - `e5cc34a` (feat)

_Note: no TDD tasks in this plan — all three are `type="auto"` service-implementation work, verified via the plan's inline eval scripts and `scripts/verify-phase-23.ts --only=<tag>`._

## Files Created/Modified
- `server/services/typography-compositor.service.ts` (595 lines) — the complete deterministic typography compositor: font registration, archetype geometry/safe zones, text-block resolution, contrast/scrim analysis, the composite draw loop, and glyph-raster-hash tofu detection

## Decisions Made
- **`TypographyMeta` defined locally** in this file rather than imported from `shared/schema.ts`, since this plan ran in parallel with 23-02 (which adds the equivalent schema/type) in the same wave — keeps this file self-contained and type-checkable independent of merge order. Verified post-merge that the local shape exactly matches 23-02's `typographyMetaSchema` field-for-field (`compositor_version`, `layout_archetype_id`, `text_blocks`, `text_color`, `fonts`, `scrim`, `safe_zone`, `canvas`) — no reconciliation needed.
- **Three explicit `registerFromPath` calls instead of a loop** — the plan's acceptance criteria literally grep for exactly 3 occurrences of `registerFromPath` in the source; an array-driven loop would collapse this to 1 occurrence, so each weight gets its own explicit call expression.
- **`BLOCK_GAP_RATIO` gap direction** — applied after each block (using that block's own `line_height_px`), never after the last block. This matches the plan's draw-loop step ordering (advance `y` per line within a block, then add the gap before starting the next block).
- **Avoided repeating the literal strings `dist/assets/fonts` / `server/assets/fonts` in doc comments** — the plan's acceptance criteria require each to appear exactly once in the whole file; both now appear solely inside `resolveFontDir()`'s `path.resolve()` calls.

## Deviations from Plan

None - plan executed exactly as written. All exports, constants, and function signatures match the plan's interface spec verbatim (`COMPOSITOR_VERSION`, `FONT_ALIASES`, `ROLE_FONT_ALIAS`, `resolveFontDir`, `registerBundledFonts`, `resolveTextBlocks`, `SAFE_ZONE_INSET_RATIO`, `IG_GRID_SAFE_INSET_RATIO`, `computeSafeZone`, `computeArchetypeRegion`, `ARCHETYPE_NEGATIVE_SPACE_ZONE`, `LUMINANCE_TEXT_SWITCH`, `MIN_LUMINANCE_DELTA`, `BUSY_STDEV_THRESHOLD`, `MID_BAND_LOW`, `MID_BAND_HIGH`, `TEXT_COLOR_LIGHT`, `TEXT_COLOR_DARK`, `SCRIM_ALPHA_DARK`, `SCRIM_ALPHA_LIGHT`, `RegionContrast`, `analyzeRegionContrast`, `ROLE_SIZE_RATIO`, `LINE_HEIGHT_RATIO`, `AUTOSHRINK_STEP`, `MIN_SIZE_RATIO`, `BLOCK_GAP_RATIO`, `compositeTypography`, `renderGlyphRasterHash`).

One TypeScript-only fix during Task 1: `GlobalFonts.registerFromPath` returns `FontKey | null`, not `boolean` — coerced each call site with `!!` before assigning to a `boolean`-typed variable. This is a mechanical type-correctness fix (Rule 1), not a behavioral deviation; `npm run check` caught it immediately and it was fixed inline before the task's first commit.

## Issues Encountered
None beyond the `FontKey | null` → `boolean` coercion noted above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `server/services/typography-compositor.service.ts` is complete and self-contained: `resolveFontDir`/`registerBundledFonts`/`resolveTextBlocks`/`computeSafeZone`/`computeArchetypeRegion`/`ARCHETYPE_NEGATIVE_SPACE_ZONE`/`analyzeRegionContrast`/`compositeTypography`/`renderGlyphRasterHash` are all implemented, exported, and functionally verified against the committed golden-image fixtures.
- `ARCHETYPE_NEGATIVE_SPACE_ZONE` is ready for plan 23-05 to import verbatim into the image-generation prompt's negative-space instruction — its three string values are locked and exported now.
- `compositeTypography`'s `{ buffer, meta }` return contract is ready for plan 23-06/23-07 to wire into `generate.routes.ts`/`edit.routes.ts` (crop → compositor → logo overlay pipeline).
- `npx tsx scripts/verify-phase-23.ts --only=svc-compositor-archetypes` and `--only=svc-contrast-scrim` are both fully green; `--only=svc-golden-image-glyphs`'s functional glyph-hash check is green (only the `scripts/verify-golden-image.ts` file-existence check remains red, by design, until plan 23-08). `npm run check` is clean. Regression-checked: `verify-phase-21.ts`, `verify-phase-21.1.ts`, and `verify-phase-22.ts` all still pass.
- No blockers identified for downstream plans. Plan 23-05 (text-free prompt), 23-02 (schema migration), and 23-03 (aspect crop) completed in the same parallel wave — all three are visible as green in the shared `scripts/verify-phase-23.ts` harness.

---
*Phase: 23-deterministic-typography-and-edit-fidelity*
*Completed: 2026-07-27*

## Self-Check: PASSED

`server/services/typography-compositor.service.ts` confirmed present on disk; all 3 task commits (`ddf7b1b`, `13a0dd5`, `e5cc34a`) confirmed in git history.
