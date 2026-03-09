# 04 - Rollout Plan

## Phase 0 - Preparation

1. Add DB migrations and RLS for new billing tables.
2. Add admin config screens for plans/settings.
3. Keep old pay-per-use top-up flow active.

## Phase 1 - Parallel Readiness

1. Implement new Stripe subscription endpoints/webhooks.
2. Implement overage batch job (disabled by feature flag).
3. Backfill billing profiles for existing users.

## Phase 2 - Soft Launch

1. Enable `billing_model=subscription_overage` for internal/test users.
2. Validate:
   - subscription creation
   - monthly included grant/reset
   - overage accumulation
   - weekly invoice success/failure handling

## Phase 3 - General Availability

1. Enable for all new users.
2. Migrate existing users in cohorts.
3. Keep fallback path to previous model for rollback window.

## Phase 4 - Cleanup

1. Remove old top-up UI paths.
2. Deprecate old routes after stabilization.
3. Archive old tables only after full reconciliation.

## Acceptance Checklist

1. No hardcoded plan price/credits in backend/frontend.
2. Changing plan values in admin changes runtime behavior without code deploy.
3. Every Stripe charge has matching ledger row.
4. Failed weekly overage charge does not lose pending amount.
5. Replayed webhook does not duplicate credits/charges.

