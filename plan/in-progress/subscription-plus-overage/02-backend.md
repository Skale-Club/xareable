# 02 - Backend/API and Stripe

## Objectives

1. Create/manage subscriptions with DB-configured Stripe price IDs.
2. Consume included credits first, then accrue overage.
3. Batch-charge overage on configured cadence (default weekly).

## Stripe Flows

### Subscription Checkout

1. `POST /api/billing/subscribe`
2. Input: `planKey` (or defaults from `billing_settings`).
3. Server resolves plan from `billing_plans` and uses `stripe_price_id`.
4. Creates Stripe Checkout session (`mode=subscription`).
5. Success webhook updates `user_billing_profiles`.

### Webhooks

Handle:

1. `checkout.session.completed`
2. `customer.subscription.updated`
3. `customer.subscription.deleted`
4. `invoice.paid`
5. `invoice.payment_failed`

All handlers idempotent by Stripe event ID + invoice/payment unique constraints.

## Usage Charging Logic

In `deductCredits` replacement (`applyUsageCharge`):

1. Read `cost_usd_micros` from `usage_events`.
2. Apply markup rules (existing admin settings can still be reused).
3. Consume from `included_credits_remaining_micros`.
4. If not enough included balance, move remainder to `pending_overage_micros`.
5. Write ledger entries for both parts.

## Overage Batch Charging Job

### New Scheduled Worker

Runs on cadence from `billing_settings.overage_billing_cadence`:

1. Select users with `pending_overage_micros > 0` and active subscription.
2. If above `overage_min_invoice_micros`, create Stripe invoice item.
3. Finalize/pay invoice.
4. On success: ledger `overage_invoice` + `overage_payment`, clear pending.
5. On failure: keep pending, mark retry metadata.

Implementation options:

1. Cron endpoint + external scheduler.
2. Supabase scheduled function.
3. Background worker process.

## New API Endpoints

1. `GET /api/billing/me`  
   Returns plan, included remaining, pending overage, status.
2. `POST /api/billing/subscribe`
3. `POST /api/billing/portal` (Stripe customer portal)
4. `GET /api/billing/ledger`
5. `POST /api/internal/billing/run-overage-batch` (protected)

## Feature Flags

Use config flag in `billing_settings`:

1. `billing_model = "credits_topup" | "subscription_overage"`
2. Allow staged rollout and rollback without redeploy.

## Key Risks

1. Double charge risk without strict idempotency.
2. Partial failures between DB write and Stripe call.
3. Race conditions with concurrent usage events.

Mitigation:

1. Transactional DB updates where possible.
2. Idempotency keys in Stripe calls.
3. Retry-safe status fields in job records.

