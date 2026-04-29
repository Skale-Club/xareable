# Roadmap: My Social Autopilot — v1.1 Media Creation Expansion

## Overview

This milestone adds two new media creation surfaces — an Instagram carousel generator and a product photo enhancement tool — to the hardened v1.0 system. Phases continue numbering from v1.0 (which closed at Phase 4). The build order is hard-gated by the dependency chain: schema types must compile before services, services must exist before routes, and the admin scenery catalog must be populated before the enhancement creator dialog can be meaningfully tested. Gallery updates come last because they require real carousel and enhancement posts to render and depend on the `content_type` exhaustiveness guard shipping before any new type is added.

**Phase Numbering:** Phases 5–10 continue from v1.0 (Phases 1–4). Do not reset to 1.

## Phases

- [x] **Phase 5: Schema & Database Foundation** - Extend shared types, add post_slides table + RLS, add idempotency key, seed scenery catalog
- [ ] **Phase 6: Server Services** - Carousel generation service (N sequential calls, style consistency, partial-success), enhancement service (EXIF strip, pre-screen, scenery prompt), billing multiplier
- [ ] **Phase 7: Server Routes** - Thin orchestration routes for carousel and enhancement over Phase 6 services, idempotency gating, billing event recording
- [x] **Phase 8: Admin — Scenery Catalog** - Extend admin style catalog UI with Scenery CRUD section; serve sceneries through existing catalog cache path (completed 2026-04-28)
- [ ] **Phase 9: Frontend Creator — Carousel & Enhancement Branches** - Extend the existing post-creator-dialog with Carousel and Enhancement as content types alongside Image and Video; type-specific step branches; per-slide carousel SSE progress; single-phase enhancement progress; EN/PT/ES i18n; no new dialog files, no new sidebar entries
- [ ] **Phase 10: Gallery Surface Updates** - Carousel and enhancement tile rendering, content_type exhaustiveness guard, slide viewer, cache invalidation on SSE complete/error

## Phase Details

### Phase 5: Schema & Database Foundation
**Goal**: All shared TypeScript types compile and the database schema supports carousel and enhancement posts end to end, with RLS policies co-deployed
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: SCHM-01, SCHM-02, SCHM-03, SCHM-04, SCHM-05, SCHM-06
**Research flag**: None — Supabase migration pattern, Zod enum extension, and RLS policy structure are all established in v1.0. No additional research-phase needed.
**Success Criteria** (what must be TRUE):
  1. `shared/schema.ts` exports `postSlideSchema`, `carouselRequestSchema`, `enhanceRequestSchema`, and `scenerySchema` and the TypeScript compiler reports zero errors across the monorepo
  2. Running the Supabase migration creates the `post_slides` table with `id`, `post_id`, `slide_number`, `image_url`, `thumbnail_url`, and `created_at`; querying the table via the user-scoped client returns rows (not a silent empty array) confirming RLS shipped in the same commit
  3. `posts.content_type` rejects any value outside `('image', 'video', 'carousel', 'enhancement')` at the database level — an INSERT with `content_type = 'unknown'` returns a CHECK violation error
  4. `posts.slide_count` is present and nullable; a carousel post insert with `slide_count = 5` saves correctly while a single-image post insert with `slide_count = NULL` also saves correctly
  5. `posts.idempotency_key` is present and unique; inserting two rows with the same key produces a unique-constraint error
  6. Deleting a carousel post triggers storage cleanup that removes all per-slide images, per-slide thumbnails, and the enhancement source file if present — no storage objects remain for the deleted post
**Plans**: 3 plans
- [x] 05-01-PLAN.md — Extend shared/schema.ts with postSlideSchema, carouselRequestSchema, enhanceRequestSchema, scenerySchema; extend postSchema.content_type and all downstream mirrors to 4 values; add slide_count + idempotency_key fields
- [x] 05-02-PLAN.md — Single Supabase migration: post_slides table + RLS + CHECK extension + slide_count + idempotency_key + BEFORE DELETE cleanup triggers + 12 scenery presets seeded into platform_settings.setting_value (style_catalog row)
- [x] 05-03-PLAN.md — Write scripts/verify-phase-05.ts and run live verification (supabase db push + 6-criterion check) — PASS 6/6

### Phase 6: Server Services
**Goal**: The carousel generation logic (N sequential Gemini calls with style consistency, partial-success contract, and idempotency) and the enhancement logic (EXIF stripping, pre-screen, scenery prompt injection, sharp normalization) are implemented as isolated, testable service modules; billing multiplier accepts a slide count
**Depends on**: Phase 5
**Requirements**: CRSL-02, CRSL-03, CRSL-06, CRSL-09, CRSL-10, ENHC-03, ENHC-04, ENHC-05, ENHC-06, BILL-01
**Research flag**: This phase needs targeted validation during plan-phase on three points — route through `/gsd:research-phase` before planning:
  1. Carousel style-consistency technique: MEDIUM confidence that shared_style + slide-1-as-reference-image produces acceptable visual coherence. If QA reveals drift, the fallback (longer shared_style descriptor, different reference-passing) needs to be documented.
  2. Gemini IPM rate limits: LOW confidence on images-per-minute quota for gemini-3.1-flash-image-preview. Default to sequential; test controlled parallelism (2 concurrent) during QA before locking slide-cap at 8.
  3. Enhancement pre-screen accuracy: MEDIUM confidence on Gemini text-model classification accuracy across diverse product categories. Validate against 3+ product surface types per scenery before shipping.
**Success Criteria** (what must be TRUE):
  1. `carousel-generation.service.ts` produces one master text call returning `{ shared_style, slides[], caption }` — calling the service for a 5-slide carousel creates exactly 1 text call and 5 sequential image calls, and slides 2–5 receive slide 1's output buffer as `inlineData` reference in each prompt
  2. When the carousel generation service is invoked for a 6-slide job and slides 1, 2, 3, and 4 succeed while slides 5 and 6 fail, the service returns a partial-success result with `status = "draft"` and `slide_count = 4` — it does not throw and does not charge for the failed slides
  3. The carousel service fires the 260-second safety timer and surfaces a structured timeout error to the caller before the hosting function cap is reached
  4. Caption quality enforcement in the carousel service runs once on the unified caption, not once per slide
  5. `enhancement.service.ts` strips EXIF metadata via `sharp().rotate().toBuffer()` before passing the image to Gemini and before writing to Supabase storage — the stored file contains no GPS or camera metadata
  6. The enhancement service runs a Gemini text-model pre-screen that rejects a face photograph, a screenshot, and explicitly unsafe content with a structured rejection result before the image model call is made
  7. `checkCredits` in `server/quota.ts` accepts a `slideCount` parameter; calling it with `slideCount = 5` deducts 5× the single-image cost; calling it with `slideCount = 1` deducts 1× — existing single-image callers pass `slideCount = 1` and are unaffected
**Plans**:
- [x] 06-01-PLAN.md — Extend `checkCredits` with optional `slideCount` multiplier (BILL-01) + scaffold `scripts/verify-phase-06.ts`
- [x] 06-02-PLAN.md — `carousel-generation.service.ts`: master text plan, sequential slide loop with thoughtSignature multi-turn + single-turn fallback, 429 retry, partial-success contract, DB + storage writes (CRSL-02, CRSL-03, CRSL-06, CRSL-09, CRSL-10)
- [x] 06-03-PLAN.md — `enhancement.service.ts`: fail-closed pre-screen, EXIF strip + square normalize (sharp autoOrient), scenery prompt injection via platform_settings.style_catalog, deterministic storage paths (ENHC-03, ENHC-04, ENHC-05, ENHC-06)

### Phase 7: Server Routes
**Goal**: The carousel and enhancement API endpoints are live, correctly orchestrated over Phase 6 services, and enforce idempotency, partial-success billing, and single usage-event recording
**Depends on**: Phase 6
**Requirements**: CRSL-01, CRSL-05, CRSL-07, CRSL-08, ENHC-01, ENHC-02, ENHC-07, ENHC-08, BILL-02, BILL-03, BILL-04
**Research flag**: None — SSE pipeline, auth middleware, credit gate, and usage recording are direct reuse of the battle-tested `generate.routes.ts` pattern. No additional research-phase needed.
**Success Criteria** (what must be TRUE):
  1. `POST /api/carousel/generate` accepts a valid request (prompt, slide count 3–8, aspect ratio 1:1 or 4:5) and streams per-slide SSE progress events — one distinct event per slide generated — before emitting a final `complete` event
  2. Sending `POST /api/carousel/generate` twice with the same `idempotency_key` returns the existing post on the second call without running generation again, without charging credits again, and without inserting a new `usage_events` row
  3. A partial-success carousel (slide 1 succeeded, slide 2 failed — below the 50% threshold) results in zero credit deduction and a structured error event on the SSE stream, not a silent failure
  4. A partial-success carousel that meets the 50%-threshold saves as `status = "draft"` and deducts credits only for the successful slides — not the originally requested count
  5. `POST /api/enhance` accepts a valid multipart upload (≤ 5 MB JPEG/PNG/WEBP), a scenery preset ID, and returns a single SSE `complete` event with the result image URL stored at `user_assets/{userId}/enhancement/{postId}.webp`; the source file is stored at `user_assets/{userId}/enhancement/{postId}-source.webp`
  6. Enhancement posts never include logo overlay or caption post-processing — the response contains only the enhanced image URL and a plain caption field
  7. One `usage_events` row is recorded per carousel post, with token totals summed across all slides and the master text call — not one row per slide
**Plans**: 3 plans
- [x] 07-01-PLAN.md — `server/routes/carousel.routes.ts`: POST /api/carousel/generate with full SSE pipeline, idempotency gate, per-slide progress mapping, partial-success billing (CRSL-01, CRSL-05, CRSL-07, CRSL-08, BILL-02, BILL-03, BILL-04)
- [x] 07-02-PLAN.md — `server/routes/enhance.routes.ts`: POST /api/enhance with 5 MB guard, idempotency gate, SSE pipeline, pre-screen error handling, single-event billing, no logo/caption post-processing (ENHC-01, ENHC-02, ENHC-07, ENHC-08)
- [x] 07-03-PLAN.md — Wire carousel and enhance routers into `server/routes/index.ts` — import + router.use() for both (CRSL-01, ENHC-01)

### Phase 8: Admin — Scenery Catalog
**Goal**: Administrators can create, edit, and delete scenery presets through the existing admin style catalog surface, and the 12 initial presets are available from first deployment
**Depends on**: Phase 7
**Requirements**: ADMN-01, ADMN-02, ADMN-03
**Research flag**: None — direct extension of existing style catalog admin surface using the same schema and CRUD endpoint pattern established in v1.0. No additional research-phase needed.
**Success Criteria** (what must be TRUE):
  1. An admin user navigating to the style catalog page sees a Sceneries section and can create a new scenery preset by filling in label, prompt snippet, and optional preview image URL — the new preset appears in the list without a page reload
  2. An admin can edit the prompt snippet of an existing scenery preset and delete a scenery preset; both operations persist correctly and are reflected in the next `getStyleCatalogPayload()` response
  3. The 12 initial sceneries (white-studio, marble-light, marble-dark, wooden-table, concrete-urban, outdoor-natural, kitchen-counter, dark-premium, softbox-studio, pastel-flat, seasonal-festive, cafe-ambience) are present in the catalog immediately after the migration runs — no manual seeding step required
**Plans**: TBD

### Phase 9: Frontend Creator — Carousel & Enhancement Branches
**Goal**: The single existing `post-creator-dialog.tsx` is extended so users select Carousel or Enhancement as content types alongside Image and Video, configure generation through type-specific step branches, track per-slide progress via SSE for carousel and single-phase progress for enhancement, and receive results in English (with PT and ES translations present)
**Depends on**: Phase 8
**Requirements**: CRTR-01, CRTR-02, CRTR-03, CRTR-04, CRTR-05, CRTR-06, CRSL-04
**Research flag**: Enhancement pre-screen accuracy (MEDIUM confidence) should be validated during Phase 6 QA before this phase ships. No separate research-phase needed for the creator dialog UI patterns themselves.
**Success Criteria** (what must be TRUE):
  1. The "Content Type" step in `post-creator-dialog.tsx` exposes four siblings — Image, Video, Carousel, Enhancement — and the step is always visible (no longer gated by `VIDEO_ENABLED`); selecting Carousel or Enhancement switches the subsequent step list to the type-specific branch
  2. The Carousel branch shows: slide count picker (3–8 only) → reference → mood → text on image → logo placement → format (locked to 1:1 or 4:5, all slides share the chosen ratio) → generate; each slide's generation triggers a distinct visible progress update on screen and the request hits `POST /api/carousel/generate`
  3. The Enhancement branch shows: photo upload (client rejects files >5 MB or non-JPEG/PNG/WEBP before upload) → scenery picker showing admin-curated presets → generate; no mood, no text-on-image, no logo steps appear; a single-phase progress indicator is shown during generation and the request hits `POST /api/enhance`
  4. No new dialog files are created — there is no `carousel-creator-dialog.tsx` and no `enhancement-creator-dialog.tsx`; the unified `post-creator-dialog.tsx` is the single creation surface and the sidebar receives no new entry points
  5. The carousel and enhancement branches generate a UUID `idempotency_key` per submission and include it in the request body, so a network retry does not trigger a second generation
  6. All user-facing strings introduced for the carousel and enhancement branches are present in the EN, PT, and ES i18n files
**Plans**: 4 plans
- [x] 09-01-PLAN.md — Add 31 EN-keyed Carousel/Enhancement strings to translations.ts (pt + es) (CRTR-06)
- [x] 09-02-PLAN.md — Replace VIDEO_ENABLED with CONTENT_TYPE_ENABLED config; extend contentType union to 4 values; render 4-card Content Type step with empty-scenery gating (CRTR-03)
- [x] 09-03-PLAN.md — Add Carousel branch: CAROUSEL_STEPS, slide count picker, locked 1:1/4:5 format, generate handler with progressive thumbnails + result view (CRTR-01, CRTR-04, CRTR-05, CRSL-04)
- [x] 09-04-PLAN.md — Add Enhancement branch: ENHANCEMENT_STEPS, photo upload with 5 MB / MIME validation, scenery picker grid, generate handler with openViewer handoff (CRTR-02, CRTR-04, CRTR-05)
**UI hint**: yes

### Phase 09.1: Creator dialog UX gap closure (INSERTED)

**Goal:** Close five user-reported UX gaps from Phase 9 HUMAN-UAT in `post-creator-dialog.tsx` and re-spec ENHC-08 to generate a real Instagram caption: F1 responsive carousel result thumbnails, F2 hover preview, F3 denser scenery picker grid, F4 enhancement caption generation (re-spec'd ENHC-08), F5 localStorage draft auto-save with 7-day TTL.
**Requirements**: F1, F2, F3, F4, F5, ENHC-08 (re-spec)
**Depends on:** Phase 9
**Plans:** 3 plans

Plans:
- [ ] 09.1-01-PLAN.md — F4 backend: `generateEnhancementCaption` in enhancement.service.ts + EnhancementResult.caption widening + REQUIREMENTS.md ENHC-08 re-spec (F4, ENHC-08)
- [x] 09.1-02-PLAN.md — F1+F2+F3 frontend visual fixes in post-creator-dialog.tsx: responsive result grid, hover preview overlay, denser scenery picker (F1, F2, F3)
- [ ] 09.1-03-PLAN.md — F5 draft persistence: localStorage save/restore, Continue draft / Start fresh banner, cleanup on success/close (F5)

### Phase 10: Gallery Surface Updates
**Goal**: The posts gallery correctly renders carousel and enhancement posts with badges and navigation, the TypeScript exhaustiveness guard prevents silent regressions on new content types, and partial-draft carousels appear in the gallery immediately after generation
**Depends on**: Phase 9
**Requirements**: GLRY-01, GLRY-02, GLRY-03, GLRY-04, GLRY-05
**Research flag**: None — TanStack Query patterns and gallery tile rendering are well-established in v1.0. No additional research-phase needed.
**Success Criteria** (what must be TRUE):
  1. A carousel post in the gallery displays slide 1 as the cover image and a "Carousel · N" badge where N comes from `posts.slide_count`; clicking the tile opens a viewer that allows navigating slides sequentially with next/prev controls
  2. An enhancement post in the gallery displays the result image and an "Enhanced" badge
  3. Adding a new string value to the `content_type` union in `shared/schema.ts` without updating the gallery card switch statement causes a TypeScript compile error — not a silent runtime fallthrough
  4. After a carousel generation completes (including a partial-draft save), the gallery refetches and the new carousel tile is visible without a manual page reload — this holds for both SSE `complete` and SSE `error` events
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 5 → 6 → 7 → 8 → 9 → 10
Phases 1–4 were completed in v1.0 (2026-04-20).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 5. Schema & Database Foundation | 3/3 | Complete | 2026-04-21 |
| 6. Server Services | 3/3 | Complete (UAT live pending) | 2026-04-21 |
| 7. Server Routes | 3/3 | Complete (UAT live pending) | 2026-04-22 |
| 8. Admin — Scenery Catalog | 1/1 | Complete   | 2026-04-28 |
| 9. Frontend Creator Dialogs | 3/4 | In Progress|  |
| 10. Gallery Surface Updates | 0/? | Not started | - |
