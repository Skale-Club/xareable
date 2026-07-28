# Phase 12: Image Provider Abstraction — Research

**Researched:** 2026-05-17
**Domain:** TypeScript provider abstraction, OpenAI Images API (gpt-image-2), refactor of 4 image-generation flows
**Confidence:** HIGH (core findings cross-verified via official OpenAI docs + SDK source + codebase audit)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Provider abstraction location:** `server/services/image-provider.ts` — exports `ImageProvider` interface, `GeminiImageProvider` class, `OpenAIImageProvider` class, and `getActiveImageProvider()` factory
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

### Deferred Ideas (OUT OF SCOPE)

- Per-user provider selection (only global admin toggle in v1.2)
- Credit/billing multiplier alignment between providers (kept the same in v1.2; admin must understand cost difference manually)
- Image variation endpoint (OpenAI has it, Gemini doesn't; not needed by current flows)
- Streaming partial images on OpenAI side (not currently used by any flow; can be added when client UI requires it)
- Stable Diffusion or other third providers (interface designed to allow but only Gemini + OpenAI implemented now)
- Per-flow provider override (e.g., "use OpenAI only for enhancement") — single global toggle for v1.2
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROV-01 | `server/services/image-provider.ts` exports `ImageProvider` interface, `GeminiImageProvider`, `OpenAIImageProvider`, and `getActiveImageProvider()` factory | Interface shape and factory pattern defined in Architecture Patterns section |
| PROV-02 | `OpenAIImageProvider` uses Responses API (`tools:[{type:"image_generation"}]`, model mainline+gpt-image-2 target) — NOT legacy Images API | Responses API vs Images API decision documented below; critical WARNING issued |
| PROV-03 | Reference image format conversion Gemini ↔ OpenAI; unit-tested | Conversion pattern documented in Code Examples section |
| PROV-04 | `platform_settings` row `image_provider`; read/write uses `getPlatformSetting`/`setPlatformSetting` pattern | Existing pattern reverse-engineered; implementation guide in Architecture section |
| PROV-05 | Admin settings page "AI Image Provider" section with radio toggle | Admin UI pattern documented; existing shadcn RadioGroup component applicable |
| PROV-06 | `OPENAI_API_KEY` env + `profiles.openai_api_key` column; resolution centralized in `auth.middleware.ts` | `getGeminiApiKey` mirror pattern documented; DB migration required |
| PROV-07 | All four flows (generate, edit-post, carousel, enhancement) route through provider factory | Each flow's current call site identified; refactor impact documented |
</phase_requirements>

---

## Summary

Phase 12 is a server-side refactor that inserts a provider abstraction layer between the four image-generation call sites and the Gemini API calls they currently hardcode. The `GeminiImageProvider` wraps the existing `image-generation.service.ts` logic; the `OpenAIImageProvider` calls OpenAI's Responses API. A factory function reads `platform_settings.image_provider` per-request to pick the active provider.

**Critical architectural note:** The CONTEXT.md decision to use the Responses API (not the Images API) is well-reasoned for multi-image reference flows (carousel, edit-post). However, the Responses API does NOT expose a `size` parameter inside the `image_generation` tool — aspect ratio is communicated entirely via the prompt text. The Images API (`openai.images.generate` / `openai.images.edit`) DOES expose `size` but is a simpler pipeline. Both are valid choices; the Responses API is the locked decision per CONTEXT.md.

**SDK install required:** The `openai` npm package is NOT in `package.json`. It must be installed (`npm install openai`). Latest verified version: `6.38.0`. The SDK's `toFile()` utility accepts `Buffer` directly (no filesystem required), which is the correct pattern for the in-memory base64 flows already used throughout this codebase.

**Primary recommendation:** Use `openai` SDK v6 for the `OpenAIImageProvider`. Keep `image-generation.service.ts` as-is and have `GeminiImageProvider` import and delegate to it — this avoids a risky rewrite of tested code. The `ImageProvider` interface should have two methods: `generate()` and `edit()`, with a canonical `ReferenceImage` type passed by callers.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `openai` | `6.38.0` (latest) | OpenAI SDK — typed `images.generate`, `images.edit`, `responses.create`, `toFile` utility | Official SDK, full TypeScript types, handles multipart/form-data for image uploads automatically |

### Supporting (already installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sharp` | `^0.34.5` | Already installed — normalize images to PNG before passing to OpenAI edit | OpenAI edit endpoint requires PNG (confirmed); sharp converts WebP/JPEG |
| `zod` | `^3.24.2` | Already installed — validate `image_provider` setting value | Same pattern as other platform_settings reads |

### Not Needed (already handled)

| Concern | Reason Not Needed |
|---------|------------------|
| `form-data` | OpenAI SDK v4+ handles FormData internally via `toFile` |
| `node-fetch` | Express 5 / tsx environment has native `fetch`; OpenAI SDK uses its own internal fetch |

**Installation:**

```bash
npm install openai
```

**Version verification:** `npm view openai version` → `6.38.0` (verified 2026-05-17).

---

## Architecture Patterns

### Recommended File Structure

```
server/services/
  image-provider.ts          ← NEW: interface + GeminiImageProvider + OpenAIImageProvider + factory
  image-generation.service.ts ← UNCHANGED: Gemini generate/edit — GeminiImageProvider delegates here
  carousel-generation.service.ts ← MODIFIED: replace IMAGE_MODEL constant calls with provider.generate()
  enhancement.service.ts     ← MODIFIED: replace callEnhancementImageModel() call with provider.edit()
server/middleware/
  auth.middleware.ts         ← MODIFIED: add getOpenAIApiKey() mirror of getGeminiApiKey()
server/routes/
  generate.routes.ts         ← MODIFIED: pass provider to generateImage call
  edit.routes.ts             ← MODIFIED: pass provider to editImage call
  admin.routes.ts            ← MODIFIED: GET/PATCH image_provider setting endpoints
client/src/components/admin/
  image-provider-section.tsx ← NEW: radio toggle Gemini / OpenAI (Admin UI)
```

### Pattern 1: ImageProvider Interface

The cleanest TypeScript shape for a two-method provider interface:

```typescript
// server/services/image-provider.ts

export interface ReferenceImage {
  mimeType: string;  // e.g. "image/png", "image/webp"
  data: string;      // base64-encoded
}

export interface ImageGenerationInput {
  prompt: string;
  aspectRatio: string;       // "1:1", "4:5", "9:16", "16:9"
  apiKey: string;
  referenceImages?: ReferenceImage[];
  logoImageData?: ReferenceImage | null;
}

export interface ImageEditInput {
  prompt: string;
  currentImage: ReferenceImage;  // the base image to edit
  apiKey: string;
  logoImageData?: ReferenceImage | null;
  additionalRefs?: ReferenceImage[];  // extra reference images (carousel style-consistency)
}

export interface ImageProviderResult {
  buffer: Buffer;
  mimeType: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export interface ImageProvider {
  generate(input: ImageGenerationInput): Promise<ImageProviderResult>;
  edit(input: ImageEditInput): Promise<ImageProviderResult>;
}
```

**Why separate `generate()` and `edit()`:** The callers have fundamentally different shapes — generate has no base image, edit requires one. A single `call()` method would add conditional logic at the interface boundary that belongs in the provider implementations.

### Pattern 2: GeminiImageProvider (thin wrapper)

```typescript
// GeminiImageProvider delegates to the existing tested functions

import { generateImage, editImage } from './image-generation.service.js';

export class GeminiImageProvider implements ImageProvider {
  async generate(input: ImageGenerationInput): Promise<ImageProviderResult> {
    const result = await generateImage({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      apiKey: input.apiKey,
      referenceImages: input.referenceImages,
      logoImageData: input.logoImageData,
    });
    return { buffer: result.buffer, mimeType: result.mimeType, usage: result.usage };
  }

  async edit(input: ImageEditInput): Promise<ImageProviderResult> {
    const result = await editImage({
      prompt: input.prompt,
      currentImageBase64: input.currentImage.data,
      currentImageMimeType: input.currentImage.mimeType,
      apiKey: input.apiKey,
      logoImageData: input.logoImageData,
    });
    return { buffer: result.buffer, mimeType: result.mimeType, usage: result.usage };
  }
}
```

**Decision:** Keep `image-generation.service.ts` unchanged. GeminiImageProvider is a thin adapter. This avoids touching 255 lines of tested Gemini logic.

### Pattern 3: OpenAIImageProvider (Responses API)

The Responses API uses a mainline text model + `image_generation` tool. The `gpt-image-2` model is specified *inside* the tool parameters (via `quality` mapping), NOT in the top-level `model` field.

```typescript
import OpenAI, { toFile } from 'openai';

export class OpenAIImageProvider implements ImageProvider {
  async generate(input: ImageGenerationInput): Promise<ImageProviderResult> {
    const client = new OpenAI({ apiKey: input.apiKey });

    // Build the prompt to include aspect ratio hint (Responses API has no size param)
    const sizeHint = aspectRatioToOpenAISizeHint(input.aspectRatio);
    const fullPrompt = `${input.prompt}\n\nImage format: ${sizeHint} aspect ratio.`;

    // Build input array: text + optional images
    const inputContent: any[] = [{ type: 'input_text', text: fullPrompt }];

    if (input.logoImageData) {
      inputContent.push(toOpenAIInputImage(input.logoImageData));
    }
    for (const ref of (input.referenceImages ?? [])) {
      inputContent.push(toOpenAIInputImage(ref));
    }

    const response = await client.responses.create({
      model: 'gpt-5.5',   // mainline model; gpt-image-2 is the underlying image model
      input: [{ role: 'user', content: inputContent }],
      tools: [{ type: 'image_generation', quality: 'medium' }],
    } as any);  // SDK types may lag; cast if needed

    return extractResponseImage(response);
  }

  async edit(input: ImageEditInput): Promise<ImageProviderResult> {
    const client = new OpenAI({ apiKey: input.apiKey });

    const inputContent: any[] = [
      { type: 'input_text', text: input.prompt },
      toOpenAIInputImage(input.currentImage),
    ];
    if (input.logoImageData) inputContent.push(toOpenAIInputImage(input.logoImageData));
    for (const ref of (input.additionalRefs ?? [])) {
      inputContent.push(toOpenAIInputImage(ref));
    }

    const response = await client.responses.create({
      model: 'gpt-5.5',
      input: [{ role: 'user', content: inputContent }],
      tools: [{ type: 'image_generation', quality: 'medium', action: 'edit' }],
    } as any);

    return extractResponseImage(response);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toOpenAIInputImage(img: ReferenceImage) {
  return {
    type: 'input_image',
    image_url: `data:${img.mimeType};base64,${img.data}`,
  };
}

function aspectRatioToOpenAISizeHint(ratio: string): string {
  // Responses API has no size param; communicate via prompt text
  const map: Record<string, string> = {
    '1:1':  'square (1:1)',
    '4:5':  'portrait (4:5, slightly taller than wide)',
    '9:16': 'portrait (9:16, tall mobile format)',
    '16:9': 'landscape (16:9, wide format)',
  };
  return map[ratio] ?? ratio;
}

function extractResponseImage(response: any): ImageProviderResult {
  const imageCalls = (response.output ?? []).filter(
    (item: any) => item.type === 'image_generation_call'
  );
  if (!imageCalls.length) {
    throw new Error('OpenAI Responses API returned no image_generation_call in output');
  }
  const base64 = imageCalls[0].result;
  if (!base64) {
    throw new Error('OpenAI image_generation_call result is empty');
  }
  return {
    buffer: Buffer.from(base64, 'base64'),
    mimeType: 'image/png',
    usage: {
      promptTokenCount: response.usage?.input_tokens,
      candidatesTokenCount: response.usage?.output_tokens,
    },
  };
}
```

### Pattern 4: Factory Function

```typescript
import { createAdminSupabase } from '../supabase.js';

type ImageProviderName = 'gemini' | 'openai';

export async function getActiveImageProvider(apiKey: string): Promise<ImageProvider> {
  // Read from platform_settings — no caching needed (per-request is fine; settings change rarely)
  const sb = createAdminSupabase();
  const { data } = await sb
    .from('platform_settings')
    .select('setting_value')
    .eq('setting_key', 'image_provider')
    .maybeSingle();

  const providerName = (data?.setting_value as string | undefined) ?? 'gemini';

  if (providerName === 'openai') {
    return new OpenAIImageProvider();
  }
  return new GeminiImageProvider();
}
```

**Note:** `apiKey` is NOT passed to the factory — the API key is injected per-call via `ImageGenerationInput.apiKey` and `ImageEditInput.apiKey` (consistent with the existing pattern where the route resolves the key and passes it to the service).

### Pattern 5: platform_settings Read/Write Pattern (Confirmed)

From codebase audit, the `platform_settings` table is accessed directly via the Supabase admin client using `setting_key` / `setting_value` — there is NO generic `getPlatformSetting` / `setPlatformSetting` helper function in `app-settings.service.ts`. The file exists but contains app-level UI settings; `platform_settings` operations are inline Supabase calls scattered across `quota.ts`, `style-catalog.routes.ts`, and `markup.routes.ts`.

**Correct pattern for new `image_provider` row:**

```typescript
// READ
const { data } = await sb
  .from('platform_settings')
  .select('setting_value')
  .eq('setting_key', 'image_provider')
  .maybeSingle();
const provider = (data?.setting_value as string | undefined) ?? 'gemini';

// WRITE (admin endpoint)
await sb
  .from('platform_settings')
  .upsert({ setting_key: 'image_provider', setting_value: 'openai' }, { onConflict: 'setting_key' });
```

**Note:** The CONTEXT.md references `getPlatformSetting`/`setPlatformSetting` as named helpers, but these do not exist as exported functions. The planner should implement them as part of this phase OR use the inline pattern already established. Recommendation: create two small exported helpers in `app-settings.service.ts` to formalize the pattern, then use them consistently.

### Pattern 6: API Key Resolution Extension

```typescript
// auth.middleware.ts — mirror of getGeminiApiKey()

export async function getOpenAIApiKey(
  profile: { openai_api_key?: string | null; is_admin?: boolean; is_affiliate?: boolean } | null
): Promise<{ key: string; error?: string }> {
  const ownKey = usesOwnApiKey(profile);

  if (ownKey) {
    if (!profile?.openai_api_key) {
      return {
        key: '',
        error: 'Admin and affiliate accounts must configure their own OpenAI API key in Settings before generating.',
      };
    }
    return { key: profile.openai_api_key };
  }

  const serverKey = process.env.OPENAI_API_KEY;
  if (!serverKey) {
    return { key: '', error: 'OpenAI API key not configured on the server.' };
  }
  return { key: serverKey };
}
```

**DB migration needed:** Add `openai_api_key TEXT` column to `profiles` table (nullable). Apply via Supabase SQL editor (not Drizzle push — Phase 11 decision: skip Drizzle push for Supabase-native migrations).

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS openai_api_key TEXT;
```

### Pattern 7: Carousel Style-Consistency with OpenAI

Gemini uses `thoughtSignature` + multi-turn `contents` for slide 2..N consistency. OpenAI Responses API equivalent is `previous_response_id` to chain turns, or passing slide-1 image as `input_image` in each subsequent call.

**Recommended approach for OpenAI:** Pass slide-1 result as an `input_image` in the input array of slides 2..N (single-turn per slide, with visual reference). This mirrors the Gemini single-turn fallback path already in `carousel-generation.service.ts` (lines 378–426). This avoids `previous_response_id` multi-turn complexity and keeps the rate-limit-retry logic simpler.

**Carousel refactor shape:** The `generateCarousel()` function currently calls the private Gemini functions directly. It should be refactored to accept an `ImageProvider` parameter and call `provider.generate()` for slide 1 and `provider.edit()` (with slide-1 as `currentImage`) for slides 2..N.

```typescript
// Modified CarouselGenerationParams:
export interface CarouselGenerationParams {
  // ... existing fields ...
  imageProvider: ImageProvider;  // ADD: injected by route
  // Remove apiKey from here once provider is injected
}
```

**Implication:** `carousel-generation.service.ts` must be refactored to use the provider rather than calling Gemini directly. This is the most invasive change in the phase.

### Pattern 8: Enhancement Refactor Shape

`callEnhancementImageModel()` in `enhancement.service.ts` is a private function (lines 341–399). The refactor extracts it into a provider call:

```typescript
// Before (enhancement.service.ts):
const edit = await callEnhancementImageModel({ prompt, normalizedBase64, apiKey });

// After:
const edit = await imageProvider.edit({
  prompt,
  currentImage: { mimeType: 'image/png', data: normalizedBase64 },
  apiKey,
});
```

`enhanceProductPhoto()` must accept `imageProvider: ImageProvider` in `EnhancementParams`.

### Anti-Patterns to Avoid

- **Instantiating `OpenAI` client at module level:** Create per-call with the resolved API key. Different users (admin/affiliate) may have different keys.
- **Caching provider selection indefinitely:** Re-read `platform_settings.image_provider` per-request or per-generation. The admin expects the change to take effect immediately without restart.
- **Passing `apiKey` to the factory:** The factory resolves the provider type only. The API key flows through `ImageGenerationInput`/`ImageEditInput`.
- **Using the Images API (`images.generate`) for edit flows:** The Images API `images.edit` with `gpt-image-2` has a known SDK bug (issue #1844) where the endpoint rejects gpt-image-2 by name. The Responses API with `action: 'edit'` avoids this entirely.
- **Assuming Responses API size parameter:** The Responses API `image_generation` tool does NOT expose a `size` parameter in the tool definition. Aspect ratio must be communicated via prompt text.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-memory Buffer → multipart upload | Custom FormData construction | `openai.toFile(buffer, 'image.png', {type: 'image/png'})` | toFile accepts Buffer directly (Buffer is Uint8Array subclass); SDK handles multipart internally |
| OpenAI client per-request | Singleton client | `new OpenAI({ apiKey })` per provider instance | Keys differ per user (admin/affiliate vs. server key); singleton would share keys incorrectly |
| Provider reading from DB | Custom caching layer | Direct `createAdminSupabase()` call per-request | platform_settings changes rarely; RLS bypassed by admin client; no TTL invalidation needed |
| TypeScript discriminated union on provider | Complex switch/case at every call site | Interface + factory pattern | All callers call `provider.generate()` / `provider.edit()`; type safety at compile time |

---

## Critical Finding: Responses API vs Images API

The CONTEXT.md locks the decision to use the Responses API. Research confirms why, but also surfaces an important implementation constraint:

| Concern | Images API | Responses API |
|---------|-----------|---------------|
| Multi-image reference inputs | Up to 16 via `image[]` | Yes, via `input_image` content blocks |
| Size/aspect ratio parameter | `size: "1024x1024"` etc. | NOT available — prompt-only |
| Edit flows | `images.edit` (has SDK bug with gpt-image-2 #1844) | `action: 'edit'` in tool — unaffected by bug |
| Streaming | Not available | `partial_images` streaming available |
| Response image location | `data[0].b64_json` | `output[n].result` where `type == 'image_generation_call'` |
| Quality parameter | `quality: 'low' | 'medium' | 'high'` | Inside tool definition |
| Model field | `model: 'gpt-image-2'` | `model: 'gpt-5.5'` (mainline); gpt-image-2 is the underlying image engine |

**Aspect ratio mapping for prompt-based hints:**

| Gemini aspectRatio | OpenAI Images API size | Responses API prompt hint |
|-------------------|----------------------|--------------------------|
| `"1:1"` | `"1024x1024"` | `"square (1:1)"` |
| `"4:5"` | `"1024x1280"` (not officially listed — use 1024x1536 closest) | `"portrait (4:5)"` |
| `"9:16"` | `"1024x1536"` | `"portrait (9:16)"` |
| `"16:9"` | `"1536x1024"` | `"landscape (16:9)"` |

**Note:** gpt-image-2 officially supports `1024x1024`, `1024x1536`, `1536x1024`. There is no `1024x1280` (4:5 exact). The Responses API sidesteps this by using prompt text, letting the underlying model approximate the ratio.

---

## Common Pitfalls

### Pitfall 1: `images.edit` SDK Bug with gpt-image-2

**What goes wrong:** `openai.images.edit({ model: 'gpt-image-2', ... })` throws `"Invalid value: 'gpt-image-2'. Value must be 'dall-e-2'"`. This is a confirmed open SDK/API bug (GitHub issue #1844).

**Why it happens:** The `/v1/images/edits` endpoint's model validation does not yet allow gpt-image-2, despite the model officially supporting editing.

**How to avoid:** Use the Responses API with `action: 'edit'` in the `image_generation` tool (the locked decision in CONTEXT.md). Do NOT attempt `images.edit` with gpt-image-2.

**Warning signs:** Any 400 response with message containing "Value must be 'dall-e-2'".

### Pitfall 2: Responses API Output Array Traversal

**What goes wrong:** Attempting `response.output[0].result` directly — the output array may contain multiple items of different types (text, image_generation_call). If the model generates text before the image, the image call is not at index 0.

**How to avoid:** Always filter by type:

```typescript
const imageCalls = response.output.filter(item => item.type === 'image_generation_call');
if (!imageCalls.length) throw new Error('No image in response');
const base64 = imageCalls[0].result;
```

### Pitfall 3: OpenAI Client Singleton Sharing API Keys

**What goes wrong:** Admin user's `openai_api_key` bleeds into regular-user requests if the client is created once at module load with a key from one request.

**How to avoid:** Create `new OpenAI({ apiKey })` inside the provider method or at provider construction time with the key passed in. Since `ImageGenerationInput.apiKey` is passed per-call, use it: `new OpenAI({ apiKey: input.apiKey })`.

### Pitfall 4: Carousel Service — `apiKey` Parameter Not Removed

**What goes wrong:** `CarouselGenerationParams.apiKey` is also passed to the Gemini text model (master text plan). Removing it breaks text generation. Only image calls should go through the provider.

**How to avoid:** Keep `apiKey` in `CarouselGenerationParams` for text calls. Add `imageProvider: ImageProvider` as a separate param. The text model (Gemini) is never replaced in this phase.

### Pitfall 5: `platform_settings` Upsert Conflict Key

**What goes wrong:** Using `.update()` on a row that doesn't exist yet silently does nothing. The admin expects OpenAI to activate.

**How to avoid:** Use `.upsert({ setting_key: 'image_provider', setting_value: 'openai' }, { onConflict: 'setting_key' })` for writes. Seed the default row via SQL migration:

```sql
INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('image_provider', 'gemini')
ON CONFLICT (setting_key) DO NOTHING;
```

### Pitfall 6: OpenAI `toFile` with Non-PNG Images

**What goes wrong:** The Images API edit endpoint requires PNG. Passing a WebP or JPEG buffer to `toFile` with the wrong MIME type causes a 400.

**How to avoid:** Normalize images to PNG using `sharp().png().toBuffer()` before passing to the OpenAI provider. The Gemini provider already does this in `normalizeInlineImageForGemini()`. The `OpenAIImageProvider` should apply the same normalization.

### Pitfall 7: Missing `image_provider` Default Row in Existing Environments

**What goes wrong:** If `platform_settings` has no `image_provider` row, `maybeSingle()` returns `null` and the factory defaults to `'gemini'` — which is correct. But if the admin endpoint reads it and returns null, the admin UI shows no selection.

**How to avoid:** Admin GET endpoint returns `'gemini'` as the default when no row exists. Seed the row in the SQL migration.

---

## Code Examples

### images.generate (Images API — for reference, NOT the locked approach)

```typescript
// Source: developers.openai.com/api/docs/guides/image-generation (verified 2026-05-17)
// NOTE: This is the Images API — CONTEXT.md locks Responses API instead
const response = await openai.images.generate({
  model: 'gpt-image-2',
  prompt: 'A product hero shot...',
  size: '1024x1024',           // or '1024x1536', '1536x1024'
  quality: 'medium',           // 'low' | 'medium' | 'high'
  response_format: 'b64_json',
});
const buffer = Buffer.from(response.data[0].b64_json!, 'base64');
```

### Responses API Image Generation (LOCKED APPROACH)

```typescript
// Source: developers.openai.com/api/docs/guides/images-vision + blog.laozhang.ai (verified 2026-05-17)
const response = await client.responses.create({
  model: 'gpt-5.5',  // mainline model; gpt-image-2 is the underlying image model
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Generate a square product shot. Square (1:1) aspect ratio.' },
        // optional reference image:
        { type: 'input_image', image_url: 'data:image/png;base64,<base64>' },
      ],
    },
  ],
  tools: [{ type: 'image_generation', quality: 'medium' }],
} as any);

const imageCalls = response.output.filter((i: any) => i.type === 'image_generation_call');
const buffer = Buffer.from(imageCalls[0].result, 'base64');
```

### toFile with In-Memory Buffer

```typescript
// Source: github.com/openai/openai-node/blob/master/src/internal/to-file.ts (verified 2026-05-17)
// Buffer is Uint8Array subclass — toFile accepts it directly
import { toFile } from 'openai';

const pngBuffer: Buffer = await sharp(inputBuffer).png().toBuffer();
const file = await toFile(pngBuffer, 'image.png', { type: 'image/png' });
// `file` is now a valid Uploadable for images.edit or images.generate
```

### Reference Image Conversion (PROV-03)

```typescript
// Canonical conversion between Gemini and OpenAI reference image formats

// Gemini format (input/output of existing services):
const geminiRef = { mimeType: 'image/png', data: '<base64>' };

// OpenAI Responses API format (input to Responses API):
function toOpenAIInputImage(ref: ReferenceImage) {
  return {
    type: 'input_image' as const,
    image_url: `data:${ref.mimeType};base64,${ref.data}`,
  };
}

// OpenAI Images API format (input to images.edit, if ever used):
// Pass via toFile() — not a JSON block
const file = await toFile(Buffer.from(ref.data, 'base64'), 'image.png', { type: ref.mimeType });
```

### Admin Endpoint Pattern for Provider Setting

```typescript
// GET /api/admin/image-provider — reads current setting
router.get('/api/admin/image-provider', async (req, res) => {
  const adminResult = await requireAdminGuard(req, res);
  if (!adminResult) return;

  const sb = createAdminSupabase();
  const { data } = await sb
    .from('platform_settings')
    .select('setting_value')
    .eq('setting_key', 'image_provider')
    .maybeSingle();

  res.json({ provider: (data?.setting_value as string) ?? 'gemini' });
});

// PATCH /api/admin/image-provider — sets provider
router.patch('/api/admin/image-provider', async (req, res) => {
  const adminResult = await requireAdminGuard(req, res);
  if (!adminResult) return;

  const { provider } = req.body;
  if (provider !== 'gemini' && provider !== 'openai') {
    return res.status(400).json({ message: 'provider must be "gemini" or "openai"' });
  }

  const sb = createAdminSupabase();
  await sb
    .from('platform_settings')
    .upsert({ setting_key: 'image_provider', setting_value: provider }, { onConflict: 'setting_key' });

  res.json({ provider });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Images API `dall-e-2` or `dall-e-3` for edits | Responses API `image_generation` tool for multi-image flows | 2025–2026 | Responses API required for gpt-image-2 edit flows due to SDK bug |
| `images.edit` with `gpt-image-2` | Blocked by API-side validation bug (#1844) | Open issue as of 2026-05 | Must use Responses API for edit flows |
| Size via `size` parameter | Size via prompt text in Responses API | N/A | Aspect ratio is approximate; model interprets hint |

**Deprecated/outdated:**
- `dall-e-3` for edits: does not support multi-image input
- `createImageEdit` (old SDK method name): renamed to `images.edit` in SDK v4+
- `response_format: 'url'` for edits: images expire quickly; always use `b64_json` for server-side processing

---

## Open Questions

1. **Responses API `model` field — which mainline model?**
   - What we know: CONTEXT.md says `gpt-5.5` or "current mainline that supports `image_generation` tool". The blog source uses `gpt-5.4`.
   - What's unclear: The exact model identifier that is available to this account. `gpt-5.5` may not be available to all tiers.
   - Recommendation: Use `gpt-4.1` as a safe fallback (confirmed to support image_generation tool per search results). Make the model name a constant at the top of `OpenAIImageProvider` so it's easy to change: `const OPENAI_RESPONSES_MODEL = 'gpt-4.1';`

2. **Responses API SDK TypeScript types**
   - What we know: The `openai` SDK v6 has `client.responses.create()` but the `image_generation` tool type definition and `action` parameter may not be typed yet (hence the `as any` cast in Code Examples).
   - What's unclear: Whether v6.38.0 includes complete `image_generation` tool typings.
   - Recommendation: Use `as any` cast for the tool definition and extract image from output by string comparison on `.type`. Add a runtime assertion on the result shape.

3. **OpenAI cost vs Gemini cost**
   - What we know: gpt-image-2 high quality ≈ $0.21/image at 1024x1024; Gemini pricing differs. CONTEXT says surface this as informational text in admin UI.
   - Recommendation: Hard-code approximate cost estimates as strings in the admin UI copy (e.g., "gpt-image-2 costs approx. $0.05–$0.21/image depending on quality"). No billing logic changes this phase.

4. **`profiles.openai_api_key` column visibility in Settings UI**
   - What we know: PROV-06 requires the column; PROV-05 says admin UI shows a radio toggle. Whether regular admin users see an OpenAI key field in `/settings` is not specified by PROV-05.
   - Recommendation: The key entry field should mirror the existing Gemini key field in `/settings` — visible only to admin/affiliate users (same gate as the Gemini key today). This is a single additional input field, not a new page.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `openai` npm package | PROV-02 OpenAIImageProvider | NOT INSTALLED | — | Must install: `npm install openai` |
| `sharp` | Image format normalization for OpenAI | ✓ | `^0.34.5` | — |
| `OPENAI_API_KEY` env var | PROV-06 regular user API key | Unknown (not in CLAUDE.md env list) | — | Admin configures via `profiles.openai_api_key` |

**Missing dependencies with no fallback:**
- `openai` npm package — install required before any implementation begins

**Missing dependencies with fallback:**
- `OPENAI_API_KEY` env var — admin/affiliate users can supply their own key via `profiles.openai_api_key`; regular users cannot generate with OpenAI until the server key is configured

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | TypeScript static verification (no jest/vitest — follows Phase 11 pattern of `scripts/verify-phase-*.ts`) |
| Config file | None — inline `tsx` runner |
| Quick run command | `npx tsx scripts/verify-phase-12.ts` |
| Full suite command | `npm run check` (TypeScript type check) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-01 | `ImageProvider` interface exported; `getActiveImageProvider()` factory returns GeminiImageProvider by default | unit (static) | `npx tsx scripts/verify-phase-12.ts` | Wave 0 |
| PROV-02 | `OpenAIImageProvider` calls Responses API, not Images API; `model` field is mainline not gpt-image-2 | static analysis | `npx tsx scripts/verify-phase-12.ts` | Wave 0 |
| PROV-03 | Reference image conversion `{mimeType, data}` ↔ `{type:'input_image', image_url:'data:...'}` is correct | unit | `npx tsx scripts/verify-phase-12.ts` | Wave 0 |
| PROV-04 | `platform_settings` row defaults to `'gemini'`; factory returns GeminiImageProvider when no row exists | static | `npx tsx scripts/verify-phase-12.ts` | Wave 0 |
| PROV-05 | Admin UI radio toggle exists and calls PATCH endpoint | manual (live UI) | Manual | — |
| PROV-06 | `getOpenAIApiKey()` exists in `auth.middleware.ts`; mirrors `getGeminiApiKey()` pattern | static | `npx tsx scripts/verify-phase-12.ts` | Wave 0 |
| PROV-07 | All 4 flow files import from `image-provider.ts`; none import `generateImage`/`editImage` directly | static grep | `npx tsx scripts/verify-phase-12.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run check` (TypeScript type check — catches interface mismatches immediately)
- **Per wave merge:** `npx tsx scripts/verify-phase-12.ts`
- **Phase gate:** All static checks green + manual smoke test of both providers before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `scripts/verify-phase-12.ts` — static verification script for PROV-01 through PROV-07
- [ ] `npm install openai` — required before any provider implementation

---

## Sources

### Primary (HIGH confidence)

- GitHub `openai/openai-node` `src/internal/to-file.ts` — confirmed `toFile` accepts `Buffer` (Uint8Array subclass)
- `developers.openai.com/api/reference/typescript/resources/images/methods/edit` — TypeScript signature, size options for gpt-image-2
- `developers.openai.com/api/docs/models/gpt-image-2` — supported endpoints (generate, edit, responses)
- `github.com/openai/openai-node/issues/1844` — confirmed `images.edit` rejects `gpt-image-2` model name (open bug)
- Codebase audit: `server/services/image-generation.service.ts`, `carousel-generation.service.ts`, `enhancement.service.ts`, `auth.middleware.ts`, `server/routes/style-catalog.routes.ts`, `quota.ts` — existing patterns confirmed

### Secondary (MEDIUM confidence)

- `developers.openai.com/api/docs/guides/images-vision?format=base64-encoded` — `input_image` format `{type, image_url: 'data:...'}`
- `blog.laozhang.ai/en/posts/gpt-image-2-api` — Responses API structure, `gpt-5.4` model field example
- `docs.aimlapi.com/api-references/image-models/openai/gpt-image-2` — size options (`1024x1024`, `1024x1536`, `1536x1024`), quality options

### Tertiary (LOW confidence)

- Web search aggregated results: gpt-image-2 pricing ($0.005–$0.21 per image depending on size/quality)
- Web search: Responses API `action: 'edit'` parameter in tool definition — not directly verified against official docs

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — `openai` SDK v6 confirmed latest via `npm view`, `toFile` Buffer support confirmed via source
- Architecture: HIGH — all 4 call sites located in codebase; interface shape derives from existing Gemini parameter shapes
- Pitfalls: HIGH — SDK bug #1844 confirmed via GitHub; `maybeSingle()` pattern confirmed from codebase
- OpenAI Responses API exact behavior: MEDIUM — cannot access platform.openai.com directly; cross-verified via multiple doc proxies

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (Responses API tool parameters may evolve; re-verify mainline model name before implementation)
