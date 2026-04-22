---
phase: 07-server-routes
plan: 02
subsystem: api
tags: [express, sse, gemini, enhancement, billing, idempotency, credits]

requires:
  - phase: 05-schema-database-foundation
    provides: enhanceRequestSchema, Scenery type, EnhanceRequest type
  - phase: 06-server-services
    provides: enhanceProductPhoto() service, EnhancementParams, EnhancementProgressEvent, EnhancementResult, typed error classes (PreScreenRejectedError, PreScreenUnavailableError, SceneryNotFoundError, EnhancementGenerationError, EnhancementAbortedError), checkCredits slideCount param

provides:
  - POST /api/enhance route handler with full SSE pipeline (server/routes/enhance.routes.ts)
  - Pre-SSE gating: auth → profile → key → brand → validate → 5 MB guard → idempotency → credit check
  - SSE lifecycle: initSSE → heartbeat → AbortController (260s) → enhanceProductPhoto → billing → sendComplete
  - Error handling without billing for all 5 enhancement error types
  - D-04 sendComplete payload: { type: "complete", post, image_url, caption }

affects: [07-03, server/routes/index.ts, enhancement-client]

tech-stack:
  added: []
  patterns:
    - "SSE route pattern: pre-SSE JSON gates then initSSE + AbortController + onProgress mapping + billing + sendComplete"
    - "Idempotency pre-flight: adminSb SELECT before any service call (pessimistic, D-02)"
    - "5 MB base64 guard: Buffer.byteLength after Zod parse, before idempotency check (D-15)"
    - "Enhancement progress mapping: pre_screen_start→5%, pre_screen_passed→20%, normalize_start→35%, normalize_complete→45%, enhance_start→55%, complete→95%"

key-files:
  created:
    - server/routes/enhance.routes.ts
  modified:
    - shared/schema.ts (brought in from main: enhanceRequestSchema, Scenery, updated postSchema with slide_count/idempotency_key)
    - server/quota.ts (brought in from main: checkCredits slideCount param)
    - server/routes/generate.routes.ts (brought in from main: pipelineContentType narrowing for updated postSchema)
    - client/src/components/post-creator-dialog.tsx (brought in from main: slide_count/idempotency_key field alignment)
    - client/src/pages/posts.tsx (brought in from main: slide_count/idempotency_key field alignment)
    - server/routes/carousel.routes.ts (brought in from main: Phase 7-01 output)
    - server/services/enhancement.service.ts (brought in from main: Phase 6-03 output)
    - server/services/carousel-generation.service.ts (brought in from main: Phase 6-02 output)

key-decisions:
  - "Checked out Phase 5/6 dependency files from main branch into worktree since worktree was based on pre-Phase-5 commit; this was a blocking Rule 3 deviation"
  - "Fixed pre-existing TypeScript errors in generate.routes.ts and client pages caused by updated postSchema (brought from main, already fixed there)"
  - "Removed ensureCaptionQuality mention from comment to satisfy ENHC-08 grep=0 acceptance criterion"
  - "contentLanguage hardcoded to 'en' per plan spec (schema has no content_language field for enhancement in v1.1)"

patterns-established:
  - "ENHC-08: enhance.routes.ts has zero references to ensureCaptionQuality or applyLogoOverlay"
  - "D-04: sendComplete payload uses result.scenery.label as caption (service stores null in posts.caption per ENHC-06)"
  - "D-13: enhancement billing uses checkCredits(userId, 'generate', false, undefined) for 1x single-image cost"

requirements-completed: [ENHC-01, ENHC-02, ENHC-07, ENHC-08]

duration: 5min
completed: 2026-04-22
---

# Phase 7 Plan 02: Enhance Route Summary

**POST /api/enhance SSE route with pre-screen gate, credit gate, idempotency pre-flight, AbortController safety timer, and billing pipeline — ENHC-08 compliant (no logo, no caption processing)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-22T16:42:20Z
- **Completed:** 2026-04-22T16:47:59Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- Created `server/routes/enhance.routes.ts` with full SSE pipeline (414 lines)
- All 5 enhancement error types handled without billing: PreScreenRejectedError (422), PreScreenUnavailableError (503), EnhancementAbortedError (504), SceneryNotFoundError (400), EnhancementGenerationError (500)
- Strict pre-SSE gate order: auth → profile → key → brand → validate → 5 MB guard → idempotency → credit check
- Brought in Phase 5/6 dependencies (enhancement service, carousel service, updated schema, updated quota) from main branch since the worktree was based on an older commit

## Task Commits

1. **Task 1: Create enhance.routes.ts with full SSE pipeline** - `8bd8b1e` (feat)

**Plan metadata:** (final docs commit follows)

## Files Created/Modified

- `server/routes/enhance.routes.ts` - POST /api/enhance handler: pre-SSE gates, SSE lifecycle, billing, D-04 sendComplete
- `server/services/enhancement.service.ts` - Phase 6-03 output (brought in from main)
- `server/services/carousel-generation.service.ts` - Phase 6-02 output (brought in from main)
- `server/routes/carousel.routes.ts` - Phase 7-01 output (brought in from main)
- `shared/schema.ts` - Added enhanceRequestSchema, Scenery type, updated postSchema (from main)
- `server/quota.ts` - Added slideCount param to checkCredits (from main)
- `server/routes/generate.routes.ts` - Fixed pipelineContentType narrowing (from main)
- `client/src/components/post-creator-dialog.tsx` - Fixed Post type alignment (from main)
- `client/src/pages/posts.tsx` - Fixed Post type alignment (from main)

## Decisions Made

- Checked out Phase 5/6 dependency files from main branch since this worktree was created from a pre-Phase-5 commit (`f87ffc0`)
- `contentLanguage` hardcoded to `"en"` per plan spec — schema deliberately omits content_language for enhancement in v1.1
- Removed `ensureCaptionQuality` from comment text to meet ENHC-08 grep=0 acceptance criterion exactly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Brought Phase 5/6 dependency files from main branch**
- **Found during:** Task 1 (TypeScript check after creating enhance.routes.ts)
- **Issue:** Worktree (`f87ffc0`) predates Phase 5/6. `enhanceRequestSchema` missing from shared/schema.ts, `enhancement.service.ts` did not exist, `checkCredits` lacked `slideCount` param, `carousel.routes.ts` and `carousel-generation.service.ts` missing.
- **Fix:** `git checkout main -- shared/schema.ts server/quota.ts server/services/enhancement.service.ts server/services/carousel-generation.service.ts server/routes/carousel.routes.ts`
- **Files modified:** shared/schema.ts, server/quota.ts, server/services/enhancement.service.ts, server/services/carousel-generation.service.ts, server/routes/carousel.routes.ts
- **Committed in:** 8bd8b1e (Task 1 commit)

**2. [Rule 1 - Bug] Fixed pre-existing TypeScript errors caused by updated postSchema**
- **Found during:** Task 1 (TypeScript check after bringing in main schema)
- **Issue:** generate.routes.ts used `content_type || "image"` which now resolves to `"image" | "video" | "carousel" | "enhancement"` but buildTextPrompt expected `"image" | "video"`. Client pages missing `slide_count` and `idempotency_key` fields from updated Post type.
- **Fix:** Checked out fixed versions from main: generate.routes.ts (uses `pipelineContentType`), post-creator-dialog.tsx, posts.tsx
- **Files modified:** server/routes/generate.routes.ts, client/src/components/post-creator-dialog.tsx, client/src/pages/posts.tsx
- **Committed in:** 8bd8b1e (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking dependency, 1 pre-existing bug exposed by schema update)
**Impact on plan:** Both fixes essential for TypeScript check to pass. No scope creep.

## Known Stubs

None — enhance.routes.ts wires directly to the enhancement service and billing pipeline. No hardcoded empty values or placeholder data.

## Self-Check: PASSED

- `server/routes/enhance.routes.ts` exists: YES (414 lines)
- Commit `8bd8b1e` exists: YES
- `npm run check` exits 0: YES
- `grep -c "sse.sendComplete" server/routes/enhance.routes.ts` = 1: YES
- `grep -c "ensureCaptionQuality" server/routes/enhance.routes.ts` = 0: YES
- `grep -c "enhance" server/routes/index.ts` = 0: YES (not registered yet)
