---
phase: 21-openrouter-gateway-foundation
plan: 05
subsystem: api
tags: [openrouter, image-generation, gateway, adapter, fetch]

# Dependency graph
requires:
  - phase: 21-openrouter-gateway-foundation (21-03, 21-04)
    provides: ai-gateway-settings.service.ts (getFallbackChain/getCallRouting), ai-gateway.service.ts (OPENROUTER_ATTRIBUTION_HEADERS, callWithFallback, normalizeOpenRouterModelSlug)
provides:
  - "generateImage()/editImage() in ai-gateway.service.ts targeting POST https://openrouter.ai/api/v1/images with top-level aspect_ratio/resolution and nested input_references"
  - "toOpenRouterInputReference() adapter converting { mimeType, data } to OpenRouter's { type: image_url, image_url: { url } } content block"
  - "OpenRouterImageProvider implementing the existing ImageProvider interface via gateway delegation, using the platform OPENROUTER_API_KEY"
  - "ImageProviderResult.costUsdMicros (additive optional field, populated on the OpenRouter path only)"
  - "scripts/test-openrouter-image-adapter.ts — no-network functional test guarding the input_references shape"
affects: [21-06-openrouter-gateway-foundation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dedicated-API raw fetch: OpenRouter's Image API is unreachable via the openai SDK (chat-completions only), so image calls use native fetch() while text/transcription reuse the SDK client"
    - "Same-endpoint generate/edit: OpenRouter has no separate image edit path — editImage() prepends currentImage to input_references and delegates to generateImage()"
    - "Thin-wrapper provider: OpenRouterImageProvider mirrors GeminiImageProvider's delegation pattern, keeping ImageProvider a stable interface across 3 backends now (gemini/openai/openrouter)"

key-files:
  created:
    - scripts/test-openrouter-image-adapter.ts
  modified:
    - server/services/ai-gateway.service.ts
    - server/services/image-provider.ts

key-decisions:
  - "No circular-import issue arose — image-provider.ts imports runtime functions from ai-gateway.service.ts; ai-gateway.service.ts does not import from image-provider.ts (a self-contained GatewayReferenceImage type was defined locally instead, per the plan's fallback instruction)"
  - "DEFAULT_OPENROUTER_IMAGE_MODEL (\"google/gemini-3.1-flash-image\") only covers call sites that omit model — real model always arrives via input.model from the admin-configurable style_catalog.ai_models.image_generation"
  - "Factory (getActiveImageProvider/resolveImageProviderName/ImageProviderName) deliberately left untouched — still returns gemini/openai only; 21-06 owns rewiring it to return OpenRouterImageProvider"

patterns-established:
  - "Image API raw-fetch error message includes the raw HTTP status code so callWithFallback's /404|410|5\\d\\d|model_not_found/ regex can trigger fallback for image calls the same way it does for text/transcription"

requirements-completed: [GATE-02]

# Metrics
duration: 3min
completed: 2026-07-27
---

# Phase 21 Plan 05: OpenRouter Image Gateway + Adapter Test Summary

**Raw-fetch generateImage()/editImage() against OpenRouter's dedicated Image API, an OpenRouterImageProvider thin wrapper preserving the existing ImageProvider interface, and a no-network functional test proving the input_references reference-image adapter shape.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-27T14:06:03Z
- **Completed:** 2026-07-27T14:08:38Z
- **Tasks:** 3
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments

- Implemented `toOpenRouterInputReference()`, `generateImage()`, and `editImage()` in `ai-gateway.service.ts` against the live-verified Image API contract: top-level `aspect_ratio`/`resolution`, nested `input_references` content blocks, and `data[0].b64_json` / `usage.cost` response parsing.
- Added `OpenRouterImageProvider` to `image-provider.ts`, implementing the untouched `ImageProvider` interface via delegation to the gateway functions, using the platform `OPENROUTER_API_KEY` (not `input.apiKey`).
- Extended `ImageProviderResult` additively with `costUsdMicros?: number` and widened `ImageProvider.name` to `"gemini" | "openai" | "openrouter"` — both non-breaking to the 6 existing call sites.
- Created `scripts/test-openrouter-image-adapter.ts`, a no-network functional test proving the adapter produces the correct nested content-block shape (not a bare string, not the flat OpenAI Responses-API shape) — closing the "silent reference-less generation" pitfall flagged in 21-RESEARCH.md before any call site is switched over.

## Task Commits

Each task was committed atomically:

1. **Task 1: ai-gateway.service.ts — toOpenRouterInputReference adapter + generateImage/editImage** - `3c85b34` (feat)
2. **Task 2: image-provider.ts — OpenRouterImageProvider + additive costUsdMicros** - `a84671d` (feat)
3. **Task 3: scripts/test-openrouter-image-adapter.ts — no-network functional adapter test** - `af83ccf` (test)

**Plan metadata:** (this commit) `docs(21-05): complete OpenRouter image gateway plan`

## Files Created/Modified

- `server/services/ai-gateway.service.ts` - Appended `toOpenRouterInputReference`, `GatewayReferenceImage`/`GatewayImageParams`/`GatewayImageResult` types, `callImageApi`, `generateImage`, `editImage`
- `server/services/image-provider.ts` - Added `costUsdMicros?` to `ImageProviderResult`, widened `ImageProvider.name` union, added `OpenRouterImageProvider` class (factory untouched)
- `scripts/test-openrouter-image-adapter.ts` - New no-network functional test (3 assertions, mirrors `test-openai-converter.ts` pattern)

## Decisions Made

- No circular-import issue occurred in practice: `image-provider.ts` imports the runtime `generateImage`/`editImage` functions from `ai-gateway.service.ts`, and `ai-gateway.service.ts` has zero imports back from `image-provider.ts` — it defines its own structurally-identical `GatewayReferenceImage` type locally instead of importing `ReferenceImage`, exactly as the plan's contingency instructed.
- Kept `DEFAULT_OPENROUTER_IMAGE_MODEL` as a defensive fallback only; the real model always flows through `input.model` (admin-configurable via `style_catalog.ai_models.image_generation`), preserving GATE-04's "no hardcoded slugs" intent.
- Left the provider factory (`getActiveImageProvider`, `resolveImageProviderName`, `ImageProviderName`) completely unchanged, per the plan's explicit instruction — 21-06 owns rewiring it to return `OpenRouterImageProvider`.

## Deviations from Plan

None - plan executed exactly as written. All acceptance-criteria greps and `npm run check` passed on the first attempt for all three tasks; the adapter test script ran cleanly with no import-time environment issues (no refactor to a dependency-free position was needed).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. `config.OPENROUTER_API_KEY` was already validated by 21-03/21-04; `OpenRouterImageProvider.requireOpenRouterKey()` throws a clear runtime error if it's unset, but no new env var was introduced by this plan.

## Next Phase Readiness

- `generateImage`/`editImage`/`toOpenRouterInputReference` are ready for 21-06 to wire the factory (`getActiveImageProvider`) to return `OpenRouterImageProvider` when `ai_gateway_routing.image === "openrouter"`.
- The adapter test (`scripts/test-openrouter-image-adapter.ts`) is available for `scripts/verify-phase-21.ts` to reference once 21-13 wires the GATE-02 static check for real.
- No call-site behavior has changed — `npx tsx scripts/verify-phase-21.ts` still exits 1 with the same 9 expected stub failures (GATE-02 among them, annotated "implemented in 21-05/21-06") and the same 3 GATE-08 passes (video freeze untouched), confirming this plan's "no blast radius beyond its own files" claim.

## Self-Check: PASSED

- FOUND: server/services/ai-gateway.service.ts
- FOUND: server/services/image-provider.ts
- FOUND: scripts/test-openrouter-image-adapter.ts
- FOUND: 3c85b34 (Task 1 commit)
- FOUND: a84671d (Task 2 commit)
- FOUND: af83ccf (Task 3 commit)

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*
