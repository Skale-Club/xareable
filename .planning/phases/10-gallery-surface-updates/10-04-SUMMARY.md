---
phase: 10-gallery-surface-updates
plan: "04"
subsystem: ui
tags: [react, supabase, post-viewer-dialog, post-creator-dialog, carousel, sse, gallery]

# Dependency graph
requires:
  - phase: 10-02
    provides: postGalleryItemSchema with slide_count/status, gallery query updated
  - phase: 10-03
    provides: gallery tile rendering with deck-stack, type icons, badges
  - phase: 07-server-routes
    provides: carousel SSE route with partial-draft save semantics, markCreated mechanism

provides:
  - carousel branch in PostViewerDialog (post_slides fetch, prev/next nav, keyboard nav, error fallback)
  - markCreated() called on both SSE complete and SSE error paths for carousel generation

affects:
  - gallery phase readiness (GLRY-03, GLRY-05 satisfied)
  - any future slide viewer enhancements (CRSL-V2 deferred features)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "carousel viewer branch: conditional on post.content_type === 'carousel' inside existing PostViewerDialog"
    - "t().replace('{param}', value) pattern for parameterized translation strings"
    - "GLRY-05 double-markCreated pattern: SSE onError + catch-block else both fire independently, idempotent"

key-files:
  created: []
  modified:
    - client/src/components/post-viewer-dialog.tsx
    - client/src/components/post-creator-dialog.tsx

key-decisions:
  - "Carousel branch added inside existing PostViewerDialog (no new file) — reuses dialog structure, consistent with plan"
  - "t().replace('{n}', ...) substitution pattern used instead of passing object to t() — matches existing project convention"
  - "onError + catch-block else both call markCreated() independently; this is intentional and idempotent"
  - "carousel_aborted/carousel_full_failure branches skip markCreated() — no DB write occurred in those paths"
  - "upgrade_required/insufficient_credits branches skip markCreated() — pre-generation failures, no DB write"

patterns-established:
  - "Parameterized translation: t('Slide {n} of {total}').replace('{n}', ...).replace('{total}', ...)"
  - "Carousel viewer: loadCarouselSlides() triggered in useEffect when viewingPost.content_type === 'carousel'"
  - "Two-path GLRY-05 coverage: SSE onError (server emits error event) + catch block (network/throw failure)"

requirements-completed: [GLRY-03, GLRY-05]

# Metrics
duration: 22min
completed: 2026-04-29
---

# Phase 10 Plan 04: Slide Viewer Dialog and SSE Error Cache Invalidation Summary

**Carousel slide viewer with post_slides fetch + prev/next + ArrowLeft/ArrowRight keyboard nav added to PostViewerDialog; markCreated() now fires on carousel SSE error path so partial-draft carousels appear in gallery without page reload**

## Performance

- **Duration:** 22 min
- **Started:** 2026-04-29T16:50:02Z
- **Completed:** 2026-04-29T17:11:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added carousel branch (GLRY-03) inside existing `PostViewerDialog` — fetches `post_slides` ordered by `slide_number`, shows current slide image with prev/next buttons + slide counter, supports ArrowLeft/ArrowRight keyboard nav, falls back to `post.image_url` with destructive toast on fetch failure
- Hidden Quick Remake and Edit Image/Video buttons for carousel posts (they don't apply in v1.1)
- Added `markCreated()` to carousel SSE error path (GLRY-05) — both `onError` callback in `fetchSSE` options and the catch-block `else` branch now call `markCreated()`, so partial-draft carousels appear in gallery immediately after any error that follows a DB write

## Task Commits

Each task was committed atomically:

1. **Task 1: Add carousel branch to PostViewerDialog** - `89d4e89` (feat)
2. **Task 2: Call markCreated() in carousel SSE error path** - `3ea461b` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `client/src/components/post-viewer-dialog.tsx` - Added carousel branch: PostSlide import, LayoutPanelTop icon, carousel state variables (carouselSlides/currentSlideIndex/loadingSlides/slidesFetchFailed), loadCarouselSlides() function, carousel image rendering branch, slide nav buttons, ArrowLeft/ArrowRight keyboard nav, slide counter badge, Quick Remake/Edit hidden for carousel
- `client/src/components/post-creator-dialog.tsx` - Added onError callback to carousel fetchSSE options (GLRY-05), added markCreated() in catch-block else branch (GLRY-05)

## Decisions Made
- Carousel branch hosted in existing `PostViewerDialog` — no new dialog file created, consistent with plan spec
- Parameterized translation uses `t('key').replace('{param}', value)` pattern — the `t()` function only takes one string argument (confirmed by reading LanguageContext.tsx); the object-param call pattern used in plan pseudocode is not supported by the actual codebase
- Both `onError` and catch-block `else` paths independently call `markCreated()` — this is correct and idempotent; React batches the double createdVersion bump into a single refetch when they fire close together
- `carousel_aborted` / `carousel_full_failure` branches skip `markCreated()` intentionally — the server contract guarantees zero slides saved in those paths; a refetch would be wasted
- `upgrade_required` / `insufficient_credits` branches skip `markCreated()` — these are pre-generation guard failures, no DB write occurred

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed t() calls with object param (TypeScript error TS2554)**
- **Found during:** Task 1 (post-viewer-dialog.tsx implementation)
- **Issue:** Plan pseudocode used `t("Slide {n} of {total}", { n: ..., total: ... })` but the actual `t()` function signature accepts only one string argument — passing an object causes TS2554
- **Fix:** Replaced all parameterized `t()` calls with `t('key').replace('{n}', ...).replace('{total}', ...)` — the established pattern already used in `post-creator-dialog.tsx` line 1989
- **Files modified:** `client/src/components/post-viewer-dialog.tsx`
- **Verification:** `npm run check` passes with zero errors
- **Committed in:** 89d4e89 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in plan pseudocode vs actual t() signature)
**Impact on plan:** Minor fix required by actual codebase API. No scope creep. Behavior is identical.

## Issues Encountered
None beyond the t() signature deviation above.

## Known Stubs
None — all data is wired to real Supabase queries (`post_slides` fetch) and real `markCreated()` mechanism.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GLRY-03 and GLRY-05 complete — Phase 10 gallery surface updates are fully implemented
- All gallery requirements (GLRY-01 through GLRY-05) now satisfied across plans 10-01 through 10-04
- Phase 10 is complete; ready for milestone close or next phase planning

---
*Phase: 10-gallery-surface-updates*
*Completed: 2026-04-29*
