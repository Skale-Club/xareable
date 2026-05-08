# Requirements: My Social Autopilot — v1.4 GHL Signup Sync

**Defined:** 2026-05-08
**Core Value:** Users can generate on-brand visual content (single posts, multi-slide carousels, and professionally enhanced product photos) in seconds from a prompt or a reference image — and recover any post they accidentally delete within a 30-day trash window.
**Milestone Goal:** Auto-sync every Xareable signup to the operator's GoHighLevel CRM as a contact tagged `xareable`, so downstream marketing campaigns (WhatsApp, email sequences, segmentation) run inside GHL on the operator's existing workflows. Graduates SEED-003 (Option C — repurpose GHL admin as marketing-event sink).

## v1.4 Requirements

Each requirement maps to exactly one phase. The roadmapper assigns phase numbers.

### GHL Signup Sync (GHL)

Wire the existing GHL admin (functional but inert today) into the existing `trackMarketingEvent` `event_type='signup'` path. Push-only, opt-in, best-effort.

- [ ] **GHL-01**: When a user signup is recorded — i.e., when `trackMarketingEvent({event_type:'signup', user_id, email, ...})` fires from the auth flow (`client/src/lib/auth.tsx` calls `POST /api/telegram/notify-signup` or equivalent server-side path) — AND the GHL integration is enabled in `integration_settings` (`enabled: true`) AND `sync_on_signup` is true in the GHL settings JSON, the server calls `getOrCreateGHLContact()` from `server/integrations/ghl.ts` with: `email` from the signup event, `firstName`/`lastName` parsed from auth user_metadata when available (falling back to no name), and `tags: ['xareable']`. The GHL contact ID is stored in `marketing_events.delivery_status.ghl.contact_id` for the matching `marketing_events` row. Sync only fires for the FIRST `signup` event per user (idempotency on `marketing_events.event_key` already handles this).

- [ ] **GHL-02**: The GHL admin card in `client/src/components/admin/integrations-tab.tsx` gains a checkbox **"Sync new signups to GHL (tagged `xareable`)"**. The checkbox persists to `integration_settings.ghl.sync_on_signup` (boolean, defaults `false`). The card explains in plain text: "When enabled, every new Xareable user is automatically created as a contact in your connected GoHighLevel location, tagged `xareable`. Use this tag to trigger campaigns or workflows inside GHL." A successful save is reflected immediately in the admin UI (no page reload required).

- [ ] **GHL-03**: GHL push is best-effort. If `getOrCreateGHLContact()` throws OR the GHL API returns a non-2xx response, the signup flow is NEVER blocked, NEVER fails, and NEVER raises a user-visible error. The failure is recorded in `marketing_events.delivery_status.ghl` as `{ ok: false, error: <safe_message>, attempted_at: <ISO>, ... }`. Successful pushes record `{ ok: true, contact_id: <ghl_id>, synced_at: <ISO> }`. Server logs `[GHL] sync ok|fail user=<id> reason=...` for ops visibility — same prefix convention as other integration logs.

## Future Requirements

Deferred to later milestones. Tracked but not in v1.4 scope.

### Live E2E Validation (SEED-002)

- **VRFY-V2-01**: Test-mode harness exercising Stripe (subscription checkout, Connect onboarding, auto-recharge off-session, customer portal, webhook flow) end-to-end with real test credentials.
- **VRFY-V2-02**: GA4 + Facebook Conversions API delivery validation — generate a marketing event, confirm it lands in DebugView / Test Events tool within N seconds.
- **VRFY-V2-03**: Documented runbook + reusable fixtures so the harness re-runs after each integration change.

### Refactor (SEED-004)

- **REFACTOR-V2-01..05**: Split 5 monolithic files >1000 LOC each (`post-creator-dialog.tsx`, `admin.routes.ts`, `integrations-tab.tsx`, `translations.ts`, `stripe.ts`).

### Future GHL Sync Expansions (no seed yet)

- **GHL-V2-01**: Sync `first_generation` event — push tag update or attribute when user generates first post (filters "activated leads")
- **GHL-V2-02**: Sync `subscription_started` event — tag user as paid customer / first purchase
- **GHL-V2-03**: One-shot backfill script for existing users (`scripts/backfill-ghl-signups.ts`)
- **GHL-V2-04**: Custom field mappings UI — let admin map Xareable user attributes to GHL custom fields beyond email/name/tags

### Future product surfaces (no seed yet)

- Direct social publishing (Instagram OAuth) — currently in PROJECT.md "Out of Scope"
- Multi-brand / teams (multiple brands per account, or shared brand across team)
- Templates / receitas reusáveis (saved generation configs)
- Per-user history / analytics dashboard

## Out of Scope

Explicitly excluded from v1.4. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Sync event types other than signup | Owner explicitly scoped to signup-only — downstream lifecycle handled inside GHL workflows |
| Bidirectional sync (GHL → Xareable) | Push-only by design; never auto-mutate Xareable user state from CRM signals |
| Custom field mappings beyond email/name/tags | Keep field surface minimal in v1.4; expansion is V2 |
| Backfill of existing users to GHL | Out of scope; one-shot script if/when needed (V2) |
| GHL webhook receivers | Not relevant — push-only model |
| New product features | v1.4 is integration glue; product features resume in v1.5+ |
| Manual human UAT for prior phases (5–9.1, 11, 12) | Owner-time-bounded; tracked in seeds for revisit |
| Live billing/ads validation with real test creds | Tracked in SEED-002; defers to dedicated milestone |
| Fat file refactor | Tracked in SEED-004; not blocking, mechanical, deferred |
| Multi-tag support beyond `xareable` | Single tag is the entire ask; multi-tag is V2 if you want segmentation BY signup-source-cohort later |

## Traceability

Populated by the roadmapper when `ROADMAP.md` is created.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GHL-01 | TBD | Pending |
| GHL-02 | TBD | Pending |
| GHL-03 | TBD | Pending |

**Coverage:**
- v1.4 requirements: 3 total
- Mapped to phases: TBD (filled by roadmapper)
- Unmapped: TBD

---
*Requirements defined: 2026-05-08 — graduating SEED-003 Option C (repurpose GHL as signup-only sink, tag `xareable`).*
