# Concerns & Technical Debt

**Analysis Date:** 2026-04-06

## Security Concerns

**Token extracted with naive string replace:**
- Issue: `authHeader.replace("Bearer ", "")` in `server/middleware/auth.middleware.ts:35` will silently pass malformed headers if the prefix casing differs or has extra spaces.
- Impact: Low — Supabase `getUser(token)` will reject invalid tokens, but the extraction is fragile.
- Fix: Use `authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null`.

**`createAdminSupabase()` called from 24 files — service-role key used broadly:**
- Issue: 116 call-sites across the codebase reach for the service-role client, bypassing RLS for nearly every operation. Files: `server/quota.ts`, `server/stripe.ts`, `server/routes/billing.routes.ts`, `server/routes/integrations.routes.ts`, etc.
- Impact: Any logic bug in these paths operates with full DB access. No RLS safety net for accidental over-fetching.
- Fix: Prefer `createServerSupabase(token)` wherever the user token is available; reserve admin client for explicit admin-only operations.

**Telegram signup notification called from client auth context:**
- Issue: `client/src/lib/auth.tsx:160` calls `/api/telegram/notify-signup` via `void` (fire-and-forget) on every `onAuthStateChange` event, not only on new signups.
- Impact: Could spam Telegram on token refresh or repeated logins.
- Fix: Gate the call on `event === 'SIGNED_IN'` and track a "notified" flag in the profile.

**No rate limiting on generation, edit, or transcription endpoints:**
- Issue: `/api/generate`, `/api/edit-post`, `/api/transcribe` have no HTTP-level rate limiting. Only the in-memory `rateLimitMap` in `server/routes/translate.routes.ts` exists for the translation endpoint.
- Impact: Abuse of expensive AI endpoints is possible for any authenticated user with credits; for admin/affiliate users who use their own API key there is no spend cap.
- Fix: Add `express-rate-limit` middleware (already present in `script/build.ts` external list) on AI endpoints.

## Performance Concerns

**`createAdminSupabase()` instantiates a new Supabase client per call:**
- Issue: `server/supabase.ts:19` creates a fresh client on every invocation. With 116 call-sites and multiple per-request, this causes unnecessary object allocations and repeated auth config overhead.
- Fix: Module-level singleton for the admin client; keep the per-request pattern only for `createServerSupabase(token)`.

**`quota.ts` makes 4–8 sequential DB round trips per generation request:**
- Issue: `checkCredits` calls `usesOwnApiKey` (1 query), `estimateBaseCostMicros` (1 query), `ensureUserBillingProfile` (1–2 queries), `getMonthlyAdditionalUsageMicros` (1 query), `getPlatformSettingNumber` (multiple, partially cached at 60s TTL). This is 5–9 DB hits before AI work starts.
- Files: `server/quota.ts:334–473`
- Fix: Batch profile + credits in a single query; extend settings cache TTL or pre-warm at startup.

**`select("*")` on wide tables without column projection:**
- Issue: 33 instances across the server pull all columns (e.g. `profiles`, `brands`, `user_credits`, `user_billing_profiles`). Some tables (e.g. `brands` with logo base64 blob or long text fields) could return large payloads unnecessarily.
- Files: `server/quota.ts`, `server/routes/billing.routes.ts`, `server/routes/edit.routes.ts`, `server/routes/integrations.routes.ts`.
- Fix: Specify required columns explicitly.

**`getCurrentUtcMonthRange` duplicated in two files:**
- Issue: Identical function defined in `server/quota.ts:237` and `server/routes/billing.routes.ts:42`. Not a performance issue but creates drift risk.
- Fix: Extract to `server/utils/date.ts`.

## Code Quality Issues

**159 uses of `any` type across server code:**
- Most concentrated in `server/routes/admin.routes.ts` (38), `server/routes/integrations.routes.ts` (25), `server/services/user.service.ts` (8). Defeats TypeScript safety.
- Fix: Incrementally type these; start with the admin routes which handle the most business logic.

**`server/routes/admin.routes.ts` is 1837 lines — single file for all admin logic:**
- Handles analytics, user management, landing content, pricing, and settings. Extremely hard to navigate and test.
- Fix: Split into focused route modules (e.g. `admin-analytics.routes.ts`, `admin-users.routes.ts`).

**`server/stripe.ts` is 1029 lines with mixed concerns:**
- Mixes webhook handling, subscription management, auto-recharge, affiliate payout, and billing model config in one file.
- Fix: Split into `stripe-webhooks.ts`, `stripe-billing.ts`, `stripe-subscriptions.ts`.

**`buildTextFallback` in `generate.routes.ts` duplicates generation logic:**
- The fallback path at `server/routes/generate.routes.ts:90` re-implements content construction that overlaps with `gemini.service.ts`. Silent fallback on text generation failure means users get degraded results without explicit notice.
- Fix: Surface the fallback in the SSE progress event and track it in generation logs.

## Missing Error Handling

**No React Error Boundary in the client app:**
- Issue: No `ErrorBoundary` component exists anywhere in `client/src/`. An unhandled render error will crash the entire SPA with a blank screen.
- Fix: Wrap `<App>` or major route sections with an error boundary showing a recovery UI.

**`refreshProfile` and `refreshBrand` in `auth.tsx` silently discard errors:**
- `client/src/lib/auth.tsx:197–208` — both functions have no `catch` and no user-facing feedback on failure.
- Fix: Add error handling and surface stale-data warnings.

**SSE stream left open on unhandled rejection in generate route:**
- `server/routes/generate.routes.ts:714` has a top-level `catch` but `safetyTimer` is only cleared in the happy path and the catch block. If `sse.sendError` throws (e.g., because headers are already flushed), the timer may still fire.
- Fix: Use `finally` to always `clearTimeout(safetyTimer)`.

## Scalability Concerns

**In-memory rate limit map in translate route will not scale horizontally:**
- `server/routes/translate.routes.ts:19` — `Map<string, ...>` is process-local. On multi-instance deployments (Vercel serverless) each function instance has its own map, making the limit ineffective.
- Fix: Use Redis or Supabase-backed rate limiting.

**`settingsCache` in `quota.ts` is in-memory with 60s TTL:**
- `server/quota.ts:41` — same concern: each serverless instance has its own cache, causing redundant DB reads and inconsistent TTL behavior.
- Fix: Move to a shared cache layer or accept the extra DB reads as acceptable overhead.

**Post expiration cleanup is triggered per-user on edit, not on a schedule:**
- `server/routes/edit.routes.ts` calls `processStorageCleanup` inline per edit request. This couples cleanup latency to user-facing edit time and won't clean up inactive users' posts.
- Fix: Move to a scheduled cron job or Supabase Edge Function.

## Dependency Risks

**`passport` and `passport-local` installed but appear unused:**
- `package.json` lists `passport@0.7.0` and `passport-local@1.0.0`. The app uses Supabase Auth exclusively. Dead weight that widens the attack surface.
- Fix: Remove both packages and their `@types` counterparts.

**`connect-pg-simple`, `express-session`, and `memorystore` installed but Supabase Auth is used:**
- These session middleware packages (`package.json:54,62,79`) appear unused in favor of JWT-based Supabase Auth. They add ~150KB to the bundle and introduce session fixation surface if accidentally wired.
- Fix: Audit and remove.

**`@octokit/rest` in production dependencies:**
- `package.json:16` — GitHub API client in `dependencies` rather than `devDependencies`. If only used for release automation it should not ship to production.

## Priority Issues

**High:**
- Add React Error Boundary to prevent full-app crashes.
- Add rate limiting to `/api/generate`, `/api/edit-post`, `/api/transcribe`.
- Fix SSE `safetyTimer` cleanup to use `finally` block.

**Medium:**
- Singleton `createAdminSupabase()` client to reduce allocations.
- Gate Telegram signup notification to actual new signups only.
- Remove unused `passport`, `express-session`, `connect-pg-simple`, `memorystore` packages.
- Split `admin.routes.ts` (1837 lines) into focused modules.

**Low:**
- Replace `any` types incrementally, starting with `admin.routes.ts`.
- Deduplicate `getCurrentUtcMonthRange` into a shared utility.
- Move `select("*")` calls to explicit column projections.
- Relocate `@octokit/rest` to `devDependencies`.

---

*Concerns audit: 2026-04-06*
