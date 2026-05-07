---
phase: 11-post-trash-and-automated-cleanup
plan: 02
subsystem: infra
tags: [node-cron, supabase, storage, cron, cleanup, typescript]

# Dependency graph
requires:
  - phase: 11-01
    provides: TRASH_RETENTION_DAYS constant and trashed_at column in posts table

provides:
  - node-cron and @types/node-cron in package.json
  - server/services/cleanup-cron.service.ts with runTrashSweep, runPurgeSweep, startCronJobs
  - cron jobs wired into server/index.ts httpServer.listen callback (TRSH-06)

affects: [11-03-trash-routes, 11-04-trash-ui]

# Tech tracking
tech-stack:
  added: [node-cron@^4.2.1, @types/node-cron]
  patterns:
    - Storage-before-DB delete order (collect all paths → remove() → .delete()) to prevent orphan files
    - PURGE_BATCH_LIMIT=50 cap per run to avoid unbounded batch processing
    - Cron registered inside httpServer.listen callback so jobs start only after port is bound (not before)
    - Enhancement source sibling path derived from image_url (.webp → -source.webp) before storage delete

key-files:
  created:
    - server/services/cleanup-cron.service.ts
  modified:
    - package.json
    - package-lock.json
    - server/index.ts

key-decisions:
  - "startCronJobs() called inside httpServer.listen callback — cron must not fire before port is bound (Pitfall 5)"
  - "Storage delete chunks of 100 (Supabase batch limit), abort DB delete if any chunk fails to avoid orphan files"
  - "version_cleanup_log best-effort cleanup by time window (60s) since CASCADE-deleted rows cannot be joined"
  - "No environment guard — cron runs in all environments (dev + prod)"

patterns-established:
  - "Storage-first purge pattern: collect all paths (posts + post_slides + post_versions + enhancement-source), remove() BEFORE .delete()"
  - "Cron job registration inside listen callback prevents premature job startup"

requirements-completed: [TRSH-01, TRSH-02, TRSH-06]

# Metrics
duration: 8min
completed: 2026-05-07
---

# Phase 11 Plan 02: Cron Cleanup Service Summary

**node-cron trash-sweep (every 6h) and purge-sweep (every 6h+30m) registered in server/index.ts — expired posts auto-trash, 30-day-trashed posts permanently purged with storage-before-DB delete order**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-07T02:27:30Z
- **Completed:** 2026-05-07T02:35:00Z
- **Tasks:** 3
- **Files modified:** 3 + 1 created

## Accomplishments

- Installed `node-cron@^4.2.1` and `@types/node-cron` with both appearing in package.json
- Created `server/services/cleanup-cron.service.ts` with three exports: `runTrashSweep` (soft-deletes expired posts), `runPurgeSweep` (storage-first permanent delete of 30-day-trashed posts), `startCronJobs` (registers both cron schedules)
- Wired `startCronJobs()` into `server/index.ts` `httpServer.listen` callback so jobs start after port binds — no HTTP calls to `/api/posts/cleanup` involved (TRSH-06 compliant)

## Task Commits

1. **Task 1: Install node-cron and @types/node-cron** - `016c052` (chore)
2. **Task 2: Create cleanup-cron.service.ts** - `43ac03e` (feat)
3. **Task 3: Wire startCronJobs() into server/index.ts** - `a1c241c` (feat)

## Files Created/Modified

- `server/services/cleanup-cron.service.ts` - runTrashSweep, runPurgeSweep, startCronJobs with storage-before-DB purge order
- `package.json` - node-cron in dependencies, @types/node-cron in devDependencies
- `package-lock.json` - lock file updated
- `server/index.ts` - import + call to startCronJobs() inside httpServer.listen callback

## Decisions Made

- `startCronJobs()` called inside `httpServer.listen` callback — jobs must not fire before port is bound. No environment guard added; cron runs in all environments (dev + prod).
- Storage delete uses chunks of 100 (Supabase batch limit). If any storage chunk fails, DB delete is aborted to prevent orphan files.
- `version_cleanup_log` cleanup uses a 60-second time window (best-effort) since CASCADE-deleted `post_versions`/`post_slides` rows cannot be joined after deletion.
- `PURGE_BATCH_LIMIT = 50` caps posts per purge run to prevent unbounded processing.

## Deviations from Plan

**1. [Rule 3 - Blocking] Merged main branch into worktree before execution**
- **Found during:** Pre-execution setup
- **Issue:** Worktree branch `worktree-agent-a6734d520399643d7` was based on `77b67b4` (before Plan 11-01 commits). `TRASH_RETENTION_DAYS` export from `shared/schema.ts` was not present.
- **Fix:** `git merge main --no-edit` fast-forwarded the worktree branch to include Plan 11-01 commits (`851faf6`, `1caef32`, `9ae2bcf`, `dfd2ffc`), making `TRASH_RETENTION_DAYS` available.
- **Files modified:** All files from 11-01 plan (schema.ts, posts.routes.ts, etc.)
- **Verification:** `grep "TRASH_RETENTION_DAYS" shared/schema.ts` returned line 378
- **Committed in:** merge commit (fast-forward, no separate commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking dependency not present in worktree)
**Impact on plan:** Required to unblock the import of `TRASH_RETENTION_DAYS`. Fast-forward merge, no conflicts, no scope creep.

## Issues Encountered

None — after merging main to get 11-01 changes, all three tasks executed cleanly. `npm run check` exited 0 after both service creation and server wiring.

## User Setup Required

None — no external service configuration required. The cron jobs will start automatically with the server. They will no-op gracefully until the `trashed_at` DB migration from Plan 11-01 is applied to the Supabase database.

## Next Phase Readiness

- `startCronJobs()` is live — the automated trash + purge lifecycle is operational once the DB migration runs
- Plan 11-03 (trash routes: PATCH /api/posts/:id/trash, DELETE /api/posts/:id/trash) can build on top of this foundation
- Plan 11-04 (trash UI) can wire to the routes from 11-03
- No blockers

---
*Phase: 11-post-trash-and-automated-cleanup*
*Completed: 2026-05-07*
