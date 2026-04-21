---
phase: 05-schema-database-foundation
plan: 01
subsystem: database
tags: [zod, typescript, schema, carousel, enhancement, content_type]

# Dependency graph
requires:
  - phase: v1.0 foundation
    provides: existing shared/schema.ts Zod single source of truth, LOGO_POSITIONS, SUPPORTED_LANGUAGES, styleCatalogSchema attachment pattern
provides:
  - postSlideSchema (carousel slide row shape — Phase 6/7 consumers)
  - carouselRequestSchema (POST /api/carousel/generate body contract — Phase 7 consumer)
  - enhanceRequestSchema (POST /api/enhance body contract — Phase 7 consumer)
  - scenerySchema (Phase 8 admin UI + Phase 9 enhancement dialog consumer)
  - Extended postSchema with slide_count and idempotency_key (Phase 7 routes, Phase 10 gallery)
  - 4-value content_type enum across all five shared/schema.ts mirror sites (Phase 6/7/9/10)
  - styleCatalogSchema.sceneries optional array (Phase 8 admin, existing getStyleCatalogPayload surfaces it automatically per ADMN-03)
affects: [06-server-services, 07-server-routes, 08-admin-scenery-catalog, 09-frontend-creator-dialogs, 10-gallery-surface-updates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "4-value content_type enum mirrored across 5 sites in lockstep (postSchema, postGalleryItemSchema, generateRequestSchema, generateResponseSchema, billingStatementItemSchema)"
    - "idempotency_key as client-generated UUID v4 (nullable at table level, required at carousel/enhance request boundary)"
    - "scenery catalog attached to styleCatalogSchema via optional array — mirrors text_styles/post_formats attachment"
    - "Consumer-side type narrowing: /api/generate narrows to image|video pipeline type before Gemini service call; carousel/enhancement use dedicated routes in Phase 7"

key-files:
  created: []
  modified:
    - shared/schema.ts
    - server/routes/generate.routes.ts
    - client/src/components/post-creator-dialog.tsx
    - client/src/pages/posts.tsx

key-decisions:
  - "postSlideSchema placed immediately after postVersionSchema (line 437) to keep post-family schemas colocated"
  - "scenerySchema placed immediately before styleCatalogSchema (line 171) so sceneries attachment references an already-declared type"
  - "carouselRequestSchema and enhanceRequestSchema placed after generateResponseSchema (lines 869 and 888) next to their sibling request/response shapes"
  - "/api/generate pipelineContentType narrowing introduced at the route — carousel and enhancement will get their own routes in Phase 7, so generate.routes.ts stays strictly image|video"
  - "Client Post object construction sites (3 call sites) fill slide_count=null and idempotency_key=null for non-carousel single-image posts — matches the nullability contract on the table"

patterns-established:
  - "Pattern: mirror-site enum lockstep — any future content_type change must update all 5 sites in a single commit (grep -c verifies 0 stale / 5 fresh)"
  - "Pattern: pipeline-type narrowing — when a shared enum widens but a specific pipeline still handles a subset, introduce a local narrowed const at the call site with a comment explaining which other routes handle the excluded values"

requirements-completed: [SCHM-01, SCHM-03, SCHM-04, SCHM-05]

# Metrics
duration: 5min
completed: 2026-04-21
---

# Phase 5 Plan 01: Zod Schemas for Carousel, Enhancement, and Scenery Summary

**Extended shared/schema.ts with four new Zod schemas (postSlideSchema, carouselRequestSchema, enhanceRequestSchema, scenerySchema), widened content_type to 4 values across all 5 mirror sites, and added slide_count + idempotency_key + sceneries fields — all downstream v1.1 types now compile end-to-end.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-21T14:35:48Z
- **Completed:** 2026-04-21T14:40:35Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- Four new Zod schemas exported from shared/schema.ts: `postSlideSchema`, `carouselRequestSchema`, `enhanceRequestSchema`, `scenerySchema`.
- `postSchema.content_type` widened from `["image", "video"]` to `["image", "video", "carousel", "enhancement"]` and mirrored in `postGalleryItemSchema`, `generateRequestSchema`, `generateResponseSchema`, `billingStatementItemSchema` — all five sites in lockstep.
- `postSchema` gained `slide_count: z.number().int().positive().nullable()` and `idempotency_key: z.string().uuid().nullable()` per D-18.
- `styleCatalogSchema` gained `sceneries: z.array(scenerySchema).optional()` per D-15 — existing `getStyleCatalogPayload()` now surfaces sceneries automatically.
- `npm run check` exits 0 with zero TypeScript errors across client + server.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add four new Zod schemas and extend postSchema/styleCatalogSchema/content_type mirrors** - `83b4461` (feat)

**Plan metadata:** (to be added by final commit below)

## Schema Insertion Line Numbers

For Plan 02 and Plan 03 to audit cleanly:

| Export                           | Line (post-edit) |
| -------------------------------- | ---------------- |
| `scenerySchema`                  | 171              |
| `styleCatalogSchema`             | 180 (extended with `sceneries`) |
| `postSchema`                     | 378 (extended: content_type + slide_count + idempotency_key) |
| `postGalleryItemSchema`          | 394 (content_type widened) |
| `postSlideSchema`                | 437              |
| `generateRequestSchema`          | 822 (content_type widened) |
| `generateResponseSchema`         | 852 (content_type widened) |
| `carouselRequestSchema`          | 869              |
| `enhanceRequestSchema`           | 888              |
| `billingStatementItemSchema`     | 1288 (content_type widened) |

## Files Created/Modified

- `shared/schema.ts` — 4 new schemas + 5 content_type mirror updates + postSchema/styleCatalogSchema field additions.
- `server/routes/generate.routes.ts` — introduced `pipelineContentType: "image" | "video"` local narrowing to keep the /api/generate Gemini call compatible with the widened request enum. Carousel and enhancement will route through dedicated endpoints in Phase 7.
- `client/src/components/post-creator-dialog.tsx` — filled `slide_count: null, idempotency_key: null` on the single-image Post object passed to `openViewer` (creator dialog success path).
- `client/src/pages/posts.tsx` — filled `slide_count: null, idempotency_key: null` on the two `openViewer` call sites (quick-remake success path and gallery-tile click).

## Decisions Made

- **Pipeline narrowing location** — introduced a single `pipelineContentType` local in `/api/generate` rather than widening the Gemini service's `contentType` union. The Gemini service's `"image" | "video"` shape correctly reflects what that pipeline produces; carousel and enhancement each have their own generation pipelines (Phase 6) and their own routes (Phase 7).
- **Client Post construction null fill** — passed `slide_count: null, idempotency_key: null` in the three client sites rather than making those fields optional on `postSchema`. CONTEXT D-18 specifies these columns as nullable (not optional) to match the DB shape delivered in Plan 02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended content_type widening caused 5 downstream TypeScript errors**
- **Found during:** Task 1 step G (`npm run check`)
- **Issue:** The plan anticipated switch-statement narrowing errors in consumers but this codebase hit two additional kinds: (a) three client `openViewer({...})` Post object construction sites missing the new `slide_count`/`idempotency_key` fields; (b) two `/api/generate` call sites passing a 4-value enum into the Gemini service's `"image" | "video"` parameter.
- **Fix:**
  - Three client sites: added `slide_count: null, idempotency_key: null` to each Post literal (these are single-image posts created via the existing `/api/generate` flow — nulls match the DB nullability contract).
  - Two `/api/generate` sites: introduced `const pipelineContentType: "image" | "video" = isVideo ? "video" : "image"` once near the request destructuring, and replaced both `contentType: content_type || "image"` usages with `contentType: pipelineContentType`. A code comment documents that carousel and enhancement each have their own routes in Phase 7.
- **Files modified:** `client/src/components/post-creator-dialog.tsx`, `client/src/pages/posts.tsx` (2 sites), `server/routes/generate.routes.ts`.
- **Verification:** `npm run check` exits 0.
- **Committed in:** `83b4461` (Task 1 commit).

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking). No architectural changes; no scope creep.
**Impact on plan:** All fixes were mechanical consumer updates caused directly by the schema widening. They DID NOT introduce new behavior — Post object literals receive `null` for the new fields (matching DB nullability), and the /api/generate route continues to handle only image+video.

## Phase 10 Follow-ups

No permanent `default: return null;` fallbacks were added — switch-statement narrowing issues did not surface in this codebase during this plan. The `/api/generate` `pipelineContentType` narrowing introduced in this commit is intentional and permanent (not a transient workaround): it correctly reflects that `/api/generate` handles only image/video, while Phase 7 will introduce `/api/carousel/generate` and `/api/enhance` as dedicated routes.

## Issues Encountered

None beyond the 5 TypeScript errors documented as a Rule 3 deviation above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 02 (Supabase migration) is unblocked: `postSchema.content_type` 4-value enum locked, `slide_count` and `idempotency_key` column shapes locked, scenery seed schema (`scenerySchema`) locked.
- Plan 03 (style-catalog surfacing) is unblocked: `styleCatalogSchema.sceneries` optional array is in place; `getStyleCatalogPayload()` will surface it automatically.
- Downstream Phase 6 services can import `postSlideSchema`, `carouselRequestSchema`, `enhanceRequestSchema` as their canonical input/output types.
- Downstream Phase 7 routes have their request body contracts ready (`carouselRequestSchema`, `enhanceRequestSchema`) — idempotency_key is required at the request boundary and nullable in the posts table, matching D-09/D-10.

## Self-Check: PASSED

- FOUND: shared/schema.ts
- FOUND: server/routes/generate.routes.ts
- FOUND: client/src/components/post-creator-dialog.tsx
- FOUND: client/src/pages/posts.tsx
- FOUND: .planning/phases/05-schema-database-foundation/05-01-SUMMARY.md
- FOUND commit: 83b4461

---
*Phase: 05-schema-database-foundation*
*Completed: 2026-04-21*
