---
phase: 14-wire-production-crons-via-http-triggers
verified: 2026-05-08T18:00:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 14: Wire Production Crons via HTTP Triggers — Verification Report

**Phase Goal:** Wire Phase 11 + 12 cron jobs to actually fire on Vercel via HTTP triggers + GitHub Actions, while preserving `node-cron` infrastructure intact for future Hetzner migration.

**Verified:** 2026-05-08T18:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                | Status     | Evidence                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `requireCronSecret` middleware exists, uses `crypto.timingSafeEqual`, returns 401 for bad bearer / 503 for unset env                | VERIFIED   | `server/middleware/cron-auth.middleware.ts` lines 25-60: imports `timingSafeEqual` from `node:crypto`, length-guard before compare, 503 path at line 35, two 401 paths at 44 and 55 |
| 2   | Three POST endpoints (`/api/internal/cleanup/{trash,purge}`, `/api/internal/billing/run-overage-batch`) exist, each guarded         | VERIFIED   | `server/routes/internal-cron.routes.ts` lines 36, 65, 94: each `router.post(..., requireCronSecret, ...)` invokes the right function and returns `{ok:true, trigger:"http", duration_ms, result}` |
| 3   | Legacy run-overage-batch handler removed from `billing.routes.ts` (move, not duplicate); `requireCronSecret` REPLACES `requireAdminGuard` | VERIFIED   | grep `/api/internal/billing/run-overage-batch` in billing.routes.ts → 0 hits; grep `runOverageBillingBatch` in billing.routes.ts → 0 hits; `requireAdminGuard` retained (5 hits) for other endpoints |
| 4   | GitHub Actions workflow fires cleanup every 6h + overage weekly with `workflow_dispatch` for manual smoke                            | VERIFIED   | `.github/workflows/cron.yml` parsed by js-yaml: `schedule:[{cron:"0 */6 * * *"},{cron:"0 0 * * 0"}]`, `workflow_dispatch:{}`, two jobs with proper `if:` gates |
| 5   | Dual-trigger architecture documented in `cleanup-cron.service.ts` header, CLAUDE.md, ARCHITECTURE.md, CONCERNS.md, `docs/production-cron.md` | VERIFIED   | All five doc surfaces verified — header rewritten (commit 640cb00, +18/-9 header-only), reorg-era CLAUDE.md/ARCHITECTURE.md/CONCERNS.md sections present |
| 6   | `node-cron` infrastructure preserved (Hetzner-readiness): `startCronJobs` still called, `cron.schedule` blocks intact, business logic untouched | VERIFIED   | `server/index.ts:102` `startCronJobs()` call retained; 3 `cron.schedule(...)` blocks at lines 248/258/269 of cleanup-cron.service.ts; `node-cron@^4.2.1` in package.json deps |
| 7   | `npm run check` and `npm run build` both exit 0                                                                                      | VERIFIED   | `npm run check` → exit 0 (silent tsc); `npm run build` → exit 0 (vite + esbuild → `dist/index.cjs` 1.2 MB; PWA + client bundles built) |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `server/middleware/cron-auth.middleware.ts` | `requireCronSecret` middleware with timingSafeEqual + 401/503 split | VERIFIED | 60 lines; exports `requireCronSecret`; 1 `timingSafeEqual` import + 1 call; 503 + 2×401 branches; `BEARER_PREFIX` constant; structured `[CronAuth]` warn logs |
| `server/routes/internal-cron.routes.ts` | 3 POST endpoints with envelope on `requireCronSecret` | VERIFIED | 124 lines; 3 `router.post(...)` blocks; each applies `requireCronSecret` middleware; each returns `{ok:true, trigger:"http", duration_ms, result}`; each catches and returns `{ok:false, error:"internal_error", message}` 500 on exception |
| `server/config/index.ts` | `CRON_SECRET` in Zod schema with `.min(32).optional()` + production warn | VERIFIED | Line 27: `CRON_SECRET: z.string().min(32, "CRON_SECRET must be ≥32 chars (use \`openssl rand -hex 32\`)").optional()`; lines 104-108: production-only `console.warn` in `logConfigStatus()` |
| `server/routes/billing.routes.ts` | Legacy handler MOVED (0 hits expected) | VERIFIED | grep `/api/internal/billing/run-overage-batch` → 0; grep `runOverageBillingBatch` → 0 (import removed); `requireAdminGuard` import retained for other admin endpoints (5 hits) |
| `server/routes/index.ts` | `internalCronRouter` mounted in createApiRouter | VERIFIED | Line 24: `import internalCronRouter from "./internal-cron.routes.js"`; line 66: `router.use(internalCronRouter)` inside createApiRouter; line 103: in named export block |
| `server/services/cleanup-cron.service.ts` | Header documents dual-trigger; body byte-identical | VERIFIED | Header lines 1-22 expanded (commit `640cb00`, +18/-9, header-only); body untouched: `runTrashSweep` line 59, `runPurgeSweep` line 79, `startCronJobs` line 247, three `cron.schedule(...)` blocks at lines 248/258/269 |
| `server/stripe.ts` | Untouched (only imported) | VERIFIED | `runOverageBillingBatch` still exported at line 527; no Phase 14 commit touched stripe.ts |
| `server/index.ts` | Untouched (`startCronJobs()` call preserved) | VERIFIED | Line 7 imports `startCronJobs`; line 102 calls `startCronJobs()` inside `httpServer.listen` callback (Hetzner path preserved) |
| `.github/workflows/cron.yml` | YAML with schedules + secrets + curl flags | VERIFIED | 39 lines; valid YAML (parsed by js-yaml); 2 schedules, workflow_dispatch, 2 jobs, 3 curl steps; all 10 grep patterns matched (20 total hits across schedule/workflow_dispatch/cron strings/secrets/pipefail/max-time/endpoints/ubuntu) |
| `vercel.json` | maxDuration 300 | VERIFIED | Line 28: `"maxDuration": 300` on `api/handler.ts` — basis for `--max-time 295` slack in workflow |
| `CLAUDE.md` | "Deployment & Cron" section | VERIFIED | Line 26: `## Deployment & Cron`; line 24 references "see Deployment & Cron below" in Architecture overview |
| `docs/production-cron.md` | Setup runbook with Path A/B + cross-link | VERIFIED | 238 lines; "Setup (one-time, on Vercel)" section at line 71; Path A + Path B + coexistence + local dev + verification + Related code; cross-link to `server/routes/internal-cron.routes.ts` at line 230 |
| `.planning/codebase/ARCHITECTURE.md` | "Scheduled Operations" section | VERIFIED | Line 113: `## Scheduled Operations (Phase 11 + 12 + 14)`; analysis date note at line 3 confirms post-Phase-14 update |
| `.planning/codebase/CONCERNS.md` | cron concern marked RESOLVED | VERIFIED | Line 89: "Post expiration cleanup is triggered per-user on edit, not on a schedule:" `✅ RESOLVED in Phase 11 + 14 (2026-05-08)`; lines 91-92 explain Vercel-vs-Hetzner gap closure |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `internal-cron.routes.ts` | `cron-auth.middleware.ts` | `import { requireCronSecret }` + 3 mounts | WIRED | Line 27 imports; lines 38, 67, 96 mount as second middleware |
| `internal-cron.routes.ts` | `cleanup-cron.service.ts` | `import { runTrashSweep, runPurgeSweep }` | WIRED | Lines 28-31 import; called at lines 42 and 71 |
| `internal-cron.routes.ts` | `stripe.ts` | `import { runOverageBillingBatch }` | WIRED | Line 32 import; called at line 100 |
| `routes/index.ts` | `internal-cron.routes.ts` | `router.use(internalCronRouter)` in createApiRouter | WIRED | Import at line 24; `router.use` at line 66; named export at line 103 |
| `cron-auth.middleware.ts` | `process.env.CRON_SECRET` | constant-time compare against Bearer suffix | WIRED | Line 30 reads env; line 51 compares via `timingSafeEqual` after length-guard |
| `cron.yml` → cleanup/trash | deployed app | curl POST + Bearer | WIRED | Line 16: `curl -fsS -X POST "${{ secrets.PROD_BASE_URL }}/api/internal/cleanup/trash" -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"` |
| `cron.yml` → cleanup/purge | deployed app | curl POST + Bearer | WIRED | Line 23: same pattern, `/api/internal/cleanup/purge` |
| `cron.yml` → overage | deployed app | curl POST + Bearer | WIRED | Line 35: same pattern, `/api/internal/billing/run-overage-batch` |
| `cleanup-cron.service.ts` header | `.github/workflows/cron.yml` | header names workflow file | WIRED | Line 12: `"See .github/workflows/cron.yml."` |
| `docs/production-cron.md` | `internal-cron.routes.ts` | "Related code" cross-link | WIRED | Line 230: `- \`server/routes/internal-cron.routes.ts\` — three HTTP endpoints` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript compile clean | `npm run check` | exit 0 (silent tsc) | PASS |
| Production build emits dist | `npm run build` | exit 0; `dist/index.cjs` 1.2 MB; client + PWA bundles built; `_app.html` renamed | PASS |
| YAML workflow parses cleanly | `npx --yes js-yaml .github/workflows/cron.yml` | exits 0; structured JSON shows 2 schedules, 1 workflow_dispatch, 2 jobs, 3 steps | PASS |
| Workflow grep totals (10 patterns) | `Grep schedule\|workflow_dispatch\|0 \*/6 \* \* \*\|0 0 \* \* 0\|secrets\.PROD_BASE_URL\|secrets\.CRON_SECRET\|set -euo pipefail\|--max-time 295\|/api/internal/\|ubuntu-latest` | 20 total occurrences | PASS |
| Sealed file `server/index.ts` untouched in Phase 14 | `git log --oneline -- server/index.ts` | last touch is commit `012b588` (Phase 11-02), pre-Phase-14 | PASS |
| Sealed file `server/stripe.ts` untouched in Phase 14 | `git log --oneline -- server/stripe.ts` | last touch pre-Phase-14 | PASS |
| `cleanup-cron.service.ts` header-only diff | `git show 640cb00 --stat` | `27 ++++++++++++++++++---------` (+18 / -9, all in lines 1-22) | PASS |
| Live curl smoke against deployed Vercel | (requires CRON_SECRET + PROD_BASE_URL secrets configured) | not runnable in CI | SKIP — human gate |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| CRON-01 | 14-01-PLAN.md | `requireCronSecret` middleware + Zod env CRON_SECRET | SATISFIED | `cron-auth.middleware.ts` exports requireCronSecret with timingSafeEqual + length-guard + 401/503 split; `config/index.ts` line 27 has `min(32).optional()`; line 104-108 has production warn |
| CRON-02 | 14-01-PLAN.md | 3 POST endpoints + legacy handler MOVED from billing.routes.ts | SATISFIED | `internal-cron.routes.ts` has 3 endpoints with envelope; `billing.routes.ts` shows 0 hits for legacy path and 0 for runOverageBillingBatch import; `routes/index.ts` mounts internalCronRouter |
| CRON-03 | 14-02-PLAN.md | GitHub Actions workflow with 2 schedules + workflow_dispatch + curl flags | SATISFIED | `.github/workflows/cron.yml` parses cleanly: schedule `[0 */6 * * *, 0 0 * * 0]`, workflow_dispatch, 2 jobs gated by `if:`, 3 curl steps each with `set -euo pipefail`, `--max-time 295`, Bearer auth |
| CRON-04 | 14-02-PLAN.md | Dual-trigger architecture docs (cleanup-cron header + CLAUDE.md + ARCHITECTURE.md + CONCERNS.md + production-cron.md) | SATISFIED | Header lines 1-22 expanded (TWO trigger paths, names .github/workflows/cron.yml + server/index.ts:httpServer.listen); CLAUDE.md "Deployment & Cron" section line 26; ARCHITECTURE.md "Scheduled Operations" line 113; CONCERNS.md RESOLVED line 89; docs/production-cron.md cross-link line 230 |

No orphaned requirements. All 4 phase requirement IDs are claimed by plans; REQUIREMENTS.md tracking table marks all as `Complete`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |

No anti-patterns found in Phase 14 modified/created files. Specifically scanned:

- `server/middleware/cron-auth.middleware.ts` — no TODO/FIXME/placeholder; no empty handlers; structured logging
- `server/routes/internal-cron.routes.ts` — no TODO/FIXME; both success and error envelopes populated; logs both `[Cron][http] ok` and `[Cron][http] failed`
- `server/config/index.ts` — production warn is informational, not stub; partial-config dev fallback intentionally omits CRON_SECRET (it's optional)
- `.github/workflows/cron.yml` — no commented-out steps; all curl flags present; no retry/backoff (intentional per CONTEXT.md decision — fail loudly)
- `docs/production-cron.md` — no `TBD`/`when written`/`to be created` markers (verified via Grep)

### Critical Preservation Checks (Hetzner-readiness)

| Check | Expected | Actual | Status |
| ----- | -------- | ------ | ------ |
| `node-cron` in package.json | present | `"node-cron": "^4.2.1"` line 61; `@types/node-cron` line 91 | PRESERVED |
| `startCronJobs()` called in server/index.ts | present | line 102 inside `httpServer.listen` callback | PRESERVED |
| `cron.schedule(...)` blocks in cleanup-cron.service.ts | 3 blocks | lines 248 (trash 6h), 258 (purge 6h+30m), 269 (overage cron expr) | PRESERVED |
| `runTrashSweep` business logic | unchanged | line 59 export; body byte-identical (commit diff +18/-9 confined to lines 1-22 header) | PRESERVED |
| `runPurgeSweep` business logic | unchanged | line 79 export; body byte-identical | PRESERVED |
| `runOverageBillingBatch` body | unchanged | `server/stripe.ts:527` export; file untouched in Phase 14 | PRESERVED |

### Human Verification Required

The deployment activation is a one-time user-setup gate that cannot be exercised programmatically without live secrets. Documented in `14-02-SUMMARY.md` under "Open Items Deferred to Post-Merge / Post-Deploy":

#### 1. Configure secrets and smoke-test workflow_dispatch

**Test:**
1. `openssl rand -hex 32` to generate a 32-char hex secret
2. Set `CRON_SECRET=<value>` in Vercel project env (Production scope) → trigger redeploy
3. Add GitHub repo secrets `PROD_BASE_URL=https://<vercel-domain>` and `CRON_SECRET=<same value>`
4. GitHub Actions UI → "Production cleanup crons" → "Run workflow" → confirm all 3 curl steps return HTTP 200 with the `[HTTP 200] N.NNs` `-w` log line

**Expected:** All three endpoints respond 200 with `{ok:true, trigger:"http", duration_ms, result}`. Failures indicate config gap (`CRON_SECRET` not propagated → 503) or domain mismatch (`PROD_BASE_URL` wrong → DNS/curl fail).

**Why human:** Requires live Vercel + GitHub repo with secrets configured; cannot be exercised offline.

#### 2. Confirm scheduled fires happen on cadence

**Test:** Wait 24h after secrets configured; check GitHub Actions run history for "Production cleanup crons" workflow.

**Expected:** cleanup-sweep runs every 6h (~within 5–15 min of the cron expression — GH Actions schedule is best-effort); overage-batch runs at 00:00 UTC the following Sunday.

**Why human:** Real-time scheduled trigger; cannot be simulated locally.

### Gaps Summary

None. Phase 14 fully achieves its goal. All 7 observable truths are verified, all 4 phase requirements are satisfied, both critical preservation checks (Hetzner-readiness, npm check + build clean) pass, and no anti-patterns or stubs were detected.

The two human-verification items above are deployment activation gates (set secrets in Vercel + GitHub, then trigger workflow_dispatch and confirm 200), not code gaps. The implementation is complete; only operator action remains to flip on the live schedule.

---

_Verified: 2026-05-08T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
