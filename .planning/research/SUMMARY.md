# Project Research Summary

**Project:** My Social Autopilot — v1.1 Media Creation Expansion
**Domain:** AI social media content creation SaaS — brownfield feature expansion
**Researched:** 2026-04-21
**Confidence:** HIGH

## Executive Summary

v1.1 adds two new media creation surfaces — Instagram carousel generator and product photo enhancement — to an already-hardened v1.0 system. The defining characteristic of this milestone is that it requires zero new npm dependencies: sharp (already installed) handles image normalization and EXIF stripping, embla-carousel-react (already installed at ^8.6.0) handles the frontend slide preview, and the existing editImage() function in image-generation.service.ts is the production-proven primitive for image-to-image enhancement calls. All new capabilities are achieved through architectural patterns, schema additions, and prompt-engineering strategies, not new libraries.

The carousel generator must work within a confirmed Gemini API constraint: gemini-3.1-flash-image-preview does not support candidateCount > 1 and has no seed parameter. Style consistency across N slides is achieved through a two-layer approach: a single master text call producing { shared_style, slides[], caption } followed by N sequential image calls, with slide 1 output buffer passed as inlineData reference into every subsequent slide prompt. A separate post_slides table (not a JSON array or a repurposed post_versions) is the clear schema winner: it supports per-row RLS, clean storage cleanup, and sets up individual slide regeneration for v2 without a rewrite. Both new routes (carousel.routes.ts, enhance.routes.ts) must be separate files; extending generate.routes.ts is explicitly rejected.

The critical execution risk is sequencing: schema migration and RLS policies must be committed together before any service or route code, because the user-scoped Supabase client silently returns empty arrays for tables without RLS. The build order is hard-gated: shared types -> DB migration + RLS -> services -> routes -> admin UI -> creator dialogs -> gallery. Two decisions must be locked before route code is written: the carousel partial-success contract (what happens when 6 of 10 slides succeed) and the idempotency key pattern for client retry, to avoid billing ledger inconsistencies.

---

## Key Findings

### Recommended Stack

No new libraries are needed. The existing stack covers all v1.1 capabilities. Key facts: (1) embla-carousel-react@^8.6.0 is already in package.json and ready for the slide preview UI; (2) sharp is already used in image-optimization.service.ts and handles the aspectRatio bug workaround for enhancement (normalize user uploads to 1:1 before sending to Gemini); (3) raw REST calls to Gemini are already the project pattern and avoid the confirmed bug where imageConfig.imageSize is silently ignored in some SDK/proxy paths.

**Core technologies:**

- gemini-2.5-flash (text): single master carousel plan call returning { shared_style, caption, slides[] } — one text call total, not N
- gemini-3.1-flash-image-preview (image): N sequential calls for carousel slides; one call for enhancement — raw REST via existing generateImage() / editImage() service functions
- sharp (already installed): normalize user uploads to 1:1 before enhancement call; EXIF stripping via .rotate().toBuffer() before storing source
- embla-carousel-react (already installed at ^8.6.0): carousel slide preview strip in creator dialog
- Zod in shared/schema.ts: postSlideSchema, carouselRequestSchema, enhanceRequestSchema, extended postSchema.content_type enum

**Critical API constraints:**

- candidateCount > 1 on the image model returns HTTP 400 — carousel must use N sequential calls (confirmed, not a configuration issue)
- No seed parameter on gemini-3.1-flash-image-preview — style consistency is prompt-engineering only (seed exists only for Vertex AI Imagen models)
- imageConfig.aspectRatio is ignored on image-to-image editing calls — use sharp to pre-normalize input to 1:1; do NOT pass aspectRatio in editing generationConfig
- Carousel at 1K resolution: $0.067 per slide (official pricing, April 2026); 5-slide carousel = $0.335 from user own API key

### Expected Features

**Must have (table stakes — carousel):**

- Slide count picker (3-10), user-controlled — AI fills narrative into the chosen count, never auto-picks
- Hook -> Develop -> CTA narrative arc — generated in one master text call
- Shared visual style across all slides — shared_style descriptor + slide-1-as-reference-image technique
- One unified Instagram caption — single posts.caption field, same as today
- IG-safe aspect ratios only: 1:1 and 4:5 — restrict creator to these two
- Gallery cover = slide 1 thumbnail; click opens slide navigator
- Billing at N x single-image credit cost — checkCredits receives slideCount as multiplier parameter

**Must have (table stakes — enhancement):**

- Admin-curated scenery preset catalog: 12 presets at launch (white-studio, marble-light, marble-dark, wooden-table, concrete-urban, outdoor-natural, kitchen-counter, dark-premium, softbox-studio, pastel-flat, seasonal-festive, cafe-ambience)
- Single-image upload -> scenery selection -> generate -> before/after viewer
- Product identity preservation via explicit subject-preservation language in all enhancement prompts
- EXIF stripping via sharp().rotate().toBuffer() before storage or API call
- Gemini pre-screen for NSFW/non-product images before main enhancement call
- 1x credit billing — same as single-image post

**Should have (differentiators):**

- Slide navigator using embla-carousel-react in carousel viewer
- Credit preview before generation ("This will use 7 credits for 7 slides")
- Scenery prompt augmentation — optional free-text modifier appended to preset
- Admin-editable scenery prompt per preset (admin can tune without code deploy)
- Before/after toggle in enhancement viewer

**Defer to v2+:**

- Individual slide regeneration — complex endpoint, needs shared_style persisted per-carousel
- ZIP download of all slides — useful but not blocking launch adoption
- Batch enhancement mode — explicit out-of-scope per PROJECT.md
- User-uploaded custom sceneries — explicit out-of-scope per PROJECT.md
- Panoramic/spanning backgrounds across slides — anti-feature (fragile IG crop behavior)

### Architecture Approach

The v1.1 expansion follows the established brownfield extension pattern: new route files per feature surface, new services per domain, wired through the same auth + billing + SSE middleware chain as generate.routes.ts. Key decisions: (1) dedicated route files carousel.routes.ts and enhance.routes.ts — extending the existing generate route is rejected; (2) post_slides table for carousel slides — JSON column and post_versions reuse both rejected; (3) scenery catalog stored inside existing platform_settings JSON extending styleCatalogSchema — no new database table needed; (4) separate frontend dialogs — the 700-line post-creator-dialog.tsx must not absorb two more divergent flows.

**Major components:**

1. carousel.routes.ts — SSE pipeline: auth -> credit check (N multiplier) -> master text call -> N sequential image calls -> N uploads to post_slides -> cover to posts.image_url -> usage event -> deductCredits -> sendComplete
2. enhance.routes.ts — SSE pipeline: auth -> credit check -> NSFW pre-screen -> fetch scenery from catalog -> editImage() with scenery prompt -> sharp post-process -> upload -> usage event -> sendComplete
3. carousel-generation.service.ts — orchestrates N sequential Gemini calls; passes slide-1 buffer as inlineData reference to slides 2..N for style consistency
4. enhancement.service.ts — single image-to-image call; injects scenery.prompt_snippet with dual-zone spatial framing
5. post_slides table — per-slide rows with post_id FK, slide_number, image_url, thumbnail_url; RLS via parent post ownership
6. carousel-creator-dialog.tsx — slide count picker -> aspect ratio -> prompt -> per-slide SSE progress -> embla viewer
7. enhancement-creator-dialog.tsx — photo upload (5MB gate) -> scenery picker -> generate -> before/after viewer
8. Extended posts.tsx gallery — carousel tile (stacked-card badge + N slides), enhancement tile, exhaustiveness guard on content_type

### Critical Pitfalls

1. **Style incoherence across carousel slides** — Never call generateImageAsset N times with only text prompts. Generate slide 1 first; pass its output buffer as inlineData reference into every subsequent slide call. Include explicit palette-lock instruction: "Match the background tone and color temperature of the reference image exactly." Both layers required; text-only style description produces slides that look like different photoshoots. (CAROUSEL-01, CAROUSEL-02)

2. **Partial carousel failure and double-charging on client retry** — Define the partial-success contract before writing route code: if >= 50% of slides succeed AND slide 1 succeeded, save partial carousel with actual slide_count and status partial; charge only for successful slides. Use client-generated idempotency key stored on posts row; server checks for existing post with that key before re-running generation. Retry window for carousel jobs (100-200s) is 10-20x larger than single-image jobs. (CAROUSEL-03, CAROUSEL-04)

3. **post_slides table deployed without RLS** — RLS policies must ship in the same migration commit as the table DDL. Admin Supabase client always works regardless of RLS; the bug only manifests in production with the user-scoped client (silent empty array). Add comment in migration: "RLS required — do not deploy without its accompanying policy block." (SHARED-02)

4. **User uploads containing EXIF geodata and NSFW content** — Run every enhancement upload through sharp().rotate().toBuffer() before storage AND before Gemini call (strips EXIF). Add a Gemini text-model pre-screen call before the main enhancement call. Reject faces, screenshots, and explicit content with 400 before the image model sees them. Never log raw base64 image data in error paths. (ENHANCE-04, ENHANCE-06)

5. **content_type exhaustiveness — new values fall into silent else branches** — Add a TypeScript never exhaustiveness guard in the gallery card switch before any v1.1 code is merged. Produces a compile error when new types are unhandled. Without it carousel and enhancement posts silently render as single images; billing statement filters become blind to new types. (SHARED-03)

---

## Implications for Roadmap

Based on combined research, the build order is hard-gated by dependencies. Architecture is clear enough that all 6 phases can be defined now with no additional research needed.

### Phase 1: Schema and Database Foundation

**Rationale:** All downstream code depends on shared TypeScript types compiling correctly. The Supabase migration must exist before any route can insert rows. RLS must be in the same commit as the table. This phase must complete and gate (TypeScript compiles, migration applies cleanly) before anything else starts.

**Delivers:** Extended shared/schema.ts with postSlideSchema, carouselRequestSchema, enhanceRequestSchema, scenerySchema; extended postSchema.content_type to ["image", "video", "carousel", "enhancement"]; post_slides table with RLS; posts.slide_count column; posts.content_type CHECK constraint extended; scenery catalog seeded via migration SQL.

**Addresses:** Gallery and billing statement compatibility (SHARED-03), storage cleanup correctness (CAROUSEL-08), scenery catalog schema (SHARED-06).

**Avoids:** Use text+CHECK constraint (not PostgreSQL ENUM type) to avoid enum alteration downtime (CAROUSEL-09). RLS co-deployment rule enforced here (SHARED-02).

### Phase 2: Server Services

**Rationale:** Services are the testable logic layer — smoke-testable with mock Gemini responses before routes exist. Building services before routes forces the billing contract decision (partial-success, idempotency) to be settled in an isolated context rather than discovered mid-route implementation.

**Delivers:** carousel-generation.service.ts (N sequential calls, slide-1-as-reference technique, partial-success contract, idempotency); enhancement.service.ts (image-to-image with dual-zone scenery prompt, sharp pre-normalization, EXIF stripping); extended server/quota.ts checkCredits with slideCount multiplier parameter; extended storage-cleanup.service.ts for slides/{postId}/ directories.

**Addresses:** Style incoherence (CAROUSEL-01, CAROUSEL-02), partial failure contract (CAROUSEL-03), double-charging on retry (CAROUSEL-04), rate limit safety (CAROUSEL-07), enhancement subject drift (ENHANCE-01, ENHANCE-03), upload size spike (ENHANCE-02), aspectRatio bug workaround (MODERATE-03).

**Avoids:** N independent text calls producing incoherent narrative — master text call architecture locked here (CAROUSEL-06). Full parallel slide generation hitting IPM rate limits — sequential-only pattern documented (CAROUSEL-07).

### Phase 3: Server Routes

**Rationale:** Routes are thin orchestration wrappers over Phase 2 services, following the identical auth -> credit gate -> SSE init -> pipeline -> usage recording -> deduct -> sendComplete pattern as generate.routes.ts. Because services are pre-built and tested, routes can be written quickly with confidence.

**Delivers:** carousel.routes.ts (POST /api/carousel/generate with idempotency key check, partial-success handling, per-slide SSE events, safety timer raised to 500s or slide cap at 8); enhance.routes.ts (POST /api/enhance with NSFW pre-screen, logo overlay hardcoded off, single usage event); both registered in server/routes/index.ts; edit.routes.ts guarded against carousel/enhancement content types.

**Addresses:** SSE timeout for long carousel jobs (CAROUSEL-05), NSFW upload handling (ENHANCE-04, ENHANCE-05), logo overlay exclusion (MINOR-01), generation log error types (MINOR-03).

### Phase 4: Admin UI — Scenery Catalog

**Rationale:** The enhancement creator dialog (Phase 5) needs the scenery catalog populated before it can be usefully tested end-to-end. This phase is short but must precede the frontend creator phase.

**Delivers:** Extended admin style catalog tab with Sceneries section (add/edit/delete; label, prompt snippet, categories, preview image); /api/admin/flush-catalog-cache endpoint; 60s cache TTL documented in admin UI.

**Addresses:** Scenery catalog cache staleness (SHARED-04), admin config drift (SHARED-06).

### Phase 5: Frontend Creator Dialogs

**Rationale:** Creator dialogs are the user-facing entry point for both new features. Building them after routes are confirmed working means the SSE event shape is stable before frontend consumption. Shared components (CreditGateAlert, GenerationProgress) should be extracted before building the dialogs.

**Delivers:** carousel-creator-dialog.tsx (slide count stepper 3-10, aspect ratio picker 1:1/4:5, credit preview, per-slide SSE progress, embla slide strip viewer); enhancement-creator-dialog.tsx (photo upload with 5MB client gate, scenery picker grid, optional free-text modifier, before/after result viewer); updated app-sidebar.tsx with New Content dropdown; extracted CreditGateAlert and GenerationProgress shared components; i18n keys in EN/PT/ES.

**Addresses:** Frontend state explosion from extending PostCreatorDialog (SHARED-07), SSE auto-reconnect for long jobs (SHARED-05), i18n completeness (SHARED-08).

**Avoids:** Extending post-creator-dialog.tsx (already 700+ lines) — separate dialogs per media type is the mandated pattern.

### Phase 6: Gallery Surface Updates

**Rationale:** Gallery updates come last: they depend on the content_type enum extension (Phase 1), post_slides data (Phase 2/3), and real carousel and enhancement posts existing to render. The exhaustiveness guard (never check) must be the first task in this phase.

**Delivers:** Extended posts.tsx gallery with carousel tile (stacked-card CSS, "Carousel N slides" badge using posts.slide_count — no extra join required), enhancement tile (optional Enhanced badge); CarouselViewerDialog with embla slide strip; billing statement content_type filter extended to all four types plus getContentTypeLabel() utility; TanStack Query invalidateQueries(['posts']) fired from both complete and error SSE handlers.

**Addresses:** Silent else-branch rendering (SHARED-03), billing filter blind spots (MODERATE-05), stale gallery after partial retry (MINOR-02).

### Phase Ordering Rationale

- Schema before services before routes is non-negotiable: TypeScript will not compile against types that do not exist; Supabase rejects inserts into tables that do not exist; RLS must ship in the same migration as the table.
- Services before routes forces the partial-success contract and idempotency key design to be settled in an isolated testable context rather than discovered mid-route implementation.
- Admin UI before creator dialogs: the enhancement dialog is not meaningfully testable without scenery presets existing in the catalog.
- Gallery last: need real carousel and enhancement posts to render; exhaustiveness guard must be the first act, not the last, to catch missing branches at compile time rather than runtime.

### Research Flags

Phases with standard patterns (no additional research-phase needed):

- **Phase 1 (Schema):** Supabase migration pattern, Zod enum extension, RLS policy structure — all established in v1.0.
- **Phase 3 (Routes):** SSE pipeline, auth middleware, credit gate, usage recording — direct reuse of battle-tested generate.routes.ts pattern.
- **Phase 4 (Admin UI):** Direct extension of existing style catalog admin surface — same schema pattern, same CRUD endpoints.
- **Phase 6 (Gallery):** TanStack Query patterns, gallery tile rendering — well-established in v1.0.

Phases needing targeted validation during implementation:

- **Phase 2 (Services) — carousel style consistency:** MEDIUM confidence on shared_style + cascading reference-image technique. If QA reveals poor style consistency, pre-plan fallback (longer shared_style descriptor, different reference-passing approach).
- **Phase 2 (Services) — Gemini IPM rate limits:** LOW confidence on images-per-minute quota (undocumented). If sequential generation hits 429 at 5+ slides, reduce concurrency further.
- **Phase 5 (Creator Dialogs) — enhancement pre-screen accuracy:** MEDIUM confidence on Gemini text-model classification accuracy for edge cases. Validate against diverse product categories during QA.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new deps confirmed. API constraints verified from official sources and forum threads. All integration points mapped to existing code. |
| Features | MEDIUM-HIGH | IG specs HIGH from official sources. Competitive benchmarking MEDIUM from third-party reviews. 12 scenery presets are a design decision. |
| Architecture | HIGH | All recommendations from direct codebase reading. Every integration point verified against actual source files. Component boundaries match existing project conventions. |
| Pitfalls | HIGH | Partial failure contract, RLS co-deployment, content_type exhaustiveness, EXIF stripping, idempotency — all from direct code inspection. MEDIUM for Gemini model behavior pitfalls. |

**Overall confidence:** HIGH

### Gaps to Address

- **Gemini IPM rate limits:** Exact images-per-minute quota for gemini-3.1-flash-image-preview on paid tiers is undocumented. Default to sequential generation; test controlled parallelism (2 concurrent) during Phase 2 QA before locking implementation.
- **Enhancement subject preservation:** Exact prompt language for subject-preservation across diverse product categories needs hands-on testing during Phase 2. Run QA against 3+ product surface types per scenery before shipping.
- **Partial carousel success UX:** The 50%+ threshold for save-vs-discard needs product validation. Consider whether partial save is better surfaced as a retry prompt.
- **SSE timeout headroom:** Verify hosting plan supports 500s request duration before locking the carousel slide cap at 8 vs 10.

---

## Sources

### Primary (HIGH confidence)

- Gemini API image generation docs: https://ai.google.dev/gemini-api/docs/image-generation
- Gemini API pricing (April 2026): https://ai.google.dev/gemini-api/docs/pricing
- candidateCount not supported: https://discuss.ai.google.dev/t/multiple-candidates-candidatecount-is-not-supported-for-image-generation-models/124694
- Seed parameter — Vertex AI Imagen only: https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-deterministic-images
- aspectRatio bug on editing calls: https://discuss.ai.google.dev/t/gemini-3-1-flash-image-preview-ignores-imageconfig-aspect-ratio-and-reshuffles-layout-on-background-edit/128031
- imageSize ignored in SDK paths: https://github.com/googleapis/js-genai/issues/1461
- IG carousel 20-slide update: https://www.socialmediatoday.com/news/instagram-expands-carousels-to-20-frames/723792/
- IG carousel dimension specs: https://www.overvisual.com/tools/instagram-carousel-size
- Direct codebase: server/routes/generate.routes.ts, server/quota.ts, server/services/image-generation.service.ts, server/services/storage-cleanup.service.ts, shared/schema.ts, client/src/components/post-creator-dialog.tsx

### Secondary (MEDIUM confidence)

- Style consistency technique: https://towardsdatascience.com/generating-consistent-imagery-with-gemini/
- Undocumented IPM limits: https://discuss.google.dev/t/undocumented-rate-limits-for-gemini-image-generation-2-5-rpm/303281
- Predis.ai carousel: https://predis.ai/instagram-carousel-maker/
- PostNitro carousel: https://postnitro.ai/blog/post/ai-carousel-generator
- Photoroom product photo scenery: https://www.photoroom.com/blog/product-photography-backgrounds
- AI product photo tools: https://claid.ai/blog/article/ai-product-photo-tools
- AI product photo failure modes: https://medium.com/@TimDo007/why-your-ai-product-photos-look-terrible-and-its-not-the-tool-s-fault-0686e13aff20

### Tertiary (LOW confidence)

- Undocumented IPM quota: community observations only, no official numbers confirmed

---
*Research completed: 2026-04-21*
*Ready for roadmap: yes*
