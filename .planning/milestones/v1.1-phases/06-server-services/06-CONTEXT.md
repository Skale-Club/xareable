# Phase 6: Server Services - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the server-side generation logic for v1.1's two new creation surfaces as isolated, testable service modules:

1. **`server/services/carousel-generation.service.ts`** — exports `generateCarousel()`. One master text call via `gemini-2.5-flash` returning `{ shared_style, slides[], caption }`; N sequential image calls via `gemini-3.1-flash-image-preview` with multi-turn `thought_signature` propagation for style consistency (fallback to single-turn with injected `shared_style` on sig absence); partial-success contract applied after loop completion.
2. **`server/services/enhancement.service.ts`** — exports `enhanceProductPhoto()`. Internal helpers `preScreenUpload()` and `normalizeForEnhancement()` are module-private. Pre-screen via `gemini-2.5-flash` + `responseJsonSchema`; EXIF strip + square normalization via `sharp.autoOrient()` + `fit:contain`; Gemini edit call with subject-preservation prompt; output buffer ready for the route to upload.
3. **`server/quota.ts` — `checkCredits` extension** — adds optional `slideCount?: number` parameter; internal `slideMultiplier = Math.max(slideCount ?? 1, 1)` applied to `estimatedBaseCostMicros`. All existing callers (pass `undefined`) resolve to multiplier 1 — zero regression.

**Out of scope for this phase:** routes, SSE writer ownership, DB writes (post/post_slides/usage_events rows), admin UI, frontend, idempotency-key lookup (lives in Phase 7 route), logo overlay, `enforceExactImageText`, credit deduction (`deductCredits` called by Phase 7). Services never import from `server/routes/` and never touch `res`/`req`. Services accept an optional `AbortSignal` from the caller (Phase 7 attaches the 260s safety timer) and check it between slides.

Phase 6 succeeds when `npm run check` is green, `scripts/verify-phase-06.ts` passes all 7 ROADMAP success criteria against live Gemini + Supabase, and neither new service file imports Express or touches HTTP primitives.

</domain>

<decisions>
## Implementation Decisions

All decisions below were delegated by the user to Claude's recommended approach on 2026-04-21 after the four gray areas were presented. Each is a locked choice that the planner should treat as non-negotiable; the user retains the right to reverse on review.

### Rate limit & parallelism strategy

- **D-01: Strict sequential slide generation in v1.1.** No concurrent image calls. Slides generated in order 1..N inside a for-loop. Controlled 2-concurrent parallelism deferred to v2 per the ROADMAP research flag.
  - *Why:* Gemini per-model IPM/RPM for `gemini-3.1-flash-image-preview` is LOW confidence (not officially documented; community-reported 10–15 RPM Tier 1). Timing math for 8 slides sequential with 3s delays = ~121s, well inside the 260s safety timer with 53% headroom. Concurrency would halve latency but amplify 429 risk with no material UX gain.
- **D-02: `SLIDE_GENERATION_DELAY_MS = 3000` constant** declared at the top of `carousel-generation.service.ts`. `await new Promise(r => setTimeout(r, SLIDE_GENERATION_DELAY_MS))` between slide calls (not before slide 1, not after the last slide).
- **D-03: 429 retry policy — one retry only, 15 second backoff.** On `RESOURCE_EXHAUSTED` or HTTP 429 from an image call: `await new Promise(r => setTimeout(r, 15000))`, retry once. If the retry also fails, log the slide as failed and continue the loop (partial-success contract absorbs it). No multi-retry exponential backoff — keeps the per-slide failure boundary predictable under the 260s cap.
- **D-04: Master text call retry policy — one retry only on JSON parse failure or empty candidates.** Retry prompt is reinforced with `"Respond ONLY with a valid JSON object matching the schema described above. No prose, no markdown fences."` If the retry also fails or produces invalid JSON, throw a structured `CarouselTextPlanError`. Master call failure is a hard fail for the whole request — subsequent image calls depend on its output.

### Failure mode policy (fail-open vs fail-closed)

- **D-05: Pre-screen API failure → fail-closed.** If the `gemini-2.5-flash` pre-screen call itself errors (network, 500, quota), the enhancement is rejected with a neutral user-facing message (`"We couldn't validate the image right now — please try again in a moment."`). Phase 7 surfaces this as HTTP 503. The service throws a typed `PreScreenUnavailableError`. Rationale: ENHC-06 is a safety gate; fail-open would allow unvalidated content to reach the image model, violating the intent of the requirement.
- **D-06: `thought_signature` absent or multi-turn 400 → silent single-turn fallback with style drift accepted.** Extract `thoughtSignature` defensively (`imagePart?.thoughtSignature ?? null`). If null, or if the multi-turn request returns 400 with "thought signature" in the error body, fall back to single-turn with `shared_style` injected into the prompt plus slide 1 as bare `inlineData` reference. Log a `warn` server-side with the slide number and reason. If the fallback also fails for structural reasons (not content generation), the slide is counted as failed and the partial-success contract applies.
- **D-07: Pre-screen confidence gate — reject only on `"high"` or `"medium"` confidence.** Return `rejection_category: "none"` when the classifier reports `"low"` confidence, regardless of category. Rationale: prevents false positives on niche product photography where a person incidentally appears in the background. The image model's own safety filters handle genuinely harmful content downstream.
- **D-08: No retry on pre-screen result.** If the pre-screen returns a rejection, it's final — no "are you sure" second call, no reprompting. Users retry by uploading a different photo.

### Testing strategy

- **D-09: Continue the Phase 5 live-verifier pattern — `scripts/verify-phase-06.ts`.** Exercises each of the 7 ROADMAP success criteria against live Gemini (using an admin-tier API key stored in `.env` as `TEST_GEMINI_API_KEY` if present, else falls back to self-minting an admin-profile test user and reading their `profiles.api_key`). Script creates any necessary post rows in a separate schema or marks them with a test prefix; teardown removes them in `finally`. Exits 0 on full pass.
- **D-10: TypeScript compile (`npm run check`) is the per-commit gate.** Live verifier runs per-wave-merge and at phase close. No unit-test framework added in this phase — Vitest/Jest wiring would be scope creep and is not justified by the two new files.
- **D-11: Verifier must assert the billing multiplier end-to-end.** Specifically, invoke `checkCredits(testUserId, "generate", false, 5)` and assert `estimated_cost_micros` is exactly `5 × checkCredits(testUserId, "generate", false, undefined).estimated_cost_micros`. Regression protection for BILL-01 backwards compatibility.
- **D-12: Verifier covers the style-consistency technique but cannot assert visual coherence programmatically.** Instead it asserts: (a) exactly 1 call to the text model URL per carousel job, (b) exactly N calls to the image model URL per carousel job, (c) slides 2..N request bodies contain a `role: "model"` turn with an `inlineData` part whose `data` equals slide 1's base64. Visual-coherence QA is a human step during discuss-phase of Phase 9.

### Module shape & file layout

- **D-13: Single file per service.** `carousel-generation.service.ts` and `enhancement.service.ts` each live as a single module. Internal helpers (`preScreenUpload`, `normalizeForEnhancement`, slide-level `generateSlideOne`/`generateSlideNWithSignature`, `callCarouselTextPlan`) are non-exported functions in the same file. Public exports: `generateCarousel()`, `enhanceProductPhoto()`, plus type exports for params/result interfaces.
- **D-14: Mirror the existing `gemini.service.ts` / `image-generation.service.ts` shape exactly.** Raw `fetch` against `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with `x-goog-api-key` header — no SDK. Errors thrown as `Error` subclasses (typed `CarouselTextPlanError`, `SlideGenerationError`, `PreScreenUnavailableError`, `PreScreenRejectedError`, `EnhancementGenerationError`); callers catch by `instanceof`.
- **D-15: Progress-reporting hook is a callback parameter, not an imported SSE writer.** Each service function accepts an optional `onProgress?: (event: ProgressEvent) => void` callback. Phase 7 passes a callback that forwards to its `SSEWriter`. Services do not import `server/lib/sse.ts`. Keeps services testable in isolation and free of HTTP coupling.
  - Carousel progress events (emitted in order): `{ type: "text_plan_start" }`, `{ type: "text_plan_complete", captionPreview }`, per slide: `{ type: "slide_start", slideNumber }` → `{ type: "slide_complete", slideNumber, imageUrl }` OR `{ type: "slide_failed", slideNumber, reason }`, final `{ type: "complete", savedSlideCount, status: "completed" | "draft" }`.
  - Enhancement progress events: `{ type: "pre_screen_start" }` → `{ type: "pre_screen_passed" }` OR `{ type: "pre_screen_rejected", category }` (terminal), `{ type: "normalize_start" }` → `{ type: "normalize_complete" }`, `{ type: "enhance_start" }` → `{ type: "complete", imageBuffer }`.
- **D-16: Upload responsibility lives in the service, not the route.** Services call `uploadFile()` from `server/storage.ts` directly. Rationale: consistent with `image-generation.service.ts` → `generate.routes.ts` seam in v1.0 where upload happens in the service and the route receives a URL. Keeps route thin per research Pattern 1.
- **D-17: Post/post_slides DB writes live in the service.** `generateCarousel()` calls `createAdminSupabase()` and inserts the `posts` row + N `post_slides` rows in the same function. Mirrors the v1.0 `generateSinglePost` pattern where the service owns both generation and persistence. Route receives the saved `Post` object. Rationale: keeping persistence inside the service simplifies the partial-success atomic write (all N slides inserted or none, with status reflecting actual success count).

### Billing extension

- **D-18: `checkCredits` signature extension is strictly additive.** New parameter `slideCount?: number` is the fourth positional argument after the existing `isVideo?: boolean`. No breaking changes to callers in `generate.routes.ts`, `edit-post.routes.ts`, `transcribe.routes.ts`. Planner must grep for every `checkCredits(` call in the repo and confirm each remains callable with current arguments.
- **D-19: `slideCount` clamps to `Math.max(slideCount ?? 1, 1)` at the top of `checkCredits`.** No upper bound enforced in the billing layer — the 3–8 slide cap is a request-schema validation (already in `carouselRequestSchema` from Phase 5). Defense in depth: if a bug produces `slideCount = 0` or a negative, billing still charges 1× (neutral default) rather than throwing.
- **D-20: `checkCredits` does NOT know about carousel or enhancement semantically.** The `operationType` union (`"generate" | "edit" | "transcribe"`) is unchanged. Phase 7 routes pass `operationType: "generate"` for both carousel and enhancement, with `slideCount: N` for carousel and `slideCount: undefined` (→1) for enhancement. Keeps the billing surface stable and avoids a union-of-unions.
- **D-21: `recordUsageEvent` extension is Phase 7's job, not Phase 6's.** BILL-02 (one usage_events row per carousel, token totals summed) is wired at the route layer where the per-slide token counts are known. Phase 6 service returns token totals in its result object; Phase 7 aggregates and calls `recordUsageEvent` once.

### Claude's Discretion

- Exact error message strings (English only in this phase — CRTR-06 localization is Phase 9's job).
- Internal helper naming (keep verbs: `callCarouselTextPlan`, `generateSlideOne`, `generateSlideNWithSignature`, `runPreScreen`, `stripExifAndNormalize`).
- Internal `buildCarouselMasterPrompt()` / `buildEnhancementPrompt()` helpers for prompt assembly.
- Exact TypeScript typing of the error class hierarchy (stay consistent with existing `GeminiApiError` style in `gemini.service.ts`).
- Whether slide thumbnails use existing `processImageWithThumbnail()` defaults or a carousel-specific thumbnail size (planner picks; thumbnails themselves are a Phase 6 concern since they're co-written with the slide row).

### Folded Todos

None — no pending todos matched Phase 6 scope (`gsd-tools todo match-phase 6` returned zero matches on 2026-04-21).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements (authoritative scope)
- `.planning/ROADMAP.md` §"Phase 6: Server Services" — phase goal + 7 success criteria + 3 research flags
- `.planning/REQUIREMENTS.md` §"Carousel Generator (CRSL)" — CRSL-02, CRSL-03, CRSL-06, CRSL-09, CRSL-10 (this phase's CRSL requirements)
- `.planning/REQUIREMENTS.md` §"Image Enhancement (ENHC)" — ENHC-03, ENHC-04, ENHC-05, ENHC-06 (this phase's ENHC requirements)
- `.planning/REQUIREMENTS.md` §"Billing & Credits (BILL)" — BILL-01 (this phase); BILL-02/03/04 are Phase 7 consumers
- `.planning/REQUIREMENTS.md` §"v2 Requirements" — CRSL-V2-02 (slide cap >8 deferred), the 2-concurrent parallelism experiment is implicitly a v2 item per D-01

### Research (prescriptive patterns — READ IN FULL before planning)
- `.planning/phases/06-server-services/06-RESEARCH.md` — whole document. Critical sections: Pattern 4 (multi-turn thought_signature), Pattern 5 (pre-screen structured output + rejection taxonomy), Pattern 6 (EXIF strip + square normalize), Pattern 7 (checkCredits slideCount extension), Pitfalls 1–6, Timing Math, Open Questions
- `.planning/phases/05-schema-database-foundation/05-CONTEXT.md` §decisions D-06/D-07/D-09/D-21 — storage path layout, idempotency_key scope, enhanceRequestSchema shape (contract the service must honor)

### Existing code to mirror (patterns this phase extends)
- `server/services/gemini.service.ts` — raw-fetch pattern, JSON parsing, `GeminiApiError` style
- `server/services/image-generation.service.ts` §`generateImage`, §`editImage` — single-turn Gemini image call pattern; `inlineData` input convention
- `server/services/image-optimization.service.ts` §`processImageWithThumbnail`, §`optimizeImage` — sharp pipeline, WebP encode, thumbnail generation (reused for per-slide thumbnails)
- `server/services/caption-quality.service.ts` §`ensureCaptionQuality` — called once on the unified caption per CRSL-09; do NOT call inside the slide loop
- `server/quota.ts` §`checkCredits`, §`deductCredits`, §`recordUsageEvent` — extension target for BILL-01; note the `usesOwnApiKey` early-return pattern
- `server/storage.ts` §`uploadFile` — upload helper; services own upload per D-16
- `server/routes/generate.routes.ts` §safetyTimer (around line 329) — 260s AbortController pattern; Phase 7 attaches this, Phase 6 service checks `signal.aborted` between slides
- `shared/schema.ts` §`carouselRequestSchema`, §`enhanceRequestSchema`, §`postSlideSchema`, §`scenerySchema` — locked in Phase 5; Phase 6 consumes as input contracts

### External references (verified during research)
- `ai.google.dev/gemini-api/docs/thought-signatures` — canonical doc for `thoughtSignature` propagation in multi-turn Gemini 3.x image calls (Pattern 4)
- `ai.google.dev/gemini-api/docs/structured-output` — `responseSchema` + `responseMimeType: "application/json"` pattern (Pattern 5)
- `ai.google.dev/gemini-api/docs/image-generation` — official multi-turn image pattern
- `sharp.pixelplumbing.com/api-operation` — `autoOrient()` behavior (ENHC-03)
- `sharp.pixelplumbing.com/api-resize` — `resize` fit options (ENHC-05)

### Project guidance
- `CLAUDE.md` — architecture conventions, Zod single-source-of-truth, admin vs user Supabase client rule
- `.planning/PROJECT.md` — v1.1 constraints (English-only in Phase 6, admin Supabase client for service-side writes, storage layout)
- `.planning/STATE.md` — Phase 8 planner warning (scenery catalog is in `platform_settings.setting_value`, NOT `app_settings.style_catalog`). Phase 6 only reads scenery via `getStyleCatalogPayload()` through the normal cache path; it does not write to `platform_settings`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`createGeminiService()` in `server/services/gemini.service.ts`** — text-model caller with fallback to server `SUPPORTED_LANGUAGES` copy. Reused for the master carousel text call AND the pre-screen call (both use `gemini-2.5-flash`).
- **`generateImage(apiKey, params)` in `image-generation.service.ts`** — single-turn image call. Reused verbatim for slide 1 and as the fallback path for slides 2..N when `thought_signature` is absent.
- **`processImageWithThumbnail()` in `image-optimization.service.ts`** — WebP encoding + thumbnail generation. Reused for per-slide files and the enhancement result (already handles buffer → file pair).
- **`ensureCaptionQuality()` in `caption-quality.service.ts`** — unified caption quality check called exactly once in the carousel service per CRSL-09.
- **`uploadFile()` in `server/storage.ts`** — public-URL-returning upload. Services own upload per D-16.
- **`createAdminSupabase()` in `server/supabase.ts`** — admin client for `posts` + `post_slides` writes inside the service.

### Established Patterns
- **Raw Gemini fetch, no SDK:** Every existing service calls `fetch(generativelanguage.googleapis.com/v1beta/...)` directly. Phase 6 follows.
- **Typed error hierarchy:** `GeminiApiError extends Error` with a `status` number. New errors (`CarouselTextPlanError`, `SlideGenerationError`, `PreScreenUnavailableError`, `PreScreenRejectedError`, `EnhancementGenerationError`) follow the same shape.
- **Admin-client DB writes inside services:** `generate.routes.ts` → generation service writes `posts` row with admin client. Phase 6 D-17 mirrors this for carousel + enhancement.
- **Lowercase SQL DDL:** Phase 5 established this; Phase 6 touches no SQL (service-only phase).
- **English-only in services:** Localized strings (captions, user-facing errors) get localized copy via `getLocalizedCopy()` in `gemini.service.ts`; service error surface is English.

### Integration Points
- **`server/services/` directory** — two new files; no existing files modified.
- **`server/quota.ts` §`checkCredits`** — signature extended additively; callers in `generate.routes.ts`, `edit-post.routes.ts`, `transcribe.routes.ts` continue to work unchanged.
- **`shared/schema.ts`** — Phase 6 does not modify; reads `carouselRequestSchema`, `enhanceRequestSchema`, `postSlideSchema`, `scenerySchema` as input contracts.
- **`platform_settings.setting_value->'sceneries'`** — read path only (via `getStyleCatalogPayload()` cache); no writes from Phase 6.
- **`post_slides` table** — Phase 6 writes via admin client; Phase 5 migration established the schema + RLS.
- **`version_cleanup_log`** — not touched in Phase 6; Phase 5 triggers handle cleanup on post delete.

</code_context>

<specifics>
## Specific Ideas

- The research's `REJECTION_MESSAGES` map (research §Pattern 5) is the locked English copy for the four rejection categories. Use verbatim; Phase 9 i18n will translate.
- The `carouselMasterPrompt` shape in research §Code Examples is the locked structure. Planner may refine wording but must preserve the JSON schema (`shared_style`, `slides[]`, `caption`).
- The `enhancementPrompt` shape in research §Code Examples is the locked structure. "CRITICAL preservation rules" bullet list must appear in the final prompt.
- Per-slide storage path follows Phase 5 D-06 exactly: `user_assets/{userId}/carousel/{postId}/slide-{N}.webp` + `slide-{N}-thumb.webp`. Phase 6 service computes the path and calls `uploadFile()`.
- Enhancement result path follows Phase 5 D-07: `user_assets/{userId}/enhancement/{postId}.webp` for the result, `{postId}-source.webp` for the original. Both written in Phase 6 service (result after the Gemini call, source after EXIF strip but before normalization).
- Progress event vocabulary (D-15) is the contract Phase 7 consumes. Do not rename events without updating both phases.
- `carousel-generation.service.ts` and `enhancement.service.ts` are the exact filenames; referenced verbatim in ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

- **Controlled 2-concurrent slide parallelism** (CRSL-V2-02-adjacent) — evaluated in research, deferred per D-01. Add only after live quota data confirms sequential bottleneck. Track as v2 candidate.
- **Unit test framework (Vitest/Jest) wiring** — evaluated and rejected for this phase per D-10. Scope creep; no other phase needs it yet. Revisit at milestone close.
- **Per-slide regeneration API** (`CRSL-V2-01`) — requires persisting `shared_style` on the `posts` row or a new `carousel_metadata` column. Not in Phase 5 schema; v2 work.
- **Slide-level `enforceExactImageText`** (`CRSL-V2-04`) — explicitly excluded in v1.1 per CRSL-10. v2 work.
- **Free-text scenery modifier** (`ENHC-V2-01`) — deferred in Phase 5 D-21. Not addressable in this phase.
- **Multi-retry exponential backoff on 429** — evaluated and rejected for v1.1 per D-03. One retry is the predictability-vs-recovery tradeoff the partial-success contract was designed for.
- **Pre-screen model fallback cascade (try vision → try text-only classifier)** — evaluated and rejected per D-05. A single failure mode (fail-closed with neutral message) is simpler to reason about and the research flags this as the correct security posture.

### Reviewed Todos (not folded)

None.

</deferred>

---

*Phase: 06-server-services*
*Context gathered: 2026-04-21*
*All four gray areas delegated by user to recommended approach — review D-01..D-21 and push back on any that don't match intent.*
