# Roadmap: My Social Autopilot

## Milestones

- ✅ **v1.0 Bug Fixes & System Hardening** — Phases 1-4 (shipped 2026-04-20)
- ✅ **v1.1 Media Creation Expansion** — Phases 5-12 (shipped 2026-05-08) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Production Hardening** — Phases 13-15 (shipped 2026-05-08) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Generation Quality Observability** — Phase 16 (shipped 2026-05-08) — see [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 GHL Signup Sync** — Phase 17 (shipped 2026-05-16) — see [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- 🚧 **v1.5 Brand Style References** — Phases 18-20 (in progress)

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

<details>
<summary>✅ v1.4 GHL Signup Sync (Phase 17) — SHIPPED 2026-05-16</summary>

- [x] Phase 17: GHL Signup Sync (Wire-Up) (1/1 plan) — completed 2026-05-16

**Totals:** 1 phase, 1 plan, 4 tasks — full details in [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)

</details>

## 🚧 v1.5 Brand Style References (In Progress)

**Milestone Goal:** Users can save up to 10 reference photos and an optional style description to their brand profile; the AI generation pipeline automatically uses them as visual style context on every generation, with a per-generation toggle to enable or disable their use. Graduates SEED-006.

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (18.1, 18.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 18: Data Layer + API Endpoints** — Create `brand_reference_photos` table, add `brands.style_description` column, Zod types, and all four CRUD API endpoints (list, upload, delete, update description). Delivers the complete server-side contract for brand style references. (completed 2026-05-16)
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

**Plans:** 3/3 plans complete
Plans:
- [x] 18-01-PLAN.md — Migration (brand_reference_photos table + brands.style_description) + Zod schemas
- [x] 18-02-PLAN.md — API endpoints (GET, POST, DELETE, PATCH) + route registration
- [x] 18-03-PLAN.md — Verification harness (scripts/verify-phase-18.ts) + TypeScript check

**UI hint:** no

---

### Phase 19: Settings UI — Style Tab

**Goal:** Users can open Settings, navigate to the new "Style" tab, see their existing reference photos in a grid, upload new ones with drag & drop or a file picker, delete photos with an X button on hover, and save or clear their style description — with all changes immediately reflected in the UI via cache invalidation.

**Depends on:** Phase 18 (all API endpoints must be live and stable).

**Requirements:** SET-01, SET-02, SET-03

**Success Criteria** (what must be TRUE when this phase ships):
  1. The Settings page shows four tabs — Info, Colors, Logo, Style — and the Style tab is reachable by clicking its tab item. The tab is only visible when a brand exists (same guard as the other three tabs).
  2. The Style tab displays existing reference photos as square thumbnails in a responsive grid. Hovering over a thumbnail reveals an X button; clicking it deletes the photo and removes it from the grid immediately without a page reload.
  3. An empty slot in the grid opens a file picker restricted to `image/*`; selecting a valid file uploads it and shows the new thumbnail in the grid. Dragging an image file onto an empty slot triggers the same upload flow. Uploading a file over 5 MB or when 10 photos already exist shows an inline error message.
  4. The style description textarea shows the current saved value (or is empty if none), accepts up to 1000 characters with a visible character counter, and the Save button persists the value with a success toast. Clearing the field and saving stores null.

**Plans:** 1 plan
Plans:
- [ ] 19-01-PLAN.md — Style tab: imports + state + handlers + TabsList + TabsContent + verification harness

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
Phases execute in numeric order: 18, 19, 20

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5–12. (v1.1 phases) | v1.1 | 26/26 | Complete | 2026-05-08 |
| 13–15. (v1.2 phases) | v1.2 | 5/5 | Complete | 2026-05-08 |
| 16. Generation Pipeline Observability | v1.3 | 1/1 | Complete | 2026-05-08 |
| 17. GHL Signup Sync (Wire-Up) | v1.4 | 1/1 | Complete | 2026-05-16 |
| 18. Data Layer + API Endpoints | v1.5 | 3/3 | Complete    | 2026-05-16 |
| 19. Settings UI — Style Tab | v1.5 | 0/1 | Not started | — |
| 20. Generation Integration | v1.5 | 0/TBD | Not started | — |
