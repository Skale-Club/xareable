---
phase: 13-carousel-quick-remake-and-edit-image
plan: 02
subsystem: server-routes
tags: [carousel, slide-edit, sse, image-provider, post_slide_versions, quick-remake, credits]

requires:
  - phase: 13-carousel-quick-remake-and-edit-image
    plan: 01
    provides: post_slide_versions table migration + editSlideRequestSchema + postSlideVersionSchema

provides:
  - POST /api/carousel/slide/edit endpoint (mounted in carousel.routes.ts)
  - SSE stream: progress(auth/image_generation/optimization/saving) + complete + error events
  - per-slide version persistence in post_slide_versions table
  - CRSL-EDIT-03/04/05 static analysis checks in scripts/verify-phase-13.ts

affects:
  - 13-03-PLAN.md (PostEditDialog client integration targets this endpoint)
  - 13-04-PLAN.md (Quick Remake handler in viewer targets this endpoint with source:"quick_remake")
  - 13-05-PLAN.md (verify-phase-13.ts now has 6/6 active checks)

tech-stack:
  added: []
  patterns:
    - "provider.edit() from image-provider.ts — no direct Gemini/OpenAI imports in route (RESEARCH.md Pitfall 1)"
    - "checkCredits(userId, 'edit') with no slideCount arg — 1x edit cost (CRSL-EDIT-04)"
    - "additionalRefs[0] = slide-1 image for slide_number > 1 edits (CRSL-EDIT-05)"
    - "createAdminSupabase() for post_slide_versions INSERT and post_slides UPDATE — bypasses RLS (RESEARCH.md Pitfall 4)"
    - "270-char route window regex in verify script for static-analysis checks"

key-files:
  created: []
  modified:
    - server/routes/carousel.routes.ts
    - scripts/verify-phase-13.ts

handler-line-range:
  - "logSlideEditError helper: ~line 492–509"
  - "router.post('/api/carousel/slide/edit'): ~line 511 to ~line 1040"

sse-events:
  progress:
    - phase: auth, message: "Verified. Starting slide edit...", percent: 10
    - phase: image_generation, message: "Loading slide images...", percent: 20
    - phase: image_generation, message: "Editing slide...", percent: 35
    - phase: optimization, message: "Optimizing slide image...", percent: 65
    - phase: saving, message: "Saving slide version...", percent: 90
  complete:
    fields: [slide_version_id, version_number, image_url, thumbnail_url, slide_id, post_id, slide_number]
  error:
    fields: [message, statusCode]

key-decisions:
  - "Caption regeneration skipped for slide-level edits — carousel caption is master-text scoped to the full post (CRSL-09)"
  - "enforceExactImageText intentionally omitted — carousel v1.1 has no on-image text rendering (CRSL-10)"
  - "post_slides.image_url updated to latest version (latest-wins); prior URL preserved in post_slide_versions for v2 history browsing"
  - "quick_remake source injects post.ai_prompt_used as regeneration seed — slide-1 anchor still applied for slides > 1"
  - "logSlideEditError is a local helper (not re-using logGenerationError) to keep error_type discriminated union scoped to edit operations"
  - "verify checks use dynamic import('node:fs') consistent with existing checks — require() not available in ESM script"

duration: 25min
completed: 2026-05-18T13:42:00Z
---

# Phase 13 Plan 02: Carousel Slide Edit Endpoint Summary

**POST /api/carousel/slide/edit — SSE-streamed single-slide carousel edit with post_slide_versions persistence, slide-1 style anchor, and 1x credit billing**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-18T13:15:00Z
- **Completed:** 2026-05-18T13:42:00Z
- **Tasks:** 2
- **Files modified:** 2 (carousel.routes.ts, verify-phase-13.ts)

## Accomplishments

- `POST /api/carousel/slide/edit` appended to `server/routes/carousel.routes.ts` (318 lines added, does not touch `edit.routes.ts`)
- Full SSE lifecycle: auth/validation/credits pre-flight (JSON errors), then `initSSE` → progress events → provider.edit() → optimize → upload → `post_slide_versions` insert → `post_slides` update → credit deduct → marketing tracking → `sendComplete`
- Slide-1 style anchor (`additionalRefs[0]`) fetched and wired for `slide_number > 1` edits — CRSL-EDIT-05
- `checkCredits(userId, "edit")` called with no `slideCount` argument — 1x image-edit cost only — CRSL-EDIT-04
- `post_slide_versions` insert uses `createAdminSupabase()` (bypasses RLS, consistent with carousel-generation.service.ts) — CRSL-EDIT-03
- `source: "quick_remake"` injects `post.ai_prompt_used` as regeneration seed; calls `canUseQuickRemake` + `incrementQuickRemakeCount`
- 280s safety timer with `logSlideEditError` DB logging on timeout
- `scripts/verify-phase-13.ts` promoted from 3 active + 3 SKIP → 6 active, 0 SKIP; all 6 pass on tree with this plan merged

## Task Commits

1. **Task 1: POST /api/carousel/slide/edit** — `00ad2b3 feat(13-02): implement POST /api/carousel/slide/edit endpoint`
2. **Task 2: Activate CRSL-EDIT-03/04/05 verify checks** — `599fe1a feat(13-02): activate CRSL-EDIT-03/04/05 checks in verify-phase-13.ts`

## Files Modified

- `server/routes/carousel.routes.ts` — new imports (`randomUUID`, `createServerSupabase`, `editSlideRequestSchema`, `canUseQuickRemake`, `incrementQuickRemakeCount`, `downloadImageAsBase64`, `LANGUAGE_NAMES`, `processImageWithThumbnail`, `formatBytes`, `trackMarketingEvent`, `getSiteOrigin`, `getRequestIp`) + `logSlideEditError` helper + full route handler
- `scripts/verify-phase-13.ts` — CRSL-EDIT-03/04/05 check functions converted from SKIP stubs to active async static-analysis checks; updated header comment; `main()` uses `await` for all 3 new checks

## Deviations from Plan

### Auto-adjusted — no architectural changes

**1. [Rule 1 - Bug] verify checks used dynamic import instead of require()**
- **Found during:** Task 2 (first verify run)
- **Issue:** Script runs as ESM (`import "dotenv/config"` top-level), so `require()` throws `ReferenceError: require is not defined`. Existing checks 2 and 3 already use `await import("node:fs")`.
- **Fix:** Changed the 3 new check functions from synchronous `function` to `async function`, using `const { readFileSync } = await import("node:fs")` — consistent with the rest of the file. Updated `main()` to `await` each check call.
- **Files modified:** `scripts/verify-phase-13.ts`
- **Commit:** `599fe1a`

**2. [Rule 1 - Bug] verify CRSL-EDIT-03 pattern missed multi-line chained calls**
- **Found during:** Task 2 (first verify run — FAIL on CRSL-EDIT-03)
- **Issue:** The initial check used `.from("post_slide_versions").insert(` as a single-line string, but the actual code has `.from("post_slide_versions")` and `.insert({` on separate lines (indented chaining style).
- **Fix:** Replaced with a regex `/.from\(["']post_slide_versions["']\)[\s\S]{0,100}\.insert\(/` that tolerates whitespace/newlines between the chained calls.
- **Files modified:** `scripts/verify-phase-13.ts`
- **Commit:** `599fe1a`

## Intentional Divergences from edit.routes.ts

| edit.routes.ts behavior | carousel/slide/edit behavior | Reason |
|------------------------|------------------------------|--------|
| `ensureCaptionQuality` called | Skipped | Carousel caption is post-wide master text (CRSL-09) |
| `enforceExactImageText` for `text_mode: replace` | Skipped | Carousel v1.1 has no on-image text (CRSL-10) |
| Writes to `post_versions` | Writes to `post_slide_versions` | Different persistence model (RESEARCH.md Open Question 2) |
| `processStorageCleanup` background call | Not called | Storage cleanup operates on `post_versions`; slide version cleanup is deferred to v2 |
| Supports video posts | Image only | Carousel slides are always images |
| `checkCredits(userId, "edit")` | Same | Identical — no slideCount |

## Known Stubs

None — endpoint is fully wired. No hardcoded or placeholder data flows through to SSE output.

## Open Follow-Ups for Plan 13-03

- `PostEditDialog` needs `contentType="carousel-slide"` variant that targets `POST /api/carousel/slide/edit` and passes `slide_id` + `post_id`
- `onGenerated` callback in the dialog variant should return `{ slide_version_id, version_number, image_url, slide_id }` so the viewer can splice `carouselSlides` local state
- Viewer should update `carouselSlides[currentSlideIndex].image_url` in-place (no full reload) after a successful slide edit (RESEARCH.md Pitfall 7)
- Pitfall 3 UI warning ("Editing slide 1 may affect visual consistency of the carousel") deferred to Plan 13-03

## Self-Check: PASSED

- `server/routes/carousel.routes.ts` exists and contains the route
- `00ad2b3` and `599fe1a` commits verified in git log
- `npm run check` exits 0 (zero TS errors)
- `npx tsx scripts/verify-phase-13.ts` exits 0 (6/6 PASS, 0 SKIP, 0 FAIL)
