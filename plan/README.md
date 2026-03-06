# Project Plans & Documentation Index

This folder contains all planning documents for the My Social Autopilot project, organized by implementation status.

## Folder Structure

```
plan/
├── completed/      # Fully implemented features
├── in-progress/    # Partially implemented or actively being worked on
├── pending/        # Not yet started
└── README.md       # This file
```

---

## Completed Plans

### Billing System (Legacy Subscription)
**Folder:** [`completed/legacy-subscription-billing/`](completed/legacy-subscription-billing/)

The original subscription-based billing system with Stripe. This has been superseded by the pay-per-use model but the documentation is retained for reference.

| File | Description | Status |
|------|-------------|--------|
| [`00-overview.md`](completed/legacy-subscription-billing/00-overview.md) | Billing architecture overview | Replaced by pay-per-use |
| [`01-database.md`](completed/legacy-subscription-billing/01-database.md) | Database schema for subscriptions | Replaced by pay-per-use |
| [`02-stripe-setup.md`](completed/legacy-subscription-billing/02-stripe-setup.md) | Stripe configuration guide | Reference only |
| [`03-quota-system.md`](completed/legacy-subscription-billing/03-quota-system.md) | Quota checking logic | Replaced by credits |
| [`04-api-endpoints.md`](completed/legacy-subscription-billing/04-api-endpoints.md) | Billing API endpoints | Replaced by credits API |
| [`05-frontend.md`](completed/legacy-subscription-billing/05-frontend.md) | Frontend billing pages | Replaced by credits page |
| [`06-webhooks.md`](completed/legacy-subscription-billing/06-webhooks.md) | Stripe webhook handling | Reference only |
| [`07-env-variables.md`](completed/legacy-subscription-billing/07-env-variables.md) | Environment variables | Reference only |

### Admin Refactor
**File:** [`completed/admin-refactor-plan.md`](completed/admin-refactor-plan.md)

**Status:** COMPLETED

The admin page was refactored from a monolithic 1,799-line file into modular components:
- Extracted tab components to `client/src/components/admin/`
- Created custom hooks in `client/src/hooks/admin/`
- Created utility functions in `client/src/lib/admin/`

### Structural Improvements
**File:** [`completed/structural-improvements.md`](completed/structural-improvements.md)

**Status:** MOSTLY COMPLETED

Documented structural improvements with the following completed:
- Authentication middleware extraction
- Environment variable validation
- Error handling utilities
- Centralized configuration defaults
- Route modules creation
- Gemini service extraction
- Cleanup of incomplete files

### Centralized API Key + Token Cost Tracking
**Folder:** [`completed/tokens/`](completed/tokens/)

**Status:** COMPLETED

Migration from user-provided Gemini API keys to a centralized platform API key with token cost tracking.

| File | Description |
|------|-------------|
| [`00-overview.md`](completed/tokens/00-overview.md) | Overview and architecture |
| [`01-migration.md`](completed/tokens/01-migration.md) | SQL migration for token/cost columns |
| [`02-server-changes.md`](completed/tokens/02-server-changes.md) | Server-side changes |
| [`03-cost-calculation.md`](completed/tokens/03-cost-calculation.md) | Pricing model |
| [`04-frontend-changes.md`](completed/tokens/04-frontend-changes.md) | UI changes |
| [`05-env-setup.md`](completed/tokens/05-env-setup.md) | Environment setup guide |
| [`06-analytics-queries.md`](completed/tokens/06-analytics-queries.md) | SQL queries for reporting |

---

## In Progress

### Pay-Per-Use Billing System
**Folder:** [`in-progress/pay-per-use/`](in-progress/pay-per-use/)

**Status:** MOSTLY COMPLETE

Credit-based billing system replacing the subscription model.

| File | Description | Status |
|------|-------------|--------|
| [`00-overview.md`](in-progress/pay-per-use/00-overview.md) | Implementation status & architecture | Mostly complete |
| [`01-database-schema.md`](in-progress/pay-per-use/01-database-schema.md) | Database schema | Done |
| [`02-backend-api.md`](in-progress/pay-per-use/02-backend-api.md) | Backend implementation | Done |
| [`03-frontend-pages.md`](in-progress/pay-per-use/03-frontend-pages.md) | Frontend implementation | Done |

**Remaining Work:**
- End-to-end validation with real Stripe credentials
- Manual QA of full production flow

### GoHighLevel Integration
**File:** [`in-progress/ghl-integration-plan.md`](in-progress/ghl-integration-plan.md)

**Status:** PARTIALLY IMPLEMENTED

GHL integration for lead/contact synchronization.

**Completed:**
- Admin API routes (`GET/PATCH/POST /api/admin/ghl`)
- IntegrationsTab UI for GHL configuration
- Shared schemas for GHL settings

**Pending:**
- Create `marketing_events` table migration
- Add sync logic to lead completion flows
- Connect `trackMarketingEvent` in main flows

### Integrations Status (Telegram + Marketing Tracking)
**File:** [`in-progress/integrations-current-status.md`](in-progress/integrations-current-status.md)

**Status:** PARTIALLY COMPLETE

**Completed:**
- Telegram signup notifications
- GHL admin configuration

**Pending:**
- GA4 configuration routes and UI
- Facebook Dataset configuration routes and UI
- `marketing_events` table creation
- Marketing event tracking in main flows
- Admin UI for viewing tracked events

## Pending

_No pending plans at this time._

---

## Recently Completed

### Dynamic Translation
**File:** [`completed/translation-dynamic.md`](completed/translation-dynamic.md)

**Status:** COMPLETED (2026-03-05)

Completed dynamic UI translation with Gemini-backed cache (`public.translations`) and full `t()` wiring across user, shared, and admin surfaces while preserving generated content.

---

### Error Logging for Image Generation
**File:** [`completed/error-logging-generation.md`](completed/error-logging-generation.md)

**Status:** COMPLETED (2026-03-05)

Implemented error logging for failed post generations:
- Created `generation_logs` table via migration
- Added Zod schemas in shared/schema.ts
- Updated `/api/generate` to log failures by type (text_generation, image_generation, upload, database, unknown)
---

## Quick Reference

### By Feature Area

| Area | Plan Location | Status |
|------|---------------|--------|
| Billing (Subscription) | `completed/legacy-subscription-billing/` | Replaced |
| Billing (Pay-Per-Use) | `in-progress/pay-per-use/` | Mostly Done |
| Admin Refactor | `completed/admin-refactor-plan.md` | Done |
| Token Cost Tracking | `completed/tokens/` | Done |
| GHL Integration | `in-progress/ghl-integration-plan.md` | Partial |
| Telegram Notifications | `in-progress/integrations-current-status.md` | Done |
| GA4/Facebook Tracking | `in-progress/integrations-current-status.md` | In QA |
| Dynamic Translation | `completed/translation-dynamic.md` | Done |
| Error Logging | `completed/error-logging-generation.md` | Done |

### Priority Recommendations

1. **High Priority:**
   - Complete pay-per-use E2E validation with real Stripe
   - Run end-to-end validation for GA4/Facebook Dataset tracking in Admin and production-like flows

2. **Medium Priority:**
   - Maintain a translation regression checklist for key user/admin screens
   - Add a regression checklist for key generation/edit/transcribe flows

3. **Low Priority:**
   - Add filters/export controls for marketing events in Admin
   - Affiliate payout history UI improvements
