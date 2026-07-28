# Requirements: Xareable v1.6 — Professional Design Quality Overhaul + OpenRouter Gateway

**Defined:** 2026-07-18
**Core Value:** Users can generate on-brand visual content that looks professionally designed — in seconds, from a prompt — with typography, layout, and color treatment indistinguishable from a designer's work.

## v1.6 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### OpenRouter Gateway (GATE)

- [x] **GATE-01**: All text/planning AI calls (art-director plan, carousel master plan, caption quality, enhancement caption, pre-screen) route through one shared OpenRouter gateway service (OpenAI SDK + baseURL), replacing the 5 independent raw-fetch Gemini implementations
- [x] **GATE-02**: Image generation and edit calls route through OpenRouter's dedicated Image API (raw HTTP) with native `aspect_ratio` and `resolution` params; the existing `ImageProvider.generate()/edit()` interface is preserved so all 6 call sites are untouched
- [x] **GATE-03**: Audio transcription routes through the OpenRouter gateway
- [x] **GATE-04**: Model slugs are admin-configurable via `platform_settings` (`aiModelsSchema`) with a fallback chain per call class — zero hardcoded slugs; the legacy gemini/openai `image_provider` toggle is retired
- [x] **GATE-05**: Billing consumes OpenRouter's real per-request `usage.cost` (with markup multiplier) via an additive `recordUsageEvent` param — static token pricing tables retired for gateway calls (video keeps flat fallback pricing)
- [x] **GATE-06**: Admin/affiliate BYO keys migrate to OpenRouter keys (new `profiles.openrouter_api_key`, additive — old key columns retained dead); key resolution mirrors the existing `getGeminiApiKey` middleware pattern
- [x] **GATE-07**: Emergency rollback — admin can switch any call class back to the direct Gemini path without a deploy
- [x] **GATE-08**: Video pipeline is untouched (FROZEN) — a regression smoke test guards that video generation still works via direct Google API after the gateway lands

### Deterministic Typography (TYPO)

- [x] **TYPO-01**: Generated images are text-free by prompt design, with negative space reserved for the chosen layout archetype
- [x] **TYPO-02**: A typography compositor service (@napi-rs/canvas) renders `text_blocks` (highlight/support/cta) with real bundled fonts over the AI image, using layout archetypes (bottom band w/ scrim, top stack, centered hero) and per-format safe zones (incl. IG 4:5 grid-crop margins)
- [x] **TYPO-03**: Text contrast is guaranteed — target region analyzed (sharp region stats), scrim/plate applied automatically when contrast is insufficient
- [x] **TYPO-04**: Fonts are bundled in the production Docker image (fontconfig + fc-cache on Alpine) with full pt-BR/es glyph coverage; a CI golden-image render test fails the build on tofu/missing glyphs
- [x] **TYPO-05**: Posts persist `base_image_url` (pre-typography AI output) + `typography_meta` (layout archetype, text blocks, fonts) so edit/remake flows operate on the base image and re-apply typography
- [x] **TYPO-06**: The exact-text verify/repair loop is removed — exact text mode is now guaranteed by the compositor (repair-loop Gemini calls and their unbilled cost disappear)
- [x] **TYPO-07**: Single-image edit flow edits the base image, then re-applies typography — no double-rendered text

### Art Director Planning Call (PLAN)

- [x] **PLAN-01**: User reference images and brand reference photos are actually attached (multimodal) to the planning call
- [x] **PLAN-02**: Planning call uses strict structured outputs (`json_schema`) — JSON parse failures eliminated; the silent local-fallback template path is removed for schema errors (transport-error fallback remains, logged and surfaced in `generation_logs`)
- [x] **PLAN-03**: Planning model is admin-configurable at a higher tier; output token budget scales with slide count
- [x] **PLAN-04**: Structured creative plan is the source of truth for the image prompt (precedence bug fixed); the final prompt is composed as dense natural-language scene description, not mechanical field concatenation
- [x] **PLAN-05**: Style catalog upgraded from one-liners to dense art direction per style/mood (photography type, lighting, composition, texture) + a global anti-AI-look negative prompt block
- [x] **PLAN-06**: Brand colors injected as named colors with 60-30-10 proportion rules; `color_4` included
- [x] **PLAN-07**: Platform-curated style reference boards (admin-managed images per style/mood) attached to image generation as style references

### Visual Critic (CRIT)

- [x] **CRIT-01**: A multimodal critic call scores every generated image on composition, text legibility zone, color harmony, and unwanted-AI-text before post-processing
- [x] **CRIT-02**: On threshold failure the pipeline re-rolls sequentially (cap 2 attempts); unwanted rendered text is a hard-fail gate
- [x] **CRIT-03**: Re-rolls are integrated with the billing invariant — user is charged once per delivered post; platform-side re-roll cost is tracked in the usage event metadata
- [x] **CRIT-04**: SSE safety timers re-derived for the gateway+critic latency budget on Coolify, with AbortSignal wired so a fired timer actually cancels in-flight work
- [x] **CRIT-05**: Critic outcomes (scores, re-roll count, text-free compliance) logged to `generation_logs` — compliance rate is measurable

### Narrative Carousels (CRSL2)

- [x] **CRSL2-01**: Carousel master plan produces per-slide `text_blocks` with narrative typing (hook slide → content slides → CTA slide), a layout archetype, and a per-slide composition variation directive (reverses CRSL-10)
- [x] **CRSL2-02**: Compositor applies per-slide typography with shared style tokens (fonts, colors, archetype) held constant across slides
- [x] **CRSL2-03**: Slide-1 failure aborts the generation loop immediately (`break`) — no doomed downstream API calls
- [x] **CRSL2-04**: Carousel honors previously-dead creator options: text styles feed the compositor; `use_logo`/`logo_position` apply the deterministic logo overlay per slide

### Fixes & Polish (POL)

- [x] **POL-01**: Video-edit credit gate passes `isVideo` — estimate matches the real flat video charge
- [x] **POL-02**: WebP output quality raised to 85+ with a text-edge quality check on composited images
- [ ] **POL-03**: Logo overlay gets contrast treatment — adaptive plate/shadow, corner chosen by region contrast analysis, JPEG (no-alpha) logos handled without opaque-box artifacts — code complete (26-07), fixture-driven functional proof green (`scripts/test-logo-overlay-contrast.ts` 10/10, `scripts/verify-phase-26.ts --only=svc-logo-contrast` 4/4); 26-10's operator visual-confirmation step (a JPEG logo on a busy photo shows a soft plate, not a box) is the outstanding sign-off
- [x] **POL-04**: Post-generation crop normalizes the image to the exact requested aspect (e.g., 1200:628) before typography/logo compositing
- [x] **POL-05**: Generation parameters (aspect ratio, resolution, content options) persisted on posts for faithful edit/remake
- [ ] **POL-06**: `/api/generate` and `/api/edit-post` accept idempotency keys (same contract as carousel/enhance) — client (26-04) + server (26-06) both landed; live proof (two identical requests with one key → one row, one usage event) is 26-10's operator-sign-off checkpoint, not yet run
- [x] **POL-07**: All AI API keys sent via headers only — no key ever appears in a query string
- [ ] **POL-08**: Post-migration cost reconciliation: `generation_logs`/usage events audited against the OpenRouter dashboard for one billing period (post-ship audit — cannot gate milestone close; scheduled via `docs/cost-reconciliation-runbook.md`, not yet run)
- [ ] **POL-09**: Users can thumbs-up/down any generated post; feedback + critic/fallback rates surfaced in an admin quality dashboard — user half landed (26-08): `posts.feedback` column + `PATCH /api/posts/:id/feedback` + viewer thumbs-up/down control; admin Quality dashboard (feedback tally + critic/fallback rates) is 26-09's job, not yet landed

## Future Requirements (v1.7+)

Deferred. Tracked but not in current roadmap.

### Video (unfreezes in a future milestone)

- **VID-01**: Video generation gateway decision (Veo direct vs OpenRouter video model) and migration
- **VID-02**: Video generation parameters persisted and honored on remake (duration, resolution, aspect)
- **VID-03**: Real logo watermark on videos (ffmpeg) or removal of logo promises from video prompts
- **VID-04**: Video thumbnail extraction (first frame) for gallery

### Enhancement

- **ENH-01**: Enhancement caption becomes multimodal (sees the result image) and flows through `ensureCaptionQuality`
- **ENH-02**: Enhancement thumbnails generated for gallery performance

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Any video pipeline change beyond POL-01 + GATE-08 smoke test | FROZEN this milestone — Veo not on OpenRouter; gateway decision deferred |
| ffmpeg-based processing | Heavy dependency; not needed while video is frozen |
| Enhancement pipeline redesign | Inherits gateway call layer only; scenery flow already solid |
| Parallel best-of-N generation | Conflicts with per-post credit billing; sequential re-roll chosen instead |
| Split-panel / two-column layout archetypes | Image models can't reliably reserve exact half-canvas space (research anti-feature) |
| Per-user custom font uploads | Platform-curated font set only; licensing + glyph coverage risk |
| Client-side typography editor (drag/resize text) | v2 direction; this milestone is server-side deterministic composition |

## Traceability

Which phases cover which requirements. Updated during roadmap creation (revised during roadmap validation: GATE-06 split into decimal Phase 21.1).

| Requirement | Phase | Status |
|-------------|-------|--------|
| GATE-01 | Phase 21 | Complete |
| GATE-02 | Phase 21 | Complete |
| GATE-03 | Phase 21 | Complete |
| GATE-04 | Phase 21 | Complete |
| GATE-05 | Phase 21 | Complete |
| GATE-06 | Phase 21.1 | Complete |
| GATE-07 | Phase 21 | Complete |
| GATE-08 | Phase 21 | Complete |
| POL-01 | Phase 21 | Complete |
| POL-07 | Phase 21 | Complete |
| CRSL2-03 | Phase 21 | Complete |
| PLAN-01 | Phase 22 | Complete |
| PLAN-02 | Phase 22 | Complete |
| PLAN-03 | Phase 22 | Complete |
| PLAN-04 | Phase 22 | Complete |
| TYPO-01 | Phase 23 | Complete |
| TYPO-02 | Phase 23 | Complete |
| TYPO-03 | Phase 23 | Complete |
| TYPO-04 | Phase 23 | Complete |
| TYPO-05 | Phase 23 | Complete |
| TYPO-06 | Phase 23 | Complete |
| TYPO-07 | Phase 23 | Complete |
| POL-04 | Phase 23 | Complete |
| POL-05 | Phase 23 | Complete |
| CRIT-01 | Phase 24 | Complete |
| CRIT-02 | Phase 24 | Complete |
| CRIT-03 | Phase 24 | Complete |
| CRIT-04 | Phase 24 | Complete |
| CRIT-05 | Phase 24 | Complete |
| PLAN-05 | Phase 25 | Complete |
| PLAN-06 | Phase 25 | Complete |
| PLAN-07 | Phase 25 | Complete |
| CRSL2-01 | Phase 25 | Complete |
| CRSL2-02 | Phase 25 | Complete |
| CRSL2-04 | Phase 25 | Complete |
| POL-02 | Phase 26 | Complete |
| POL-03 | Phase 26 | Pending — code complete (26-07); 26-10 operator visual sign-off outstanding |
| POL-06 | Phase 26 | Pending — client (26-04) + server (26-06) landed; 26-10 operator sign-off (live proof) outstanding |
| POL-08 | Phase 26 | Scheduled (non-gating) — runbook + scaffold set up in 26-05, audit runs post-ship |
| POL-09 | Phase 26 | Pending — user half (26-08) landed: schema/migration/endpoint/viewer UI; admin Quality dashboard (26-09) not yet landed |

**Coverage:**
- v1.6 requirements: 40 total
- Mapped to phases: 40 (across 7 phases: 21, 21.1, 22, 23, 24, 25, 26)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-18*
*Last updated: 2026-07-18 — roadmap revised per validation: GATE-06 moved to new decimal Phase 21.1 (Affiliate BYOK Migration); 7 phases total, 100% coverage (40/40 requirements mapped)*
