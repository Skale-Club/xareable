---
phase: 14-wire-production-crons-via-http-triggers
plan: 02
subsystem: production-cron-schedule-and-docs
tags: [github-actions, cron, schedule, dual-trigger, docs, runbook]
requirements: [CRON-03, CRON-04]
dependency-graph:
  requires:
    - server/routes/internal-cron.routes.ts (created in 14-01 — endpoints exist for curl to hit)
    - server/middleware/cron-auth.middleware.ts (created in 14-01 — Bearer auth enforces CRON_SECRET)
    - vercel.json (functions.api/handler.ts.maxDuration:300 — basis for --max-time 295)
    - CLAUDE.md "Deployment & Cron" section (added during v1.2 reorg — verified intact, not duplicated)
    - .planning/codebase/ARCHITECTURE.md "Scheduled Operations" section (reorg — verified intact)
    - .planning/codebase/CONCERNS.md ✅ RESOLVED marker (reorg — verified intact)
    - docs/production-cron.md (reorg — verified intact, including cross-link to internal-cron.routes.ts)
  provides:
    - .github/workflows/cron.yml (schedule that fires production crons on Vercel via curl)
    - cleanup-cron.service.ts dual-trigger header (the canonical in-code explanation of Path A vs Path B)
  affects:
    - Production cron behavior on Vercel — cleanup sweeps fire every 6h, overage billing fires weekly Sunday 00:00 UTC AFTER user configures CRON_SECRET + PROD_BASE_URL secrets
    - Hetzner migration path — header doc names .github/workflows/cron.yml as the file to disable when switching to Path B
tech-stack:
  added: []   # Pure GH-Actions YAML + comment edits; no deps, no code paths
  patterns:
    - "GitHub Actions schedule + workflow_dispatch dual-trigger (so users can smoke-test from UI without waiting 6h)"
    - "Job-level `if:` gate on github.event.schedule == '<cron>' || github.event_name == 'workflow_dispatch' — manual dispatch fires both jobs; scheduled fires hit only the matching job"
    - "Curl ceiling --max-time 295 = vercel.json maxDuration:300 minus 5s slack (workflow needs time to read response body and emit -w log line before Vercel kills the function)"
    - "set -euo pipefail wrapping every curl block (-fsS already fails on 4xx/5xx; pipefail catches future pipeline additions)"
    - "-w '\\n[HTTP %{http_code}] %{time_total}s\\n' on every curl for ops triage — step logs always show status + elapsed"
    - "JSDoc dual-trigger header pattern: explicitly names BOTH the trigger file (.github/workflows/cron.yml) AND the alternate Hetzner entry (server/index.ts:httpServer.listen) — future contributor knows which to disable when migrating"
key-files:
  created:
    - .github/workflows/cron.yml (38 lines — 2 jobs, 3 curl steps, 2 cron schedules + workflow_dispatch)
  modified:
    - server/services/cleanup-cron.service.ts (header comment expanded from 13 to 22 lines; +18/-9 = +9 net; body byte-identical)
  verified-not-modified:
    - CLAUDE.md (Deployment & Cron section already added during v1.2 reorg — present, not duplicated)
    - .planning/codebase/ARCHITECTURE.md (Scheduled Operations section — present)
    - .planning/codebase/CONCERNS.md (post-expiration cleanup ✅ RESOLVED — present)
    - docs/production-cron.md (full runbook + cross-link to server/routes/internal-cron.routes.ts — present)
decisions:
  - "Copy YAML body verbatim from CONTEXT.md <specifics> + docs/production-cron.md Path A — those two docs already locked the exact shape and would drift if this plan improvised."
  - "Replace the entire pre-existing 13-line header in cleanup-cron.service.ts (don't append) — the old line 'No HTTP endpoint is involved (TRSH-06)' is FALSE post-Phase-14 and would confuse future readers."
  - "Body of cleanup-cron.service.ts (line 14 onward, all functions, all cron.schedule blocks) sealed — diff stat confirms +18/-9 (header-only, no body changes). Hetzner Path B remains intact."
  - "No timezone field, no concurrency: block, no permissions: read-all, no pinned action versions, no retry/backoff in the workflow — all out of scope per plan; in-process overageBatchRunning lock + GH Actions schedule semantics + default permissions are sufficient."
  - "Reorg-era doc updates verified via grep, not re-authored. CLAUDE.md, ARCHITECTURE.md, CONCERNS.md, docs/production-cron.md all present and accounted for; this plan adds zero new lines to those files."
metrics:
  duration: "~3m"
  completed: "2026-05-08T17:12:06Z"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  files_verified-not-modified: 4
  total_files_touched: 2
  lines_added_new_files: 38
  lines_changed_modified_files: "+18/-9 (header-only)"
---

# Phase 14 Plan 02: Wire Production Crons via HTTP Triggers — Summary

**One-liner:** Created `.github/workflows/cron.yml` with two scheduled jobs (cleanup-sweep every 6h + overage-batch weekly Sunday 00:00 UTC) and `workflow_dispatch` for manual smoke-testing — each step `curl -fsS -X POST` with `--max-time 295`, Bearer `${CRON_SECRET}` against `${PROD_BASE_URL}/api/internal/...`; expanded `cleanup-cron.service.ts` header doc-block to canonically document the dual-trigger architecture (Path A: HTTP via GH Actions on Vercel / Path B: internal `node-cron` on Hetzner) without touching a single line of business logic.

## What Was Built

### Task 3 — `.github/workflows/cron.yml` (commit `952f614`)

Created `.github/workflows/cron.yml` (38 lines) — the GitHub Actions workflow that fires production cron jobs against the deployed Vercel app:

**Triggers:**
- `schedule:` two cron entries: `'0 */6 * * *'` (cleanup sweep every 6h) and `'0 0 * * 0'` (overage batch weekly Sunday 00:00 UTC)
- `workflow_dispatch: {}` — manual trigger from the GH Actions UI for smoke-testing the wiring without waiting for schedule

**Jobs (both `runs-on: ubuntu-latest`):**

| Job | `if:` gate | Steps |
|---|---|---|
| `cleanup-sweep` | `github.event.schedule == '0 */6 * * *' \|\| github.event_name == 'workflow_dispatch'` | "Trigger trash sweep" → "Trigger purge sweep" (sequential, single job) |
| `overage-batch` | `github.event.schedule == '0 0 * * 0' \|\| github.event_name == 'workflow_dispatch'` | "Trigger overage batch" |

The job-level `if:` gates ensure scheduled fires only run the matching job, while `workflow_dispatch` fires BOTH jobs (because both branches of the OR-condition match) — so a single manual run smoke-tests all three endpoints.

**Curl shape (identical across all 3 steps):**
```yaml
run: |
  set -euo pipefail
  curl -fsS -X POST "${{ secrets.PROD_BASE_URL }}/api/internal/<endpoint>" \
    -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
    --max-time 295 \
    -w "\n[HTTP %{http_code}] %{time_total}s\n"
```

- `-fsS`: fail on HTTP ≥400 (so 401/503 from `requireCronSecret` fails the step), silence progress bar, keep error messages on failure
- `--max-time 295`: vercel.json caps `api/handler.ts.maxDuration: 300`; 5s slack lets the workflow finish reading the response body before Vercel kills the function
- `set -euo pipefail`: defensive — `-fsS` already covers the curl side, but `pipefail` is future-proofing if a future edit pipes curl output

**Endpoints hit (defined in `server/routes/internal-cron.routes.ts` from plan 14-01):**
- `POST ${PROD_BASE_URL}/api/internal/cleanup/trash`
- `POST ${PROD_BASE_URL}/api/internal/cleanup/purge`
- `POST ${PROD_BASE_URL}/api/internal/billing/run-overage-batch`

### Task 4 — `cleanup-cron.service.ts` header expansion + reorg-doc verification (commit `640cb00`)

**Header rewrite** (`server/services/cleanup-cron.service.ts` lines 1-22, was lines 1-13):
- Removed the misleading "No HTTP endpoint is involved (TRSH-06)" line — false post-Phase-14
- Added explicit dual-trigger architecture documentation:
  - **Path A** — HTTP triggers via `/api/internal/cleanup/*` + `/api/internal/billing/run-overage-batch`, active on Vercel/serverless, dispatched by GitHub Actions schedule (file: `.github/workflows/cron.yml`)
  - **Path B** — Internal `node-cron` via `startCronJobs()` called from `server/index.ts:httpServer.listen`, active on Hetzner / long-running Node hosts when running `npm run start`. NOT active on Vercel because Vercel uses `api/handler.ts` as the entry, not `server/index.ts`.
- Notes that both paths invoke the SAME functions; cross-process double-charge risk if both fire simultaneously (in-process `overageBatchRunning` lock prevents same-process double, but NOT cross-host).
- Names `runOverageBillingBatch` (which lives in `server/stripe.ts` but is scheduled by THIS file's `startCronJobs`) as the third job for completeness.

**Body sealed:** `git diff --stat` confirms +18/-9 (header-only). The `import cron from "node-cron"`, `runTrashSweep`, `runPurgeSweep`, `extractPathFromUrl`, `deriveEnhancementSourceUrl`, `resolveOverageCronExpression`, `overageBatchRunning` lock, `startCronJobs`, all three `cron.schedule(...)` blocks — byte-identical.

**Verified-not-duplicated reorg-era docs** (no new edits added by this plan):

| File | Marker grep'd | Count |
|---|---|---|
| CLAUDE.md | `Deployment & Cron` | 2 (heading + "see ... section" link) |
| .planning/codebase/ARCHITECTURE.md | `Scheduled Operations` | 2 |
| .planning/codebase/CONCERNS.md | `RESOLVED in Phase` | 1 |
| docs/production-cron.md | `server/routes/internal-cron.routes.ts` | 1 |
| docs/production-cron.md | `Setup (one-time` | 1 |

All five markers present. No duplication, no re-authoring, no surface-level fix needed.

## Verification Results

```
npm run check    → exit 0 (TypeScript clean — header is just a comment, expected no diff)
yaml parse       → npx js-yaml .github/workflows/cron.yml → "yaml ok"
git diff --stat  → +18/-9 on cleanup-cron.service.ts (header-only, body byte-identical)
```

**Acceptance grep matrix (all met):**

| Check | Threshold | Actual |
|---|---|---|
| `schedule:` in cron.yml | ≥1 | 1 |
| `0 */6 * * *` in cron.yml | ≥1 | 2 (one in `schedule:` + one in cleanup-sweep `if:`) |
| `0 0 * * 0` in cron.yml | ≥1 | 2 (one in `schedule:` + one in overage-batch `if:`) |
| `workflow_dispatch` in cron.yml | ≥1 | 3 (`workflow_dispatch: {}` + 2 `if:` gates) |
| `secrets.PROD_BASE_URL` in cron.yml | ≥3 | 3 |
| `secrets.CRON_SECRET` in cron.yml | ≥3 | 3 |
| `set -euo pipefail` in cron.yml | ≥3 | 3 |
| `--max-time 295` in cron.yml | ≥3 | 3 |
| `/api/internal/cleanup/trash` in cron.yml | ≥1 | 1 |
| `/api/internal/cleanup/purge` in cron.yml | ≥1 | 1 |
| `/api/internal/billing/run-overage-batch` in cron.yml | ≥1 | 1 |
| `ubuntu-latest` in cron.yml | ≥2 | 2 |
| `TWO trigger paths\|HTTP triggers via\|node-cron` in cleanup-cron | ≥2 | 4 |
| `Phase 14` in cleanup-cron | ≥1 | 1 |
| `.github/workflows/cron.yml` in cleanup-cron | ≥1 | 1 |
| `runOverageBillingBatch` in cleanup-cron | ≥2 | 4 (1 header + 1 import + 2 in body schedule call) |
| `No HTTP endpoint is involved` in cleanup-cron | =0 | 0 (old line removed) |
| `runTrashSweep`/`runPurgeSweep`/`startCronJobs` exports in cleanup-cron | =3 | 3 |

### Sealed files (verified untouched — `git diff --name-only` shows only the two intentional files)

```
server/index.ts                  ← unchanged (httpServer.listen → startCronJobs() preserved for Hetzner)
server/stripe.ts                 ← unchanged (runOverageBillingBatch sealed)
server/routes/internal-cron.routes.ts  ← unchanged (created in 14-01; this plan does not modify)
server/middleware/cron-auth.middleware.ts ← unchanged (created in 14-01)
server/config/index.ts           ← unchanged (CRON_SECRET added in 14-01)
package.json                     ← unchanged (no deps added; node-cron preserved for Hetzner)
vercel.json                      ← unchanged (only read for the maxDuration:300 reference)
```

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 fixes needed; no Rule 4 architectural decisions surfaced. The reorg-era doc updates the plan asked us to verify were all present, so no remediation was required.

The YAML body and header text were copy-pasted verbatim from CONTEXT.md `<specifics>` and `<decisions>` respectively, per the plan's explicit "do not improvise" instruction.

## Authentication Gates

None during execution. The plan deliverable IS the auth-gating mechanism (the workflow file curl-ing the endpoints created in 14-01 with `Authorization: Bearer ${CRON_SECRET}` headers), but no human action was required during this plan's execution.

## Decisions Made vs CONTEXT.md

All decisions in `14-CONTEXT.md` were honored:
- ✓ GH Actions over Vercel Cron (matches 6h cadence at $0 vs Hobby's daily-only).
- ✓ `workflow_dispatch` for manual smoke-testing.
- ✓ Job-level `if:` gates so dispatch fires both, schedule fires only the matching one.
- ✓ Curl `--max-time 295` (5s slack under vercel.json's 300s cap).
- ✓ `set -euo pipefail` wrapping every step.
- ✓ Path-identical endpoint URLs to those shipped in 14-01.
- ✓ Header replaces (does not append to) the misleading old "No HTTP endpoint" line.
- ✓ Body of cleanup-cron.service.ts sealed.
- ✓ Reorg-era CLAUDE.md / ARCHITECTURE.md / CONCERNS.md / docs/production-cron.md updates verified intact, NOT re-authored.

## Open Items Deferred to Post-Merge / Post-Deploy (User-Setup Gates)

These are **NOT** Claude tasks — they are one-time configuration steps the user must perform after this plan ships, before the cron jobs actually fire in production:

1. **Generate strong CRON_SECRET:** `openssl rand -hex 32`
2. **Set in Vercel:** Project Settings → Environment Variables → Production scope → `CRON_SECRET=<value>`. Trigger redeploy so the function picks it up.
3. **Set in GitHub repo:** Settings → Secrets and variables → Actions → New repository secret:
   - `PROD_BASE_URL = https://your-vercel-domain.com`
   - `CRON_SECRET = <same value as Vercel>`
4. **Smoke-test via `workflow_dispatch`:** Actions tab → "Production cleanup crons" → "Run workflow" → confirm all 3 curl steps return HTTP 200.
5. **Confirm scheduled fires:** wait 24h; verify the next cleanup-sweep ran on schedule from the Actions tab history.

Once those five steps are done, the cron triggers are live in production. If `CRON_SECRET` is missing in Vercel, endpoints return `503 cron_not_configured` (operational signal — config gap, not auth failure). If the GH Actions secret doesn't match, endpoints return `401 unauthorized`.

For the full setup runbook (Vercel + Hetzner migration path), see `docs/production-cron.md`.

## Self-Check: PASSED

- [x] `.github/workflows/cron.yml` exists (38 lines)
- [x] `server/services/cleanup-cron.service.ts` header expanded (commit `640cb00`)
- [x] Commit `952f614` exists in `git log` (Task 3 — feat workflow file)
- [x] Commit `640cb00` exists in `git log` (Task 4 — docs header expansion)
- [x] `npm run check` exit 0
- [x] `npx js-yaml .github/workflows/cron.yml` exit 0
- [x] All 12 cron.yml grep checks pass
- [x] All 6 cleanup-cron.service.ts grep checks pass
- [x] `git diff --stat server/services/cleanup-cron.service.ts` confirms header-only change (+18/-9)
- [x] All 5 reorg-doc markers present (CLAUDE.md, ARCHITECTURE.md, CONCERNS.md, docs/production-cron.md ×2)
- [x] Sealed files (server/index.ts, server/stripe.ts, server/routes/internal-cron.routes.ts, server/middleware/cron-auth.middleware.ts, server/config/index.ts, package.json, vercel.json) all untouched
