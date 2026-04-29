---
status: partial
phase: 09-frontend-creator-carousel-enhancement-branches
source: [09-VERIFICATION.md]
started: 2026-04-29T00:00:00.000Z
updated: 2026-04-29T18:00:00.000Z
---

## Current Test

User-reported partial UAT 2026-04-29:
- Test 1, 2 → passed
- Test 3 → issues (thumbnail sizing, hover preview, gallery stack — gallery items deferred to Phase 10; sizing+hover routed to Phase 09.1)
- Test 5 → issues (scenery picker too sparse → Phase 09.1; enhancement caption empty → Phase 09.1 F4 re-spec)
- Test 7 → wants auto-save drafts → Phase 09.1 F5
- Tests 4, 6, 8 → not exercised yet

## Tests

### 1. Format step renders only 1:1 and 4:5 cards for Carousel
expected: After selecting "Carousel" in the Content Type step and reaching the Format / Size step, the format picker shows exactly 2 cards (Square 1:1 and Portrait 4:5). No 9:16 or 16:9 cards present. Selecting either ratio applies it to the carousel and locks it for all slides.
result: passed

### 2. Carousel generation SSE — progressive thumbnail behavior
expected: After clicking "Generate Carousel" with 5 slides selected, the generating view shows 5 spinner thumbnail placeholders from t=0. The current slide indicator shifts as the server emits per-slide phase events ("slide_1", "slide_2", ..., "slide_N"). On the final `complete` SSE event, all 5 real slide images populate simultaneously in the thumbnail grid (this is correct behavior — server contract does not emit per-slide image_urls mid-stream).
result: passed

### 3. Carousel result view shows caption + Save&Close + Generate Another
expected: After successful carousel generation, the dialog transitions to viewMode="result" showing: (a) all N slide images in a grid, (b) the unified caption in a read-only block, (c) "Save & Close" and "Generate Another" buttons. Clicking "Generate Another" resets to Content Type step. Clicking "Save & Close" closes the dialog. Partial-draft case (e.g. 3 of 5 slides succeeded): orange AlertTriangle warning shows "X of Y slides generated".
result: issues — thumbnails too small (need responsive sizing); no hover preview; gallery shows only slide 1 not stack, no carousel-specific icon → routed to Phase 09.1 (sizing + hover) and Phase 10 (gallery stack + icon)

### 4. Enhancement upload validation
expected: In the Enhancement branch Upload Photo step, attempting to upload a non-image file (e.g. .pdf) shows a destructive toast "Invalid file type" with description "Please upload JPEG, PNG, or WEBP images only." Attempting to upload an image >5 MB shows "File too large" with description "Your photo must be under 5 MB." Both rejected files do not enter the dialog state. Successful upload (≤5MB JPEG/PNG/WEBP, any aspect ratio including portrait/landscape) shows the preview thumbnail with a Replace button overlay and X clear button.
result: [pending]

### 5. Enhancement full flow → PostViewer handoff
expected: After uploading a valid product photo and selecting a scenery, click "Enhance Photo". The dialog shows the single-phase generating state with "Enhancing Your Photo" heading. On SSE complete, the creator dialog closes and the PostViewer dialog opens showing the enhanced image. Caption block in viewer is empty or plain (ENHC-08). Quick Remake and Edit Image buttons remain available in the viewer.
result: issues — scenery picker too sparse (cards too big, few visible); enhancement caption was just the scenery label "wooden table" not a real caption → routed to Phase 09.1 F3 (denser scenery grid) and F4 (re-spec ENHC-08 to generate proper caption)

### 6. Empty scenery catalog guard
expected: As an admin, navigate to Post Creation tab and toggle off `is_active` for ALL 12 sceneries (or delete them all), then click Save Post Settings. As a regular user (or after switching tab), open the post creator dialog. The Content Type step renders only 3 cards (Image, Video, Carousel) — Enhancement card is hidden — with an inline note "Photo enhancement is currently unavailable." Re-activating at least 1 scenery makes Enhancement card reappear.
result: [pending]

### 7. Content type change resets branch state
expected: Select Carousel, set slide count to 6, type reference text "Test prompt", select a mood. Navigate back to Content Type step (Back button) and select Enhancement. The Enhancement upload zone shows empty state. Navigate back to Content Type and select Carousel again. The slide count is back to default (3), reference text is empty, mood is reset (D-22 — full reset on type change).
result: issues (different vector) — user wants drafts auto-saved to localStorage so closing the popup doesn't lose work → routed to Phase 09.1 F5 (draft persistence). Original D-22 behavior (full reset on type change within session) still expected.

### 8. PT/ES language rendering
expected: With language set to PT-BR in the language toggle, the Content Type step shows "Imagem", "Vídeo", "Carrossel", "Aprimoramento". Carousel branch shows "Slides", "Referência", "Mood do Post", "Formato / Tamanho". Generate button shows "Gerar Carrossel". Enhancement branch shows "Enviar Foto", "Escolher Cenário", "Aprimorar Foto". Switch to ES — equivalent Spanish translations appear. All 33 phase 9 strings render correctly in both locales.
result: [pending]

## Summary

total: 8
passed: 2
issues: 3
pending: 3
skipped: 0
blocked: 0

## Gaps

### Gap 1 — Carousel result thumbnails sizing + hover preview (Test 3)
status: failed
routed_to: Phase 09.1 F1, F2

### Gap 2 — Scenery picker density (Test 5)
status: failed
routed_to: Phase 09.1 F3

### Gap 3 — Enhancement caption empty / scenery name fallback (Test 5)
status: failed
routed_to: Phase 09.1 F4 (re-spec ENHC-08)

### Phase 10 input (not blocking Phase 09)
- Carousel tile in gallery should be a stack/deck visual, not a single image with badge
- Carousel needs a distinct icon in gallery (separate from image/video/enhancement icons)
- Clicking carousel tile opens slide viewer (already in GLRY-03 scope)

### Deferred
- Auto-save creator drafts (Test 7) — Phase 09.1 F5
