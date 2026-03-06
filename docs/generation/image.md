# Image Generation

## Model

**Default:** `gemini-3.1-flash-image-preview` (Nano Banana 2)
**Configurable via admin:** AI Models card → "Image Generation" dropdown

Alternative models available:
| Model ID | Name | Best For |
|----------|------|----------|
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | Default — best speed/quality balance |
| `gemini-3-pro-image-preview` | Nano Banana Pro | Complex prompts, professional assets, 4K |
| `gemini-2.5-flash-image` | Nano Banana | High-volume, low-latency, 1K max |

---

## Current Implementation

**File:** [`server/app-routes.ts`](../../server/app-routes.ts) ~line 911

### API Call (current)
```typescript
// Map 1200:628 (Facebook) → 16:9 since it's not a valid Gemini ratio
const geminiAspectRatio = aspect_ratio === "1200:628" ? "16:9" : aspect_ratio;
const resolvedImageResolution = image_resolution ?? "1K";

// Include reference images alongside the text prompt
const imageRequestParts = [
  { text: imagePrompt },
  ...reference_images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
];

const geminiImageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`;

const imageResponse = await fetch(geminiImageUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-goog-api-key": geminiApiKey,
  },
  body: JSON.stringify({
    contents: [{ parts: imageRequestParts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      image_config: {
        aspect_ratio: geminiAspectRatio,
        image_size: resolvedImageResolution,
      },
    },
  }),
});

// Extract image from response
const imagePart = candidates.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
generatedAssetBuffer = Buffer.from(imagePart.inlineData.data, "base64");
generatedAssetMimeType = imagePart.inlineData.mimeType || "image/png";
generatedAssetExtension = "png";
```

### What the Prompt Contains
The `image_prompt` comes from Phase 1 (text generation) and is enriched server-side with brand context:
- Brand name and industry
- Selected colors (up to 4)
- Style label (e.g., "Professional", "Playful")
- Mood label (e.g., "Promo", "Testimonial")
- Copy text to render on the image (if enabled)
- Logo instructions (if enabled)
- Aspect ratio hint

---

## API Capabilities (Nano Banana 2 — gemini-3.1-flash-image-preview)

### Aspect Ratios Supported
```
1:1   1:4   1:8
2:3   3:2   3:4
4:1   4:3   4:5   5:4
8:1   9:16  16:9  21:9
```

### Resolutions Supported
| Size | Tokens |
|------|--------|
| `512px` | 747 |
| `1K` (default) | 1120 |
| `2K` | 1120 |
| `4K` | 2000 |

### How to Pass Aspect Ratio & Resolution (correct API format)
```typescript
// The correct way — NOT currently implemented
generationConfig: {
  responseModalities: ["IMAGE"],
  image_config: {
    aspect_ratio: "16:9",   // e.g. "1:1", "4:5", "9:16"
    image_size: "2K",       // "512px" | "1K" | "2K" | "4K"
  },
}
```

---

## Status of Known Gaps

### 1. ✅ Aspect Ratio Now Passed to API
`image_config: { aspect_ratio, image_size }` is now included in the generation call.
`1200:628` (Facebook) is mapped to `16:9` server-side.

### 2. ✅ Resolution Now Selectable
`image_resolution` field added to the request schema (`"512px" | "1K" | "2K" | "4K"`).
Wizard step 5 shows a Resolution row. Passed as `image_size` in `image_config`. Defaults to `"1K"`.

### 3. ✅ aspect_ratio Enum Expanded
Now covers all 14 valid Gemini ratios + legacy `1200:628`.

### 4. ✅ Reference Images Forwarded to Image Model
Reference images are now sent as `inlineData` parts alongside the text prompt in the image generation request.

---

## What "Edit Post" Does

**Endpoint:** `POST /api/edit-post`

Takes the most recent image (or a specific version) and sends it back to the image model with an edit prompt. Uses the same image model. Creates a new record in `post_versions`.

This endpoint does support passing the existing image as input — which is the "image editing" mode of the Gemini image API.

---

## Image Storage

- **Bucket:** `user_assets`
- **Generated images path:** `{userId}/generated/{uuid}.png`
- **Edited versions path:** `{userId}/versions/{postId}-{uuid}.png` (post_versions table)
- **Thumbnails path:** `{userId}/thumbnails/{postId}-{uuid}.jpg` (video only)

---

## Image Generation Flow (Detailed)

```
User selects "Image" in step 0
  │
  └── Selects format in step 5 (e.g., Square 1:1) + resolution (e.g., 2K)
        │
        ▼
POST /api/generate  { content_type: "image", aspect_ratio: "1:1", image_resolution: "2K", ... }
        │
        ├── Phase 1: Text model generates image_prompt
        │
        └── Phase 2: Image model
              Request:
                model: gemini-3.1-flash-image-preview
                contents: [{ text: image_prompt }, ...reference_images as inlineData ]
                generationConfig: {
                  responseModalities: ["IMAGE"],
                  image_config: {
                    aspect_ratio: "1:1",    ✅ mapped from user selection
                    image_size: "2K",       ✅ from image_resolution field
                  }
                }
              Response:
                inlineData.data  →  base64 PNG  →  Buffer
                    │
                    ▼
              Upload to Supabase Storage
                    │
                    ▼
              Insert into posts table
                    │
                    ▼
              Return { image_url, caption, headline, ... }
```
