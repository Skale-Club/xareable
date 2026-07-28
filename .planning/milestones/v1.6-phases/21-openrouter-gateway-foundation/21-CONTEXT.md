# Phase 21: OpenRouter Gateway Foundation - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Mode:** Smart discuss — autonomous run; recommended answers auto-accepted per owner's standing "faça tudo autônomo" directive. Grounded in `.planning/research/` (STACK/ARCHITECTURE/PITFALLS) and the 2026-07-18 deep pipeline analysis session.

<domain>
## Phase Boundary

All platform AI calls (text/planning, image generation+editing, transcription) run through ONE OpenRouter gateway service with admin-configurable model slugs, per-call-class fallback chains, real per-request cost flowing into billing, and an emergency per-call-class rollback to the direct Gemini path. Video is completely untouched (FROZEN — GATE-08 smoke test guards it). Two trivial production-bug fixes ride along (POL-01 isVideo credit gate, CRSL2-03 carousel slide-1 break) plus POL-07 (no API keys in query strings).

NOT in this phase: affiliate BYOK migration (21.1), planning-call content upgrades (22), typography (23), critic (24), any prompt-content changes.

</domain>

<decisions>
## Implementation Decisions

### Gateway service shape
- New `server/services/ai-gateway.service.ts` exposing three call classes: `chatCompletion()` (planning, captions, caption-quality, pre-screen), image `generate()`/`edit()`, and `transcribe()`.
- Chat + transcription use the existing `openai` npm SDK with `baseURL: "https://openrouter.ai/api/v1"` (STACK.md confirmed). Image calls use **raw `fetch` against OpenRouter's dedicated Image API (`POST /api/v1/images`)** — the SDK cannot reach it; pass top-level `aspect_ratio` and `resolution` params natively.
- The `ImageProvider.generate()/edit()` interface in `server/services/image-provider.ts` is PRESERVED — a new `OpenRouterImageProvider` implements it by delegating to the gateway. The existing `GeminiImageProvider` stays alive as the rollback target (GATE-07). `OpenAIImageProvider` may be deleted (retired by GATE-04) once rollback only targets direct Gemini.
- The 5 raw-fetch Gemini call sites (`gemini.service.ts` text call, `carousel-generation.service.ts` master plan, `caption-quality.service.ts`, `enhancement.service.ts` pre-screen+caption, `transcribe.routes.ts`) all migrate to the gateway's `chatCompletion()`/`transcribe()`. Verify-phase script asserts zero remaining `generativelanguage.googleapis.com` fetches outside video-generation.service.ts and the legacy rollback path.

### Routing + emergency rollback (GATE-07)
- New `platform_settings` row `ai_gateway_routing`: `{ "planning": "openrouter"|"direct", "image": "openrouter"|"direct", "transcription": "openrouter"|"direct" }`, default `"openrouter"`. Read per request (no restart), same cached-settings pattern as `getPlatformSetting`.
- `"direct"` routes to the retained legacy Gemini code path (header-auth version). This is how rollback survives the retirement of the old gemini/openai `image_provider` toggle (GATE-04) — they are orthogonal controls.

### Model slugs + fallback chains (GATE-04)
- Primary slugs live in the EXISTING `style_catalog.ai_models` fields (values become OpenRouter slugs, e.g. `google/gemini-2.5-flash`, `google/gemini-3.1-flash-image`). No new config surface for primaries.
- New `platform_settings` row `ai_model_fallbacks`: `{ "text": [slug,...], "image": [...], "transcription": [...] }` — one ordered chain per call class.
- Fallback triggers: OpenRouter 404 / `model_not_found` / 410 on the slug, and 5xx/502 upstream errors. One pass through the chain, first success wins. Every fallback engagement logged to `generation_logs` (event_kind `model_fallback`, metadata: from-slug, to-slug, reason) — satisfies Phase 21 SC3.
- `profiles.image_provider` + `platform_settings.image_provider` toggle retired: resolution function returns OpenRouter path unconditionally (except `ai_gateway_routing` overrides). Columns retained dead (additive precedent from Phase 12.1→12.3).

### Billing with real cost (GATE-05)
- `recordUsageEvent` gains an ADDITIVE optional param (mirrors `checkCredits(slideCount?)` convention): `realCostUsdMicros?: number`. When present: `cost_usd_micros = realCostUsdMicros`, `charged_amount_micros = realCostUsdMicros × getMarkupMultiplier()` (existing underused helper).
- OpenRouter returns `usage.cost` (USD float) by default on every response — convert `Math.round(cost × 1_000_000)` to micros. The Image API response's cost field is confirmed at implementation time (research gap #1 — live check during plan research).
- Pre-call estimate path (`checkCredits`/`estimateBaseCostMicros`) UNCHANGED this phase. Both the pre-call estimate AND post-call actual are stored in the usage event metadata JSON (SC4). Static token tables remain as fallback when `usage.cost` is absent, and for video (off-gateway).

### Keys + env (platform scope only)
- New env `OPENROUTER_API_KEY` added to `server/config/index.ts` Zod schema. Platform-wide key this phase; affiliate BYOK is Phase 21.1 (GATE-06) — `getGeminiApiKey`-style resolution for OpenRouter keys lands there, this phase uses the platform key for all gateway traffic and BYO affiliates temporarily continue on the legacy direct path via `ai_gateway_routing` if needed (documented operator note).
- POL-07: eliminate ALL `?key=` query strings — the retained direct-Gemini legacy paths in `gemini.service.ts` / `caption-quality.service.ts` / `text-rendering.service.ts` switch to the `x-goog-api-key` header (pattern already used in `image-generation.service.ts`). OpenRouter uses `Authorization: Bearer`.
- Include OpenRouter attribution headers (`HTTP-Referer: https://xareable.com`, `X-Title: Xareable`) on gateway calls.

### Ride-along production fixes
- CRSL2-03: in `carousel-generation.service.ts` slide loop — if slide 1 fails, `break` immediately (no doomed slides 2..N calls with null base64).
- POL-01: in `edit.routes.ts` — `checkCredits(user.id, "edit", post.content_type === "video")` so the estimate matches the real flat video charge.

### Video freeze guard (GATE-08)
- `scripts/verify-phase-21.ts` static harness: (a) `video-generation.service.ts` has zero OpenRouter imports/references and still targets `generativelanguage.googleapis.com`; (b) no `?key=` query strings anywhere in server/; (c) gateway file exists with the three call classes; (d) fallback chain config read path exists; (e) `recordUsageEvent` signature includes the additive real-cost param. Live video smoke test gated behind env flag (paid API) — optional, not CI-blocking.

### Claude's Discretion
- Exact error-normalization shape of gateway errors; per-call timeouts via AbortSignal (suggest ~60s text / ~150s image, tuned during implementation); retry-on-429 semantics (keep existing single-retry patterns); file/module internal naming; whether `OpenAIImageProvider` is deleted now or in Phase 26 cleanup.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `openai` npm package already installed (Phase 12) — reuse with baseURL for OpenRouter chat/transcription.
- `getPlatformSetting`/settings cache in `server/services/app-settings.service.ts` + `server/quota.ts` — reuse for `ai_gateway_routing` and `ai_model_fallbacks`.
- `getMarkupMultiplier()` in quota.ts — defined, underused; becomes the real-cost markup path.
- `generation_logs` + `observability.service.ts` best-effort emitters — pattern for `model_fallback` events.
- `scripts/verify-phase-*.ts` harness pattern (Phases 13-20) for the GATE-08/POL-07 static checks.

### Established Patterns
- Additive param convention: `checkCredits(slideCount?)` (Phase 6) — model for `recordUsageEvent(realCostUsdMicros?)`.
- Staged deprecation: Phase 12.1→12.3 left old key columns dead-but-present — model for retiring `image_provider` toggle.
- SSE routes call services via injected provider (`getActiveImageProvider(profile)`) — swap internals, keep call sites.

### Integration Points
- 5 raw-fetch text call sites: `server/services/gemini.service.ts:653+`, `carousel-generation.service.ts:244`, `caption-quality.service.ts:65`, `enhancement.service.ts:177,383`, `server/routes/transcribe.routes.ts`.
- 6 ImageProvider call sites: generate.routes.ts, edit.routes.ts, carousel.routes.ts (x2), carousel-generation.service.ts, enhancement.service.ts.
- Billing chain: `server/quota.ts` recordUsageEvent (~line 570-600), checkCredits, deductCredits — invariant preserved.
- Key middleware: `server/middleware/auth.middleware.ts` (getGeminiApiKey/getOpenAIApiKey/usesOwnApiKey) — touched minimally this phase (platform key only), extended in 21.1.
- Env config: `server/config/index.ts` Zod schema.

</code_context>

<specifics>
## Specific Ideas

- Owner's model rule for agent work: Fable orchestrates, Opus validates, Sonnet executes, Haiku for simple tasks.
- Owner priority: output quality is the product's reason to exist — the gateway is the foundation, not the goal; do not regress image quality vs the direct path (aspect_ratio/resolution parity via the Image API is mandatory, verified live during plan research).
- Production is Coolify/Hetzner long-running container (xareable.com) — no serverless constraints, but SSE timers exist and are re-derived in Phase 24, NOT here.
- `commit_docs=false` — planning docs are not committed by gsd tooling; code commits follow normal conventions.

</specifics>

<deferred>
## Deferred Ideas

- Affiliate BYOK provisioning/rotation + billing attribution → Phase 21.1 (GATE-06).
- Planning-call content upgrades (refs attached, json_schema, prompt precedence) → Phase 22.
- SSE timer re-derivation + AbortSignal cancellation → Phase 24 (CRIT-04).
- Any prompt-content or style-catalog changes → Phases 22/25.
- Deleting dead legacy code paths → Phase 26 or later cleanup (keep rollback viable first).

</deferred>
