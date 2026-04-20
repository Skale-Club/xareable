# Phase 1: Security & Auth Hardening - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix 5 known server-side security and auth bugs from the system audit. All bugs are in `server/middleware/auth.middleware.ts`, `server/routes/config.routes.ts`, `server/routes/settings.routes.ts`, `server/routes/stripe.routes.ts`, and `server/quota.ts`. No new capabilities — surgical corrections only.

Requirements: SEC-01, SEC-02, SEC-03, QUOT-02, QUOT-03

</domain>

<decisions>
## Implementation Decisions

### Token Extraction Fix (SEC-01)
- **D-01:** Fix ALL call sites that use `.replace("Bearer ", "")` — not just `extractToken()`. This includes `requireAdminGuard()` inline on line 178 and the `requireAdmin` function itself. Use `startsWith("Bearer ")` prefix check + `.slice(7)` at every site.
- **D-02:** `extractToken()` signature change: accept `Request` (not `AuthenticatedRequest`) since it doesn't need the extended type — makes it usable anywhere.

### requireAdmin Profile Attachment (SEC-02)
- **D-03:** Minimal fix only — attach `req.profile` to the request inside `requireAdmin` after the admin check passes. Do NOT refactor to call `authenticateUser()` internally. DRY unification is out of scope for this bugfix phase.
- **D-04:** The profile fetch inside `requireAdmin` already fetches `select("is_admin")` — expand the select to `select("*")` so the full profile is available to attach as `req.profile`.

### Stripe Webhook rawBody Validation (SEC-03)
- **D-05:** Add `Buffer.isBuffer((req as any).rawBody)` guard before calling `stripe.webhooks.constructEvent()`. If rawBody is not a Buffer, return 400 with a clear error message before Stripe SDK is invoked.

### Duplicate Settings Route (QUOT-03)
- **D-06:** Keep `settings.routes.ts` as the canonical handler for `GET /api/settings` — it has the richer logic including `icon_url` from `landing_content`.
- **D-07:** Remove the `GET /api/settings` handler from `config.routes.ts` entirely. The `GET /api/config` handler in that file stays untouched.
- **D-08:** No new service layer — `icon_url` logic stays inline in `settings.routes.ts`.

### Quota Denial Reason (QUOT-02)
- **D-09:** In `server/quota.ts`, in the `subscription_overage` billing model branch where no active subscription exists, set `denialReason` to `"inactive_subscription"` instead of `"upgrade_required"`. Small targeted change only.

### Claude's Discretion
- Exact error message wording for invalid Bearer token (SEC-01 fix)
- Whether to add a JSDoc comment on the corrected `extractToken` explaining the prefix-check pattern

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auth Middleware (primary files for this phase)
- `server/middleware/auth.middleware.ts` — extractToken, authenticateUser, requireAuth, requireAdmin, requireAdminGuard — all touched in this phase
- `server/middleware/admin.middleware.ts` — adminOnly, withAdmin — uses requireAdminGuard, may be affected

### Routes with duplicate/fixed handlers
- `server/routes/config.routes.ts` — GET /api/config (keep) + GET /api/settings (remove)
- `server/routes/settings.routes.ts` — GET /api/settings canonical handler (keep and verify)
- `server/routes/stripe.routes.ts` — webhook rawBody validation fix

### Quota logic
- `server/quota.ts` — checkCredits, subscription_overage branch, denial_reason

### Shared types (for profile shape)
- `shared/schema.ts` — Profile type definition

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `authenticateUser()` in `auth.middleware.ts`: fully correct auth + profile fetch pattern — `requireAdmin` should mirror it for the profile part (D-04)
- `createAdminSupabase()`: already used in `authenticateUser` for reliable profile fetch — `requireAdmin` currently uses user-scoped client for profile fetch, which is inconsistent

### Established Patterns
- Token extraction: fix to `startsWith("Bearer ")` + `.slice(7)` — apply uniformly
- Profile fetch: always use `createAdminSupabase()` + `.maybeSingle()` — not `.single()` with user-scoped client
- `AuthenticatedRequest` interface already declares `user`, `supabase`, `profile` — `requireAdmin` just needs to populate all three

### Integration Points
- `requireAdmin` is used in `server/middleware/admin.middleware.ts` → `requireAdminGuard` is used inline in many route handlers — token fix must be propagated to all inline usages
- `config.routes.ts` is imported in `server/routes/index.ts` — removing the duplicate handler there is the correct surgery point

</code_context>

<specifics>
## Specific Ideas

No specific references — open to standard approaches within the decisions above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-security-auth-hardening*
*Context gathered: 2026-04-20*
