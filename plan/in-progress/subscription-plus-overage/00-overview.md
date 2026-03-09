# Subscription + Weekly Overage (Config-Driven)

## Goal

Move billing from prepaid top-ups to a hybrid model:

1. User subscribes to a recurring plan.
2. Plan includes a monthly credit allowance.
3. Extra usage above allowance is accumulated and charged in weekly batches.

This plan is fully configuration-driven. No business values (price, included credits, cadence) are hardcoded in app logic.

## Non-Negotiable Rules

1. Plan price is configurable and can change over time.
2. Included monthly credits are configurable per plan.
3. Overage batch cadence is configurable (default weekly).
4. Stripe price IDs are stored in DB config, not source constants.
5. Billing math always uses micros (`1 USD = 1_000_000`) in backend and DB.

## Proposed Product Model

1. `plan_catalog` stores active plans (name, price, included credits, billing interval, Stripe product/price IDs).
2. Each user has one active subscription link (`user_billing_profile`).
3. Usage charges consume included credits first.
4. If included credits are exhausted, overage is added to `pending_overage_micros`.
5. A scheduled job creates one Stripe invoice item/invoice per user per cycle (weekly by default) and clears pending overage once paid.

## Why This Fits Your Objective

1. Predictable base revenue via recurring subscription.
2. Usage fairness: heavy users still pay more.
3. Storage/platform fixed costs can be covered by subscription base.
4. Future plan changes can be done by admin/config and Stripe dashboard mapping.

## Scope

Included:

1. DB model for config-driven plans + overage ledger.
2. Stripe subscription flow + webhook sync.
3. Weekly overage charging job.
4. Admin controls for plan/config values.
5. User billing page updates (plan, included credits, current overage, invoices).

Not included in first iteration:

1. Multi-currency.
2. Proration for mid-cycle plan upgrades/downgrades (can be phase 2).
3. Tax automation refinements beyond current Stripe defaults.

## Deliverables

1. [01-database.md](./01-database.md)
2. [02-backend.md](./02-backend.md)
3. [03-frontend-admin.md](./03-frontend-admin.md)
4. [04-rollout.md](./04-rollout.md)

