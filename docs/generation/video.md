# Video Generation

## Model

**Default:** `veo-3.1-generate-preview`
**Configurable via admin:** AI Models card → "Video Generation" dropdown

| Model ID | Name | Audio | Max Resolution | Notes |
|----------|------|-------|----------------|-------|
| `veo-3.1-generate-preview` | Veo 3.1 | ✅ Native | 4K | Best, use this |
| `veo-3.1-fast-preview` | Veo 3.1 Fast | ✅ Native | 4K | Faster, lower cost |
| `veo-2` | Veo 2 | ❌ Silent | 720p | Legacy, stable |

---

## Key Facts About Veo 3.1

- **Audio is native** — the model generates synchronized audio from the prompt (dialogue, SFX, ambient)
- **Generation is asynchronous** — starts a long-running operation, must poll until done
- **Duration options:** `"4"`, `"6"`, `"8"` seconds (must be `"8"` for 1080p/4K)
- **Aspect ratios:** only `"16:9"` (landscape) or `"9:16"` (portrait)
- **Resolutions:** `"720p"` (default), `"1080p"`, `"4k"`
- **Latency:** min 11s, max ~6 minutes during peak hours
- **Output:** 24fps MP4
- **Watermark:** SynthID embedded in all videos
- **Video retention on Google servers:** 2 days

---

## Current Implementation

**File:** [`server/app-routes.ts`](../../server/app-routes.ts) ~line 815

### Step 1 — Aspect Ratio Mapping
```typescript
// Only 16:9 and 9:16 are valid for Veo
const videoAspectRatio = aspect_ratio === "9:16" ? "9:16" : "16:9";
```

### Step 2 — Build Video Prompt
```typescript
const videoPrompt = `Create a professional social media video in ${videoAspectRatio} aspect ratio for ${brand.company_name}.
${contextJson.image_prompt}
The video should feel on-brand (${brandStyleLabel}) and match the "${postMoodLabel}" mood.
Use brand colors ${brand.color_1}, ${brand.color_2}, ${brand.color_3}.
Keep motion smooth and visually engaging for social media.`;
```

### Step 3 — Start Long-Running Operation
```typescript
const predictVideoUrl = `https://generativelanguage.googleapis.com/v1beta/models/${videoModel}:predictLongRunning?key=${geminiApiKey}`;

const predictBody = {
  instances: [{
    prompt: videoPrompt,
    image?: { imageBytes: firstReferenceImage.data, mimeType }  // first reference image if provided
  }],
  parameters: { aspectRatio: videoAspectRatio },
};
```

### Step 4 — Polling Loop
```typescript
const maxPolls = 90;
const pollDelayMs = 4000; // 4 seconds between polls
// Total max wait: 90 × 4s = 360s = 6 minutes

for (let attempt = 0; attempt < maxPolls; attempt++) {
  if (operationData?.done) break;
  await sleep(pollDelayMs);
  operationData = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operationName}`,
    { headers: { "x-goog-api-key": geminiApiKey } }
  ).then(r => r.json());
}
```

### Step 5 — Extract Video URI
```typescript
// Multiple response shapes attempted (API shape varies)
const videoUri =
  operationData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
  operationData?.response?.generatedVideos?.[0]?.video?.uri ||
  operationData?.response?.generatedSamples?.[0]?.video?.uri;
```

### Step 6 — Download Video
```typescript
const videoFileResponse = await fetch(videoUri, {
  headers: { "x-goog-api-key": geminiApiKey },
});
generatedAssetBuffer = Buffer.from(await videoFileResponse.arrayBuffer());
generatedAssetMimeType = "video/mp4";
generatedAssetExtension = "mp4";
```

---

## Official API Format (for reference)

The official Veo 3.1 SDK pattern (Python) for comparison:

```python
# Start generation
operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt=prompt,
    image=first_frame_image,           # optional starting frame
    config=types.GenerateVideosConfig(
        aspect_ratio="9:16",           # "16:9" | "9:16"
        resolution="720p",             # "720p" | "1080p" | "4k"
        duration_seconds="8",          # "4" | "6" | "8"
        number_of_videos=1,
        last_frame=last_frame_image,   # optional (interpolation)
        reference_images=[...],        # up to 3 reference images (Veo 3.1 only)
    ),
)

# Poll
while not operation.done:
    time.sleep(10)
    operation = client.operations.get(operation)

# Download
video = operation.response.generated_videos[0]
client.files.download(file=video.video)
```

Our implementation uses the REST equivalent of this pattern, which is functionally the same.

---

## Video Generation Config Parameters

| Parameter | Current State | Notes |
|-----------|---------------|-------|
| `aspectRatio` | ✅ Passed (`"16:9"` or `"9:16"`) | Correctly mapped from user selection |
| `resolution` | ✅ Passed | From `video_resolution` field; defaults to `"720p"` |
| `durationSeconds` | ✅ Passed | From `video_duration` field; defaults to `"8"` |
| `referenceImages` | ⚠️ Partial | Only first image passed, as starting frame |
| `lastFrame` | ❌ Not implemented | Interpolation not supported |
| `numberOfVideos` | ❌ Not passed | Defaults to 1 (fine) |

---

## Thumbnail Handling

Since Veo returns a video file (no embedded thumbnail), a thumbnail must be created separately.

**Current flow:**
1. Server stores video, sets `thumbnail_url = null`
2. Client receives response with `thumbnail_url: null`
3. Client calls `extractVideoThumbnailJpeg(videoUrl)` — creates `<video>` element, seeks to 0.6s, draws to canvas, exports JPEG
4. Client POSTs the JPEG base64 to `POST /api/posts/:id/thumbnail`
5. Server uploads thumbnail to `{userId}/thumbnails/{postId}-{uuid}.jpg`
6. Server updates `posts.thumbnail_url`

**File:** [`client/src/lib/media.ts`](../../client/src/lib/media.ts)

> ⚠️ **Gap:** Client-side thumbnail extraction can fail if the video is not CORS-accessible or if the browser cannot seek the video. A server-side thumbnail extraction (using ffmpeg or a canvas library) would be more reliable.

---

## Video Prompt Best Practices (for the server prompt builder)

From the Veo documentation:

```
Effective video prompt structure:
  [Shot type] of [subject] [action], [style], [camera motion], [ambiance]

Audio cues:
  - Dialogue: put in quotes → "What did you find?" he whispered.
  - Sound effects: describe explicitly → tires screeching, engine roaring
  - Ambient: describe the environment → faint electronic hum, birds chirping

Negative prompts:
  ❌ Don't say "no cars" or "don't include text"
  ✅ Do describe what you want instead: "empty street", "clean background"
```

**Current video prompt (server-built):**
```
Create a professional social media video in {aspectRatio} aspect ratio for {brandName}.
{image_prompt from text model}
The video should feel on-brand ({style}) and match the "{mood}" mood.
Use brand colors {color1}, {color2}, {color3}.
Keep motion smooth and visually engaging for social media.
```

> 💡 **Improvement opportunity:** The video prompt currently reuses the `image_prompt` from the text model, which is designed for static visuals. A dedicated `video_prompt` output from the text model (with motion descriptions, camera moves, audio cues) would produce better results.

---

## Current Gaps

### ✅ Fixed: Video Format List Included Invalid Ratios
`4:5` and `1:1` removed from `video_formats` defaults. Only `9:16` and `16:9` remain.

### ✅ Fixed: Duration and Resolution Not Passed
`durationSeconds` and `resolution` are now passed to the Veo API. Selectable in wizard step 5.

### ✅ Fixed: Video Prompt Reused Image Prompt
Text model now outputs a dedicated `video_prompt` with motion direction and audio cues when `content_type === "video"`.

---

### 1. `predictLongRunning` vs `generate_videos`
The implementation uses the older `predictLongRunning` Vertex-style endpoint. The official SDK uses `generate_videos` → `client.operations.get()`. Both work via REST but the response shapes may diverge. The multi-fallback URI extraction (`||` chain) exists because of this uncertainty.

### 2. Video Format Options Include Invalid Ratios
**File:** [`shared/schema.ts`](../../shared/schema.ts) — `video_formats` default

```typescript
// These are in video_formats but NOT valid Veo aspect ratios:
{ id: "feed-video",   value: "4:5", ... }   // ❌ Veo only supports 16:9 and 9:16
{ id: "square-video", value: "1:1", ... }   // ❌ Veo only supports 16:9 and 9:16
```

When a user selects "Feed Video (4:5)" or "Square Video (1:1)", the server maps it to `"16:9"` silently. This is confusing — the video format list should only show valid options.

**Fix:** Remove `4:5` and `1:1` from `video_formats` defaults. Keep only:
```typescript
video_formats: [
  { id: "reel",           value: "9:16", label: "Reel / Short", subtitle: "TikTok / Reels",   icon: "RectangleVertical" },
  { id: "landscape-video", value: "16:9", label: "Landscape",  subtitle: "YouTube / Facebook", icon: "RectangleHorizontal" },
]
```

### 3. No Duration Selection
Users cannot choose between 4s, 6s, or 8s videos. All videos default to 8 seconds.

### 4. No Resolution Selection
All videos generate at 720p. 1080p and 4K are available but not exposed.

### 5. Audio Not Prompted Explicitly
The video prompt doesn't include audio direction (dialogue, SFX cues). Veo 3.1 natively generates audio based on visual context, but explicit prompting for audio would improve results.

### 6. No Video Extension Support
The `extend video` Veo feature (continue a previously generated video) is not implemented.

### 7. Client-Side Thumbnail Extraction is Fragile
CORS restrictions or browser limitations can cause the thumbnail step to fail silently.

---

## Video Generation Flow (Detailed)

```
User selects "Video" in step 0
  │
  └── Selects format in step 5 (only 9:16 or 16:9 should appear)
        │
        ▼
POST /api/generate  { content_type: "video", aspect_ratio: "9:16", ... }
        │
        ├── Phase 1: Text model → image_prompt (used as video_prompt base)
        │
        └── Phase 2: Veo 3.1
              ├── Map aspect_ratio → "9:16" or "16:9"
              ├── Build video prompt (brand context + image_prompt)
              ├── POST predictLongRunning → get operationName
              ├── Poll every 4s (up to 6 min) → operationData.done
              ├── Extract videoUri from response
              └── Download MP4 buffer
                    │
                    ▼
              Upload to Supabase Storage  →  publicUrl
                    │
                    ▼
              Insert posts { thumbnail_url: null }
                    │
                    ▼
              Return { image_url: videoUrl, thumbnail_url: null, ... }
                    │
        Client receives response
                    │
                    ▼
        extractVideoThumbnailJpeg(videoUrl)
                    │
                    ▼
        POST /api/posts/:id/thumbnail  →  update thumbnail_url
```
