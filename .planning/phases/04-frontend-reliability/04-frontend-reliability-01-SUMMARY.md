---
phase: 04-frontend-reliability
plan: 01
subsystem: frontend
tags: [react, wouter, auth, admin, routing]
requires:
  - phase: 03-data-integrity-business-logic
    provides: stable backend responses while the client shell is hardened
provides:
  - route-synced admin mode for direct /admin navigation
  - explicit private-shell guard when profile bootstrap is still null
affects: [client-routing, admin-shell, auth-bootstrap]
tech-stack:
  added: []
  patterns:
    - synchronize admin mode from the current route instead of a stale persisted flag
    - block private-shell rendering until both brand and profile state are safe to read
key-files:
  created:
    - .planning/phases/04-frontend-reliability/04-frontend-reliability-01-SUMMARY.md
  modified:
    - client/src/App.tsx
key-decisions:
  - "Kept admin mode intact and synchronized it in `client/src/App.tsx` so `/admin/*` routes restore the admin shell without rewriting the provider."
  - "Added an explicit `!profile` fallback before the admin/user split instead of assuming `brand` guarantees a usable profile row."
patterns-established:
  - "Let authenticated route intent repair persisted UI mode when shell selection depends on both role and pathname."
  - "Guard private React shells against partially loaded auth state before reading role flags."
requirements-completed: [FE-01, FE-07]
duration: 1min
completed: 2026-04-20
---

# Phase 4 Plan 1: Admin Shell Reliability Summary

**The private app shell now keeps admins on direct `/admin/*` routes and blocks unsafe rendering when the profile row has not loaded yet.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-20T21:09:45Z
- **Completed:** 2026-04-20T21:11:43Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added route-aware admin-mode synchronization in `client/src/App.tsx` so authenticated admins landing on `/admin/*` restore the admin shell automatically.
- Left the existing admin-mode feature and exit flow intact while preventing the user-shell `/admin` redirect branch from winning on direct admin navigation.
- Added a blocking `!profile` fallback before the admin/user shell split so the app no longer reaches `profile.is_admin` while profile bootstrap is incomplete.

## Task Commits

Each task was committed atomically:

1. **Task 1: Route-sync admin mode for direct `/admin/*` navigation** - `b3c31f2` (fix)
2. **Task 2: Guard `AppContent` against `profile === null` before shell selection** - `b3c31f2` (fix)

**Plan metadata:** Recorded in the final Phase 4 docs commit.

## Files Created/Modified
- `client/src/App.tsx` - Synchronizes admin mode from `/admin` routes and adds a safe blocking fallback when `profile` is still null.

## Decisions Made
- Fixed FE-01 inside `AppContent` rather than changing `client/src/lib/admin-mode.tsx` so the current shell structure stays intact.
- Used a minimal blocking fallback for missing profile state instead of redirecting or broadening scope into a larger auth UX redesign.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Manual verification still requires an authenticated admin session to test direct loads of `/admin/dashboard` and `/admin/users`, plus a delayed-profile bootstrap scenario.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Direct admin navigation now repairs admin mode from the route itself.
- The private shell no longer assumes `brand` implies `profile` is ready.

## Self-Check: PASSED

---
*Phase: 04-frontend-reliability*
*Completed: 2026-04-20*
