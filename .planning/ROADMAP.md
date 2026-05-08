# Roadmap: My Social Autopilot

## Milestones

- ✅ **v1.0 Bug Fixes & System Hardening** — Phases 1-4 (shipped 2026-04-20)
- ✅ **v1.1 Media Creation Expansion** — Phases 5-12 (shipped 2026-05-08) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Production Hardening** — Phases 13-15 (shipped 2026-05-08) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Generation Quality Observability** — Phase 16 (shipped 2026-05-08) — see [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- 🚧 **v1.4 GHL Signup Sync** — Phase 17 (in progress) — see [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)

## Shipped

<details>
<summary>✅ v1.1 Media Creation Expansion (Phases 5-12) — SHIPPED 2026-05-08</summary>

- [x] Phase 5: Schema & Database Foundation (3/3 plans) — completed 2026-04-21
- [x] Phase 6: Server Services (3/3 plans) — completed 2026-04-21
- [x] Phase 7: Server Routes (3/3 plans) — completed 2026-04-22
- [x] Phase 8: Admin — Scenery Catalog (1/1 plan) — completed 2026-04-28
- [x] Phase 9: Frontend Creator — Carousel & Enhancement Branches (4/4 plans) — completed 2026-04-29
- [x] Phase 09.1: Creator dialog UX gap closure (3/3 plans) — completed 2026-04-29
- [x] Phase 10: Gallery Surface Updates (4/4 plans) — completed 2026-04-30
- [x] Phase 11: Post Trash & Automated Cleanup (4/4 plans) — completed 2026-05-07
- [x] Phase 12: Schedule billing overage batch via cleanup-cron (1/1 plan) — completed 2026-05-08

**Totals:** 9 phases, 26 plans, 46 tasks — full details in [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>✅ v1.2 Production Hardening (Phases 13-15) — SHIPPED 2026-05-08</summary>

- [x] Phase 13: Production Hardening Fixes (2/2 plans) — completed 2026-05-08
- [x] Phase 14: Wire production crons via HTTP triggers (2/2 plans) — completed 2026-05-08
- [x] Phase 15: Cron Verification Harness (1/1 plan) — completed 2026-05-08

**Totals:** 3 phases, 5 plans, 15 tasks — full details in [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

<details>
<summary>✅ v1.3 Generation Quality Observability (Phase 16) — SHIPPED 2026-05-08</summary>

- [x] Phase 16: Generation Pipeline Observability (1/1 plan) — completed 2026-05-08

**Totals:** 1 phase, 1 plan, 5 tasks — full details in [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

</details>

## 🚧 v1.4 GHL Signup Sync (In Progress)

**Milestone Goal:** Auto-sync every Xareable signup to the operator's connected GoHighLevel CRM as a contact tagged `xareable`, so downstream marketing campaigns (WhatsApp, email sequences, segmentation) run inside GHL on the operator's existing workflows. Wires the existing-but-inert GHL admin into the existing `trackMarketingEvent` `CompleteRegistration` signup hook. Push-only, opt-in (defaults OFF), best-effort. Graduates SEED-003 Option C.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (17.1, 17.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 17: GHL Signup Sync (Wire-Up)** — Wire the GHL admin (functional-but-inert today) into the existing signup hook so every new Xareable user is pushed to GHL as a contact tagged `xareable`, gated by an admin opt-in checkbox; failures are logged but never block signup. Single phase covers GHL-01 (server push), GHL-02 (admin checkbox), GHL-03 (best-effort + delivery log).

## Phase Details

### Phase 17: GHL Signup Sync (Wire-Up)

**Goal:** When a new Xareable user signs up AND the admin has opted in, the user lands inside the operator's connected GHL location as a contact tagged `xareable` — without ever blocking, slowing, or breaking the signup flow itself, and with every push (success or failure) visible to ops in the existing integration delivery log.

**Depends on:** Phase 16 (v1.3 closed; v1.4 starts on a clean main). Code-level: depends on the existing GHL admin surface (`server/integrations/ghl.ts`, `PATCH /api/admin/ghl`, the GHL card in `integrations-tab.tsx`), the existing signup hook (`POST /api/telegram/notify-signup` at `server/routes/integrations.routes.ts:1863`), the existing `integration_delivery_logs` table (used today for telegram signup deliveries), and the existing `integration_settings.ghl` row.

**Requirements:** GHL-01, GHL-02, GHL-03

**Success Criteria** (what must be TRUE when this phase ships):

  1. **Server push fires on signup, opt-in gated.** When a new user signs up and the existing signup hook (`POST /api/telegram/notify-signup` — the same route that already fires `trackMarketingEvent({ event_name: "CompleteRegistration", event_key: "signup:<user.id>", … })`) runs, AND the GHL integration row in `integration_settings` has `enabled=true` AND the new opt-in flag (`sync_on_signup`) is true, the server invokes `getOrCreateGHLContact()` from `server/integrations/ghl.ts` with `email` from the auth user, `firstName`/`lastName` parsed from `user.user_metadata` when present (with safe fallback when absent), and `tags: ['xareable']`. When either `enabled=false` or `sync_on_signup=false`, the call is skipped. Idempotency on repeat delivery is preserved via the existing `event_key='signup:<user.id>'` pattern. [GHL-01]
  2. **Admin opt-in checkbox visible, persisted, immediately reflected.** The GHL card at `client/src/components/admin/integrations-tab.tsx:1054` gains a checkbox labeled **"Sync new signups to GHL (tagged `xareable`)"** with help text explaining what it does. Defaults `false`. Saving via the existing PATCH `/api/admin/ghl` persists the value; the GET response surfaces it back; UI reflects saved state without page reload (existing `queryClient.invalidateQueries` on `["/api/admin/ghl"]` handles refresh). [GHL-02]
  3. **Best-effort: signup never blocked, never raises a user-visible error.** If `getOrCreateGHLContact()` throws OR the GHL API returns non-2xx (the wrapper already returns `{success:false, error}` instead of throwing), the signup HTTP response stays 200. A row is written to `integration_delivery_logs` with `integration_type='ghl'`, `event_name='CompleteRegistration'`, `event_key='signup:<user.id>'`, `user_id`, `status` (`sent`/`failed`/`skipped`), `reason` (failure/skip details), `payload` (`{contact_id, created}` on success). Server logs `[GHL] sync ok|fail user=<id> reason=...` matching the existing prefix convention. [GHL-03]
  4. **Test panel + manual verification confirms end-to-end push.** With a test GHL location configured (admin enables GHL, sets API key + Location ID, ticks "Sync new signups to GHL", saves), creating a new test Xareable user via the standard signup flow results in (a) a new contact in the GHL location with the expected email + tag `xareable`, (b) one `integration_delivery_logs` row with `integration_type='ghl'`, `status='sent'`, `payload.contact_id` populated, and (c) NO regression in the existing telegram signup delivery log.
  5. **No regressions.** `npm run check` and `npm run build` both pass. Existing GHL admin GET/PATCH/test/custom-fields endpoints behave identically when `sync_on_signup` is absent/false. Existing `trackMarketingEvent` `CompleteRegistration` flow continues to fire (GA4 + Facebook branches untouched). Toggling `sync_on_signup` off cleanly disables the new branch — confirmed by a fresh signup recording `status='skipped'`.

**Plans:** TBD — `/gsd:plan-phase 17` will decide 1 vs 2 plans (bias toward 1; potential split is server-push vs admin-checkbox).

**UI hint:** yes

> See [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md) for full Planning Concerns (5 storage-shape deltas vs the original assumption surface — none blocking; all are planner decisions).

## Progress

**Execution Order:**
Phases execute in numeric order: 17

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5–12. (v1.1 phases) | v1.1 | 26/26 | Complete | 2026-05-08 |
| 13–15. (v1.2 phases) | v1.2 | 5/5 | Complete | 2026-05-08 |
| 16. Generation Pipeline Observability | v1.3 | 1/1 | Complete | 2026-05-08 |
| 17. GHL Signup Sync (Wire-Up) | v1.4 | 0/TBD | Not started | — |
