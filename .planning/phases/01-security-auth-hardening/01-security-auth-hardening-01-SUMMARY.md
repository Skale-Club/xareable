---
phase: 01-security-auth-hardening
plan: 01
subsystem: auth
tags: [express, supabase, auth, bearer, middleware]
requires: []
provides:
  - strict Bearer token parsing in shared auth middleware
  - admin middleware requests populated with full profile data
affects: [server-auth, admin-routes, middleware]
tech-stack:
  added: []
  patterns:
    - strict Authorization prefix validation with startsWith plus slice
    - admin profile fetches use createAdminSupabase with maybeSingle
key-files:
  created: []
  modified:
    - server/middleware/auth.middleware.ts
key-decisions:
  - "Kept requireAdmin as a standalone middleware and attached req.profile inline instead of refactoring through authenticateUser."
  - "Applied strict Bearer parsing at both extractToken and requireAdminGuard call sites."
patterns-established:
  - "Bearer parsing rejects malformed headers by returning null unless the header starts with 'Bearer '."
  - "Admin middleware attaches req.user, req.supabase, and req.profile together after a successful admin check."
requirements-completed: [SEC-01, SEC-02]
duration: 8min
completed: 2026-04-20
---

# Phase 1 Plan 1: Auth Middleware Summary

**Strict Bearer header validation and full admin profile attachment in shared Express auth middleware.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-20T19:56:00Z
- **Completed:** 2026-04-20T20:04:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Rejected malformed Authorization headers in shared Bearer parsing.
- Fixed the inline admin guard to use the same strict Bearer prefix check.
- Populated `req.profile` inside `requireAdmin()` using the full admin-fetched profile.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix Bearer extraction at every auth middleware call site** - `20fa777` (fix)
2. **Task 2: Attach full admin profile inside requireAdmin** - `27d805d` (fix)

**Plan metadata:** Recorded in the final Phase 1 docs commit.

## Files Created/Modified
- `server/middleware/auth.middleware.ts` - Hardened token extraction and attached the full admin profile to authenticated admin requests.

## Decisions Made
- Kept the fix surgical inside `requireAdmin()` instead of refactoring middleware composition.
- Used `createAdminSupabase()` with `select("*")` and `.maybeSingle()` so `req.profile` has the full row shape expected by downstream handlers.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npm run check` was temporarily blocked during this plan by a pre-existing `server/quota.ts` type error (`sb.raw`), which was resolved during Plan 02 as a blocking verification fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Shared auth middleware now rejects malformed Bearer headers and provides complete admin request context.
- Manual smoke checks remain for malformed-header 401 behavior and one-off middleware invocation with a real admin token.

## Self-Check: PASSED

---
*Phase: 01-security-auth-hardening*
*Completed: 2026-04-20*
