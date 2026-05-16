# Roadmap: My Social Autopilot

## Milestones

- ✅ **v1.0 Bug Fixes & System Hardening** — Phases 1-4 (shipped 2026-04-20)
- ✅ **v1.1 Media Creation Expansion** — Phases 5-12 (shipped 2026-05-08) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Production Hardening** — Phases 13-15 (shipped 2026-05-08) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Generation Quality Observability** — Phase 16 (shipped 2026-05-08) — see [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- 🚧 **v1.4 GHL Signup Sync** — Phase 17 (in progress) — see [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- 📋 **v1.5 Brand Style References** — Phases 18-20 (planned)

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

- [x] **Phase 17: GHL Signup Sync (Wire-Up)** — Wire the GHL admin (functional-but-inert today) into the existing signup hook so every new Xareable user is pushed to GHL as a contact tagged `xareable`, gated by an admin opt-in checkbox; failures are logged but never block signup. Single phase covers GHL-01 (server push), GHL-02 (admin checkbox), GHL-03 (best-effort + delivery log). (completed 2026-05-16)

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

**Plans:** 1/1 plans complete

Plans:
- [x] 17-01-PLAN.md — Migration + server wiring + admin UI + verify harness (4 sequential tasks closing GHL-01..03)

**UI hint:** yes

> See [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md) for full Planning Concerns (5 storage-shape deltas vs the original assumption surface — none blocking; all are planner decisions).

---

## 📋 v1.5 Brand Style References (Planned)

**Milestone Goal:** Users can save up to 10 reference photos and an optional style description to their brand profile; the AI generation pipeline automatically uses them as visual style context on every generation, with a per-generation toggle to enable or disable their use. Graduates SEED-006.

## v1.5 Phases

- [ ] **Phase 18: Data Layer + API Endpoints** — Create `brand_reference_photos` table, add `brands.style_description` column, Zod types, and all four CRUD API endpoints (list, upload, delete, update description). Delivers the complete server-side contract for brand style references.
- [ ] **Phase 19: Settings UI — Style Tab** — Add the "Style" 4th tab to Settings with the reference photo upload grid (10 slots, drag & drop, delete-on-hover) and the style description textarea with save. Users can manage their brand reference library from the settings page.
- [ ] **Phase 20: Generation Integration** — Add the "Use my style references" toggle to the creator dialog and wire server-side brand reference injection into the image generation pipeline. Closes the loop between stored references and generated output.

## v1.5 Phase Details

### Phase 18: Data Layer + API Endpoints

**Goal:** The server has a complete, tested data contract for brand reference photos: a dedicated table with correct RLS, an extended `brands` table, four working API endpoints, and Zod-typed request/response shapes — so Phase 19 (UI) and Phase 20 (generation) can build on a stable foundation without DB or API changes.

**Depends on:** Phase 17 (v1.4 complete; v1.5 starts on a clean main).

**Requirements:** REF-01, API-01, API-02, API-03, API-04

**Success Criteria** (what must be TRUE when this phase ships):
  1. A user's brand reference photos can be listed via `GET /api/brand/reference-photos`, returning an ordered array of photo objects with the correct shape — and returns an empty array when no photos exist.
  2. A valid image file (≤5 MB, `image/*` MIME) can be uploaded via `POST /api/brand/reference-photos`, resulting in a stored file under `user_assets/{userId}/references/` in Supabase Storage and a new `brand_reference_photos` row accessible to subsequent GET calls.
  3. Uploading an 11th photo to a brand that already has 10 returns HTTP 400 with a descriptive message; uploading a file exceeding 5 MB also returns HTTP 400. No partial state is left behind on rejection.
  4. A specific photo can be deleted via `DELETE /api/brand/reference-photos/:id` — the Supabase Storage file is removed and the DB row disappears from subsequent GET responses. Attempting to delete another user's photo returns 404.
  5. A brand's style description can be saved (or cleared) via `PATCH /api/brand/style-description`, and the new value (or null) is reflected in subsequent brand queries. Text exceeding 1000 characters returns HTTP 400.

**Plans:** TBD
**UI hint:** no

---

### Phase 19: Settings UI — Style Tab

**Goal:** Users can open Settings, navigate to the new "Style" tab, see their existing reference photos in a grid, upload new ones with drag & drop or a file picker, delete photos with an X button on hover, and save or clear their style description — with all changes immediately reflected in the UI via cache invalidation.

**Depends on:** Phase 18 (all API endpoints must be live and stable).

**Requirements:** SET-01, SET-02, SET-03

**Success Criteria** (what must be TRUE when this phase ships):
  1. The Settings page shows four tabs — Account, Brand, Logo, Style — and the Style tab is reachable by clicking its tab item. The tab is only visible when a brand exists (same guard as the other three tabs).
  2. The Style tab displays existing reference photos as square thumbnails in a responsive grid. Hovering over a thumbnail reveals an X button; clicking it deletes the photo and removes it from the grid immediately without a page reload.
  3. An empty slot in the grid opens a file picker restricted to `image/*`; selecting a valid file uploads it and shows the new thumbnail in the grid. Dragging an image file onto an empty slot triggers the same upload flow. Uploading a file over 5 MB or when 10 photos already exist shows an inline error message.
  4. The style description textarea shows the current saved value (or is empty if none), accepts up to 1000 characters with a visible character counter, and the Save button persists the value with a success toast. Clearing the field and saving stores null.

**Plans:** TBD
**UI hint:** yes

---

### Phase 20: Generation Integration

**Goal:** When a user generates a single-image post and their brand has saved reference photos, the AI receives those photos as visual style context automatically — and the user can opt out per-generation via a toggle in the creator dialog. The AI generation pipeline merges brand references with any user-supplied reference images, respecting the 4-slot Gemini limit.

**Depends on:** Phase 19 (brand references are manageable; toggle needs the query that Phase 19 establishes).

**Requirements:** GEN-01, GEN-02

**Success Criteria** (what must be TRUE when this phase ships):
  1. The creator dialog shows a "Use my style references" checkbox above the submit button when the brand has at least one saved reference photo. When the brand has no saved photos, the checkbox is absent entirely.
  2. With the toggle checked (default), submitting a generation request results in the server fetching the brand's saved reference photos, converting them to base64, and including them in the Gemini image generation call alongside any user-provided reference images — observable as visually on-brand output consistent with the saved references.
  3. With the toggle unchecked, the generation request proceeds without any brand reference photos injected — identical behavior to today's pipeline with no brand references.
  4. When the user also provides inline reference images, those images fill the first Gemini slots; brand references fill any remaining slots up to the 4-image total. If the user provides 4 inline images, brand references are not sent (no 5th slot error).

**Plans:** TBD
**UI hint:** yes

---

## Progress

**Execution Order:**
Phases execute in numeric order: 17, 18, 19, 20

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5–12. (v1.1 phases) | v1.1 | 26/26 | Complete | 2026-05-08 |
| 13–15. (v1.2 phases) | v1.2 | 5/5 | Complete | 2026-05-08 |
| 16. Generation Pipeline Observability | v1.3 | 1/1 | Complete | 2026-05-08 |
| 17. GHL Signup Sync (Wire-Up) | v1.4 | 1/1 | Complete    | 2026-05-16 |
| 18. Data Layer + API Endpoints | v1.5 | 0/TBD | Not started | — |
| 19. Settings UI — Style Tab | v1.5 | 0/TBD | Not started | — |
| 20. Generation Integration | v1.5 | 0/TBD | Not started | — |
