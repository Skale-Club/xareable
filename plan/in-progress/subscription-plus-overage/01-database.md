# 01 - Database Changes

## Objectives

1. Model plans and billing config without hardcoded values.
2. Track monthly included credits and weekly overage accumulation.
3. Keep full ledger/audit trail.

## New Tables

### `billing_plans`

Fields:

1. `id uuid pk`
2. `plan_key text unique` (ex: `core`, `pro`, `starter`)
3. `display_name text`
4. `active boolean`
5. `billing_interval text check ('month','year')`
6. `stripe_product_id text null`
7. `stripe_price_id text null`
8. `included_credits_micros bigint not null`
9. `base_price_micros bigint not null`
10. `overage_enabled boolean not null default true`
11. `created_at`, `updated_at`

### `user_billing_profiles`

Fields:

1. `id uuid pk`
2. `user_id uuid unique fk auth.users`
3. `billing_plan_id uuid fk billing_plans`
4. `stripe_customer_id text`
5. `stripe_subscription_id text`
6. `subscription_status text`
7. `current_period_start timestamptz`
8. `current_period_end timestamptz`
9. `included_credits_remaining_micros bigint not null default 0`
10. `pending_overage_micros bigint not null default 0`
11. `overage_last_billed_at timestamptz null`
12. `created_at`, `updated_at`

### `billing_ledger`

Single source of truth for billing movements.

Fields:

1. `id uuid pk`
2. `user_id uuid fk auth.users`
3. `entry_type text`  
   Allowed: `included_credit_grant`, `included_credit_usage`, `overage_accrual`, `overage_invoice`, `overage_payment`, `manual_adjustment`, `refund`
4. `amount_micros bigint` (sign-based; positive/negative by convention)
5. `balance_included_after_micros bigint null`
6. `pending_overage_after_micros bigint null`
7. `usage_event_id uuid null fk usage_events`
8. `stripe_invoice_id text null`
9. `stripe_payment_intent_id text null`
10. `metadata jsonb`
11. `created_at timestamptz`

### `billing_settings`

Global runtime config (admin-editable).

Fields:

1. `setting_key text unique`  
   Examples: `default_plan_key`, `overage_billing_cadence`, `overage_min_invoice_micros`, `grace_period_days`
2. `setting_value jsonb`
3. `updated_by uuid`
4. `updated_at timestamptz`

## Existing Tables Reuse

1. `usage_events`: remains source of cost data.
2. `profiles`: role checks / admin / affiliate.
3. `credit_transactions` and `user_credits`: kept during migration window, then deprecated in phase 2.

## Migration Strategy

1. Add new tables and RLS.
2. Backfill `user_billing_profiles` for existing users.
3. Keep old credit flow running behind a feature flag while validating.
4. Switch read/write paths to new model.
5. Retire old tables after stable period.

## Constraints / Safety

1. Unique index for `stripe_invoice_id` where not null in `billing_ledger`.
2. Unique index for `stripe_payment_intent_id` where not null.
3. Check constraints to avoid impossible negative states for stored balances.

