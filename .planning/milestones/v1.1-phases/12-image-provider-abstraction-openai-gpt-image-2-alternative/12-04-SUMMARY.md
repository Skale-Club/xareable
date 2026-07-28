---
phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative
plan: "04"
subsystem: api
tags: [openai, gemini, image-provider, route-wiring, carousel, enhancement, typescript]

requires:
  - phase: 12-01
    provides: "ImageProvider interface + GeminiImageProvider adapter in image-provider.ts"
  - phase: 12-02
    provides: "OpenAIImageProvider full implementation in image-provider.ts"
  - phase: 12-03
    provides: "getActiveImageProvider factory + getOpenAIApiKey + profileSchema.openai_api_key"

provides:
  - "All 4 image-generation flows routed through getActiveImageProvider() — PROV-07 satisfied"
  - "generate.routes.ts: provider.generate() replaces generateImageAsset direct call"
  - "edit.routes.ts: provider.edit() replaces editImage direct call"
  - "carousel-generation.service.ts: imageProvider injected param; slide 1 = provider.generate(), slides 2..N = provider.edit() with slide-1 buffer as currentImage"
  - "enhancement.service.ts: imageProvider injected param; callEnhancementImageModel deleted; provider.edit() used"
  - "Switching platform_settings.image_provider between gemini and openai changes behavior across all 4 flows"

affects:
  - 12-05-admin-ui

tech-stack:
  added: []
  patterns:
    - "provider.generate() / provider.edit() call pattern — canonical ImageGenerationInput / ImageEditInput shapes"
    - "imageApiKey separate from apiKey — image key can differ from text/master-plan key"
    - "slide-1-as-currentImage pattern — style consistency across carousel slides for both providers"

key-files:
  created: []
  modified:
    - server/routes/generate.routes.ts
    - server/routes/edit.routes.ts
    - server/services/carousel-generation.service.ts
    - server/routes/carousel.routes.ts
    - server/services/enhancement.service.ts
    - server/routes/enhance.routes.ts

key-decisions:
  - "thoughtSignature multi-turn pattern dropped in provider abstraction — slides 2..N use provider.edit() with slide-1 buffer as currentImage instead; both Gemini and OpenAI handle this correctly via their respective provider impls"
  - "imageApiKey added as separate optional param in CarouselGenerationParams and EnhancementParams — text-model master-plan (carousel) and pre-screen + caption (enhancement) continue to use apiKey (Gemini key)"
  - "callEnhancementImageModel deleted (not deprecated) — no dead code path; all image calls go through provider"
  - "openai_api_key added to profile select in all 4 routes — no as any casts needed (profileSchema typed by 12-03)"

metrics:
  duration: "~12 min"
  tasks: 3
  files: 6
  completed: 2026-05-17
---

# Phase 12 Plan 04: Route Wiring — All 4 Flows Through Provider Factory Summary

**All four image-generation flows (generate, edit-post, carousel, enhancement) routed through `getActiveImageProvider()` — PROV-07 satisfied; switching `platform_settings.image_provider` now changes behavior across all flows with no code changes**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-05-17
- **Tasks:** 3
- **Files modified:** 6 (0 new files, 6 modified)

## Accomplishments

- Wired `POST /api/generate` through the provider factory: replaced `generateImageAsset` import with `getActiveImageProvider()` + `provider.generate()`. Profile select now includes `openai_api_key` for key resolution.
- Wired `POST /api/edit-post` through the provider factory: replaced `editImage` import with `getActiveImageProvider()` + `provider.edit()`. Logo data passed as `logoImageData` in `ImageEditInput` shape.
- Refactored `carousel-generation.service.ts` with injected `imageProvider: ImageProvider` and `imageApiKey?: string` parameters. Replaced all 3 direct Gemini fetch sites (generateSlideOne, generateSlideNWithSignature, generateSlideNFallbackSingleTurn) with `provider.generate()` (slide 1) and `provider.edit()` (slides 2..N, both multi-turn and fallback paths). Slide 1 buffer used as `currentImage` for style consistency across all N slides.
- Wired `carousel.routes.ts` to resolve `imageProvider` before calling `generateCarousel()` — injects both `imageProvider` and `imageApiKey`.
- Refactored `enhancement.service.ts` with injected `imageProvider: ImageProvider` and `imageApiKey?: string` parameters. Deleted `callEnhancementImageModel` entirely — `provider.edit()` replaces it. Text-model calls (pre-screen, caption) unchanged and still use `params.apiKey` (Gemini key).
- Wired `enhance.routes.ts` to resolve `imageProvider` before calling `enhanceProductPhoto()`.
- `npm run check` clean throughout all 3 tasks.
- `npx tsx scripts/verify-phase-12.ts` passes 21/21 checks after wiring (Wave-2 baseline unchanged — no regressions).

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire generate.routes.ts + edit.routes.ts** - `6b1e9d9` (feat)
2. **Task 2: Refactor carousel service + route** - `fc4a77d` (feat)
3. **Task 3: Refactor enhancement service + route** - `267af6d` (feat)

## Files Created/Modified

- `server/routes/generate.routes.ts` — replaced `generateImageAsset` with `provider.generate()`; added `openai_api_key` to profile select; `getActiveImageProvider` + `getOpenAIApiKey` imports added
- `server/routes/edit.routes.ts` — replaced `editImage` with `provider.edit()`; added `openai_api_key` to profile select; `getActiveImageProvider` + `getOpenAIApiKey` imports added
- `server/services/carousel-generation.service.ts` — `imageProvider` + `imageApiKey` added to `CarouselGenerationParams`; 3 direct fetch sites replaced; `callEnhancementImageModel`-equivalent inline fetch sites removed; `imageModel` in result is provider-aware
- `server/routes/carousel.routes.ts` — `getActiveImageProvider` + `getOpenAIApiKey` imports added; resolves `imageProvider` + `imageApiKey` before `generateCarousel()` call
- `server/services/enhancement.service.ts` — `imageProvider` + `imageApiKey` added to `EnhancementParams`; `callEnhancementImageModel` deleted; `provider.edit()` call inline; `imageModel` in result is provider-aware
- `server/routes/enhance.routes.ts` — `getActiveImageProvider` + `getOpenAIApiKey` imports added; resolves `imageProvider` + `imageApiKey` before `enhanceProductPhoto()` call

## Decisions Made

- **thoughtSignature dropped at abstraction boundary:** The Gemini multi-turn thoughtSignature style-consistency mechanism is a Gemini-specific internal. Rather than special-casing it inside the provider abstraction, slides 2..N use `provider.edit()` with slide-1 buffer as `currentImage`. Gemini provider's `GeminiImageProvider.edit()` (which calls `editImage()`) handles the inline-data path; OpenAI provider handles it via `toOpenAIInputImage` converter. Both achieve style consistency via the slide-1 reference image. The Gemini thoughtSignature multi-turn path is no longer exercised — the `generateSlideNWithSignature` function was simplified to use `provider.edit()` like the fallback.
- **callEnhancementImageModel deleted:** Clean removal preferred over deprecation — reduces dead code paths and avoids future confusion about which code path is active.
- **imageApiKey separate from apiKey:** Carousel and enhancement params keep the original `apiKey` for text-model calls (Gemini master-plan, pre-screen, caption) and add `imageApiKey` as an override for image calls. This matches the research Pitfall 4 guidance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] aspectRatio not in ImageEditInput interface**
- **Found during:** Task 2 — TypeScript type check
- **Issue:** Plan template showed passing `aspectRatio` to `provider.edit()` calls in carousel, but `ImageEditInput` interface has no `aspectRatio` field (the edit provider uses the current image dimensions)
- **Fix:** Removed `aspectRatio` from both `generateSlideNWithSignature` and `generateSlideNFallbackSingleTurn` provider.edit() calls — the slide-1 image dimensions implicitly carry the aspect ratio
- **Files modified:** `server/services/carousel-generation.service.ts`
- **Commit:** `fc4a77d`

**2. [Rule 3 - Blocking] Main branch merge required before execution**
- **Found during:** Plan start — worktree was based on phase 11 commit (ce7d749), missing 12-01/12-02/12-03 commits
- **Fix:** `git merge main --no-edit` fast-forwarded to a57ba3c (phase 12 Wave 1-3 work merged by orchestrator)
- **Files modified:** None (fast-forward merge, no conflict)
- **Commit:** Merge commit (not a separate commit — fast-forward)

## Known Stubs

None — all stubs from 12-03 (OpenAIImageProvider throw stubs) were replaced by 12-02's full implementation at the orchestrator merge. The factory returns a working `OpenAIImageProvider` instance when `image_provider = 'openai'`.

## Verification Results

- `npm run check`: PASS (TypeScript clean throughout)
- `npx tsx scripts/verify-phase-12.ts`: 21/21 PASS — Wave-2 baseline unchanged

## Next Phase Readiness

- Plan 12-05 can add the admin UI toggle that flips `platform_settings.image_provider` between 'gemini' and 'openai'
- PROV-07 is satisfied: all 4 flows route through the factory; switching the setting changes behavior across all flows with no further code changes
- The Wave-3 wiring is complete; Wave 4 (12-05 admin UI + PROV-05 verify) can proceed

## Self-Check: PASSED

Files verified to exist and contain required content:
- `server/routes/generate.routes.ts` with `getActiveImageProvider` — FOUND
- `server/routes/edit.routes.ts` with `getActiveImageProvider` — FOUND
- `server/services/carousel-generation.service.ts` with `imageProvider` param — FOUND
- `server/routes/carousel.routes.ts` with `getActiveImageProvider` — FOUND
- `server/services/enhancement.service.ts` with `imageProvider` param — FOUND
- `server/routes/enhance.routes.ts` with `getActiveImageProvider` — FOUND

Commits verified:
- `6b1e9d9`, `fc4a77d`, `267af6d` — all present in git log

---
*Phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative*
*Completed: 2026-05-17*
