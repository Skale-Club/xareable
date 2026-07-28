---
phase: 10-gallery-surface-updates
plan: 01
subsystem: database
tags: [zod, typescript, schema, react, supabase]

# Dependency graph
requires:
  - phase: 05-schema-database-foundation
    provides: postSchema with slide_count and status fields
  - phase: 07-server-routes
    provides: carousel and enhancement API routes writing slide_count/status to DB
provides:
  - postGalleryItemSchema extended with slide_count and status fields
  - PostGalleryItem type with slide_count (number | null) and status (string)
  - posts.tsx Supabase SELECT includes slide_count and status columns
affects:
  - 10-02 (gallery tiles use PostGalleryItem to render carousel badges)
  - 10-03 (tile rendering reads slide_count and status for badges)
  - 10-04 (cache invalidation on partial-draft carousel SSE events)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod schema extension: postGalleryItemSchema mirrors postSchema field types exactly"
    - "Graceful column fallback: SELECT includes new columns with isMissingColumnError guards for older DB deployments"

key-files:
  created: []
  modified:
    - shared/schema.ts
    - client/src/pages/posts.tsx

key-decisions:
  - "status field uses .default('generated') in postGalleryItemSchema (not bare z.string()) so gallery reads from older DB rows don't fail Zod validation"
  - "posts.tsx SELECT updated in same commit to include slide_count and status — keeping schema and data fetch in sync"
  - "Graceful degradation fallback queries added for status and slide_count missing-column errors, consistent with existing expires_at fallback pattern"

patterns-established:
  - "Gallery schema extension pattern: extend postGalleryItemSchema, update SELECT, update mapped object — all in one atomic commit"

requirements-completed: [GLRY-01, GLRY-02]

# Metrics
duration: 8min
completed: 2026-04-29
---

# Phase 10 Plan 01: Gallery Surface Updates — Schema Extension Summary

**postGalleryItemSchema extended with slide_count (number | null) and status (string, default "generated") so downstream gallery tiles can render carousel count badges and draft status indicators**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-29T00:00:00Z
- **Completed:** 2026-04-29T00:08:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added `slide_count: z.number().int().positive().nullable()` to `postGalleryItemSchema` — matches existing `postSchema` field type exactly
- Added `status: z.string().default("generated")` to `postGalleryItemSchema` — default prevents validation failures on legacy rows that don't return this column
- Updated `posts.tsx` Supabase SELECT to include `slide_count, status` in all three query paths (primary + two fallbacks)
- Updated mapped `GalleryPost` object to pass `slide_count` and `status` from DB rows instead of hardcoded values
- Updated both `openViewer` call sites to use `post.slide_count` and `post.status` from the now-populated `GalleryPost` fields
- `npm run check` exits 0 — TypeScript compiles cleanly across client + server + shared

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend postGalleryItemSchema with slide_count and status fields** - `b5b3144` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `shared/schema.ts` - Added two new fields to `postGalleryItemSchema`; `PostGalleryItem` type gains them via `z.infer`
- `client/src/pages/posts.tsx` - Updated SELECT, mapped object, and `openViewer` calls to use actual `slide_count`/`status` from DB rows

## Decisions Made
- `status` field uses `.default("generated")` (not bare `z.string()`) because the gallery is read-only and existing posts from pre-Phase-5 deployments may not have a `status` column value in older queries; the default prevents runtime Zod validation failures.
- The `posts.tsx` SELECT update and mapped-object fix were included in the same task commit to keep schema and data fetch synchronized — this is the correct scope for a "pure schema extension" plan since TypeScript enforces the contract immediately.
- A fallback SELECT for `status` missing-column error was added following the established `expires_at` graceful degradation pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript compile failure caused by missing slide_count/status in posts.tsx data mapping**
- **Found during:** Task 1 (Extend postGalleryItemSchema)
- **Issue:** After adding `slide_count` and `status` to `postGalleryItemSchema`, the `GalleryPost` type in `posts.tsx` (which extends `PostGalleryItem`) required these fields, but the mapped object at line 161-205 only had the old fields — TypeScript error TS2322 on `galleryPosts` assignment.
- **Fix:** Updated Supabase SELECT to include `slide_count, status`; updated mapped object to include `slide_count: post.slide_count ?? null` and `status: post.status ?? "generated"`; updated both `openViewer` call sites to pass actual values instead of hardcoded `slide_count: null` and `status: "generated"`; added `isMissingColumnError` fallback guards for `status` column.
- **Files modified:** `client/src/pages/posts.tsx`
- **Verification:** `npm run check` exits 0
- **Committed in:** b5b3144 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug: TypeScript compile failure)
**Impact on plan:** Fix is necessary for the monorepo to compile at all after the schema extension. The `posts.tsx` update is consistent with the plan's stated goal of "TypeScript compiles cleanly across the monorepo." No scope creep — no behavior changes, only plumbing the new fields through the existing data flow.

## Issues Encountered
None beyond the auto-fixed TypeScript compile failure documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `PostGalleryItem` now exposes `slide_count: number | null` and `status: string` — Plan 02 (gallery API endpoint) and Plan 03 (tile rendering) can immediately use these fields to render the "Carousel · N" badge and "Draft" status badge.
- No blockers or concerns.

---
*Phase: 10-gallery-surface-updates*
*Completed: 2026-04-29*
