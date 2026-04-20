---
phase: 02-supabase-client-correctness
plan: 02
subsystem: api
tags: [express, supabase, storage, admin, rpc]
requires:
  - phase: 01-security-auth-hardening
    provides: strict auth/admin guards used before privileged server operations
  - phase: 02-supabase-client-correctness
    provides: established user-read/admin-mutate storage pattern for post version cleanup
provides:
  - admin-storage image edit uploads aligned with sibling media flows
  - honest failure handling for admin color migration RPC errors
affects: [edit-flow, admin-maintenance, storage]
tech-stack:
  added: []
  patterns:
    - image edit storage uploads use createAdminSupabase while owned-row inserts remain user-scoped
    - admin RPC routes must branch on returned Supabase errors before reporting success
key-files:
  created:
    - .planning/phases/02-supabase-client-correctness/02-supabase-client-correctness-02-SUMMARY.md
  modified:
    - server/routes/edit.routes.ts
    - server/routes/admin.routes.ts
key-decisions:
  - "Aligned only the image-edit storage calls with the existing admin-storage pattern and left the post_versions insert on the user-scoped client."
  - "Returned a 500 with the existing manual SQL note when migrate-colors receives an RPC error instead of silently succeeding."
patterns-established:
  - "Keep storage writes on admin clients when sibling branches already require the same RLS-bypassing behavior."
  - "Treat Supabase RPC error values as explicit failure paths, not success-with-warning states."
requirements-completed: [SBC-03, DATA-04]
duration: 5min
completed: 2026-04-20
---

# Phase 2 Plan 2: Edit Upload And RPC Summary

**Admin-scoped image edit uploads and explicit color-migration RPC failure handling for Supabase-backed maintenance flows.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-20T20:30:00Z
- **Completed:** 2026-04-20T20:35:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Switched image edit uploads and thumbnail uploads to an admin storage client, matching the existing video and generate flows.
- Kept the `post_versions` insert on the user-scoped client so owned-row writes still respect the existing route boundary.
- Added an explicit RPC error branch to `POST /api/admin/migrate-colors` so failures no longer return `success: true`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Move only the edit image storage calls to an admin client** - `271e0a8` (fix)
2. **Task 2: Branch on migrate-colors RPC failure before returning success** - `de74378` (fix)

**Plan metadata:** Recorded in the final Phase 2 docs commit.

## Files Created/Modified
- `server/routes/edit.routes.ts` - Routes image-edit storage uploads and public URL lookups through an admin Supabase client while leaving the version insert on the user client.
- `server/routes/admin.routes.ts` - Logs `exec` RPC errors and returns a 500 response with the existing manual SQL fallback note.

## Decisions Made
- Reused `createAdminSupabase()` only inside the image-edit upload branch instead of widening admin access across the whole route.
- Preserved the existing manual-SQL recovery guidance in `migrate-colors` so the failure path stays actionable for admins.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Route-level manual verification still requires a live Supabase project, authenticated requests, and data seeded for edit and admin flows.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Edit uploads and admin migration now follow the same honest client/error boundaries expected by the Phase 2 goal.
- Manual smoke verification remains for the image edit route and a forced-failure `migrate-colors` call in a live environment.

## Self-Check: PASSED

---
*Phase: 02-supabase-client-correctness*
*Completed: 2026-04-20*
