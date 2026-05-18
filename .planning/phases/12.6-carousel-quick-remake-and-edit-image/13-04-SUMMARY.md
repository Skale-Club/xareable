---
phase: 13-carousel-quick-remake-and-edit-image
plan: 04
subsystem: client-components
tags: [carousel, slide-edit, quick-remake, post-viewer-dialog, sse, state-splice, CRSL-EDIT-01, CRSL-EDIT-02]

requires:
  - phase: 13-carousel-quick-remake-and-edit-image
    plan: 02
    provides: POST /api/carousel/slide/edit endpoint + SSE complete payload shape
  - phase: 13-carousel-quick-remake-and-edit-image
    plan: 03
    provides: PostEditDialog.contentType="carousel-slide" variant + slideId + slideIndex props

provides:
  - Edit Image button visible and functional on carousel posts (CRSL-EDIT-01)
  - Quick Remake button visible and functional on carousel posts (CRSL-EDIT-02)
  - buildCarouselSlideQuickRemakeRequest helper in client/src/lib/quick-remake.ts
  - Local carouselSlides state splice after slide edit (no full reload)
  - Slide-1 drift warning toast on Edit Image click when currentSlideIndex === 0
  - post:version-created event fired after both carousel edit paths

affects:
  - 13-05-PLAN.md (UAT verification plan — both buttons now functional end-to-end)

tech-stack:
  added: []
  patterns:
    - "carousel branch guard in handleQuickRemake — early return, does not fall through to image/video path"
    - "fetchSSE('/api/carousel/slide/edit', body, callbacks) — no token param; auth handled by getAuthHeaders() inside fetchSSE"
    - "setCarouselSlides splice: prev.map((s, i) => i === currentSlideIndex ? { ...s, image_url, thumbnail_url } : s)"
    - "PostEditDialog contentType ternary: carousel -> 'carousel-slide', video -> 'video', else 'image'"
    - "slide-1 drift warning: non-blocking toast fires before setIsEditDialogOpen(true)"

key-files:
  created: []
  modified:
    - client/src/lib/quick-remake.ts
    - client/src/components/post-viewer-dialog.tsx

line-ranges-modified:
  quick-remake.ts:
    - "line 1: import updated to include EditSlideRequest"
    - "lines 34-61: buildCarouselSlideQuickRemakeRequest (new export)"
  post-viewer-dialog.tsx:
    - "line 30: import updated to include buildCarouselSlideQuickRemakeRequest"
    - "lines 253-320: handleQuickRemake — carousel branch inserted before existing image/video logic"
    - "lines 608-641: Quick Remake button — gate removed, disabled prop updated"
    - "lines 642-666: Edit Image button — gate removed, onClick with slide-1 toast, disabled prop updated"
    - "lines 747-788: PostEditDialog — contentType/slideId/slideIndex props + carousel onGenerated splice"

key-decisions:
  - "fetchSSE called without token field — auth handled internally via getAuthHeaders(); removes dependency on supabase().auth.getSession() in component"
  - "Both buttons disabled when post.content_type==='carousel' && carouselSlides.length===0 (slides still loading or fetch failed)"
  - "carousel onGenerated early-returns after splice — non-carousel path preserved below (regression safe)"
  - "Slide version navigation (prev/next version chevrons) remains gated to non-carousel posts — per-slide version browsing deferred to v2"

deferred-to-v2:
  - "Per-slide version navigation UI (prev/next version chevrons for carousel slides)"
  - "Cascade re-generation when slide-1 is edited (visual drift resolution for slides 2..N)"

metrics:
  duration: 20min
  completed: 2026-05-18T10:12:00Z
  tasks: 2
  files_modified: 2
  lines_added: 151
  lines_removed: 31
---

# Phase 13 Plan 04: Viewer Carousel Edit Wiring Summary

**Removed content_type gates from Edit Image and Quick Remake in PostViewerDialog; wired carousel branches targeting /api/carousel/slide/edit with local state splice and slide-1 drift warning**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-05-18T10:12:00Z
- **Tasks:** 2
- **Files modified:** 2 (quick-remake.ts +30/-1, post-viewer-dialog.tsx +121/-30)

## Accomplishments

- `buildCarouselSlideQuickRemakeRequest` exported from `client/src/lib/quick-remake.ts` — returns fully typed `EditSlideRequest` with `source: "quick_remake"`, omits `text_mode`/`replacement_text`/`text_style_ids` (CRSL-10)
- Both `content_type !== "carousel"` gates removed from Quick Remake button (line 608 region) and Edit Image button (line 624 region)
- Both buttons disabled when `post.content_type === "carousel" && carouselSlides.length === 0` (slides still loading or fetch failed)
- `handleQuickRemake` carousel branch: calls `fetchSSE("/api/carousel/slide/edit", body, callbacks)` with `buildCarouselSlideQuickRemakeRequest`; splices `carouselSlides` local state on `onComplete`; dispatches `post:version-created` event; does not fall through to image/video path
- `PostEditDialog` receives `contentType="carousel-slide"`, `slideId={carouselSlides[currentSlideIndex]?.id ?? null}`, `slideIndex={currentSlideIndex}` for carousel posts
- `onGenerated` carousel branch splices `carouselSlides[currentSlideIndex]` locally, fires `post:version-created`, shows toast — then early-returns; non-carousel path preserved below
- Slide-1 drift warning toast fires (non-blocking, no `destructive` variant) when Edit Image clicked with `currentSlideIndex === 0`
- `npm run check` exits 0 (zero TypeScript errors)

## Task Commits

1. **Task 1: buildCarouselSlideQuickRemakeRequest helper** — `9ebdcd9 feat(13-04): add buildCarouselSlideQuickRemakeRequest helper to quick-remake.ts`
2. **Task 2: Carousel branches in post-viewer-dialog.tsx** — `512ab4a feat(13-04): wire carousel Edit Image + Quick Remake in PostViewerDialog`

## Files Modified

- `client/src/lib/quick-remake.ts` — import widened to include `EditSlideRequest`; `buildCarouselSlideQuickRemakeRequest` appended (30 lines added, 1 changed)
- `client/src/components/post-viewer-dialog.tsx` — import updated; `handleQuickRemake` carousel branch (57 lines); button gate removals + disabled guards + slide-1 toast; `PostEditDialog` prop update + carousel `onGenerated` splice

## Deviations from Plan

### Auto-adjusted — no architectural changes

**1. [Rule 1 - Bug] fetchSSE does not accept a `token` option**
- **Found during:** Task 2 (reading sse-fetch.ts before writing)
- **Issue:** Plan's code snippet passed `token` inside the callbacks object to `fetchSSE`. The actual `fetchSSE` signature is `(url, body, callbacks, signal?)` where callbacks is `{ onProgress?, onComplete?, onError? }` only. Auth headers are fetched internally via `getAuthHeaders()`.
- **Fix:** Removed the `token` derivation and the `token:` field from the callbacks object. Auth works without it.
- **Files modified:** `client/src/components/post-viewer-dialog.tsx`
- **Commit:** `512ab4a`

## Regression: Non-carousel Posts

- Image posts: `handleQuickRemake` carousel branch returns early on `post.content_type === "carousel"` check only — image path unchanged below
- Video posts: same carousel guard — video path unchanged
- `PostEditDialog` receives `contentType="video"` or `contentType="image"` for non-carousel posts — unchanged
- `onGenerated` for non-carousel: carousel early-return skipped (no `slide_id` in result) — falls through to `loadVersions()` + `setCurrentVersionIndex()` path unchanged

## Deferred v2 Scope

Per RESEARCH.md "Version navigation for carousel slides" and plan task 2 note:

- **Per-slide version navigation UI**: The existing version nav UI (prev/next version chevrons + delete button) remains gated to `post.content_type !== "carousel"`. Carousel slide versions are stored in `post_slide_versions` but not surfaced in the viewer in Phase 13. Users see only the latest slide image (spliced into `carouselSlides` state after each edit). Full per-slide version browsing is a v2 affordance.
- **Cascade re-generation on slide-1 edit**: When slide-1 is edited, slides 2..N retain their original style anchor. The slide-1 drift warning informs users; cascading all other slides is CRSL-V2-01 scope.

## Known Stubs

None — all carousel edit/quick-remake flows are fully wired. `slideId` guard in PostEditDialog (`if (isCarouselSlide && !slideId) return`) is protected by the disabled state on the button (`carouselSlides.length === 0`).

## Self-Check: PASSED

- `client/src/lib/quick-remake.ts` contains `buildCarouselSlideQuickRemakeRequest` export — confirmed
- `client/src/components/post-viewer-dialog.tsx` contains `contentType="carousel-slide"` — confirmed
- `9ebdcd9` commit verified in git log
- `512ab4a` commit verified in git log
- `npm run check` exits 0 (zero TypeScript errors)
