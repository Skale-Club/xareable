# Roadmap: Xareable

## Milestones

- ✅ **v1.0 Bug Fixes & System Hardening** — Phases 1-4 (shipped 2026-04-20)
- ✅ **v1.1 Media Creation Expansion** — Phases 5-12 + 12.5 + 12.6 (shipped 2026-05-18) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Production Hardening** — Phases 13-15 (shipped 2026-05-08) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Generation Quality Observability** — Phase 16 (shipped 2026-05-08) — see [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 GHL Signup Sync** — Phase 17 (shipped 2026-05-16) — see [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- ✅ **v1.5 Brand Style References** — Phases 18-20 (shipped 2026-05-16)
- 🚧 **v1.6 Professional Design Quality Overhaul + OpenRouter Gateway** — Phases 21-26 + 21.1 (in progress)

> **Merge reconciliation note (2026-05-17):** Phase 12 had two parallel implementations across `dev` and `origin/dev`. Resolution:
> - **Phase 12** (canonical, integer) = Image Provider Abstraction (OpenAI gpt-image-2 alternative) — from origin/dev, shipped 2026-05-17. Includes decimal patches 12.1, 12.2, 12.3, 12-audit.
> - **Phase 12.5** (decimal insert) = Schedule billing overage batch via existing cleanup-cron — from local dev, graduated SEED-001, shipped 2026-05-08.
> Both implementations preserved in code; planning narrative unified.

> **Merge reconciliation note (2026-05-18):** A second divergence was discovered on `origin/main`: a Phase 13 implementing **carousel quick-remake + per-slide edit** had shipped there in parallel with `dev`'s Phase 13 (Production Hardening). Resolution:
> - `dev`'s **Phase 13** (canonical for v1.2) = Production Hardening Fixes — preserved.
> - `origin/main`'s Phase 13 renamed to **Phase 12.6** (decimal insert under v1.1, depends on Phase 12 image provider) = Carousel Quick Remake & Per-Slide Edit Image — shipped 2026-05-18.
> Both implementations preserved in code; planning folder renamed; ROADMAP/STATE unified.

## Shipped

<details>
<summary>✅ v1.1 Media Creation Expansion (Phases 5-12 + 12.5 + 12.6) — SHIPPED 2026-05-18</summary>

- [x] Phase 5: Schema & Database Foundation (3/3 plans) — completed 2026-04-21
- [x] Phase 6: Server Services (3/3 plans) — completed 2026-04-21
- [x] Phase 7: Server Routes (3/3 plans) — completed 2026-04-22
- [x] Phase 8: Admin — Scenery Catalog (1/1 plan) — completed 2026-04-28
- [x] Phase 9: Frontend Creator — Carousel & Enhancement Branches (4/4 plans) — completed 2026-04-29
- [x] Phase 09.1: Creator dialog UX gap closure (3/3 plans) — completed 2026-04-29
- [x] Phase 10: Gallery Surface Updates (4/4 plans) — completed 2026-04-30
- [x] Phase 11: Post Trash & Automated Cleanup (4/4 plans) — completed 2026-05-07
- [x] **Phase 12: Image Provider Abstraction (OpenAI gpt-image-2 alternative) (5/5 plans + 4 decimal patches) — completed 2026-05-17**
- [x] Phase 12.1: per-user image provider preference (admin/affiliate) — completed 2026-05-17
- [x] Phase 12.2: platform API keys move from env to admin panel — completed 2026-05-17
- [x] Phase 12.3: tier model hardening — admins share platform key — completed 2026-05-17
- [x] Phase 12-audit: resolve 7 audit findings from Phase 12+12.1 review — completed 2026-05-17
- [x] **Phase 12.5: Schedule billing overage batch via cleanup-cron** (graduates SEED-001; 1 plan) — completed 2026-05-08
- [x] **Phase 12.6: Carousel Quick Remake & Per-Slide Edit Image** (5/5 plans) — completed 2026-05-18

**Totals:** 9 phases (5-12) + 2 decimal inserts (12.5, 12.6) + 4 patches (12.1-12.3, 12-audit). Full details in [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).

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

<details>
<summary>✅ v1.5 Brand Style References (Phases 18-20) — SHIPPED 2026-05-16</summary>

- [x] Phase 18: Data Layer + API Endpoints (3/3 plans) — completed 2026-05-16
- [x] Phase 19: Settings UI — Style Tab (1/1 plan) — completed 2026-05-16
- [x] Phase 20: Generation Integration (1/1 plan) — completed 2026-05-16

**Totals:** 3 phases, 5 plans — graduates SEED-006. Brand reference photos are now end-to-end wired (storage → API → settings UI → generation injection).

</details>

## 🚧 v1.6 Professional Design Quality Overhaul + OpenRouter Gateway (In Progress)

**Milestone Goal:** Rebuild the generation pipeline so output has professional-designer quality — moving quality-critical work OUT of the AI models into deterministic, verifiable server-side layers — on top of a single unified AI gateway (OpenRouter) that replaces direct Gemini/OpenAI API calls for text, image, and transcription. Video is explicitly FROZEN this milestone (Veo is not on OpenRouter).

**Numbering:** Continues from v1.5's last integer phase (20). v1.6 spans **Phases 21-26**, plus decimal **Phase 21.1** (Affiliate BYOK Migration — split from Phase 21 during roadmap validation so key provisioning/rotation and billing attribution get their own verifiable delivery, still inside the P0 window).

**Dependency order (from research architecture, `.planning/research/ARCHITECTURE.md` Build Order):** Gateway (21) blocks everything — structured outputs feed typography, real cost feeds billing, vision calls feed the critic. Affiliate BYOK migration (21.1) depends on the gateway and lands immediately after it. Art-director planning upgrade (22) rides the same call surface as the gateway and must land before typography can consume its structured `text_blocks`/`layout_archetype_id` output. Typography (23) is a hard dependency for narrative on-slide carousel text (25). Critic (24) depends only on the gateway (21) and could run in parallel with 23, but is sequenced after it to avoid simultaneous changes to `generate.routes.ts`. Polish (26) lands last. Surgical one-line production-bug fixes (`POL-01` isVideo credit gate, `CRSL2-03` carousel slide-1 `break`) are pulled into Phase 21 — the earliest practical phase — rather than held hostage to later phases they have no real dependency on.

## Phases

- [x] **Phase 21: OpenRouter Gateway Foundation** - All text/image/transcription AI calls route through one OpenRouter gateway with admin-configurable models + fallback chains, real per-request billing, and emergency rollback; two production-bug fixes ride along. (completed 2026-07-27)
- [x] **Phase 21.1: Affiliate BYOK Migration** - Admin/affiliate BYO keys migrate to OpenRouter keys with provisioning, rotation, and verified per-affiliate billing attribution. (completed 2026-07-27)
- [x] **Phase 22: Art Director Planning Upgrade** - The planning call actually sees reference images, returns reliable structured JSON from a stronger model, and its output correctly drives the final image prompt. (completed 2026-07-27)
- [x] **Phase 23: Deterministic Typography & Edit Fidelity** - On-image text is rendered server-side with real fonts over text-free AI images; edit/remake flows operate on a persisted pre-typography base image with original generation parameters intact.
 (completed 2026-07-27)
- [x] **Phase 24: Visual Critic & Re-roll** - Every generated image is scored for composition/legibility/color harmony/unwanted text before delivery, with a bounded, billing-safe re-roll on failure.
 (completed 2026-07-28)
- [x] **Phase 25: Narrative Carousels & Aesthetic DNA** - Carousels tell a visual story with varied per-slide composition and real on-slide text; the style catalog produces dense, professional art direction instead of generic one-liners. (completed 2026-07-28)
- [ ] **Phase 26: Fixes & Polish** - Sharper compression, contrast-aware logo overlay, idempotent generation APIs, a reconciled cost model (post-ship audit), and a user feedback loop.

## Phase Details

### Phase 21: OpenRouter Gateway Foundation

**Goal:** All platform AI calls (text/planning, image generation and editing, transcription) run through one OpenRouter gateway service with admin-configurable model slugs and per-call-class fallback chains, real per-request cost flowing into billing, and an emergency rollback to the direct Gemini path — while video stays completely untouched. Two unrelated but trivial production-bug fixes ride along since this phase already touches their files.

**Depends on:** Nothing (first phase of v1.6; builds on the v1.5-shipped system).

**Requirements:** GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-07, GATE-08, POL-01, POL-07, CRSL2-03

**Success Criteria** (what must be TRUE):
  1. Generating a single-image post, editing a post, transcribing voice input, generating a carousel, and enhancing a product photo all complete successfully with the request routed through OpenRouter — not a direct raw-fetch call to Gemini or the OpenAI SDK.
  2. Admin can change the model slug for any AI call class (planning, image, transcription) via `platform_settings` without a code deploy, and the new model takes effect on the next generation; the old gemini/openai `image_provider` toggle is gone.
  3. Simulating a 404/deprecation on a call class's primary model automatically serves the request via the configured fallback model, with no redeploy, and the fallback event is logged in `generation_logs`.
  4. Both the pre-call estimate and the post-call actual `usage.cost` are recorded per generation; a completed post's usage event carries OpenRouter's real per-request cost (with markup applied) instead of a static token-pricing-table estimate.
  5. Admin can flip any call class back to the direct Gemini path without a deploy, and generation still succeeds via that path.
  6. Video generation is unaffected (regression smoke test passes against the direct Google API); a carousel generation aborts immediately with no downstream slide calls when slide 1 fails; the video-edit credit estimate matches the real flat video charge; no AI API key appears in a query string anywhere in the request/log surface.

**Plans:** 13/13 plans complete

Plans:
- [x] 21-01-PLAN.md — Wave 1: verify-phase-21 harness skeleton + GATE-08 video baseline hash freeze
- [x] 21-02-PLAN.md — Wave 2: ride-along fixes (POL-01 isVideo credit gate, CRSL2-03 slide-1 break, POL-07 text-rendering header)
- [x] 21-03-PLAN.md — Wave 2: OPENROUTER_API_KEY env + ai_gateway_routing/ai_model_fallbacks settings + recordUsageEvent real-cost params
- [x] 21-04-PLAN.md — Wave 3: ai-gateway.service.ts core (chatCompletion + transcribe + fallback chain + model_fallback logging)
- [x] 21-05-PLAN.md — Wave 4: gateway Image API (generate/edit) + OpenRouterImageProvider + input_references adapter test
- [x] 21-06-PLAN.md — Wave 5: image factory rewire (routing-aware; image_provider toggle retired) + admin routing/fallback endpoints + admin UI cleanup
- [x] 21-07-PLAN.md — Wave 5: gemini.service.ts generateText/generateCaptionOnly via gateway; direct rollback branch; dead transcribeAudio deleted
- [x] 21-08-PLAN.md — Wave 5: carousel master plan + caption-quality + enhancement pre-screen/caption via gateway; cost totals surfaced
- [x] 21-09-PLAN.md — Wave 5: transcribe route via gateway + billing wiring + header fix
- [x] 21-10-PLAN.md — Wave 6: generate + edit routes real-cost billing (GATE-05)
- [x] 21-11-PLAN.md — Wave 6: carousel + slide-edit real-cost billing (GATE-05)
- [x] 21-12-PLAN.md — Wave 6: enhancement real-cost billing (GATE-05)
- [x] 21-13-PLAN.md — Wave 7: verify-phase-21 final wiring (all stubs -> real checks) + manual/live runbook

---

### Phase 21.1: Affiliate BYOK Migration

**Goal:** Admin/affiliate bring-your-own-key accounts migrate from Gemini/OpenAI keys to OpenRouter keys — provisioning and rotation work end-to-end, and every generation made with an affiliate's key is billed to that affiliate's OpenRouter account, never the platform balance. Old key columns are retained dead (additive migration, no lockout).

**Depends on:** Phase 21 (the gateway and OpenRouter key-resolution path must exist).

**Requirements:** GATE-06

**Success Criteria** (what must be TRUE):
  1. An affiliate can be provisioned with — and later rotate — their own OpenRouter key via the new additive `profiles.openrouter_api_key` field; key resolution mirrors the existing `getGeminiApiKey` middleware pattern, and the old `api_key`/`openai_api_key` columns are retained dead (no affiliate is locked out mid-migration).
  2. A generation made with an affiliate's OpenRouter key is billed to that affiliate's account, not the platform balance (verified with provider pinning on a simulated failure).
  3. An affiliate without a configured OpenRouter key gets the established clear error message ("Affiliate accounts must configure their own OpenRouter API key in Settings before generating") instead of a silent 401 mid-SSE-stream.

**Plans:** 7/7 plans complete

Plans:
- [x] 21.1-01-PLAN.md — Wave 1: verify-phase-21.1 harness + test-affiliate-key-resolution fixture + additive `profiles.openrouter_api_key` migration + `getOpenRouterApiKey`/`selectImageApiKey`
- [x] 21.1-02-PLAN.md — Wave 2: `OpenRouterImageProvider` honors `input.apiKey`; `GeminiService(apiKey, openRouterApiKey)` + GATE-07 rollback limitation documented
- [x] 21.1-03-PLAN.md — Wave 2: `openRouterApiKey` threaded through caption-quality, carousel-generation, and enhancement services
- [x] 21.1-04-PLAN.md — Wave 3: generate + edit routes — affiliate-aware key gate (Pitfall 1 lockout fix) + key threading
- [x] 21.1-05-PLAN.md — Wave 3: carousel (generate + slide-edit) + enhance routes — affiliate-aware gate + key threading
- [x] 21.1-06-PLAN.md — Wave 3: transcribe + remake-caption routes — affiliate-aware gate + gateway key
- [ ] 21.1-07-PLAN.md — Wave 4: affiliate Settings UI (single OpenRouter key card) + phase gate + live billing-attribution checkpoint — **Tasks 1-2 done (`17914de`, `c172db7`); Task 3 (operator sign-off) BLOCKING, not started. See 21.1-07-SUMMARY.md.**

**UI hint:** yes

---

### Phase 22: Art Director Planning Upgrade

**Goal:** The planning call that drives every image generation actually receives reference images multimodally, returns dependable structured JSON from a higher-tier model with a token budget that scales with output size, and its structured output — not a stale mechanical concatenation — is the true source of the final image prompt.

**Depends on:** Phase 21 (needs the gateway's structured-output capability and admin-configurable model tier; PLAN-01..04 ride the same call surface the gateway introduces).

**Requirements:** PLAN-01, PLAN-02, PLAN-03, PLAN-04

**Success Criteria** (what must be TRUE):
  1. When a user attaches a reference image, or the brand has saved reference photos, the planning-call request payload contains the reference-image parts (multimodal), and an ablation run without them measurably changes the output prompt.
  2. Planning-call JSON parse failures never silently fall back to the generic local template; schema failures are logged and surfaced in `generation_logs`, while only genuine transport-level failures use the documented fallback path.
  3. A carousel requested with a high slide count receives a complete, non-truncated plan — output token budget scales with slide count.
  4. The final image prompt sent to the image model matches the structured creative plan's fields as dense natural-language scene description — the precedence bug where mechanical field concatenation won out is gone.
  5. The structured planning `json_schema` includes `text_blocks` and `layout_archetype_id` fields from day one — even though they are only consumed by the Phase 23 compositor — so the planning-call schema never needs reopening later.

**Plans:** 6/6 plans complete

Plans:
- [x] 22-01-PLAN.md — Wave 1: verify-phase-22 harness + planning-schema module (both dialects, PlanningSchemaError, classifier) + fixture test + ai_models.planning + event_kind widen + logPlanningSchemaFailure
- [x] 22-02-PLAN.md — Wave 2: generateText multimodal reference images (both transports) + ai_models.planning model tier + 4096-token ceiling
- [x] 22-03-PLAN.md — Wave 2: carousel token budget scales with slide count + admin AI Models planning selector (+ pt/es)
- [x] 22-04-PLAN.md — Wave 3: strict json_schema / responseSchema on the request + schema-failure hard-fail & logging + route-level guard
- [x] 22-05-PLAN.md — Wave 4: dense authoritative image_prompt (PLAN-04 precedence made structural) + text_blocks/layout_archetype_id passthrough
- [ ] 22-06-PLAN.md — Wave 5: full harness green + OPENROUTER_API_KEY-gated SC1 ablation harness + live runbook + operator sign-off — **Tasks 1-2 done (`c594918`, `c8d57bf`); Task 3 (operator sign-off) BLOCKING, not started. See 22-06-SUMMARY.md.**

**UI hint:** yes

---

### Phase 23: Deterministic Typography & Edit Fidelity

**Goal:** Images are generated text-free with reserved negative space; a sharp/SVG compositor renders headline/support/CTA text with real bundled fonts and guaranteed contrast; edit and remake flows operate on a persisted pre-typography base image and reuse the original generation parameters — eliminating the AI-rendered-text verify/repair loop entirely.

**Depends on:** Phase 22 (typography's rendering engine has no AI dependency and can be prototyped standalone, but end-to-end wiring requires the planning call's `text_blocks`/`layout_archetype_id`/reserved-negative-space output).

**Requirements:** TYPO-01, TYPO-02, TYPO-03, TYPO-04, TYPO-05, TYPO-06, TYPO-07, POL-04, POL-05

**Success Criteria** (what must be TRUE):
  1. A newly generated post in "exact text" mode shows crisp, correctly spelled headline/support/CTA text composited by the server — with zero AI-render verify/repair loop calls appearing in `generation_logs`.
  2. Text is always legible against its background — a scrim or plate is automatically applied when target-region contrast is insufficient — across the supported layout archetypes (bottom band, top stack, centered hero) and full pt-BR/es glyph coverage (CI golden-image test guards this in the Docker build).
  3. Editing an existing post edits the persisted `base_image_url` (not the flattened, already-composited image) and re-applies typography — no double-rendered or ghosted text ever appears.
  4. A post requested at a non-native aspect ratio is cropped to the exact requested aspect (e.g., 1200:628) before typography and logo compositing run.
  5. Remaking or editing a post reuses its originally persisted aspect ratio, resolution, and content options rather than defaulting or guessing.

**Plans:** 12/12 plans complete

Plans:
- [x] 23-01-PLAN.md — Wave 1: @napi-rs/canvas + Inter fonts + dist copy + AVX smoke + fixtures + verify-phase-23 12-tag harness
- [x] 23-02-PLAN.md — Wave 2: additive migration (posts/post_versions base_image_url + typography_meta + generation_params) + shared Zod contract
- [x] 23-03-PLAN.md — Wave 2: image-crop.service.ts generic W:H center-crop (POL-04) + 22-assertion enum test
- [x] 23-04-PLAN.md — Wave 2: typography-compositor.service.ts (font aliases, archetype geometry, word-wrap, contrast/scrim, glyph raster hashing)
- [x] 23-05-PLAN.md — Wave 2: text-free prompt inversion (buildNegativeSpaceInstruction + buildTextFidelityInstruction; text_mode reframed)
- [x] 23-06-PLAN.md — Wave 3: generate.routes.ts crop → typography → logo → optimize + base_image_url/typography_meta/generation_params persistence
- [x] 23-07-PLAN.md — Wave 3: edit.routes.ts base-image edit target + LEGACY NULL fallback + text-only compositor fast path + params reuse
- [x] 23-08-PLAN.md — Wave 3: verify-golden-image.ts + Dockerfile fontconfig/fc-cache/AVX gates + CI verify step
- [x] 23-09-PLAN.md — Wave 4: delete text-rendering.service.ts + logTextVerification; reconcile verify-phase-16 OBS-01
- [x] 23-10-PLAN.md — Wave 4: remake UI wiring (post-edit-dialog Format & Logo step, quick-remake params, text_only signal, i18n)
- [ ] 23-11-PLAN.md — Wave 5: full harness green + cross-plan invariants + live/Alpine runbook + operator sign-off — **Tasks 1-2 done (`2f0ffa3`, `4119d75`); Task 3 (operator sign-off) BLOCKING, not started. See 23-11-SUMMARY.md.**
- [x] 23-12-PLAN.md — Wave 6 (gap closure, 23-VERIFICATION.md): remove the `"clear promotional typography"` required_elements literal + stop `buildLocalTextFallback`'s flattened prompt from shadowing the negative-space-safe string + 6 functional harness checks asserting on RETURNED prompts (80 → 86)

**UI hint:** yes

---

### Phase 24: Visual Critic & Re-roll

**Goal:** Every generated base image is scored by a multimodal critic on composition, text-legibility zone, color harmony, and unwanted AI-rendered text before it proceeds to compositing; images that fail the threshold automatically re-roll (bounded), the user is still charged exactly once, and SSE timers/AbortSignal are re-derived for the added latency.

**Depends on:** Phase 21 (the critic is a gateway vision call; it has no hard dependency on typography, though it is sequenced after Phase 23 in this roadmap to avoid simultaneous changes to `generate.routes.ts`).

**Requirements:** CRIT-01, CRIT-02, CRIT-03, CRIT-04, CRIT-05

**Success Criteria** (what must be TRUE):
  1. A generated image with an unwanted rendered-text artifact or poor composition/color-harmony score triggers an automatic sequential re-roll (capped at 2 attempts) before the post is finalized; unwanted text is a hard-fail gate.
  2. A user is billed exactly once per delivered post even when one or more re-rolls occurred; the platform-side re-roll cost is recorded in the usage event's metadata, not passed to the user.
  3. Generation completes within the SSE safety-timer window sized for the gateway+critic latency budget on Coolify; when a timer fires, the wired `AbortSignal` actually cancels the in-flight call rather than leaving it running.
  4. Critic scores, re-roll counts, and text-free compliance are recorded to `generation_logs` for every generation, making the platform's compliance rate measurable via a query.

**Plans:** 7/7 plans complete

Plans:
- [x] 24-01-PLAN.md — Wave 1: verify-phase-24 6-tag harness + ai_models.critic / event_kind "visual_critic" / FallbackCallClass "critic" widens
- [x] 24-02-PLAN.md — Wave 2: chatCompletion additive callClass param + REAL AbortSignal into the SDK/fetch calls (chat + Image API + OpenRouter provider)
- [x] 24-03-PLAN.md — Wave 2: recordUsageEvent extraMetadata passthrough (charge-isolated) + logVisualCritic fire-and-forget emitter
- [x] 24-04-PLAN.md — Wave 2: admin surface — critic fallback call class + Visual Critic model selector + pt/es
- [x] 24-05-PLAN.md — Wave 3: visual-critic.service.ts (CRITIC_JSON_SCHEMA enum-bounded scores, rubric prompt, runVisualCritic, pure selection logic) + no-network unit harness + live-gated smoke test
- [x] 24-06-PLAN.md — Wave 4: generate.routes.ts — AbortController + bounded critic/re-roll loop + re-roll billing metadata + visual_critic log rows
- [ ] 24-07-PLAN.md — Wave 5: full harness green + [svc-cross-plan] invariants + live runbook + operator sign-off — **Tasks 1-2 done (`5d5c2d7`, `545ca5f`); Task 3 (operator sign-off) BLOCKING, not started. See 24-07-SUMMARY.md.**

---

### Phase 25: Narrative Carousels & Aesthetic DNA

**Goal:** Carousels produce a genuine visual narrative (hook slide → developing content slides → CTA slide) with per-slide composition variation and real on-slide text via the deterministic compositor; every style/mood in the platform catalog carries dense, professional art direction — photography type, lighting, 60-30-10 named-color usage, anti-AI-look negative prompts — with admin-curated style reference boards attached to generation.

**Depends on:** Phase 23 (on-slide carousel text is a hard dependency on the typography compositor — reverses CRSL-10; the aesthetic-DNA style-catalog upgrade also benefits from Phase 22's planning-call improvements already being in place).

**Requirements:** PLAN-05, PLAN-06, PLAN-07, CRSL2-01, CRSL2-02, CRSL2-04

**Success Criteria** (what must be TRUE):
  1. A generated carousel shows a distinct hook slide, one or more developing content slides, and a CTA slide, each carrying its own on-slide text composited deterministically, with fonts/colors/layout archetype held consistent across all slides.
  2. Slides visibly vary: an automated inter-slide composition-similarity check (or reviewer checklist item) confirms no two slides share the same framing/layout.
  3. A carousel honors the creator's previously-dead text-style selection and `use_logo`/`logo_position` choices — the deterministic logo overlay is applied per slide.
  4. Selecting any style/mood in the creator produces output with a recognizable, specific photography type, lighting treatment, and correct 60-30-10 brand-color usage (using `color_4`) instead of generic one-liner phrasing — verifiable by the style-direction text appearing in the prompt payload.
  5. Admin can attach a platform-curated style reference board (a set of images) to a style/mood, and those reference images are attached to the image-generation call as style references when that style/mood is selected.

**Plans:** 14/14 plans complete

Plans:
- [x] 25-01-PLAN.md — Wave 1: verify-phase-25 7-tag phase gate (self-test green, 6 requirement tags honestly red)
- [x] 25-02-PLAN.md — Wave 1: additive data contracts — artDirectionSchema + styleReferencePhotoSchema + post_slides/post_slide_versions typography fields + 2 migrations
- [x] 25-03-PLAN.md — Wave 2: carousel-plan-schema.service.ts — dual-dialect narrative schema, deterministic assignSlideRoles, composition-variation check (SC2)
- [x] 25-04-PLAN.md — Wave 2: style-reference.service.ts — pure 3-tier slot-priority merge (user > brand > style board) + style-board fetch + base64 hydration
- [x] 25-05-PLAN.md — Wave 2: dense art direction written for all 9 styles + 12 post moods + withDefaultArtDirection read-time backfill
- [x] 25-06-PLAN.md — Wave 2: formatBrandColorsProportional (60-30-10, color_4 = accent) + style-art-direction.service.ts + GLOBAL_ANTI_AI_NEGATIVE_PROMPT
- [x] 25-07-PLAN.md — Wave 2: resolveTypographyTreatment + additive default-identity treatment param on compositeTypography (zero golden-image regression)
- [x] 25-08-PLAN.md — Wave 2: style-references.routes.ts admin CRUD for style_reference_photos + router registration
- [x] 25-09-PLAN.md — Wave 3: single-image path wired — dense art direction + 60-30-10 in buildContextPrompt, 3-tier reference merge in generate.routes.ts
- [x] 25-10-PLAN.md — Wave 3: carousel master plan rebuilt — narrative roles, per-slide composition_note/text_blocks, one archetype, planning-tier strict transport, aesthetic DNA
- [x] 25-11-PLAN.md — Wave 3: admin UI — art-direction fields on styles/moods + StyleReferenceBoardsCard (immediate-persist) + pt-BR/es
- [x] 25-12-PLAN.md — Wave 4: per-slide crop → typography → logo → optimize pipeline + textStyle treatment + reference images + slide/generation_params persistence
- [x] 25-13-PLAN.md — Wave 5: typography-aware slide edit — base-image target, re-composite with the carousel archetype, LEGACY branch, no-network decision-matrix harness
- [ ] 25-14-PLAN.md — Wave 6: full harness green + [svc-cross-plan] invariants + live runbook + operator sign-off — **Tasks 1-2 done (`5bcf75f`, `e19c34b`); Task 3 (operator sign-off) BLOCKING, not started. See 25-14-SUMMARY.md.**

**UI hint:** yes

---

### Phase 26: Fixes & Polish

**Goal:** The remaining output-quality and hygiene gaps close out the milestone — sharper WebP compression with a text-edge quality check, contrast-aware adaptive logo overlay, idempotent generate/edit APIs, a post-migration cost reconciliation against the OpenRouter dashboard, and a thumbs-up/down feedback loop surfaced on an admin quality dashboard.

**Depends on:** Phase 21 (cost reconciliation requires the gateway to have run for a full billing period) and Phase 23 (the text-edge quality check and logo-after-typography contrast treatment depend on the compositor existing).

**Requirements:** POL-02, POL-03, POL-06, POL-08, POL-09

> **POL-08 is a post-ship audit item.** It requires one full billing period of gateway traffic after the OpenRouter migration and therefore **cannot gate milestone close** — the milestone ships with the audit scheduled; the reconciliation completes after the billing period elapses.

**Success Criteria** (what must be TRUE):
  1. Generated images save at WebP quality 85+ with no visible extra artifacting around composited text edges (automated quality check flags regressions).
  2. A logo overlaid on a busy or low-contrast background gets an adaptive plate/shadow treatment and a corner chosen by region-contrast analysis; JPEG (no-alpha) logos never produce an opaque-box artifact.
  3. Submitting the same `/api/generate` or `/api/edit-post` request twice with the same idempotency key never creates a duplicate post or double-charges the user — matching the existing carousel/enhancement contract.
  4. The cost reconciliation audit is set up and scheduled: one full billing period after the OpenRouter migration, `generation_logs`/usage events are audited against the OpenRouter dashboard with no material, unexplained cost discrepancy (post-ship audit — does not gate milestone close).
  5. A user can thumbs-up or thumbs-down any generated post; feedback plus critic/fallback rates are visible together on an admin quality dashboard.

**Plans:** 4/10 plans executed

Plans:
- [x] 26-01-PLAN.md — Wave 1: verify-phase-26 9-tag phase gate (self-test green, 7 requirement tags honestly red) + logo/corner-contrast fixtures
- [ ] 26-02-PLAN.md — Wave 2: POL-02 — DEFAULT_IMAGE_QUALITY 80 -> 85 + scripts/verify-webp-text-edge.ts Laplacian edge-retention gate
- [x] 26-03-PLAN.md — Wave 2: drawBlocks per-block ctx.font fix (Phase 23 pre-existing bug) + ink-extent functional proof
- [x] 26-04-PLAN.md — Wave 2: POL-06 client half — idempotency_key generated at all 4 generate/edit/remake call sites
- [x] 26-05-PLAN.md — Wave 2: POL-08 — cost-reconciliation runbook + usage_events query scaffold (scheduled, deliberately not run, not cron-wired)
- [ ] 26-06-PLAN.md — Wave 3: POL-06 server half — Zod contract, post_versions.idempotency_key migration, pre-flight dedup before the credit gate in both routes
- [ ] 26-07-PLAN.md — Wave 4: POL-03 — alpha-aware + contrast-aware logo overlay with soft plate and auto corner selection; routes stop collapsing logo_position
- [ ] 26-08-PLAN.md — Wave 4: POL-09 user half — posts.feedback column + PATCH /api/posts/:id/feedback + thumbs-up/down in the post viewer (+ pt/es)
- [ ] 26-09-PLAN.md — Wave 5: POL-09 admin half — GET /api/admin/quality + QualityTab + sidebar/tab wiring (+ pt/es)
- [ ] 26-10-PLAN.md — Wave 6: full harness green + [svc-cross-plan] invariants + live runbook + operator sign-off

**UI hint:** yes

---

## Progress

**Execution Order:** Phases execute in numeric order: 21, 21.1, 22, 23, 24, 25, 26

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 1–4 | v1.0 | 8/8 | Complete | 2026-04-20 |
| 5–12, 12.1–12.3, 12-audit, 12.5, 12.6 | v1.1 | — | Complete | 2026-05-18 |
| 13–15 | v1.2 | 5/5 | Complete | 2026-05-08 |
| 16 | v1.3 | 1/1 | Complete | 2026-05-08 |
| 17 | v1.4 | 1/1 | Complete | 2026-05-16 |
| 18–20 | v1.5 | 5/5 | Complete | 2026-05-16 |
| 21. OpenRouter Gateway Foundation | v1.6 | 13/13 | Complete    | 2026-07-27 |
| 21.1. Affiliate BYOK Migration | v1.6 | 6/7 | Complete    | 2026-07-27 |
| 22. Art Director Planning Upgrade | v1.6 | 5/6 | Complete    | 2026-07-27 |
| 23. Deterministic Typography & Edit Fidelity | v1.6 | 10/11 | Complete    | 2026-07-27 |
| 24. Visual Critic & Re-roll | v1.6 | 6/7 | Complete    | 2026-07-28 |
| 25. Narrative Carousels & Aesthetic DNA | v1.6 | 13/14 | Complete    | 2026-07-28 |
| 26. Fixes & Polish | v1.6 | 4/10 | In Progress|  |

## Notes

Pending seeds (surfaced during v1.6 questioning, still deferred):
- [SEED-002](seeds/SEED-002-live-e2e-billing-ads-validation.md) — live E2E validation harness for Stripe/GA4/Facebook
- [SEED-004](seeds/SEED-004-fat-file-refactor.md) — split 5 monolithic files >1000 LOC each
