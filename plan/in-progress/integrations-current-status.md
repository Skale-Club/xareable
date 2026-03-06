# Current Integrations Status (Telegram + Ads Tracking)

**Last Updated:** 2026-03-05
**Status:** MOSTLY COMPLETE (implementation done, validation pending)

## Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Telegram Signup Notifications | DONE | Fully implemented |
| GHL Admin Configuration | DONE | Routes and UI complete |
| GA4 Configuration | DONE | Admin routes and UI implemented |
| Facebook Dataset Configuration | DONE | Admin routes and UI implemented |
| Marketing Events Table | DONE | Migration created and schema wired |
| Event Tracking in Flows | DONE | Wired in signup/generate/edit/transcribe |

## Remaining Work (Current)

- [ ] Run end-to-end QA for GA4 and Facebook Dataset with real credentials.
- [ ] Confirm delivery/status behavior in `GET /api/admin/marketing-events`.
- [ ] Validate rollback/fallback behavior when provider APIs fail.

---

## Requested Scope
- Adjust Telegram to notify on new signup.
- Prepare the structure for GA4 + Facebook Dataset.
- Save and show all tracked events in Admin.

## What Was Already Completed

### Telegram (COMPLETED)
- [x] Config field changed from `notify_on_new_chat` to `notify_on_new_signup` (with backward compatibility).
- [x] Admin UI updated to reflect "Notify on new signup".
- [x] Signup notification flow implemented with dedicated endpoint:
  - `POST /api/telegram/notify-signup`
- [x] Telegram message includes user data (email, user id, provider, created_at, and referrer when present).
- [x] Idempotency implemented to avoid duplicate notifications.
- [x] Migration created for idempotency support:
  - `supabase/migrations/20260305203000_telegram_signup_notifications.sql`

### Frontend/Auth (COMPLETED for Telegram)
- [x] `client/src/lib/auth.tsx` calls the notification endpoint after authentication.

### Quality
- [x] `npm run check` already passed after Telegram changes.

## What Was Started (partial, not finalized yet)
- [~] New marketing tracking service:
  - `server/integrations/marketing.ts` (created, needed wiring at that time)
- [~] Additional Facebook files present in workspace, but full system flow was still open at that time:
  - `server/integrations/facebook.ts` (created, needed integration)
  - `supabase/migrations/20260305185606_facebook_conversions_api.sql` (created, needed consolidation)

## Outstanding Work (Historical Checklist)

### Database / Schema
- [ ] Create final marketing events structure (for example, table `marketing_events`).
- [ ] Create idempotent migration for:
  - event logging;
  - GA4 and Facebook Dataset delivery status;
  - deduplication by `event_key`.
- [ ] Update `supabase-setup.sql` with this structure.
- [ ] Update `shared/schema.ts` with:
  - GA4 config/status schemas;
  - Facebook Dataset config/status schemas;
  - marketing events list schema.

### Backend (Admin)
- [ ] Implement GA4 config routes:
  - `GET /api/admin/ga4`
  - `PUT /api/admin/ga4`
  - `POST /api/admin/ga4/test`
- [ ] Implement Facebook Dataset config routes:
  - `GET /api/admin/facebook-dataset`
  - `PUT /api/admin/facebook-dataset`
  - `POST /api/admin/facebook-dataset/test`
- [ ] Implement route to read tracked events:
  - `GET /api/admin/marketing-events`
- [ ] Include GA4 and Facebook Dataset flags in global integrations status (`/api/admin/integrations/status`).

### Backend (Real Event Tracking)
- [ ] Connect automatic tracking in main flows:
  - signup
  - generate
  - edit
  - transcribe
- [ ] Guarantee safe fallback: tracking errors must not break main flow.

### Frontend Admin
- [ ] Add cards in `IntegrationsTab` for:
  - GA4
  - Facebook Dataset
- [ ] Add an "Tracked Events" block/table in Admin with:
  - event, source, user/email, date, GA4 status, Facebook status.

### Finalization
- [ ] Run `npm run check`.
- [ ] End-to-end manual test in Admin:
  - save config;
  - test connection;
  - generate a real event and verify log + status.

## Current State of Modified Files in Workspace
- `client/src/components/admin/integrations-tab.tsx`
- `client/src/lib/auth.tsx`
- `client/src/lib/translations.ts`
- `server/routes/integrations.routes.ts`
- `shared/schema.ts`
- `supabase-setup.sql`
- `server/integrations/marketing.ts` (new)
- `server/integrations/facebook.ts` (new, not fully consolidated at the time)
- `supabase/migrations/20260305185606_facebook_conversions_api.sql` (new, not fully consolidated at the time)
- `supabase/migrations/20260305203000_telegram_signup_notifications.sql` (new)

## Continuation (after pull on 2026-03-05)

### What advanced after the status above

#### GHL (admin/configuration) - COMPLETED
- [x] Routes already exist and are registered:
  - `GET /api/admin/ghl`
  - `PATCH /api/admin/ghl`
  - `POST /api/admin/ghl/test`
  - `GET /api/admin/ghl/custom-fields`
- [x] `IntegrationsTab` already has a GHL card with:
  - save credentials;
  - test connection;
  - enable/disable integration;
  - status display.
- [x] `shared/schema.ts` already contains GHL schemas (`adminGHLStatusSchema`, `saveGHLSettingsRequestSchema`, etc).

#### Telegram (signup notify) - COMPLETED
- [x] Still functional in current flow:
  - endpoint `POST /api/telegram/notify-signup`;
  - frontend call in `client/src/lib/auth.tsx`.

### Technical gaps found while reviewing the code at that time

#### Marketing events not closed at that review point
- [ ] `server/integrations/marketing.ts` already sends to GA4/Facebook Dataset and tries to persist in `marketing_events`.
- [ ] However, at that moment there was no migration creating `marketing_events` in current migrations.
- [ ] Also, `supabase-setup.sql` did not include `marketing_events`.
- [ ] Result: if this service was called then, persistence could fail because the table was missing.

#### GA4/Facebook Dataset Admin routes were still missing at that review point
- [ ] Planned routes did not exist yet:
  - `GET/PUT/POST /api/admin/ga4`
  - `GET/PUT/POST /api/admin/facebook-dataset`
  - `GET /api/admin/marketing-events`
- [ ] In `integrations.routes.ts`, only GTM, GHL, and Telegram existed at that time.

#### Facebook naming inconsistency
- [ ] `marketing.ts` looked for `integration_type = "facebook_dataset"`.
- [ ] Migration `20260305185606_facebook_conversions_api.sql` created default with `integration_type = "facebook"`.
- [ ] Needed unification to avoid empty configuration lookup in tracking.

#### Automatic tracking was not wired in main flows at that review point
- [ ] No usage of `trackMarketingEvent(...)` in:
  - signup
  - generate
  - edit
  - transcribe
- [ ] Wiring still needed with non-blocking try/catch (tracking errors should not break main flow).

#### Frontend Admin still lacked a tracked-events block at that review point
- [ ] `IntegrationsTab` covered GHL and Telegram only.
- [ ] Still needed UI for:
  - GA4 configuration;
  - Facebook Dataset configuration;
  - tracked events table/list with delivery status.

## Recommended Next Block (practical order)
1. Create `marketing_events` migration + `event_key` index + GA4/Facebook response/status fields + `processed_at`.
2. Update `supabase-setup.sql` with `marketing_events`.
3. Unify Facebook `integration_type` (`facebook_dataset` or `facebook`) in migration + backend.
4. Add missing schemas in `shared/schema.ts` (GA4, Facebook Dataset, events list).
5. Implement GA4/Facebook/marketing-events admin routes.
6. Integrate `trackMarketingEvent` in signup/generate/edit/transcribe with non-blocking try/catch.
7. Add GA4/Facebook cards and events table in `IntegrationsTab`.
8. Run `npm run check` and end-to-end manual test in admin.
