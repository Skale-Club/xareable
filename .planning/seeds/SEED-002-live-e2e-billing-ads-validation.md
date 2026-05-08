---
id: SEED-002
status: dormant
planted: 2026-05-08
planted_during: v1.1 milestone post-completion (plan/ folder review)
trigger_when: before any pricing model change, OR before promoting to paying customers in production, OR when ads attribution becomes business-critical
scope: Medium
---

# SEED-002: Live end-to-end validation harness — Stripe + GA4 + Facebook CAPI

## Why This Matters

Three independent integration surfaces are **fully implemented in code but never exercised against live third-party services with real credentials**:

1. **Stripe**
   - Pay-per-use credit top-up checkout
   - Stripe Connect onboarding for affiliates
   - Auto-recharge (off-session charge using saved payment method)
   - Affiliate commission payout via transfers
   - Subscription checkout (`POST /api/billing/subscribe`)
   - Customer portal (`POST /api/billing/portal`)
   - Weekly overage invoice generation (`runOverageBillingBatch`) — note: **scheduling itself is tracked separately as SEED-001**; this validation track exercises the function via the manual `/api/internal/billing/run-overage-batch` endpoint

2. **GA4 (Google Analytics 4)**
   - Admin config routes
   - Event delivery via Measurement Protocol
   - `trackMarketingEvent` wired in stripe/edit/transcribe/integrations routes (4+ call sites)
   - Per-event delivery status tracked in `marketing_events` table

3. **Facebook Conversions API**
   - Same posture as GA4: config, schemas, delivery, observability
   - Migration `20260305185606_facebook_conversions_api.sql` shipped

The `plan/in-progress/pay-per-use/00-overview.md` and `plan/in-progress/integrations-current-status.md` both flag "live validation pending" as the only remaining work for those tracks. We're depending on code-level review and unit tests; we have not seen real Stripe webhooks fire end-to-end against this code, nor confirmed GA4/Facebook events actually land in their dashboards.

## When to Surface

**Trigger:** before any of the following:
- Pricing changes (e.g., switching `billing_model` for production users, raising/lowering plan price)
- Onboarding paying customers at scale
- Removing the legacy code paths (we keep both `credits_topup` and `subscription_overage` because we haven't fully validated either)
- Ads-funded user acquisition (need confirmed attribution)
- Affiliate program launch (needs confirmed payout flow)

Also surface during `/gsd:new-milestone` if scope mentions: billing, payments, conversions, attribution, affiliate payouts, Stripe Connect.

## Scope Estimate

**Medium** — one phase that builds a repeatable validation harness rather than a one-time manual run. Components:

- Stripe test-mode E2E suite (subscription checkout → webhook → DB state → portal cancel → webhook → DB state; same for top-up, Connect, auto-recharge, overage batch)
- GA4 / Facebook delivery verification (real-event → check provider dashboard within N seconds; record `marketing_events` delivery status)
- Documented runbook + test fixtures so the validation can repeat after each Stripe/GA4/FB integration change

Could be smaller if we only do "ship-once smoke test" rather than a maintained harness.

## Breadcrumbs

Stripe:
- `server/stripe.ts` (1029 lines: checkout, subscriptions, Connect, auto-recharge, payout, overage batch)
- `server/routes/billing.routes.ts` — billing endpoints
- `server/routes/credits.routes.ts` — credit top-up + auto-recharge endpoints
- `server/routes/affiliate.routes.ts` — Connect onboarding
- `server/routes/stripe.routes.ts` — webhook handler

GA4 + Facebook:
- `server/integrations/marketing.ts` — `trackMarketingEvent`
- `server/integrations/facebook.ts`
- `server/routes/integrations.routes.ts` — admin config routes for GA4 + Facebook
- `supabase/migrations/20260305220000_marketing_events.sql`
- `supabase/migrations/20260307000000_integration_observability.sql`

Original plan docs (will be deleted with `plan/` folder; preserved here for context):
- `plan/in-progress/pay-per-use/00-overview.md` — "Remaining: live Stripe validation"
- `plan/in-progress/integrations-current-status.md` — "Run end-to-end QA for GA4 and Facebook Dataset with real credentials"
- `plan/in-progress/subscription-plus-overage/04-rollout.md` — Phase 2/3 soft-launch + GA criteria

## Notes

Coupled with SEED-001: validating the overage batch flow requires both the scheduler and a test scenario where pending_overage > 0 at cron time. Probably do them together.

The cost of a live-credentials test run is small (Stripe test mode is free; GA4 has DebugView; Facebook has Test Events tool). The cost of NOT doing it is high (silent revenue leak, broken attribution at scale).
