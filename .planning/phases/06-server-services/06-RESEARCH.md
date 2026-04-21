# Phase 6: Server Services - Research

**Researched:** 2026-04-21
**Domain:** Gemini API image generation, sharp image processing, service module patterns, billing extension
**Confidence:** MEDIUM (Gemini rate limits not publicly documented per-model; all other sections HIGH)

---

## Summary

Phase 6 ships two new service modules — `carousel-generation.service.ts` and `enhancement.service.ts` — plus a `slideCount` multiplier extension to `checkCredits` in `server/quota.ts`. The existing `image-generation.service.ts` and `gemini.service.ts` already demonstrate the exact raw-fetch pattern that these new services extend; the primary research effort is validating the three locked technical choices from ROADMAP (style consistency, rate limits, pre-screen) and establishing the prescriptive patterns for each.

**Key finding on multi-turn consistency:** Gemini 3+ image models now require `thought_signature` propagation in multi-turn conversations. Passing slide 1's buffer as bare `inlineData` in slide 2..N requests (without the `thought_signature` from slide 1's response) will produce a 400 validation error in current Gemini 3.x image models. The correct pattern is a two-element `contents` array: the model's previous turn (with `thought_signature` attached to the image part) followed by the new user turn. This is a material change from the ROADMAP assumption that bare `inlineData` is sufficient.

**Primary recommendation:** Implement style consistency via multi-turn conversation with `thought_signature` propagation, not bare `inlineData` reference. Wrap the multi-turn call in a try-catch and fall back to the `shared_style` descriptor-only approach (single-turn) if `thought_signature` is absent or the multi-turn call fails.

---

## Standard Stack

### Core (already in deps, verified against package.json pattern)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sharp` | ^0.33 (in use) | EXIF strip, square normalize, WebP encode, thumbnail | Already imported in `image-optimization.service.ts` and `image-generation.service.ts` |
| `google generativelanguage REST` | v1beta | Gemini text + image calls | Already in use via raw fetch; no SDK added |
| `zod` | ^3 (in use) | Request/response schema validation | Single source of truth per `CLAUDE.md` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `crypto` (Node built-in) | — | `randomUUID()` for postId, slideId | Per existing pattern in `generate.routes.ts` |
| `server/lib/sse.ts` | project | SSE progress events | Phase 7 will call service methods and pipe progress; services themselves do not import SSE directly |

**No new npm installs required for Phase 6.** All dependencies are present.

---

## Architecture Patterns

### Recommended Project Structure

```
server/services/
├── generate.service.ts               # existing (DO NOT MODIFY)
├── gemini.service.ts                 # existing — GeminiService class + createGeminiService()
├── image-generation.service.ts       # existing — generateImage(), editImage()
├── image-optimization.service.ts     # existing — processImageWithThumbnail(), optimizeImage()
├── caption-quality.service.ts        # existing — ensureCaptionQuality()
├── carousel-generation.service.ts    # NEW — generateCarousel()
├── enhancement.service.ts            # NEW — enhanceProductPhoto(), preScreenUpload()
└── storage-cleanup.service.ts        # existing (DO NOT MODIFY)
```

### Pattern 1: Service Module Shape (mirror existing services)

Each new service is a plain TypeScript module that exports typed async functions. No class wrapper (carousel and enhancement are not reused in multiple configurations unlike `GeminiService`).

```typescript
// carousel-generation.service.ts — top of file pattern
import { createAdminSupabase } from "../supabase.js";
import { uploadFile } from "../storage.js";
import { processImageWithThumbnail } from "./image-optimization.service.js";
// ... other imports

export interface CarouselGenerationParams { /* ... */ }
export interface CarouselGenerationResult { /* ... */ }

export async function generateCarousel(
  params: CarouselGenerationParams
): Promise<CarouselGenerationResult> { /* ... */ }
```

### Pattern 2: Gemini Raw-Fetch (established in gemini.service.ts and image-generation.service.ts)

The project uses raw `fetch` against `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with `x-goog-api-key` header. Do not introduce the Gemini SDK.

```typescript
// Source: existing image-generation.service.ts lines 109-124
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: imageRequestParts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: geminiAspectRatio, imageSize },
      },
    }),
  }
);
```

### Pattern 3: Carousel Master Text Call Schema

One text call returns the complete plan for all slides. This is CRSL-02's locked decision.

```typescript
// Target JSON shape returned by gemini-2.5-flash
interface CarouselTextPlan {
  shared_style: string;       // visual style descriptor injected into every slide prompt
  slides: Array<{
    slide_number: number;     // 1-based
    image_prompt: string;     // standalone prompt — MUST be self-contained
  }>;
  caption: string;            // unified caption for the post
}
```

The system prompt for the master text call MUST instruct Gemini to produce `shared_style` as a dense style descriptor (lighting, color palette, composition style, mood, typography direction) that is explicit enough to reproduce the visual feel when injected into any individual slide prompt. This is the fallback consistency mechanism when multi-turn fails.

### Pattern 4: Multi-Turn Style Consistency (CRSL-03) — REVISED

The ROADMAP assumed bare `inlineData` reference is sufficient. Current Gemini 3.x image models require `thought_signature` propagation in multi-turn conversations. The correct pattern:

**Step A: Generate slide 1 (single-turn)**
```typescript
// Standard single-turn call — same as generateImage() in image-generation.service.ts
const slide1Response = await fetch(geminiImageUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  body: JSON.stringify({
    contents: [{ parts: [{ text: slide1Prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio, imageSize } },
  }),
});
const slide1Data = await slide1Response.json();
// Extract buffer AND thought_signature
const slide1Parts = slide1Data.candidates?.[0]?.content?.parts ?? [];
const slide1ImagePart = slide1Parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
const slide1ThoughtSig = slide1ImagePart?.thoughtSignature ?? null;
const slide1Buffer = Buffer.from(slide1ImagePart.inlineData.data, "base64");
```

**Step B: Generate slides 2..N (multi-turn with thought_signature)**
```typescript
// Source: ai.google.dev/gemini-api/docs/thought-signatures
// CRITICAL: thought_signature must be attached to the image part in the model turn
const modelTurnParts: any[] = [
  {
    inlineData: { mimeType: "image/png", data: slide1ImagePart.inlineData.data },
    ...(slide1ThoughtSig ? { thoughtSignature: slide1ThoughtSig } : {}),
  },
];

const slideNResponse = await fetch(geminiImageUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  body: JSON.stringify({
    contents: [
      { role: "model", parts: modelTurnParts },
      { role: "user", parts: [{ text: `${sharedStyle}\n\n${slideNPrompt}\nMatch the visual style, lighting, and color palette of the reference image exactly.` }] },
    ],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio, imageSize } },
  }),
});
```

**Fallback when thought_signature is absent or multi-turn fails:**
Inject `shared_style` descriptor directly into the slide prompt and call as a single-turn with slide 1 as a bare `inlineData` reference (the pre-Gemini-3 pattern). Accept minor style drift.

### Pattern 5: Enhancement Pre-Screen (ENHC-06)

Use `gemini-2.5-flash` (text model — NOT the image model) with structured JSON output. The pre-screen call is a vision + text call with `inlineData` input and `responseSchema` enforcing a strict output shape.

```typescript
// Pre-screen request body
{
  contents: [{
    parts: [
      { inlineData: { mimeType: "image/jpeg", data: base64Data } },
      { text: preScreenPrompt }
    ]
  }],
  generationConfig: {
    responseMimeType: "application/json",
    responseJsonSchema: {
      type: "object",
      properties: {
        rejection_category: {
          type: "string",
          enum: ["none", "face_or_person", "screenshot_or_text_heavy", "explicit_content", "non_product"]
        },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        reason: { type: "string" }
      },
      required: ["rejection_category", "confidence", "reason"]
    }
  }
}
```

**Pre-screen prompt (prescriptive):**
```
You are a product photo validator for a product enhancement service.
Analyze this image and classify it. Your ONLY job is to protect the service from unsuitable uploads.

REJECT if:
- The image contains a recognizable human face as the primary or prominent subject (face_or_person)
- The image is a screenshot, app UI, document, chart, or text-heavy graphic (screenshot_or_text_heavy)
- The image contains explicit/adult content (explicit_content)
- The image is clearly not a product (e.g., a landscape, abstract art, meme) with nothing that could be enhanced as a commercial product (non_product)

ACCEPT if:
- The image shows a physical product, food item, packaged good, cosmetic, electronic device, or similar commercial subject — even if imperfectly photographed.

When in doubt about whether something is a product, choose rejection_category: "none" (accept it).
Respond with: rejection_category, confidence, reason.
```

**Rejection taxonomy (HTTP 400 body):**
```typescript
const REJECTION_MESSAGES: Record<string, string> = {
  face_or_person: "Upload must be a product photo. Images containing people or faces are not supported.",
  screenshot_or_text_heavy: "Upload must be a product photo. Screenshots and documents are not supported.",
  explicit_content: "This image cannot be processed.",
  non_product: "Upload must show a physical product. Please upload a product photo.",
};
```

Only reject when `confidence` is `"high"` OR `"medium"`. Pass through on `"low"` confidence rejections to avoid false positives on niche products.

### Pattern 6: EXIF Strip + Square Normalize (ENHC-03, ENHC-05)

```typescript
// Source: sharp.pixelplumbing.com/api-operation (rotate/autoOrient)
// Source: sharp.pixelplumbing.com/api-resize (resize + contain)

// Step 1: Strip EXIF and apply EXIF orientation (autoOrient removes the tag)
// Step 2: Normalize to square (contain = letterbox, no crop distortion)
// Step 3: toBuffer() — strips all remaining metadata by default

export async function normalizeForEnhancement(
  inputBuffer: Buffer
): Promise<Buffer> {
  const { width, height } = await sharp(inputBuffer).metadata();
  const size = Math.max(width ?? 1024, height ?? 1024);
  return sharp(inputBuffer)
    .autoOrient()                     // EXIF orientation applied + tag removed
    .resize(size, size, {
      fit: "contain",                 // letterbox, no crop
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()                            // intermediate lossless before Gemini
    .toBuffer();                      // all metadata stripped by default
}
```

**Why `autoOrient()` not `rotate()`:** `rotate()` with no args calls `autoOrient()` for back-compat, but calling `autoOrient()` directly is explicit and immune to future behavior changes. Both strip the EXIF Orientation tag; `toBuffer()` strips all remaining EXIF.

**Why square before Gemini (ENHC-05):** The `aspectRatio` parameter on image editing calls is ignored/inconsistently applied in the current Gemini image model (confirmed bug in the ROADMAP). Normalizing to square before submission gives the model a consistent input shape and avoids unpredictable output dimensions.

### Pattern 7: checkCredits slideCount Extension (BILL-01)

`checkCredits` current signature: `(userId, operationType, isVideo?)`.

New signature (backwards compatible):
```typescript
export async function checkCredits(
  userId: string,
  operationType: "generate" | "edit" | "transcribe",
  isVideo?: boolean,
  slideCount?: number   // NEW: undefined or 1 = single image; 2..8 = carousel
): Promise<CreditStatus>
```

Inside the function, `estimatedBaseCostMicros` is multiplied by `Math.max(slideCount ?? 1, 1)` before comparison:
```typescript
const slideMultiplier = Math.max(slideCount ?? 1, 1);
const estimatedCostMicros = Math.max(
  Math.round(estimatedBaseCostMicros * slideMultiplier), 0
);
```

All existing callers pass `slideCount` implicitly as `undefined`, which resolves to multiplier 1. No regressions.

### Anti-Patterns to Avoid

- **Multi-turn without thought_signature:** Sending slide 1 buffer as bare `inlineData` in the user turn (not the model turn) breaks the visual consistency and may produce 400 errors from Gemini 3.x models. The buffer must be in a `role: "model"` part, and the `thoughtSignature` field must be present if the response included one.
- **N text calls for N slides:** Violates CRSL-02. One master text call, one output JSON with all slide prompts.
- **Caption quality per slide:** CRSL-09 explicitly prohibits this. `ensureCaptionQuality` runs once on the unified caption, not inside the slide generation loop.
- **`enforceExactImageText` on carousel slides:** CRSL-10. Skip this entirely for carousel. It adds latency per slide and is scoped to single-image posts in v1.1.
- **Logo overlay on enhancement results:** ENHC-08. Enhancement service never calls `applyLogoOverlay`.
- **Pre-screening with the image model:** The image model (`gemini-3.1-flash-image-preview`) does not support `responseSchema` / structured output. Use `gemini-2.5-flash` (text model with vision) for pre-screen.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EXIF removal | Custom EXIF byte manipulation | `sharp().autoOrient().toBuffer()` | `toBuffer()` strips all metadata by default; `autoOrient()` corrects orientation before stripping the tag |
| Image square normalization | Custom resize math | `sharp().resize(size, size, { fit: 'contain' })` | Handles all aspect ratios, background fill, no quality loss |
| WebP encoding + thumbnail | Custom codec pipeline | `processImageWithThumbnail()` (existing) | Already in `image-optimization.service.ts`, consistent quality settings |
| Structured JSON output from Gemini | String parsing with regex | `responseSchema` + `responseMimeType: "application/json"` | Gemini guarantees schema adherence; string parsing fails on edge cases |
| Progress reporting | Custom HTTP chunking | `server/lib/sse.ts` — `SSEWriter` interface | Phase 7 passes the SSEWriter into service calls; services don't own SSE directly |
| Storage upload | Direct Supabase client file write | `uploadFile()` from `server/storage.ts` | Handles bucket, content-type, and public URL consistently |

---

## Runtime State Inventory

> This phase adds new service files only. No existing runtime state is renamed or migrated.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — new services write new rows/files | None |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None — same `SUPABASE_*` + user Gemini API key pattern | None |
| Build artifacts | None | None |

---

## Common Pitfalls

### Pitfall 1: Missing thought_signature on Gemini 3.x Multi-Turn Image Calls

**What goes wrong:** Slides 2..N return HTTP 400 "validation error" or produce images with no visual relation to slide 1.
**Why it happens:** Gemini 3+ image models require `thought_signature` to be echoed back in the model turn's image part. Raw `inlineData` without the signature is rejected or treated as a new generation context.
**How to avoid:** Extract `thoughtSignature` from slide 1's response parts. Attach it to the image part in the model turn. Wrap in try-catch and fall back to single-turn with `shared_style` injected.
**Warning signs:** HTTP 400 with "thought signature" in error message; generated slides have completely different color palettes or compositions from slide 1.

### Pitfall 2: Rate Limit 429 on Sequential Slide Generation

**What goes wrong:** Slide 3 or 4 hits a 429 RESOURCE_EXHAUSTED even when requests are spaced apart.
**Why it happens:** `gemini-3.1-flash-image-preview` runs on Dynamic Shared Quota. The Tier 1 RPM is approximately 10–15 RPM (confirmed from community reports; not officially documented). Sequential generation of 8 slides takes 8 API calls; with ~10s latency per image, 8 slides = ~80s, well inside 260s but close to the IPM quota boundary.
**How to avoid:** Add a 3-second delay between slide calls (`await new Promise(r => setTimeout(r, 3000))`). Implement one retry with exponential backoff (wait 15s) on 429. Log the 429 as a slide failure and apply the partial-success contract (CRSL-07) if >= 50% of slides (including slide 1) succeed.
**Warning signs:** 429 errors starting at slide 3–4; error message contains "RESOURCE_EXHAUSTED".

### Pitfall 3: Pre-Screen False Positive Rejection on Niche Products

**What goes wrong:** Cosmetics packaging, dark products, or food with a person's face visible in the background gets rejected as `face_or_person`.
**Why it happens:** Vision classifiers are aggressive about face detection. A product photo that incidentally includes a model in the background triggers rejection.
**How to avoid:** Only reject on `"high"` or `"medium"` confidence. Return `rejection_category: "none"` on `"low"` confidence. The pre-screen prompt explicitly says "when in doubt, accept." The image model's own safety filters handle truly harmful content downstream.
**Warning signs:** Users reporting valid product photos being rejected.

### Pitfall 4: EXIF Orientation Producing Rotated Images After Upload

**What goes wrong:** Phone-captured product photos arrive with EXIF orientation tags. Without `autoOrient()`, the image is stored sideways in Supabase Storage.
**Why it happens:** JPEG files from mobile cameras often store the image in landscape bytes with a rotation tag. `sharp()` without `autoOrient()` passes through the bytes, which Supabase and browsers handle inconsistently.
**How to avoid:** Always call `sharp(buffer).autoOrient()` as the first step in the enhancement pipeline, before square normalization and before Gemini submission.
**Warning signs:** Enhancement results appear rotated 90° in the frontend.

### Pitfall 5: Square Normalization Destroying Non-Square Product Silhouettes

**What goes wrong:** A tall bottle product photo gets padded with white bars top/bottom after square normalization, causing Gemini to generate a scene that treats the white area as part of the composition.
**Why it happens:** `fit: 'contain'` pads to square; if the padding is a high percentage of the frame, Gemini may treat it as white-space foreground.
**How to avoid:** Use `fit: 'contain'` with `background: { r: 255, g: 255, b: 255, alpha: 1 }` (white) — this is the best choice among contain/cover/fill for product photos. Cover crops the subject; fill distorts it. White padding is conventional in product photography and signals "background" to the model. Enhancement prompt should include "the product is centered in the image; ignore white padding areas."
**Warning signs:** Output images show product floating in white space rather than placed in scenery.

### Pitfall 6: Slide Count Off-by-One in Partial Success

**What goes wrong:** `posts.slide_count` records the requested slide count, not the actual successful count, causing gallery to show "Carousel · 8" when only 5 slides were saved.
**Why it happens:** Setting `slide_count` before the generation loop completes, or not counting successful DB inserts.
**How to avoid:** Track successful slide inserts into `post_slides` in an array. After the loop, set `slide_count = successfulSlides.length`. Apply partial-success contract only after loop completion.

---

## Code Examples

### Carousel Master Text Call Prompt Shape

```typescript
// Source: locked decision from ROADMAP + CRSL-02 requirement
const carouselMasterPrompt = `
You are an Art Director planning a ${slideCount}-slide Instagram carousel for ${brand.company_name}.

Brand: ${brand.company_name} (${brand.company_type})
Colors: ${brand.color_1}, ${brand.color_2}, ${brand.color_3}
Mood: ${postMood}
Aspect ratio: ${aspectRatio}
User direction: ${prompt}
Language: ${contentLanguage}

Return ONLY valid JSON with this exact shape:
{
  "shared_style": "Dense visual style descriptor (2-3 sentences): lighting setup, color palette, composition style, mood, texture, typography direction. Must be specific enough that an image generator can reproduce the same visual feel across all slides.",
  "slides": [
    { "slide_number": 1, "image_prompt": "Self-contained image prompt for slide 1 incorporating the shared style. No text on image." },
    ...
  ],
  "caption": "Unified Instagram caption for the carousel post with hashtags."
}

Requirements:
- slide_number starts at 1
- Each image_prompt is self-contained (includes shared_style inline)
- caption is written in ${contentLanguage}
- No on-image text (CRSL-10: text rendering skipped for carousel in v1.1)
- All ${slideCount} slides must be present
`;
```

### Enhancement Prompt (ENHC-04 Subject Preservation)

```typescript
// Source: ENHC-04 requirement + pattern from existing gemini.service.ts buildContextPrompt
const enhancementPrompt = `
You are a professional product photographer and AI retoucher.

Task: Place this product in a new background scene while preserving it exactly.

Scenery: ${scenery.prompt_snippet}

CRITICAL preservation rules:
- The product's shape, silhouette, color, proportions, branding, and surface texture must remain identical.
- Do NOT alter, resize, rotate, or stylize the product itself.
- Do NOT add text, logos, or overlays.
- The product is the hero subject; the scenery is the background context only.
- If the product has a label, keep the label legible and unmodified.
- Output: 1:1 square image with the product centered and naturally lit within the scenery.
`;
```

### Partial Success Loop (CRSL-07 contract)

```typescript
// Source: locked ROADMAP decision — partial success at >= 50% slides including slide 1
const successfulSlides: Array<{ slideNumber: number; imageUrl: string; thumbnailUrl: string | null }> = [];
let slide1Succeeded = false;

for (let i = 0; i < slideCount; i++) {
  try {
    const result = await generateSlideN(/* ... */);
    if (i === 0) slide1Succeeded = true;
    successfulSlides.push(result);
  } catch (err) {
    console.warn(`Slide ${i + 1} failed:`, err);
    // continue — collect partial results
  }
}

const successRate = successfulSlides.length / slideCount;
const isPartialSuccess = slide1Succeeded && successRate >= 0.5;
const isFullFailure = !slide1Succeeded || successfulSlides.length === 0;

if (isFullFailure) {
  throw new Error("Carousel generation failed: slide 1 did not complete.");
}

const postStatus = successfulSlides.length === slideCount ? "completed" : "draft";
```

### checkCredits slideCount Extension (BILL-01)

```typescript
// Source: server/quota.ts — extend existing checkCredits signature
// Backwards compatible: undefined slideCount = multiplier 1

export async function checkCredits(
  userId: string,
  operationType: "generate" | "edit" | "transcribe",
  isVideo: boolean = false,
  slideCount?: number
): Promise<CreditStatus> {
  const slideMultiplier = Math.max(slideCount ?? 1, 1);
  // ... existing early returns for own-api-key users unchanged ...
  const estimatedBaseCostMicros = await estimateBaseCostMicros(userId, operationType, isVideo);
  const estimatedCostMicros = Math.max(
    Math.round(estimatedBaseCostMicros * slideMultiplier), 0
  );
  // remainder of function uses estimatedCostMicros — no other changes
}
```

### Safety Timer (CRSL-06, 260s)

```typescript
// Source: existing generate.routes.ts safetyTimer pattern (line 329-336)
// Services don't own the timer — they receive an AbortSignal or check sse.isClosed()
// The 260s safety timer is set at the route layer (Phase 7), not inside the service

// Inside carousel-generation.service.ts — check for signal between slides
if (signal?.aborted) {
  throw new Error("Generation aborted: safety timeout reached");
}
```

The service function signature should accept an optional `AbortSignal` from the route layer:
```typescript
export async function generateCarousel(
  params: CarouselGenerationParams,
  signal?: AbortSignal
): Promise<CarouselGenerationResult>
```

---

## State of the Art

| Old Assumption | Current Reality | When Changed | Impact |
|----------------|-----------------|--------------|--------|
| Bare inlineData reference for multi-turn consistency | Requires `thought_signature` propagation in Gemini 3.x image models | Gemini 3 release (Feb 2026) | Multi-turn implementation must extract and echo back `thoughtSignature` from slide 1 response |
| `rotate()` strips EXIF | `autoOrient()` is the explicit API; `rotate()` calls `autoOrient` for back-compat | sharp 0.32+ | Use `autoOrient()` explicitly |
| `aspectRatio` param in image editing calls is respected | Confirmed bug: parameter is ignored for editing calls | Observed and documented by Phase 5 research | Pre-normalize to 1:1 with sharp before submitting enhancement uploads (ENHC-05) |
| Image model supports structured output / responseSchema | Image generation models (gemini-x.x-flash-image-preview) do NOT support responseSchema | Current (April 2026) | Pre-screen MUST use the text model (gemini-2.5-flash), not the image model |

**Deprecated in this codebase:**
- `rotate()` without args: call `autoOrient()` directly in new service code.

---

## Timing Math: Sanity Check (CRSL-06)

**260s safety timer budget:**

| Step | Estimated Duration | Source |
|------|-------------------|--------|
| Master text call (gemini-2.5-flash) | 3–8s | Observed in existing generate flow |
| Slide 1 image generation | 6–12s | Community reports (6.5–10.4s observed per image) |
| Slides 2..N per slide (with 3s delay) | ~(10 + 3)s × (N-1) | Conservative estimate |
| Post-slide sharp processing + thumbnail | ~1s per slide | Existing processImageWithThumbnail |
| DB inserts (post + slides) | ~1–2s | Existing pattern |

**8-slide worst case:**
- Text call: 8s
- Slide 1: 12s
- Slides 2..8 (7 slides × 13s): 91s
- Processing 8 slides: 8s
- DB: 2s
- **Total: ~121s** — fits inside 260s with 53% headroom.

**Conclusion:** Sequential with 3s inter-slide delay fits comfortably inside 260s for 8 slides. The 2-concurrent experiment (Phase 7 QA item, not a v1.1 ship gate) would halve slide generation time but requires confirming it does not breach the ~10–15 RPM Tier 1 quota.

---

## Open Questions

1. **Exact IPM/RPM quota for gemini-3.1-flash-image-preview on Tier 1**
   - What we know: Tier 1 RPM is approximately 10–15 (community-reported); official docs redirect to AI Studio dashboard
   - What's unclear: Whether IPM is a separate quota from RPM, and whether sequential 8-call usage over ~100s hits it
   - Recommendation: Set `SLIDE_GENERATION_DELAY_MS = 3000` as a constant in `carousel-generation.service.ts`. Add a log line on 429 with retry count so production data informs future tuning.

2. **thought_signature presence guarantee**
   - What we know: Gemini 3.x model responses include `thought_signature` on image parts; missing it causes 400 on next multi-turn call
   - What's unclear: Whether gemini-3.1-flash-image-preview always returns `thought_signature` or only under certain conditions
   - Recommendation: Extract `thoughtSignature` defensively (`imagePart?.thoughtSignature ?? null`). If null, fall back to single-turn with bare `inlineData` reference (which may succeed or produce style drift — log it).

3. **Enhancement result aspect ratio**
   - What we know: Gemini ignores `aspectRatio` in editing calls; input is normalized to 1:1 by sharp
   - What's unclear: Whether the editing model output is guaranteed 1:1 when input is 1:1
   - Recommendation: After receiving the enhancement buffer, verify dimensions via `sharp(buf).metadata()`. If not square, re-square with `contain` before upload. Add warning log if re-squaring is needed.

---

## Environment Availability

> Phase 6 is code-only (new service files + quota.ts edit). No new external tools required.

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `sharp` npm package | ENHC-03, ENHC-05, thumbnails | Already in deps | ^0.33 | — |
| Gemini API (text model) | Master text call, pre-screen | Runtime (user API key) | gemini-2.5-flash | Local fallback in gemini.service.ts |
| Gemini API (image model) | Slide generation, enhancement | Runtime (user API key) | gemini-3.1-flash-image-preview | Partial success + 400 surfaced to client |
| Supabase Storage | Upload slides + enhancement | Already configured | admin client | — |

---

## Validation Architecture

> nyquist_validation not explicitly disabled in .planning/config.json — treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | TypeScript compile check (`npm run check`) + manual integration test script |
| Config file | tsconfig.json (existing) |
| Quick run command | `npm run check` |
| Full suite command | `npx tsx scripts/verify-phase-06.ts` (to be created in Wave 0) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRSL-02 | generateCarousel produces ONE text call | unit (mock fetch) | `npm run check` + integration | ❌ Wave 0 |
| CRSL-03 | Slide 2..N requests include thought_signature from slide 1 | unit (mock fetch) | `npm run check` + integration | ❌ Wave 0 |
| CRSL-06 | AbortSignal propagation — service throws on abort | unit | `npm run check` | ❌ Wave 0 |
| CRSL-09 | ensureCaptionQuality called exactly once per carousel | unit (mock) | `npm run check` | ❌ Wave 0 |
| CRSL-10 | enforceExactImageText never called in carousel path | unit (mock) | `npm run check` | ❌ Wave 0 |
| ENHC-03 | EXIF strip: autoOrient() present in pipeline | code review + integration | `npm run check` | ❌ Wave 0 |
| ENHC-04 | Enhancement prompt contains preservation language | code review | — | ❌ Wave 0 |
| ENHC-05 | Input normalized to 1:1 before Gemini call | unit (sharp mock) | `npm run check` | ❌ Wave 0 |
| ENHC-06 | preScreenUpload returns rejection for face photo | integration test | `npx tsx scripts/verify-phase-06.ts` | ❌ Wave 0 |
| BILL-01 | checkCredits with slideCount=8 returns 8x cost estimate | unit | `npm run check` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run check` (TypeScript clean)
- **Per wave merge:** `npx tsx scripts/verify-phase-06.ts` (smoke test with live Gemini key)
- **Phase gate:** Both green before Phase 7 begins

### Wave 0 Gaps
- [ ] `scripts/verify-phase-06.ts` — integration smoke test (mirrors Phase 5 verifier pattern)
- [ ] No unit test framework wired; TypeScript compile is the primary automated gate for Phase 6

---

## Sources

### Primary (HIGH confidence)
- `server/services/gemini.service.ts` — raw-fetch pattern, JSON parsing, fallback structure
- `server/services/image-generation.service.ts` — generateImage/editImage, inlineData pattern
- `server/services/image-optimization.service.ts` — sharp pipeline, WebP encode, thumbnail
- `server/quota.ts` — checkCredits/deductCredits/recordUsageEvent — extension target
- `server/lib/sse.ts` — SSEWriter interface (Phase 7 consumer of Phase 6 services)
- `shared/schema.ts` — carouselRequestSchema, enhanceRequestSchema, postSlideSchema, scenerySchema
- `sharp.pixelplumbing.com/api-operation` — autoOrient() behavior (verified)
- `sharp.pixelplumbing.com/api-resize` — resize fit options (verified)
- `ai.google.dev/gemini-api/docs/structured-output` — responseSchema + responseMimeType (verified)
- `ai.google.dev/gemini-api/docs/thought-signatures` — thought_signature propagation requirement (verified)

### Secondary (MEDIUM confidence)
- `ai.google.dev/gemini-api/docs/image-generation` — multi-turn pattern, inlineData + thought_signature for conversation
- Community forum: `discuss.ai.google.dev/t/gemini-2-5-flash-image-frequent-429-resource-exhausted` — 6.5–10.4s per-image latency, Tier 1 sequential 429 behavior

### Tertiary (LOW confidence — flag for validation)
- Tier 1 RPM 10–15 for gemini-3.1-flash-image-preview: community-reported, not in official docs. Check AI Studio dashboard before finalizing `SLIDE_GENERATION_DELAY_MS`.
- `blog.wentuo.ai` — "free tier: 10 RPM, 1500 RPD" for image preview: third-party source only.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing deps verified in codebase
- Architecture patterns (thought_signature): MEDIUM — documented in official Gemini API docs but exact behavior under retry conditions unverified
- EXIF strip (sharp): HIGH — verified against official sharp docs
- Pre-screen pattern: HIGH — structured output pattern verified against official Gemini docs; rejection taxonomy is prescriptive
- Rate limits: LOW — no official per-model IPM/RPM table published; community-sourced only
- Timing math: MEDIUM — based on community-reported latency (6.5–10.4s/image), not internal benchmarks

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (Gemini preview models change rapidly; re-verify thought_signature behavior before implementing)
