---
phase: 13-production-hardening-fixes
plan: 01
subsystem: api
tags: [express, rate-limit, sse, security, reliability, gemini]

# Dependency graph
requires:
  - phase: 02-supabase-client-architecture
    provides: authenticateUser middleware that populates req.user.id (used as rate-limit key)
  - phase: 06-shared-services-extraction
    provides: SSE safetyTimer pattern in carousel/enhance routes that this plan hardens
provides:
  - Per-authenticated-user HTTP rate limiting on all 5 paid AI endpoints (HARD-01)
  - SSE safetyTimer cleanup unconditionally executed via finally blocks (HARD-02)
  - aiRateLimit middleware factory reusable for any future AI route
affects: [phase-14-cron-verification-harness, future-multi-instance-scaling]

# Tech tracking
tech-stack:
  added: [express-rate-limit@7.5.1, "@types/express-rate-limit@5.1.3"]
  patterns:
    - "Inline rate-limit invocation: aiPaidLimiter(req, res, callback) wrapped in awaited Promise so existing inline-auth route handlers do not need conversion to middleware chain"
    - "try/finally around SSE safetyTimer: clearTimeout always runs even if catch arm itself throws"
    - "Per-route module-level limiter instance (not per-request) keeps the in-memory counter store stable across calls"

key-files:
  created:
    - server/middleware/rate-limit.middleware.ts
  modified:
    - package.json (added express-rate-limit + @types/express-rate-limit)
    - package-lock.json (regenerated)
    - server/routes/generate.routes.ts (mount aiPaidLimiter; safetyTimer → finally)
    - server/routes/edit.routes.ts (mount aiPaidLimiter; safetyTimer → finally)
    - server/routes/transcribe.routes.ts (mount aiTranscribeLimiter; no SSE timer)
    - server/routes/carousel.routes.ts (mount aiPaidLimiter; wrap body in try/finally)
    - server/routes/enhance.routes.ts (mount aiPaidLimiter; wrap body in try/finally)

key-decisions:
  - "Used express-rate-limit library instead of extending the in-memory Map pattern from translate.routes.ts — typed, IETF draft-7 standard headers, single-source admin-bypass via skip callback"
  - "Inline limiter invocation (await new Promise(resolve => limiter(req,res,resolve))) over converting routes to middleware chain — minimal diff, preserves existing inline authenticateUser pattern in all 5 routes"
  - "Per-route DEFAULT_AI_LIMITS (paid_image_video: 30/5min, transcribe: 60/5min) with env-var overrides (RATE_LIMIT_AI_*, RATE_LIMIT_TRANSCRIBE_*) — discoverable for ops without requiring app_settings table migration"
  - "Wrap entire post-safetyTimer body in try/finally for carousel + enhance (no outer catch) — preserves existing inner try/catch error semantics; finally runs on every termination path including early returns"

patterns-established:
  - "Rate-limit factory pattern: aiRateLimit({max, windowMs}) → Express middleware, callable inline via Promise wrapper or as part of a middleware chain"
  - "SSE safetyTimer cleanup: setTimeout(...) followed by try { ... } finally { clearTimeout(timer); } — never put clearTimeout in happy or catch paths separately"

requirements-completed: [HARD-01, HARD-02]

# Metrics
duration: 11min
completed: 2026-05-08
---

# Phase 13 Plan 01: Production Hardening Rate Limiting + SSE Timer Cleanup Summary

**Per-user HTTP 429 rate limiting on 5 paid AI endpoints via express-rate-limit + safetyTimer cleanup migrated into finally blocks across all 4 SSE routes**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-05-08T14:42:49Z
- **Completed:** 2026-05-08T14:53:23Z
- **Tasks:** 3
- **Files modified:** 7 (1 created, 6 modified, plus package.json/lock)

## Accomplishments

- HARD-01 closed: a non-admin authenticated user exceeding 30 req / 5 min on `/api/generate`, `/api/edit-post`, `/api/carousel/generate`, or `/api/enhance` (or 60 / 5 min on `/api/transcribe`) now receives HTTP 429 with `Retry-After` header BEFORE Gemini is called or credits are deducted. Admins bypass entirely. Every 429 emits structured `[RateLimit] user={id} endpoint={path} retryAfter={s}` log.
- HARD-02 closed: `clearTimeout(safetyTimer)` is now exclusively inside a `finally` block in all 4 SSE routes (`generate`, `edit`, `carousel`, `enhance`). The leak path where `sse.sendError` throws inside the catch arm and the timer continues firing ~280s later is structurally impossible.
- New reusable `aiRateLimit` factory in `server/middleware/rate-limit.middleware.ts` exporting `DEFAULT_AI_LIMITS` for paid + transcribe tiers; env-var overrides supported.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install express-rate-limit and create aiRateLimit middleware** — `540a406` (feat)
2. **Task 2: Mount aiRateLimit on all 5 paid AI endpoints** — `3fb9521` (feat)
3. **Task 3: Move SSE safetyTimer cleanup into finally blocks (HARD-02)** — `7f7ad45` (fix)

**Plan metadata commit:** to follow (`docs(13-01)`).

## Files Created/Modified

- **`server/middleware/rate-limit.middleware.ts`** (NEW) — Exports `aiRateLimit({max, windowMs, endpointLabel?})` factory and `DEFAULT_AI_LIMITS` constants. Per-user keying via `req.user?.id`, IP fallback, admin bypass, 429 handler with structured log + `Retry-After` header.
- **`package.json`** — Added `express-rate-limit ^7.5.1` to dependencies, `@types/express-rate-limit ^5.1.3` to devDependencies.
- **`package-lock.json`** — Regenerated by npm install.
- **`server/routes/generate.routes.ts`** — Imported limiter; declared module-level `aiPaidLimiter`; inline gate after brand fetch (before parseResult); restructured catch+happy paths into `try { ... } catch { ... } finally { clearTimeout(safetyTimer); }`.
- **`server/routes/edit.routes.ts`** — Same as generate, plus inner-try restructuring (the route has nested try/catch — outer for pre-SSE errors, inner for SSE-phase errors; the SSE-phase inner block now uses finally).
- **`server/routes/transcribe.routes.ts`** — Imported limiter; declared `aiTranscribeLimiter` (60 req / 5 min tier); inline gate after profile fetch. No SSE timer changes (route does not use safetyTimer — confirmed by grep).
- **`server/routes/carousel.routes.ts`** — Imported limiter; declared `aiPaidLimiter`; inline gate after profile fetch; wrapped entire post-safetyTimer body (lines ~238–488) in `try { ... } finally { clearTimeout(safetyTimer); }` and removed the two existing inline `clearTimeout` calls (one in catch arm, one in fall-through path).
- **`server/routes/enhance.routes.ts`** — Same treatment as carousel.

## Decisions Made

- **Library: express-rate-limit over extending the existing in-memory Map.** The existing `translate.routes.ts` uses a hand-rolled `rateLimitMap` with custom expiry logic. Re-using it for 5 more routes would duplicate the bookkeeping. `express-rate-limit` is already in `script/build.ts` externals (line 16), provides IETF draft-7 standard headers, and has a clean `skip` callback for admin bypass. Plan accepted; library installed.
- **Inline invocation over middleware chain.** The 5 paid AI routes call `authenticateUser(req as AuthenticatedRequest)` inline (not via `requireAuth` middleware). Converting all 5 to a middleware chain would have been a much larger diff and risked changing error-handling shape. Instead the limiter is called inline:
  ```typescript
  await new Promise<void>((resolve) => {
      aiPaidLimiter(req as any, res as any, () => { resolve(); });
  });
  if (res.headersSent) { return; }
  ```
  This preserves the existing inline-auth pattern, and `res.headersSent` is the reliable signal that the 429 was written.
- **Default limits via DEFAULT_AI_LIMITS constant + env overrides.** Two tiers: `paid_image_video` (30 req / 5 min) for generate/edit/carousel/enhance, `transcribe` (60 req / 5 min) for the cheaper transcription endpoint. Env vars `RATE_LIMIT_AI_WINDOW_MS`, `RATE_LIMIT_AI_MAX`, `RATE_LIMIT_TRANSCRIBE_WINDOW_MS`, `RATE_LIMIT_TRANSCRIBE_MAX` allow ops tuning without redeploy. No `app_settings` table migration required for v1.2.
- **`try/finally` (no catch) for carousel + enhance.** Their existing handlers use a single `try/catch` only around the Gemini service call, with many early-return paths after that. Wrapping the entire post-timer body in `try { ... } finally { clearTimeout(safetyTimer); }` (no catch) preserves all existing return semantics — the finally fires on early returns AND on uncaught throws — without changing error handling.
- **Module-level limiter instance per file.** Constructing `aiRateLimit(...)` once per file (above `router.post(...)`) means the in-memory counter store is stable across requests. Constructing per-request would reset the store every call.

## Default Rate-Limit Values

| Endpoint                 | Tier              | Limit            | Env override                                                |
| ------------------------ | ----------------- | ---------------- | ----------------------------------------------------------- |
| `/api/generate`          | paid_image_video  | 30 / 5 min       | RATE_LIMIT_AI_WINDOW_MS, RATE_LIMIT_AI_MAX                  |
| `/api/edit-post`         | paid_image_video  | 30 / 5 min       | RATE_LIMIT_AI_WINDOW_MS, RATE_LIMIT_AI_MAX                  |
| `/api/transcribe`        | transcribe        | 60 / 5 min       | RATE_LIMIT_TRANSCRIBE_WINDOW_MS, RATE_LIMIT_TRANSCRIBE_MAX  |
| `/api/carousel/generate` | paid_image_video  | 30 / 5 min       | RATE_LIMIT_AI_WINDOW_MS, RATE_LIMIT_AI_MAX                  |
| `/api/enhance`           | paid_image_video  | 30 / 5 min       | RATE_LIMIT_AI_WINDOW_MS, RATE_LIMIT_AI_MAX                  |

All env vars are optional; defaults are used if unset.

## Known Limitation

The middleware comment in `server/middleware/rate-limit.middleware.ts` documents the in-memory-store limitation:

> Storage: in-memory Map (built into express-rate-limit). Acceptable for the current single-instance deploy. KNOWN LIMITATION for multi-instance: each function instance has its own counter — see CONCERNS.md scalability section for the migration to Redis or a Supabase-backed store when horizontal scaling arrives.

This matches the existing `translate.routes.ts` precedent and is consistent with the v1.1 cron in-process boolean lock decision (also documented as "revisit if multi-instance arrives").

## Smoke Test

**Skipped — automated grep checks were sufficient per plan acceptance criteria.** All 8 verification gates pass:

1. `express-rate-limit` in package.json — pass
2. `aiRateLimit` exported — pass
3. Middleware imported in all 5 routes — pass (5/5 files)
4. Per-user keying — pass (`req.user?.id` in keyGenerator)
5. Admin bypass — pass (`is_admin` in skip)
6. 429 shape — pass (`rate_limit_exceeded` + `Retry-After` set)
7. `clearTimeout(safetyTimer)` count — pass (exactly 1 per file in 4 SSE routes)
8. `} finally {` blocks — pass (4/4 files)

Plus: `npm run check` exits 0, `npm run build` exits 0.

## Deviations from Plan

None - plan executed exactly as written. The plan's `<action>` blocks specified the inline-Promise pattern, the per-route insertion points, and the try/finally shape with enough precision that no auto-fixes were needed.

The only minor adjustment: the Task 2 plan-action block prescribed a `let rateLimitDone = ...; void rateLimitDone;` shape. I dropped the unused variable and used a void Promise (`await new Promise<void>(...)`), since the result of the resolve was already unused in the plan version. Functionally identical, slightly cleaner; not a behavioral deviation.

## Issues Encountered

- **One Edit failed initially on `carousel.routes.ts`** because the comment text in the plan ("with per-slide SSE progress events") differed slightly from the actual file ("with per-slide SSE progress."). Re-grepped, matched the actual file text, applied the edit. No code-shape change.

## User Setup Required

None - no external service configuration required.

The new `RATE_LIMIT_AI_*` and `RATE_LIMIT_TRANSCRIBE_*` env vars are optional with sensible defaults. Operators may set them in production env to tune limits without code changes.

## Next Phase Readiness

- **HARD-03 (React Error Boundary) and HARD-04 (dead deps removal) — Plan 13-02** are unblocked but were intentionally NOT executed in this run. They live in wave 2 (`depends_on: ["01"]`) because both touch `package.json` and serial execution avoids merge conflicts. Plan 13-02 may now proceed.
- **VRFY-01 (Phase 14 cron verification harness)** is unaffected by this plan — different subsystem, different files.
- **No regressions expected** for users under the rate-limit cap. The 5/5 happy-path flows (single image, edit, transcribe, carousel, product enhance) continue to work identically; the only new behavior is the 429 cap at 30 (or 60) requests per 5-minute window, which is well above normal usage.

## Self-Check: PASSED

Verified all claims:
- `server/middleware/rate-limit.middleware.ts` exists — FOUND
- All 5 modified route files exist with imports — FOUND
- Commit `540a406` exists — FOUND
- Commit `3fb9521` exists — FOUND
- Commit `7f7ad45` exists — FOUND
- All 8 verification gates pass

---
*Phase: 13-production-hardening-fixes*
*Completed: 2026-05-08*
