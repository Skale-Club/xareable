---
gsd_state_version: 1.0
milestone: v1.6
milestone_name: Professional Design Quality Overhaul + OpenRouter Gateway
status: executing
stopped_at: Completed 22-05-PLAN.md (art-director prompt precedence fix + text_blocks/layout_archetype_id forward-compat)
last_updated: "2026-07-27T19:08:39.509Z"
last_activity: 2026-07-27
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 26
  completed_plans: 25
  percent: 38
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-18 — v1.6 milestone section added)

**Core value:** Users can generate on-brand visual content (single posts, carousels, enhancements) in seconds and recover deletions within a 30-day trash window.
**Current focus:** Phase 22 — art-director-planning-upgrade

## Current Position

Phase: 22 (art-director-planning-upgrade) — EXECUTING
Plan: 6 of 6
Status: Ready to execute
Last activity: 2026-07-27

**Plan 22-05 complete:** the art-director planning prompt now instructs the model that `image_prompt` is THE authoritative 120-200 word prose brief (no longer deprioritized behind `structured_image_prompt`); `normalizeGeminiTextResult` computes the mechanical flattening lazily so it can never win over a model-authored prompt; `GeminiTextResult` carries `text_blocks`/`layout_archetype_id` end-to-end for Phase 23.

**v1.6 phase structure (Phases 21-26 + decimal 21.1, continuing from v1.5's Phase 20 — 7 phases total):**

| Phase | Name | Requirements | Depends on |
|-------|------|--------------|------------|
| 21 | OpenRouter Gateway Foundation | GATE-01..05,07,08, POL-01, POL-07, CRSL2-03 | Nothing (first) |
| 21.1 | Affiliate BYOK Migration | GATE-06 | Phase 21 |
| 22 | Art Director Planning Upgrade | PLAN-01..04 | Phase 21 |
| 23 | Deterministic Typography & Edit Fidelity | TYPO-01..07, POL-04, POL-05 | Phase 22 |
| 24 | Visual Critic & Re-roll | CRIT-01..05 | Phase 21 (sequenced after 23) |
| 25 | Narrative Carousels & Aesthetic DNA | PLAN-05..07, CRSL2-01,02,04 | Phase 23 |
| 26 | Fixes & Polish | POL-02,03,06,08,09 | Phase 21, Phase 23 |

**v1.6 key decisions locked at milestone start:**

- ALL AI calls (text/planning, image, transcription) migrate to OpenRouter as the single gateway; provider abstraction becomes model selection; BYO keys become OpenRouter keys
- Video pipeline FROZEN this milestone (Veo not on OpenRouter) — stays on direct Google API; only the `isVideo` billing-gate fix lands; video gateway decision deferred
- Deterministic typography (sharp/SVG composition of text over text-free AI images) replaces AI-rendered text + the verify/repair loop
- Dual-provider compatibility concern dissolves into single-gateway model selection
- Surgical one-line fixes (POL-01, CRSL2-03) pulled into Phase 21 (earliest practical phase) rather than held for later phases

Progress: [████░░░░░░] 38% (0/7 phases fully complete; Phase 21 = 13/13 plans executed, gate verified — ready for phase closure)

## Merge Reconciliation Note (2026-05-17)

This branch (`dev`) was 102 commits ahead of `origin/dev` while `origin/dev` had 35 commits of independent work (Phase 12 image provider abstraction track + decimal patches 12.1, 12.2, 12.3, 12-audit, plus UI polish + gitleaks security). The merge preserved BOTH streams. Resolution decisions:

1. **Phase 12 ambiguity resolved by renumbering:**
   - **Phase 12** (canonical) = origin/dev's "Image Provider Abstraction (OpenAI gpt-image-2 alternative)" — 5 plans, 7 PROV requirements, 4 decimal patches, shipped 2026-05-17
   - **Phase 12.5** (decimal insert) = local's "Schedule billing overage batch via existing cleanup-cron service" — graduated SEED-001, shipped 2026-05-08. Renamed from `12-schedule-...` to `12.5-schedule-billing-overage-batch` on disk.
2. **Code conflicts unioned**, not replaced:
   - `package.json`: added `openai` (their image provider), kept `passport`/etc removed (Phase 13 HARD-04 sealed)
   - `carousel.routes.ts`, `enhance.routes.ts`: both `aiRateLimit` (mine) AND `getActiveImageProvider` (theirs) imported
   - `generate.routes.ts`: `imageApiKey` (theirs, provider-aware) + `mergedReferenceImages` (mine, Phase 20 brand refs) — both correct
   - `translations.ts`, `settings.tsx`: union of all new strings/handlers from both sides
3. **Original migration sealed.** New migrations from both sides applied additively. `npm run check` exits 0 post-merge.

## Merge Reconciliation Note (2026-05-18)

After pushing the 2026-05-17 merge to `origin/dev`, `origin/main` was found to be 20 commits ahead with an independent Phase 13 implementing **carousel quick-remake and per-slide Edit Image**. To preserve both Phase 13s without losing data:

1. **Phase 13 ambiguity resolved by renumbering:**
   - **Phase 13** (canonical for v1.2) = dev's "Production Hardening Fixes" — preserved.
   - **Phase 12.6** (decimal insert under v1.1) = origin/main's "Carousel Quick Remake & Per-Slide Edit Image" — 5 plans, 7 CRSL-EDIT requirements, depends on Phase 12 image provider (slide-1-as-reference style consistency works through `provider.edit()` for both Gemini and OpenAI). Folder renamed from `.planning/phases/13-carousel-quick-remake-and-edit-image/` to `.planning/phases/12.6-carousel-quick-remake-and-edit-image/`. Shipped 2026-05-18.
2. **Code conflicts unioned via 3-way auto-merge** in `App.tsx`, `lib/translations.ts`, `server/routes/carousel.routes.ts`, `shared/schema.ts`. Manual resolution only in `.planning/ROADMAP.md` and `.planning/STATE.md` (this file).
3. **Additive migrations only.** `20260518000000_post_slide_versions.sql` (post_slide_versions table + RLS + unique index) ships alongside Phase 20 brand-reference migration without conflict.
4. **`scripts/verify-phase-13.ts`** (origin/main, carousel quick-remake checks) does NOT collide with my dev's `scripts/verify-phase-13.ts` (Production Hardening checks) — verified during merge that both files only exist on one side. Renamed origin/main's to `scripts/verify-phase-12.6.ts` post-merge.

## Phase Summary (unified post-merge)

| Phase | Milestone | Plans | Verification | Status |
|-------|-----------|-------|--------------|--------|
| 01-04 | v1.0 | 8 | — | Complete (2026-04-20) |
| 05-11 | v1.1 | 22 | varies | Complete |
| 12 (Image Provider Abstraction) | v1.1 | 5 | PASS 36/36 | Complete (2026-05-17) |
| 12.1, 12.2, 12.3 (decimal patches) | v1.1 | — | — | Complete |
| 12-audit | v1.1 | — | — | Complete |
| 12.5 (Schedule billing overage batch — SEED-001) | v1.1 | 1 | — | Complete (2026-05-08) |
| 12.6 (Carousel Quick Remake & Per-Slide Edit Image) | v1.1 | 5 | static PASS, UAT pending | Complete (2026-05-18) |
| 13. Production Hardening Fixes | v1.2 | 2 | PASS 13/13 | Complete (2026-05-08) |
| 14. Wire production crons via HTTP triggers | v1.2 | 2 | PASS 7/7 | Complete (2026-05-08) |
| 15. Cron Verification Harness | v1.2 | 1 | PASS 7/7 | Complete (2026-05-08) |
| 16. Generation Pipeline Observability | v1.3 | 1 | PASS 5/5 | Complete (2026-05-08) |
| 17. GHL Signup Sync (Wire-Up) | v1.4 | 1 | verified | Complete (2026-05-16) |
| 18. Data Layer + API Endpoints | v1.5 | 3 | PASS | Complete (2026-05-16) |
| 19. Settings UI — Style Tab | v1.5 | 1 | PASS | Complete (2026-05-16) |
| 20. Generation Integration | v1.5 | 1 | PASS | Complete (2026-05-16) |
| 21. OpenRouter Gateway Foundation | v1.6 | 13 | PASS 43/43 | Complete (2026-07-27) |
| 21.1. Affiliate BYOK Migration | v1.6 | TBD | — | Not started |
| 22. Art Director Planning Upgrade | v1.6 | TBD | — | Not started |
| 23. Deterministic Typography & Edit Fidelity | v1.6 | TBD | — | Not started |
| 24. Visual Critic & Re-roll | v1.6 | TBD | — | Not started |
| 25. Narrative Carousels & Aesthetic DNA | v1.6 | TBD | — | Not started |
| 26. Fixes & Polish | v1.6 | TBD | — | Not started |

## Performance Metrics

**v1.1, v1.2, v1.3, v1.4, v1.5 all archived in `.planning/milestones/`.**

| Phase / Plan | Duration | Tasks | Files | Notes |
|--------------|----------|-------|-------|-------|
| Phase 10 P03 | 30 | 3 tasks | 3 files | gallery |
| Phase 10 P04 | 22 | 2 tasks | 2 files | viewer + markCreated |
| Phase 11 P01 | 12 | 3 tasks | 5 files | trash schema |
| Phase 11 P04 | 25 | 3 tasks | 4 files | trash UI |
| Phase 12 P04 | 12 | 3 tasks | 6 files | image provider |
| Phase 12 P05 | 12 | 3 tasks | 5 files | image provider final |
| Phase 12.6 P02 | 25 | 2 tasks | 2 files | slide-edit route |
| Phase 12.6 P03 | 15 | 1 task  | 1 file  | PostEditDialog carousel-slide variant |
| Phase 12.6 P04 | 20 | 2 tasks | 2 files | viewer Edit/Quick-Remake wiring |
| Phase 12.6 P05 | 15 | 3 tasks | 3 files | i18n + UAT + provider parity |
| Phase 18 P01 | 5 | 2 tasks | 2 files | brand reference schema |
| Phase 18 P02 | 10 | 2 tasks | 2 files | brand reference API |
| Phase 18 P03 | 5 | 2 tasks | 1 files | verify-phase-18 |
| Phase 19 P01 | 25 | 4 tasks | 2 files | Style tab UI |
| Phase 20 P01 | 25 | 4 tasks | 4 files | generation injection |
| Phase 21 P01 | 8 | 1 tasks | 1 files |
| Phase 21 P02 | 12min | 4 tasks | 2 files |
| Phase 21 P03 | 18min | 3 tasks | 6 files |
| Phase 21 P04 | 5min | 2 tasks | 1 files |
| Phase 21 P05 | 3min | 3 tasks | 3 files |
| Phase 21 P09 | 12min | 2 tasks | 1 files |
| Phase 21 P06 | 8min | 3 tasks | 3 files |
| Phase 21 P07 | 6min | 2 tasks | 1 files |
| Phase 21 P08 | 15min | 3 tasks | 3 files |
| Phase 21 P12 | 4min | 1 tasks | 1 files |
| Phase 21 P10 | 5min | 2 tasks | 2 files |
| Phase 21 P11 | 4min | 2 tasks | 1 files |
| Phase 21 P13 | 10min | 2 tasks | 1 files |
| Phase 21.1 P01 | 7min | 3 tasks | 6 files |
| Phase 21.1 P02 | 5min | 2 tasks | 2 files |
| Phase 21.1 P03 | 8min | 3 tasks | 3 files |
| Phase 21.1 P06 | 6min | 2 tasks | 2 files |
| Phase 21.1 P05 | 4min | 2 tasks | 2 files |
| Phase 21.1 P04 | 6min | 2 tasks | 2 files |
| Phase 22 P01 | 12min | 3 tasks | 6 files |
| Phase 22 P02 | 3min | 2 tasks | 2 files |
| Phase 22 P03 | 4min | 2 tasks | 4 files |
| Phase 22 P04 | 3min | 3 tasks | 2 files |
| Phase 22 P05 | 5min | 2 tasks | 3 files |

## Accumulated Context

### Decisions (unified from all branches)

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

**v1.1 carousel/enhancement track (Phases 5-11):**

- [Phase 05]: Zod enum extension and RLS policy structure reuse v1.0 patterns — no research phase needed
- [Phase 06]: Sequential slide generation (not parallel) — IPM rate limits LOW confidence; fallback documented
- [Phase 06]: thoughtSignature multi-turn + single-turn fallback pattern for style consistency
- [Phase 06]: ensureCaptionQuality called once after slide loop, never per-slide (CRSL-09)
- [Phase 06]: Enhancement pre-screen fail-closed — non-2xx/non-JSON → PreScreenUnavailableError, no image call
- [Phase 07]: Checked out Phase 5/6 dependency files from main branch into worktree (Rule 3 deviation)
- [Phase 07]: contentLanguage hardcoded to 'en' in enhance.routes.ts — enhanceRequestSchema deliberately omits content_language in v1.1
- [Phase 07]: No prefix argument on router.use() for carousel and enhance — flat-mount pattern matches existing routes
- [Phase 10]: t() only accepts 1 arg; t(key).replace('{n}', String(value)) used for param interpolation
- [Phase 10]: assertNever default branch provides GLRY-04 exhaustiveness guard at compile time
- [Phase 10-04]: Carousel branch added inside existing PostViewerDialog; two-path GLRY-05 (SSE onError + catch-block else both call markCreated)
- [Phase 11]: Skip Drizzle db:push for Supabase-native migrations; apply via Supabase dashboard SQL editor
- [Phase 11]: trashed_at soft-delete filter applied only to primary gallery queries
- [Phase 11]: verify-phase-11.ts storage-before-DB check uses indexOf comparison pattern

**Phase 12 — Image Provider Abstraction (origin/dev track):**

- [Phase 12]: OpenAIImageProvider stub added in 12-03 for TypeScript compilation; 12-02 full Responses API implementation replaces at merge
- [Phase 12]: thoughtSignature multi-turn pattern dropped at provider abstraction boundary — slides 2..N use provider.edit() with slide-1 buffer as currentImage for style consistency (works for both Gemini and OpenAI)
- [Phase 12]: callEnhancementImageModel deleted entirely — provider.edit() replaces it inline; no dead code path
- [Phase 12]: imageApiKey separate optional param in carousel/enhancement params — text-model calls use apiKey (Gemini), image calls use imageApiKey when provider != gemini
- [Phase 12]: ImageProviderSection rendered in admin.tsx settings tab (alongside AppSettingsTab) — minimal surgery, provider config belongs with app settings
- [Phase 12]: openai_api_key supabase update on single line in settings.tsx to match PROV-06 regex; direct supabase update (no server route) mirrors api_key pattern

**Phase 12.5 — Schedule billing overage batch (graduated SEED-001):**

- [Phase 12.5]: runOverageBillingBatch wired into startCronJobs via single cron.schedule registration — follows Phase 11 + 12 trash sweep pattern; SEED-001 marker resolved.

**Phase 12.6 — Carousel Quick Remake & Per-Slide Edit Image (was origin/main's Phase 13):**

- [Phase 12.6]: No storage cleanup trigger in post_slide_versions migration — ON DELETE CASCADE from post_slides handles row cleanup automatically
- [Phase 12.6]: editSlideRequestSchema reuses editPostRequestSchema.shape.edit_context to stay in lockstep with single-image edit schema evolution
- [Phase 12.6]: Caption regeneration skipped for slide-level edits — carousel caption is master-text scoped (CRSL-09)
- [Phase 12.6]: post_slides.image_url updated to latest version (latest-wins); prior URL preserved in post_slide_versions
- [Phase 12.6-03]: carouselEditContext strips text_mode/replacement_text/text_style_ids — CRSL-10 compliance; single handleGenerateEdit function with isCarouselSlide branch (Option A)
- [Phase 12.6-04]: fetchSSE auth handled internally via getAuthHeaders() — no token param needed in viewer's carousel quick-remake branch
- [Phase 12.6-04]: Per-slide version navigation UI deferred to v2 — CRSL-V2-01 scope; carousel slides show only latest version inline
- [Phase 12.6-05]: CRSL-EDIT-02 + CRSL-EDIT-07 excluded from static verify — require live UI/billing; covered by 12.6-UAT.md operator sign-off

**v1.2 — Production Hardening (Phases 13-15):**

- [Phase 13]: Used express-rate-limit library over extending in-memory Map pattern from translate.routes.ts (typed, IETF draft-7 headers, single-source admin bypass via skip)
- [Phase 13]: Inline limiter invocation (await new Promise(resolve => limiter(req,res,resolve))) over middleware-chain conversion — preserves existing inline authenticateUser pattern in all 5 paid AI routes
- [Phase 13]: try/finally (no outer catch) for carousel + enhance safetyTimer cleanup — preserves existing inner try/catch error semantics
- [Phase 13]: ErrorBoundary placed inside LanguageProvider, outside AuthProvider — useTranslation works in recovery UI AND AuthProvider init errors are caught
- [Phase 13]: Removed 5 dead session/auth deps + 4 @types and relocated @octokit/rest to devDependencies
- [Phase 14]: Wired cleanup-cron HTTP triggers via .github/workflows/cron.yml + Vercel `CRON_SECRET` env — Hetzner internal-cron path preserved unchanged
- [Phase 15]: verify-cron-jobs.ts harness exits 0 against real Supabase; SK_TEST_* gated Mode B for Stripe live path

**v1.3 — Generation Observability (Phase 16):**

- [Phase 16]: extended generation_logs with 6 first-class columns + 3 enum values; original migration sealed; first-class columns chosen over JSONB for query-friendliness
- [Phase 16]: observability.service.ts emits via createAdminSupabase().insert() wrapped in try/catch — best-effort logging, never blocks gen flow

**v1.4 — GHL Signup Sync (Phase 17):**

- [Phase 17]: fanGHLSignup extracted as module-scope helper — GHL runs regardless of telegram exit path, signup never blocked, fire-and-forget best-effort
- [Phase 17]: sync_on_signup stored as boolean column on integration_settings (not JSONB) — clean schema, additive migration, query-friendly

**v1.5 — Brand Style References (Phases 18-20):**

- [v1.5 roadmap]: Phase 18 delivers full server-side data contract (DB + RLS + 4 endpoints + Zod) before any UI is built
- [v1.5 scope]: Style description injected into image gen only (not text gen). Carousel and enhancement routes excluded in v1.5. Drag-to-reorder deferred. Single-image pipeline only.
- [v1.5 AI integration]: Brand reference photos fetched server-side at generation time. User-provided inline images take priority in Gemini's 4-slot limit. Brand references fill remaining slots. use_brand_references flag is ephemeral per-generation (not persisted).
- [Phase 18]: user_id stored denormalized on brand_reference_photos for O(1) RLS check; UPDATE policy included for future drag-to-reorder; brandReferencePhotoSchema.photo_url is z.string() not .url() (read model only)
- [Phase 18]: No multer/multipart — POST body is JSON { photo_url: string, position?: number }; client uploads directly to Supabase Storage
- [Phase 18]: 10-photo cap enforced server-side via count query before insert (non-atomic, acceptable for v1.5)
- [Phase 19]: Direct queryClient import from @/lib/queryClient (not useQueryClient hook) for cache invalidation
- [Phase 19]: styleDescription sync merged into existing [brand] useEffect
- [Phase 20]: !isVideo guard in merge block prevents brand reference injection on video generation
- [Phase 20]: use_brand_references: undefined treated as true on server (opt-out pattern, not opt-in)
- [Phase 20]: Type split maintained: mergedReferenceImages.map(img => img.data) for generateText (string[]), raw objects for generateVideo/generateImageAsset

**Merge reconciliation (2026-05-17):**

- [Merge]: Phase 12 (image provider) kept canonical integer; Phase 12.5 (overage cron) renamed with decimal — preserves both tracks
- [Merge]: package.json union — added openai, kept passport removed (Phase 13 sealed)
- [Merge]: generate.routes.ts conflict resolved by combining imageApiKey (provider-aware, theirs) with mergedReferenceImages (brand refs, mine)

**Merge reconciliation (2026-05-18 — origin/main fold-in):**

- [Merge]: origin/main's parallel "Phase 13" (carousel quick-remake) renamed to **Phase 12.6** to preserve dev's Phase 13 (Production Hardening) as canonical v1.2 integer. Folder renamed `13-carousel-quick-remake-and-edit-image/` → `12.6-carousel-quick-remake-and-edit-image/`.
- [Merge]: origin/main's `scripts/verify-phase-13.ts` (carousel checks) renamed to `scripts/verify-phase-12.6.ts` to avoid clash with dev's `scripts/verify-phase-13.ts` (Production Hardening checks).
- [Merge]: ROADMAP/STATE manually resolved; code files (App.tsx, translations.ts, carousel.routes.ts, shared/schema.ts) auto-merged cleanly.

**v1.6 — Roadmap creation + validation revision (2026-07-18):**

- [Roadmap]: PLAN-01..04 (art-director planning upgrade) placed in its own Phase 22 rather than folded into Phase 21 (Gateway) — same call surface per research, but distinct user-observable capability warranting separate success criteria and plan set.
- [Roadmap]: POL-04 (post-generation crop) and POL-05 (generation param persistence) pulled into Phase 23 (Typography) — crop must run before typography for correct text-placement coordinates; param persistence is the same base_image_url/typography_meta edit-fidelity work.
- [Roadmap]: CRIT (Phase 24) sequenced after Typography (Phase 23) despite having no hard dependency on it — reduces simultaneous-change risk in generate.routes.ts per research architecture recommendation.
- [Roadmap]: Surgical one-line fixes POL-01 (isVideo credit gate) and CRSL2-03 (carousel slide-1 break) pulled into Phase 21 (Gateway) — earliest practical phase, not held hostage to their nominal categories (POL, CRSL2) which land later.
- [Roadmap]: PLAN-05..07 (dense aesthetic DNA / style catalog) bundled with CRSL2-01,02,04 (narrative carousels) into Phase 25 — both depend on Phase 23 (Typography) and are grouped as "Aesthetic DNA" in research Build Order Phase D.
- [Roadmap revision]: GATE-06 (affiliate BYOK migration) split out of Phase 21 into decimal Phase 21.1 — key provisioning/rotation and per-affiliate billing attribution (provider pinning on simulated failure) get their own verifiable delivery inside the P0 window.
- [Roadmap revision]: Phase 21 gained explicit fallback-chain criterion (simulated 404/deprecation → configured fallback model, logged in generation_logs, no redeploy) and pre-call estimate + post-call actual usage.cost recording criterion.
- [Roadmap revision]: Phase 22 schema criterion added — planning json_schema MUST include text_blocks + layout_archetype_id from day one (consumed only in Phase 23) to avoid reopening the planning call later.
- [Roadmap revision]: Subjective criteria replaced with observable proxies (Phase 22 SC1 payload-contains-refs + ablation; Phase 25 SC2 inter-slide composition-similarity check; Phase 25 SC4 style-direction text verifiable in prompt payload). POL-08 marked post-ship audit — cannot gate milestone close (needs one full billing period).

**Phase 21 — OpenRouter Gateway Foundation execution (started 2026-07-27):**

- [Phase 21-01]: Independently recomputed SHA-256 of server/services/video-generation.service.ts before using the plan's literal baseline hash — confirmed exact match, no drift since plan authoring. GATE-08 freeze guard is real and passing (3/3 checks); 9 other Phase 21 requirement checks stubbed to fail until 21-13-PLAN.md wires them for real.
- [Phase 21-02]: Fixed POL-01 (edit.routes.ts checkCredits now passes isVideoPost) and CRSL2-03 (carousel-generation.service.ts slide loop breaks immediately on slide-1 failure). Tasks 3/4 (POL-07 header fixes for text-rendering.service.ts and translate.routes.ts) required no code changes — both files already used x-goog-api-key header auth, landed in commit f31adff prior to this plan's execution session.
- [Phase 21-03]: New ai-gateway-settings.service.ts uses the direct-query (no getPlatformSetting) read-modify-write pattern for object-shaped platform_settings JSONB rows (ai_gateway_routing, ai_model_fallbacks) — mirrors quota.ts's getPlatformSettingNumber/getMarkupMultiplier, no caching so GATE-07 rollback toggles take effect immediately.
- [Phase 21-03]: recordUsageEvent's new realCostUsdMicros param reuses getMarkupMultiplier(userId) directly for charged_amount_micros — its first real caller (deductCredits back-computes the ratio locally instead of calling it); usage_events.metadata populated only when realCostUsdMicros or estimatedCostMicros is present, keeping legacy/non-gateway rows at metadata: null.
- [Phase 21-03]: Parallel execution with 21-02 in the same working directory caused the 21-02 agent's git add to transiently sweep up 21-03's staged shared/schema.ts + usage_events metadata migration into their own commit; they self-corrected via amend before 21-03 committed its own atomic commits. No content was lost; verified via grep + npm run check at each step.
- [Phase 21-04]: ai-gateway.service.ts chatCompletion()/transcribe() implemented verbatim from plan — both fully designed against 21-03's verified interfaces and 21-RESEARCH.md's live-verified OpenRouter error shapes; zero deviations, all acceptance-criteria greps + npm run check passed on first attempt for both tasks. No call sites wired yet (starts in 21-05/21-07/21-08/21-09).
- [Phase 21-05]: Appended generateImage()/editImage()/toOpenRouterInputReference() to ai-gateway.service.ts (raw fetch against OpenRouter's dedicated Image API — the openai SDK can't reach it) and added OpenRouterImageProvider to image-provider.ts (thin wrapper, platform OPENROUTER_API_KEY, same delegation pattern as GeminiImageProvider). No circular-import issue occurred — a local GatewayReferenceImage type was used instead of importing ReferenceImage, per the plan's contingency. Factory (getActiveImageProvider) deliberately left untouched — 21-06 rewires it. Zero deviations; adapter functional test + npm run check passed on first attempt.
- [Phase 21-06]: getActiveImageProvider now branches on getCallRouting("image") instead of platform_settings.image_provider — OpenRouter is the default image provider, GeminiImageProvider is the GATE-07 rollback path (ai_gateway_routing.image = "direct"); legacy gemini/openai toggle retired from the factory (image_provider column/endpoints/UI sentinel retained dead until Phase 26). Added GET/PATCH /api/admin/ai-gateway-routing + /api/admin/ai-model-fallbacks admin endpoints. Removed OPENAI_SENTINEL from the AI Models admin card. Deviation: client/src/pages/admin.tsx already had zero ImageProviderSection references at plan start (removed in a prior refactor, commit 7332916, 2026-05-17) — Task 3's admin.tsx edit was a no-op, verified rather than applied.
- [Phase 21-09]: transcribe.routes.ts migrated onto getCallRouting("transcription")/aiGatewayTranscribe() with a header-fixed direct-Gemini rollback, plus recordUsageEvent wired with gatewayCostUsdMicros + creditStatus?.estimated_cost_micros (GATE-03/05/07, POL-07) — combined into one plan since this route is self-contained (route + inline AI call + billing in one file). Zero code deviations. Parallel-execution git race: Task 2's staged recordUsageEvent diff was swept into concurrent plan 21-08's commit (9aa0f95) instead of landing in its own commit — content verified byte-for-byte correct and present (git diff HEAD empty), no history rewrite attempted since other agents were still committing concurrently. Same precedent as 21-03's documented race.
- [Phase 21-07]: generateText/generateCaptionOnly (the art-director planning call + its caption-rescue helper) parity-migrated onto chatCompletion(), reading getCallRouting("planning") once per generateText call (not per retry attempt) so the two-attempt retry can't split across transports; direct-branch comment reworded to avoid a literal `?key=` substring tripping the file-wide POL-07 zero-query-string-key check; dead transcribeAudio deleted (zero call sites confirmed via grep across server/client/shared). Zero code deviations. Parallel-execution git race: a concurrent agent's staged admin-UI file was transiently swept into this plan's first commit attempt — caught via `git show --stat HEAD` before pushing further work, fixed with `git reset --soft HEAD~1` + selective unstage + re-commit (no content lost, same precedent as 21-03/21-09's documented races).
- [Phase 21-08]: callCarouselTextPlan, callGeminiForCaption, runPreScreen, and generateEnhancementCaption all migrated onto getCallRouting("planning")/chatCompletion() with intact direct-Gemini rollback branches; carousel's TEXT_MODEL also made admin-configurable via styleCatalog.ai_models.text_generation (GATE-04 side fix). caption-quality.service.ts was found already header-auth compliant (x-goog-api-key) at execution time — the plan's stated `?key=` POL-07 violation there was stale; only the routing branch was net-new work. Extracted parsePreScreenText/parseEnhancementCaptionJson as shared file-scope helpers in enhancement.service.ts so gateway and direct branches cannot drift on the pre-screen fail-closed contract. CarouselGenerationResult/EnhancementResult gained costUsdMicrosTotal for Wave 6 billing (21-11/21-12). Zero code deviations. Parallel-execution git race: Task 1's commit (9aa0f95) swept up 21-09's concurrently-staged transcribe.routes.ts follow-up change (recordUsageEvent cost params) — verified complete/uncorrupted via `git show HEAD -- server/routes/transcribe.routes.ts`, no content lost, no history rewrite attempted (HEAD still unmoved at detection time but risk of colliding with a concurrent commit made amending unsafe); same precedent as 21-03/21-07/21-09's documented races.
- [Phase 21-12]: enhance.routes.ts's single recordUsageEvent call gained result.costUsdMicrosTotal (realCostUsdMicros) + creditStatus?.estimated_cost_micros (estimatedCostMicros) as trailing positional args, following the exact 21-03/21-08 interface with zero deviations — completes GATE-05 across all six operation surfaces (generate, edit, carousel, slide-edit, enhance, transcribe).
- [Phase 21-11]: carousel.routes.ts's two recordUsageEvent calls (generate + slide-edit) gained realCostUsdMicros/estimatedCostMicros trailing args — generate uses result.costUsdMicrosTotal (21-08's aggregated master-plan + all-slides cost), slide-edit uses result.costUsdMicros (21-05's OpenRouterImageProvider.edit() cost); both paired with creditStatus?.estimated_cost_micros. No change needed to the aborted-partial rehydrated result literal — costUsdMicrosTotal is optional, so its absence there type-checks and correctly falls back to flat pricing. Zero code deviations. Same-file two-hunk edit committed as two atomic per-task commits via `git apply --cached` on individual patch hunks (not `git add`) to keep parallel-execution git hygiene clean — no races encountered.
- [Phase 21-10]: generate.routes.ts sums textResult.costUsdMicros + imageResult?.costUsdMicros into a single realCostUsdMicros (undefined, not 0, unless at least one leg reports a gateway cost), forced to undefined on video runs so flat fallback pricing is never partially overridden; buildTextFallback's return gained an explicit costUsdMicros: undefined field so the textResult union type satisfies structural access without a cast. edit.routes.ts hoists editCostUsdMicros above the isVideoPost branch, capturing it only from the image branch's provider.edit() result. Both routes pair the real cost with creditStatus?.estimated_cost_micros — completes GATE-05 wiring for the two highest-traffic billing paths (generate, edit). Zero deviations; npm run check + all acceptance-criteria greps passed on first attempt for both tasks.
- [Phase 21-13]: Flipped all 9 stubbed check() calls in verify-phase-21.ts into real static/functional assertions (GATE-01..05,07, POL-01, POL-07, CRSL2-03) — every plan-authored regex matched the real implemented code with zero adjustments needed, confirming 21-02..21-12 delivered exactly what their own per-task verify commands claimed. GATE-08 freeze guard block confirmed byte-identical to 21-01 via git diff (zero hunks). Full gate green: 43/43 checks, npm run check clean, standalone adapter test 3/3 pass. Appended a 5-step manual/live verification runbook as a comment block inside the harness for post-ship operator use. This closes Phase 21 (13/13 plans complete).

**Phase 21.1 — Affiliate BYOK Migration execution (started 2026-07-27):**

- [Phase 21.1-01]: Built the GATE-06 foundation — `scripts/verify-phase-21.1.ts` (41-check harness, `--only=<tag>` filter, `gateIsConditional()` Pitfall-1 structural guard, `readSafe()` for in-progress files) and `scripts/test-affiliate-key-resolution.ts` (9-assertion no-network fixture test), the additive `profiles.openrouter_api_key` migration + `profileSchema` field, and `getOpenRouterApiKey`/`selectImageApiKey` in `auth.middleware.ts`. `getOpenRouterApiKey`'s platform tier reads `config.OPENROUTER_API_KEY` (env var, single source of truth from Phase 21) rather than a new `platform_settings` row; `getGeminiApiKey`/`getOpenAIApiKey`/`usesOwnApiKey`/`getPlatformDefaultApiKey` left byte-unchanged (verified via `git diff` — additions only). Deviation: allowlisted the fixture literal `sk-or-affiliate-fixture` in `.gitleaks.toml` (false positive on the `openai-api-key` rule; test-only, never a real credential) — Rule 3 blocking-issue auto-fix. Full harness now exits 1 with exactly 40 failures, all confined to `[svc-*]`/`[route-*]`/`[ui-settings]` tags (plans 02-07 close these); `verify-phase-21.ts` still exits 0 (no regression).
- [Phase 21.1-02]: `OpenRouterImageProvider.generate()`/`.edit()` in `image-provider.ts` now prefer `input.apiKey || requireOpenRouterKey()` (platform fallback retained); `GeminiService(apiKey?, openRouterApiKey?)` + `createGeminiService(apiKey?, openRouterApiKey?)` extended so both OpenRouter-routed branches (`generateCaptionOnly`, `generateText`'s `runTextCall`) prefer `this.openRouterApiKey` over `config.OPENROUTER_API_KEY`; GATE-07 direct-rollback comment rewritten to state the accurate, narrower limitation (affiliates keep a video-only Gemini key, so `"direct"` rollback only throws for affiliates who left that field empty). Zero code deviations; all acceptance-criteria greps + `verify-phase-21.1.ts --only=svc-image-provider` (2/2), `--only=svc-gemini` (5/5), `--only=foundation` (10/10, no regression), `verify-phase-21.ts` (43/43, no regression), and `npm run check` passed on first attempt for both tasks. Parallel-execution git race: Task 1's first commit attempt swept up plan 21.1-03's concurrently-staged `caption-quality.service.ts` — caught via `git show --stat HEAD` before pushing further work (HEAD had not moved further), fixed with `git reset --soft HEAD~1` + selective unstage + re-commit, no content lost; same precedent as 21-03/21-07/21-08/21-09's documented races.
- [Phase 21.1-03]: Threaded `openRouterApiKey?: string` through the three remaining text-call services — `caption-quality.service.ts` (`callGeminiForCaption` + `ensureCaptionQuality`, all 3 internal caption calls forward it), `carousel-generation.service.ts` (`CarouselGenerationParams` → `callCarouselTextPlan` master-plan call + the CRSL-09 `ensureCaptionQuality` call), and `enhancement.service.ts` (`EnhancementParams` → `runPreScreen` + `generateEnhancementCaption`) — mirroring the established `imageApiKey?: string` precedent, `params.key || config.OPENROUTER_API_KEY` fallback shape. Fail-closed `PreScreenUnavailableError` contract on a missing key preserved byte-for-byte. Zero code deviations; all acceptance-criteria greps + `verify-phase-21.1.ts --only=svc-caption/svc-carousel/svc-enhancement` (3/3 each), `verify-phase-21.ts` (43/43, no regression), and `npm run check` passed on first attempt for all three tasks. Parallel-execution git race: Task 1's commit was transiently swept into concurrent plan 21.1-02's first commit attempt (`1affc91`) — the other agent self-corrected via `git commit --amend` (new hash `8c7e0d9`, their file only), returning my changes to the working tree unstaged; re-staged and committed cleanly as `0a58a89`. No content lost at any point (verified via `git diff HEAD` empty both before and after); same precedent as 21-03/21-07/21-08/21-09/21.1-02's documented races.
- [Phase 21.1-06]: `transcribe.routes.ts` and `posts.routes.ts`'s `remake-caption` handler — the last two of 7 affiliate-facing AI surfaces — migrated onto affiliate-aware `getOpenRouterApiKey(profile)` gates, checked before `checkCredits`/the inline Phase-12.3 tier logic so the SC3 error is never a mid-flight 401/500; `transcribe.routes.ts`'s `routing === "openrouter"` gateway branch now prefers `openRouterApiKey || config.OPENROUTER_API_KEY`; `posts.routes.ts` threads the resolved key into `ensureCaptionQuality` (21.1-03's interface). `geminiApiKey` narrowed to non-affiliates only in both files — its sole remaining consumer is the GATE-07 `"direct"` rollback branch's `x-goog-api-key` header, the accepted documented limitation from 21.1-RESEARCH Pitfall 2 (neither route has a video/direct-Google leg). Zero code deviations; all acceptance-criteria greps + `verify-phase-21.1.ts --only=route-transcribe` (3/3), `--only=route-remake-caption` (2/2), `verify-phase-21.ts` (43/43, no regression), and `npm run check` passed on first attempt for both tasks. `grep -rn "config.OPENROUTER_API_KEY" server/routes/ server/services/` confirmed every remaining bare-read hit is a comment, a `||` fallback right-hand-side, or the single `image-provider.ts` `requireOpenRouterKey()` line — GATE-06's call-site migration is now complete across all 7 surfaces. No git races encountered — `git status` checked immediately before each of this plan's two commits, only the intended single file was ever staged.
- [Phase 21.1-07] (PARTIAL — Tasks 1-2 of 3 only): Settings UI now shows exactly two affiliate API-key cards — new "OpenRouter API Key" (`profiles.openrouter_api_key`) first, then the retained Gemini card relabeled "Gemini API Key (video only)" with its testids/handler/state byte-unchanged; OpenAI key card, AI Image Provider radio card, their handlers/state, and the unused `RadioGroup` import all removed. Full GATE-06 harness green (54/54, zero fixes needed — every check written in 21.1-01..06 matched the real implementation exactly), Phase 21 unregressed (43/43), `test-affiliate-key-resolution.ts` (9/9), `npm run check` clean, and `npm run build` validated end-to-end for the first time since the 2026-05-17/18 merges (resolves the standing STATE.md build-validation blocker). Appended the MANUAL/LIVE VERIFICATION RUNBOOK comment block to `verify-phase-21.1.ts` verbatim (pure addition, `git diff --stat` shows only `+90`). Deviation: retained the bare `"Gemini API Key"` translation entry in pt.ts/es.ts (excluded from the plan's literal replacement block) because `affiliate-dashboard.tsx` — an out-of-scope, unrelated page — still calls `t("Gemini API Key")` for its own legacy key field; deleting it would have silently broken pt/es translation there. **Task 3 (`checkpoint:human-verify`, `gate="blocking"`) was NOT performed** — it requires a real second funded OpenRouter account, Supabase SQL editor access, and a paid Veo call, none available in this execution environment. GATE-06 is NOT marked complete; Phase 21.1's ROADMAP checkbox is NOT checked. See `.planning/phases/21.1-affiliate-byok-migration/21.1-07-SUMMARY.md` for the full operator runbook and blocker detail.
- [Phase 21.1-05]: `carousel.routes.ts` (both the generate handler and the slide-edit handler) and `enhance.routes.ts` migrated onto the canonical affiliate-aware gate (`if (ownApiKey) getOpenRouterApiKey else getGeminiApiKey`), replacing the unconditional Gemini hard gate; every image call site in both files now resolves its key via `selectImageApiKey({ providerName, geminiApiKey, openRouterApiKey, openaiApiKey })` instead of the old `let imageApiKey = geminiApiKey` / `let imageApiKey: string | undefined` patterns; `openRouterApiKey` threaded into `generateCarousel()` and `enhanceProductPhoto()`. Confirmed via grep that neither file has a video/`enforceExactImageText` call site, so no carve-out was needed (same conclusion as 21.1-06). Zero code deviations; all acceptance-criteria greps + `verify-phase-21.1.ts --only=route-carousel` (4/4), `--only=route-enhance` (3/3), `--only=svc-*` (16/16, no regression), `verify-phase-21.ts` (43/43, no regression), and `npm run check` passed on first attempt for both tasks. No git races encountered — `git diff --cached --name-only` checked immediately before each of this plan's two commits, only the intended single file was ever staged.
- [Phase 21.1-04]: `generate.routes.ts` and `edit.routes.ts` — the two highest-traffic surfaces and the ONLY two files where both key resolvers coexist — migrated onto the canonical affiliate-aware gate applied verbatim from the plan: affiliates gate on `getOpenRouterApiKey`, non-affiliates keep the unchanged `getGeminiApiKey` hard gate; a SECOND, non-fatal `getGeminiApiKey` resolution + pre-SSE `isVideo(Post) && !geminiApiKey` guard preserves the GATE-08-frozen `generateVideo()` direct-Google branch for affiliates (21.1-CONTEXT's amended video-key-retention decision — the two keys do NOT collapse into one). `createGeminiService(geminiApiKey, openRouterApiKey)` (generate.routes.ts only), `selectImageApiKey` (both routes' image calls, replacing `let imageApiKey = geminiApiKey`), and `ensureCaptionQuality` (both routes) now carry `openRouterApiKey`. `enforceExactImageText` and `generateVideo`'s own body were explicitly left untouched (direct-Google, GATE-08/Pitfall-2 scope). Zero code deviations; all acceptance-criteria greps + `verify-phase-21.1.ts --only=route-generate` (4/4), `--only=route-edit` (4/4), `--only=foundation` (10/10, no regression), `verify-phase-21.ts` (43/43, no regression), and `npm run check` passed on first attempt for both tasks. No git races encountered — `git status --short` checked immediately before each of this plan's two commits, only the intended single file was ever staged (sibling agents' concurrent edits to `carousel.routes.ts`/`enhance.routes.ts`/`posts.routes.ts` were left untouched).
- [Phase 22-03]: Scaled the carousel master-plan token budget with slide count — `CAROUSEL_TOKEN_BASE` (1200) + `CAROUSEL_TOKENS_PER_SLIDE` (350) via exported `carouselPlanMaxTokens(slideCount)`, wired into both `callCarouselTextPlan` transports (OpenRouter `maxTokens`, direct-Gemini `maxOutputTokens`), replacing the flat `2048` ceiling; carousel's model slug deliberately left on `ai_models.text_generation` this phase (scope-note comment added, model tier + multimodal refs are Phase 25). Added a 5th "Planning (Art Director)" selector to the admin AI Models card, bound to `ai_models.planning`, offering 4 bare model slugs live-reverified against OpenRouter's `structured_outputs` model list at implementation time (all 4 confirmed OK, no substitution needed); grid widened to `sm:2/lg:3/xl:5` columns; pt/es translations added adjacent to the existing "Text Generation & Prompts" entries, no keys removed. Zero code deviations; all acceptance-criteria greps (with two noted plan-authoring grep inaccuracies that don't affect functionality — see 22-03-SUMMARY.md), `verify-phase-22.ts --only=svc-token-budget` (6/6) and `--only=svc-model-tier` (6/6), `verify-phase-21.ts` (43/43, no regression), `verify-phase-21.1.ts` (all green, no regression), `npm run check`, and `npm run build` all passed. No git races encountered — `git status --short` checked immediately before each of this plan's two commits, only the intended files were ever staged.
- [Phase 22-02]: `GeminiService.generateText()`'s planning call now attaches `mergedReferenceImages` multimodally on both transports — `buildPlanningContentParts()` (OpenRouter `image_url` content parts, reusing Phase 21's `toOpenRouterInputReference()`) and `buildPlanningGeminiParts()` (direct-Gemini `inlineData` parts, mirroring `generateImage()`'s existing pattern) — replacing the prior textual "N image(s) provided" sentence that never actually reached either request body; `generate.routes.ts`'s planning call site stopped stripping `mimeType` (`referenceImages: mergedReferenceImages,` replacing `.map(img => img.data)`). Model resolution now branches on `contentType`: non-video planning reads the new `ai_models.planning` (default `gemini-2.5-pro`), video planning keeps `ai_models.text_generation` unchanged (frozen GATE-08 path). Both transports' `maxTokens`/`maxOutputTokens` raised from `2048` to `PLANNING_MAX_OUTPUT_TOKENS` (4096, from plan 22-01's `planning-schema.service.ts`); `generateCaptionOnly`'s 512-token caption-rescue budget left untouched. Zero code deviations; `verify-phase-22.ts --only=svc-multimodal` (6/6), `--only=svc-model-tier` (6/6), `--only=svc-token-budget` (6/6), `verify-phase-21.ts` (43/43, GATE-08 freeze guard intact), and `npm run check` all passed. No git races encountered — `git status --short` checked immediately before each of this plan's two commits, only the intended two files (`server/services/gemini.service.ts`, `server/routes/generate.routes.ts`) were ever staged.
- [Phase 22-04]: `gemini.service.ts`'s planning call now requests strict `response_format.json_schema` (OpenRouter, `PLANNING_JSON_SCHEMA`) / `generationConfig.responseSchema` (direct-Gemini, `PLANNING_GEMINI_RESPONSE_SCHEMA`) for non-video content, validating every parsed payload via `validatePlanningWireResult()` BEFORE `normalizeGeminiTextResult()` on both transports and both attempts (the frozen video planning call keeps the loose `json_object` shape, byte-equivalent). If the retry (attempt 2) also fails schema validation, `generateText()` fires `logPlanningSchemaFailure()` (writing `generation_logs.event_kind='planning_schema_failure'`) then throws `PlanningSchemaError` — `buildLocalTextFallback()` is no longer reachable from a schema-validation failure, though transport failures (network/auth/empty completion) and the frozen video path are completely unchanged. `generate.routes.ts`'s inner `catch (textError)` now checks `isPlanningSchemaError` first and rethrows before `buildTextFallback()` can absorb it; the pre-existing outer catch converts that into an SSE 500 for the user, and `deductCredits()` (called only after a successful post insert) never runs on this path. Zero code deviations; two of the plan's own literal acceptance-criteria greps overcounted by 1 due to substring collisions with a TypeScript type annotation and a code comment (not code issues — see 22-04-SUMMARY.md); the plan's actual binding gates (`verify-phase-22.ts --only=svc-schema` 25/25, `--only=svc-schema-failure-log` 7/7, full run 47/47 outside 22-05's out-of-scope svc-prompt-precedence checks), `test-planning-schema-classification.ts` (9/9), `verify-phase-21.ts` (43/43, no regression), `verify-phase-21.1.ts` (54/54, no regression), and `npm run check` all passed.
- [Phase 22-05]: `buildContextPrompt`'s non-video task list rewritten — task 4 now instructs the model that `image_prompt` is THE authoritative 120-200 word continuous-prose art-direction brief handed verbatim to the image model (subject state, camera framing/angle, lens/depth-of-field, lighting setup/direction, surface/material texture, background, named brand-color placement, mood, and reserved typography negative space; bullet points and label fragments like "Composition: ..., Lighting: ..." explicitly banned), replacing the old deprioritizing "Optionally provide a flattened image_prompt string, but prioritize the creative_plan.structured_image_prompt object." New task 5 documents `text_blocks`/`layout_archetype_id`; the caption instruction renumbered to task 6; the response-format JSON example updated to match. `normalizeGeminiTextResult` now computes `flattenedPrompt` lazily inside a ternary keyed on the trimmed model `image_prompt`, so `buildImagePromptFromStructuredJson`'s mechanical label-fragment concatenation is structurally unreachable whenever the model supplied any prompt at all — reachable only via the transport-failure `buildLocalTextFallback()` path (confirmed via grep: exactly 2 call sites in `gemini.service.ts`, both gated). `GeminiTextResult` gained `text_blocks: TextBlock[]` / `layout_archetype_id: LayoutArchetypeId`, populated end-to-end by `normalizeGeminiTextResult` (validated/clamped to <=3 role-tagged blocks + one of the 3 known archetypes), `buildLocalTextFallback`, and route-level `buildTextFallback` (using the imported `DEFAULT_LAYOUT_ARCHETYPE_ID` constant, not a bare string literal). `buildImagePromptFromStructuredJson`'s JSDoc in `prompt-builder.service.ts` now documents it as FALLBACK-ONLY; function body unchanged. The frozen video planning branch is byte-unchanged (confirmed via `git diff` — only hunks below its closing brace). Zero deviations; `verify-phase-22.ts` full run 51/51 green (all four `svc-prompt-precedence` checks now pass), `verify-phase-21.ts` (43/43, no regression), `verify-phase-21.1.ts` (54/54, no regression), `test-planning-schema-classification.ts` (9/9), `npm run check`, and `npm run build` all passed. This closes PLAN-04's precedence-bug-fix scope and PLAN-02's forward-compat schema-field-propagation scope.

### Roadmap Evolution

- 2026-04-21: v1.1 milestone started (Media Creation Expansion)
- 2026-05-07: Phase 11 complete (trash + cleanup-cron)
- 2026-05-08: v1.2 milestone shipped (Phases 13-15 — Production Hardening). v1.3 milestone shipped (Phase 16). Phase 12.5 (SEED-001 graduation) completed.
- 2026-05-16: v1.4 milestone shipped (Phase 17 — GHL Signup Sync). v1.5 milestone shipped (Phases 18-20 — Brand Style References).
- 2026-05-17: origin/dev's parallel Phase 12 (Image Provider Abstraction) shipped + 4 decimal patches (12.1-12.3, 12-audit). v1.1 closed with image provider as canonical Phase 12. Merge reconciliation — both branches unified; Phase 12 = image provider, Phase 12.5 = overage cron (decimal insert).
- 2026-05-18: origin/main's parallel "Phase 13" (carousel quick-remake + per-slide edit) folded in as Phase 12.6 — depends on Phase 12 image provider. v1.1 re-closed with 12.6 added.
- 2026-07-18: v1.6 milestone started (Professional Design Quality Overhaul + OpenRouter Gateway). Requirements defined (40 REQ-IDs across GATE/TYPO/PLAN/CRIT/CRSL2/POL). Roadmap created: 6 phases (21-26), 100% requirement coverage. Validation (APPROVED_WITH_NOTES) revisions applied same day: GATE-06 split into decimal Phase 21.1 (Affiliate BYOK Migration) → 7 phases total; fallback-chain + cost-recording criteria added to Phase 21; Phase 22 schema-forward-compatibility criterion added; subjective criteria replaced with observable proxies; POL-08 flagged post-ship audit. Ready to plan Phase 21.
- 2026-07-24: Phase 21 (OpenRouter Gateway Foundation) planned — 21-RESEARCH.md, 21-CONTEXT.md, 13 execution plans (21-01 … 21-13) across 7 waves, 21-VALIDATION.md (nyquist_compliant, wave_0_complete: false). STATE reconciled (status roadmap_complete → phase_planned; stale "ready to plan" guidance corrected to "ready to execute"). All v1.6 planning artifacts committed to git (previously uncommitted/untracked). Next: `/gsd:execute-phase 21`.
- 2026-07-27: Phase 21 (OpenRouter Gateway Foundation) execution complete — all 13 plans landed, `scripts/verify-phase-21.ts` green (43/43 checks, GATE-08 freeze guard intact), `npm run check` clean. All 10 Phase 21 requirement IDs (GATE-01..05,07,08, POL-01, POL-07, CRSL2-03) marked complete. Ready for `/gsd:verify-work` or next phase (21.1 Affiliate BYOK Migration / 22 Art Director Planning Upgrade).
- 2026-07-27: Phase 21.1 (Affiliate BYOK Migration) Plan 07 Tasks 1-2 of 3 executed — affiliate Settings UI closed (OpenRouter card + video-only Gemini card, OpenAI/image-provider cards removed), full GATE-06 harness green (54/54), Phase 21 unregressed (43/43), `npm run build` validated end-to-end for the first time since the merge. **Phase 21.1 is NOT closed.** Task 3 (`checkpoint:human-verify`, blocking) — operator sign-off on migration application + live SC1/SC2/SC3 checks + affiliate video regression — requires a real second funded OpenRouter account, Supabase SQL editor access, and a paid Veo call; none available in this environment. GATE-06 not marked complete; Phase 21.1 ROADMAP checkbox not checked. Blocker logged; runbook embedded at the bottom of `scripts/verify-phase-21.1.ts`.

### Pending Todos

None.

### Blockers/Concerns

- Seven prior phases (5–9.1, 11, 12, 12.5, 12.6, 17) carry `human_needed` UAT debt — owner-time-bounded. Run `/gsd:audit-uat` to review.
- Live E2E billing/ads validation harness — tracked in SEED-002. Deferred.
- Fat file refactor — tracked in SEED-004. Deferred.
- v1.6 MEDIUM confidence on OpenRouter Unified Image API exact request/response shape — architecture research flagged this as needing Context7/live-docs verification at Phase 21 implementation time (WebSearch-only confidence today).
- v1.6 POL-08 (cost reconciliation) is a post-ship audit item — requires one full billing period of gateway traffic; explicitly cannot gate milestone close.
- Phase 21.1 Plan 07 Task 3 (checkpoint:human-verify, blocking): operator sign-off required for migration application (openrouter_api_key column), SC1 provisioning/rotation, SC3 missing-key error shape, SC2 live billing attribution + simulated-failure provider pinning, and the affiliate video regression carve-out. Requires a real second funded OpenRouter account, Supabase SQL editor access, and a paid Veo video call -- none available in the execution environment. Runbook embedded at the bottom of scripts/verify-phase-21.1.ts.

## Session Continuity

Last session: 2026-07-27T19:08:39.500Z
Stopped at: Completed 22-05-PLAN.md (art-director prompt precedence fix + text_blocks/layout_archetype_id forward-compat)
Next action: Execute plan 22-06 (Phase 22's final plan) to complete the Art Director Planning Upgrade phase. Separately/independently: Phase 21.1 Plan 07 Task 3 remains blocked — operator must run the 7-step runbook embedded at the bottom of `scripts/verify-phase-21.1.ts` (migration apply via Supabase SQL editor, SC1 provisioning/rotation, SC3 error shape, SC2 billing attribution + simulated-failure provider pinning, affiliate video regression, non-affiliate regression). On "approved" (or a described failure), resume plan 21.1-07 Task 3 to record the outcome in 21.1-07-SUMMARY.md and close out Phase 21.1.
Resume file: None
