# Billing - Database

## New Tables

### `subscription_plans`

Defines the plans available on the platform. Managed manually (seed + Stripe Dashboard).

| Column | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT UNIQUE | Internal identifier: `free_trial`, `pro` |
| `display_name` | TEXT | Display name: "Free Trial", "Pro" |
| `stripe_price_id` | TEXT nullable | Stripe Price ID (example: `price_xxx`) |
| `monthly_limit` | INTEGER nullable | Monthly event limit. NULL = unlimited |
| `price_cents` | INTEGER | Price in cents (example: 9900 = $99) |
| `is_active` | BOOLEAN | Whether the plan is available for subscription |
| `created_at` | TIMESTAMPTZ | |

### `user_subscriptions`

One row per user. Automatically created by trigger when the user signs up.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK auth.users (UNIQUE) |
| `plan_id` | UUID nullable | FK subscription_plans |
| `stripe_customer_id` | TEXT nullable | Stripe customer ID |
| `stripe_subscription_id` | TEXT nullable | Stripe subscription ID |
| `status` | TEXT | `trialing` / `active` / `canceled` / `past_due` |
| `current_period_start` | TIMESTAMPTZ nullable | Start of current billing period |
| `current_period_end` | TIMESTAMPTZ nullable | End of current billing period |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### `usage_events`

One row per usage event (generation or edit).

| Column | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK auth.users |
| `post_id` | UUID nullable | FK posts (SET NULL if post is deleted) |
| `event_type` | TEXT | `generate` or `edit` |
| `created_at` | TIMESTAMPTZ | |

## RLS Policies

- `subscription_plans`: public read (`FOR SELECT USING (true)`)
- `user_subscriptions`: user can only read their own row (`auth.uid() = user_id`)
- `usage_events`: user can only read their own events (`auth.uid() = user_id`)
- Writes on all billing tables are done only through **service role** (backend), never from client code

## Updated Trigger

`handle_new_user()` now also inserts a row in `user_subscriptions` with `plan_id = free_trial` when a new user signs up.

## How to Apply

Run `supabase/migrations/20260302000000_stripe_billing.sql` in Supabase SQL Editor after the original `supabase-setup.sql`.

## Update stripe_price_id

After creating the product and price in Stripe Dashboard, run:

```sql
UPDATE subscription_plans
SET stripe_price_id = 'price_XXXXXXXXXXXXX'
WHERE name = 'pro';
```
