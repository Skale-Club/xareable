# AI Models

## Overview

All AI models are configurable by admin via the **Post Creation** admin tab → **AI Models** card.

Model IDs are stored in the `style_catalog` table (`ai_models` JSON column) and served via `GET /api/style-catalog`.

**Schema:** [`shared/schema.ts`](../../shared/schema.ts)
```typescript
export const aiModelsSchema = z.object({
  image_generation:    z.string().default("gemini-3.1-flash-image-preview"),
  text_generation:     z.string().default("gemini-2.5-flash"),
  audio_transcription: z.string().default("gemini-2.5-flash"),
  video_generation:    z.string().default("veo-3.1-generate-preview"),
});
```

---

## Text Generation

Used for: expanding user prompts, generating captions, headlines, image prompts.

| Model ID | Name | Notes |
|----------|------|-------|
| `gemini-2.5-flash` | Gemini 2.5 Flash | **Default.** Fast, cost-efficient, good reasoning |
| `gemini-2.5-pro` | Gemini 2.5 Pro | Higher quality, slower, more expensive |

**How it's used:**
```
POST /v1beta/models/{textModel}:generateContent
  Input:  brand context + user inputs + system prompt
  Output: JSON { headline, subtext, image_prompt, caption }
  Format: responseMimeType: "application/json"
```

---

## Image Generation

Used for: generating post images, editing existing images.

| Model ID | Name (Nano Banana) | Resolution | Aspect Ratios | Best For |
|----------|-------------------|------------|---------------|----------|
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | 512px–4K | All 14 ratios | **Default.** Speed + quality |
| `gemini-3-pro-image-preview` | Nano Banana Pro | 1K–4K | All 14 ratios | Professional, complex, text-heavy |
| `gemini-2.5-flash-image` | Nano Banana | 1K only | Subset | High-volume, low-latency |

### Supported Aspect Ratios (gemini-3.1-flash-image-preview)
```
1:1   1:4   1:8   2:3   3:2   3:4
4:1   4:3   4:5   5:4   8:1   9:16   16:9   21:9
```

### Supported Resolutions
| Code | Dimensions (1:1) | Image Token Cost |
|------|------------------|-----------------|
| `512px` | 512×512 | 747 |
| `1K` | 1024×1024 | 1120 |
| `2K` | 2048×2048 | 1120 |
| `4K` | 4096×4096 | 2000 |

### Unique Capabilities (gemini-3.1-flash-image-preview)
- Google Image Search grounding (visual context from web)
- Up to 14 reference images (10 object + 4 character)
- `1:4`, `4:1`, `1:8`, `8:1` ultra-wide ratios
- `512px` small resolution

### Unique Capabilities (gemini-3-pro-image-preview)
- Default "Thinking" mode for complex prompt reasoning
- Best for accurate text rendering in images
- Up to 14 reference images (6 object + 5 character)

### API Call Pattern
```typescript
// Correct pattern (with image_config)
{
  contents: [{ parts: [{ text: imagePrompt }] }],
  generationConfig: {
    responseModalities: ["IMAGE"],
    image_config: {
      aspect_ratio: "16:9",  // required for non-default ratios
      image_size: "1K",      // "512px" | "1K" | "2K" | "4K"
    }
  }
}
```

---

## Audio Transcription

Used for: converting voice notes to text in the wizard (step 1 microphone input).

| Model ID | Notes |
|----------|-------|
| `gemini-2.5-flash` | **Default.** Works well for speech |

**Endpoint:** `POST /api/transcribe`
**How it's used:** User holds mic button → records audio → base64 sent to server → Gemini transcribes → text injected into referenceText field.

---

## Video Generation

Used for: generating video posts with Veo.

| Model ID | Name | Audio | Max Res | Duration | Notes |
|----------|------|-------|---------|----------|-------|
| `veo-3.1-generate-preview` | Veo 3.1 | ✅ | 4K | 4/6/8s | **Default.** Best quality |
| `veo-3.1-fast-preview` | Veo 3.1 Fast | ✅ | 4K | 4/6/8s | Faster, lower cost |
| `veo-2` | Veo 2 | ❌ | 720p | 5-8s | Stable, silent only |

### Veo 3.1 Capabilities
- **Aspect ratios:** `"16:9"` and `"9:16"` only
- **Resolution:** `720p` (default), `1080p` (8s only), `4k` (8s only)
- **Duration:** `"4"`, `"6"`, `"8"` seconds
- **Input modes:** text-to-video, image-to-video, interpolation, reference images, video extension
- **Audio:** native audio from prompt — supports dialogue, SFX, ambient
- **Watermark:** SynthID

### Veo 3.1 API Call Pattern
```typescript
// Start async operation
POST /v1beta/models/veo-3.1-generate-preview:predictLongRunning
Body: {
  instances: [{
    prompt: string,
    image?: { imageBytes: string, mimeType: string }  // starting frame
  }],
  parameters: {
    aspectRatio: "16:9" | "9:16",
    durationSeconds: "4" | "6" | "8",   // not currently passed
    resolution: "720p" | "1080p" | "4k", // not currently passed
  }
}

// Poll operation
GET /v1beta/{operationName}
Headers: { x-goog-api-key }

// Extract video
response.generateVideoResponse.generatedSamples[0].video.uri
```

---

## Admin Configuration

**File:** [`client/src/components/admin/post-creation/ai-models-card.tsx`](../../client/src/components/admin/post-creation/ai-models-card.tsx)

The admin can change any model ID via dropdowns. Changes are saved to the `style_catalog` record in the database and take effect immediately for all users.

**Warning:** Changing `video_generation` to `veo-2` disables audio. Changing `image_generation` to `gemini-2.5-flash-image` limits resolution to 1K and removes some aspect ratios.

---

## Model Resolution per Task

```
User action              →  Model used
─────────────────────────────────────────────────────
Generate post (image)    →  text_generation  +  image_generation
Generate post (video)    →  text_generation  +  video_generation
Edit post image          →  image_generation  (with reference image)
Transcribe voice         →  audio_transcription
```
