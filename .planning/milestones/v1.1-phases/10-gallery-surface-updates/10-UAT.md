---
status: testing
phase: 10-gallery-surface-updates
source:
  - 10-VERIFICATION.md (human_verification block)
  - 10-01-SUMMARY.md
  - 10-02-SUMMARY.md
  - 10-03-SUMMARY.md
  - 10-04-SUMMARY.md
started: 2026-05-08T00:00:00Z
updated: 2026-05-08T00:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Carousel tile deck-stack visual
expected: |
  Open the posts gallery and locate a carousel post tile.
  - Two offset card strips visible behind the main tile (translate-x-1 + translate-x-2 / translate-y-1 + translate-y-2 offsets, creating a "deck" stacked-card look)
  - Top-left: pill containing the LayoutPanelTop icon
  - Bottom-left: "Carousel · N" badge where N matches the actual slide count
awaiting: user response

## Tests

### 1. Carousel tile deck-stack visual
expected: |
  Open the posts gallery and locate a carousel post tile.
  - Two offset card strips visible behind the main tile (translate-x-1 + translate-x-2 / translate-y-1 + translate-y-2 offsets, creating a "deck" stacked-card look)
  - Top-left: pill containing the LayoutPanelTop icon
  - Bottom-left: "Carousel · N" badge where N matches the actual slide count
result: [pending]

### 2. Enhancement tile "Enhanced" badge
expected: |
  In the gallery, find an enhancement post tile.
  - Bottom-left: violet "Enhanced" badge (bg-violet-400/15 with violet border, NOT black/white)
  - Sparkles icon visible inside or next to the badge
result: [pending]

### 3. Carousel slide viewer — navigation (mouse + keyboard)
expected: |
  Click a carousel tile to open the viewer dialog. Wait for slides to load.
  - "Previous" and "Next" buttons cycle through slides correctly
  - Slide counter badge updates per navigation (e.g., "Slide 2 of 4")
  - Prev button disabled on first slide; Next button disabled on last slide
  - Pressing ArrowLeft / ArrowRight on the keyboard (with dialog focused) cycles slides identically
result: [pending]

### 4. Partial-draft carousel — gallery invalidation on SSE error (GLRY-05)
expected: |
  Trigger a carousel generation. Cause or wait for an SSE error AFTER at least one slide has saved (a real partial failure, or simulate by killing the server / forcing an error).
  Without reloading the page:
  - Gallery shows a new tile for the partial-draft carousel
  - Tile shows the orange "Draft" badge
  - No manual page reload is required for the tile to appear
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0

## Gaps

[none yet]
