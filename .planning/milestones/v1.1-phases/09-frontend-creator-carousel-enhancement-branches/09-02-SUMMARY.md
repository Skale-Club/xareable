---
phase: 09-frontend-creator-carousel-enhancement-branches
plan: 02
subsystem: frontend/creator-dialog
tags: [content-type, config, state-union, sceneries, foundation]
dependency_graph:
  requires: []
  provides:
    - CONTENT_TYPE_ENABLED config object in post-creator-dialog.tsx
    - ContentType union type (image | video | carousel | enhancement)
    - ENABLED_CONTENT_TYPES derived array
    - activeSceneries and enhancementAvailable helpers
    - Four-card Content Type step with conditional Enhancement gating
  affects:
    - 09-03 (carousel branch — wires CAROUSEL_STEPS into the steps IIFE)
    - 09-04 (enhancement branch — wires ENHANCEMENT_STEPS, consumes activeSceneries)
tech_stack:
  added: []
  patterns:
    - IIFE for steps derivation (extensible switch for future branches)
    - ENABLED_CONTENT_TYPES.filter() for runtime gating
    - aria-hidden="true" on decorative icons
key_files:
  created: []
  modified:
    - client/src/components/post-creator-dialog.tsx
decisions:
  - "CONTENT_TYPE_ENABLED initial state: image=true, video=false, carousel=true, enhancement=true (D-01)"
  - "Content Type step shown only when ENABLED_CONTENT_TYPES.length >= 2 (D-02)"
  - "Enhancement card hidden when activeSceneries.length === 0 with inline note (D-15)"
  - "steps derivation uses IIFE to make 09-03/09-04 branch additions non-structural"
  - "Carousel and Enhancement card onClicks are intentional no-ops until 09-03/09-04 wire step lists"
metrics:
  duration_minutes: 3
  tasks_completed: 1
  files_modified: 1
  completed_date: "2026-04-29"
requirements: [CRTR-03]
---

# Phase 09 Plan 02: Foundation — CONTENT_TYPE_ENABLED Config, ContentType Union, Content Type Step

Replaced the `VIDEO_ENABLED` boolean with a `CONTENT_TYPE_ENABLED` config object, extended the `contentType` state union to all four values, and rendered a four-card Content Type step with Enhancement conditionally gated on active sceneries.

## What Was Built

### Line Ranges Replaced

| Change | Original Lines | New Content |
|--------|---------------|-------------|
| `VIDEO_ENABLED` constant | line 83 | `CONTENT_TYPE_ENABLED` object + `ContentType` type + `ENABLED_CONTENT_TYPES` derived array |
| `IMAGE_STEPS` array condition | line 88 | `ENABLED_CONTENT_TYPES.length >= 2` replaces `VIDEO_ENABLED` |
| `contentType` state declaration | line 123 | `useState<ContentType>(ENABLED_CONTENT_TYPES[0] ?? "image")` |
| `catalog` / `steps` derivation | lines 160-161 | Added `activeSceneries`, `enhancementAvailable`, and IIFE `steps` switch |
| Content Type step rendering | lines 498-580 | Full 4-card grid with conditional Enhancement and unavailability note |

### New Helpers and Where They Are Referenced

- **`CONTENT_TYPE_ENABLED`** — top-level config constant at line ~87. Referenced by `ENABLED_CONTENT_TYPES.filter()` and by the `CONTENT_TYPE_ENABLED.enhancement` guard for the unavailability note.
- **`ContentType`** — type alias at line ~94. Used in `useState<ContentType>` and `ENABLED_CONTENT_TYPES` typing.
- **`ENABLED_CONTENT_TYPES`** — derived array at line ~97. Referenced in: `IMAGE_STEPS` condition, `useState` default, reset `useEffect`, `handleGenerate` cleanup, `handleCreateAnother`, and Content Type step `effectiveTypes` filter.
- **`activeSceneries`** — computed at line ~182 from `catalog.sceneries.filter(s => s.is_active !== false)`. Referenced by `enhancementAvailable` and consumed by 09-04 Scenery Picker.
- **`enhancementAvailable`** — boolean at line ~185 (`activeSceneries.length > 0`). Referenced in Content Type step `effectiveTypes` filter and in the unavailability note guard.

### Content Type Step Cards

Four buttons rendered via `effectiveTypes.includes()` guards:

| Card | `data-testid` | Icon | onClick behavior |
|------|--------------|------|-----------------|
| Image | `content-type-image` | `<ImageIcon aria-hidden="true">` | Sets contentType + first post format aspect ratio |
| Video | `content-type-video` | `<VideoIcon aria-hidden="true">` | Upgrade gate or sets contentType + video format ratio |
| Carousel | `content-type-carousel` | `<LayoutPanelTop aria-hidden="true">` | Sets contentType + `"1:1"` aspect ratio |
| Enhancement | `content-type-enhancement` | `<Sparkles aria-hidden="true">` | Sets contentType + `"1:1"` aspect ratio |

Enhancement card is filtered out of `effectiveTypes` when `enhancementAvailable === false`. When `CONTENT_TYPE_ENABLED.enhancement === true` AND `!enhancementAvailable`, the inline note `"Photo enhancement is currently unavailable."` renders below the grid.

### Intentional No-Ops

Selecting Carousel or Enhancement currently leaves the dialog rendering `IMAGE_STEPS` (because the steps IIFE falls through to `return IMAGE_STEPS` for both). This is deliberately a no-op until:

- **09-03** adds `CAROUSEL_STEPS` to the steps IIFE and wires the Slides step rendering
- **09-04** adds `ENHANCEMENT_STEPS` to the steps IIFE and wires the Upload Photo + Scenery Picker steps

The Image and Video flows are completely unaffected — regression-free.

## Deviations from Plan

None — plan executed exactly as written.

The only minor discovery: `translations.ts` already contained Phase 9 string additions (pre-staged by the planner), so no new translation keys needed to be added. No deviation documented because this was additive context, not a conflict.

## Known Stubs

None — this plan adds config infrastructure and UI scaffolding only. No stubs that block the plan's goal (no user-facing data rendering paths introduced).

## Self-Check: PASSED

- [x] `client/src/components/post-creator-dialog.tsx` — FOUND
- [x] Commit `ff5cf3e` — FOUND
- [x] `CONTENT_TYPE_ENABLED` constant present — VERIFIED
- [x] `VIDEO_ENABLED` removed — VERIFIED
- [x] `ContentType` union covers 4 values — VERIFIED
- [x] `ENABLED_CONTENT_TYPES` array present — VERIFIED
- [x] `activeSceneries` + `enhancementAvailable` present — VERIFIED
- [x] All 4 `data-testid="content-type-*"` buttons present — VERIFIED
- [x] All 4 icons carry `aria-hidden="true"` — VERIFIED
- [x] `"Photo enhancement is currently unavailable."` string present — VERIFIED
- [x] `LayoutPanelTop` imported and used — VERIFIED
- [x] `npm run check` exits 0 — VERIFIED
