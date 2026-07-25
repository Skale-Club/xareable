# Technology Stack — v1.6 OpenRouter Gateway + Deterministic Typography + Visual Critic

**Project:** Xareable — v1.6 Professional Design Quality Overhaul + OpenRouter Gateway
**Researched:** 2026-07-18
**Confidence:** HIGH for OpenRouter chat/structured-outputs/transcription mechanics and for the typography stack choice; MEDIUM for OpenRouter's dedicated Image API specifics (launched 2026-06-23, ~4 weeks old at research time) and for BYOK-on-image-models; LOW/unverified for exact STT model slug availability (confirmed the mechanism, not the full current model roster).

**Scope:** Stack additions/changes strictly required for (1) OpenRouter gateway migration of text/image/transcription calls, (2) deterministic server-side typography compositing, (3) multimodal visual critic with re-roll, (4) structured outputs for the planning call. Video/Veo is explicitly frozen and out of scope. Existing validated stack (sharp, Supabase, Zod, Express) is not re-documented except where it integrates directly with new capabilities.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `openai` npm SDK (existing dep) | `^6.48.0` (have `^6.38.0`, bump patch) | Text/planning chat completions + structured outputs + audio transcription, pointed at OpenRouter | OpenRouter's chat completions and audio transcription endpoints are byte-for-byte OpenAI-API-compatible — confirmed via official docs. Point `baseURL` at `https://openrouter.ai/api/v1`, keep using `chat.completions.create()` and `audio.transcriptions.create()` exactly as today. No new HTTP client needed for these two call types. |
| Raw `fetch` (Node 20+ built-in) | n/a | Image generation calls to OpenRouter's dedicated Image API | **BLOCKER FINDING:** OpenRouter's new Image API (`POST https://openrouter.ai/api/v1/images`, launched 2026-06-23) is documented as explicitly **not** reachable through the OpenAI SDK's `images.generate()` or `chat.completions.create()` — it requires a direct HTTP call with `Authorization: Bearer <OPENROUTER_API_KEY>`. This is the only surface that exposes normalized `aspect_ratio` + `resolution` control for Gemini image models (see Finding below). Node 20's built-in `fetch` is sufficient; no axios/got needed. |
| `@napi-rs/canvas` | `^1.0.2` | Deterministic server-side rendering of headline/support/CTA typography layer (custom fonts, wrapping, shadows/plates) | Skia-based (same rasterizer as Chrome), ships prebuilt N-API binaries for `win32-x64-msvc`, `linux-x64-gnu`, `linux-x64-musl`, `linux-arm64-gnu`, `darwin-x64/arm64` — zero native compilation on both the Windows dev machine and the Linux Docker/Coolify production host. `GlobalFonts.registerFromPath()`/`registerFromMemory()` embeds font files directly (no OS/fontconfig font database dependency), which is the property that makes typography **deterministic** across environments — the explicit goal of this milestone. Full Canvas 2D API (`measureText`, `shadowBlur`/`shadowColor`, gradients, `textAlign`/`textBaseline`) covers plate/shadow legibility treatments without extra libraries. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sharp` (existing dep) | `^0.34.5` (current; `0.35.3` latest, optional bump not required) | Final compositing of the typography PNG buffer onto the AI-generated text-free image + WebP encode | No change to sharp's role — it remains the last-mile compositor/encoder. `canvas.toBuffer('image/png')` from `@napi-rs/canvas` feeds directly into the existing `.composite()` call already used for logo overlay. Also use `.extract({left, top, width, height}).stats()` for region-luminance sampling (contrast decisions — see below). |
| `wcag-contrast` | `^3.0.0` | Optional named WCAG contrast-ratio function (`contrast(rgb1, rgb2)`) if you want an explicit numeric gate (e.g. require ≥ 4.5:1) rather than hand-rolled luminance math | Optional. Zero-dependency, ~1KB. Only add if the visual-critic/legibility-treatment logic wants a tested, named ratio function instead of inlining the WCAG relative-luminance formula (`0.2126R + 0.7152G + 0.0722B` after sRGB linearization) directly in the treatment-selection code. Not required to hit the milestone goal — see "Color Contrast Analysis" finding below. |
| `canvas-txt` | `^4.1.1` | Optional word-wrap/vertical-alignment convenience wrapper over a Canvas 2D context | Optional, evaluate only if hand-rolling wrap logic (measure-and-break using `ctx.measureText`) proves more code than desired. **Verify compatibility with `@napi-rs/canvas`'s context object before adopting** — it targets generic canvas-like contexts and is commonly paired with `node-canvas`, not explicitly tested against `@napi-rs/canvas` in its own docs. Given this milestone needs contrast-aware plate sizing computed per-request (not just generic wrapping), a ~40-line custom wrap function using `measureText`/`actualBoundingBoxAscent`/`actualBoundingBoxDescent` likely gives more precise control anyway. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| OpenRouter Models API (`GET /api/v1/models`, `/api/v1/images/models`, `/api/v1/models/{id}/endpoints`, `/api/v1/images/models/{id}/endpoints`) | Runtime capability discovery — confirm `supported_parameters` and `allowed_passthrough_parameters` per model before shipping a call | Not an npm package — a discovery contract to build the model-selection/provider-abstraction layer against. Query at build/CI time (or cache at startup) rather than hardcoding assumed param support, since OpenRouter's own docs repeatedly say "check the model's `supported_parameters`" — the param surface differs per model/provider even within the same model family (e.g., Google Vertex AI vs Google AI Studio endpoints for the same `google/gemini-3.1-flash-image` id both currently expose identical `aspect_ratio`/`resolution`/`input_references`/`cachedContent`, but this is not guaranteed to stay true for every model). |

---

## Installation

```bash
# Core — typography rendering
npm install @napi-rs/canvas

# Supporting (optional — evaluate during implementation)
npm install wcag-contrast
npm install canvas-txt   # only if hand-rolled wrap logic is rejected

# openai SDK already installed; bump patch version
npm install openai@^6.48.0
```

No new dependency is required for OpenRouter's chat/structured-outputs/transcription surfaces (reuses `openai` SDK) or for image-endpoint calls (reuses Node's built-in `fetch`).

---

## Finding: OpenRouter as Single Gateway — Capability Verification

### (a) OpenAI SDK compatibility — split verdict, not uniform

| Call type | OpenAI SDK usable? | Endpoint | Evidence |
|---|---|---|---|
| Text/planning chat completions (incl. `response_format: json_schema`) | **YES** | `POST /api/v1/chat/completions` via `client.chat.completions.create()` | OpenRouter docs: request/response schema "very similar to the OpenAI Chat API"; quickstart shows exact `new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey })` pattern. [Quickstart](https://openrouter.ai/docs/quickstart) |
| Audio transcription | **YES** | `POST /api/v1/audio/transcriptions` via `client.audio.transcriptions.create()` | Confirmed OpenAI-style multipart/form-data compatible; docs show `client.audio.transcriptions.create({ model: "openai/whisper-large-v3", file })` with the SDK pointed at OpenRouter's `baseURL`. Also accepts base64 JSON via `input_audio` if multipart is inconvenient. [STT guide](https://openrouter.ai/docs/guides/overview/multimodal/stt) |
| **Image generation** | **NO — must use raw HTTP** | `POST /api/v1/images` (new dedicated Image API, launched 2026-06-23) | OpenRouter's own announcement states the dedicated Image API is reached via direct HTTP calls with the `OPENROUTER_API_KEY` header and is **not** compatible with `client.chat.completions.create()` or `images.generate()` from the OpenAI SDK. [Unified Image API announcement](https://openrouter.ai/blog/announcements/image-api/) |

**Implication for `server/services/image-provider.ts`:** the existing provider-abstraction pattern needs a new "OpenRouter" branch that does a plain `fetch()` POST (not an `openai` SDK call) for image generation, while the planning/text and transcription branches can reuse the SDK client already used elsewhere. Keep these as two distinct HTTP clients under one logical gateway module, not one unified client object.

### (b) Which image models are available today (verified 2026-07-18, `GET /api/v1/images/models`)

Google Gemini image models present on OpenRouter right now:

- `google/gemini-2.5-flash-image` / `-preview`
- `google/gemini-3.1-flash-lite-image`
- `google/gemini-3.1-flash-image` **(GA — recommend migrating to this from the currently-direct `gemini-3.1-flash-image-preview`)**
- `google/gemini-3.1-flash-image-preview`
- `google/gemini-3-pro-image` / `-preview`

Also present: `openai/gpt-image-1`, `-1-mini`, `-2`; `openai/gpt-5-image`, `-mini`; `openai/gpt-5.4-image-2`; `black-forest-labs/flux.2-{pro,max,flex,klein-4b}`; `bytedance-seed/seedream-4.5`; `recraft/recraft-v4.1-*`; `sourceful/riverflow-v2*`. This gives the provider-abstraction layer real alternatives beyond Gemini/OpenAI if a future milestone wants them — no action needed now.

### (c) Aspect ratio / resolution control — CONFIRMED for Gemini, via the new Image API only

Querying `GET /api/v1/images/models/google/gemini-3.1-flash-image/endpoints` returns (verbatim field names):

```
"resolution":     enum ["512","1K","2K","4K"]
"aspect_ratio":   enum ["1:1","1:4","1:8","2:3","3:2","3:4","4:1","4:3","4:5","5:4","8:1","9:16","16:9","21:9"]
"n":              range min=1, max=1   (Gemini image models: no multi-candidate batching, matches existing direct-API limitation)
"input_references": range min=0, max=14  (reference/style images for image-to-image — current app sends up to 4 brand style-reference photos; well within this ceiling)
"allowed_passthrough_parameters": ["cachedContent"]  (Google-native passthrough, via provider.options.google-ai-studio / provider.options.google-vertex)
```

Both are **top-level request fields**, not nested under an `image_config` object, e.g.:

```json
{
  "model": "google/gemini-3.1-flash-image",
  "prompt": "...",
  "aspect_ratio": "4:5",
  "resolution": "2K",
  "input_references": ["<base64 or url>", "..."]
}
```

**This directly satisfies the milestone's need for text-free, correctly-proportioned AI images that the deterministic typography layer will composite onto** — no client-side cropping/letterboxing workaround needed for the base image dimensions.

**Caveat (MEDIUM confidence, ~4 weeks old at research time):** the general (non-image) `GET /api/v1/models/.../endpoints` record for the same Gemini model id does *not* list `aspect_ratio`/`resolution` among its `supported_parameters` (only `reasoning`, `max_tokens`, `temperature`, `response_format`, etc.) — confirming aspect-ratio control is a property of the **dedicated Image API surface specifically**, not something obtainable by adding `modalities: ["image","text"]` to a normal chat completion for Gemini. Verify this against the live API at implementation time since the feature is new; do not assume future model additions automatically inherit this param surface.

### (d) Usage accounting / real per-request cost — CONFIRMED, now default-on

`usage: { include: true }` and `stream_options: { include_usage: true }` are **deprecated and now no-ops** — OpenRouter states full usage/cost details are unconditionally included in every response (streaming: in the final SSE chunk; non-streaming: in the body), for both chat completions and the Image API. Every response's `usage` object includes `cost` (total billed) and `cost_details.upstream_inference_cost` (actual upstream cost, populated for BYOK requests specifically). **This eliminates the per-provider pricing-table maintenance burden** called out as a v1.6 driver in `PROJECT.md` — billing can read `usage.cost` directly per call instead of maintaining a local token-pricing table. [Usage accounting docs](https://openrouter.ai/docs/use-cases/usage-accounting)

### (e) Structured outputs — CONFIRMED for the planning call

`response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` is supported with `additionalProperties: false` strict-schema enforcement, documented as supported for Google Gemini (full support), OpenAI GPT-4o and later, and Anthropic Sonnet 4.5+/Opus 4.1+. Works with streaming (partial JSON accumulates to a schema-valid whole). Directly usable via the `openai` SDK's `response_format` (or SDK's camelCase `responseFormat`) field — no new library. [Structured outputs docs](https://openrouter.ai/docs/features/structured-outputs)

### (f) Audio input / transcription — CONFIRMED, two mechanisms

1. Dedicated endpoint (recommended): `POST /api/v1/audio/transcriptions`, OpenAI-compatible multipart or base64 JSON, `model` values confirmed in docs include `openai/whisper-large-v3` (and per the 2026-05-01 Audio APIs announcement, `google/chirp-3` is also available as a transcription-specific model — **verify the exact current OpenRouter slug for Chirp 3 via `GET /api/v1/models` at implementation time**, LOW confidence on the precise string). Optional `language` (ISO-639-1, e.g. `"pt"`, `"es"`), `response_format` (`json`/`verbose_json` with segment timestamps), `timestamp_granularities`. `prompt` param accepted but ignored.
2. General chat completions with `input_audio` content blocks — works with any audio-capable chat model (e.g. `google/gemini-2.5-flash`), base64-encoded audio only (no direct URL).

Recommend the dedicated transcription endpoint (mechanism 1) since it is purpose-built, cheaper, and matches the existing `/api/transcribe` route's single responsibility.

### (g) BYOK (Bring Your Own Key) — supported at account level, image-model coverage unverified

BYOK is configured per-provider at the OpenRouter workspace/account level (not per-request), for OpenAI, Azure (AI Foundry + OpenAI), Amazon Bedrock, and Google Vertex AI. 5% fee on BYOK-routed requests, waived for the first 1M BYOK requests/month/account. Since Gemini image models are served through both the Google AI Studio and Google Vertex AI provider routes (confirmed identical endpoint records above), Vertex AI BYOK should in principle cover Gemini image generation for admin/affiliate "bring your own key" flows — **but OpenRouter's BYOK documentation only explicitly discusses chat/inference endpoints and does not confirm Image-API compatibility. Flag as MEDIUM confidence; validate with a real BYOK test call against `/api/v1/images` before wiring this into the admin/affiliate key-management UI.** [BYOK docs](https://openrouter.ai/docs/features/byok)

### (h) Video — no action (frozen per milestone scope)

Confirmed no change needed: Veo is not among OpenRouter's models in any research pass here; the milestone correctly keeps video on the direct Google API untouched.

---

## Finding: Deterministic Server-Side Typography

**Recommendation: `@napi-rs/canvas`, not satori, not raw SVG→sharp.**

### Why `@napi-rs/canvas`

- **Deterministic font loading is the whole point of this milestone.** `GlobalFonts.registerFromPath()`/`registerFromMemory()` embeds font bytes directly into the renderer's font table — rendering is identical regardless of what fonts happen to be installed on the host OS. This is not true of SVG-via-librsvg (see below).
- **Prebuilt binaries for every target this project runs on**: `@napi-rs/canvas-win32-x64-msvc` (Windows dev), `@napi-rs/canvas-linux-x64-gnu`/`-musl` (Coolify/Hetzner Docker prod), `@napi-rs/canvas-darwin-*`. `npm install` selects the right one automatically; no native toolchain, no `node-gyp`, no Alpine-specific workarounds.
- **Full imperative Canvas 2D API** — exactly what's needed for per-request computed placement: `measureText` (with `actualBoundingBoxAscent`/`Descent`/`Left`/`Right` for precise vertical centering of headline/support/CTA blocks), `shadowBlur`/`shadowColor`/`shadowOffsetX/Y` and gradient fills for the plate/shadow legibility treatments called out in the P2 pillar, arbitrary positioning driven by the contrast analysis of the underlying AI image region.
- **Composes into the existing sharp pipeline unchanged.** `canvas.toBuffer('image/png')` (transparent background) → same `sharp(...).composite([{ input: buffer, top, left }])` call already used for logo overlay. Sharp remains the single final encode/optimize stage (WebP q85+); no second image library is introduced into that path.
- Version `1.0.2` (stable major, not pre-1.0) as of research date — mature enough for a production quality-critical path.

### Why not satori

Satori (Vercel's HTML/CSS→SVG library, used by `@vercel/og`) is excellent for **declarative, template-shaped** layouts (OG images, social cards with a fixed structure) but is a worse fit here specifically because:

- It only produces SVG — a second rasterization stage (`resvg-js` or sharp-as-SVG-renderer) is required to get pixels, adding a dependency and a format round-trip for no benefit over rendering pixels directly.
- Font format support is capped at TTF/OTF/WOFF — **WOFF2 is not supported**, and self-hosted Google Fonts ship as WOFF2 by default, meaning an extra font-conversion step (WOFF2→TTF) enters the build/asset pipeline.
- Its CSS subset has no `position: absolute`-driven arbitrary placement suited to per-request, contrast-analysis-computed text placement — it's built around flexbox document flow, which fights against "put this plate exactly here because the image is dark in this region."
- Best fit remains what it's designed for: a fixed declarative template. This milestone's need — measure this string, place it precisely based on runtime image analysis, apply a computed legibility treatment — is fundamentally imperative, which Canvas 2D expresses directly and Satori expresses only awkwardly.

### Why not raw SVG string → sharp

- Sharp's SVG rasterization goes through libvips/librsvg, which resolves font *families by name* through the OS font database (fontconfig on Linux). Embedding font files as base64 `@font-face` data URIs inside the SVG works inconsistently across librsvg versions and platforms — a well-documented pain point, and precisely the failure mode this project would hit given the Windows-dev/Linux-Docker-prod split (fonts that render correctly locally silently falling back to a system default in the container, or vice versa).
- SVG `<text>` does not auto-wrap; line-breaking still has to be computed by the caller — so this route doesn't even save the wrap-logic work that Canvas 2D's `measureText` gives you directly, while adding font-resolution non-determinism on top.
- No net benefit over `@napi-rs/canvas`, with a strictly worse determinism story — the opposite of this milestone's stated goal.

---

## Finding: Color Contrast Analysis for Text Placement

**No new dependency is strictly required.** `sharp` (already a dependency) provides everything needed:

```ts
const { data } = await sharp(imageBuffer)
  .extract({ left, top, width, height })   // the region behind planned text
  .raw()
  .toBuffer({ resolveWithObject: true });
// or: const stats = await sharp(imageBuffer).extract({...}).stats();
// stats.channels[0..2].mean gives average R/G/B for the region
```

Compute WCAG relative luminance (`0.2126*R + 0.7152*G + 0.0722*B` after sRGB→linear conversion) from the region's mean channel values to decide: light text + shadow, dark text, or a scrim/plate treatment. This is a handful of lines, not a library.

**Optional:** `wcag-contrast` (`^3.0.0`, zero-dependency, ~1KB) if the team prefers a named, tested `contrast(rgb1, rgb2)` ratio function and wants to gate treatments on an explicit numeric threshold (e.g., reject/retry if computed contrast < 4.5:1) rather than inlining the luminance formula. Given the project's constraint to "add new libraries only when strictly required," this is a judgment call best made when the legibility-treatment logic is actually written — either choice is a few lines of difference.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `@napi-rs/canvas` for typography | `satori` + `resvg-js`/sharp | If the design system moves toward fully declarative, template-driven layouts (e.g., a fixed set of card templates with no runtime-computed placement) — satori's JSX/CSS model becomes an asset rather than overhead once placement is no longer contrast-driven. |
| `@napi-rs/canvas` for typography | `node-canvas` (`canvas` npm package) | Only if a transitive dependency elsewhere already forces Cairo-based rendering; otherwise no reason — `node-canvas` requires system Cairo/Pango libs (apt packages in the Docker image) and has historically worse Windows install reliability, exactly the cross-platform friction `@napi-rs/canvas` avoids. |
| OpenRouter dedicated Image API (raw fetch) for image gen | Chat completions `modalities: ["image","text"]` | Only for legacy-listed models the announcement calls out (GPT-5 Image family) if a future need arises to stay on the chat-completions surface for a non-Gemini model; not applicable to Gemini image models for aspect-ratio control per the endpoint introspection above. |
| `openai` SDK for transcription | Direct `fetch` to `/api/v1/audio/transcriptions` | If avoiding the SDK's multipart/form-data handling quirks in a serverless/edge runtime; not relevant here since the app is a long-running Express/Node host where the SDK's Node-native multipart handling works fine. |
| sharp `.stats()` for contrast | `wcag-contrast` npm | When you want a named, unit-tested ratio function and an explicit numeric pass/fail gate rather than inline math — otherwise sharp alone suffices. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `images.generate()` / `chat.completions.create()` (OpenAI SDK) for OpenRouter image calls | Confirmed unsupported by OpenRouter's own Image API announcement — the dedicated `/api/v1/images` endpoint requires direct HTTP, not the SDK's image or chat surfaces | Plain `fetch()` POST to `https://openrouter.ai/api/v1/images` with `Authorization: Bearer` header |
| `usage: { include: true }` / `stream_options: { include_usage: true }` request params | Deprecated no-ops as of the current OpenRouter API — usage/cost is now always included automatically | Just read `response.usage.cost` unconditionally; no request-side flag needed |
| Raw SVG strings rendered via sharp for text overlays | librsvg's OS/fontconfig-based font resolution is non-deterministic across the Windows-dev/Linux-Docker-prod split this project has; no built-in text measurement for wrapping | `@napi-rs/canvas` with `GlobalFonts.registerFromPath`/`registerFromMemory` |
| `satori` for this milestone's typography needs | Requires a second SVG→raster stage, caps at WOFF/TTF/OTF (no WOFF2, extra font-conversion step for self-hosted Google Fonts), and its flexbox/CSS layout model fights against runtime contrast-driven absolute placement | `@napi-rs/canvas` imperative Canvas 2D API |
| `node-canvas` (`canvas` package) | Requires system Cairo/Pango native libs; historically fragile Windows install story; slower/weaker text shaping than Skia | `@napi-rs/canvas` |
| Assuming Gemini image aspect-ratio control works via chat-completions `modalities` param | Not confirmed by the general chat-model endpoint's `supported_parameters` (only lists `reasoning`/`max_tokens`/etc.); only the dedicated Image API endpoint record lists `aspect_ratio`/`resolution` for this model | Use `/api/v1/images` exclusively for Gemini/any image-generation call |

## Stack Patterns by Variant

**If a future milestone adds more image providers beyond Gemini (FLUX, Seedream, GPT-Image):**
- Build the provider-abstraction's image branch against OpenRouter's `/api/v1/images/models/{id}/endpoints` discovery contract (checking `supported_parameters` per model) rather than hardcoding one model's param shape — pricing units differ (per-image, per-megapixel, per-token) and `n`/`input_references` ceilings differ per model.

**If the typography layer needs to support right-to-left or complex-script languages later:**
- Re-evaluate — `@napi-rs/canvas`'s Skia-based `fillText` handles Latin Extended (pt-BR/es accents: á, é, í, ó, ú, ã, õ, ç, ñ — all precomposed single codepoints, no special shaping needed) without issue, but complex script shaping (Arabic, Devanagari) is a different verification exercise not covered by this research since it's out of the current milestone's language scope.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `@napi-rs/canvas@^1.0.2` | Node 20+ (project already pins `@types/node: 20.19.27`) | Prebuilt binaries cover the exact platform matrix this project deploys to (Windows dev via `npm run dev`, Linux Docker via Coolify). No Dockerfile changes needed beyond a normal `npm ci`. |
| `openai@^6.48.0` | `baseURL: 'https://openrouter.ai/api/v1'` | Drop-in for chat completions + transcription; do not route image generation through this client (see Finding a/BLOCKER above). |
| `sharp@^0.34.5` (current) | `@napi-rs/canvas` PNG buffer output | `sharp(...).composite([{ input: canvasPngBuffer }])` — same call shape as the existing logo-overlay composite; no sharp version bump required for this. |
| `wcag-contrast@^3.0.0` / `canvas-txt@^4.1.1` | n/a | Zero-dependency utility packages; no known compatibility constraints, both optional. |

## Sources

- [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart) — OpenAI SDK setup, `baseURL` pattern — HIGH confidence
- [OpenRouter Unified Image API announcement](https://openrouter.ai/blog/announcements/image-api/) — dedicated `/api/v1/images` endpoint, SDK incompatibility, `aspect_ratio`/`resolution` params, launch date 2026-06-23 — HIGH confidence (official announcement)
- [OpenRouter Image Generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) — param normalization, `provider.options` passthrough — HIGH confidence
- `GET https://openrouter.ai/api/v1/images/models` and `GET https://openrouter.ai/api/v1/images/models/google/gemini-3.1-flash-image/endpoints` (fetched directly 2026-07-18) — live model roster and per-model `supported_parameters`/`allowed_passthrough_parameters` — HIGH confidence (live API response), MEDIUM confidence on longevity given feature is ~4 weeks old
- [OpenRouter Usage Accounting docs](https://openrouter.ai/docs/use-cases/usage-accounting) — deprecation of `usage.include`, always-on cost reporting — HIGH confidence
- [OpenRouter Structured Outputs docs](https://openrouter.ai/docs/features/structured-outputs) — `response_format json_schema` shape, model support — HIGH confidence
- [OpenRouter Speech-to-Text guide](https://openrouter.ai/docs/guides/overview/multimodal/stt) — `audio.transcriptions.create()` OpenAI-SDK compatibility, model slugs, params — HIGH confidence
- [OpenRouter Audio APIs announcement](https://openrouter.ai/blog/announcements/announcing-audio-apis/) — launch date 2026-05-01, Google Chirp 3 availability — MEDIUM confidence (exact current model slug unverified)
- [OpenRouter BYOK docs](https://openrouter.ai/docs/features/byok) — account-level key management, 5% fee, provider list — MEDIUM confidence on image-model coverage (not explicitly documented)
- [OpenRouter Audio Input (multimodal) docs](https://openrouter.ai/docs/features/multimodal/audio) — `input_audio` content-block mechanism via chat completions — HIGH confidence
- npm registry (`npm view <pkg> version`, fetched 2026-07-18): `@napi-rs/canvas@1.0.2`, `satori@0.28.0`, `@resvg/resvg-js@2.6.2`, `wcag-contrast@3.0.0`, `canvas-txt@4.1.1`, `openai@6.48.0`, `sharp@0.35.3` — HIGH confidence (live registry query)
- WebSearch: "@napi-rs/canvas npm Windows Linux Docker prebuilt binaries font registration 2026", "satori vs @napi-rs/canvas server-side text image generation Node custom fonts 2026" — MEDIUM confidence (community sources, cross-checked against npm package descriptions and GitHub repo)
- Existing `package.json` (read directly) — confirms `openai@^6.38.0` and `sharp@^0.34.5` already present, no `satori`/`@napi-rs/canvas`/canvas libraries present today

---
*Stack research for: Xareable v1.6 — OpenRouter gateway, deterministic typography, visual critic, structured outputs*
*Researched: 2026-07-18*
