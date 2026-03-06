# Roadmap — Known Issues & Planned Improvements

This document tracks all identified gaps, bugs, and planned work for the content generation system. Items are grouped by priority.

Legend: ✅ Done · 🔴 High · 🟡 Medium · 🟢 Low

---

## ✅ Completed

### 1. Image Aspect Ratio Not Passed to API
**Fixed in:** `server/app-routes.ts`

Added `image_config: { aspect_ratio, image_size }` to the Gemini image generation call.
Also added `1200:628 → 16:9` mapping since Facebook's ratio is not a valid Gemini value.

---

### 2. Video Format List Included Invalid Veo Ratios
**Fixed in:** `shared/schema.ts`

Removed `4:5` (Feed Video) and `1:1` (Square Video) from `DEFAULT_STYLE_CATALOG.video_formats`.
Video formats now only contain the two valid Veo ratios: `9:16` (Reel) and `16:9` (Landscape).

---

### 3. `generateRequestSchema` Aspect Ratio Enum Was Incomplete
**Fixed in:** `shared/schema.ts`

Expanded the `aspect_ratio` enum to cover all 14 valid Gemini image ratios plus the legacy `1200:628`:
```
"1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" |
"4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9" | "1200:628"
```

---

### 4. Image Resolution Not Selectable
**Fixed in:** `shared/schema.ts`, `server/app-routes.ts`, `client/src/components/post-creator-dialog.tsx`

- Added `image_resolution?: "512px" | "1K" | "2K" | "4K"` to the request schema
- Server passes `image_size` in `image_config`; defaults to `"1K"`
- Wizard step 5 now shows a Resolution row for image content type

---

### 5. Video Duration Not Selectable
**Fixed in:** `shared/schema.ts`, `server/app-routes.ts`, `client/src/components/post-creator-dialog.tsx`

- Added `video_duration?: "4" | "6" | "8"` to the request schema
- Server passes `durationSeconds` to Veo; defaults to `"8"`
- Wizard step 5 shows Duration toggles (4s / 6s / 8s) when video is selected
- 4s and 6s are disabled when a high-resolution (1080p/4K) is selected

---

### 6. Video Resolution Not Selectable
**Fixed in:** `shared/schema.ts`, `server/app-routes.ts`, `client/src/components/post-creator-dialog.tsx`

- Added `video_resolution?: "720p" | "1080p" | "4k"` to the request schema
- Server passes `resolution` to Veo; defaults to `"720p"`
- Wizard step 5 shows Resolution toggles (720p / 1080p / 4K) when video is selected
- Selecting 1080p or 4K auto-locks duration to 8s

---

### 7. Reference Images Not Forwarded to Image Model
**Fixed in:** `server/app-routes.ts`

Reference images are now appended as `inlineData` parts to the image model request, alongside the text prompt. Previously they only informed the text generation phase.

---

### 9. Video Prompt Reused the Image Prompt
**Fixed in:** `server/app-routes.ts`

The text generation phase now outputs a dedicated `video_prompt` field when `content_type === "video"`. This prompt is motion-focused — it includes camera movement, subject action, and audio cues — rather than a static visual description.

---

## 🟡 Medium Priority (Remaining)

### 8. Client-Side Video Thumbnail Extraction is Fragile
**Status:** Open
**Impact:** If the video URL has CORS restrictions or the browser cannot seek, thumbnail extraction fails silently and the gallery shows no thumbnail for the video.

**Plan:** After video download on the server, extract a thumbnail frame server-side (ffmpeg or canvas) before returning the response, so `thumbnail_url` is never null.

---

## 🟢 Low Priority / Future

### 10. No Video Extension Feature
**Status:** Not implemented

Veo 3.1 supports extending previously generated videos (7s each, up to 20×).

**Plan:** Add an "Extend" button in the post viewer → new endpoint `POST /api/posts/:id/extend`.

---

### 11. No First + Last Frame Interpolation
**Status:** Not implemented

Veo 3.1 can generate a video between two defined frames.

**Plan:** Advanced mode in the wizard — upload/select two frames as start and end.

---

### 12. No Image Search Grounding
**Status:** Not implemented

`gemini-3.1-flash-image-preview` supports Google Image Search grounding for real-world visual context.

**Plan:** "Use Image Search" toggle in the wizard → adds `google_search` tool with `image_search` to the image generation request.

---

### 13. Thinking Level Not Configurable
**Status:** Not implemented

`gemini-3.1-flash-image-preview` supports `thinking_level: "minimal" | "high"`.

**Plan:** Speed vs Quality toggle in the wizard or admin settings.

---

### 14. Two Overlapping Generation Routes
**Status:** Open — maintenance issue
**Files:**
- Primary (active): [`server/app-routes.ts`](../../server/app-routes.ts)
- Legacy (image only): [`server/routes/generate.routes.ts`](../../server/routes/generate.routes.ts)

**Plan:** Consolidate into one route. Migrate video logic into a dedicated service or merge the legacy route into `app-routes.ts`.

---

## Summary Table

| # | Issue | Priority | Status |
|---|-------|----------|--------|
| 1 | Image aspect ratio not passed to API | 🔴 High | ✅ Done |
| 2 | Invalid video formats in defaults | 🔴 High | ✅ Done |
| 3 | Incomplete aspect_ratio enum | 🔴 High | ✅ Done |
| 4 | Image resolution not selectable | 🟡 Medium | ✅ Done |
| 5 | Video duration not selectable | 🟡 Medium | ✅ Done |
| 6 | Video resolution not selectable | 🟡 Medium | ✅ Done |
| 7 | Reference images not sent to image model | 🟡 Medium | ✅ Done |
| 8 | Client-side thumbnail fragile | 🟡 Medium | Open |
| 9 | Video prompt reused image prompt | 🟡 Medium | ✅ Done |
| 10 | No video extension | 🟢 Low | Open |
| 11 | No first+last frame interpolation | 🟢 Low | Open |
| 12 | No image search grounding | 🟢 Low | Open |
| 13 | Thinking level not configurable | 🟢 Low | Open |
| 14 | Two overlapping generation routes | 🟢 Low | Open |
