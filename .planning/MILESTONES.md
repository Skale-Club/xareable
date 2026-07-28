# Milestones

## v1.6 Professional Design Quality Overhaul + OpenRouter Gateway (Shipped: 2026-07-28)

**Phases completed:** 7 phases, 69 plans, 163 tasks

**Key accomplishments:**

- Phase-wide verify harness (`scripts/verify-phase-21.ts`) created with a real, passing GATE-08 SHA-256 freeze guard on `video-generation.service.ts`, plus 9 stubbed checks for the remaining Phase 21 requirements.
- Fixed the ~30x video-edit credit under-charge (POL-01) and the doomed-slide-2..N-after-slide-1-failure carousel bug (CRSL2-03); confirmed the two stay-direct-Gemini POL-07 sites were already query-string-key-free.
- New `ai-gateway-settings.service.ts` module (routing + fallback-chain read/write over `platform_settings`) plus `recordUsageEvent`'s additive real-cost/estimated-cost params backed by a new `usage_events.metadata` column — zero behavior change for any existing call site.
- Built the OpenRouter-backed `chatCompletion()` and `transcribe()` entrypoints in `server/services/ai-gateway.service.ts`, wrapped in a shared one-pass fallback-chain helper with best-effort `model_fallback` logging to `generation_logs`.
- Raw-fetch generateImage()/editImage() against OpenRouter's dedicated Image API, an OpenRouterImageProvider thin wrapper preserving the existing ImageProvider interface, and a no-network functional test proving the input_references reference-image adapter shape.
- Flipped the image generation pipeline onto OpenRouter by default via a routing-aware factory, retired the legacy gemini/openai `image_provider` toggle, and shipped admin endpoints for no-deploy routing rollback and fallback-chain configuration.
- GeminiService.generateText() (the art-director planning call) and generateCaptionOnly() now route through OpenRouter's chatCompletion() by default, with the direct header-auth Gemini path retained behind ai_gateway_routing.planning="direct" for GATE-07 rollback; dead transcribeAudio deleted, zero query-string keys remain in the file.
- Carousel master text plan, caption-quality helper, and enhancement pre-screen/caption calls all now branch on `ai_gateway_routing.planning` through OpenRouter's `chatCompletion`, each with an intact direct-Gemini rollback and (for carousel/enhancement) an aggregated `costUsdMicrosTotal` on their result contracts.
- Transcription route now defaults to OpenRouter's gateway `transcribe()` with a header-fixed direct-Gemini rollback branch, and its usage event records real gateway cost plus the pre-call credit estimate.
- Single-image `/api/generate` and `/api/edit-post` now pass OpenRouter's real per-request cost (summed text+image, or edit-call cost) plus the pre-call credit estimate into `recordUsageEvent`, while video stays on flat fallback pricing.
- Both carousel billing points (carousel-generate aggregate + per-slide edit) now pass real OpenRouter gateway cost plus the pre-call credit estimate into `recordUsageEvent`, completing GATE-05 for the carousel surface.
- Enhancement's single `recordUsageEvent` call now carries `result.costUsdMicrosTotal` (aggregated pre-screen + edit + caption gateway cost) plus `creditStatus?.estimated_cost_micros`, completing GATE-05 across all six operation surfaces (generate, edit, carousel, slide-edit, enhance, transcribe).
- Flipped all 9 stubbed Phase 21 requirement checks into real static/functional assertions, bringing `scripts/verify-phase-21.ts` to 43/43 green — the single committed phase-gate for OpenRouter Gateway Foundation.
- Additive `profiles.openrouter_api_key` migration + `getOpenRouterApiKey`/`selectImageApiKey` resolver helpers in `auth.middleware.ts`, backed by a 41-check `--only=<tag>` verification harness and a green 9-assertion no-network fixture test — the contract all 6 downstream wiring plans code against.
- OpenRouterImageProvider and GeminiService both now accept and prefer a caller-supplied OpenRouter key over the platform env key, with the GATE-07 rollback gap explicitly documented in code.
- Three service interfaces (caption quality, carousel master-plan, enhancement pre-screen/caption) now accept a per-request OpenRouter key that overrides the platform env key, completing 4 of the 6 gateway text-call sites for affiliate billing attribution.
- Affiliate-aware OpenRouter key gate replaces the bare Gemini hard gate in `/api/generate` and `/api/edit-post`, while both routes keep an unchanged, non-fatal Gemini key resolution feeding the frozen direct-Google video branch.
- Both carousel handlers (generate + slide-edit) and the enhancement handler now gate affiliates on `getOpenRouterApiKey` and thread the resolved key into `generateCarousel`/`enhanceProductPhoto` and every `provider.edit`/image call site via `selectImageApiKey`.
- Voice transcription and caption-remake — the last two affiliate-facing AI surfaces — now gate on and bill to the affiliate's own OpenRouter key instead of the Gemini profile.api_key field, completing all 7 of 7 GATE-06 call sites.
- STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (code-complete, full GATE-06 gate green); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.
- Built the Phase 22 verification harness (51 live checks, `--only=<tag>` filter) plus the standalone `planning-schema.service.ts` module carrying both wire-format schema dialects (OpenRouter `json_schema` strict mode and direct-Gemini uppercase `responseSchema`), a schema-vs-transport failure classifier, and the `ai_models.planning` / `logPlanningSchemaFailure` observability plumbing later waves will wire into `gemini.service.ts`.
- `GeminiService.generateText()` now sends real `image_url`/`inlineData` multimodal parts on both transports whenever reference images exist, resolves its model from the new `ai_models.planning` slug (default `gemini-2.5-pro`) for non-video content, and doubles its output-token ceiling from 2048 to 4096 via `PLANNING_MAX_OUTPUT_TOKENS`.
- `GeminiService.generateText()`'s single-image planning call now requests strict `json_schema`/`responseSchema` structured output on both transports, validates every parsed payload before normalization, and — on a double schema-validation failure — throws a logged `PlanningSchemaError` that the route layer rethrows as a real user-facing error instead of silently degrading to a generic templated post.
- The planning prompt now tells the model `image_prompt` is THE authoritative 120-200 word prose art-direction brief (not an optional flattened afterthought), and `normalizeGeminiTextResult` computes the mechanical label-fragment flattening lazily so it can never win over a model-authored prompt.
- STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (verify-phase-22.ts is green at 54/54 with zero weakened checks, and the OPENROUTER_API_KEY-gated live ablation harness exists and behaves correctly in both its skip and usage-error paths); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.
- @napi-rs/canvas + bundled Inter v4.1 fonts + AVX smoke check + pt-BR/es golden-image fixtures + the 12-tag scripts/verify-phase-23.ts phase gate, all wired into the build but deliberately red except `[self-test]` until plans 23-02..23-10 land
- Additive `posts`/`post_versions` migration for base_image_url/typography_meta/generation_params plus the matching typed Zod contract (`TypographyMeta`, `GenerationParams`) and four new `edit_context` fidelity fields — zero runtime behavior change yet
- Generic 'W:H' center-crop service (`cropToExactAspectRatio`) via `sharp .extract()` that normalizes any of the 15 accepted `aspect_ratio` enum values to within 0.01 of exact, proven by a standalone 22-assertion test with zero network calls
- `typography-compositor.service.ts` — real bundled Inter weights drawn via `@napi-rs/canvas` across 3 layout archetypes, with safe-zone word-wrap/auto-shrink and a `sharp`-driven automatic contrast scrim, replacing AI-rendered on-image text entirely
- Inverted all four AI-renders-text prompt/schema leak channels in gemini.service.ts/planning-schema.service.ts/prompt-builder.service.ts into a negative-space, compositor-only contract — `scripts/verify-phase-23.ts --only=svc-text-free-prompt` now 23/23 green
- `generate.routes.ts`'s image branch now runs crop → base-image upload → deterministic typography compositor → logo overlay → optimize with zero AI verify/repair calls, persisting `base_image_url`/`typography_meta`/`generation_params` on every new post
- Rewired `edit.routes.ts` to AI-edit the persisted pre-typography base image (crop -> composite -> logo -> optimize), added a zero-AI-call compositor-only fast path for text-only edits, deleted the AI verify/repair loop, and kept every pre-migration post editable through an explicit LEGACY (base_image_url IS NULL) branch — proven by a 20/20 no-network fixture test
- `scripts/verify-golden-image.ts` (standalone tofu/archetype/AVX gate) wired into both the Docker builder+runner stages (fontconfig + fc-cache + hard gate) and the CI verify job, making TYPO-04's "no missing glyphs ship" guarantee machine-enforced end to end
- Deleted `text-rendering.service.ts` (`verifyExactImageText`/`enforceExactImageText`) and its `logTextVerification` observability emitter entirely, reworded every dangling reference, and converted Phase 16's OBS-01 harness check from a presence assertion into an honest absence assertion so it stays green and meaningful post-deletion
- post-edit-dialog.tsx gains a pre-filled Format & Logo step (mirroring post-creator-dialog.tsx) driven by the post's persisted generation_params, quick remake forwards those same params instead of generic defaults, and a derived text_only signal lets the server take its compositor-only fast path — closing POL-05's client half and reconciling the Text on Image step's copy for deterministic compositing
- STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (verify-phase-23.ts is green at 80/80 across 13 tags with zero weakened checks, and the 7-step MANUAL/LIVE VERIFICATION RUNBOOK is embedded); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.
- Removed the last channel through which the image model could be told to render promotional typography — `buildDefaultCreativePlan()`'s `required_elements` literal and `buildLocalTextFallback()`'s always-losing `flattenedPrompt || image_prompt` — and added 6 functional (call-the-real-code) checks that would have caught it.
- Installed the 6-tag, 45-check `scripts/verify-phase-24.ts` phase gate and three additive, zero-migration widens (`ai_models.critic`, `event_kind: "visual_critic"`, `FallbackCallClass "critic"`) that every later Phase 24 plan compiles and verifies against.
- `chatCompletion()` gains an additive `callClass` param (defaulting to `"text"`) and a real `AbortSignal` wired to the openai SDK's `RequestOptions`; the OpenRouter Image API's `fetch()` and `OpenRouterImageProvider.generate()` gain the same real-cancellation wiring — all 6 existing `chatCompletion` callers verified byte-unchanged.
- `recordUsageEvent` gained an additive, namespaced `extraMetadata` passthrough that provably cannot influence the charged amount, and `observability.service.ts` gained `logVisualCritic()` — a fourth fire-and-forget emitter following the exact `logCaptionQuality` contract, ready for plan 24-06 to wire into the re-roll loop.
- Widened the fallback-chain admin endpoint to accept `call_class: "critic"` and added a "Visual Critic" model selector (pt/es translated) to the AI Models admin card, making `ai_models.critic` admin-configurable on both surfaces every other call class already has, while the GATE-07 routing endpoint keeps correctly rejecting `critic` per its locked OpenRouter-only scope.
- `server/services/visual-critic.service.ts` — a strict-schema, `callClass: "critic"`, abort-propagating, fail-open-on-outage multimodal scorer whose CRIT-02 hard/soft-fail asymmetry, best-of-3 tie-break, and discarded-attempt cost exclusion are proven by 25 direct no-network assertions before any route wiring exists.
- `generate.routes.ts`'s image branch now runs a bounded sequential critic/re-roll loop (1-3 attempts, identical prompt, real AbortSignal cancellation) ahead of Phase 23's crop/typography/logo pipeline, bills the user once for the accepted attempt only, and a real `AbortController` makes the safety timer's 504 provably win the race against the outer catch's generic 500.
- STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (`scripts/verify-phase-24.ts` is green at 55/55 across 7 tags with zero weakened checks, and the 8-step MANUAL/LIVE VERIFICATION RUNBOOK is embedded); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.
- Installed `scripts/verify-phase-25.ts` — the 7-tag Phase 25 phase gate (self-test green, 48 checks across the 6 requirement tags honestly red) — making every downstream plan's `--only=<tag>` verify command runnable today.
- Additive Zod schemas (artDirectionSchema, styleReferencePhotoSchema, carousel-slide typography fields) plus two additive SQL migrations, landing every Phase 25 data contract before any downstream plan needs to invent its own types.
- `carousel-plan-schema.service.ts` — deterministic server-side hook/content/cta role assignment (model's own guess always discarded), a token-Jaccard inter-slide composition-variation check, and the dual-dialect (OpenRouter strict json_schema / direct-Gemini responseSchema) carousel plan contract with a coercing validator — all provable with zero AI calls.
- Extracted the reference-image slot-priority merge (user > brand > style-board, 4-slot cap) out of `generate.routes.ts`'s inline block into a pure, network-free `planReferenceImageSlots` function plus a full I/O layer (`fetchStyleBoardPhotoUrls`, `fetchReferenceImagesAsBase64`, `resolveGenerationReferenceImages`), proven by a 12-assertion no-network test harness.
- Wrote real, non-generic photography/lighting/composition/texture/negative-prompt copy for all 9 brand styles and 12 post moods in `DEFAULT_STYLE_CATALOG`, plus a `withDefaultArtDirection` read-time backfill so an already-deployed `platform_settings.style_catalog` row (written before Phase 25) actually serves the new content.
- Two pure, injectable prompt-fragment builders — a 60-30-10 named-color sentence explicitly citing color_4 as the accent, and a dense art-direction block + platform-wide anti-AI-look negative prompt — ready for identical reuse by both the single-image and carousel generation paths.
- `resolveTypographyTreatment` + an additive, default-identity `treatment` param on `compositeTypography` map text-style selection onto real weight/size/case/tracking variation within the single bundled Inter family, with proven byte-identical fallback to Phase 23's output.
- Three admin-guarded Express endpoints (`GET`/`POST`/`DELETE /api/admin/style-reference-photos`) backed by `createAdminSupabase()`, with an 8-photo cap, auto-position assignment, and best-effort storage cleanup on delete — registered on the live API router.
- `gemini.service.ts`'s single-image planning prompt now carries dense per-style/mood art direction, an explicit 60-30-10 color rule naming `color_4`, and an anti-AI-look negative block; `generate.routes.ts`'s reference-image merge now runs user-uploaded > brand photos > platform style board through the shared resolver instead of the old 2-tier inline block.
- Rebuilt `carousel-generation.service.ts`'s entire plan layer around `carousel-plan-schema.service.ts`: server-assigned hook/content/cta narrative roles, per-slide varied framing driving both the plan prompt and the actual slide-1/slide-N image calls, one carousel-level layout archetype, and a planning-tier strict-structured-output call that finally injects dense aesthetic DNA + 60-30-10 color into the carousel path.
- Every Brand Style and Post Mood in the admin style-catalog editor now exposes five dense art-direction fields (photography type, lighting, composition, texture, negative prompts), and a new StyleReferenceBoardsCard gives admins immediate-persist upload/delete control over platform-curated reference image boards — both riding the existing tab, with full pt-BR/es coverage.
- Every carousel slide now runs the exact Phase 23 single-image pipeline (crop -> persist base -> composite typography -> logo overlay -> upload) with a shared carousel-level layout archetype and text-style-driven treatment, and both the master-plan call and every slide image call now attach brand/style-board reference images via the shared 4-slot resolver.
- `POST /api/carousel/slide/edit` now edits the slide's persisted pre-typography `base_image_url` and re-runs crop -> compositeTypography (carousel-level archetype + text-style treatment) -> logo overlay -> upload, mirroring Phase 23's `edit.routes.ts` 1:1, with a LEGACY (`base_image_url IS NULL`) branch that reproduces pre-Phase-25 behavior byte-for-byte.
- STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (`scripts/verify-phase-25.ts` is green at 71/71 across 8 tags with zero weakened checks, and the 8-step MANUAL/LIVE VERIFICATION RUNBOOK is embedded); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.
- Installed the honestly-red Phase 26 phase gate (`scripts/verify-phase-26.ts`, 9 tags/8 implemented/45 checks) plus three deterministic logo/corner-contrast fixtures, so every later 26-02..26-09 plan has a real `--only=<tag>` target to turn green.
- Bumped the main-image WebP encode quality from 80 to 85 (thumbnails stay at 70) and installed `scripts/verify-webp-text-edge.ts`, a standalone Laplacian-edge-energy gate that proves the bump doesn't smear composited typography and provably fails at a deliberately bad quality of 40.
- Fixed the pre-existing `drawBlocks()` bug where every text block in a multi-block layout silently rendered using whatever font `layoutBlocks()`'s measurement loop left on the canvas context (the LAST block's) — so a headline next to a CTA rendered at CTA size — via a 1-line `ctx.font` reassignment per block, proven by a real-pixel ink-extent harness rather than font-metrics memorization.
- All four client `/api/generate`/`/api/edit-post` call sites (handleGenerate, handleGenerateEdit, buildQuickRemakeRequest, gallery quick-remake) now generate and send a fresh `crypto.randomUUID()` per submit, landing ahead of the server-side contract (plan 26-06) so no commit boundary ever has the client fail to satisfy the server.
- POL-08 scheduled (not run): a dated runbook naming `usage_events.cost_usd_micros` as the sole source of truth, a 5% discrepancy threshold, a computable trigger date, and an operator-run `reconcile-openrouter-costs.ts` scaffold that safely no-ops without Supabase credentials.
- `/api/generate` and `/api/edit-post` now run an admin-client pre-flight dedup SELECT before the credit gate — scoped by `(idempotency_key, user_id)` on `posts` for generate, and `(idempotency_key, post_id)` on the new `post_versions.idempotency_key` column for edit (since `post_versions` has no `user_id` column) — closing the server half of POL-06 that 26-04's client-side keys were waiting on.
- Rewrote `applyLogoOverlay` into a contrast- and alpha-aware overlay (`applyLogoOverlayDetailed` + a thin `Buffer`-returning wrapper) that backs a no-alpha (JPEG) logo — or any logo landing on a busy/low-contrast region — with a soft-edged plate instead of a raw opaque box, auto-selects the best corner only when the caller passed no position, and along the way fixed a genuine pre-existing bug in Phase 23's `analyzeRegionContrast` that silently computed stats over the whole image instead of the requested region.
- Nullable, CHECK-constrained `posts.feedback` column with an ownership-checked overwriting `PATCH /api/posts/:id/feedback` endpoint and a thumbs-up/down control in the post viewer, backed by real pt-BR/es translations.
- A read-only `GET /api/admin/quality` endpoint aggregating `posts.feedback` tallies, `visual_critic` outcome rates, and `model_fallback` rates over a shared time window, surfaced on a new three-card admin `QualityTab` at `/admin/quality`.
- STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (`scripts/verify-phase-26.ts` is green at 60/60 across 9 tags with zero weakened checks, and the 7-step MANUAL/LIVE VERIFICATION RUNBOOK is embedded); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.

---

## v1.4 GHL Signup Sync (Shipped: 2026-05-16)

**Phases completed:** 1 phase, 1 plan, 4 tasks
**Git range:** v1.3..v1.4 (~8 commits)

**Key accomplishments:**

- `sync_on_signup` boolean column added to `integration_settings` via additive migration `20260508203515_integration_settings_sync_on_signup.sql`. Stored as a first-class column (not JSONB) for clean querying and future indexing. Zod schemas (`adminGHLStatusSchema`, `saveGHLSettingsRequestSchema`) extended with the new field.
- `fanGHLSignup()` helper wired into `POST /api/telegram/notify-signup` as a fire-and-forget fan-out branch — runs after the existing telegram path, never blocking it. Gates on `enabled && sync_on_signup && api_key && location_id`. Calls existing `getOrCreateGHLContact()` (sealed, unchanged) with `tags: ["xareable"]`.
- All four delivery outcomes (settings-read-failed, skipped, sent, failed) write to the existing `integration_delivery_logs` table with `integrationType: "ghl"` — zero new schema, identical observability surface to the telegram branch.
- Admin UI: `ghlSyncOnSignup` state + Switch component added to the GHL card in `integrations-tab.tsx`. Hydrates from GET `/api/admin/ghl`, persists via PATCH `/api/admin/ghl`. No page reload required — existing `queryClient.invalidateQueries` handles round-trip.
- `scripts/verify-phase-17.ts` — 20-check static harness covering migration, Zod, server wiring, and admin UI. Re-runnable on any future commit. All 20 checks pass.

---

## v1.3 Generation Quality Observability (Shipped: 2026-05-08)

**Phases completed:** 1 phase, 1 plan, 5 tasks
**Git range:** v1.2..HEAD (~11 commits)

**Key accomplishments:**

- `generation_logs` table extended with 6 first-class columns (`post_id`, `event_kind`, `outcome`, `attempt_count`, `duration_ms`, `metadata`) via additive migration `20260508000000_generation_logs_observability.sql`. `error_type` left as unconstrained TEXT to avoid retro-breaking existing rows; type-narrowing for new OBS values lives in Zod (`generationLogSchema`) + TypeScript signatures. Migration applied in production via `supabase db push --db-url <session-pool-url-port-5432>`.
- New `server/services/observability.service.ts` (3 best-effort emitters): `logTextVerification` (OBS-01), `logCaptionQuality` (OBS-02), `logSubjectFidelityFailure` (OBS-03 — exported but ZERO call sites this phase per scaffolding-only invariant). All wrap `createAdminSupabase().insert()` in try/catch with error-swallowing — logging failures NEVER block, fail, or alter generation flow.
- `server/services/text-rendering.service.ts:enforceExactImageText` instrumented with single-emit-per-invocation logging across 3 exit paths (empty-text early return, success-after-pass, exhausted-passes). Outcome union maps cleanly: `pass` / `repair_succeeded` / `repair_failed`. SHA-256 hash of expected text persisted; never per-pass logging.
- `server/services/caption-quality.service.ts:ensureCaptionQuality` instrumented with single-emit-per-invocation logging across 5 exit paths (candidate-acceptable, firstPass, secondPass, repaired, fallback). Outcome union: `pass` / `retry_triggered` / `repair_triggered` / `fallback_used`.
- `server/routes/posts.routes.ts` cleanup: 4 dead duplicate caption helpers removed (`looksTruncatedCaption`, `hasHashtags`, `isAcceptableCaption`, `buildCaptionFallback` — already canonical in `caption-quality.service.ts`). `extractPromptField` PRESERVED (3 use sites in remake-caption endpoint, no service equivalent).
- `scripts/verify-phase-16.ts` runtime harness — 30 static checks + 1 dynamic round-trip (insert → read → delete via service-role Supabase) with auto-skip when env vars absent (CI-friendly). Live run with production Supabase credentials confirmed: schema match, all three emitters produce well-formed rows, error swallowing works.

---

## v1.2 Production Hardening (Shipped: 2026-05-08)

**Phases completed:** 3 phases, 5 plans, 15 tasks
**Git range:** v1.1..HEAD (~30 commits)

**Key accomplishments:**

- Per-user HTTP 429 rate limiting on 5 paid AI endpoints via `express-rate-limit` + per-user keying + admin bypass, plus SSE `safetyTimer` cleanup migrated into `finally` blocks across all 4 SSE routes (Phase 13: HARD-01, HARD-02)
- App-root React Error Boundary class component with Retry / Go home recovery UI and PT/ES translations, plus removal of 5 dead session/auth deps (`passport`, `passport-local`, `express-session`, `connect-pg-simple`, `memorystore`) + 4 `@types/*` and relocation of `@octokit/rest` to `devDependencies` (Phase 13: HARD-03, HARD-04)
- HTTP-triggered cron architecture wired for Vercel: new `requireCronSecret` middleware (`crypto.timingSafeEqual` + 401/503 split) protecting 3 internal POST endpoints (`/api/internal/cleanup/{trash,purge}` + `/api/internal/billing/run-overage-batch`); legacy `runAdminGuard` handler moved from `billing.routes.ts:649` with auth swap (Phase 14: CRON-01, CRON-02)
- `.github/workflows/cron.yml` GitHub Actions schedule firing cleanup-sweep every 6h + overage-batch weekly Sunday 00:00 UTC; `node-cron` infrastructure preserved untouched so future Hetzner migration is a config flip (Phase 14: CRON-03, CRON-04)
- Runtime verification harness `scripts/verify-cron-jobs.ts` (762 LOC) exercising trash sweep, purge sweep, and overage batch (Mode A always; Mode B Stripe `sk_test_*` gated) against an isolated test user — live run exits 0 with 3 passed / 0 failed / 1 skipped; closes VRFY-01 (Phase 15)
- Cron triggers ACTIVATED in production — `CRON_SECRET` set in Vercel + GitHub Actions secrets (`PROD_BASE_URL` + `CRON_SECRET`) configured via `vercel env add` + `gh secret set`; smoke-tested via `curl` (401/401/200/200 expected pattern; trash + purge endpoints respond in <1.3s)
- Architecture documentation: new `docs/production-cron.md` runbook, `Deployment & Cron` section in CLAUDE.md, "Scheduled Operations" section in `.planning/codebase/ARCHITECTURE.md`, cron concern marked RESOLVED in CONCERNS.md, `cleanup-cron.service.ts` header explaining dual-trigger model

---

## v1.1 Media Creation Expansion (Shipped: 2026-05-08)

**Phases completed:** 9 phases, 26 plans, 46 tasks

**Key accomplishments:**

- SceneriesCard admin UI delivers full CRUD over scenery presets via responsive card grid with thumbnail upload to Supabase Storage, AlertDialog delete confirmation, and inline is_active toggle — wired into PostCreationTab through the existing PATCH /api/admin/style-catalog save path
- en dictionary stays empty:
- Enhancement branch fully wired: JPEG/PNG/WEBP upload with 5MB guard, base64 FileReader encoding, responsive scenery picker grid from activeSceneries, UUID idempotency_key POST to /api/enhance via fetchSSE, and openViewer handoff on SSE complete (D-20)
- Auto-save creator dialog state to localStorage with 500ms debounce, 7-day TTL, and Continue/Start fresh banner restore UI for all content types (image, video, carousel, enhancement)
- postGalleryItemSchema extended with slide_count (number | null) and status (string, default "generated") so downstream gallery tiles can render carousel count badges and draft status indicators
- Gallery tiles now distinguish carousel (deck-stack + Carousel·N badge), enhancement (violet Enhanced badge), and draft carousels (orange Draft badge) with a TypeScript exhaustiveness guard ensuring future content_type values force a compile error
- Carousel slide viewer with post_slides fetch + prev/next + ArrowLeft/ArrowRight keyboard nav added to PostViewerDialog; markCreated() now fires on carousel SSE error path so partial-draft carousels appear in gallery without page reload
- Third cron job added to startCronJobs() invoking runOverageBillingBatch() on a cadence-derived expression (1d/7d/30d → daily/weekly/monthly cron) with in-process boolean lock preventing overlapping invocations

---
