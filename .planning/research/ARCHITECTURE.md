# Architecture Research — v1.6 OpenRouter Gateway + Deterministic Typography

**Domain:** Integration architecture for an existing AI social-content generation pipeline (brownfield)
**Researched:** 2026-07-18
**Confidence:** HIGH (all findings grounded in current repo code, cited by file/line; OpenRouter API capability claims verified via WebSearch against openrouter.ai/docs — MEDIUM confidence on OpenRouter specifics pending Context7/live API check during implementation)

## System Overview

### Current pipeline (as of v1.5, verified in code)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ server/routes/generate.routes.ts  (POST /api/generate, SSE)              │
│  auth → profile fetch → rate limit → validate → credit check             │
├──────────────────────────────────────────────────────────────────────────┤
│  Phase: text_generation                                                  │
│   gemini.service.ts::GeminiService.generateText()                        │
│     raw fetch → generativelanguage.googleapis.com (gemini-2.5-flash)     │
│     returns headline/subtext/image_prompt/caption/creative_plan          │
├──────────────────────────────────────────────────────────────────────────┤
│  Phase: image_generation                                                 │
│   image-provider.ts::getActiveImageProvider(profile) → ImageProvider     │
│     GeminiImageProvider  → image-generation.service.ts (raw fetch)       │
│     OpenAIImageProvider  → openai npm SDK (Responses API)                │
├──────────────────────────────────────────────────────────────────────────┤
│  Phase: text_verification (ONLY if text_mode === "exact")                │
│   text-rendering.service.ts::enforceExactImageText()                     │
│     verify (raw fetch, vision) → repair loop → editImage() up to 2x      │
├──────────────────────────────────────────────────────────────────────────┤
│  Phase: logo_overlay → optimization → upload                             │
│   image-optimization.service.ts (sharp: applyLogoOverlay,                │
│     processImageWithThumbnail → WebP)                                    │
├──────────────────────────────────────────────────────────────────────────┤
│  Phase: caption_quality                                                  │
│   caption-quality.service.ts::ensureCaptionQuality() — own raw fetch      │
├──────────────────────────────────────────────────────────────────────────┤
│  Phase: saving → recordUsageEvent/deductCredits (server/quota.ts)         │
└──────────────────────────────────────────────────────────────────────────┘

Parallel duplicate raw-fetch call sites (NOT unified today):
  - gemini.service.ts::generateText / generateCaptionOnly / generateImage(dead) / transcribeAudio(dead)
  - carousel-generation.service.ts::callCarouselTextPlan (own inline fetch, independent of gemini.service.ts)
  - caption-quality.service.ts (own inline fetch)
  - transcribe.routes.ts (own inline fetch, duplicates gemini.service.ts::transcribeAudio which is dead code)
  - image-generation.service.ts::generateImage/editImage (used by GeminiImageProvider)
  - image-provider.ts::OpenAIImageProvider (separate `openai` SDK client, Responses API)
```

**Five independent implementations of "call an LLM" exist in the codebase today** (`gemini.service.ts`, `carousel-generation.service.ts`, `caption-quality.service.ts`, `transcribe.routes.ts`, `text-rendering.service.ts`). This sprawl is itself a maintainability problem the gateway refactor fixes as a side effect, independent of the OpenRouter migration's stated goals.

### Target pipeline (v1.6)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ server/services/ai-gateway.service.ts   ← NEW, single OpenRouter client   │
│   chatCompletion({model, messages, response_format?, images?})           │
│     → POST https://openrouter.ai/api/v1/chat/completions                 │
│   generateImage/editImage({model, prompt, images?})                      │
│     → OpenRouter Unified Image API (chat completions w/ image modality,  │
│       or /v1/images/generations — confirm exact surface at impl time)    │
│   transcribeAudio({model, audio})                                        │
│     → POST https://openrouter.ai/api/v1/audio/transcriptions             │
│   Every call returns { ..., costUsdMicros } from response.usage.cost     │
├──────────────────────────────────────────────────────────────────────────┤
│ server/routes/generate.routes.ts — NEW phase order                       │
│  auth → text_generation (planning, refs attached, structured output)     │
│    → image_generation (text-FREE image, reserved negative space)         │
│    → visual_critic (score + re-roll loop)          ← NEW                 │
│    → crop_normalize (non-native aspect ratios)     ← NEW (pulled from P2)│
│    → typography (sharp/SVG compositor)             ← NEW, replaces       │
│         text-rendering.service.ts verify/repair loop entirely            │
│    → logo_overlay (existing, now runs AFTER typography)                  │
│    → optimization → upload                                               │
│    → caption_quality (via gateway, unchanged position)                   │
│    → saving (recordUsageEvent now carries real OpenRouter cost)          │
└──────────────────────────────────────────────────────────────────────────┘

Video: server/services/video-generation.service.ts UNCHANGED — stays on
direct Google Veo API (predictLongRunning). Not reachable via OpenRouter
(confirmed out of scope by PROJECT.md; Veo is not on OpenRouter's model list).
```

### Component Responsibilities (new/modified matrix)

| Component | Today | v1.6 | Status |
|-----------|-------|------|--------|
| `server/services/ai-gateway.service.ts` | — | Single OpenRouter HTTP client for text/image/transcription; returns real cost | **NEW** |
| `server/services/image-provider.ts` | `GeminiImageProvider` + `OpenAIImageProvider`, factory keyed on `profiles.image_provider` / `platform_settings.image_provider` | Collapses to one `OpenRouterImageProvider` wrapping the gateway; `ImageProvider` interface (generate/edit contract) **preserved** so all 6 call sites (generate/edit/carousel/carousel-slide-edit/enhancement routes) need zero shape changes | **MODIFIED** (collapse, not delete) |
| `server/services/gemini.service.ts` | Raw-fetch `GeminiService` class: `generateText`, `generateCaptionOnly`, `generateImage` (dead), `transcribeAudio` (dead) | Prompt-building methods (`buildContextPrompt`, `classifyScenario`, `buildDefaultCreativePlan`, etc.) are pure string/object builders — **keep as-is**. Only the network call inside `generateText`/`generateCaptionOnly` swaps to `aiGateway.chatCompletion()`. Dead `generateImage`/`transcribeAudio` methods deleted. | **MODIFIED** |
| `server/services/carousel-generation.service.ts` | Own inline fetch in `callCarouselTextPlan` | Swaps to `aiGateway.chatCompletion()`; master-plan JSON schema extended with per-slide `text_blocks` + layout archetype (reverses CRSL-10) | **MODIFIED** |
| `server/services/caption-quality.service.ts` | Own inline fetch | Swaps to `aiGateway.chatCompletion()` | **MODIFIED** |
| `server/routes/transcribe.routes.ts` | Own inline fetch (duplicates dead `GeminiService.transcribeAudio`) | Swaps to `aiGateway.transcribeAudio()`; dead duplicate code removed | **MODIFIED** |
| `server/services/text-rendering.service.ts` | `verifyExactImageText` + `enforceExactImageText` (AI-render verify/repair loop) | Deleted entirely — text is never AI-rendered pixels anymore | **DELETED** |
| `server/services/typography-compositor.service.ts` | — | sharp/SVG compositor: renders `text_blocks` (headline/support/cta) as real fonts onto reserved negative space | **NEW** |
| `server/services/visual-critic.service.ts` | — | Multimodal critic call via gateway; scores composition/legibility/color harmony/unwanted-text; triggers re-roll | **NEW** |
| `server/services/image-optimization.service.ts` | `applyLogoOverlay`, `processImageWithThumbnail` | Unchanged API; call **order** relative to typography changes (logo after typography) | **MODIFIED (call-site order only)** |
| `server/middleware/auth.middleware.ts` | `getGeminiApiKey`, `getOpenAIApiKey`, `usesOwnApiKey` | Replace two key-getters with one `getOpenRouterApiKey(profile)`; `usesOwnApiKey` (affiliate-bypass semantics) unchanged | **MODIFIED** |
| `server/quota.ts` | `calculateCostMicros` uses per-token-type rate tables from `platform_settings` (`token_pricing_*`, `*_fallback_pricing`) | `recordUsageEvent` accepts additive real-cost param from the gateway; markup applied via existing (currently unused for this purpose) `getMarkupMultiplier()` | **MODIFIED (additive)** |
| `server/services/enhancement.service.ts` / `enhance.routes.ts` | Uses `image-provider.ts` for gen/edit | Inherits the gateway/provider collapse only — **no typography stage** (explicitly out of scope per PROJECT.md) | **MODIFIED (minimal — key/provider plumbing only)** |
| `server/services/video-generation.service.ts` | Direct Google Veo `predictLongRunning` | Untouched — frozen | **UNCHANGED** |

## Recommended Project Structure (additions only)

```
server/
  services/
    ai-gateway.service.ts          # NEW — OpenRouter HTTP client (chat/image/transcription)
    typography-compositor.service.ts  # NEW — sharp/SVG deterministic text rendering
    visual-critic.service.ts       # NEW — multimodal quality gate + re-roll
    image-provider.ts              # MODIFIED — collapses to OpenRouterImageProvider
    gemini.service.ts              # MODIFIED — keep prompt builders, swap fetch→gateway
                                    #   (consider rename to planning.service.ts in a later
                                    #   cleanup pass — SEED-004 territory, not this milestone)
    carousel-generation.service.ts # MODIFIED — gateway call + per-slide text_blocks
    caption-quality.service.ts     # MODIFIED — gateway call
    text-rendering.service.ts      # DELETED
  assets/
    fonts/                         # NEW — bundled TTF/OTF files for SVG text rendering
                                    #   (Coolify/Hetzner Docker image must install these;
                                    #   sharp/librsvg resolves font-family via fontconfig,
                                    #   not arbitrary file paths — deploy-time dependency)
```

## Architectural Patterns

### Pattern 1: Gateway service, not a provider-per-vendor abstraction

**What:** Replace the `ImageProvider` vendor-selection abstraction (Gemini vs OpenAI) with a single gateway service where "which model" is a **parameter**, not a class hierarchy. OpenRouter itself already IS the multi-vendor abstraction (it fronts Gemini, GPT-Image, Flux, etc. behind one API) — building a second abstraction layer on top of it would be redundant.

**When to use:** Any of the 3 AI capability types (text/image/transcription).

**Trade-offs:** Keep the existing `ImageProvider` TypeScript *interface* (`generate()`/`edit()` returning `ImageProviderResult`) as the stable contract consumed by `carousel-generation.service.ts`, `edit.routes.ts`, `carousel.routes.ts` (slide edit), and `enhancement.service.ts` — this means **zero changes** to 4+ call sites. Only `image-provider.ts`'s internals change: one `OpenRouterImageProvider` class wraps `ai-gateway.service.ts`, `GeminiImageProvider`/`OpenAIImageProvider` are deleted, and `getActiveImageProvider()`/`resolveImageProviderName()` collapse to always return the OpenRouter provider (the "provider name" concept disappears; what remains is model *selection*, resolved from `styleCatalog.ai_models.image_generation`, which **already exists** as a model-string field — see below).

**Example:**
```typescript
// server/services/ai-gateway.service.ts
export async function chatCompletion(params: {
  apiKey: string;
  model: string;               // e.g. "google/gemini-2.5-flash"
  messages: OpenRouterMessage[];
  responseFormat?: { type: "json_schema"; json_schema: object };
  maxTokens?: number;
}): Promise<{ content: string; usage?: OpenRouterUsage; costUsdMicros?: number }> { /* ... */ }

export async function generateImage(params: {
  apiKey: string;
  model: string;               // e.g. "google/gemini-3-pro-image-preview"
  prompt: string;
  referenceImages?: ReferenceImage[];
}): Promise<ImageProviderResult & { costUsdMicros?: number }> { /* ... */ }
```

### Pattern 2: Model selection via existing `style_catalog.ai_models`, not a new config surface

**What:** `shared/schema.ts:179-185` already defines `aiModelsSchema` with `image_generation`, `text_generation`, `audio_transcription`, `video_generation` — free-text model-string fields, admin-editable, cached via `getStyleCatalogPayload()`. This is the natural home for OpenRouter model slugs (`"google/gemini-2.5-flash"`, `"openai/gpt-image-1"`, etc.) post-migration — just change the *values*, not the schema shape.

**When to use:** Selecting which OpenRouter-routed model runs each pipeline stage (planning call, image gen, critic, transcription). `video_generation` stays pointed at the direct Veo model string since video is frozen off the gateway.

**Trade-offs:** This sidesteps building new admin UI — the existing "AI Models" panel (wherever it edits `ai_models.*`) keeps working, just with different placeholder/default values. The **provider toggle** (`profiles.image_provider` / `platform_settings.image_provider`, gemini|openai enum) becomes redundant and should be retired — see Integration Points below for the exact migration.

### Pattern 3: Additive-parameter billing evolution (matches existing codebase convention)

**What:** The codebase already has a proven pattern for evolving billing functions without breaking callers: `checkCredits(userId, operationType, isVideo, slideCount?)` — `slideCount` was added as an optional 4th param in Phase 7 so all 5 existing call sites kept compiling (`server/quota.ts:353-361`, confirmed in Key Decisions table of PROJECT.md: *"checkCredits(slideCount?) additive optional param — Backwards-compat"*). Apply the same discipline to `recordUsageEvent`.

**When to use:** Adding real-cost passthrough from the gateway.

**Example:**
```typescript
// server/quota.ts — additive param, all 7 existing call sites (generate/edit/carousel/
// carousel-slide-edit/enhance/transcribe routes) keep compiling unmodified until migrated.
export async function recordUsageEvent(
  userId: string,
  postId: string | null,
  eventType: "generate" | "edit" | "transcribe",
  tokens?: UsageTokenData,
  models?: UsageModelData,
  realCostUsdMicros?: number,   // NEW — from OpenRouter usage.cost * 1_000_000
): Promise<RecordedUsageEvent> {
  const pricing = realCostUsdMicros != null
    ? { rawCostMicros: Math.round(realCostUsdMicros), chargedCostMicros: Math.round(realCostUsdMicros * await getMarkupMultiplier(userId)) }
    : tokens ? await calculateCostMicros(tokens, eventType, isVideo) : await getOperationFallbackCostMicros(eventType, isVideo);
  // ... unchanged insert logic
}
```

## Data Flow

### New SSE phase order (`server/routes/generate.routes.ts`, mirrored in `carousel-generation.service.ts`'s per-slide loop)

Today's phases (verified in code, `generate.routes.ts:363-812`): `auth (5%) → text_generation (15%) → image_generation (40%) → text_verification (65%, conditional) → logo_overlay (75%) → optimization (80%) → caption_quality (88%) → saving (95%)`.

**Recommended v1.6 order:**

```
auth
  → text_generation      (planning call: refs attached, structured output,
                           emits headline/subtext/caption/creative_plan
                           PLUS text_blocks[] + layout_archetype_id + reserved
                           negative-space rect — new structured_image_prompt fields)
  → image_generation     (image-provider.ts, prompt now instructs text-FREE
                           image with the reserved zone kept visually clean)
  → visual_critic        (NEW — gateway vision call scores composition/
                           legibility/color harmony/unwanted-text; re-roll
                           loop back to image_generation on low score,
                           bounded attempt count)
  → crop_normalize        (NEW, pulled forward from P2 "polish" bucket —
                           structurally belongs here: deterministic sharp
                           crop for non-native aspect ratios, must happen
                           BEFORE typography so text placement coordinates
                           are computed against final pixel dimensions)
  → typography           (NEW — sharp/SVG compositor renders text_blocks
                           using layout_archetype_id + font catalog;
                           REPLACES text_verification phase entirely —
                           text-rendering.service.ts deleted)
  → logo_overlay          (existing applyLogoOverlay — REORDERED to run
                           AFTER typography, so the logo is never occluded
                           by composited text; typography engine must be
                           aware of the logo's reserved corner to avoid
                           overlap when choosing layout_archetype_id)
  → optimization          (existing processImageWithThumbnail, WebP)
  → upload                (existing)
  → caption_quality       (existing ensureCaptionQuality, now via gateway —
                           unchanged position)
  → saving                (recordUsageEvent now receives real OpenRouter
                           cost from every phase, not token-table estimates)
```

`sse.sendProgress(phase, message, progress)` (`server/lib/sse.ts:10`) takes a **freeform string** `phase` — confirmed no enum/type constraint exists, so adding `visual_critic`/`crop_normalize`/`typography` phases requires zero changes to the SSE transport layer, only new call sites in the route.

### Data that must be persisted for edit/regenerate flows

Today, `edit.routes.ts:249` sets `currentMediaUrl = latestVersion?.image_url || post.image_url` — i.e., edits operate on the **final, fully-composited** image. This breaks once typography is deterministic: re-editing a flattened image means the AI edit call has to "see" baked-in text pixels it can't cleanly separate from the subject, and any repair would double-render text.

**Recommendation — persist a `base_image_url` distinct from `image_url`:**

| Field (new) | Table(s) | Purpose |
|---|---|---|
| `base_image_url` | `posts`, `post_versions`, `post_slides`, `post_slide_versions` | The text-free, pre-typography, pre-logo AI output. Edit/regenerate flows should call the image-edit model against **this**, then re-run crop→typography→logo→optimize, rather than against the flattened `image_url`. |
| `typography_meta` (JSONB) | `posts`, `post_versions`, `post_slides` | `{ layout_archetype_id, text_blocks: [{role, text, font_family, color, rect}], reserved_zone_rect }` — needed so a future "edit text only" action can re-composite without a new AI image call, and so carousel per-slide edits (`carousel.routes.ts` slide-edit endpoint) know what to preserve/regenerate. |
| `text_blocks` (request echo) | already exists in request schema (`shared/schema.ts:173-177`) | Confirm it is actually persisted on `posts`/`post_slides` today — if not, add it; the typography compositor needs the original role/text pairing, not just the flattened prompt string currently stored in `ai_prompt_used`. |

**Font asset gap (flagged, not yet solved):** `style_catalog.text_styles[].preview.font_family` (`shared/schema.ts:144-149`) currently holds CSS values like `var(--font-sans)` — a **browser preview hint only**, not a real font file reference usable by sharp/SVG server-side rendering (librsvg resolves `font-family` via fontconfig on the host, not arbitrary paths). This is a **new deploy-time dependency**: the Coolify/Hetzner Docker image must bundle actual TTF/OTF files and register them with fontconfig, and `text_styles` needs a new field mapping style IDs → real font-family names matching what's installed in the container. This should be scoped as an explicit task in the typography phase, not assumed to fall out of existing catalog data.

### Carousel-specific data flow change

`carousel-generation.service.ts:174` currently hardcodes `"No on-image text (CRSL-10: text rendering skipped for carousel in v1.1)"` into the master prompt, and the returned `CarouselTextPlan` shape (`shared_style`, `slides: [{slide_number, image_prompt}]`, `caption`) has **no per-slide text field**. The P1 pillar "Narrative carousels: per-slide composition variation + on-slide text via deterministic overlay" **reverses CRSL-10**. This requires:
- Extending `buildCarouselMasterPrompt()` / the JSON schema it requests to include per-slide `text_blocks` + a `layout_archetype_id`, mirroring `GeminiCreativePlan.structured_image_prompt.text_rendering` from the single-image path.
- Applying the typography compositor inside the `for` loop in `generateCarousel()` (`carousel-generation.service.ts:443-509`), after each slide's buffer is produced and before `uploadSlideBuffer()`.
- The carousel slide-edit endpoint (`carousel.routes.ts:848-850`, comment: *"enforceExactImageText is intentionally NOT called here... Carousel slides (v1.1) do not use on-image text rendering (CRSL-10)"*) will need updating once carousels carry text — this comment becomes stale and the slide-edit flow needs the same base-image/typography-recomposite treatment as single-image edits.

### Enhancement is explicitly excluded

`enhance.routes.ts` and `enhancement.service.ts` inherit **only** the provider/gateway plumbing swap (they already call `getActiveImageProvider()`/`getGeminiApiKey()`/`getOpenAIApiKey()` identically to the other routes — `enhance.routes.ts:284-296`). No typography stage, no visual critic wiring — PROJECT.md is explicit: *"Enhancement pipeline redesign — pre-screen/scenery flow stays as-is (only inherits the OpenRouter call layer)."*

## Anti-Patterns to Avoid

### Anti-Pattern 1: Building a second provider-abstraction layer on top of OpenRouter

**What people might do:** Keep `GeminiImageProvider`/`OpenAIImageProvider`-style per-vendor classes, adding an `OpenRouterProvider` as a third option alongside them, preserving the `image_provider` toggle's current gemini/openai enum semantics.
**Why it's wrong:** OpenRouter already is the multi-vendor router. A provider-class-per-vendor pattern on top of it is redundant indirection with no behavioral value — model choice becomes a runtime parameter, not a class hierarchy. It also perpetuates two separate BYO-key concepts (Gemini key vs OpenAI key) that no longer map to how the gateway authenticates (single OpenRouter key).
**Do this instead:** One `OpenRouterImageProvider` (and one gateway client for text/transcription), model selection via `style_catalog.ai_models.*` strings, single `openrouter_api_key` per profile/platform tier.

### Anti-Pattern 2: Editing the flattened (post-typography) image

**What people might do:** Keep `edit.routes.ts`'s current `currentMediaUrl = post.image_url` pattern unchanged, sending the AI edit model an image that already has composited text baked into pixels.
**Why it's wrong:** The AI edit model has no way to distinguish "text I should preserve/regenerate" from "subject I should preserve" once text is flattened into pixels — repair/edit passes risk double-text artifacts or corrupting the deterministic typography.
**Do this instead:** Persist `base_image_url` separately; edit flows operate on the base, then re-run crop→typography→logo→optimize deterministically after the AI edit call.

### Anti-Pattern 3: Big-bang key migration that locks out existing affiliates mid-generation

**What people might do:** Repoint `getGeminiApiKey`/`getOpenAIApiKey` at OpenRouter without warning, so an affiliate's stored Gemini key (`profiles.api_key`) silently fails against OpenRouter's auth (different key namespace entirely — an OpenRouter key is not a valid Gemini API key).
**Why it's wrong:** Affiliates configured `profiles.api_key`/`profiles.openai_api_key` under the Phase 12.3 tier model expecting it to keep working; a silent break produces confusing 401s deep in a generation SSE stream.
**Do this instead:** Additive column `profiles.openrouter_api_key` (new), additive `getOpenRouterApiKey(profile)` mirroring the existing `getGeminiApiKey`/`getOpenAIApiKey` error-message pattern (`auth.middleware.ts:244-267`, `:274-297`) — e.g. *"Affiliate accounts must configure their own OpenRouter API key in Settings before generating."* Old `api_key`/`openai_api_key` columns become dead but are NOT dropped this milestone (defer to SEED-004-style cleanup) — this matches the codebase's existing tolerance for staged deprecation (Phase 12.1→12.3 tier model evolved the same fields across three phases before finalizing).

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| OpenRouter — Chat Completions (`/api/v1/chat/completions`) | `ai-gateway.service.ts::chatCompletion()` — used for planning/art-director call, caption quality, carousel master-plan, visual critic | Supports `response_format: {type: "json_schema", json_schema: {...}}` for structured outputs (verified via WebSearch against openrouter.ai/docs/guides/features/structured-outputs) — replaces today's brittle "parse JSON out of markdown fences" pattern duplicated across `gemini.service.ts:655-669`, `carousel-generation.service.ts:179-198`. Fails hard if the chosen model doesn't support structured outputs — model selection for the planning call must be checked against OpenRouter's structured-output-capable model list. |
| OpenRouter — Unified Image API | `ai-gateway.service.ts::generateImage()/editImage()` | Launched as a dedicated surface per OpenRouter's own 2026 announcement; works through chat completions (image output modality) or an OpenAI-compatible `/v1/images/generations`-style endpoint — **confirm the exact request shape via Context7/live docs at implementation time**, this research used WebSearch only (MEDIUM confidence on exact request/response shape, HIGH confidence the capability exists). Reference-image / editing support varies per underlying model — OpenRouter's model catalog metadata should be checked per model, not assumed uniform. |
| OpenRouter — Audio Transcriptions (`/api/v1/audio/transcriptions`) | `ai-gateway.service.ts::transcribeAudio()` | Dedicated endpoint confirmed via WebSearch (openrouter.ai/docs/api/api-reference/transcriptions). Replaces `transcribe.routes.ts`'s inline raw fetch and the dead `GeminiService.transcribeAudio` method. |
| OpenRouter — Usage Accounting | `usage.cost` field returned inline on every response | Confirmed: real per-request USD cost is now **always** included automatically (the `include: true` usage flag is deprecated/no-op as of the current docs) — no extra API call needed. This is the real-cost source for `recordUsageEvent`'s new additive param. |
| Google Veo (direct, unchanged) | `video-generation.service.ts` — `predictLongRunning` | Frozen this milestone; NOT reachable via OpenRouter (not in its model catalog) — confirms PROJECT.md's explicit freeze decision is technically forced, not just a scoping choice. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Routes ↔ `ai-gateway.service.ts` | Never called directly by routes — always through an intermediate service (`gemini.service.ts` for planning, `image-provider.ts` for image gen/edit, `caption-quality.service.ts`, `carousel-generation.service.ts`) | Matches the existing D-15 seam already established in v1.1 (*"services own SSE-free logic, routes own SSE streaming"* — PROJECT.md Key Decisions). The gateway is a NEW lowest layer under those existing services, not a replacement for the services-own-business-logic pattern. |
| `image-provider.ts` ↔ 6 call sites | `ImageProvider.generate()/edit()` interface, **unchanged shape** | `carousel-generation.service.ts`, `edit.routes.ts`, `carousel.routes.ts` (slide edit), `enhancement.service.ts`, `generate.routes.ts` all call through this interface today — collapsing the two provider classes to one is invisible to all of them. |
| `quota.ts` ↔ route billing call sites | `recordUsageEvent(..., realCostUsdMicros?)` additive param | 7 call sites (`generate.routes.ts:755`, `edit.routes.ts:549`, `carousel.routes.ts:470` + `:967`, `enhance.routes.ts:404`, `transcribe.routes.ts:174`) — all keep compiling unmodified during a phased cutover; migrate one route at a time if desired, or all at once since it's a single-team pre-launch-of-feature codebase. |
| `auth.middleware.ts` key resolution ↔ 5 route files | New `getOpenRouterApiKey(profile)` replaces `getGeminiApiKey`+`getOpenAIApiKey` pair | `generate.routes.ts`, `edit.routes.ts`, `carousel.routes.ts` (both endpoints), `enhance.routes.ts`, `transcribe.routes.ts` all currently fetch `is_admin, is_affiliate, api_key, openai_api_key, image_provider` from `profiles` and call both key-getters in near-identical blocks — good opportunity to also introduce one shared `resolveGenerationContext(profile)` helper reducing this duplication, though that refactor is optional/SEED-004-adjacent, not required for the milestone. |

## Build Order (dependency-driven, for roadmapper phase derivation)

**Dependency chain:** Everything depends on the gateway existing (structured outputs feed typography's `text_blocks`; real cost feeds billing; vision calls feed the critic). Typography's *rendering engine* (sharp/SVG mechanics, font loading, layout archetypes) has no AI dependency and can be built standalone. Visual critic depends on the gateway only, not on typography.

1. **Phase A — OpenRouter Gateway Foundation** (blocks everything else)
   - `ai-gateway.service.ts` (chat completions + structured outputs, image gen/edit, transcription)
   - Key/model migration: new `profiles.openrouter_api_key` + `platform_settings.openrouter_api_key` columns, `getOpenRouterApiKey()`, deprecate `getGeminiApiKey`/`getOpenAIApiKey`/`profiles.image_provider` enum
   - Collapse `image-provider.ts` to `OpenRouterImageProvider`; retire `GeminiImageProvider`/`OpenAIImageProvider`
   - Migrate all 5 scattered raw-fetch call sites (`gemini.service.ts`, `carousel-generation.service.ts`, `caption-quality.service.ts`, `transcribe.routes.ts`, dead code removal) to the gateway
   - Art-director planning call upgrade rides along here (same call surface): attach refs, `json_schema` structured output, higher-tier model, output-token budget scaled to slide count
   - Wire real `usage.cost` into `recordUsageEvent` as the additive param; retire `token_pricing_*`/`image_fallback_pricing` settings (keep `video_fallback_pricing` — video stays off-gateway)
   - Surgical fixes (carousel slide-1 `break`, `isVideo` billing-gate) ride along — trivial, low-risk, same files
   - **Rationale:** nothing else can be verified end-to-end without this landing first; also the highest-risk item (external API migration, key rotation) so it should be validated in isolation before layering pipeline changes on top.

2. **Phase B — Deterministic Typography Compositor** (depends on A's planning-call schema + gateway image calls)
   - sharp/SVG rendering engine + font asset bundling (Docker image change) + layout archetype system — **the rendering mechanics themselves can be prototyped in parallel with Phase A** since they don't need a live gateway call to unit-test against a fixture image
   - End-to-end wiring requires Phase A: planning call must emit `text_blocks`/`layout_archetype_id`/reserved-negative-space before the compositor has real input
   - New phase order in `generate.routes.ts` (crop_normalize pulled forward from P2, typography replaces text_verification, logo_overlay reordered after)
   - Schema/DB additions: `base_image_url`, `typography_meta` on posts/versions/slides/slide-versions
   - Apply to carousel per-slide flow (reverses CRSL-10) — carousel master-plan schema extension
   - Edit-flow rework: `edit.routes.ts`/carousel slide-edit operate on `base_image_url`, re-run typography after AI edit

3. **Phase C — Visual Critic + Re-roll** (depends on A only; can be built in parallel with B by a separate workstream, though sequencing after B reduces simultaneous-change risk in `generate.routes.ts`)
   - Gateway vision call scoring composition/legibility/color harmony/unwanted-text
   - Re-roll loop back to image_generation with bounded attempts
   - Runs on the AI-generated base image, BEFORE typography compositing (cheaper failure loop — no point compositing text onto an image about to be discarded)

4. **Phase D — Aesthetic DNA / Narrative Carousels** (depends on B for on-slide text; independent of C)
   - Style catalog upgrade (dense art direction, 60-30-10 palette, negative prompts)
   - Per-slide composition variation
   - Platform-curated style reference boards

5. **Phase E — Polish & Hygiene (P2, minus crop_normalize which moved to B)**
   - WebP q85+, logo contrast treatment (plate/shadow, adaptive corner)
   - API keys via headers only
   - Thumbs up/down feedback loop

## Sources

- Codebase (primary source, HIGH confidence): `server/services/image-provider.ts`, `server/services/gemini.service.ts`, `server/routes/generate.routes.ts`, `server/services/carousel-generation.service.ts`, `server/quota.ts`, `server/middleware/auth.middleware.ts`, `server/services/image-generation.service.ts`, `server/services/image-optimization.service.ts`, `server/services/text-rendering.service.ts`, `server/routes/edit.routes.ts`, `server/routes/enhance.routes.ts`, `server/routes/carousel.routes.ts`, `server/routes/transcribe.routes.ts`, `server/services/app-settings.service.ts`, `server/services/caption-quality.service.ts`, `server/lib/sse.ts`, `shared/schema.ts`, `.planning/PROJECT.md`
- [OpenRouter Image Generation — Complete Documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) — MEDIUM confidence, WebSearch-derived, verify exact request shape via Context7/live docs at implementation time
- [Introducing the Unified Image API — OpenRouter Blog](https://openrouter.ai/blog/announcements/image-api/)
- [OpenRouter Structured Outputs Guide](https://openrouter.ai/docs/guides/features/structured-outputs) — MEDIUM confidence
- [OpenRouter Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) — MEDIUM confidence, `usage.cost` field behavior
- [OpenRouter Speech-to-Text / Audio APIs](https://openrouter.ai/docs/guides/overview/multimodal/stt), [Create transcription](https://openrouter.ai/docs/api/api-reference/transcriptions/create-audio-transcriptions) — MEDIUM confidence

---
*Architecture research for: Xareable v1.6 OpenRouter Gateway + Deterministic Typography integration*
*Researched: 2026-07-18*
