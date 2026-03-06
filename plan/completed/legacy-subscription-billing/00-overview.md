# Billing - Architecture Overview

## Billing Model

- **Free Trial**: 3 usage events (generations + edits). No card required. When exhausted, the user sees a banner and is redirected to the plans page.
- **Pro**: Fixed monthly fee via Stripe Subscriptions. Unlimited generations.
- Every usage event (generation and edit) is recorded in the `usage_events` table.

## General Flow

```
User clicks "Generate"
     |
     v
POST /api/generate
     |
     +--> checkQuota(userId)
     |      +-- Fetches user_subscriptions + subscription_plans
     |      +-- Counts usage_events in current period
     |      +-- If used >= limit -> 402 quota_exceeded
     |
     +--> [Gemini text + image generation]
     |
     +--> INSERT posts
     |
     +--> recordUsageEvent(userId, postId, 'generate')
            +--> INSERT usage_events
```

## Feature Files

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260302000000_stripe_billing.sql` | Creates billing tables + updated trigger |
| `server/stripe.ts` | Stripe client, checkout, portal, webhook |
| `server/quota.ts` | Quota check and usage event recording |
| `server/routes.ts` | Billing endpoints + quota checks in existing endpoints |
| `shared/schema.ts` | Billing types and Zod schemas |
| `client/src/pages/billing.tsx` | Plans and usage page |
| `client/src/components/app-sidebar.tsx` | Mini usage bar in sidebar footer |
| `client/src/App.tsx` | Registered `/billing` route |
