# Phase 14: Wire Production Crons via HTTP Triggers - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Direct authoring after discovering Vercel-vs-Hetzner deployment mismatch with Phase 11 + 12 internal `node-cron`

<domain>
## Phase Boundary

Wire the cron jobs shipped in Phase 11 + 12 so they actually run in production, while keeping the codebase ready for a future migration to a long-running host (Hetzner). The fix has two complementary paths that coexist:

1. **HTTP trigger path** — authenticated internal endpoints (`POST /api/internal/cleanup/trash`, `POST /api/internal/cleanup/purge`, `POST /api/internal/billing/run-overage-batch`) invoke the existing cron functions. Active on **Vercel** (today) via GitHub Actions schedule.

2. **Internal scheduler path** — `node-cron` in `server/services/cleanup-cron.service.ts:startCronJobs()` self-schedules at server boot via `server/index.ts:httpServer.listen` callback. Active on **Hetzner / long-running Node hosts** (future migration). Already exists; not modified.

**The same cron functions** (`runTrashSweep`, `runPurgeSweep`, `runOverageBillingBatch`) are the unit-of-work for both paths. Phase 14 adds the HTTP trigger path without touching the existing internal scheduler.

**In scope:**
- New middleware: `server/middleware/cron-auth.middleware.ts` (validates `Authorization: Bearer ${CRON_SECRET}` via `crypto.timingSafeEqual`)
- New routes file: `server/routes/internal-cron.routes.ts` with three endpoints
- Apply `requireCronSecret` to existing `POST /api/internal/billing/run-overage-batch` (currently unprotected)
- New GitHub Actions workflow: `.github/workflows/cron.yml` with two scheduled jobs (cleanup-sweep every 6h, overage-batch weekly)
- Env variable plumbing: `CRON_SECRET` added to Zod schema in `server/config/index.ts` with optional + warning-in-prod
- Documentation:
  - Header comment in `cleanup-cron.service.ts` explaining dual-trigger architecture
  - README.md or new `docs/production-cron.md` with setup instructions for Vercel (GitHub Actions) and Hetzner (internal scheduler)
  - `.planning/codebase/ARCHITECTURE.md` ganha seção "Scheduled Operations"
  - `CLAUDE.md` deployment + cron section

**Out of scope:**
- Removing or modifying `node-cron`, `startCronJobs()`, `cron.schedule(...)`, or anything in `cleanup-cron.service.ts` business logic — Hetzner needs them
- Stripe/GA4/Facebook live integration validation (SEED-002)
- DB-backed cross-process cron lock (single-instance assumption holds; revisit when scaling)
- Vercel Cron Jobs (Hobby tier limited to once-daily; we go GitHub Actions for full 6h cadence at zero cost)

</domain>

<decisions>
## Implementation Decisions

### Why HTTP triggers + GitHub Actions (not Vercel Cron, not pg_cron)

| Option | Free? | Cadence | Verdict |
|---|---|---|---|
| Vercel Cron Hobby | yes | **max 1×/day** | rejected — degrades 6h spec |
| GitHub Actions | yes (2000min/mo private) | any (down to 5min) | **chosen** — matches 6h spec, $0 |
| pg_cron + Supabase | yes | any | rejected for non-trash jobs (overage needs Stripe API; pg_net is awkward) |
| External cron-job.org | yes | any | rejected — extra dependency, lower reliability |
| Vercel Pro | $20/mo | any | rejected — user not on paid tier |
| Hetzner (long-running Node) | future | internal `node-cron` | future migration; preserved |

GitHub Actions cost projection: 2 jobs × 4×/day cleanup + 1×/week overage ≈ 25 minutes/month. **Within the 2000-min free tier by 80×.**

### Authentication on internal endpoints

- **Header**: `Authorization: Bearer ${CRON_SECRET}`. Standard HTTP pattern; no surprises.
- **Comparison**: `crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))` — anti timing-attack. Pure stdlib; no new dep.
- **Length guard**: middleware rejects if buffer lengths differ before timingSafeEqual (which throws on mismatch otherwise).
- **Secret strength**: `CRON_SECRET` must be ≥32 chars; suggest `openssl rand -hex 32`. Zod schema enforces minimum length.
- **Missing in prod**: `logConfigStatus()` warns at startup ("⚠ CRON_SECRET not set — cron HTTP triggers disabled"). Endpoints reject with 503 (not 401) when secret is unset, signalling configuration gap rather than auth failure.
- **403 vs 401**: use 401 for missing/invalid bearer, reserves 403 for "authed but not allowed" semantics.
- **Logging**: every reject logs `[CronAuth] reject reason={missing|wrong} ip={req.ip}` for ops visibility.

### Endpoint shape

All 3 endpoints have identical shape:

- Method: `POST` (these are mutations — destructive ops)
- Path: `/api/internal/cleanup/trash`, `/api/internal/cleanup/purge`, `/api/internal/billing/run-overage-batch`
- Body: empty (no params; the cron functions are parameterless)
- Auth: `requireCronSecret` middleware
- Response on success (200):
  ```json
  {
    "ok": true,
    "trigger": "http",
    "duration_ms": 1234,
    "result": <whatever-the-fn-returned>
  }
  ```
- Response on auth fail: 401 `{"error": "unauthorized"}` (or 503 if secret unset in env)
- Response on internal error: 500 `{"error": "internal_error", "message": <safe-msg>}`

### `runOverageBillingBatch` already has an endpoint at `billing.routes.ts:649`

- Decision: **move** the existing endpoint to `server/routes/internal-cron.routes.ts` for cohesion (all 3 internal-cron endpoints in one place). Update `server/routes/index.ts` mount.
- Add the `requireCronSecret` middleware (it currently uses an admin-bypass guard which is wrong for cron — admins should NOT be able to manually trigger a billing batch via the public app surface; only the cron secret should).
- Backwards compat: keep the path identical so the existing GH Actions workflow contract (when written) doesn't drift from anything that already references it.

### GitHub Actions workflow shape

```yaml
name: Production cleanup crons
on:
  schedule:
    - cron: '0 */6 * * *'   # cleanup sweep every 6h
    - cron: '0 0 * * 0'     # overage batch weekly Sunday 00:00 UTC
  workflow_dispatch: {}      # manual trigger for testing

jobs:
  cleanup-sweep:
    if: github.event.schedule == '0 */6 * * *' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger trash sweep
        run: |
          set -euo pipefail
          curl -fsS -X POST "${{ secrets.PROD_BASE_URL }}/api/internal/cleanup/trash" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            --max-time 295 \
            -w "\n[HTTP %{http_code}] %{time_total}s\n"
      - name: Trigger purge sweep
        run: |
          set -euo pipefail
          curl -fsS -X POST "${{ secrets.PROD_BASE_URL }}/api/internal/cleanup/purge" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            --max-time 295 \
            -w "\n[HTTP %{http_code}] %{time_total}s\n"

  overage-batch:
    if: github.event.schedule == '0 0 * * 0' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger overage batch
        run: |
          set -euo pipefail
          curl -fsS -X POST "${{ secrets.PROD_BASE_URL }}/api/internal/billing/run-overage-batch" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            --max-time 295 \
            -w "\n[HTTP %{http_code}] %{time_total}s\n"
```

Why `workflow_dispatch`: lets you manually trigger from the GH Actions UI for smoke testing the wiring before relying on schedule.

Why `--max-time 295`: Vercel Pro/Enterprise function `maxDuration` ceiling is 300s. The vercel.json has `maxDuration: 300`. Setting curl 295s gives 5s slack so the workflow doesn't time out before Vercel does.

### Internal cron service: comment header explaining dual-trigger

Add this to top of `server/services/cleanup-cron.service.ts`:

```typescript
/**
 * Cleanup cron service (Phase 11 + 12; HTTP-trigger path added in Phase 14)
 *
 * Three scheduled jobs:
 *   1. runTrashSweep — soft-delete posts past expires_at (sets trashed_at)
 *   2. runPurgeSweep — permanently delete posts in trash > TRASH_RETENTION_DAYS
 *   3. runOverageBillingBatch (in server/stripe.ts) — weekly Stripe overage invoices
 *
 * TWO trigger paths coexist:
 *   A) HTTP triggers via /api/internal/cleanup/* + /api/internal/billing/run-overage-batch
 *      Active on Vercel (and any serverless host). Disp via GitHub Actions schedule.
 *      See .github/workflows/cron.yml.
 *
 *   B) Internal node-cron via startCronJobs() called from server/index.ts:httpServer.listen
 *      Active on Hetzner (and any long-running Node host) when running `npm run start`.
 *      NOT active on Vercel because Vercel uses api/handler.ts as the entry, not server/index.ts.
 *
 * Both paths invoke the SAME functions; no logic divergence. Pick the one that matches the
 * deployment. If both are active simultaneously (e.g. Hetzner with GH Actions also enabled),
 * the in-process overageBatchRunning lock prevents double-charges within a single process,
 * but cross-process double-charging IS possible — disable one trigger when running on Hetzner.
 */
```

### Local development

- `npm run dev` runs `tsx server/index.ts` — `startCronJobs()` fires on `httpServer.listen()`. The 6h timer is unlikely to disparar in a dev session, so practical impact is zero.
- To test HTTP triggers locally: `curl -X POST http://localhost:8888/api/internal/cleanup/trash -H "Authorization: Bearer dev-secret"` after setting `CRON_SECRET=dev-secret` in `.env`.

### Migration to Hetzner (future, documented but not in scope)

Step-by-step (write into `docs/deployment-hetzner.md` extension or new `docs/production-cron.md`):
1. Deploy app on Hetzner via existing `deploy/hetzner/` toolchain
2. Set `CRON_SECRET=<same-or-new-secret>` in Hetzner `.env`
3. **Decide trigger model:**
   - **Option A (recommended): exclusive internal scheduler.** Disable GitHub Actions workflow (rename `.github/workflows/cron.yml` → `.github/workflows/cron.yml.disabled` or comment out the `schedule:` keys). `node-cron` in `startCronJobs()` runs at boot.
   - **Option B: redundancy.** Keep GitHub Actions schedule AND internal `node-cron`. Update `PROD_BASE_URL` GH secret to point at the new Hetzner domain. Risk: cross-process double-trigger may double-charge overage — mitigated only by in-process lock. Not recommended without DB-backed lock.
4. Smoke test: SSH into Hetzner box, `pm2 logs xareable | grep "[Cron]"` and confirm `[Cron] Jobs registered` appears at boot.

### Claude's Discretion

- Whether to put all 3 endpoints in one new file (`server/routes/internal-cron.routes.ts`) or distribute (cleanup endpoints in `posts.routes.ts`, billing endpoint stays in `billing.routes.ts`). **Lean toward one file — cohesion wins, all share the same auth middleware.**
- Specific log format for endpoint hits — match existing `[Cron] *` pattern from cleanup-cron.service.ts so logs are uniform across both trigger paths
- Whether to add a tiny dashboard surface listing last-run timestamps (useful but out of scope for v1.2; future SEED candidate)

</decisions>

<canonical_refs>
## Canonical References

### Files to MODIFY
- [server/config/index.ts](server/config/index.ts) — add `CRON_SECRET` to Zod env schema (optional + min-length 32)
- [server/routes/billing.routes.ts:649](server/routes/billing.routes.ts:649) — REMOVE the existing run-overage-batch endpoint (moved to internal-cron.routes.ts)
- [server/routes/index.ts](server/routes/index.ts) — mount the new internal-cron router
- [server/services/cleanup-cron.service.ts](server/services/cleanup-cron.service.ts) — header doc only; no logic changes
- [.planning/codebase/ARCHITECTURE.md](.planning/codebase/ARCHITECTURE.md) — add "Scheduled Operations" section
- [.planning/codebase/CONCERNS.md](.planning/codebase/CONCERNS.md) — mark cron-not-on-schedule concern resolved
- [CLAUDE.md](CLAUDE.md) — add "Deployment & Cron" section

### Files to CREATE
- `server/middleware/cron-auth.middleware.ts` — `requireCronSecret` middleware
- `server/routes/internal-cron.routes.ts` — 3 endpoints
- `.github/workflows/cron.yml` — scheduled GH Actions workflow
- `docs/production-cron.md` — setup runbook (Vercel + Hetzner)

### Files to NOT TOUCH (sealed)
- `server/services/cleanup-cron.service.ts` business logic (only header comment)
- `server/stripe.ts` (just import `runOverageBillingBatch`)
- `server/index.ts` (`startCronJobs()` call stays — Hetzner needs it)
- Any of `runTrashSweep`, `runPurgeSweep`, `runOverageBillingBatch`

### Existing patterns to borrow
- [server/middleware/auth.middleware.ts](server/middleware/auth.middleware.ts) — middleware shape
- [server/middleware/admin.middleware.ts](server/middleware/admin.middleware.ts) — middleware shape
- [server/routes/billing.routes.ts:649](server/routes/billing.routes.ts:649) — existing run-overage-batch handler (move + add auth)
- [vercel.json:25-30](vercel.json:25) — `functions.api/handler.ts.maxDuration: 300` confirms our 295s ceiling on curl `--max-time`
- [docs/deployment-hetzner.md](docs/deployment-hetzner.md) — exists; will be extended with cron section

### Key facts (already verified by reading source)
- `node-cron@^4.2.1` is in `package.json` deps — kept (Hetzner needs it)
- `node-cron` is NOT in `script/build.ts` allowlist → not bundled into Vercel `dist/index.cjs`. Marked `external` automatically. Zero bundle bloat from keeping it.
- `vercel.json:25-30` uses `api/handler.ts` as entry point. `server/index.ts` is NOT executed on Vercel. Therefore `startCronJobs()` is NEVER called on Vercel today — confirmed harmless to keep, just doesn't fire.
- `vercel.json` has NO `crons` block. We're using GH Actions externally, not Vercel Cron.

</canonical_refs>

<specifics>
## Specific Ideas

### `requireCronSecret` middleware

```typescript
// server/middleware/cron-auth.middleware.ts
import { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

export function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.warn(`[CronAuth] reject reason=secret_unset path=${req.path}`);
    res.status(503).json({ error: "cron_not_configured" });
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith(BEARER_PREFIX)) {
    console.warn(`[CronAuth] reject reason=missing path=${req.path} ip=${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const received = auth.slice(BEARER_PREFIX.length);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.warn(`[CronAuth] reject reason=wrong path=${req.path} ip=${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
```

### `internal-cron.routes.ts`

```typescript
// server/routes/internal-cron.routes.ts
import { Router, type Request, type Response } from "express";
import { requireCronSecret } from "../middleware/cron-auth.middleware.js";
import { runTrashSweep, runPurgeSweep } from "../services/cleanup-cron.service.js";
import { runOverageBillingBatch } from "../stripe.js";

const router = Router();

router.post("/api/internal/cleanup/trash", requireCronSecret, async (_req, res: Response) => {
  const start = Date.now();
  try {
    const swept = await runTrashSweep();
    const duration_ms = Date.now() - start;
    console.log(`[Cron][http] trash sweep ok swept=${swept} duration_ms=${duration_ms}`);
    res.status(200).json({ ok: true, trigger: "http", duration_ms, result: { swept } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`[Cron][http] trash sweep failed:`, err);
    res.status(500).json({ ok: false, error: "internal_error", message });
  }
});

router.post("/api/internal/cleanup/purge", requireCronSecret, async (_req, res: Response) => {
  const start = Date.now();
  try {
    const purged = await runPurgeSweep();
    const duration_ms = Date.now() - start;
    console.log(`[Cron][http] purge sweep ok purged=${purged} duration_ms=${duration_ms}`);
    res.status(200).json({ ok: true, trigger: "http", duration_ms, result: { purged } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`[Cron][http] purge sweep failed:`, err);
    res.status(500).json({ ok: false, error: "internal_error", message });
  }
});

router.post("/api/internal/billing/run-overage-batch", requireCronSecret, async (_req, res: Response) => {
  const start = Date.now();
  try {
    const result = await runOverageBillingBatch();
    const duration_ms = Date.now() - start;
    console.log(`[Cron][http] overage batch ok processed=${result.processed} charged=${result.charged} skipped=${result.skipped} duration_ms=${duration_ms}`);
    res.status(200).json({ ok: true, trigger: "http", duration_ms, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`[Cron][http] overage batch failed:`, err);
    res.status(500).json({ ok: false, error: "internal_error", message });
  }
});

export default router;
```

### Zod env schema addition

```typescript
// server/config/index.ts (add to existing schema)
const envSchema = z.object({
  // ... existing keys ...
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be ≥32 chars (use `openssl rand -hex 32`)").optional(),
});

// in logConfigStatus():
if (env.NODE_ENV === "production" && !env.CRON_SECRET) {
  console.warn("⚠  CRON_SECRET not set — HTTP cron triggers will reject all requests with 503");
}
```

### Mount in `server/routes/index.ts`

```typescript
// add to imports
import internalCronRouter from "./internal-cron.routes.js";

// add to createApiRouter():
router.use(internalCronRouter);
```

### `docs/production-cron.md` (new file, runbook)

```markdown
# Production cron architecture

Three cron jobs run in production:

1. **Trash sweep** — every 6h, soft-deletes posts past expiry
2. **Purge sweep** — every 6h, permanently deletes posts in trash > 30 days
3. **Overage billing batch** — weekly (Sunday 00:00 UTC), Stripe-invoices accrued overage

The codebase supports two trigger paths simultaneously:

## Path A: HTTP triggers via GitHub Actions (current Vercel deploy)

Used because Vercel serverless functions don't host long-running processes.

### Setup

1. Generate a strong secret: `openssl rand -hex 32`
2. Set `CRON_SECRET=<value>` in Vercel project env (Production scope)
3. In GitHub repo Settings → Secrets and variables → Actions, add:
   - `PROD_BASE_URL` = `https://your-vercel-domain.com`
   - `CRON_SECRET` = same value as Vercel
4. Verify wiring: GitHub Actions UI → "Production cleanup crons" workflow → "Run workflow" (workflow_dispatch). Watch logs; expect HTTP 200 from each step.
5. Confirm scheduled fires happen on time (~within 5–15 min of cadence; GH Actions schedule is best-effort).

### Endpoints

- `POST /api/internal/cleanup/trash` (24×/day expected)
- `POST /api/internal/cleanup/purge` (4×/day expected)
- `POST /api/internal/billing/run-overage-batch` (1×/week expected)

All require `Authorization: Bearer ${CRON_SECRET}`.

## Path B: Internal node-cron (future Hetzner / any long-running Node host)

Used when the app is deployed on a host that keeps a Node process alive. Already implemented in `server/services/cleanup-cron.service.ts:startCronJobs()` and called from `server/index.ts:httpServer.listen` callback.

### Setup

1. Deploy app on Hetzner via `deploy/hetzner/deploy.sh`
2. Set `CRON_SECRET` in the Hetzner `.env` (same value or a new one — used by HTTP triggers as escape hatch)
3. **Choose your trigger model:**
   - **Recommended (exclusive internal):** Disable GitHub Actions workflow — rename `.github/workflows/cron.yml` to `.github/workflows/cron.yml.disabled`, OR comment out the `schedule:` keys. `node-cron` in `startCronJobs()` handles everything.
   - **Alternative (redundancy):** Keep GitHub Actions schedule too — update `PROD_BASE_URL` GH secret to the new Hetzner domain. Beware: cross-process double-trigger possible. The in-process `overageBatchRunning` lock prevents double-charge within a single process but NOT across hosts. Not recommended without a DB-backed lock.
4. Smoke test: `pm2 logs xareable | grep "[Cron]"` after restart — expect `[Cron] Jobs registered: trash-sweep (every 6h), purge-sweep (every 6h +30m), overage-batch (...)` at boot.

## Why two paths?

- Vercel-tier-Hobby has only daily-cadence Vercel Cron (would degrade 6h spec). GitHub Actions matches the 6h cadence at $0.
- Future Hetzner deploy is a long-running process — `node-cron` is the simplest, robust option there. Already exists from Phase 11 + 12.

Both invoke the SAME cron functions in `cleanup-cron.service.ts` + `stripe.ts:runOverageBillingBatch`. No logic divergence. The trigger is just how-it-fires; the actual cleanup/billing work is unified.
```

</specifics>

<deferred>
## Deferred Ideas

- DB-backed cross-process cron lock for safe Hetzner+GH-Actions redundancy (today: in-process boolean only)
- Last-run admin dashboard surface (showing timestamp + result of each cron job)
- Failure alerting (Telegram notification on N consecutive cron failures)
- Replacing `node-cron` with a managed scheduler on Hetzner (Inngest, Trigger.dev) — overkill until product scales
- Adding a `vercel.json` `crons` block as redundant fallback (would degrade to daily on Hobby; not worth it)

</deferred>

---

*Phase: 14-wire-production-crons-via-http-triggers*
*Context gathered: 2026-05-08*
