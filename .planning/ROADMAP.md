# Roadmap: My Social Autopilot — v1.0 Bug Fixes & System Hardening

## Overview

This milestone addresses 22 bugs identified in the 2026-04-20 system audit before any new feature work begins. Phases are ordered by dependency: foundational server security and auth middleware first, then Supabase client correctness, then data integrity and business logic, and finally frontend reliability. Each phase can be tested independently and does not require the next to compile or run.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Security & Auth Hardening** - Fix token extraction, admin middleware, and webhook validation on the server
- [x] **Phase 2: Supabase Client Correctness** - Replace all wrong-client usages so RLS policies are respected
- [x] **Phase 3: Data Integrity & Business Logic** - Fix post/version management, admin queries, and API key logic
- [ ] **Phase 4: Frontend Reliability** - Fix client-side routing, auth events, error handling, and stale data

## Phase Details

### Phase 1: Security & Auth Hardening
**Goal**: All server-side auth and security primitives work correctly and reject malformed input
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, QUOT-02, QUOT-03
**Success Criteria** (what must be TRUE):
  1. A request with a malformed Authorization header (e.g., missing "Bearer " prefix) receives a 401 response, not a server error
  2. An admin route handler can read `req.profile` without crashing — profile is attached by `requireAdmin` middleware
  3. A Stripe webhook request with a non-Buffer raw body is rejected with an error before signature verification runs
  4. A user with an inactive subscription is told their subscription is inactive (not a generic denial) when they exceed quota in `subscription_overage` mode
  5. `GET /api/settings` returns a single response that includes the icon URL from `landing_content` — no duplicate route conflict
**Plans**: 2 plans

Plans:
- [x] `01-01-PLAN.md` — Harden Bearer parsing and attach admin `req.profile` in shared auth middleware
- [x] `01-02-PLAN.md` — Guard Stripe raw body, fix inactive subscription denial, and remove the duplicate settings route

### Phase 2: Supabase Client Correctness
**Goal**: Every Supabase operation uses the correct client (user-scoped or admin) so RLS policies never silently block writes
**Depends on**: Phase 1
**Requirements**: SBC-01, SBC-02, SBC-03, QUOT-01, DATA-04
**Success Criteria** (what must be TRUE):
  1. Deleting a post version succeeds without an RLS policy error — admin client is used for the DELETE
  2. Storage files are removed after version delete — the cleanup call uses the admin client and leaves no orphaned objects
  3. Editing a post uploads the new image using the same client pattern as the generate route — no silent upload failure
  4. Calling `incrementQuickRemakeCount` updates the record in the database without a JS runtime error
  5. The admin color-migration RPC returns and logs an error when it fails — it does not silently report success
**Plans**: 2 plans

Plans:
- [x] `02-01-PLAN.md` - Fix post-version delete client selection and preserve the validated quick-remake counter path
- [x] `02-02-PLAN.md` - Align edit image uploads with admin storage and add honest admin RPC failure handling

### Phase 3: Data Integrity & Business Logic
**Goal**: Post editing reads correct data, version cleanup is complete, admin queries scale, and API key logic has one code path
**Depends on**: Phase 2
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-05
**Success Criteria** (what must be TRUE):
  1. Editing a post does not crash or produce wrong output due to a missing DB column — `aspect_ratio` is read from the correct source
  2. Deleting a post version removes both the primary image and its thumbnail from storage — no orphaned thumbnail files remain
  3. Admin stats and user list endpoints return correct results when tables exceed 1000 rows — `.limit()` is set high enough or pagination is applied
  4. The edit route checks `usesOwnApiKey` once via a single code path and returns a consistent error message if the check fails
**Plans**: 3 plans

Plans:
- [x] `03-01-PLAN.md` - Recover persisted video edit aspect ratio and deduplicate edit Gemini key selection
- [x] `03-02-PLAN.md` - Finish expired-post cleanup by removing version thumbnails from storage
- [x] `03-03-PLAN.md` - Add shared high-limit guards to admin stats and users queries without changing payload shapes

### Phase 4: Frontend Reliability
**Goal**: Client-side routing, auth state, error surfaces, and cache freshness behave correctly for all users
**Depends on**: Phase 3
**Requirements**: FE-01, FE-02, FE-03, FE-04, FE-05, FE-06, FE-07, FE-08
**Success Criteria** (what must be TRUE):
  1. An admin user who navigates directly to `/admin/stats` is shown the admin page, not redirected to `/dashboard`
  2. The Telegram signup notification fires exactly once per new account — refreshing the app or re-authenticating does not re-fire it
  3. When `getAuthHeaders()` fails to initialize, the calling code receives a thrown error it can handle — the failure is not swallowed
  4. No TanStack query key ever contains `[object Object]` — all dynamic segments resolve to strings before the query runs
  5. A loading spinner on a data-fetch page resolves (stops spinning) even when the fetch returns an error — `loading` reaches `false` in a `finally` block
  6. Credit and billing query data is refetched after mutations so users see up-to-date balances immediately
**UI hint**: yes
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security & Auth Hardening | 2/2 | Complete | 2026-04-20 |
| 2. Supabase Client Correctness | 2/2 | Complete | 2026-04-20 |
| 3. Data Integrity & Business Logic | 3/3 | Complete | 2026-04-20 |
| 4. Frontend Reliability | 0/TBD | Not started | - |
