# Requirements: My Social Autopilot

**Defined:** 2026-04-20
**Core Value:** Users can generate a complete, on-brand social media post (image + caption) in seconds using only a text prompt.
**Source:** System audit — .planning/debug/full-system-bug-audit.md

## v1.0 Requirements — Bug Fixes & System Hardening

### Security & Auth

- [x] **SEC-01**: Bearer token extraction uses prefix check (`startsWith("Bearer ")`) not string replace, rejecting malformed headers
- [x] **SEC-02**: `requireAdmin` middleware attaches `req.profile` to the request so downstream handlers can read it without errors
- [x] **SEC-03**: Stripe webhook handler validates that `rawBody` is a Buffer before passing to signature verification

### Supabase Client Correctness

- [x] **SBC-01**: Post version delete uses admin Supabase client (no RLS DELETE policy on `post_versions`)
- [x] **SBC-02**: Storage cleanup after version delete uses admin Supabase client (no orphaned files)
- [x] **SBC-03**: Edit route image upload uses admin Supabase client consistent with generate route

### Quota & Business Logic

- [x] **QUOT-01**: `incrementQuickRemakeCount` uses valid Supabase JS update syntax (not `sb.raw()`) with error handling
- [x] **QUOT-02**: `checkCredits` returns `"inactive_subscription"` denial reason for inactive subscriptions in `subscription_overage` mode
- [x] **QUOT-03**: Duplicate `GET /api/settings` route is consolidated into one handler that includes icon URL from `landing_content`

### Data Integrity

- [x] **DATA-01**: Post edit correctly reads `aspect_ratio` from the appropriate source (not a non-existent DB column)
- [x] **DATA-02**: Post version delete removes thumbnail files as well as primary image files (no orphaned thumbnails)
- [x] **DATA-03**: Admin stats and users queries include `.limit()` calls to handle tables exceeding 1000 rows correctly
- [x] **DATA-04**: Admin color-migration RPC call has error handling and does not silently succeed on failure
- [x] **DATA-05**: Edit route `usesOwnApiKey` logic is deduplicated — single check path with consistent error message

### Frontend Reliability

- [x] **FE-01**: Direct URL navigation to `/admin/*` by a verified admin does not redirect to `/dashboard`
- [x] **FE-02**: Telegram signup notification fires only on first signup, not on every login or token refresh
- [x] **FE-03**: `getAuthHeaders()` surfaces initialization errors instead of silently swallowing them
- [x] **FE-04**: TanStack query key construction never produces malformed URLs (no `[object Object]` in path)
- [x] **FE-05**: `fetchUserData` sets `loading` to `false` in a `finally` block so spinners resolve on errors
- [x] **FE-06**: `refreshProfile` uses `.maybeSingle()` consistent with all other profile fetches (no 406 on missing row)
- [x] **FE-07**: `AppContent` guards against `profile === null` before reading `profile.is_admin`
- [x] **FE-08**: Financial data queries (`credits`, `billing`) have appropriate `staleTime` so stale balances are not shown after mutations

## v2 Requirements

*(Deferred — not in current roadmap)*

- **PERF-01**: Admin stats endpoint uses aggregation queries instead of full table scans
- **NOTIF-01**: Telegram notification service has server-side rate limiting and deduplication
- **AUDIT-01**: Request logging in generate route is consolidated into a single sanitization path

## Out of Scope

| Feature | Reason |
|---------|--------|
| New product features | Bug-fix milestone only — new capabilities after system is stable |
| Database schema migrations | No schema changes needed for these fixes |
| Supabase RLS policy changes | Fixes are code-side (use correct client), not policy-side |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |
| SEC-03 | Phase 1 | Complete |
| QUOT-02 | Phase 1 | Complete |
| QUOT-03 | Phase 1 | Complete |
| SBC-01 | Phase 2 | Complete |
| SBC-02 | Phase 2 | Complete |
| SBC-03 | Phase 2 | Complete |
| QUOT-01 | Phase 2 | Complete |
| DATA-04 | Phase 2 | Complete |
| DATA-01 | Phase 3 | Complete |
| DATA-02 | Phase 3 | Complete |
| DATA-03 | Phase 3 | Complete |
| DATA-05 | Phase 3 | Complete |
| FE-01 | Phase 4 | Complete |
| FE-02 | Phase 4 | Complete |
| FE-03 | Phase 4 | Complete |
| FE-04 | Phase 4 | Complete |
| FE-05 | Phase 4 | Complete |
| FE-06 | Phase 4 | Complete |
| FE-07 | Phase 4 | Complete |
| FE-08 | Phase 4 | Complete |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-20 — traceability updated after roadmap creation*
