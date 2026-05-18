# Phase 12: Image Provider Abstraction - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning
**Source:** Direct user request + codebase analysis

<domain>
## Phase Boundary

Introduce a runtime-switchable image-provider abstraction so the system can use either Gemini (current `gemini-3.1-flash-image-preview`) or OpenAI (`gpt-image-2` via Responses API) for ALL image-generation flows: single-post generate, edit-post, carousel slides, product enhancement. Provider selection is a global admin setting stored in `platform_settings`, NOT per-user, NOT per-request. Gemini stays the default.

This phase is a refactor + provider addition, not a UX expansion. End users see no new screens beyond the admin toggle.
</domain>

<decisions>
## Implementation Decisions

### Locked

- **Provider abstraction location:** `server/services/image-provider.ts` (new file) — exports `ImageProvider` interface, `GeminiImageProvider` class, `OpenAIImageProvider` class, and `getActiveImageProvider()` factory
- **Default provider:** `gemini` — byte-identical behavior vs. pre-Phase 12 when default is in effect
- **OpenAI API surface:** Responses API with `tools: [{type: "image_generation"}]` and model `gpt-5.5` (or current mainline that supports `image_generation` tool) — NOT the legacy `/v1/images/generations` endpoint, because Responses API supports multi-image references needed for carousel style consistency and edit-post reference
- **OpenAI image model parameter:** Inside the `image_generation` tool, target `gpt-image-2` quality presets (`low` / `medium` / `high` → maps to existing `quality` setting)
- **Reference image conversion:** Centralized in `image-provider.ts` — Gemini uses `inlineData: {mimeType, data}`, OpenAI uses `{type: "input_image", image_url: "data:{mime};base64,{data}"}` or `file_id`. Convert at provider boundary; callers pass a canonical `{mimeType, data}` shape.
- **API key resolution:** `OPENAI_API_KEY` env var for regular users; `profiles.openai_api_key` column (new) for admin/affiliate users. Mirrors existing `GEMINI_API_KEY` + `profiles.api_key` pattern. Resolution in `auth.middleware.ts`.
- **Setting storage:** Single row in `platform_settings` with `setting_key = 'image_provider'`, `setting_value = 'gemini' | 'openai'`. Use existing `getPlatformSetting`/`setPlatformSetting` helpers.
- **Admin UI placement:** New section "AI Image Provider" inside existing `/admin` page (do NOT create a new admin sub-route)
- **No new dialog files:** Provider abstraction is server-side only; client carries on calling existing endpoints with no awareness of which provider executed.

### Claude's Discretion

- Internal types/shape of `ImageProvider` interface — pick the cleanest TypeScript shape
- Whether to keep `image-generation.service.ts` and just have `GeminiImageProvider` import it as a thin wrapper, OR move logic into the provider class
- Error mapping: how OpenAI's error shape (`error.code`, `error.message`) maps to Gemini's existing error handling
- Specifics of admin UI styling (use existing shadcn/ui patterns from settings page)
- Cost/credit handling: if OpenAI cost differs from Gemini, surface this in admin UI as informational text (the credit-multiplier change is OUT OF SCOPE for this phase)
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Image generation (current Gemini implementation)
- `server/services/image-generation.service.ts` — `generateImage()` + `editImage()` direct Gemini fetch calls
- `server/services/carousel-generation.service.ts` — master text plan + per-slide image generation (lines 23–24 hardcode `IMAGE_MODEL`)
- `server/services/enhancement.service.ts` — pre-screen + enhancement edit call (lines 19–20 hardcode constants)
- `server/services/gemini.service.ts` — text generation wrapper (NOT touched by this phase; only image flows change)

### Routes that invoke image services
- `server/routes/generate.routes.ts` — POST /api/generate
- `server/routes/edit.routes.ts` — POST /api/edit-post
- `server/routes/carousel.routes.ts` — POST /api/carousel/generate
- `server/routes/enhance.routes.ts` — POST /api/enhance

### Existing platform settings + admin patterns
- `server/services/app-settings.service.ts` — `getPlatformSetting()` / `setPlatformSetting()` (existing pattern to extend, NOT replace)
- `server/routes/admin.routes.ts` — admin endpoints to extend with provider toggle
- `client/src/components/admin/` — admin UI section components (look at scenery-card pattern)
- `server/middleware/auth.middleware.ts` — current API key resolution (extend with OpenAI key)
- `shared/schema.ts` — `postSchema` and friends (NO schema change needed; provider is invisible to client)

### OpenAI Responses API reference
- User-provided OpenAI docs (pasted in task) — covers `tools: [{type: "image_generation"}]`, multi-image input, `input_image` with `image_url: "data:..."`, partial images, revised_prompt
</canonical_refs>

<specifics>
## Specific Ideas

- **OpenAI Responses API quality/size mapping:**
  - Gemini `aspectRatio: "1:1"` → OpenAI `size: "1024x1024"`
  - Gemini `aspectRatio: "4:5"` → OpenAI `size: "1024x1280"` (or closest valid `gpt-image-2` size)
  - Gemini `aspectRatio: "9:16"` (if used) → OpenAI `size: "1024x1792"` or closest valid
- **Carousel style-consistency pattern:** Gemini receives slide-1 buffer as `inlineData` reference for slides 2..N. For OpenAI, pass slide-1 result as `input_image` with `data:` URL via `previous_response_id` or explicit content blocks.
- **Edit-post:** Gemini gets `{prompt, currentImageBase64, currentImageMimeType}`. OpenAI gets the same content as `input_text` + `input_image` in `responses.create()`.
- **Enhancement:** Same shape as edit-post; provider-agnostic call signature.

</specifics>

<deferred>
## Deferred Ideas

- Per-user provider selection (only global admin toggle in v1.2)
- Credit/billing multiplier alignment between providers (kept the same in v1.2; admin must understand cost difference manually)
- Image variation endpoint (OpenAI has it, Gemini doesn't; not needed by current flows)
- Streaming partial images on OpenAI side (not currently used by any flow; can be added when client UI requires it)
- Stable Diffusion or other third providers (interface designed to allow but only Gemini + OpenAI implemented now)
- Per-flow provider override (e.g., "use OpenAI only for enhancement") — single global toggle for v1.2

</deferred>

---

*Phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative*
*Context gathered: 2026-05-17 via direct user request + codebase exploration*
