---
phase: 14-wire-production-crons-via-http-triggers
plan: 01
subsystem: server-cron-http-triggers
tags: [middleware, routes, env-config, cron, http-triggers, security]
requirements: [CRON-01, CRON-02]
dependency-graph:
  requires:
    - server/middleware/auth.middleware.ts (Bearer extraction pattern reference)
    - server/services/cleanup-cron.service.ts (runTrashSweep, runPurgeSweep — sealed; only imported)
    - server/stripe.ts (runOverageBillingBatch — sealed; only imported)
  provides:
    - server/middleware/cron-auth.middleware.ts (requireCronSecret middleware)
    - server/routes/internal-cron.routes.ts (3 POST endpoints with envelope shape)
    - CRON_SECRET env config slot (Zod-validated, optional, min 32 chars)
  affects:
    - server/config/index.ts (envSchema + logConfigStatus production warning)
    - server/routes/billing.routes.ts (legacy handler removed; runOverageBillingBatch import removed)
    - server/routes/index.ts (internalCronRouter mounted in createApiRouter + named export)
tech-stack:
  added: []   # No new deps; uses node:crypto stdlib
  patterns:
    - "Constant-time bearer-token compare via crypto.timingSafeEqual with explicit length-guard"
    - "Express middleware shape (req, res, next) — matches admin/auth/rate-limit middleware family"
    - "[Cron][http] log prefix paired with existing [Cron] prefix from cleanup-cron.service.ts (uniform across both trigger paths)"
    - "Wrapped success envelope {ok, trigger, duration_ms, result} for all internal-cron endpoints"
    - "Distinct status codes for distinct ops semantics: 503 (config gap) vs 401 (auth failure)"
key-files:
  created:
    - server/middleware/cron-auth.middleware.ts (60 lines)
    - server/routes/internal-cron.routes.ts (123 lines)
  modified:
    - server/config/index.ts (CRON_SECRET added to envSchema; production warn in logConfigStatus)
    - server/routes/billing.routes.ts (legacy handler removed; unused runOverageBillingBatch import removed)
    - server/routes/index.ts (internalCronRouter import + router.use + named export)
decisions:
  - "Single internal-cron.routes.ts file (not split cleanup vs billing) — cohesion: shared auth, response envelope, error handling, log prefix."
  - "Path string `/api/internal/billing/run-overage-batch` preserved bit-identically across the move from billing.routes.ts:649 — no contract drift for future GH Actions workflow caller."
  - "Auth swapped from requireAdminGuard to requireCronSecret on the moved billing endpoint — admins MUST NOT be able to manually fire a billing batch via the public app surface (CONTEXT.md decision)."
  - "Response envelope on the moved endpoint changed from raw `{processed,charged,skipped}` to `{ok:true, trigger:'http', duration_ms, result:{processed,charged,skipped}}` — matches the new canonical shape; no current consumers (GH Actions workflow not yet written) so this is the new baseline."
  - "503 vs 401 split kept distinct: 503 only when CRON_SECRET env unset (signals config gap to ops); 401 for missing/wrong bearer (auth failure). Did NOT collapse to a single status."
  - "logConfigStatus production-only warn (not error/exit) — staging/dev with CRON_SECRET unset must still boot; runtime-safe because endpoints reject with 503 anyway."
metrics:
  duration: "6m46s"
  completed: "2026-05-08T17:06:20Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 3
  total_files_touched: 5
  lines_added_new_files: 183
---

# Phase 14 Plan 01: Wire Production Crons via HTTP Triggers — Summary

**One-liner:** Added `requireCronSecret` middleware (constant-time bearer-token compare via `crypto.timingSafeEqual`) and a new internal-cron router exposing `POST /api/internal/cleanup/{trash,purge}` + `POST /api/internal/billing/run-overage-batch`; moved the previously admin-guarded billing endpoint to the new router with cron-only auth, preserving path identity for the future GitHub Actions workflow caller.

## What Was Built

### Task 1 — `requireCronSecret` middleware + `CRON_SECRET` env schema (commit `4d3aa84`)

Created `server/middleware/cron-auth.middleware.ts` (60 lines):
- Extracts Bearer token from `Authorization` header.
- Length-guards before calling `timingSafeEqual` (which throws on mismatched lengths).
- Returns **503 `cron_not_configured`** when `process.env.CRON_SECRET` is unset (operational signal: configuration gap, not auth failure).
- Returns **401 `unauthorized`** for missing/malformed/wrong bearer.
- Logs every reject with `[CronAuth] reject reason=...` plus path and (when applicable) `req.ip`.

Edited `server/config/index.ts`:
- Added `CRON_SECRET: z.string().min(32, "CRON_SECRET must be ≥32 chars (use \`openssl rand -hex 32\`)").optional()` to the `envSchema`.
- In `logConfigStatus()`, emits a production-only `console.warn` line when `CRON_SECRET` is unset: "⚠ CRON_SECRET not set — HTTP cron triggers will reject all requests with 503".

### Task 2 — `internal-cron.routes.ts` + legacy handler removal + router mount (commit `3d35607`)

Created `server/routes/internal-cron.routes.ts` (123 lines):
- `POST /api/internal/cleanup/trash` → invokes `runTrashSweep()` from `cleanup-cron.service.ts`.
- `POST /api/internal/cleanup/purge` → invokes `runPurgeSweep()` from same.
- `POST /api/internal/billing/run-overage-batch` → invokes `runOverageBillingBatch()` from `server/stripe.ts`.
- Each endpoint applies `requireCronSecret` as the route-level middleware.
- All three return the canonical wrapped envelope: `{ok: true, trigger: "http", duration_ms, result}` on success.
- All three log success with `[Cron][http] <name> ok ... duration_ms=<n>` (uniform with existing `[Cron]` prefix used by `cleanup-cron.service.ts`).
- All three return `500 {ok:false, error:"internal_error", message}` on handler exception, with `console.error` logged.

Edited `server/routes/billing.routes.ts`:
- **Removed** the legacy `router.post("/api/internal/billing/run-overage-batch", ...)` handler (was at line 649 with `requireAdminGuard`).
- **Removed** the now-unused `runOverageBillingBatch` named import from `../stripe.js`.
- **Kept** `requireAdminGuard` import and all other imports — still used by 4 other admin endpoints in the same file (`/api/admin/billing/plans` GET + PATCH at lines ~660/679, plus 2 more downstream).

Edited `server/routes/index.ts`:
- Added `import internalCronRouter from "./internal-cron.routes.js";` after the `billingRoutes` import.
- Added `router.use(internalCronRouter)` inside `createApiRouter()` between the "Billing and credits" group and "Affiliate system" group, with the comment "// Internal cron HTTP triggers (Phase 14)".
- Added `internalCronRouter` to the bottom-of-file named export block under "// Internal cron triggers" (consistency with existing pattern).

## Verification Results

```
npm run check    → exit 0 (TypeScript clean)
npm run build    → exit 0 (esbuild emits dist/index.cjs at 1.2 MB; client + PWA bundles built)
```

Acceptance criteria grep matrix (all met):

| Check | Threshold | Actual |
|---|---|---|
| `timingSafeEqual` in cron-auth.middleware.ts | ≥1 | 4 |
| `export function requireCronSecret` | =1 | 1 |
| `503` in cron-auth.middleware.ts | ≥1 | 2 |
| `401` in cron-auth.middleware.ts | ≥2 | 4 |
| `Bearer ` in cron-auth.middleware.ts | ≥1 | 3 |
| `CRON_SECRET` in config/index.ts | ≥2 | 3 |
| `min(32` in config/index.ts | ≥1 | 1 |
| `CRON_SECRET not set` in config/index.ts | ≥1 | 1 |
| Unique `router.post` paths in internal-cron.routes.ts | =3 | 3 |
| `requireCronSecret` references in internal-cron.routes.ts | ≥3 | 7 |
| Legacy path in billing.routes.ts | =0 | 0 |
| `runOverageBillingBatch` in billing.routes.ts | =0 | 0 |
| `requireAdminGuard` in billing.routes.ts | ≥2 | 5 |
| `internalCronRouter` in routes/index.ts | ≥2 | 3 |
| `router.use(internalCronRouter)` in routes/index.ts | ≥1 | 1 |

### Sealed files (verified untouched — `git diff --name-only` empty)

```
server/services/cleanup-cron.service.ts   ← unchanged (Hetzner node-cron path preserved)
server/stripe.ts                          ← unchanged (only imported runOverageBillingBatch)
server/index.ts                           ← unchanged (startCronJobs() call preserved for Hetzner)
```

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 fixes needed; no Rule 4 architectural decisions surfaced.

The only intentional shape change was already documented in the plan + CONTEXT.md (response envelope on the moved overage-batch endpoint changed from raw `res.json(result)` to the wrapped `{ok, trigger, duration_ms, result}` shape — this is the new canonical contract; no consumers existed for the old shape since GH Actions workflow has not been written yet).

## Authentication Gates

None.

## Decisions Made vs CONTEXT.md

All decisions in `14-CONTEXT.md` were honored:
- ✓ Auth: Bearer token + `crypto.timingSafeEqual` + length-guard.
- ✓ Status code split: 503 for env unset, 401 for missing/wrong bearer.
- ✓ Single file for all 3 endpoints (cohesion).
- ✓ Path identity preserved on the moved billing endpoint.
- ✓ `requireCronSecret` REPLACES `requireAdminGuard` on the moved endpoint (no admin escape hatch via app surface).
- ✓ `requireAdminGuard` import retained in billing.routes.ts (other admin endpoints still need it).
- ✓ `runOverageBillingBatch` import REMOVED from billing.routes.ts (kept lean; `npm run check` clean).

## Open Items Handed to Plan 14-02

Plan 14-02 (wave 2) covers the remaining HTTP-trigger work:
1. Create `.github/workflows/cron.yml` with two scheduled jobs (cleanup-sweep every 6h, overage-batch weekly Sunday 00:00 UTC) plus `workflow_dispatch` for manual smoke tests.
2. Add the dual-trigger header doc-comment to `server/services/cleanup-cron.service.ts` (Path A vs Path B explanation).
3. Create `docs/production-cron.md` runbook (Vercel + Hetzner setup instructions).
4. Update `.planning/codebase/ARCHITECTURE.md` with "Scheduled Operations" section.
5. Update `CLAUDE.md` deployment + cron section.
6. End-to-end smoke test via `workflow_dispatch` against deployed Vercel target with valid `CRON_SECRET`.

## Self-Check: PASSED

- ✓ `server/middleware/cron-auth.middleware.ts` exists (60 lines)
- ✓ `server/routes/internal-cron.routes.ts` exists (123 lines)
- ✓ Commit `4d3aa84` exists in `git log`
- ✓ Commit `3d35607` exists in `git log`
- ✓ `npm run check` exit 0
- ✓ `npm run build` exit 0
- ✓ Sealed files diff empty
