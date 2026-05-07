---
phase: 11-post-trash-and-automated-cleanup
plan: 01
subsystem: database
tags: [supabase, postgresql, zod, react, express]

# Dependency graph
requires:
  - phase: 10-gallery-surface-updates
    provides: gallery query infrastructure (posts.tsx, posts.routes.ts) this plan extends
  - phase: 05-schema-database-foundation
    provides: posts table schema baseline (v1_1_schema_foundation migration)
provides:
  - posts.trashed_at column + partial index (DB schema)
  - TRASH_RETENTION_DAYS = 30 constant in shared/schema.ts
  - trashed_at field in Post and PostGalleryItem Zod schemas and TypeScript types
  - Gallery queries (server count, server data, client count, client data) filtered by trashed_at IS NULL
affects: [11-02-cron-cleanup, 11-03-trash-routes, 11-04-trash-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - .is("trashed_at", null) Supabase filter chained after .eq("user_id") for trash-aware gallery queries
    - Soft-delete column (trashed_at TIMESTAMPTZ NULL) with partial index for performance on non-NULL rows

key-files:
  created:
    - supabase/migrations/20260506000000_posts_trashed_at.sql
  modified:
    - shared/schema.ts
    - server/routes/posts.routes.ts
    - client/src/pages/posts.tsx
    - client/src/components/post-creator-dialog.tsx

key-decisions:
  - "Skip Drizzle db:push for Supabase-native migration — the migration SQL is applied via Supabase dashboard; Drizzle push would destroy non-Drizzle tables"
  - "trashed_at nullable with .default(null) in Zod schema — consistent with existing expires_at pattern"
  - "Fallback/missing-column branches in server and client queries left without trashed_at filter to avoid triggering missing-column errors in pre-migration environments"

patterns-established:
  - "Soft-delete filter pattern: .is('trashed_at', null) chained on primary queries, skipped on fallback queries"

requirements-completed: [TRSH-01]

# Metrics
duration: 12min
completed: 2026-05-07
---

# Phase 11 Plan 01: Post Trash Schema and Gallery Filter Summary

**posts.trashed_at column, TRASH_RETENTION_DAYS constant, and .is("trashed_at", null) filter on all four primary gallery query sites (server count + data, client count + data)**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-07T02:12:00Z
- **Completed:** 2026-05-07T02:24:05Z
- **Tasks:** 3
- **Files modified:** 4 + 1 created

## Accomplishments

- Created Supabase migration adding `trashed_at TIMESTAMPTZ NULL` column and `idx_posts_trashed_at` partial index (only indexes non-NULL rows for performance)
- Extended `postSchema` and `postGalleryItemSchema` with `trashed_at: z.string().nullable().default(null)` and exported `TRASH_RETENTION_DAYS = 30`
- Applied `.is("trashed_at", null)` to all four primary gallery queries: server count, server data, client count, client data — trashed posts are now invisible in the main gallery

## Task Commits

1. **Task 1: Create Supabase migration** - `851faf6` (chore)
2. **Task 2: Add trashed_at + TRASH_RETENTION_DAYS to schema** - `1caef32` (feat)
3. **Task 3: Filter trashed posts from gallery queries** - `9ae2bcf` (feat)

## Files Created/Modified

- `supabase/migrations/20260506000000_posts_trashed_at.sql` - Migration adding trashed_at column + partial index
- `shared/schema.ts` - TRASH_RETENTION_DAYS constant, trashed_at in postSchema and postGalleryItemSchema
- `server/routes/posts.routes.ts` - .is("trashed_at", null) on count + data primary queries
- `client/src/pages/posts.tsx` - .is("trashed_at", null) on both Promise.all queries; trashed_at in gallery map object
- `client/src/components/post-creator-dialog.tsx` - trashed_at: null added to two openViewer call sites

## Decisions Made

- Drizzle `db:push` skipped — this project uses Supabase-native SQL migrations applied via the Supabase dashboard. Running Drizzle push would attempt to drop all non-Drizzle tables. The migration file is the deliverable; DB application is manual via Supabase dashboard.
- Fallback/missing-column branches (inside `isMissingColumn` guards) intentionally left without the trashed_at filter to avoid triggering new missing-column errors in any pre-migration environment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript errors caused by new required trashed_at field**
- **Found during:** Task 2 (schema changes)
- **Issue:** Adding `trashed_at` to `postSchema` and `postGalleryItemSchema` made all existing object literals that construct `Post` or `GalleryPost` values fail TypeScript strict type checking (5 errors across 2 files).
- **Fix:** Added `trashed_at: null` to the two `openViewer()` call sites in `post-creator-dialog.tsx`, the two `openViewer()` call sites in `posts.tsx`, and included `post.trashed_at || null` in the gallery `postRows.map()` return object.
- **Files modified:** `client/src/components/post-creator-dialog.tsx`, `client/src/pages/posts.tsx`
- **Verification:** `npm run check` exits 0
- **Committed in:** `1caef32` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — cascade type errors from schema extension)
**Impact on plan:** Required for TypeScript correctness; no scope creep. All five fixes are minimal `trashed_at: null` property additions at existing object construction sites.

## Issues Encountered

- `npm run db:push` (Drizzle) cannot be used to apply Supabase-native migrations — it compares Drizzle ORM schema vs live DB and would try to drop 25 production tables. Migration must be applied via Supabase dashboard or `supabase db push` (CLI path requiring `SUPABASE_DB_PASSWORD`). Noted as process clarification, not a blocker.

## User Setup Required

The SQL migration file `supabase/migrations/20260506000000_posts_trashed_at.sql` must be applied to the Supabase database before Phase 11 trash routes and cron will work:

1. Open Supabase dashboard > SQL Editor
2. Paste contents of `supabase/migrations/20260506000000_posts_trashed_at.sql`
3. Run query
4. Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'trashed_at';` returns 1 row

## Next Phase Readiness

- `trashed_at` column schema and gallery filter are in place — Plan 11-02 (cron purge) and 11-03 (trash routes: PATCH /api/posts/:id/trash) can now build on this foundation
- `TRASH_RETENTION_DAYS` is importable from `@shared/schema` for use in the cron query
- No blockers

---
*Phase: 11-post-trash-and-automated-cleanup*
*Completed: 2026-05-07*
