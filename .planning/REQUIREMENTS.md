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

> **Storage-shape note (added during roadmapping, 2026-05-08):** the assumed storage paths in GHL-01 and GHL-03 (`marketing_events.delivery_status.ghl.*`) and in GHL-02 (`integration_settings.ghl.sync_on_signup` as a JSONB-nested key) do NOT exist verbatim in the codebase. The requirements above describe the intent (idempotent server-side push gated by an admin opt-in flag, with delivery outcomes recorded for ops). The exact column/JSONB shape is a Planning Concern for `/gsd:plan-phase 17` — see [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md) "Planning Concerns" for the recommended resolution (reuse `integration_delivery_logs` for delivery records; pick one of three options for the `sync_on_signup` flag column).

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

## Traceability (v1.4)

| Requirement | Phase | Status |
|-------------|-------|--------|
| GHL-01 | Phase 17 | Pending |
| GHL-02 | Phase 17 | Pending |
| GHL-03 | Phase 17 | Pending |

**Coverage:**
- v1.4 requirements: 3 total
- Mapped to phases: 3 (all to Phase 17)
- Unmapped: 0
- Orphans: 0

---

# Requirements: My Social Autopilot — v1.5 Brand Style References

**Defined:** 2026-05-16
**Milestone Goal:** Users can save up to 10 reference photos and an optional style description to their brand profile; the AI generation pipeline automatically uses them as visual style context on every generation. Graduates SEED-006.

## v1.5 Requirements

### Data Layer (REF)

- [ ] **REF-01**: New Supabase table `brand_reference_photos` (columns: `id UUID PK`, `brand_id UUID FK → brands.id ON DELETE CASCADE`, `user_id UUID FK → auth.users.id ON DELETE CASCADE`, `photo_url TEXT NOT NULL`, `position INT NOT NULL DEFAULT 0`, `created_at TIMESTAMPTZ DEFAULT NOW()`). Index on `(brand_id, position)`. RLS: owner-only via `user_id = auth.uid()`. New nullable column `brands.style_description TEXT NULL`. Zod schema `brandReferencePhotoSchema` and response type added to `shared/schema.ts`.

### API Endpoints (API)

- [ ] **API-01**: `GET /api/brand/reference-photos` — returns the authenticated user's saved reference photos ordered by `position ASC, created_at ASC`. Response: `{ photos: BrandReferencePhoto[] }`. Uses `requireAuth` middleware; user-scoped Supabase client (RLS applies).

- [ ] **API-02**: `POST /api/brand/reference-photos` — upload one reference photo. Accepts `multipart/form-data` with a single `photo` file field. Server enforces: (a) file size ≤ 5 MB, (b) MIME type must be `image/*`, (c) brand must have fewer than 10 existing photos. Uploads to `user_assets/{userId}/references/{uuid}.{ext}`, inserts row into `brand_reference_photos`, returns the created `BrandReferencePhoto`. Returns `400` with descriptive message on any constraint violation.

- [ ] **API-03**: `DELETE /api/brand/reference-photos/:id` — delete one photo. Verifies ownership (row must belong to authenticated user's brand). Removes the file from Supabase Storage, then deletes the DB row. Returns `200 { success: true }` or `404` if not found / not owned.

- [ ] **API-04**: `PATCH /api/brand/style-description` — save the brand's style description. Body: `{ style_description: string | null }` (Zod validated, max 1000 chars, null clears it). Updates `brands.style_description` for the authenticated user's brand. Returns `200 { success: true }`.

### Settings UI (SET)

- [ ] **SET-01**: New "Style" tab in `client/src/pages/settings.tsx` as the 4th tab (after Logo). `TabsList` changes from `grid-cols-3` to `grid-cols-4`. Tab icon: `ImagePlus` from lucide-react. Only rendered when brand exists (same guard as other tabs).

- [ ] **SET-02**: Reference photo upload grid inside the Style tab. Displays existing photos as square thumbnails in a responsive grid (e.g., 5×2 or 4+overflow). Each occupied slot shows the photo with an X button on hover to delete. Empty slots (up to 10 total) show a dashed `+` button that opens a file picker (`image/*`, 5 MB max enforced client-side). Drag & drop onto any empty slot also accepted. Uploading and deleting are reflected immediately via TanStack Query cache invalidation on `["/api/brand/reference-photos"]`.

- [ ] **SET-03**: Style description card below the photo grid. Contains a `<Textarea>` labelled "Describe your visual style" with placeholder "e.g., Clean minimalist layout with bold typography, warm earth tones, never cluttered...". Max 1000 characters (shown as a counter). Save button calls `PATCH /api/brand/style-description`. Loading state on the button during save. Toast on success/failure.

### Generation Integration (GEN)

- [ ] **GEN-01**: In `client/src/components/post-creator-dialog.tsx`, when the brand has ≥1 saved reference photo (checked via a query on mount, cached), render a checkbox toggle labelled "Use my style references" above the submit button. Toggle is checked by default. When unchecked, brand references are excluded from the generation request. If the brand has no saved photos, this toggle is not rendered at all.

- [ ] **GEN-02**: `generateRequestSchema` in `shared/schema.ts` gains `use_brand_references: z.boolean().optional()` (defaults `true` when absent). In `server/routes/generate.routes.ts`, after brand is fetched: if `use_brand_references` is not `false`, query `brand_reference_photos` for this brand, download up to 4 photos from Supabase Storage, convert to base64 `{ mimeType, data }` objects, and merge with the user's inline `reference_images` array (user-provided images fill first slots; brand references fill remaining slots; total ≤ 4). Pass the merged list to the image generation service as the `referenceImages` argument.

## Out of Scope (v1.5)

| Feature | Reason |
|---------|--------|
| Drag-to-reorder photos in the grid | Insertion order is sufficient; reorder UX adds complexity |
| Style description injected into text generation prompt | Image gen only in v1.5; evaluate impact before expanding |
| Carousel and enhancement routes using brand references | Image/single-post only in v1.5; extend in v1.6 if confirmed useful |
| URL import / social feed scraping | Upload only; no external crawling; security + ToS concerns |
| Per-photo captions or tags | Simple uploads only |
| Storage quota UI | 10 × 5 MB = 50 MB max; acceptable without a quota display |

## Traceability (v1.5)

| Requirement | Phase | Status |
|-------------|-------|--------|
| REF-01 | Phase 18 | Pending |
| API-01 | Phase 18 | Pending |
| API-02 | Phase 18 | Pending |
| API-03 | Phase 18 | Pending |
| API-04 | Phase 18 | Pending |
| SET-01 | Phase 19 | Pending |
| SET-02 | Phase 19 | Pending |
| SET-03 | Phase 19 | Pending |
| GEN-01 | Phase 20 | Pending |
| GEN-02 | Phase 20 | Pending |

**Coverage:**
- v1.5 requirements: 10 total
- Mapped to phases: 10 (5 to Phase 18, 3 to Phase 19, 2 to Phase 20)
- Unmapped: 0
- Orphans: 0

---
*v1.4 requirements defined: 2026-05-08 — graduating SEED-003 Option C. Traceability populated by roadmapper 2026-05-08.*
*v1.5 requirements defined: 2026-05-16 — graduating SEED-006 (Brand Style References). Traceability populated by roadmapper 2026-05-16.*
