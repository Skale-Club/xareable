---
phase: 09-frontend-creator-carousel-enhancement-branches
verified: 2026-04-28T00:00:00Z
status: human_needed
score: 7/7 must-haves verified
human_verification:
  - test: "Open creator dialog, select Carousel, step through Slides → Reference → Post Mood → Format / Size, verify only 1:1 and 4:5 options appear in Format step, verify info note 'All slides in this carousel share the same format.' is rendered below the format cards"
    expected: "Two format cards (Square 1:1, Portrait 4:5) rendered; no 9:16 or 16:9 cards; violet info note visible"
    why_human: "Format filtering is code-verified but visual correctness and absence of extra cards requires browser rendering"
  - test: "Submit a carousel (5 slides). During generation, verify N=5 spinner thumbnails appear immediately, the violet ring tracks the current slide, and thumbnails swap to real images after completion"
    expected: "5 spinners at t=0; ring moves per SSE slide_N event; on complete, thumbnails replace spinners with actual slide images"
    why_human: "Progressive SSE thumbnail visualization requires live SSE stream; cannot verify with static code checks"
  - test: "After carousel generation completes, verify the result view shows 'Carousel Ready', slide image grid, caption block, 'Generate Another' and 'Save & Close' buttons"
    expected: "Result view renders correctly; Save & Close closes dialog; Generate Another resets to Content Type step"
    why_human: "Result view interaction and state reset on Generate Another requires live user flow"
  - test: "Open creator dialog, select Enhancement, upload a PNG file >5 MB, verify destructive toast 'File too large' appears. Then upload a .gif file, verify 'Invalid file type' toast appears."
    expected: "Correct destructive toasts; dialog stays open; file not accepted"
    why_human: "Toast notifications require live browser rendering; file validation cannot be triggered statically"
  - test: "Open creator dialog with a populated scenery catalog. Select Enhancement, verify scenery picker card grid appears, select one card (should highlight with violet border), then click 'Enhance Photo', verify SSE progress shows 'Enhancing Your Photo' heading, and on completion the PostViewer opens with the enhancement result"
    expected: "Scenery cards render from catalog data; selection highlighted; 'Enhancing Your Photo' heading during SSE; PostViewer opens on complete"
    why_human: "End-to-end enhancement flow requires live server, real Gemini API key, and browser rendering"
  - test: "Empty scenery catalog scenario: configure the API to return zero active sceneries, open creator dialog, verify the Enhancement card is absent from Content Type step and the note 'Photo enhancement is currently unavailable.' is visible"
    expected: "Enhancement card not rendered; unavailability note rendered below grid"
    why_human: "Requires mocking the style catalog API response to return empty active sceneries"
  - test: "Switch content types mid-flow: enter Carousel branch, select 5 slides, navigate to Reference, then go Back to Content Type and select Image. Verify slide count resets to 3 and reference text is cleared."
    expected: "resetBranchState() fires; slide count back to 3; reference text empty; step counter resets to 1"
    why_human: "State reset on content type change requires interactive navigation through dialog steps"
  - test: "Verify PT and ES locale strings render correctly in the dialog by switching the app language to Portuguese and navigating through the Carousel and Enhancement steps"
    expected: "Step titles, descriptions, button labels, and error messages appear in Portuguese"
    why_human: "i18n rendering requires browser with language context active"
---

# Phase 9: Frontend Creator — Carousel & Enhancement Branches — Verification Report

**Phase Goal:** The single existing post-creator-dialog.tsx is extended so users select Carousel or Enhancement as content types alongside Image and Video, with type-specific step branches, per-slide carousel SSE progress visualization, single-phase enhancement progress, and EN/PT/ES i18n. No new dialog files, no new sidebar entries.
**Verified:** 2026-04-28
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CONTENT_TYPE_ENABLED config object exists with 4 types, VIDEO_ENABLED removed | VERIFIED | Line 89-94: `const CONTENT_TYPE_ENABLED = { image: true, video: false, carousel: true, enhancement: true }` |
| 2 | ContentType union covers all 4 values (image, video, carousel, enhancement) | VERIFIED | Line 96: `type ContentType = keyof typeof CONTENT_TYPE_ENABLED` |
| 3 | CAROUSEL_STEPS array includes Slides, Reference, Post Mood, Format/Size | VERIFIED | Lines 122-128: `const CAROUSEL_STEPS = [..."Content Type", "Slides", "Reference", "Post Mood", "Format / Size"]` |
| 4 | ENHANCEMENT_STEPS array includes Upload Photo, Scenery Picker | VERIFIED | Lines 130-134: `const ENHANCEMENT_STEPS = [..."Content Type", "Upload Photo", "Scenery Picker"]` |
| 5 | handleGenerateCarousel calls fetchSSE("/api/carousel/generate") with crypto.randomUUID() idempotency_key | VERIFIED | Lines 626-754: function defined; line 644: `const idempotencyKey = crypto.randomUUID()`; line 649: `fetchSSE("/api/carousel/generate", ...)` |
| 6 | handleGenerateEnhancement calls fetchSSE("/api/enhance") with crypto.randomUUID() idempotency_key | VERIFIED | Lines 757-854: function defined; line 764: `const idempotencyKey = crypto.randomUUID()`; line 768: `fetchSSE("/api/enhance", ...)` |
| 7 | Upload validation: JPEG/PNG/WEBP accepted, ≤5 MB enforced with destructive toasts | VERIFIED | Lines 439-468: `processEnhancementFile` checks `["image/jpeg","image/png","image/webp"]` and `file.size > 5 * 1024 * 1024` |
| 8 | Carousel format step filters to 1:1 and 4:5 only | VERIFIED | Lines 1539-1541: `contentType === "carousel" ? baseFormats.filter(f => f.value === "1:1" \|\| f.value === "4:5") : baseFormats` |
| 9 | Slide count picker accepts 3-8 only | VERIFIED | Lines 1196-1223: `const counts = [3,4,5,6,7,8]`; chip row renders these values; `canGenerateCarousel` enforces `slideCount >= 3 && slideCount <= 8` |
| 10 | Per-slide progressive thumbnails during carousel SSE (N spinners, violet ring on current, real images on complete) | VERIFIED (code) | Lines 1779-1828: conditional rendering block; pre-seed at lines 632-638; SSE `slide_\d+` regex at line 676; image mapping post-complete at lines 710-720 |
| 11 | Enhancement single-phase progress (heading "Enhancing Your Photo", no per-slot UI) | VERIFIED | Lines 1832-1838: heading adapts per contentType; no slot row for enhancement |
| 12 | Result view (viewMode "result") renders "Carousel Ready", slide grid, caption, Save & Close, Generate Another | VERIFIED | Lines 1851-1922: full result block |
| 13 | 33 Phase 9 strings in PT dictionary, 33 in ES dictionary | VERIFIED | Lines 503-536 (pt), 970-1003 (es); node count returned 33/33 |
| 14 | No carousel-creator-dialog.tsx or enhancement-creator-dialog.tsx created | VERIFIED | Glob search found no such files; ui/carousel.tsx is pre-existing shadcn primitive (last modified before Phase 9) |
| 15 | app-sidebar.tsx unchanged in Phase 9 | VERIFIED | `git show ff5cf3e b78a1e2 3436fbd --stat` returns no match for app-sidebar.tsx; sidebar commit log shows last touch was before Phase 9 |
| 16 | resetBranchState() helper exists and zeros all branch-specific state | VERIFIED | Lines 886-909: function resets slideCount, postMood, copyText, aspectRatio, referenceText, referenceImages, all carousel state, enhancementFile, sceneryId |
| 17 | Enhancement card hidden and unavailability note rendered when activeSceneries is empty (D-15) | VERIFIED | Lines 921-924 (effectiveTypes filter); lines 1069-1073 (note rendered when `CONTENT_TYPE_ENABLED.enhancement && !enhancementAvailable`) |

**Score:** 17/17 observable truths VERIFIED in code

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `client/src/components/post-creator-dialog.tsx` | Single unified dialog extended with carousel + enhancement branches | VERIFIED | File read; contains all 4 content type branches; 1932 lines |
| `client/src/lib/translations.ts` | 33 new strings in PT and ES | VERIFIED | Node count: 33 PT, 33 ES, grouped under `// Phase 9` comment |
| NO `carousel-creator-dialog.tsx` | Must not exist | VERIFIED | Glob returned no matches; only pre-existing `ui/carousel.tsx` |
| NO `enhancement-creator-dialog.tsx` | Must not exist | VERIFIED | Glob returned no matches |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `handleGenerateCarousel` | `/api/carousel/generate` | `fetchSSE` | WIRED | Line 648-649: `await fetchSSE("/api/carousel/generate", { ... })` |
| `handleGenerateEnhancement` | `/api/enhance` | `fetchSSE` | WIRED | Line 768: `await fetchSSE("/api/enhance", { ... })` |
| `handleGenerateEnhancement` on complete | `openViewer` | `usePostViewer()` | WIRED | Lines 812-825: `openViewer({ id, image_url, content_type: "enhancement", ... })` |
| `handleGenerateCarousel` on complete | `viewMode = "result"` | `setViewMode` | WIRED | Line 727: `setViewMode("result")` after `markCreated()` |
| Content Type step | `steps` IIFE | `contentType === "carousel"` guard | WIRED | Lines 222-227: `if (contentType === "carousel") return CAROUSEL_STEPS; if (contentType === "enhancement") return ENHANCEMENT_STEPS` |
| `processEnhancementFile` | `enhancementFile` state | `setEnhancementFile` | WIRED | Lines 463-465: sets file, preview (blob URL), base64, mimeType |
| `handleGenerateClick` | `handleGenerateCarousel` / `handleGenerateEnhancement` | dispatch | WIRED | Lines 1692-1696: `if carousel → handleGenerateCarousel(); if enhancement → handleGenerateEnhancement()` |
| `availableFormats` filter | carousel format lockdown | `contentType === "carousel"` | WIRED | Lines 1539-1541: filter applied in Format / Size step |
| `canGenerateCarousel` / `canGenerateEnhancement` | Generate button `disabled` | `canGenerate` | WIRED | Lines 1668-1682: `canGenerate` derived; line 1761: `disabled={!canGenerate}` |
| SSE `slide_N` phase regex | `carouselCurrentSlide` + failed state | `onProgress` | WIRED | Lines 676-690: regex + `setCarouselCurrentSlide(n)` + `setCarouselSlides` for failures |
| `completePayload.image_urls` | `carouselSlides` image population | post-fetchSSE mapping | WIRED | Lines 710-720: maps imageUrls onto slides after SSE resolves |
| 33 PT/ES translation keys | `t()` call sites | `useTranslation()` | WIRED | `t("Generate Carousel")` at line 1685, `t("Enhance Photo")` at line 1687, all step title/description calls found |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Carousel slide thumbnails | `carouselSlides[].imageUrl` | `completePayload.image_urls[]` from SSE complete event | Yes — server returns real Supabase Storage URLs | FLOWING |
| Carousel caption | `carouselCaption` | `completePayload.caption` from SSE complete event | Yes — server returns AI-generated caption | FLOWING |
| Scenery picker cards | `activeSceneries` | `catalog.sceneries.filter(s => s.is_active !== false)` from `useQuery(["/api/style-catalog"])` | Yes — real DB-backed API endpoint | FLOWING |
| Enhancement result | `openViewer({ image_url })` | `completePayload.post.image_url` from SSE complete | Yes — server returns Supabase Storage URL for enhanced image | FLOWING |
| Slide progress status text | `carouselCurrentSlide` | `event.phase.match(/^slide_(\d+)$/)` from SSE onProgress | Yes — live SSE events from server | FLOWING |

---

## Behavioral Spot-Checks

Step 7b: SKIPPED for live generation flows (requires running server + Gemini API key). Static structural checks performed instead via code reading.

| Behavior | Check Method | Result | Status |
|----------|-------------|--------|--------|
| `CONTENT_TYPE_ENABLED` constant presence | Code read line 89 | Found with correct values | PASS |
| `CAROUSEL_STEPS` array shape | Code read line 122-128 | Contains 5 correct step strings | PASS |
| `ENHANCEMENT_STEPS` array shape | Code read line 130-134 | Contains 3 correct step strings | PASS |
| `crypto.randomUUID()` in handleGenerateCarousel | Grep | Found at line 644 | PASS |
| `crypto.randomUUID()` in handleGenerateEnhancement | Grep | Found at line 764 | PASS |
| Format filter `1:1 \|\| 4:5` | Code read line 1540 | Filter expression correct | PASS |
| Slide count picker range 3-8 | Code read line 1196 | `const counts = [3,4,5,6,7,8]` | PASS |
| 33 PT + 33 ES translation strings | Node count | Returns 33/33 | PASS |
| No new dialog files | Glob search | No carousel-creator or enhancement-creator dialog found | PASS |
| app-sidebar.tsx untouched | git log | No Phase 9 commits touch the file | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CRTR-01 | 09-03 | Carousel branch in unified dialog with steps slide count → reference → mood → format (1:1/4:5) | SATISFIED | CAROUSEL_STEPS at line 122; format filter at 1539; slide count picker at 1196 |
| CRTR-02 | 09-04 | Enhancement branch in unified dialog with steps upload photo → pick scenery | SATISFIED | ENHANCEMENT_STEPS at line 130; Upload Photo step at 1079; Scenery Picker step at 1144 |
| CRTR-03 | 09-02 | No new dialog files; CONTENT_TYPE_ENABLED replaces VIDEO_ENABLED; Content Type step hidden when ≤1 type enabled | SATISFIED | CONTENT_TYPE_ENABLED at line 89; no new files; step conditional at line 106 `ENABLED_CONTENT_TYPES.length >= 2` |
| CRTR-04 | 09-03, 09-04 | UUID idempotency_key per submission in both new routes | SATISFIED | `crypto.randomUUID()` at lines 644 and 764 |
| CRTR-05 | 09-03, 09-04 | Carousel: per-slide SSE progress; Enhancement: single-phase progress | SATISFIED | Thumbnail row with slide_N regex at 676; carousel heading variant at 1835; enhancement heading at 1834 |
| CRTR-06 | 09-01 | All new UI strings in EN/PT/ES | SATISFIED | 33 strings in PT (lines 503-536) and 33 in ES (lines 970-1003) |
| CRSL-04 | 09-03 | Creator restricts carousel aspect ratio to 1:1 and 4:5; all slides share same ratio | SATISFIED | Filter at line 1539-1541; default `setAspectRatio("1:1")` on carousel type select |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `post-creator-dialog.tsx` | 665-674 | Long SSE contract comment block (SERVER SSE CONTRACT) | Info | Documents intentional behavior — images arrive only on complete, not per-slide event. This is correct per Phase 7 server contract (route's mapProgress does not forward image_url from slide_complete events). Not a stub. |

No stubs, placeholders, TODO/FIXME comments, empty return values, or hardcoded empty arrays were found in the Phase 9 data paths. All carousel and enhancement data flows from real SSE events and server payloads.

---

## Human Verification Required

### 1. Carousel Format Step — Visual Correctness

**Test:** Open creator dialog, select Carousel, navigate to the Format / Size step (step 5)
**Expected:** Only two format cards visible — "Square" (1:1) and "Portrait" (4:5). No 9:16 or 16:9 cards. Violet info note "All slides in this carousel share the same format." rendered below the cards.
**Why human:** The filter is code-verified but the visual absence of non-carousel formats and rendering of the info note requires browser confirmation.

### 2. Per-Slide Progressive Thumbnail Animation

**Test:** Submit a carousel generation for 5 slides. Observe the generating view.
**Expected:** Exactly 5 spinner thumbnails appear immediately at t=0 (pre-seeded before SSE begins). The current slide shows a violet ring (`ring-2 ring-violet-400/60`). When the SSE `complete` event fires, all successful slide thumbnails swap from spinner to actual slide images with a fade-in transition.
**Why human:** The SSE stream behavior (spinners → real images) requires a live Gemini API call and live browser rendering of the animation.

### 3. Enhancement Upload Validation Toasts

**Test:** Upload a .gif file → expect "Invalid file type" toast. Upload a JPEG >5 MB → expect "File too large" toast. Upload a valid JPEG <5 MB → expect preview to appear with remove button.
**Expected:** Destructive toasts for invalid inputs; preview rendered for valid file; `aria-label="Remove photo"` on remove button.
**Why human:** Toast display and file input interaction require live browser.

### 4. Enhancement Full Flow (Scenery → SSE → PostViewer)

**Test:** Select Enhancement, upload a valid product photo, select a scenery from the picker, click "Enhance Photo", observe the generating view (single-phase progress, "Enhancing Your Photo" heading), and after completion verify PostViewer opens with the enhanced image.
**Expected:** No carousel thumbnail row in generating view; "Enhancing Your Photo" heading; PostViewer opens with `content_type: "enhancement"` post.
**Why human:** Requires live server, Gemini API key, and real SSE stream.

### 5. Empty Scenery Catalog Guard (D-15)

**Test:** Mock `/api/style-catalog` to return `sceneries: []` (or all inactive). Open creator dialog.
**Expected:** Enhancement card absent from Content Type grid; "Photo enhancement is currently unavailable." note rendered below the grid.
**Why human:** Requires controlling the style catalog API response to return zero active sceneries.

### 6. Content Type Change State Reset (D-22)

**Test:** Enter Carousel branch, set slide count to 6, type reference text, go Back to Content Type step, select Image.
**Expected:** Slide count resets to 3; reference text cleared; step counter goes to 1 (Reference step for Image).
**Why human:** State reset behavior requires navigating through multiple dialog steps interactively.

### 7. PT/ES i18n Rendering

**Test:** Switch app language to Portuguese (pt) or Spanish (es), open creator dialog, navigate through Carousel and Enhancement branches.
**Expected:** Step titles ("Quantos slides?" / "¿Cuántas diapositivas?"), descriptions, button labels ("Gerar Carrossel" / "Generar Carrusel"), and toast messages render in the target language.
**Why human:** i18n rendering requires the browser language context to be active and a full navigation walkthrough.

### 8. Partial Carousel Draft Warning

**Test:** (Requires server-side partial failure simulation) Generate a carousel where some slides fail but ≥50% succeed, triggering `status: "draft"` in the SSE complete payload.
**Expected:** Result view shows orange warning block "Only N of M slides were generated. Your post was saved as a draft." with correct values substituted.
**Why human:** Requires triggering a controlled partial failure on the backend (≥50% success threshold per CRSL-07).

---

## Gaps Summary

No automated gaps found. All 7 must-have requirement areas are satisfied in code:

- CRTR-01: Carousel branch — CAROUSEL_STEPS, slide count picker 3-8, format lock to 1:1/4:5
- CRTR-02: Enhancement branch — ENHANCEMENT_STEPS, upload validation JPEG/PNG/WEBP/5MB, scenery picker from catalog
- CRTR-03: No new files created; CONTENT_TYPE_ENABLED config in place; app-sidebar.tsx untouched
- CRTR-04: `crypto.randomUUID()` idempotency_key present in both handlers
- CRTR-05: Per-slide thumbnail row with SSE slide_N regex routing; single-phase enhancement progress
- CRTR-06: 33/33 strings in PT, 33/33 in ES
- CRSL-04: Format step filtered to `f.value === "1:1" || f.value === "4:5"` when `contentType === "carousel"`

Status is `human_needed` because live UI behavior (SSE animation, toast rendering, language switching, result handoff to PostViewer) cannot be verified from static code inspection alone. All code paths that support those behaviors are present, wired, and substantive.

---

_Verified: 2026-04-28_
_Verifier: Claude (gsd-verifier)_
