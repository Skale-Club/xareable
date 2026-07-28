# Phase 25: Narrative Carousels & Aesthetic DNA - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Carousels produce a genuine visual narrative (hook slide → developing content slides → CTA slide) with per-slide composition variation and real on-slide text via the deterministic compositor; every style/mood in the platform catalog carries dense, professional art direction — photography type, lighting, 60-30-10 named-color usage, anti-AI-look negative prompts — with admin-curated style reference boards attached to generation.

</domain>

<decisions>
## Implementation Decisions

### Narrative Structure & Composition Variation (CRSL2-01)
- Each slide gains a `role` field (`"hook" | "content" | "cta"`) in the master plan schema, assigned DETERMINISTICALLY by server-side code, not left to the model: slide 1 is always `hook`, the last slide is always `cta`, everything in between is `content`.
- Each slide's schema also gains a required `composition_note` field describing its intended framing/camera angle/shot type. The master prompt instructs the model to vary this across slides (e.g. wide establishing shot for the hook, close-up detail shots for content, a clear product/CTA shot for the closer) — explicitly countering today's "reference the same composition" instruction in the slide-2..N edit prompt.
- SC2's "automated inter-slide composition-similarity check" is implemented as a text/schema-based check (comparing the structured `composition_note` values for meaningful difference across slides) — cheap, deterministic, CI-testable via the static harness. A true visual/pixel-level similarity check is NOT required; real visual confirmation is a manual/live runbook item.

### Deterministic Compositor Wiring for Carousels (CRSL2-02, CRSL2-04)
- Every slide runs through the SAME pipeline order as Phase 23's single-image path: AI image-gen/edit → `cropToExactAspectRatio` → `resolveTextBlocks`/`compositeTypography` → `applyLogoOverlay` → optimize/upload.
- Each slide gets its own `text_blocks` array (same shape as the single-image schema — headline/support/cta role-tagged text entries), populated per-slide by the master planning call.
- `layout_archetype_id` is chosen ONCE for the whole carousel (same mechanism as `shared_style`) and applied consistently to every slide — this satisfies SC1's explicit requirement that "fonts/colors/layout archetype [are] held consistent across all slides." Per-slide layout archetype variation is explicitly NOT done.
- `textStyleIds` (currently parsed into `CarouselGenerationParams` but never read anywhere) is wired to actually influence the typography compositor's font/style choice for the carousel.
- Logo overlay is ALREADY functional for carousels today (`applyLogoOverlay` already runs per slide) — CRSL2-04's logo clause is a confirm/harden task, not new construction. Contrast-aware logo treatment is explicitly Phase 26's scope, not this phase's.
- `post_slides`/`post_slide_versions` (or equivalent) need additive columns analogous to Phase 23's `posts.base_image_url`/`typography_meta` — exact schema/migration is research/planning's job, following the established additive-migration pattern.

### Aesthetic DNA — Dense Art Direction & Color (PLAN-05, PLAN-06)
- `brandStyleSchema`/`postMoodSchema` (the style catalog's data shape) gain new structured fields for dense art direction — photography type, lighting treatment, anti-AI-look negative prompts — as admin-curated DATA (extending the catalog schema + its admin editor UI), not just prompt-engineering synthesized on top of the existing thin `label`/`description` fields.
- 60-30-10 color usage: `color_1` as the 60% dominant tone, `color_2` as the 30% secondary tone, `color_4` as the 10% accent — exact prompt-phrasing formula is Claude's technical discretion, but MUST explicitly reference `color_4` per SC4's callout (today's `color_4` field exists in brand schema but is unused in any 60-30-10 proportion language — it's currently just flat-joined with the other colors).
- The EXISTING `DEFAULT_STYLE_CATALOG` entries (styles + post_moods) get real, dense content written for their new art-direction fields as part of this phase — not left as empty schema slots awaiting future curation. This is real content/copywriting work within the phase's scope.

### Admin-Curated Style Reference Boards (PLAN-07)
- New platform-wide table (e.g. `style_reference_photos`) keyed by `style_id` (not `brand_id`/`user_id` like the existing `brand_reference_photos`) — admin-only write RLS, public/any-authenticated-user read RLS. Structurally similar to `brand_reference_photos` (image set + position ordering + storage bucket pattern) but with an inverted ownership/ACL model.
- When multiple reference-image sources compete for the limited multimodal image-slot budget (the existing 4-slot Gemini limit), priority order is: user-uploaded images (most specific intent) > brand reference photos (established brand look) > style reference board images (general aesthetic direction, least specific) — filling remaining slots in that order.
- The admin UI for managing style reference boards lives inside the existing style-catalog admin editor (wherever styles/moods are currently managed), not a new separate admin page.

### Claude's Discretion
- Exact `post_slides`/`post_slide_versions` migration shape for base-image/typography persistence.
- Exact composition_note variation phrasing/instructions in the master prompt.
- Exact new art-direction schema field names and their prompt-injection format.
- Exact 60-30-10 color-usage prompt formula.
- Exact dense content written for each existing DEFAULT_STYLE_CATALOG entry.
- Exact `style_reference_photos` migration/RLS policy wording.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/services/carousel-generation.service.ts` — `shared_style` (single dense paragraph applied to every slide) is the existing precedent for `layout_archetype_id`'s "chosen once, applied to all slides" pattern.
- Phase 23's `typography-compositor.service.ts`/`image-crop.service.ts` — used as-is in the carousel per-slide loop, no new compositor logic needed, just wiring.
- `brand_reference_photos` table/RLS/routes (`shared/schema.ts:81-89`, `supabase/migrations/20260516000000_brand_style_references.sql`, `server/routes/brand-references.routes.ts`) — structural precedent for `style_reference_photos` (image set + position + storage bucket), though ownership/RLS model is inverted.
- `scenerySchema` (`shared/schema.ts:232-239`) — existing platform-wide, admin-curated single-image catalog entry pattern (used for ENHC-02 enhancement) — a closer ownership-model precedent than brand references, though singular-image not multi-image.
- Existing `mergedReferenceImages` slot-priority pattern from Phase 22/generate.routes.ts — template for merging style-board + brand + user reference images within the 4-slot limit.

### Established Patterns
- CRSL2-03 (Phase 21) already fixed slide-1-failure aborting the loop immediately — untouched by this phase.
- The slide-1-as-reference pattern (`imageProvider.edit()` using slide 1's buffer for slides 2..N) stays as-is; only the instruction text embedded in that edit prompt changes (stop telling the model to match "composition," start allowing/encouraging framing variation while keeping style/color/lighting consistent).
- `app_settings.style_catalog` JSONB storage — new art-direction/reference-board fields extend this existing admin-curated JSONB blob (styles/post_moods), following the same additive-field convention.

### Integration Points
- `server/services/carousel-generation.service.ts`: `buildCarouselMasterPrompt`, `CarouselTextPlan` type, the per-slide loop (`generateSlideOne`/`generateSlideN`), `callCarouselTextPlan`.
- `server/services/gemini.service.ts:560-566` and `prompt-builder.service.ts:272-288` — where today's thin one-liner style/mood/color injection happens; both need the new dense-art-direction/60-30-10 logic.
- `shared/schema.ts` — `brandStyleSchema`, `postMoodSchema`, `styleCatalogSchema` gain new fields; new `style_reference_photos` table schema.
- `server/routes/carousel.routes.ts` — per-slide pipeline gains crop/compositor/logo stages; `textStyleIds` gets actually consumed.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP's stated success criteria and REQUIREMENTS.md's PLAN-05..07/CRSL2-01,02,04 — these are the primary specification, cross-checked against the codebase scout above.

</specifics>

<deferred>
## Deferred Ideas

- Contrast-aware adaptive logo overlay — explicitly Phase 26's scope, not this phase's (logo overlay stays purely positional here, as it is today).

</deferred>
