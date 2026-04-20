# Phase 1: Security & Auth Hardening - Research

**Researched:** 2026-04-20
**Domain:** Express middleware security, Bearer token extraction, Stripe webhook validation, Express route registration order
**Confidence:** HIGH

## Summary

All five bugs in this phase are small, surgical code corrections in existing server files. No new libraries are required. The bugs are fully understood from direct codebase inspection — the "research" value here is confirming exactly what broken code exists and what correct code looks like.

The biggest conceptual risk is the `extractToken` fix: `"Bearer token".replace("Bearer ", "")` has a subtle flaw — it uses string `replace()` which only requires the substring to exist anywhere, not at the start. A header like `"SomePrefix Bearer token"` would still partially work. More importantly, any string without the prefix passes through (minus zero characters), meaning a raw token with no prefix returns the full string and may appear valid to `supabase.auth.getUser()` until it isn't. The `startsWith` + `slice(7)` pattern is the correct guard.

The second conceptual anchor is Express route registration order. When two routers each register `GET /api/settings`, Express calls the first matching handler and stops (it calls `next()` only if the handler does so). `configRoutes` is mounted before `settingsRoutes` in `index.ts` (line 41 vs line 62), so the config.routes.ts handler wins today — which means the richer `settings.routes.ts` handler (with `icon_url`) is silently shadowed. Removing the handler from config.routes.ts is the minimal correct fix.

**Primary recommendation:** Apply five targeted edits — one per requirement — with no structural refactoring. Each edit is 1-10 lines. The correct patterns are already in the codebase; fixes bring the broken call sites into line with existing correct patterns.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Fix ALL call sites that use `.replace("Bearer ", "")` — not just `extractToken()`. This includes `requireAdminGuard()` inline on line 178 and the `requireAdmin` function itself. Use `startsWith("Bearer ")` prefix check + `.slice(7)` at every site.
- **D-02:** `extractToken()` signature change: accept `Request` (not `AuthenticatedRequest`) since it doesn't need the extended type — makes it usable anywhere.
- **D-03:** Minimal fix only — attach `req.profile` to the request inside `requireAdmin` after the admin check passes. Do NOT refactor to call `authenticateUser()` internally. DRY unification is out of scope for this bugfix phase.
- **D-04:** The profile fetch inside `requireAdmin` already fetches `select("is_admin")` — expand the select to `select("*")` so the full profile is available to attach as `req.profile`.
- **D-05:** Add `Buffer.isBuffer((req as any).rawBody)` guard before calling `stripe.webhooks.constructEvent()`. If rawBody is not a Buffer, return 400 with a clear error message before Stripe SDK is invoked.
- **D-06:** Keep `settings.routes.ts` as the canonical handler for `GET /api/settings` — it has the richer logic including `icon_url` from `landing_content`.
- **D-07:** Remove the `GET /api/settings` handler from `config.routes.ts` entirely. The `GET /api/config` handler in that file stays untouched.
- **D-08:** No new service layer — `icon_url` logic stays inline in `settings.routes.ts`.
- **D-09:** In `server/quota.ts`, in the `subscription_overage` billing model branch where no active subscription exists, set `denialReason` to `"inactive_subscription"` instead of `"upgrade_required"`. Small targeted change only.

### Claude's Discretion

- Exact error message wording for invalid Bearer token (SEC-01 fix)
- Whether to add a JSDoc comment on the corrected `extractToken` explaining the prefix-check pattern

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | Bearer token extraction uses `startsWith("Bearer ")` not string replace, rejecting malformed headers | Three call sites identified: `extractToken()` line 35, `requireAdmin` line 137, `requireAdminGuard` line 178. Pattern: `startsWith("Bearer ") ? header.slice(7) : null` |
| SEC-02 | `requireAdmin` middleware attaches `req.profile` to the request so downstream handlers can read it without errors | `requireAdmin` already attaches `req.user` and `req.supabase` but NOT `req.profile`. Fix: change `select("is_admin")` to `select("*")`, switch to admin Supabase client for fetch, attach full profile as `req.profile` |
| SEC-03 | Stripe webhook handler validates that `rawBody` is a Buffer before passing to signature verification | `stripe.routes.ts` line 26 passes `(req as any).rawBody` directly. Fix: add `Buffer.isBuffer()` guard before `constructEvent()`, return 400 if not a Buffer |
| QUOT-02 | `checkCredits` returns `"inactive_subscription"` denial reason for inactive subscriptions in `subscription_overage` mode | `quota.ts` line 414 sets `"upgrade_required"` when `!hasActiveSubscription`. Change to `"inactive_subscription"`. The union type in `CreditStatus` already includes `"inactive_subscription"` |
| QUOT-03 | Duplicate `GET /api/settings` route is consolidated into one handler that includes icon URL from `landing_content` | `config.routes.ts` defines duplicate `GET /api/settings` at line 43. It is mounted BEFORE `settings.routes.ts` in index.ts (line 41 vs 62), so it wins today. Remove the handler from config.routes.ts |
</phase_requirements>

---

## Standard Stack

### Core (no new dependencies — all fixes are in-place edits)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express 5 | ^5.0.1 | Request/response/middleware | Already in use |
| @supabase/supabase-js | ^2.98.0 | Auth + database client | Already in use |
| stripe | ^20.4.0 | Webhook signature verification | Already in use |
| TypeScript | 5.6.3 | Type safety for req mutations | Already in use |

No new packages are needed. All five fixes use only existing dependencies.

**Installation:** None required.

---

## Architecture Patterns

### Pattern 1: Safe Bearer Token Extraction

**What:** Check prefix with `startsWith`, extract with `slice(7)` — never use `replace`.

**Why `replace` is wrong:** `"sometoken".replace("Bearer ", "")` returns `"sometoken"` unchanged — the malformed input passes through. `startsWith("Bearer ")` explicitly rejects anything without the exact prefix at position 0.

**Correct pattern:**
```typescript
// Source: direct codebase inspection + Express auth conventions
export function extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    if (!authHeader.startsWith("Bearer ")) return null;
    return authHeader.slice(7);
}
```

The `7` is `"Bearer ".length` — the space is part of the prefix.

**The three call sites to fix (all in `auth.middleware.ts`):**
1. `extractToken()` — line 35: `return authHeader.replace("Bearer ", "")` → replace with startsWith+slice pattern
2. `requireAdmin()` — line 137: calls `extractToken(req)` which will be fixed by fixing extractToken
3. `requireAdminGuard()` — line 178: `req.headers.authorization?.replace("Bearer ", "")` → inline startsWith+slice

Note: `requireAdmin` and `requireAdminGuard` call `extractToken` or inline the same logic. After fixing `extractToken`, `requireAdmin` is automatically fixed (it delegates to `extractToken`). Only `requireAdminGuard`'s inline usage at line 178 needs a separate edit.

### Pattern 2: req.profile Attachment in requireAdmin

**What:** After verifying admin status, fetch full profile with `select("*")` via admin Supabase client and attach as `req.profile`.

**Current bug:** `requireAdmin` (line 152-155) uses user-scoped `supabase` and `select("is_admin")` only — never attaches `req.profile`. Route handlers that follow `requireAdmin` and try to read `req.profile` crash with undefined.

**Correct pattern (mirrors `authenticateUser` at line 68-73):**
```typescript
// Source: authenticateUser() in auth.middleware.ts — existing correct pattern
const adminSb = createAdminSupabase();
const { data: profile } = await adminSb
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

if (!profile?.is_admin) {
    res.status(403).json({ message: "Admin access required" });
    return;
}

(req as any).user = user;
(req as any).supabase = supabase;
(req as any).profile = profile;  // ADD THIS
```

Key detail: use `createAdminSupabase()` (not user-scoped `supabase`) for the profile fetch. The user-scoped client respects RLS which may block `profiles` reads depending on policy configuration. `authenticateUser` already follows this pattern (line 68).

### Pattern 3: Stripe rawBody Buffer Guard

**What:** Stripe's `constructEvent` requires a raw Buffer (not parsed JSON) to verify the HMAC signature. If body-parser has already parsed the body as JSON, signature verification will fail with a misleading error. A missing rawBody (undefined or non-Buffer) should return 400 before calling the Stripe SDK.

**Correct pattern:**
```typescript
// Source: Stripe docs convention, direct code inspection
if (!Buffer.isBuffer((req as any).rawBody)) {
    res.status(400).json({ message: "Invalid webhook: raw body not available" });
    return;
}

let event;
try {
    event = stripe.webhooks.constructEvent(
        (req as any).rawBody,
        sig,
        webhookSecret,
    );
} catch (err: any) { ... }
```

The guard returns 400 (client error) not 500 — a missing rawBody indicates the request was not routed through the raw body parser middleware, which is a request configuration issue.

### Pattern 4: Express Route Registration Order — Duplicate Route Fix

**What:** When two routers register the same HTTP method + path, the first one registered wins. Express calls `next()` only if the handler explicitly invokes it. Normal route handlers send a response and do not call `next()`.

**Registration order in `server/routes/index.ts`:**
```
line 41: router.use(configRoutes);     // registers GET /api/settings (WRONG handler)
...
line 62: router.use(settingsRoutes);   // registers GET /api/settings (CORRECT handler) — never reached
```

**Fix:** Remove the `GET /api/settings` route block from `config.routes.ts` (lines 43-56). `GET /api/config` on line 32 stays untouched.

The canonical handler in `settings.routes.ts` is richer: it fetches `icon_url` from `landing_content` and merges it as `favicon_url`. The config.routes.ts version only reads from `app_settings` — missing the `icon_url` merge entirely.

### Pattern 5: Quota Denial Reason — Targeted String Change

**What:** In `quota.ts` line 414, the ternary that sets `denialReason` uses `"upgrade_required"` when `!hasActiveSubscription`. The `CreditStatus` interface already declares `"inactive_subscription"` as a valid union member (line 15).

**Correct pattern:**
```typescript
// quota.ts line 414 — before
const denialReason = !hasActiveSubscription
  ? "upgrade_required"
  : budgetBlocked
    ? "usage_budget_reached"
    : null;

// after
const denialReason = !hasActiveSubscription
  ? "inactive_subscription"
  : budgetBlocked
    ? "usage_budget_reached"
    : null;
```

This is a one-word change. The type system already allows it — no schema changes needed.

### Anti-Patterns to Avoid

- **Using `replace()` for prefix stripping:** Fails silently on inputs that don't contain the prefix — returns the original string instead of null.
- **Using `.single()` instead of `.maybeSingle()` for profile fetch:** `.single()` throws if zero rows are returned; `.maybeSingle()` returns null. Use `.maybeSingle()` everywhere for profile queries (pattern established by `authenticateUser`).
- **Using user-scoped Supabase client for admin profile fetch:** User client is subject to RLS. Admin client bypasses RLS and is the correct choice when identity has already been verified.
- **Passing undefined/non-Buffer rawBody to Stripe:** Produces a cryptic signature mismatch error. The 400 guard surfaces the real problem clearly.
- **Removing `GET /api/config` instead of `GET /api/settings` from config.routes.ts:** The `/api/config` route is different and must be preserved — it returns Supabase URL + anon key.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Buffer detection | Custom type checks | `Buffer.isBuffer()` | Native Node.js API, handles all Buffer subclasses |
| Stripe signature verification | Custom HMAC | `stripe.webhooks.constructEvent()` | Already in use, timing-safe comparison built in |

---

## Common Pitfalls

### Pitfall 1: Fixing extractToken but missing requireAdminGuard inline usage
**What goes wrong:** The inline `req.headers.authorization?.replace("Bearer ", "")` at line 178 in `requireAdminGuard` is a separate copy of the broken logic — it does not call `extractToken`. Fixing only `extractToken` leaves this call site broken.
**Why it happens:** Copy-paste between functions that each do their own token extraction.
**How to avoid:** Search for all occurrences of `.replace("Bearer ", "")` in `auth.middleware.ts` before marking SEC-01 complete. There are exactly two: line 35 (in extractToken) and line 178 (in requireAdminGuard).
**Warning signs:** `requireAdminGuard` test still accepts malformed headers after the fix.

### Pitfall 2: requireAdmin using wrong Supabase client for profile fetch
**What goes wrong:** Current `requireAdmin` uses `supabase` (user-scoped, line 144) to fetch the profile. RLS policies on `profiles` may silently return no data for user reads, making the admin check pass vacuously (`profile?.is_admin` is undefined → falsy → 403 every time, or in some policy configurations, returns data only for the user's own row which is fine but inconsistent).
**Why it happens:** `requireAdmin` was written before the `createAdminSupabase()` pattern was established.
**How to avoid:** D-04 says expand select to `select("*")` — also switch to `createAdminSupabase()` per the established pattern in `authenticateUser`.
**Warning signs:** Admin routes return 403 for valid admin users after the fix (indicates the user-scoped client still can't read the row).

### Pitfall 3: Stripe guard placed after constructEvent call
**What goes wrong:** Placing `Buffer.isBuffer()` check inside the catch block instead of before the try block. The Stripe SDK may throw a different error than expected when rawBody is undefined.
**How to avoid:** The guard must be a pre-flight check BEFORE the try/catch block, returning 400 immediately.

### Pitfall 4: Removing the wrong route from config.routes.ts
**What goes wrong:** Accidentally removing `GET /api/config` (Supabase credentials endpoint) instead of `GET /api/settings`. Client-side Supabase initialization would break silently.
**How to avoid:** The handler to remove starts at line 43 with `router.get("/api/settings"`. The handler to keep is `router.get("/api/config"` at line 32.

### Pitfall 5: Forgetting that extractToken signature change affects callers
**What goes wrong:** D-02 changes `extractToken` parameter from `AuthenticatedRequest` to `Request`. Both `requireAdmin` and callers pass `req` which may be typed as `AuthenticatedRequest` — this is fine because `AuthenticatedRequest extends Request`. TypeScript will accept the narrower type where `Request` is expected.
**How to avoid:** No caller changes needed. The signature relaxation is backward compatible.

---

## Code Examples

### SEC-01: Corrected extractToken

```typescript
// Source: auth.middleware.ts — corrected version
export function extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    if (!authHeader.startsWith("Bearer ")) return null;
    return authHeader.slice(7);
}
```

### SEC-01: Corrected requireAdminGuard inline extraction (line 178)

```typescript
// Before (line 178 in auth.middleware.ts):
const token = req.headers.authorization?.replace("Bearer ", "");

// After:
const authHeader = req.headers.authorization;
const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
```

### SEC-02: requireAdmin — profile attachment addition

```typescript
// auth.middleware.ts — requireAdmin, after admin check passes
// Change: select("is_admin") → select("*"), use adminSb, attach req.profile

const adminSb = createAdminSupabase();
const { data: profile } = await adminSb
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

if (!profile?.is_admin) {
    res.status(403).json({ message: "Admin access required" });
    return;
}

(req as any).user = user;
(req as any).supabase = supabase;
(req as any).profile = profile;  // newly added

next();
```

### SEC-03: Stripe rawBody guard

```typescript
// stripe.routes.ts — before constructEvent
if (!Buffer.isBuffer((req as any).rawBody)) {
    res.status(400).json({ message: "Invalid webhook: raw body not available as Buffer" });
    return;
}
```

### QUOT-02: Denial reason change

```typescript
// quota.ts line 414 — single word change
const denialReason = !hasActiveSubscription
  ? "inactive_subscription"     // was "upgrade_required"
  : budgetBlocked
    ? "usage_budget_reached"
    : null;
```

### QUOT-03: Remove handler from config.routes.ts

Delete lines 43-56 of config.routes.ts (the entire `router.get("/api/settings", ...)` block). The file retains only `router.get("/api/config", ...)` and its supporting `getLatestAppSettingsRow` helper can be removed too if no longer referenced.

---

## Runtime State Inventory

Not applicable — this is a code-only bugfix phase with no renamed identifiers, no database schema changes, and no string replacements that affect stored data.

---

## Environment Availability

Step 2.6: SKIPPED — phase is purely code corrections with no external dependencies beyond the existing running stack.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected |
| Config file | None — no jest.config.*, vitest.config.*, or pytest.ini in project root or server/ |
| Quick run command | `npm run check` (TypeScript type check — fastest available verification) |
| Full suite command | `npm run check` (same — no test runner configured) |

No test files exist under `server/` or `client/src/`. Only node_modules contain test files.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | Malformed Authorization header returns 401 | unit | `npm run check` (type only) | ❌ Wave 0 |
| SEC-02 | Admin handler can read `req.profile` without crash | unit | `npm run check` (type only) | ❌ Wave 0 |
| SEC-03 | Non-Buffer rawBody rejected before Stripe SDK | unit | `npm run check` (type only) | ❌ Wave 0 |
| QUOT-02 | Inactive subscription returns `"inactive_subscription"` denial | unit | `npm run check` (type only) | ❌ Wave 0 |
| QUOT-03 | `GET /api/settings` returns single response with icon_url | smoke | manual curl test | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run check` — TypeScript must compile clean
- **Per wave merge:** `npm run check`
- **Phase gate:** TypeScript clean + manual smoke test of `GET /api/settings` response shape

### Wave 0 Gaps

No test framework is installed. For this phase (5 small targeted edits), the verification strategy is:

- [ ] TypeScript compilation (`npm run check`) passes after each edit — covers type correctness of all changes
- [ ] Manual smoke: `curl -H "Authorization: invalid" http://localhost:8888/api/generate` returns 401 (not 500)
- [ ] Manual smoke: `curl http://localhost:8888/api/settings` returns JSON including `favicon_url` field

Installing a test framework (vitest or jest) is out of scope for Phase 1 per the phase boundary (surgical corrections only). The planner should note that TypeScript compilation is the primary automated gate for this phase.

---

## Open Questions

1. **requireAdmin: should the user-scoped `supabase` variable still be attached to req?**
   - What we know: current code attaches `req.supabase = supabase` (user-scoped). D-03 says minimal fix only.
   - What's unclear: downstream handlers after `requireAdmin` — do they use `req.supabase` or `createAdminSupabase()` directly?
   - Recommendation: Keep attaching the user-scoped `req.supabase` (no change to that line). D-04 only adds `req.profile`. Don't change what already works.

2. **requireAdminGuard: should it also return the full profile?**
   - What we know: `requireAdminGuard` returns `{ userId: string }` only. It is used by `admin.middleware.ts` (`adminOnly`, `withAdmin`) which only expose `adminUserId` on the request.
   - What's unclear: whether any admin route handler tries to read `req.profile` after going through `adminOnly`/`withAdmin` vs `requireAdmin`.
   - Recommendation: Out of scope per D-03. `requireAdminGuard` fix is only the token extraction (SEC-01). Profile attachment is only for `requireAdmin` (SEC-02).

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection: `server/middleware/auth.middleware.ts` — all three broken token extraction sites confirmed
- Direct codebase inspection: `server/routes/index.ts` — configRoutes mounted line 41, settingsRoutes line 62, confirming registration order
- Direct codebase inspection: `server/routes/config.routes.ts` — duplicate `GET /api/settings` at line 43 confirmed
- Direct codebase inspection: `server/quota.ts` — `"upgrade_required"` at line 415 confirmed; `"inactive_subscription"` in union type at line 15 confirmed
- Direct codebase inspection: `server/routes/stripe.routes.ts` — no Buffer guard before `constructEvent` at line 26 confirmed
- Node.js docs: `Buffer.isBuffer()` — standard Node.js API for Buffer type detection (HIGH, stable API)

### Secondary (MEDIUM confidence)

- Express routing behavior (first-match wins, no implicit `next()`) — well-established Express convention, confirmed by route code structure

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new libraries, all in-place edits
- Architecture: HIGH — bugs confirmed by direct code inspection, correct patterns confirmed from existing correct code in same codebase
- Pitfalls: HIGH — derived from exact line numbers in existing code, not speculation

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable codebase, no fast-moving dependencies involved)
