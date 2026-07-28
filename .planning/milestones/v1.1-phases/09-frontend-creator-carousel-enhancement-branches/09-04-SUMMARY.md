---
phase: 09-frontend-creator-carousel-enhancement-branches
plan: 04
subsystem: frontend/creator-dialog
tags: [enhancement, file-upload, sse, scenery-picker, base64, post-creator]
dependency_graph:
  requires:
    - 09-02 (CONTENT_TYPE_ENABLED, ContentType union, activeSceneries, enhancementAvailable, IIFE steps switch)
    - 09-03 (resetBranchState helper, ViewMode "result", handleGenerateCarousel pattern)
  provides:
    - ENHANCEMENT_STEPS array in post-creator-dialog.tsx
    - enhancementFile state with base64 encoding, preview URL, and MIME/size validation
    - sceneryId state and scenery picker card grid sourced from activeSceneries
    - processEnhancementFile with JPEG/PNG/WEBP type guard and 5MB size guard
    - handleGenerateEnhancement with UUID idempotency_key, SSE to /api/enhance, openViewer handoff (D-20)
    - Enhancing Your Photo heading variant in generating view
    - All four content types (image/video/carousel/enhancement) coexist in single dialog
  affects:
    - Phase 10 (PostViewer — enhancement posts now open in existing viewer, no slide nav needed)
tech_stack:
  added: []
  patterns:
    - URL.createObjectURL() preview + URL.revokeObjectURL() cleanup on state change
    - FileReader.readAsDataURL() → strip data:...;base64, prefix → send raw base64 in request body
    - crypto.randomUUID() idempotency_key per submit (CRTR-04, D-23)
    - errCode === "pre_screen_rejected" branch for 422 pre-screen surface
key_files:
  created: []
  modified:
    - client/src/components/post-creator-dialog.tsx
key_decisions:
  - "handleGenerateEnhancement committed alongside Task 1 state — handleGenerateClick references it so both must be in same file pass; mirrors 09-03 precedent"
  - "URL.revokeObjectURL called in setEnhancementFile functional updater (prev.preview) and in cleanup useEffect — belt-and-suspenders to prevent blob URL leaks"
  - "errCode uses err.error field (populated by fetchSSE from parsed JSON error event) not err.message substring match — matches pre_screen_rejected server error code exactly"
  - "openViewer content_type falls back to completePayload.post.content_type then literal 'enhancement' — server persists the correct value"
patterns_established:
  - "Enhancement photo upload: validate MIME+size client-side, URL.createObjectURL preview, FileReader base64 encode, setEnhancementFile functional updater with prev.preview revoke"
  - "Scenery picker: grid-cols-1 sm:grid-cols-2 xl:grid-cols-3, aspect-video thumbnail with ImageIcon fallback, aria-hidden on decorative icons, aria-pressed on button"
requirements_completed: [CRTR-02, CRTR-04, CRTR-05]

# Metrics
duration: 15min
completed: 2026-04-29
---

# Phase 09 Plan 04: Full Enhancement Branch — Upload, Scenery Picker, SSE Generation, PostViewer Handoff

**Enhancement branch fully wired: JPEG/PNG/WEBP upload with 5MB guard, base64 FileReader encoding, responsive scenery picker grid from activeSceneries, UUID idempotency_key POST to /api/enhance via fetchSSE, and openViewer handoff on SSE complete (D-20)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-29
- **Completed:** 2026-04-29
- **Tasks:** 2 (committed atomically together — see Deviations)
- **Files modified:** 1

## Accomplishments

- ENHANCEMENT_STEPS array (`["Content Type", "Upload Photo", "Scenery Picker"]`) wired into the steps IIFE
- Upload Photo step: drag-drop zone, file preview, Remove button, MIME/size validation with destructive toasts
- Scenery Picker step: responsive grid card (1/2/3 cols), aspect-video thumbnail, label, prompt_snippet, violet-400 selected border
- `processEnhancementFile` validates type (JPEG/PNG/WEBP) and size (≤5MB) before FileReader base64 encoding
- `handleGenerateEnhancement`: UUID idempotency_key, `fetchSSE("/api/enhance", { scenery_id, idempotency_key, image: { mimeType, data } })`, pre_screen_rejected error mapping, openViewer on complete
- `resetBranchState()` extended with `setEnhancementFile`, `setSceneryId`, `setIsEnhancementDragActive`
- Generating view heading adapts: "Enhancing Your Photo" for enhancement type
- All four content types coexist in the single creator dialog with no regression on Image/Video/Carousel

## Task Commits

Both tasks committed in a single pass (same rationale as 09-03: handleGenerateClick references handleGenerateEnhancement, so both declarations must exist before TypeScript check):

1. **Task 1 + Task 2: Enhancement branch — state, helpers, step renderings, SSE handler** - `3436fbd` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `client/src/components/post-creator-dialog.tsx` — Added +335 lines: ENHANCEMENT_STEPS, enhancement state, file helpers, Upload Photo step, Scenery Picker step, handleGenerateEnhancement, canGenerateEnhancement, Enhance Photo label, heading variant

## Decisions Made

- **handleGenerateEnhancement committed with Task 1 changes** — `handleGenerateClick` references `handleGenerateEnhancement` so both need to exist in the same compilation unit. Mirrors 09-03 precedent exactly.
- **URL.revokeObjectURL in both functional updater and cleanup useEffect** — The functional updater (`setEnhancementFile(prev => { if (prev?.preview) revoke... })`) fires synchronously when state is replaced; the `useEffect` cleanup fires when the component unmounts or enhancementFile reference changes. Belt-and-suspenders pattern prevents any scenario where a blob URL leaks.
- **errCode uses `err.error` field** — `fetchSSE` populates `err.error` from the parsed SSE error event JSON's `error` field. Server sends `{ message, error: "pre_screen_rejected", statusCode: 422 }`. Using `errCode === "pre_screen_rejected"` matches exactly; substring matching `err.message` would be fragile if the server error message text changes.
- **`content_type: completePayload.post?.content_type || "enhancement"`** — The server persists the correct content_type ("enhancement") in the post record. The literal fallback is defensive only.

## Deviations from Plan

### Minor Structural Deviation

Task 1 and Task 2 were committed in a single commit (`3436fbd`) for the same reason documented in 09-03: `handleGenerateClick` (Task 1 scope) calls `handleGenerateEnhancement()` (Task 2 scope), so TypeScript would fail if Task 1 were committed first without Task 2's function. Both tasks modify only `post-creator-dialog.tsx`, and the logical scope boundary is preserved in code:

- Task 1 scope: ENHANCEMENT_STEPS, state declarations, upload helpers, Upload Photo step, Scenery Picker step, canGenerateEnhancement, generateButtonLabel
- Task 2 scope: handleGenerateEnhancement, handleGenerateClick wiring, generating view heading variant

This is not a plan deviation in the substantive sense — no functionality was added beyond plan scope, removed, or rearchitected.

## Issues Encountered

None.

## Known Stubs

None — all data paths (enhancementFile base64, sceneryId, openViewer payload) flow from real user input and server response. No hardcoded placeholder values reach UI rendering.

## Next Phase Readiness

Phase 9 is complete. All four content types (image, video, carousel, enhancement) are functional in the single creator dialog:

- Image: existing handleGenerate → openViewer
- Video: existing handleGenerate → openViewer
- Carousel: handleGenerateCarousel → result view (stay-in-creator, D-19)
- Enhancement: handleGenerateEnhancement → openViewer (D-20)

Phase 10 (gallery surface updates) can proceed — enhancement posts now open in the existing PostViewer with no new viewer code required.

---
*Phase: 09-frontend-creator-carousel-enhancement-branches*
*Completed: 2026-04-29*
