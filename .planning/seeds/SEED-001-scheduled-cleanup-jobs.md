---
id: SEED-001
status: graduated
planted: 2026-05-08
graduated: 2026-05-08
graduated_as: Phase 12 — Schedule billing overage batch via existing cleanup-cron service (v1.1)
graduated_to: Phase 14 — Wire production crons via HTTP triggers (v1.2; superseded the in-process scheduler with HTTP-trigger architecture for Vercel)
planted_during: post-Phase-11 review (after sync with main)
trigger_when: (graduated)
scope: Small
---

> **STATUS NOTE (2026-05-08):** This seed was graduated. The `runOverageBillingBatch()` scheduling was wired in Phase 12 via internal `node-cron`. Phase 14 then re-wired it via HTTP triggers + GitHub Actions because the internal scheduler doesn't run on Vercel. The seed body below is preserved for historical record.

---


# SEED-001: Wire `runOverageBillingBatch()` into the existing cron scheduler

## Why This Matters

Phase 11 (merged 2026-05-06) established a server-side `node-cron` scheduler in [`server/services/cleanup-cron.service.ts`](server/services/cleanup-cron.service.ts) that runs **two jobs every 6 hours**:
- `runTrashSweep()` — soft-deletes posts past their `expires_at`
- `runPurgeSweep()` — permanently deletes posts trashed > 30 days

Both jobs are registered by `startCronJobs()` called from [`server/index.ts`](server/index.ts) inside `httpServer.listen`. **The infrastructure pattern is now in place and proven.**

But the **billing overage batch was never added to that scheduler**. Today:

- [`server/stripe.ts:527`](server/stripe.ts:527) — `runOverageBillingBatch()` is implemented and tested in code
- [`server/routes/billing.routes.ts:649`](server/routes/billing.routes.ts:649) — `/api/internal/billing/run-overage-batch` endpoint exists
- **Nothing calls either of them on a schedule.** Pending overage accrued in `user_billing_profiles.pending_overage_micros` will accumulate until someone hits the internal endpoint manually.

The original spec ([`plan/in-progress/subscription-plus-overage/02-backend.md:42-58`](plan/in-progress/subscription-plus-overage/02-backend.md)) called for cadence from `billing_settings.overage_billing_cadence` (default weekly). Today no cadence runs.

This is the **only remaining gap** from the original "scheduled cleanup jobs" concern that wasn't closed by Phase 11. Posts cleanup is solved; billing isn't.

## When to Surface

**Trigger:** any of the following:
- Switching production users to `billing_model = "subscription_overage"` (the gap becomes a financial leak)
- Affiliate program scaling up (overage accrual feeds commission accounting)
- Quarterly financial reconciliation revealing unbilled overage in the ledger
- Admin notices `pending_overage_micros > 0` for users for longer than the configured cadence

Surface during `/gsd:new-milestone` if scope mentions: subscription billing, overage, financial reconciliation, Stripe invoice automation, billing accuracy.

## Scope Estimate

**Small** — the work is mechanical because the pattern is already established:

1. Add a third `cron.schedule(...)` call in [`server/services/cleanup-cron.service.ts`](server/services/cleanup-cron.service.ts) `startCronJobs()` that invokes `runOverageBillingBatch()`
2. Read cadence from `billing_settings.overage_billing_cadence` (default to weekly per the original spec) instead of hardcoding
3. Add error logging consistent with the existing `[Cron] *` log prefix pattern
4. Decide: keep the manual `/api/internal/billing/run-overage-batch` endpoint as a manual-trigger escape hatch, or remove it (Phase 11's `runTrashSweep` / `runPurgeSweep` are not exposed via HTTP — TRSH-06 explicit choice)

Likely 1–2 hours of work + verification.

## Breadcrumbs

Implementation already in place:
- [`server/stripe.ts:527`](server/stripe.ts:527) — `runOverageBillingBatch()`
- [`server/routes/billing.routes.ts:649`](server/routes/billing.routes.ts:649) — manual-trigger endpoint
- `billing_settings` table — `overage_billing_cadence` setting (per `20260309000000_subscription_overage_billing.sql`)

Pattern to copy:
- [`server/services/cleanup-cron.service.ts`](server/services/cleanup-cron.service.ts) — Phase 11 cron service (trash + purge)
- [`server/index.ts`](server/index.ts) — `startCronJobs()` invocation site

Phase 11 reference docs (live in repo):
- [.planning/phases/11-post-trash-and-automated-cleanup/11-RESEARCH.md](.planning/phases/11-post-trash-and-automated-cleanup/11-RESEARCH.md) — node-cron decision rationale (rejected pg_cron, rejected node-schedule)
- [.planning/phases/11-post-trash-and-automated-cleanup/11-02-SUMMARY.md](.planning/phases/11-post-trash-and-automated-cleanup/11-02-SUMMARY.md) — cron service implementation summary

Original plan (will be deleted with `plan/`; preserved here):
- `plan/in-progress/subscription-plus-overage/02-backend.md:42-58` — overage batch job spec

## Notes

This seed exists because Phase 11 solved half the cron problem. Phase 11's research explicitly considered "Standard Stack" decisions (`node-cron` v4.2.1, no pg_cron) — those decisions transfer directly to this gap. There is zero architectural ambiguity remaining; the work is "do the same thing, for billing."

The reason this didn't get folded into Phase 11 is that Phase 11 was scoped to posts trash/expiration only — billing is an unrelated domain. Reasonable scope choice; just leaves a known gap.
