---
phase: 04-frontend-reliability
plan: 03
subsystem: frontend
tags: [react-query, auth, caching, billing, fetch]
requires:
  - phase: 03-data-integrity-business-logic
    provides: stable billing endpoints and admin pages for frontend freshness fixes
provides:
  - thrown auth initialization failures from shared query helpers
  - canonical first-segment URLs for default TanStack queries
  - billing-page freshness overrides without changing global cache defaults
affects: [query-client, billing-page, authenticated-fetches]
tech-stack:
  added: []
  patterns:
    - treat the first query-key segment as cache-backed request URL identity
    - opt billing reads into zero-stale mount refetches instead of changing app-wide cache policy
key-files:
  created:
    - .planning/phases/04-frontend-reliability/04-frontend-reliability-03-SUMMARY.md
  modified:
    - client/src/lib/queryClient.ts
    - client/src/pages/credits.tsx
key-decisions:
  - "Made `getAuthHeaders()` throw on Supabase/session initialization failure so callers can surface the real error path."
  - "Kept the global `staleTime: Infinity` default and overrode only the billing page queries with `staleTime: 0` plus mount refetches."
patterns-established:
  - "Shared query helpers should derive request URLs from a canonical string key segment, not from every cache-identity segment."
  - "Balance-sensitive pages can opt out of infinite freshness locally while the rest of the app keeps stable cache defaults."
requirements-completed: [FE-03, FE-04, FE-08]
duration: 1min
completed: 2026-04-20
---

# Phase 4 Plan 3: Query and Billing Freshness Summary

**Shared authenticated queries now surface auth bootstrap failures, default to canonical URL keys, and refresh billing data on revisit without changing global cache policy.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-20T21:09:45Z
- **Completed:** 2026-04-20T21:11:43Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Removed the silent fallback from `getAuthHeaders()` so query and mutation callers can handle real Supabase/session initialization failures.
- Changed the shared default query fetcher to use `queryKey[0]` as the canonical URL, preventing malformed requests from joined cache keys.
- Added page-local live freshness options to the billing queries in `client/src/pages/credits.tsx` and tightened local invalidation to exact billing keys.

## Task Commits

Each task was committed atomically:

1. **Task 1: Make auth-header initialization failures throw** - `737a201` (fix)
2. **Task 2: Use the first query-key segment as the shared fetch URL** - `737a201` (fix)
3. **Task 3: Override billing freshness locally in `credits.tsx`** - `737a201` (fix)

**Plan metadata:** Recorded in the final Phase 4 docs commit.

## Files Created/Modified
- `client/src/lib/queryClient.ts` - Throws initialization failures and uses the first query-key segment as the canonical fetch URL.
- `client/src/pages/credits.tsx` - Applies local billing freshness overrides and exact invalidation for billing overview/account refreshes.

## Decisions Made
- Left existing explicit page-level `queryFn` implementations untouched so dynamic admin requests continue to build their own URLs.
- Fixed FE-08 at the billing page only, keeping the global React Query defaults unchanged for the rest of the app.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Manual verification still requires browser inspection of protected fetch failures, shared-query request URLs, billing mutation refreshes, and revisit-after-redirect cache behavior.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Shared queries now fail loudly on auth initialization problems and stop serializing cache keys into request paths.
- Billing reads now opt into fresh data when the user returns to `/billing`.

## Self-Check: PASSED

---
*Phase: 04-frontend-reliability*
*Completed: 2026-04-20*
