---
phase: 09-frontend-creator-carousel-enhancement-branches
plan: 03
subsystem: frontend/creator-dialog
tags: [carousel, sse, slide-count, format-lock, result-view, progressive-ui]
dependency_graph:
  requires:
    - 09-02 (CONTENT_TYPE_ENABLED, ContentType union, ENABLED_CONTENT_TYPES, activeSceneries, IIFE steps switch)
  provides:
    - CAROUSEL_STEPS array in post-creator-dialog.tsx
    - handleGenerateCarousel with UUID idempotency_key and SSE streaming
    - Per-slide progressive thumbnail row during generation
    - Result view (viewMode "result") with caption + Save&Close + Generate Another
    - canGenerateCarousel OR validation pattern
    - resetBranchState() helper wired into Content Type card onClicks
  affects:
    - 09-04 (enhancement branch — resetBranchState stub for enhancementFile/sceneryId)
tech_stack:
  added: []
  patterns:
    - phase.match(/^slide_(\d+)$/) regex for SSE slide progress routing
    - crypto.randomUUID() for per-submit idempotency key (D-23)
    - Image URLs mapped from completePayload.image_urls[] (only on complete, not per-slide)
    - canGenerateCarousel OR pattern: referenceText.trim() !== "" || referenceImages.length > 0
key_files:
  created: []
  modified:
    - client/src/components/post-creator-dialog.tsx
decisions:
  - "handleGenerateCarousel committed in same task as CAROUSEL_STEPS — both tasks modified same file and carousel state was needed for both"
  - "viewMode useState widened to ViewMode type alias (already declared with result in 09-02 file but useState used narrow inline type)"
  - "Spinner thumbnails all render at t=0 from pre-seeded carouselSlides array — correct given SSE contract: image_urls only arrive on complete"
  - "completePayload.image_urls[] mapped to slides in slide_number order post-fetchSSE — no per-slide streaming images"
metrics:
  duration_minutes: 10
  tasks_completed: 2
  files_modified: 1
  completed_date: "2026-04-29"
requirements: [CRTR-01, CRTR-04, CRTR-05, CRSL-04]
---

# Phase 09 Plan 03: Full Carousel Branch — Steps, Generation Handler, Progressive UI, Result View

Added the complete carousel branch to `post-creator-dialog.tsx`: step list, slide count picker, locked format step (1:1/4:5), `handleGenerateCarousel` handler posting to `/api/carousel/generate` with a UUID `idempotency_key`, per-slide SSE progress thumbnails, and the post-completion result view with caption and Save&Close / Generate Another actions.

## What Was Built

### New State Additions

| State | Type | Default | Reset In |
|-------|------|---------|----------|
| `slideCount` | `number` | `3` | close useEffect, resetBranchState, handleCreateAnother |
| `carouselSlides` | `Array<{slideNumber, imageUrl, failed}>` | `[]` | all reset paths |
| `carouselCaption` | `string` | `""` | all reset paths |
| `carouselSavedCount` | `number` | `0` | all reset paths |
| `carouselRequestedCount` | `number` | `0` | all reset paths |
| `carouselStatus` | `"completed" \| "draft" \| null` | `null` | all reset paths |
| `carouselCurrentSlide` | `number` | `0` | all reset paths |

### CAROUSEL_STEPS Array (line ~122)

```ts
const CAROUSEL_STEPS = [
  ...(ENABLED_CONTENT_TYPES.length >= 2 ? ["Content Type"] : []),
  "Slides",
  "Reference",
  "Post Mood",
  "Format / Size",
];
```

5 steps when Content Type shown, 4 otherwise. Wired into the steps IIFE at line ~209: `if (contentType === "carousel") return CAROUSEL_STEPS`.

### Slide Count Picker — Slides Step (renderStepContent)

Chip row 3-8 with `data-testid={\`slide-count-${n}\`}` and `aria-pressed`. Default 3. Selected chip: `border-violet-400 bg-violet-400/10 text-violet-400`.

### Carousel Format Step (locked aspect ratios)

`availableFormats` filter at Format / Size step:

```ts
const availableFormats = contentType === "carousel"
  ? baseFormats.filter((f) => f.value === "1:1" || f.value === "4:5")
  : baseFormats;
```

Info note rendered below the grid: `t("All slides in this carousel share the same format.")` with `bg-violet-400/5 border border-violet-400/20`.

### resetBranchState() Helper (line ~690)

Zeroes out all branch-specific state on content type change (D-22). Wired into each content type card onClick with `if (contentType !== X) { resetBranchState(); setStep(0); }` guard. Enhancement and enhancement stubs for `enhancementFile`/`sceneryId` noted as 09-04 scope.

### canGenerateCarousel Validation (D-21 OR pattern)

```ts
const canGenerateCarousel =
  (referenceText.trim() !== "" || referenceImages.length > 0) &&
  slideCount >= 3 && slideCount <= 8 &&
  (aspectRatio === "1:1" || aspectRatio === "4:5") &&
  postMood.trim() !== "";
```

OR pattern is critical: users who upload reference images without typing text can still generate. Strict AND would incorrectly block them.

### handleGenerateCarousel SSE Flow (line ~535)

1. `setViewMode("generating")` — switches UI immediately
2. Pre-seeding: `Array.from({ length: slideCount }, ...)` creates N `{slideNumber, imageUrl: null, failed: false}` entries — spinner row visible from t=0
3. `crypto.randomUUID()` for `idempotencyKey` (D-23 / CRTR-04)
4. `fetchSSE("/api/carousel/generate", { prompt, slide_count, aspect_ratio, idempotency_key, content_language, post_mood, text_style_ids, use_logo, logo_position }, { onProgress, onComplete })`

**onProgress:**
- `phase.match(/^slide_(\d+)$/)` extracts slide number N
- `setCarouselCurrentSlide(n)` — updates the violet ring on the current thumbnail
- `/skipped|retrying/i.test(event.message)` flips `slide.failed = true` for the AlertTriangle
- **SERVER SSE CONTRACT**: per-slide events carry ONLY `{phase, message, progress}`. The `image_url` field present in `carousel-generation.service.ts` slide_complete events is NOT forwarded by the route's `mapProgress` (lines 227-271). Image URLs arrive exclusively in `completePayload.image_urls[]`.

**Post-fetchSSE mapping:**
```ts
const successfulNumbers = prev.filter(s => !s.failed).slice(0, imageUrls.length).map(s => s.slideNumber);
return prev.map(s => {
  const idx = successfulNumbers.indexOf(s.slideNumber);
  if (idx >= 0) return { ...s, imageUrl: imageUrls[idx], failed: false };
  return { ...s, failed: true };
});
```
All real slide images populate simultaneously when complete fires.

**Error paths:** `carousel_aborted` / `carousel_full_failure` → destructive toast with partial-fail message. `upgrade_required` → closeCreator + UpgradePlanModal. `insufficient_credits` → AddCreditsModal.

### Generating View Carousel Additions

When `contentType === "carousel" && carouselRequestedCount > 0`:
- Status text: `t("Generating slide {n} of {total}…").replace(...)` above the thumbnail row
- Thumbnail row: N `72x72` slots — pending=Loader2 (muted), current=Loader2 (violet) + `ring-2 ring-violet-400/60`, done=`<img>`, failed=AlertTriangle + `bg-destructive/10`
- Heading adapts: `t("Creating Your Carousel")` instead of `t("Creating Your Post")`

### Result View (viewMode === "result", line ~1523)

Shown after `setViewMode("result")` fires in `onComplete`:
- "Carousel Ready" heading
- Partial-draft orange warning when `carouselStatus === "draft"`: `t("Only {n} of {requested} slides were generated. Your post was saved as a draft.")`
- Slide image grid: `carouselSlides.filter(s => !!s.imageUrl)` — only successful slides
- Read-only caption block: `select-text cursor-text max-h-[120px] overflow-y-auto`
- "Generate Another" (`data-testid="carousel-generate-another"`) — full reset via `resetBranchState()` + resets carousel state + `setViewMode("form")`
- "Save & Close" (`data-testid="carousel-save-close"`) — `closeCreator()`

### New Imports

`Loader2` and `AlertTriangle` added to the lucide-react import block.

## Files Modified

| File | Lines Changed | Key Changes |
|------|--------------|-------------|
| `client/src/components/post-creator-dialog.tsx` | +402/-9 | CAROUSEL_STEPS, slideCount, carousel state, resetBranchState, Slides step, carousel format filter, canGenerateCarousel, handleGenerateCarousel, generating view thumbnails, result view |

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

The only minor structural deviation: both Task 1 and Task 2 changes were committed together in a single commit (`b78a1e2`) because both tasks modified the same file and carousel state declarations (Task 2) needed to exist for Task 1's reset hooks to reference. The logical separation is maintained in code (Task 1 scope: CAROUSEL_STEPS, Slides step, Format filter, resetBranchState, canGenerateCarousel; Task 2 scope: carousel state, handleGenerateCarousel, generating view thumbnails, result view).

## Known Stubs

None — all carousel-branch data paths (slide thumbnails, caption, partial-draft warning) are wired through real SSE events and `completePayload`. No hardcoded placeholder values flow to UI rendering.

## Self-Check: PASSED

- [x] `client/src/components/post-creator-dialog.tsx` — FOUND
- [x] Commit `b78a1e2` — FOUND
- [x] `const CAROUSEL_STEPS = [` — VERIFIED (line 122)
- [x] `"Slides"`, `"Reference"`, `"Post Mood"`, `"Format / Size"` in CAROUSEL_STEPS — VERIFIED
- [x] `useState<number>(3)` for slideCount — VERIFIED (line 153)
- [x] `function resetBranchState()` — VERIFIED (line 690)
- [x] `currentStepTitle === "Slides"` in renderStepContent — VERIFIED (line 878)
- [x] `data-testid={\`slide-count-${n}\`}` template literal — VERIFIED (line 899)
- [x] `f.value === "1:1" || f.value === "4:5"` filter — VERIFIED (line 1223)
- [x] `t("All slides in this carousel share the same format.")` — VERIFIED (line 1259)
- [x] `t("Generate Carousel")` — VERIFIED (line 1363)
- [x] `referenceText.trim() !== "" || referenceImages.length > 0` OR pattern — VERIFIED (line 1352)
- [x] `if (contentType === "carousel") return CAROUSEL_STEPS` — VERIFIED (line 209)
- [x] `function handleGenerateCarousel` — VERIFIED (line 535)
- [x] `crypto.randomUUID()` — VERIFIED (line 553)
- [x] `fetchSSE("/api/carousel/generate"` — VERIFIED (line 558)
- [x] `slide_count: slideCount`, `aspect_ratio: aspectRatio`, `idempotency_key: idempotencyKey`, `post_mood: postMood` — VERIFIED (lines 561-565)
- [x] `setCarouselSlides`, `setCarouselCaption`, `setCarouselStatus` — VERIFIED
- [x] `event.phase.match(/^slide_(\d+)$/)` — VERIFIED (line 585)
- [x] `viewMode === "result"` rendering with `t("Carousel Ready")` — VERIFIED (lines 1523, 1531)
- [x] `data-testid="carousel-save-close"` and `data-testid="carousel-generate-another"` — VERIFIED (lines 1581, 1589)
- [x] `Loader2` and `AlertTriangle` in lucide-react import — VERIFIED (lines 46-47)
- [x] `t("Generating slide {n} of {total}…")` with `.replace("{n}",` — VERIFIED (lines 1458-1460)
- [x] `t("Only {n} of {requested} slides were generated. Your post was saved as a draft.")` — VERIFIED (line 1538)
- [x] `aria-label={isFailed ? failedAriaLabel : undefined}` on failed-slide wrapper — VERIFIED
- [x] `SERVER SSE CONTRACT` comment marker — VERIFIED (line 574)
- [x] `completePayload.image_urls` mapped to carouselSlides post-fetchSSE — VERIFIED (line 613)
- [x] `npm run check` exits 0 — VERIFIED
