---
phase: 11-post-trash-and-automated-cleanup
plan: 04
subsystem: ui
tags: [react, tanstack-query, wouter, supabase, lucide-react, shadcn]

# Dependency graph
requires:
  - phase: 11-post-trash-and-automated-cleanup/11-03
    provides: GET /api/trash, POST /api/trash/:id/restore, DELETE /api/trash/:id, trashedPostSchema, trashListResponseSchema
  - phase: 11-post-trash-and-automated-cleanup/11-02
    provides: cleanup-cron.service.ts with startCronJobs(), runTrashSweep(), runPurgeSweep()
  - phase: 11-post-trash-and-automated-cleanup/11-01
    provides: trashed_at column, TRASH_RETENTION_DAYS, gallery filter
provides:
  - TrashPage component at client/src/pages/trash.tsx
  - /trash route in App.tsx (inner Switch + outer AppRouter)
  - Trash sidebar nav item (Trash2 icon, between Dashboard and Billing)
  - scripts/verify-phase-11.ts — 39 static checks covering TRSH-01 through TRSH-06
affects: [phase-12-if-any]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useQuery<TrashListResponse> over /api/trash with enabled: !!user guard
    - queryClient.invalidateQueries on restore (invalidates both /api/trash and posts cache)
    - AlertDialog confirmation pattern before destructive DELETE
    - ContentTypeBadge component as local switch-case renderer for content_type icons
    - days-remaining rendered via t("{n} days left").replace("{n}", String(n)) substitution
    - data-testid attributes on grid container and per-card elements for e2e testing

key-files:
  created:
    - client/src/pages/trash.tsx
    - scripts/verify-phase-11.ts
  modified:
    - client/src/App.tsx
    - client/src/components/app-sidebar.tsx

key-decisions:
  - "Cherry-picked 11-02 and 11-03 code commits from their worktree branches (a6734d5 and a658db0) since this worktree was based on main before those phases; avoids git merge conflicts with untracked planning files"
  - "Fixed verify-phase-11.ts DELETE storage-before-DB check to use .remove() < lastIndexOf(.delete()) instead of .from('posts') < .from('user_assets') — the SELECT ownership check at the start of the handler uses .from('posts') before the storage remove, causing a false failure"

patterns-established:
  - "Trash page shares ContentTypeBadge pattern with posts.tsx but as a local component (no extraction to shared component since scope is narrow)"
  - "Verification scripts use indexOf/.lastIndexOf to check ordering of operations in source files — more reliable than regex for relative positioning"

requirements-completed: [TRSH-03, TRSH-04, TRSH-05]

# Metrics
duration: 25min
completed: 2026-05-07
---

# Phase 11 Plan 04: Trash UI + Verification Script Summary

**TrashPage with days-remaining badges, Restore + Delete-Forever actions, sidebar Trash entry, and 39-check static verification script covering the full Phase 11 contract**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-07T03:00:00Z
- **Completed:** 2026-05-07T03:25:00Z
- **Tasks:** 3 of 4 (Task 4 is human UAT checkpoint — pending)
- **Files modified:** 2 created + 2 modified

## Accomplishments

- Created `client/src/pages/trash.tsx` with `useQuery<TrashListResponse>` over `/api/trash`, grid of TrashedPost cards with content-type badge and days-remaining overlay, Restore (POST) and Delete Forever (DELETE) actions, AlertDialog confirmation, and empty-state UI
- Registered `/trash` route in both inner `<Switch>` (renders `TrashPage`) and outer `AppRouter` Switch (wraps `AppContent`) in `App.tsx`; added `Trash2` to lucide imports and `{ title: "Trash", url: "/trash", icon: Trash2 }` between Dashboard and Billing in `app-sidebar.tsx` userNavItems
- Created `scripts/verify-phase-11.ts` with 39 static checks across TRSH-01 through TRSH-06 — exits 0 with all checks green

## Task Commits

1. **Task 1: Create client/src/pages/trash.tsx** - `610392a` (feat)
2. **Task 2: Register /trash route in App.tsx + add sidebar entry** - `8fee915` (feat)
3. **Task 3: Create scripts/verify-phase-11.ts** - `77ee646` (feat)

**Note:** Task 4 (Human UAT) is a checkpoint — human sign-off pending.

## Files Created/Modified

- `client/src/pages/trash.tsx` - TrashPage component with grid, Restore/Delete actions, AlertDialog, empty state
- `client/src/App.tsx` - Lazy TrashPage import, /trash route in inner and outer Switch
- `client/src/components/app-sidebar.tsx` - Trash2 import + Trash nav item in userNavItems
- `scripts/verify-phase-11.ts` - 39-check static verification script for all TRSH requirements

## Decisions Made

- Cherry-picked 11-02 and 11-03 code commits from sibling worktree branches into this branch (main) since this worktree was based on the pre-Phase-11 main commit. This avoided a `git merge` conflict caused by an untracked `11-03-SUMMARY.md` file already in the working tree.
- Fixed the "DELETE handler removes storage BEFORE DB" verification check to use `indexOf('.remove(') < lastIndexOf('.delete()')` — the earlier approach using `.from("posts")` vs `.from("user_assets")` positions was wrong because the ownership SELECT query uses `.from("posts")` before the storage remove call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cherry-picked 11-02 and 11-03 commits from sibling worktree branches**
- **Found during:** Pre-task setup
- **Issue:** This worktree (agent-a841e666a323110a8) was on main branch at commit d3b53cf which only had 11-01 and 11-02 work from a previous worktree (agent-a6734d520399643d7). The 11-03 work (trash.routes.ts, trashedPostSchema) was on worktree-agent-a658db030072a8d45 and had not been merged. Without trash.routes.ts and trashedPostSchema, Task 1 would have failed on import.
- **Fix:** `git cherry-pick 016c052 43ac03e a1c241c` (11-02 code commits) then `git cherry-pick d54b290 88d12f3 cfcf95a` (11-03 code commits). Used cherry-pick instead of merge because `git merge` aborted due to untracked `11-03-SUMMARY.md` in working tree.
- **Files modified:** server/services/cleanup-cron.service.ts, server/index.ts, server/routes/trash.routes.ts, server/routes/index.ts, shared/schema.ts, package.json, package-lock.json
- **Verification:** `npm run check` exits 0 after `npm install` (node-cron was not in this worktree's node_modules)
- **Committed in:** 36a4e56, 62b2b6c, 012b588 (11-02); 993f0b1, 94941a0, a4ddd19 (11-03)

**2. [Rule 1 - Bug] Fixed verify-phase-11.ts storage-before-DB check**
- **Found during:** Task 3 (verify script execution)
- **Issue:** First run showed `FAIL DELETE handler removes storage BEFORE DB`. The check compared `.from("user_assets")` position vs `.from("posts")` position, but the DELETE handler starts with a SELECT `.from("posts")` for ownership verification, which appears before the `.from("user_assets")` storage remove call.
- **Fix:** Changed check to `indexOf('.remove(') < lastIndexOf('.delete()')` which correctly identifies that the storage `.remove()` precedes the DB `.delete()` call.
- **Files modified:** scripts/verify-phase-11.ts
- **Verification:** All 39 checks pass after fix
- **Committed in:** 77ee646 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking dependency, 1 Rule 1 bug in verification logic)
**Impact on plan:** Both auto-fixes necessary for correct execution. No scope creep.

## Issues Encountered

- `node-cron` not in this worktree's `node_modules/` — resolved with `npm install` before TypeScript check

## User Setup Required

None beyond the SQL migration (Plan 11-01) already documented. The Trash UI consumes existing Phase 11-03 API endpoints.

## Human UAT Pending

Task 4 checkpoint (human-verify) is awaiting user sign-off. See the 8-step checklist in 11-04-PLAN.md Task 4 for the verification procedure.

## Next Phase Readiness

- All Phase 11 automated checks pass (39/39 green)
- TrashPage is fully wired to the three trash API endpoints
- Sidebar Trash entry navigates to /trash and highlights when active
- Human UAT (Task 4) is the only remaining gate before Phase 11 is complete

## Self-Check: PASSED

- FOUND: client/src/pages/trash.tsx
- FOUND: client/src/App.tsx (contains TrashPage lazy import + /trash routes)
- FOUND: client/src/components/app-sidebar.tsx (contains Trash2 + /trash nav item)
- FOUND: scripts/verify-phase-11.ts (155 lines, exits 0)
- FOUND: commits 610392a, 8fee915, 77ee646
- npx tsx scripts/verify-phase-11.ts: exits 0, 39/39 checks passed

---
*Phase: 11-post-trash-and-automated-cleanup*
*Completed: 2026-05-07 (Tasks 1-3; Task 4 awaiting human UAT)*
