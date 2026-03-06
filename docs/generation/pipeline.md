# Generation Pipeline — End to End

This document traces the full lifecycle of a content generation request, from the user clicking "Generate Post" to the final asset appearing in the gallery.

---

## 1. Frontend Wizard (6 Steps)

**File:** [`client/src/components/post-creator-dialog.tsx`](../../client/src/components/post-creator-dialog.tsx)

The user builds the generation context step by step:

| Step | Title | State Set |
|------|-------|-----------|
| 0 | Content Type | `contentType: "image" \| "video"`, resets `aspectRatio` |
| 1 | Reference Material | `referenceText`, `referenceImages` (up to 4 files as base64) |
| 2 | Post Mood | `postMood` (id from catalog) |
| 3 | Text on Image | `copyText`, `useText` toggle |
| 4 | Logo Placement | `useLogo`, `logoPosition` |
| 5 | Format / Size | `aspectRatio` (from image or video format list) |

On "Generate Post / Generate Video", the wizard calls `handleGenerate()`.

---

## 2. Client — API Call

```typescript
// post-creator-dialog.tsx ~line 293
const res = await apiRequest("POST", "/api/generate", {
  reference_text,       // optional string
  reference_images,     // optional array of { mimeType, data (base64) }
  post_mood,            // string id
  copy_text,            // optional string
  aspect_ratio,         // e.g. "1:1", "9:16"
  use_logo,             // boolean
  logo_position,        // e.g. "bottom-right"
  content_language,     // e.g. "en"
  content_type,         // "image" | "video"
});
```

The request is validated by `generateRequestSchema` in `shared/schema.ts`.

---

## 3. Server — Authentication & Setup

**File:** [`server/app-routes.ts`](../../server/app-routes.ts) (primary route, ~line 587)

```
POST /api/generate
  │
  ├── Verify JWT  →  get user from Supabase Auth
  ├── Fetch profile  →  check api_key, is_admin, is_affiliate
  ├── Credit check  →  non-admin/non-affiliate users need credits
  ├── Fetch brand  →  company_name, colors, mood, logo_url
  ├── Fetch style catalog  →  models, formats, moods
  └── Resolve Gemini API key  →  server key OR user's own key
```

Model IDs are resolved from the catalog:
```typescript
const textModel  = catalog.ai_models?.text_generation  || "gemini-2.5-flash";
const imageModel = catalog.ai_models?.image_generation || "gemini-3.1-flash-image-preview";
const videoModel = catalog.ai_models?.video_generation || "veo-3.1-generate-preview";
```

---

## 4. Server — Phase 1: Text Generation

**Model:** `gemini-2.5-flash` (configurable)

**Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/{textModel}:generateContent`

The server builds a structured prompt with:
- Brand context (name, colors, style, mood)
- User reference text / images
- Requested `copyText`, `aspectRatio`, `contentLanguage`
- Instruction to return JSON

**Output (parsed JSON):**
```typescript
{
  headline: string,      // short bold text for the visual
  subtext: string,       // supporting line
  image_prompt: string,  // detailed visual prompt for Phase 2
  caption: string,       // social media caption for the post
}
```

---

## 5. Server — Phase 2: Asset Generation

### 5a. Image Path

**Model:** `gemini-3.1-flash-image-preview` (configurable)

**Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/{imageModel}:generateContent`

```
Request:
  contents: [{ text: image_prompt }]
  generationConfig: { responseModalities: ["TEXT", "IMAGE"] }

Response:
  candidates[0].content.parts  →  find part where inlineData.mimeType starts with "image/"
  generatedAssetBuffer = Buffer.from(part.inlineData.data, "base64")
  generatedAssetMimeType = "image/png"
  generatedAssetExtension = "png"
```

> ✅ `aspect_ratio` is passed via `image_config.aspect_ratio`. `1200:628` is mapped to `16:9`.
> ✅ Image resolution is selectable via `image_resolution` field → `image_config.image_size`.

### 5b. Video Path

**Model:** `veo-3.1-generate-preview`

**Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/{videoModel}:predictLongRunning`

```
Request body:
  instances: [{
    prompt: videoPrompt,
    image?: { imageBytes, mimeType }   // first reference image if provided
  }]
  parameters: { aspectRatio: "16:9" | "9:16" }

Returns: operation object with .name
```

**Polling loop** (up to 90 × 4s = 6 minutes):
```
GET https://generativelanguage.googleapis.com/v1beta/{operationName}
  →  check operationData.done
  →  when done: extract videoUri from response
```

**Video URI extraction (multiple response shapes tried):**
```typescript
const videoUri =
  operationData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
  operationData?.response?.generatedVideos?.[0]?.video?.uri ||
  operationData?.response?.generatedSamples?.[0]?.video?.uri;
```

**Download:**
```
GET {videoUri}  (with x-goog-api-key header)
  →  generatedAssetBuffer = Buffer.from(arrayBuffer)
  →  generatedAssetMimeType = "video/mp4"
```

> ⚠️ Uses `predictLongRunning` (older Vertex-style endpoint). Migration to `generate_videos` may be needed in the future. See [roadmap.md](roadmap.md) item #1.
> ✅ `durationSeconds` and `resolution` are now passed from `video_duration` and `video_resolution` fields.

---

## 6. Server — Upload to Supabase Storage

```typescript
const fileName = `${user.id}/generated/${randomUUID()}.${ext}`;
await supabase.storage.from("user_assets").upload(fileName, buffer, {
  contentType: mimeType,
  upsert: false,
});
const { publicUrl } = supabase.storage.from("user_assets").getPublicUrl(fileName);
```

Bucket: `user_assets`
Path structure: `{userId}/generated/{uuid}.{png|mp4}`

---

## 7. Server — Database Insert

```typescript
await supabase.from("posts").insert({
  user_id,
  image_url: publicUrl,           // the main asset URL (image or video)
  thumbnail_url: content_type === "video" ? null : publicUrl,
  content_type,                   // "image" | "video"
  caption,
  ai_prompt_used: fullPromptText,
  status: "generated",
});
```

For videos, `thumbnail_url` starts as `null`. It is filled in a separate step (see §8).

---

## 8. Server — Response to Client

```typescript
return res.json({
  image_url,       // public asset URL
  thumbnail_url,   // null for video, same as image_url for images
  content_type,
  caption,
  headline,
  subtext,
  post_id,
});
```

---

## 9. Client — Post-Generation (Video Thumbnail)

For videos, the client extracts a thumbnail from the video file client-side and uploads it:

```typescript
// post-creator-dialog.tsx ~line 317
if (contentType === "video" && !data.thumbnail_url) {
  const thumbnailBlob = await extractVideoThumbnailJpeg(data.image_url);
  const base64 = await blobToBase64(thumbnailBlob);
  await apiRequest("POST", `/api/posts/${data.post_id}/thumbnail`, {
    file: base64,
    contentType: "image/jpeg",
  });
}
```

**Thumbnail extraction:** [`client/src/lib/media.ts`](../../client/src/lib/media.ts)
- Creates a `<video>` element, seeks to 0.6s, renders frame to canvas, exports as JPEG

**Thumbnail upload endpoint:** `POST /api/posts/:id/thumbnail`
- Only allowed for `content_type === "video"` posts
- Stores at `{userId}/thumbnails/{postId}-{uuid}.jpg`
- Updates `posts.thumbnail_url`

---

## 10. Credits Deduction

Credits are deducted after successful generation for non-admin/non-affiliate users.

```typescript
// After successful upload and DB insert
await deductCredits(userId, tokensUsed);
```

Token tracking covers text generation tokens. Image/video generation does not report tokens directly.

---

## Full Sequence Diagram

```
Client                    Server                    Gemini / Veo          Supabase
  │                         │                            │                    │
  │── POST /api/generate ──▶│                            │                    │
  │                         │── verify JWT ─────────────────────────────────▶│
  │                         │── fetch profile/brand ─────────────────────────▶│
  │                         │                            │                    │
  │                         │── generateContent (text) ─▶│                    │
  │                         │◀─ { headline, image_prompt, caption } ──────────│
  │                         │                            │                    │
  │                    [if IMAGE]                        │                    │
  │                         │── generateContent (image) ▶│                    │
  │                         │◀─ base64 PNG ──────────────│                    │
  │                         │                            │                    │
  │                    [if VIDEO]                        │                    │
  │                         │── predictLongRunning ──────▶│                    │
  │                         │   [poll loop, up to 6min]  │                    │
  │                         │◀─ videoUri ────────────────│                    │
  │                         │── fetch videoUri ──────────▶│                    │
  │                         │◀─ MP4 bytes ───────────────│                    │
  │                         │                            │                    │
  │                         │── upload asset ────────────────────────────────▶│
  │                         │── insert post ─────────────────────────────────▶│
  │                         │◀─ publicUrl ───────────────────────────────────│
  │◀─ { image_url, ... } ───│                            │                    │
  │                         │                            │                    │
  │ [if VIDEO, client-side] │                            │                    │
  │── extractVideoThumbnail │                            │                    │
  │── POST /api/posts/:id/thumbnail                      │                    │
  │                         │── upload thumbnail ────────────────────────────▶│
  │                         │── update post ─────────────────────────────────▶│
  │◀─ 200 OK ───────────────│                            │                    │
```
