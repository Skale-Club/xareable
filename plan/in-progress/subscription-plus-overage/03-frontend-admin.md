# 03 - Frontend and Admin

## User-Facing Changes

### Replace Credits Purchase UX

Current `/credits` page becomes `/billing` view with:

1. Active plan name and subscription status.
2. Included credits total and remaining in current period.
3. Pending overage (estimated next weekly charge).
4. Next overage billing date.
5. Buttons: `Manage subscription`, `View invoices`.

Remove from primary path:

1. Manual top-up modal.
2. Auto-recharge controls (no longer needed in this model).

## Admin Controls

Add section in admin:

1. Manage `billing_plans` rows:
   - display name
   - base price micros
   - included credits micros
   - interval
   - stripe price id
   - active
2. Manage `billing_settings`:
   - default plan
   - overage cadence
   - minimum overage invoice amount
   - feature flag for active billing model

Everything editable from UI and persisted in DB. No hardcoded plan values.

## API Integration (Client)

1. Query `GET /api/billing/me` for current state.
2. Trigger `POST /api/billing/subscribe`.
3. Trigger `POST /api/billing/portal`.
4. Show ledger/invoice history from `GET /api/billing/ledger`.

## UX Notes

1. Clear split in UI:
   - Included usage (covered by plan)
   - Overage usage (charged in next batch)
2. Show exact date/time for next overage run.
3. Warn user if subscription is past_due/incomplete.

