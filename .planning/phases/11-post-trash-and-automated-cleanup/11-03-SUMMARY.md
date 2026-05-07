---
phase: 11-post-trash-and-automated-cleanup
plan: 03
subsystem: api
tags: [express, supabase, zod, typescript, storage]

# Dependency graph
requires:
  - phase: 11-post-trash-and-automated-cleanup/11-01
    provides: TRASH_RETENTION_DAYS constant, trashed_at field in Post/PostGalleryItem schemas, posts.trashed_at column
  - phase: 11-post-trash-and-automated-cleanup/11-02
    provides: cleanup-cron.service.ts cron sweep infrastructure using TRASH_RETENTION_DAYS
provides:
  - trashedPostSchema + trashListResponseSchema Zod schemas in shared/schema.ts
  - GET /api/trash — user-facing trash list endpoint (trashed_at IS NOT NULL, sorted desc, days_remaining computed)
  - POST /api/trash/:id/restore — clears trashed_at and resets expires_at +30d atomically
  - DELETE /api/trash/:id — storage-before-DB permanent delete (slides, versions, enhancement-source paths)
  - trashRoutes wired in createApiRouter() in server/routes/index.ts
affects: [11-04-trash-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Storage-first delete ordering (Pitfall 1): .remove() before .delete() in DELETE /api/trash/:id
    - Ownership enforcement via user-scoped supabase fetch then adminSb for writes
    - daysRemaining() computed server-side: Math.max(0, TRASH_RETENTION_DAYS - elapsedDays)
    - trashListResponseSchema.parse() on response to validate shape before sending

key-files:
  created:
    - server/routes/trash.routes.ts
  modified:
    - shared/schema.ts
    - server/routes/index.ts

key-decisions:
  - "Worktree was based on pre-Phase-11 main branch — merged worktree-agent-a6734d520399643d7 (fast-forward) to bring in 11-01 and 11-02 changes before executing 11-03"
  - "Storage-first delete in DELETE /api/trash/:id: storage.remove() precedes posts.delete() to prevent orphaned files on partial failure (Pitfall 1)"
  - "Restore uses adminSb for the update (not user supabase): user supabase enforces RLS SELECT but update needs admin to bypass potential RLS write restrictions; ownership checked before update via user supabase fetch"
  - "daysRemaining clamped at 0 via Math.max: safe for posts trashed > 30 days ago that cron hasn't swept yet"

patterns-established:
  - "Trash route ownership pattern: fetch with user supabase (RLS-enforced), write with adminSb (bypasses RLS write restrictions), always .eq('user_id', user.id) on write for defense in depth"
  - "Storage path collection before DB delete: collect post + slide + version + enhancement-source paths, deduplicate with Set, remove all, then delete DB row"

requirements-completed: [TRSH-03, TRSH-04, TRSH-05]

# Metrics
duration: 20min
completed: 2026-05-07
---

# Phase 11 Plan 03: Trash API Routes Summary

**Three user-facing trash endpoints (GET list, POST restore, DELETE permanent) with Zod schemas — storage-first delete, ownership enforcement, and days_remaining computed server-side**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-07T02:30:00Z
- **Completed:** 2026-05-07T02:50:00Z
- **Tasks:** 3
- **Files modified:** 2 + 1 created

## Accomplishments

- Added `trashedPostSchema` and `trashListResponseSchema` to `shared/schema.ts` with `days_remaining: z.number().int().nonnegative()` and non-nullable `trashed_at`
- Created `server/routes/trash.routes.ts` with three routes: GET /api/trash (sorted trashed_at DESC, days_remaining computed), POST /api/trash/:id/restore (atomically clears trashed_at + resets expires_at), DELETE /api/trash/:id (storage-first, collects slide/version/enhancement-source paths)
- Wired `trashRoutes` into `createApiRouter()` immediately after `postsRoutes` with import and named export

## Task Commits

1. **Task 1: Add trashedPostSchema + trashListResponseSchema** - `d54b290` (feat)
2. **Task 2: Create trash.routes.ts** - `88d12f3` (feat)
3. **Task 3: Wire trashRoutes into index.ts** - `cfcf95a` (feat)

## Files Created/Modified

- `server/routes/trash.routes.ts` - Three trash endpoints with ownership enforcement, storage-first delete, days_remaining computation
- `shared/schema.ts` - trashedPostSchema and trashListResponseSchema exported (lines 428-448)
- `server/routes/index.ts` - Import, router.use(), and named export of trashRoutes

## Decisions Made

- Restore uses `adminSb` for the UPDATE (ownership verified via user supabase SELECT first): ensures the update can clear trashed_at even if RLS write policies are restrictive, while still double-enforcing `.eq("user_id", user.id)` on the update itself.
- Storage-first in DELETE to prevent orphaned files: the `.remove()` call precedes `.from("posts").delete()` per research Pitfall 1.
- `daysRemaining()` clamped with `Math.max(0, ...)`: safe for posts trashed more than 30 days ago where cron hasn't yet swept.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Merged Phase 11 prior worktree branch before executing 11-03**
- **Found during:** Pre-task setup
- **Issue:** This worktree (`agent-a658db030072a8d45`) was based on `77b67b4` (main branch before Phase 11). The 11-01 (`TRASH_RETENTION_DAYS`, `trashed_at` schema) and 11-02 (`cleanup-cron.service.ts`) work was committed on a separate worktree branch (`worktree-agent-a6734d520399643d7`). Without the 11-01 changes, `TRASH_RETENTION_DAYS` import in `trash.routes.ts` would have failed to compile.
- **Fix:** `git merge worktree-agent-a6734d520399643d7` (fast-forward) — brought in all 14 files from 11-01 and 11-02 atomically.
- **Files modified:** shared/schema.ts, server/routes/posts.routes.ts, server/services/cleanup-cron.service.ts, server/index.ts, plus planning docs and migration
- **Verification:** `npm run check` exits 0 after merge + `npm install` (node-cron was not installed in this worktree's node_modules)
- **Committed in:** Fast-forward merge (no new merge commit — HEAD advanced from 77b67b4 to 1d30f36)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking dependency from prior worktree not in current worktree's HEAD)
**Impact on plan:** Required for correct compilation. No scope creep. All Phase 11 work is now on a single coherent branch.

## Issues Encountered

- `node-cron` package was in `package.json` (added by 11-02) but not installed in this worktree's `node_modules/`. Ran `npm install` to resolve before type checking.

## User Setup Required

None — no new external service configuration required. The trash endpoints use existing Supabase connection. SQL migration from Plan 11-01 must be applied via Supabase dashboard for the `trashed_at` column to exist.

## Next Phase Readiness

- All three trash API endpoints are live and compile cleanly
- `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id` are ready for 11-04 (trash UI) to consume
- TRSH-03, TRSH-04, TRSH-05 requirements satisfied

## Self-Check: PASSED

- FOUND: server/routes/trash.routes.ts
- FOUND: shared/schema.ts (trashedPostSchema at line 430, trashListResponseSchema at line 443)
- FOUND: 11-03-SUMMARY.md
- FOUND: commits d54b290, 88d12f3, cfcf95a (task commits), ed2a78d (docs commit)
- npm run check: exits 0

---
*Phase: 11-post-trash-and-automated-cleanup*
*Completed: 2026-05-07*
