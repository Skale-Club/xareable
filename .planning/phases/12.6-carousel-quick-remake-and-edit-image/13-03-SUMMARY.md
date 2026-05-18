---
phase: 13-carousel-quick-remake-and-edit-image
plan: 03
subsystem: client-components
tags: [carousel, slide-edit, post-edit-dialog, sse, contentType, CRSL-10]

requires:
  - phase: 13-carousel-quick-remake-and-edit-image
    plan: 02
    provides: POST /api/carousel/slide/edit endpoint + SSE complete payload shape

provides:
  - PostEditDialog.contentType extended to "carousel-slide"
  - Single-step "Edit Goal" flow for carousel slides (no Text on Image step — CRSL-10)
  - Submit handler targeting /api/carousel/slide/edit via fetchSSE
  - onGenerated callback widened with slide_id + thumbnail_url fields
  - Slide-1 drift warning banner (slideIndex === 0)
  - Slide title customization ("Edit slide N")

affects:
  - 13-04-PLAN.md (PostViewerDialog wires PostEditDialog with contentType="carousel-slide")

tech-stack:
  added: []
  patterns:
    - "isCarouselSlide branch inside handleGenerateEdit — single function, dual URL + body shape"
    - "carouselEditContext omits text_mode/replacement_text/text_style_ids (CRSL-10)"
    - "slide-1 drift warning: border-yellow-500/50 bg-yellow-500/10 banner in DialogHeader"

key-files:
  created: []
  modified:
    - client/src/components/post-edit-dialog.tsx

interface-changes:
  EditPostDialogProps:
    contentType: '"image" | "video" | "carousel-slide"'
    slideId: "string | null (optional, required when contentType=carousel-slide)"
    slideIndex: "number (optional, 0-based, used for slide-1 drift warning)"
    onGenerated-result: "{ version_number, image_url, slide_id?, thumbnail_url? }"

carousel-slide-body-shape:
  slide_id: "post_slides.id (UUID)"
  post_id: "posts.id (UUID)"
  edit_prompt: "compiled text from goal + focus areas"
  content_language: "SupportedLanguage"
  source: '"manual"'
  edit_context:
    goal_text: "optional"
    focus_areas: "optional"
    focus_details: "optional"
    preserve_layout: "boolean"
    extra_notes: "optional"
    # text_mode / replacement_text / text_style_ids intentionally omitted (CRSL-10)

legacy-body-shape:
  post_id: "posts.id (UUID)"
  edit_prompt: "compiled text"
  content_language: "SupportedLanguage"
  source: '"manual"'
  edit_context: "full compiledEditContext including text_mode, text_style_ids, etc."

i18n-strings-introduced:
  - "Edit slide {n}" — title when isCarouselSlide; {n} replaced with 1-based slide number
  - "Editing slide 1 may affect the visual style of the rest of the carousel." — drift warning
  - "Starting slide edit..." — progress message
  - "Slide edited successfully" — toast title
  - "Could not edit slide" — error toast fallback
  - "Edit Slide" — generate button label
  # All strings are English source; PT/ES translations come in Plan 13-05

key-decisions:
  - "Single handleGenerateEdit function branches on isCarouselSlide — avoids duplication (Option A from plan)"
  - "carouselEditContext explicitly strips text_mode/replacement_text/text_style_ids to satisfy CRSL-10"
  - "thumbnail client-generation skipped for carousel-slide — endpoint already returns thumbnail_url from processImageWithThumbnail()"
  - "completePayload widened covariantly — existing image/video callers unaffected (pass only version_number + image_url)"

metrics:
  duration: 15min
  completed: 2026-05-18T09:47:00Z
  tasks: 1
  files_modified: 1
  lines_added: 85
  lines_removed: 20
---

# Phase 13 Plan 03: PostEditDialog carousel-slide variant Summary

**Single-file extension of PostEditDialog adding a "carousel-slide" contentType that targets /api/carousel/slide/edit with a stripped edit_context (no on-image text fields), a slide-1 drift warning, and a widened onGenerated callback**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-05-18T09:47:00Z
- **Tasks:** 1
- **Files modified:** 1 (post-edit-dialog.tsx, +85 / -20 lines)

## Accomplishments

- `EditPostDialogProps.contentType` extended to `"image" | "video" | "carousel-slide"`
- New optional props `slideId` and `slideIndex` added with JSDoc noting carousel-slide requirement
- `CAROUSEL_SLIDE_EDIT_STEPS = ["Edit Goal"]` constant added — CRSL-10 compliance (no Text on Image step)
- `STEP_TITLES` selection updated: `isCarouselSlide ? CAROUSEL_SLIDE_EDIT_STEPS : isVideo ? VIDEO_EDIT_STEPS : IMAGE_EDIT_STEPS`
- `handleGenerateEdit` branches on `isCarouselSlide`:
  - URL: `/api/carousel/slide/edit` vs `/api/edit-post`
  - Body: `{ slide_id, post_id, edit_prompt, content_language, source, edit_context }` vs `{ post_id, ... }`
  - `edit_context` for carousel-slide omits `text_mode`, `replacement_text`, `text_style_ids`
- `completePayload` widened: carousel-slide path includes `slide_id` + `thumbnail_url`; legacy path unchanged
- Client-side thumbnail generation block skipped for carousel-slide (endpoint already returns optimized thumbnail)
- `DialogTitle` shows `"Edit slide N"` when `isCarouselSlide`
- Slide-1 drift warning banner rendered when `isCarouselSlide && slideIndex === 0`
- Generate button label: `"Edit Slide"` for carousel-slide
- `npm run check` passes (zero TypeScript errors)

## Task Commits

1. **Task 1: Extend EditPostDialogProps + add carousel-slide branch** — `b8b3b77 feat(13-03): add carousel-slide contentType variant to PostEditDialog`

## Files Modified

- `client/src/components/post-edit-dialog.tsx` — interface widening, constant, step selection, submit handler branch, dialog header title + drift warning, generate button label

## Deviations from Plan

None — plan executed exactly as written. Option A (single function with URL + body branch) was chosen as directed.

## Known Stubs

None — the carousel-slide path is fully wired. `slide_id` must be provided by the caller (Plan 13-04) for the guard `if (isCarouselSlide && !slideId) return` to pass.

## Open Follow-Ups for Plan 13-04

- `PostViewerDialog` must open `PostEditDialog` with `contentType="carousel-slide"`, `slideId={carouselSlides[currentSlideIndex]?.id}`, `postId={post.id}`, `slideIndex={currentSlideIndex}`
- After successful `onGenerated` callback, viewer splices `carouselSlides` local state: `setCarouselSlides(prev => prev.map((s, i) => i === currentSlideIndex ? { ...s, image_url: result.image_url, thumbnail_url: result.thumbnail_url ?? s.thumbnail_url } : s))`
- Remove `post.content_type !== "carousel"` gates at lines 608 and 624 of `post-viewer-dialog.tsx`
- Quick Remake carousel branch also targets `POST /api/carousel/slide/edit` with `source: "quick_remake"` (Plan 13-04)

## Self-Check: PASSED

- `client/src/components/post-edit-dialog.tsx` contains `contentType === "carousel-slide"` — confirmed
- `b8b3b77` commit verified in git log
- `npm run check` exits 0 (zero TypeScript errors)
