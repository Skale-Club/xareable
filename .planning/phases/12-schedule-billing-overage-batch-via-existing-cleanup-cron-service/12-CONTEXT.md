# Phase 12: Schedule billing overage batch via existing cleanup-cron service - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Direct authoring (graduated from SEED-001; copies Phase 11 pattern)

<domain>
## Phase Boundary

Add a third scheduled job to `server/services/cleanup-cron.service.ts` that invokes `runOverageBillingBatch()` on the cadence stored in `billing_settings.overage_billing_cadence` (default weekly). Decide whether to remove or keep the manual `POST /api/internal/billing/run-overage-batch` endpoint per TRSH-06 precedent.

In scope:
- One new `cron.schedule(...)` call inside `startCronJobs()` in [`server/services/cleanup-cron.service.ts`](server/services/cleanup-cron.service.ts)
- Read cadence from `billing_settings.overage_billing_cadence` (a row in the `billing_settings` table); fall back to weekly if missing
- Logging consistent with the existing `[Cron] *` prefix pattern (see `runTrashSweep` / `runPurgeSweep` log lines)
- Decision on `/api/internal/billing/run-overage-batch` endpoint (keep as manual escape hatch, mirroring how Phase 11 kept `/api/posts/cleanup` for backwards compat)

Out of scope:
- Modifying `runOverageBillingBatch()` itself (already implemented and tested in code at [`server/stripe.ts:527`](server/stripe.ts:527))
- Adding new tables, columns, or migrations
- Changing how overage is accrued or billed (only WHEN it runs)
- Live Stripe E2E validation (covered separately by SEED-002)
- Frontend changes (this is server-only)

</domain>

<decisions>
## Implementation Decisions

### Cron registration
- Add the new schedule inside the existing `startCronJobs()` function in `server/services/cleanup-cron.service.ts` (do not create a new cron file — this is the canonical scheduler location)
- The new job runs `runOverageBillingBatch()` already exported from `server/stripe.ts`
- Log on entry, on success (with count), and on error — match the existing pattern in `runTrashSweep` / `runPurgeSweep`

### Cadence
- Read `billing_settings.overage_billing_cadence` at startup (or per-tick — planner decides)
- Convert to a cron expression. Supported values from spec: `weekly` (default), `daily`, `hourly`, etc. — at minimum support `weekly` (`0 0 * * 0` Sunday midnight UTC)
- Fall back to `weekly` if the setting is missing or unrecognized

### Manual endpoint decision (TRSH-06 precedent)
- Phase 11's TRSH-06 explicitly removed HTTP-driven cleanup (cron only). But the original `/api/posts/cleanup` admin endpoint was kept for backwards compat (per [.planning/phases/11-post-trash-and-automated-cleanup/11-RESEARCH.md:15](.planning/phases/11-post-trash-and-automated-cleanup/11-RESEARCH.md))
- **Decision:** keep `/api/internal/billing/run-overage-batch` as a manual-trigger escape hatch (admin-only). Useful for: smoke tests, recovery after a missed cron tick, support investigations. Mirrors Phase 11 choice.
- Do NOT remove the endpoint or its handler

### Concurrency
- If a cron tick fires while the previous tick is still running, skip the new tick (do not double-charge users). Use a simple in-process boolean lock — pattern: `if (overageBatchRunning) return; overageBatchRunning = true; try { ... } finally { overageBatchRunning = false; }`

### Claude's Discretion
- Where to read `billing_settings` — likely via `getBillingSetting()` in `server/stripe.ts` (already exists per `getBillingModel` pattern)
- Whether to read cadence once at startup or per-tick (if per-tick, requires `cron.schedule` swap or higher-frequency tick that gates internally — recommend: read once at startup, log a warning if changed mid-run)
- Default cron expression for "weekly" — Sunday 00:00 UTC is conventional, but Phase 11 uses every-6-hours offsets; planner can pick

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 11 cron pattern (the template to copy)
- [server/services/cleanup-cron.service.ts](server/services/cleanup-cron.service.ts) — `startCronJobs()`, `runTrashSweep()`, `runPurgeSweep()`. Logging style, error handling, `node-cron` invocation pattern.
- [server/index.ts](server/index.ts) — where `startCronJobs()` is called from `httpServer.listen` callback. Phase 12 does NOT need to touch this file (already wired).
- [.planning/phases/11-post-trash-and-automated-cleanup/11-02-SUMMARY.md](.planning/phases/11-post-trash-and-automated-cleanup/11-02-SUMMARY.md) — Phase 11's cron service implementation summary; defines the precedent.
- [.planning/phases/11-post-trash-and-automated-cleanup/11-RESEARCH.md](.planning/phases/11-post-trash-and-automated-cleanup/11-RESEARCH.md) — node-cron decision rationale (rejected pg_cron, rejected node-schedule).

### Overage batch implementation (the function to schedule)
- [server/stripe.ts:527](server/stripe.ts:527) — `runOverageBillingBatch()` definition. Returns `{ ... }` with batch result.
- [server/routes/billing.routes.ts:649](server/routes/billing.routes.ts:649) — `POST /api/internal/billing/run-overage-batch` endpoint that already calls it. Keep this; do not remove.
- [server/stripe.ts](server/stripe.ts) — `getBillingSetting(key)` helper for reading `billing_settings` rows.

### Database schema for billing_settings
- [supabase/migrations/20260309000000_subscription_overage_billing.sql](supabase/migrations/20260309000000_subscription_overage_billing.sql) — `billing_settings` table definition.
- [supabase/migrations/20260309232557_billing_token_pricing_profit_share_statement.sql](supabase/migrations/20260309232557_billing_token_pricing_profit_share_statement.sql) — additional billing settings rows including the `overage_billing_cadence` setting key (verify exact key name).

### Project conventions
- [CLAUDE.md](CLAUDE.md) — general project instructions
- node-cron is already a dependency (added by Phase 11): `node-cron@^4.2.1` in `package.json`

</canonical_refs>

<specifics>
## Specific Ideas

The new cron block in `startCronJobs()` should look structurally similar to:

```typescript
// (already-existing trash + purge sweeps above)

// New overage billing sweep (Phase 12)
const overageCronExpr = await resolveOverageCronExpression(); // reads billing_settings.overage_billing_cadence
let overageBatchRunning = false;
cron.schedule(overageCronExpr, async () => {
  if (overageBatchRunning) {
    console.log("[Cron] Overage batch skipped — previous run still in progress");
    return;
  }
  overageBatchRunning = true;
  console.log("[Cron] Overage batch starting");
  try {
    const result = await runOverageBillingBatch();
    console.log(`[Cron] Overage batch: processed ${result.processed} user(s)`);
  } catch (err) {
    console.error("[Cron] Overage batch failed:", err);
  } finally {
    overageBatchRunning = false;
  }
});
```

The `resolveOverageCronExpression` helper should:
1. Query `billing_settings` for `setting_key = 'overage_billing_cadence'`
2. Map known values to cron expressions: `weekly` → `0 0 * * 0`, `daily` → `0 0 * * *`, `hourly` → `0 * * * *`
3. Fall back to weekly + log a warning if value is missing or unknown

</specifics>

<deferred>
## Deferred Ideas

- Per-user cadence override (today the cadence is global; per-user could come later if users on different plans bill on different schedules)
- Cron observability dashboard (admin UI showing last run time, success/failure, next run) — out of scope; logs are sufficient for v1.1
- Live Stripe E2E validation of the overage batch flow with real test-mode credentials — tracked in SEED-002

</deferred>

---

*Phase: 12-schedule-billing-overage-batch-via-existing-cleanup-cron-service*
*Context gathered: 2026-05-08*
