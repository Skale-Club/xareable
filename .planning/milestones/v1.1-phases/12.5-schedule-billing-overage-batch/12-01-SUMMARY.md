---
phase: 12-schedule-billing-overage-batch-via-existing-cleanup-cron-service
plan: 01
subsystem: infra
tags: [node-cron, billing, stripe, cron, scheduling, overage]

# Dependency graph
requires:
  - phase: 11-post-trash-and-automated-cleanup
    provides: node-cron registered in startCronJobs() called from server/index.ts httpServer.listen callback; [Cron] log convention
provides:
  - Scheduled overage billing batch invoking runOverageBillingBatch() on cadence-derived cron expression
  - resolveOverageCronExpression() helper mapping billing_settings.overage_billing_cadence_days (int) to cron expression
  - In-process boolean lock (overageBatchRunning) preventing overlapping invocations from double-charging
  - [Cron] Overage * log convention for skipped/starting/processed-result/failed paths
affects: [billing, subscription-overage, future-billing-cadence-changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cadence-driven cron expression resolved once at startup (not per-tick) — the expression itself is fixed at registration time; the inner per-user cadence-due gate inside runOverageBillingBatch() still enforces the exact day count regardless of cron frequency"
    - "In-process boolean lock around long-running cron callbacks — guard early return + try/finally reset"
    - "[Cron] Overage * log prefix consistent with existing [Cron] Trash * and [Cron] Purge * convention from Phase 11"
    - "Manual admin endpoints kept as escape hatches for cron-driven jobs (TRSH-06 precedent extended)"

key-files:
  created: []
  modified:
    - "server/services/cleanup-cron.service.ts"

key-decisions:
  - "Schema deviation: CONTEXT.md sketched a string-valued billing_settings.overage_billing_cadence (weekly/daily/hourly) but the real key is overage_billing_cadence_days (integer days). Used the existing getOverageBillingCadenceDays() helper from server/stripe.ts and mapped int → cron expression (1→daily, 7→weekly, 30→monthly, else weekly with warn)"
  - "Success-log shape correction: runOverageBillingBatch() returns {processed, charged, skipped} (verified at server/stripe.ts:527). Logged all three fields; CONTEXT.md sketch logged only processed which would drop information operators need"
  - "Manual endpoint POST /api/internal/billing/run-overage-batch left untouched as admin escape hatch (CONTEXT.md decisions block, mirrors Phase 11 TRSH-06 precedent for /api/posts/cleanup)"
  - "startCronJobs() signature changed from sync void to async Promise<void> to await the cadence resolution; server/index.ts already calls it fire-and-forget inside the listen callback so no caller change required"
  - "Cadence resolved ONCE at startup (not per-tick). Trade-off: changing billing_settings.overage_billing_cadence_days requires a server restart to re-register at new frequency. Acceptable for v1.1 since cadence rarely changes; per-user cadence-due gate inside runOverageBillingBatch() still enforces the exact day count even if the outer cron fires too often"

patterns-established:
  - "Pattern 1: Cadence-driven cron registration — read setting at startup via existing getter helper, map to cron expression in a switch, fall back to safe default with console.warn on unknown values"
  - "Pattern 2: Concurrency lock for overlap-sensitive cron jobs — module-scoped boolean, early-return guard with [Cron] *skipped* log, set true before work, reset in finally"
  - "Pattern 3: Async startCronJobs — the function is async because at least one schedule needs awaited setup; trash + purge schedules register synchronously before the await, the awaited overage schedule registers right after"

requirements-completed: []

# Metrics
duration: 9min
completed: 2026-05-08
---

# Phase 12 Plan 01: Schedule billing overage batch via cleanup-cron service Summary

**Third cron job added to startCronJobs() invoking runOverageBillingBatch() on a cadence-derived expression (1d/7d/30d → daily/weekly/monthly cron) with in-process boolean lock preventing overlapping invocations**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-08T13:12:22Z
- **Completed:** 2026-05-08T13:21:40Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Imported `runOverageBillingBatch` and `getOverageBillingCadenceDays` from `../stripe.js` into `server/services/cleanup-cron.service.ts`
- Added `resolveOverageCronExpression()` helper that maps billing_settings.overage_billing_cadence_days → cron expression (1→`0 0 * * *`, 7→`0 0 * * 0`, 30→`0 0 1 * *`, else weekly with `console.warn`)
- Added module-scoped `overageBatchRunning` boolean lock to prevent overlapping invocations from double-charging users
- Changed `startCronJobs()` from sync `void` to `async Promise<void>` so it can `await resolveOverageCronExpression()` at startup
- Registered third `cron.schedule(...)` block invoking `runOverageBillingBatch()` with all four `[Cron] Overage *` log paths (skipped / starting / processed-result with charged+skipped / failed)
- Updated bottom-of-startCronJobs registration log line to mention the new `overage-batch (<cronExpr>)` job
- Manual `POST /api/internal/billing/run-overage-batch` endpoint at `server/routes/billing.routes.ts:649` confirmed UNCHANGED (admin escape hatch preserved per TRSH-06 precedent)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add resolveOverageCronExpression() helper + imports** — `485c2f3` (feat)
2. **Task 2: Add overage batch cron.schedule + concurrency lock + updated registration log** — `39d23ba` (feat)

**Plan metadata:** `8863949` (docs: complete plan — SUMMARY + STATE + ROADMAP)

## Files Created/Modified

- `server/services/cleanup-cron.service.ts` — Added stripe.ts imports (runOverageBillingBatch, getOverageBillingCadenceDays), `resolveOverageCronExpression()` helper, `overageBatchRunning` lock variable, third `cron.schedule(...)` block for overage billing, and updated registration log line

## Decisions Made

- **Schema name correction:** CONTEXT.md sketch referenced a string `overage_billing_cadence` setting (`weekly`/`daily`/`hourly`); the real schema is integer `overage_billing_cadence_days` (verified via `server/stripe.ts:114-121` — `getOverageBillingCadenceDays()` already exists returning a number with default 7 and floor 1). Used the existing helper and mapped int → cron expression. This honors CONTEXT.md's INTENT (cadence-driven cron read at startup) while using the real schema.
- **Success-log shape correction:** `runOverageBillingBatch()` returns `{processed, charged, skipped}` (verified at `server/stripe.ts:527-531`), not just `{processed}` as the CONTEXT.md sketch logged. The success log destructures all three so operators can see how many users were charged vs skipped (e.g., for inactive subscriptions, missing customer ID, sub-minimum pending amount, or cadence-not-due).
- **Read cadence ONCE at startup, not per-tick:** Re-reading per-tick would not actually change the registered cron schedule (node-cron locks the expression at `cron.schedule(...)` time). Re-registering on every cadence change would require dynamic schedule swapping or higher-frequency ticks that gate internally — overkill for v1.1. Acceptable because the inner per-user `cadenceDue` gate inside `runOverageBillingBatch()` already enforces the exact day count regardless of how often the outer cron fires. Setting changes require a restart to take effect.
- **Manual endpoint kept (TRSH-06 precedent extended):** `POST /api/internal/billing/run-overage-batch` at `server/routes/billing.routes.ts:649` left intact. Useful for smoke tests, recovery after a missed cron tick, and support investigations. Mirrors Phase 11's choice to keep `/api/posts/cleanup` as a manual admin escape hatch.
- **Async `startCronJobs` does NOT require updating `server/index.ts`:** It is already called fire-and-forget inside the `httpServer.listen` callback (per Phase 11 11-02-SUMMARY.md). The trash + purge schedules register synchronously before the await; the overage schedule registers right after `await resolveOverageCronExpression()` resolves. No caller changes needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored missing node_modules dependencies**
- **Found during:** Task 1 (verification — `npm run check`)
- **Issue:** `npm run check` failed with `error TS2307: Cannot find module 'node-cron' or its corresponding type declarations.` Confirmed via `git stash` of my edits that the error pre-existed (the workspace's `node_modules/` was empty: `npm ls node-cron @types/node-cron` returned an empty tree even though `package.json` had both declared). This was a stale workspace, not a regression from my changes.
- **Fix:** Ran `npm install` to restore the dependency tree. After install, `npm ls node-cron @types/node-cron` showed `node-cron@4.2.1` and `@types/node-cron@3.0.11`, and `npm run check` exited 0.
- **Files modified:** None (no source files; this restored `node_modules/` which is gitignored). No `package.json` or `package-lock.json` change required since both packages were already declared.
- **Verification:** `npm run check` exits 0 after install; same command failed before install. Pre-existing nature confirmed via git stash diff.
- **Committed in:** N/A (no source change to commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Pre-existing environment issue (empty node_modules), not a scope or design issue. Recovery was a single `npm install`. Both source-file edits and `npm run check` exit 0 results match the plan exactly.

## Issues Encountered

None beyond the deviation above. Plan tasks executed in the order specified, both `npm run check` runs after each task exited 0, and all acceptance criteria greps returned the expected counts (Task 1: 8/8; Task 2: 9/9).

## User Setup Required

None — no external service configuration needed. Cron is in-process. The cadence is read from the existing `billing_settings.overage_billing_cadence_days` row (created by an earlier migration) with a safe default of 7 days when missing.

**Operational notes:**
- To verify the boot smoke: run `npm run dev`. After the `serving on port` log line, you should see: `[Cron] Jobs registered: trash-sweep (every 6h), purge-sweep (every 6h +30m), overage-batch (0 0 * * 0)` (or a different cron expr if `overage_billing_cadence_days` is set to 1 or 30).
- To change cadence: set `billing_settings.overage_billing_cadence_days` to 1, 7, or 30 via Supabase SQL editor and restart the dev server. Other values will register weekly with a `[Cron] Unrecognized overage cadence N day(s); defaulting to weekly` warn line.

## Next Phase Readiness

- Phase 12 acceptance: PASS. The billing overage batch is now scheduled automatically on the same node-cron infrastructure introduced by Phase 11.
- The manual escape hatch at `POST /api/internal/billing/run-overage-batch` continues to work for admin-driven smoke tests and recovery.
- No follow-up phase is queued in the v1.1 roadmap for this; Phase 12 closes the gap left by Phase 11 (cron infrastructure existed; only trash + purge were scheduled).
- Live Stripe E2E validation of the overage batch flow with real test-mode credentials remains tracked in SEED-002 (deferred per CONTEXT.md `<deferred>`).

## Self-Check: PASSED

- FOUND: `server/services/cleanup-cron.service.ts`
- FOUND: `.planning/phases/12-schedule-billing-overage-batch-via-existing-cleanup-cron-service/12-01-SUMMARY.md`
- FOUND commit `485c2f3` (Task 1)
- FOUND commit `39d23ba` (Task 2)

---
*Phase: 12-schedule-billing-overage-batch-via-existing-cleanup-cron-service*
*Completed: 2026-05-08*
