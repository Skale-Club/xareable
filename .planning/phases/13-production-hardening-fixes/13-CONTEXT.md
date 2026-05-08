# Phase 13: Production Hardening Fixes - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Direct authoring from REQUIREMENTS.md HARD-01..04 + CONCERNS.md citations

<domain>
## Phase Boundary

Four independent production-code gaps documented in [.planning/codebase/CONCERNS.md](.planning/codebase/CONCERNS.md). All four are mechanical fixes — no new architecture, no domain decisions. Each is independently shippable; they share no code paths.

**In scope (4 fixes):**
1. Per-user rate limiting on 5 paid AI endpoints (HARD-01)
2. SSE `safetyTimer` cleanup migrated from happy/catch paths into `finally` (HARD-02)
3. React Error Boundary wrapping app root with recovery UI (HARD-03)
4. Removal of unused middleware packages and `@octokit/rest` relocation to devDeps (HARD-04)

**Out of scope:**
- Live integration testing with real Stripe/Gemini/GA4/Facebook test creds (deferred — SEED-002)
- Test coverage of cron jobs (deferred to Phase 14 — VRFY-01)
- Anything that requires user product input

</domain>

<decisions>
## Implementation Decisions

### HARD-01: Rate limiting on AI endpoints

- **Library:** `express-rate-limit` (already in `script/build.ts` externals list — not yet in `package.json`; needs `npm install express-rate-limit @types/express-rate-limit`)
- **Scope:** mount middleware on these 5 routes (in `server/routes/`):
  - `POST /api/generate` (in `generate.routes.ts`)
  - `POST /api/edit-post` (in `edit.routes.ts`)
  - `POST /api/transcribe` (in `transcribe.routes.ts`)
  - `POST /api/carousel/generate` (in `carousel.routes.ts`)
  - `POST /api/enhance` (in `enhance.routes.ts`)
- **Key strategy:** per-authenticated-user, NOT per-IP. The `keyGenerator` function MUST extract `req.user.id` (added by `authenticateUser` middleware) so users behind shared NAT don't collectively get throttled. Anonymous fallback to IP for safety.
- **Limits:** read from `app_settings` table with sensible defaults if missing. Suggested defaults (configurable):
  - `/api/generate` + `/api/edit-post` + `/api/carousel/generate` + `/api/enhance`: 30 requests / 5 minutes
  - `/api/transcribe`: 60 requests / 5 minutes (cheaper)
- **Response:** HTTP 429 with `Retry-After` header (seconds until window reset). Body: `{ error: "rate_limit_exceeded", retry_after_seconds: N }`.
- **Storage:** in-memory `Map` is acceptable for single-instance deploys (matches existing `translate.routes.ts:19` precedent). Note as known limitation in code comment for future multi-instance migration. Do NOT block this fix on Redis/distributed-store work.
- **Mount order:** rate-limit middleware mounts AFTER `authenticateUser` (so we can key by user ID) but BEFORE the route handler.
- **Bypass:** admin users (`profile.is_admin === true`) bypass the limit. Implement via `skip` callback in the limiter config.
- **Logging:** every 429 response logs `[RateLimit] user={id} endpoint={path} retryAfter={s}` for ops visibility.

### HARD-02: SSE safetyTimer in finally

- **File:** `server/routes/generate.routes.ts` (current `clearTimeout(safetyTimer)` calls at lines ~705 and ~719 — happy path and catch path).
- **Change:** wrap the entire post-`safetyTimer = setTimeout(...)` block in `try { ... } finally { clearTimeout(safetyTimer); }` so it runs unconditionally — even when `sse.sendError()` itself throws (which is the leak scenario flagged in CONCERNS.md:75-77).
- **Pattern:**
  ```typescript
  const safetyTimer = setTimeout(() => { /* ... */ }, 260_000);
  try {
    // existing try/catch body
  } finally {
    clearTimeout(safetyTimer);
  }
  ```
- **Acceptance:** force `sse.sendError` to throw (e.g., monkey-patch in a test) → confirm `safetyTimer` no longer fires. Or: count active timeouts via `process._getActiveHandles()` before/after a forced-error generation.
- **Cross-check:** apply same pattern to `server/routes/carousel.routes.ts` and `server/routes/enhance.routes.ts` if they use a similar `safetyTimer`. Verify each by grep.

### HARD-03: React Error Boundary

- **File:** create `client/src/components/error-boundary.tsx`. Class component (functional ErrorBoundary not supported by React without `react-error-boundary` library — use class to avoid new dep).
- **Wrap location:** in `client/src/App.tsx`, wrap `<AppContent />` (or the outermost layout component). Single boundary at app root is sufficient for v1.2 — per-route boundaries deferred.
- **Recovery UI:**
  - Heading: "Something went wrong"
  - Subtext: brief, non-technical
  - Primary action: "Retry" button → calls `window.location.reload()` (simple, reliable)
  - Secondary action: "Go home" → navigates to `/`
  - Optional: collapsed `<details>` showing error message + stack (hidden by default, helps debugging without scaring users)
- **Logging:** in `componentDidCatch`, console.error the error + `errorInfo.componentStack`. Future enhancement (deferred): forward to telemetry — but for now, console is enough since we have no telemetry pipeline.
- **i18n:** translation keys for the recovery UI strings (English source + PT/ES via existing dynamic translation system).
- **Styling:** match existing app styling (Tailwind, shadcn). Centered card, mid-page.

### HARD-04: Dead dependency removal

- **Remove from `package.json` `dependencies`:**
  - `passport@0.7.0`
  - `passport-local@1.0.0`
  - `express-session@1.18.1`
  - `connect-pg-simple@10.0.0`
  - `memorystore@1.6.7`
- **Remove from `package.json` `devDependencies`:**
  - `@types/passport`
  - `@types/passport-local`
  - `@types/express-session`
  - `@types/connect-pg-simple`
  - any other matching `@types/<dead-package>` (verify with grep)
- **Move from `dependencies` to `devDependencies`:**
  - `@octokit/rest@22.0.0` (only used by release automation scripts, not by server runtime)
- **Verification gates (all MUST pass after removal):**
  1. `npm install` succeeds without errors or warnings about missing peers
  2. `grep -rn "import.*passport\|require.*passport\|from ['\"]passport" server client shared` returns 0 hits
  3. `grep -rn "express-session\|connect-pg-simple\|memorystore" server client shared --include="*.ts" --include="*.tsx"` returns 0 hits (excluding package.json + lock files + this CONTEXT)
  4. `npm run check` exits 0
  5. `npm run build` exits 0
  6. `npm run dev` boots the server without runtime errors (briefly — kill after boot log)
- **If any verification gate fails:** the package was actually being used somewhere. Restore that package and document the dependency in a comment explaining why it stays.

### Claude's Discretion
- Whether to write rate-limit defaults into `app_settings` migration or use env-var fallback (both acceptable; env-var is simpler, settings-table is more discoverable for ops)
- Specific class name and component structure for ErrorBoundary (any reasonable React class component works)
- Translation key names (just be consistent with existing patterns)

</decisions>

<canonical_refs>
## Canonical References

### Source of truth for the gaps
- [.planning/codebase/CONCERNS.md](.planning/codebase/CONCERNS.md) — original audit document. HARD-01 cited at lines 22-25 (rate limiting), HARD-02 at lines 75-77 (SSE timer), HARD-03 at lines 67-69 (Error Boundary), HARD-04 at lines 95-103 (dead deps).

### Files to modify

**HARD-01 — Rate limiting:**
- [server/routes/generate.routes.ts](server/routes/generate.routes.ts) — `POST /api/generate`
- [server/routes/edit.routes.ts](server/routes/edit.routes.ts) — `POST /api/edit-post`
- [server/routes/transcribe.routes.ts](server/routes/transcribe.routes.ts) — `POST /api/transcribe`
- [server/routes/carousel.routes.ts](server/routes/carousel.routes.ts) — `POST /api/carousel/generate`
- [server/routes/enhance.routes.ts](server/routes/enhance.routes.ts) — `POST /api/enhance`
- [server/middleware/auth.middleware.ts](server/middleware/auth.middleware.ts) — confirms `req.user.id` shape after authenticateUser
- [server/routes/translate.routes.ts:19](server/routes/translate.routes.ts) — existing in-memory rate-limit Map pattern (precedent reference, NOT to copy verbatim — use `express-rate-limit` library instead)
- [package.json](package.json) — add `express-rate-limit` dependency
- [script/build.ts](script/build.ts) — `express-rate-limit` already in externals list

**HARD-02 — SSE timer fix:**
- [server/routes/generate.routes.ts](server/routes/generate.routes.ts) — primary fix (lines ~705 and ~719)
- [server/routes/carousel.routes.ts](server/routes/carousel.routes.ts) — apply same pattern if `safetyTimer` exists there
- [server/routes/enhance.routes.ts](server/routes/enhance.routes.ts) — apply same pattern if `safetyTimer` exists there

**HARD-03 — Error Boundary:**
- create [client/src/components/error-boundary.tsx](client/src/components/error-boundary.tsx)
- [client/src/App.tsx](client/src/App.tsx) — wrap `<AppContent />`
- [client/src/lib/translations.ts](client/src/lib/translations.ts) — add EN/PT/ES strings for recovery UI

**HARD-04 — Dead deps:**
- [package.json](package.json) — remove + relocate
- [package-lock.json](package-lock.json) — regenerated by `npm install`

### Project conventions
- [CLAUDE.md](CLAUDE.md) — TypeScript, Express 5, Supabase, no new deps without justification
- [server/middleware/auth.middleware.ts](server/middleware/auth.middleware.ts) — `authenticateUser`, `requireAuth`, `requireAdminGuard` patterns
- Existing rate-limit pattern (in-memory Map) at [server/routes/translate.routes.ts:19](server/routes/translate.routes.ts) — precedent only

</canonical_refs>

<specifics>
## Specific Ideas

### Rate-limit middleware sketch (HARD-01)

```typescript
// server/middleware/rate-limit.middleware.ts (new)
import rateLimit, { type Options } from "express-rate-limit";
import type { AuthenticatedRequest } from "./auth.middleware.js";

interface AiRateLimitOptions {
  max: number;        // requests per window
  windowMs: number;   // window length in ms
}

export function aiRateLimit(opts: AiRateLimitOptions) {
  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? req.ip ?? "anon",
    skip: (req: AuthenticatedRequest) => req.profile?.is_admin === true,
    standardHeaders: "draft-7",  // RateLimit-* headers
    legacyHeaders: false,
    handler: (req, res) => {
      const retryAfter = Math.ceil(opts.windowMs / 1000);
      console.log(`[RateLimit] user=${(req as AuthenticatedRequest).user?.id ?? "anon"} endpoint=${req.path} retryAfter=${retryAfter}`);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "rate_limit_exceeded",
        retry_after_seconds: retryAfter,
      });
    },
  });
}
```

Then in each route file, mount AFTER `authenticateUser`, BEFORE the route handler.

### SSE finally pattern (HARD-02)

Current shape (simplified):
```typescript
const safetyTimer = setTimeout(() => sse.sendError({...}), 260_000);
try {
  // ... lots of work
  clearTimeout(safetyTimer);  // line ~705
  sse.sendComplete({...});
} catch (error) {
  clearTimeout(safetyTimer);  // line ~719
  // ... error handling, sse.sendError
}
```

Target shape:
```typescript
const safetyTimer = setTimeout(() => sse.sendError({...}), 260_000);
try {
  // ... lots of work
  sse.sendComplete({...});
} catch (error) {
  // ... error handling, sse.sendError
} finally {
  clearTimeout(safetyTimer);
}
```

### Error Boundary skeleton (HARD-03)

```typescript
// client/src/components/error-boundary.tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught render error:", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return <ErrorRecoveryUI error={this.state.error} />;
    }
    return this.props.children;
  }
}

function ErrorRecoveryUI({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-card rounded-lg border p-6 shadow">
        <h1 className="text-xl font-semibold mb-2">{t("Something went wrong")}</h1>
        <p className="text-muted-foreground mb-4">{t("The page hit an error. You can try reloading or go back to the home page.")}</p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>{t("Retry")}</Button>
          <Button variant="outline" onClick={() => { window.location.href = "/"; }}>{t("Go home")}</Button>
        </div>
        {error && (
          <details className="mt-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("Technical details")}</summary>
            <pre className="mt-2 p-2 bg-muted rounded overflow-auto">{error.message}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
```

Wrap in App.tsx:
```tsx
<ErrorBoundary>
  <AppContent />
</ErrorBoundary>
```

### Dead dep removal (HARD-04)

```bash
npm uninstall passport passport-local express-session connect-pg-simple memorystore
npm uninstall @types/passport @types/passport-local @types/express-session @types/connect-pg-simple
# Move @octokit/rest manually in package.json (or):
npm uninstall @octokit/rest && npm install --save-dev @octokit/rest
npm install
npm run check
npm run build
```

</specifics>

<deferred>
## Deferred Ideas

- Multi-instance / Redis-backed rate-limiter store (current single-instance Map is acceptable; revisit when horizontal scaling arrives)
- Per-route-method rate-limit configuration (today: same limit for all paid endpoints; differentiation can come later)
- Per-route Error Boundary fallbacks instead of single app-root boundary (single boundary is sufficient for v1.2)
- Telemetry pipeline for `componentDidCatch` errors (defer until we have a telemetry sink)
- Comprehensive test coverage of these 4 fixes (manual verification + npm scripts is enough — full test suite is its own milestone)

</deferred>

---

*Phase: 13-production-hardening-fixes*
*Context gathered: 2026-05-08*
