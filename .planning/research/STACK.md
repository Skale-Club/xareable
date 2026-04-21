# Technology Stack — v1.1 Additions

**Project:** My Social Autopilot — v1.1 Media Creation Expansion
**Researched:** 2026-04-21
**Scope:** Stack additions and changes strictly required for (1) carousel generator and (2) image enhancement. Existing validated stack is not re-documented here.

---

## Verdict: No New npm Dependencies Required

All capabilities needed for the two new features are satisfied by the existing dependency set. The additions are architectural patterns, schema changes, and prompt-engineering strategies — not new libraries.

---

## Finding 1 — Carousel: Multi-Image Generation API Shape

### Confirmed: No Multi-Image Per Call

`gemini-3.1-flash-image-preview` does **not** support `candidateCount > 1`. Passing `candidateCount: 2` returns HTTP 400 `INVALID_ARGUMENT: "Multiple candidates is not enabled for this model"`. This is a confirmed platform limitation as of April 2026, not a configuration issue.

**Confidence:** HIGH — verified from official Google AI Developers Forum thread (April 2026), confirmed absent from official docs.

**Source:** https://discuss.ai.google.dev/t/multiple-candidates-candidatecount-is-not-supported-for-image-generation-models/124694

### Confirmed: No Seed Parameter on This Model

The `seed` parameter for deterministic generation exists only for **Imagen models** (Imagen 3.0, 4.0 family) via the Vertex AI endpoint, not for `gemini-3.1-flash-image-preview` via the Gemini API `generateContent` endpoint. No seed parameter is documented or operational for nano-banana as of April 2026.

**Confidence:** HIGH — Vertex AI deterministic-images docs explicitly list Imagen models only; Gemini image generation docs have no seed parameter.

**Source:** https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-deterministic-images

### Required Architecture: N Sequential Calls with Style Conditioning

Carousel generation requires N independent calls to `generateImage`. Style consistency is achieved through **prompt-based conditioning**, not API-level seeding:

**Strategy (validated by Google Codelab and community practice):**

1. Gemini text model (`gemini-2.5-flash`) generates the full carousel narrative in one call: N slide titles, N slide descriptors, a shared style block, and the unified caption.
2. Each slide image call receives:
   - A shared "visual identity" string (brand colors, mood, typography style, composition rules) prepended to every slide's image prompt.
   - The slide's own narrative content appended after the shared block.
3. Optionally: after generating slide 1, its output image is passed as `inlineData` to slide 2's prompt labeled as "visual reference — match style exactly." This "cascading reference" technique is the most effective consistency approach discovered.
4. Calls can run with bounded parallelism (see Finding 5 on rate limits below).

**Source:** https://towardsdatascience.com/generating-consistent-imagery-with-gemini/ (MEDIUM confidence — community article, technique verified against official API shape)

### Text Call Request Shape (N-Slide Narrative)

Extend the existing text generation call to produce structured carousel content:

```json
{
  "contents": [{
    "parts": [{ "text": "<carousel-system-prompt>" }]
  }],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 4096,
    "responseMimeType": "application/json"
  }
}
```

Expected JSON response shape from text model:

```json
{
  "shared_style": "cinematic flat illustration, brand colors #FF6B35 #1A1A2E, soft shadows, 1:1 portrait crops, consistent character rendering",
  "caption": "unified IG caption with hashtags",
  "slides": [
    { "slide_number": 1, "role": "hook", "title": "Stop scrolling.", "image_prompt": "<shared_style> + hook scene" },
    { "slide_number": 2, "role": "develop", "title": "Here is why.", "image_prompt": "<shared_style> + develop scene" },
    { "slide_number": 3, "role": "cta",  "title": "Start today.",  "image_prompt": "<shared_style> + cta scene" }
  ]
}
```

### Image Call Request Shape (Per Slide)

First slide — text-to-image:

```json
{
  "contents": [{
    "parts": [
      { "text": "<shared_style_block> <slide_N_specific_prompt>" }
    ]
  }],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {
      "aspectRatio": "1:1",
      "imageSize": "1K"
    }
  }
}
```

Subsequent slides with cascading reference (optional, improves consistency):

```json
{
  "contents": [{
    "parts": [
      { "text": "Visual reference — Image 1 shows the established visual style for this carousel. Match its color grading, illustration style, and composition closely. Now generate slide N: <slide_N_prompt>" },
      {
        "inline_data": {
          "mime_type": "image/webp",
          "data": "<base64-of-slide-1-output>"
        }
      }
    ]
  }],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {
      "aspectRatio": "1:1",
      "imageSize": "1K"
    }
  }
}
```

**Header:** `"x-goog-api-key": <apiKey>` (matches existing `generateImage` pattern in `server/services/image-generation.service.ts`)

### Aspect Ratios Supported

For carousels: `"1:1"` (square) and `"4:5"` (portrait) — both confirmed as valid `imageConfig.aspectRatio` values in official docs. Both are already in `DEFAULT_STYLE_CATALOG.post_formats`.

**Source:** https://ai.google.dev/gemini-api/docs/image-generation

---

## Finding 2 — Image Enhancement: Image-to-Image API Shape

### Confirmed: inlineData Reference Image Input Works

The existing `editImage` function in `server/services/image-generation.service.ts` already uses the correct shape for image-to-image: text prompt + `inlineData` reference image in the same `parts` array. This is the identical pattern the official docs show for image editing.

The enhancement feature can reuse `editImage` directly, requiring only a different prompt strategy (scenery/environment transformation rather than post text editing).

**Confidence:** HIGH — pattern is already proven in production; official docs confirm it.

**Source:** https://ai.google.dev/gemini-api/docs/image-generation

### Confirmed Request Shape (already implemented)

```json
{
  "contents": [{
    "parts": [
      { "text": "<enhancement instruction: transform background to <scenery_preset>, preserve product identity, professional commercial lighting, photorealistic>" },
      {
        "inline_data": {
          "mime_type": "image/jpeg",
          "data": "<base64-of-user-uploaded-photo>"
        }
      }
    ]
  }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

**Note:** Do not pass `imageConfig.aspectRatio` in editing calls. There is a confirmed active bug where `gemini-3.1-flash-image-preview` ignores `imageConfig.aspectRatio` on image-to-image editing calls and reshuffles the layout for non-square inputs. Square (1:1) inputs edit most reliably. If aspect ratio preservation matters, the approach is: use `sharp` (already installed) to pad or crop the input to 1:1 before sending to the API, then crop back after if needed.

**Confidence:** HIGH for the bug — confirmed by multiple user reports and a dedicated forum thread.

**Source:** https://discuss.ai.google.dev/t/gemini-3-1-flash-image-preview-ignores-imageconfig-aspect-ratio-and-reshuffles-layout-on-background-edit/128031

### Quality Expectations for Enhancement

The model performs well on:
- Background replacement (product on a table → beach sunset / studio backdrop)
- Lighting improvement (flat phone-camera shot → professional rim-lit commercial image)
- Texture and color correction

The model is unreliable for:
- Precise geometric transformations
- Maintaining exact product proportions when the input photo has extreme crop ratios

For the scenery-preset use case (restaurant product shot → styled environment), quality is commercially acceptable at 1K resolution based on published reviews and the existing `editImage` implementation's track record.

**Source:** https://lynnlangit.medium.com/gemini-3-1-flash-image-preview-ace4080d3899 (MEDIUM confidence — community review, not official benchmark)

---

## Finding 3 — New Libraries: None Required

| Need | Already Covered By | Notes |
|------|--------------------|-------|
| Concurrency control for N slide calls | Native `Promise.all` + manual throttle, or `Promise.allSettled` with sequential batches | `p-limit` would be cleaner but is NOT required — the slide count is bounded at 3–10, and the rate limit situation (see Finding 5) means sequential calls are safer anyway |
| File-type validation on user-uploaded photos | `sharp` (already installed) + Zod | `sharp` throws on invalid image data; Zod handles MIME type allowlisting. No `file-type` package needed |
| Image resizing / padding before API call | `sharp` (already installed) | Use `sharp` to pad user upload to 1:1 before enhancement call if needed |
| Base64 encode/decode of uploaded files | Node.js built-in `Buffer` | Already used throughout `image-generation.service.ts` |
| Carousel slide data storage | Supabase via existing `@supabase/supabase-js` | New table, no new library |
| Frontend carousel preview | `embla-carousel-react` (already installed at ^8.6.0) | Already in `package.json` — use this for the slide preview UI |

**Conclusion:** `npm install` nothing new.

---

## Finding 4 — Database Schema: New `post_slides` Table (Not JSON Column)

### Recommendation: Separate `post_slides` table

**Rationale:**

| Criterion | `post_slides` table | JSON array column on `posts` |
|-----------|---------------------|------------------------------|
| RLS enforcement | Per-row policies apply naturally | JSON blob is opaque to RLS; must rely entirely on parent-row policy |
| Individual slide URL expiry | Each slide can have its own `expires_at` and `storage_path` | Cannot expire or delete individual slides without parsing JSON |
| Thumbnail per slide | Natural foreign-key column | Nested object in JSON, harder to query |
| Gallery queries | `SELECT COUNT(*) slide_count FROM post_slides WHERE post_id = ?` trivial | Must `jsonb_array_length()` or deserialize in app |
| Storage cleanup job | Can JOIN `post_slides` to find expired storage objects directly | Must deserialize JSON to get URLs |
| Supabase Realtime | Can subscribe to individual slide inserts during generation | JSON column update is one coarse event |
| Migration complexity | One new table, one FK | One new column, schema stays "simpler" but app logic is messier |

The existing `post_versions` table precedent also uses a child table pattern (not JSON), confirming the project's preferred pattern.

### Proposed Schema

```sql
-- New table
CREATE TABLE post_slides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  slide_number  SMALLINT NOT NULL CHECK (slide_number >= 1 AND slide_number <= 10),
  image_url     TEXT NOT NULL,
  thumbnail_url TEXT,
  image_prompt  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, slide_number)
);

-- RLS: users can only see their own slides (via posts join)
ALTER TABLE post_slides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_slides_select_own"
  ON post_slides FOR SELECT
  USING (
    post_id IN (SELECT id FROM posts WHERE user_id = auth.uid())
  );
```

```sql
-- Extend content_type enum on posts table
ALTER TABLE posts
  DROP CONSTRAINT posts_content_type_check;

ALTER TABLE posts
  ADD CONSTRAINT posts_content_type_check
    CHECK (content_type IN ('image', 'video', 'carousel', 'enhancement'));
```

**Storage paths for carousel slides:**

```
user_assets/{userId}/slides/{postId}/slide-{N}.webp
user_assets/{userId}/slides/{postId}/thumbnails/slide-{N}.webp
```

This follows the existing `{userId}/…` convention from `INTEGRATIONS.md`.

### Zod Schema Additions (in `shared/schema.ts`)

```typescript
export const postSlideSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  slide_number: z.number().int().min(1).max(10),
  image_url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
  image_prompt: z.string().nullable().default(null),
  created_at: z.string(),
});
export type PostSlide = z.infer<typeof postSlideSchema>;
```

Extend `postSchema.content_type` enum:

```typescript
content_type: z.enum(["image", "video", "carousel", "enhancement"]).default("image"),
```

---

## Finding 5 — Gemini Pricing and Carousel Cost Model

### Confirmed Pricing: `gemini-3.1-flash-image-preview`

Source: Official Gemini API pricing page — https://ai.google.dev/gemini-api/docs/pricing (verified April 2026)

| Resolution | Output Tokens | Price per Image (Standard) | Price per Image (Batch, 50% off) |
|------------|--------------|---------------------------|----------------------------------|
| 0.5K (512px) | 747 | $0.045 | $0.023 |
| 1K (1024px)  | 1,120 | $0.067 | $0.034 |
| 2K (2048px)  | 1,680 | $0.101 | $0.051 |
| 4K (4096px)  | 2,520 | $0.151 | $0.076 |

Input tokens (text + image): $0.50 / 1M tokens standard.

**For a 5-slide carousel at 1K:**
- 5 × $0.067 = **$0.335 per generation** (user's own API key)
- Each additional slide is $0.067 incremental

**For image enhancement (single image-to-image at 1K):**
- 1 × $0.067 = **$0.067 per generation**
- Input image tokens add a small amount (reference image ≈ a few hundred tokens × $0.50/1M = < $0.001 additional)

**Billing implication:** The `recordUsageEvent` / `deductCredits` flow must pass `slide_count` as a multiplier. The cost model is strictly `N × image_cost_micros` for carousels. No separate "carousel setup" cost. Enhancement is billed as one image generation.

### Rate Limits (relevant for concurrent slide generation)

Observed limits for `gemini-3.1-flash-image-preview` on paid tiers are poorly documented. Community reports indicate effective limits of 2–10 images per minute depending on tier. There is a dedicated `IPM` (images per minute) quota that operates independently from text RPM.

**Safe strategy:** Generate carousel slides sequentially (not all in parallel) within the SSE stream. With 3–10 slides at ~3–5 seconds per image call, total generation time is 9–50 seconds — acceptable for an SSE-streamed experience with per-slide progress events.

If parallelism is needed in the future, use `Promise.all` with a manual concurrency cap of 3 simultaneous image calls (no `p-limit` needed at this scale — a simple semaphore pattern or batching into groups of 3 suffices).

**Source:** https://discuss.google.dev/t/undocumented-rate-limits-for-gemini-image-generation-2-5-rpm/303281 (MEDIUM confidence — community forum, no official confirmation of specific values)

---

## Finding 6 — Known Active Bugs in `gemini-3.1-flash-image-preview`

These affect implementation decisions:

| Bug | Affected Feature | Mitigation |
|-----|-----------------|------------|
| `imageConfig.imageSize` silently ignored in some SDK/proxy paths | Both carousel and enhancement | Use raw REST (already the pattern in this codebase) not `@google/generative-ai` SDK for image calls; confirm 1K is default |
| `imageConfig.aspectRatio` ignored on image-to-image editing calls | Enhancement | Normalize user-uploaded photos to 1:1 with `sharp` before sending; do not pass `aspectRatio` in editing `generationConfig` |
| `candidateCount > 1` not supported | Carousel | Confirmed workaround: N sequential calls |

**Source:** https://github.com/googleapis/js-genai/issues/1461 and https://discuss.ai.google.dev/t/gemini-3-1-flash-image-preview-ignores-imageconfig-aspect-ratio-and-reshuffles-layout-on-background-edit/128031

---

## Integration Map: How New Features Plug Into Existing Patterns

### Carousel route (`POST /api/carousel`)

| Step | Pattern Reused |
|------|---------------|
| Auth | `authenticateUser` — identical |
| Credit check | `checkCredits(userId, "generate", false)` with `slide_count` multiplier applied to cost |
| SSE stream | `initSSE(res)` — identical; emit one `sendProgress` event per slide generated |
| Text generation | `createGeminiService(apiKey).generateText(...)` with a carousel-specific system prompt; returns `{ shared_style, caption, slides[] }` |
| Image generation per slide | `generateImage(...)` from `image-generation.service.ts` — identical function, called N times |
| Per-slide optimization | `processImageWithThumbnail(buffer)` — identical; generates `.webp` main + thumbnail |
| Storage | `uploadFile(sb, "user_assets", `${userId}/slides/${postId}/slide-${N}.webp`, ...)` |
| DB insert | `posts` row with `content_type: "carousel"`, then N rows into `post_slides` |
| Usage recording | `recordUsageEvent` called once with aggregated token counts; `deductCredits` called once with `N × image_cost` |

### Enhancement route (`POST /api/enhance`)

| Step | Pattern Reused |
|------|---------------|
| Auth | `authenticateUser` — identical |
| File upload | Multipart body OR base64 in JSON (same as `reference_images` pattern in generate route) |
| Input normalization | `normalizeInlineImageForGemini` (already in `image-generation.service.ts`) + `sharp` resize to 1:1 if non-square |
| Enhancement call | `editImage(...)` from `image-generation.service.ts` — identical function, different prompt |
| Scenery preset | Read from new `scenery_catalog` table (admin-curated, same pattern as `style_catalog`) |
| Optimization + upload | `processImageWithThumbnail` + `uploadFile` — identical |
| DB insert | `posts` row with `content_type: "enhancement"`, `image_url` pointing to result |
| Usage recording | `recordUsageEvent` + `deductCredits` — identical to single-image flow |

---

## Alternatives Considered and Rejected

| Alternative | Rejected Because |
|-------------|-----------------|
| `p-limit` for carousel parallelism | Not needed at 3–10 slides; sequential calls within SSE are safer given undocumented IPM limits; adds a dependency for zero functional gain |
| `file-type` npm package for upload validation | `sharp` already throws on malformed image buffers; Zod handles MIME type allowlisting; adds a dependency for zero coverage gap |
| JSON array column on `posts` for slides | See Finding 4 — `post_slides` table wins on RLS, queryability, and pattern consistency |
| Vertex AI Imagen 4 for image generation | Requires separate billing account and different auth flow; Gemini API key (already per-user) is the project constraint |
| Seed-based consistency via Imagen | Imagen seed API is on Vertex AI, not Gemini API; incompatible with per-user `profiles.api_key` auth model |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Multi-image per call: NOT supported | HIGH | Official forum + API error confirmed |
| Seed parameter: NOT available on nano-banana | HIGH | Vertex AI docs list Imagen only; Gemini image docs have no seed param |
| Style consistency via prompt conditioning | MEDIUM | Community article + Google Codelab (technique, not API param) |
| Image-to-image via inlineData | HIGH | Already implemented and working in `editImage()` |
| aspectRatio bug on editing calls | HIGH | Multiple user reports + forum thread |
| imageSize ignored in some paths | MEDIUM | GitHub issue; raw REST path appears unaffected |
| Pricing per image at 1K: $0.067 | HIGH | Official pricing page, April 2026 |
| Rate limits (IPM) | LOW | Undocumented; community observations only |
| No new npm dependencies needed | HIGH | All capabilities mapped to existing deps |
| `post_slides` table over JSON column | HIGH | Consistent with existing `post_versions` pattern; confirmed by RLS and query analysis |

---

## Sources

- Gemini image generation docs: https://ai.google.dev/gemini-api/docs/image-generation
- Gemini 3.1 Flash Image Preview model page: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image-preview
- Gemini API pricing (April 2026): https://ai.google.dev/gemini-api/docs/pricing
- candidateCount not supported (forum): https://discuss.ai.google.dev/t/multiple-candidates-candidatecount-is-not-supported-for-image-generation-models/124694
- Seed parameter — Vertex AI Imagen only: https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-deterministic-images
- Style consistency technique: https://towardsdatascience.com/generating-consistent-imagery-with-gemini/
- aspectRatio bug on editing: https://discuss.ai.google.dev/t/gemini-3-1-flash-image-preview-ignores-imageconfig-aspect-ratio-and-reshuffles-layout-on-background-edit/128031
- imageSize ignored issue: https://github.com/googleapis/js-genai/issues/1461
- Undocumented IPM limits: https://discuss.google.dev/t/undocumented-rate-limits-for-gemini-image-generation-2-5-rpm/303281

---

*Stack analysis: 2026-04-21 — v1.1 Media Creation Expansion*
