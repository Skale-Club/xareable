---
phase: 02-supabase-client-correctness
plan: 01
subsystem: api
tags: [express, supabase, rls, storage, quota]
requires:
  - phase: 01-security-auth-hardening
    provides: strict auth middleware and validated server-side token handling
provides:
  - admin-client deletes for non-original post versions
  - admin storage cleanup for deleted post version assets
  - validated preservation of the existing quick-remake counter implementation
affects: [post-version-management, storage-cleanup, quota]
tech-stack:
  added: []
  patterns:
    - ownership reads stay user-scoped while delete and storage cleanup use createAdminSupabase
    - validated quota counter fixes are preserved instead of rewritten
key-files:
  created:
    - .planning/phases/02-supabase-client-correctness/02-supabase-client-correctness-01-SUMMARY.md
  modified:
    - server/routes/posts.routes.ts
key-decisions:
  - "Changed only the two wrong-client call sites in the version delete route and kept the ownership reads on the user-scoped client."
  - "Left incrementQuickRemakeCount unchanged because the existing read-then-update flow already satisfies QUOT-01."
patterns-established:
  - "Use the existing admin client for post_versions deletes after ownership is already proven."
  - "Use admin storage cleanup for version file removal so RLS cannot silently block object deletes."
requirements-completed: [SBC-01, SBC-02, QUOT-01]
duration: 6min
completed: 2026-04-20
---

# Phase 2 Plan 1: Version Delete Client Summary

**Admin-scoped version deletes and storage cleanup for post versions, with the existing quick-remake counter fix preserved as-is.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-20T20:24:00Z
- **Completed:** 2026-04-20T20:30:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Switched non-original post version deletes to `adminSb` so RLS cannot block the mutation.
- Switched version asset cleanup to `adminSb.storage` so deleted versions do not leave orphaned files behind.
- Confirmed `incrementQuickRemakeCount()` already uses a valid read-then-update Supabase path with explicit error handling.

## Task Commits

Each task was handled atomically:

1. **Task 1: Swap the version-delete mutation and storage cleanup to the existing admin client** - `4bc7875` (fix)
2. **Task 2: Validate and preserve the existing quick-remake counter implementation** - no code changes required after validation

**Plan metadata:** Recorded in the final Phase 2 docs commit.

## Files Created/Modified
- `server/routes/posts.routes.ts` - Uses the existing admin Supabase client for the non-original version delete and storage cleanup path.
- `server/quota.ts` - Reviewed only; no changes were needed because the current implementation already satisfies `QUOT-01`.

## Decisions Made
- Kept the fix surgical by changing only the two broken trust-boundary call sites in `server/routes/posts.routes.ts`.
- Treated `QUOT-01` as a verification requirement, not a rewrite target, because the current implementation already compiles and throws on Supabase errors.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Live manual verification for the delete route and quick-remake counter still requires a configured Supabase environment with seeded data and valid auth context.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Version deletion now follows the established user-read/admin-mutate pattern used elsewhere in the codebase.
- Manual smoke verification remains for deleting a non-original version and for invoking `incrementQuickRemakeCount()` against a live project.

## Self-Check: PASSED

---
*Phase: 02-supabase-client-correctness*
*Completed: 2026-04-20*
