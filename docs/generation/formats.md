# Formats, Aspect Ratios & Resolutions

This document covers the format system — what values are shown to users, what values are sent to each AI model, and what the constraints are per content type.

---

## Format Data Structure

**Schema:** [`shared/schema.ts`](../../shared/schema.ts) — `postFormatSchema`

```typescript
{
  id:       string,  // unique slug, e.g. "square", "reel"
  value:    string,  // the aspect ratio string sent in the API request
  label:    string,  // display name, e.g. "Square"
  subtitle: string,  // platform hint, e.g. "Instagram Post"
  icon:     "Square" | "RectangleVertical" | "RectangleHorizontal"
}
```

Formats are stored in `style_catalog.post_formats` (for images) and `style_catalog.video_formats` (for videos), loaded via `GET /api/style-catalog`.

---

## Image Formats

**Default set** (admin can add/edit/remove/reorder via Post Formats card):

| ID | Value | Label | Subtitle | Icon |
|----|-------|-------|----------|------|
| `square` | `1:1` | Square | Instagram Post | Square |
| `portrait` | `4:5` | Portrait | Instagram Feed | RectangleVertical |
| `story` | `9:16` | Story | Instagram/TikTok | RectangleVertical |
| `landscape` | `16:9` | Landscape | YouTube/LinkedIn | RectangleHorizontal |
| `pinterest` | `2:3` | Pinterest | Pin Post | RectangleVertical |
| `facebook` | `1200:628` | Facebook | Link Preview | RectangleHorizontal |

### Valid Image Aspect Ratios (gemini-3.1-flash-image-preview)

All of these can be sent in `image_config.aspect_ratio`:

```
1:1    1:4    1:8
2:3    3:2    3:4
4:1    4:3    4:5    5:4
8:1    9:16   16:9   21:9
```

> ⚠️ `1200:628` (Facebook format) is **NOT** a valid Gemini aspect ratio.
> It must be mapped server-side to `16:9` before sending to the API.

### Image Resolutions Available

| Code | gemini-3.1-flash | gemini-3-pro | gemini-2.5-flash-image |
|------|-----------------|--------------|----------------------|
| `512px` | ✅ | ❌ | ❌ |
| `1K` | ✅ | ✅ | ✅ (only option) |
| `2K` | ✅ | ✅ | ❌ |
| `4K` | ✅ | ✅ | ❌ |

**Current state:** Selectable via wizard step 5 Resolution row. Sent as `image_resolution` in the request. Defaults to `1K`.

---

## Video Formats

**Default set** (admin can manage via Video Formats card):

| ID | Value | Label | Subtitle | Veo Valid? |
|----|-------|-------|----------|------------|
| `reel` | `9:16` | Reel / Short | TikTok / Reels | ✅ |
| `landscape-video` | `16:9` | Landscape | YouTube / Facebook | ✅ |
> ✅ `4:5` and `1:1` were removed from the defaults. Only valid Veo ratios remain.

### Valid Video Aspect Ratios (Veo 3.1)

Only two options:
| Value | Name | Use Case |
|-------|------|----------|
| `16:9` | Landscape | YouTube, Facebook, Twitter/X |
| `9:16` | Portrait | TikTok, Instagram Reels, YouTube Shorts |

### Video Resolutions Available (Veo 3.1)

| Code | Notes |
|------|-------|
| `720p` | Default. Works with all durations and features |
| `1080p` | Requires `duration = "8"` |
| `4k` | Requires `duration = "8"`. Higher cost and latency |

> ✅ Resolution is now selectable via wizard step 5. Sent as `video_resolution`. Defaults to `720p`.

### Video Durations (Veo 3.1)

| Value | Notes |
|-------|-------|
| `"4"` | 4 seconds |
| `"6"` | 6 seconds |
| `"8"` | 8 seconds. Required for 1080p, 4K, reference images, video extension |

> ✅ Duration is now selectable via wizard step 5. Sent as `video_duration`. Defaults to `8`. 4s and 6s are disabled when 1080p or 4K resolution is selected.

---

## Where Formats Are Shown in the UI

### Wizard Step 5 — "Format / Size"

**File:** [`client/src/components/post-creator-dialog.tsx`](../../client/src/components/post-creator-dialog.tsx) ~line 741

```typescript
// Picks the right format list based on content type
const formats = contentType === "video"
  ? (catalog.video_formats?.length ? catalog.video_formats : DEFAULT_STYLE_CATALOG.video_formats || [])
  : (catalog.post_formats?.length  ? catalog.post_formats  : DEFAULT_STYLE_CATALOG.post_formats  || []);
```

The selected format's `value` is stored in `aspectRatio` state and sent as `aspect_ratio` in the API request.

### Admin — Post Formats & Video Formats Cards

**File:** [`client/src/components/admin/post-creation/post-formats-card.tsx`](../../client/src/components/admin/post-creation/post-formats-card.tsx)

The `PostFormatsCard` component accepts a `formatKey` prop:
- `formatKey="post_formats"` → manages image formats
- `formatKey="video_formats"` → manages video formats

Both cards are rendered in [`client/src/components/admin/post-creation-tab.tsx`](../../client/src/components/admin/post-creation-tab.tsx).

---

## Server-Side Aspect Ratio Handling

### For Images
```typescript
// app-routes.ts — aspect ratio is now passed via image_config
const geminiAspectRatio = aspect_ratio === "1200:628" ? "16:9" : aspect_ratio;
generationConfig: {
  responseModalities: ["IMAGE"],
  image_config: {
    aspect_ratio: geminiAspectRatio,
    image_size: image_resolution ?? "1K",
  },
}
```

### For Videos
```typescript
// app-routes.ts ~line 816
const videoAspectRatio = aspect_ratio === "9:16" ? "9:16" : "16:9";
// ✅ Correctly limits to valid Veo values
// ❌ "4:5" and "1:1" silently fall to "16:9" without user awareness
```

---

## Aspect Ratio Mapping Table (for server implementation)

When the user-selected `aspect_ratio` needs to be sent to the Gemini image API:

| User value | Gemini image API value | Notes |
|------------|----------------------|-------|
| `1:1` | `1:1` | ✅ Direct |
| `4:5` | `4:5` | ✅ Direct |
| `9:16` | `9:16` | ✅ Direct |
| `16:9` | `16:9` | ✅ Direct |
| `2:3` | `2:3` | ✅ Direct |
| `3:2` | `3:2` | ✅ Direct |
| `4:3` | `4:3` | ✅ Direct |
| `3:4` | `3:4` | ✅ Direct |
| `4:1` | `4:1` | ✅ Direct |
| `1:4` | `1:4` | ✅ Direct |
| `5:4` | `5:4` | ✅ Direct |
| `4:5` | `4:5` | ✅ Direct |
| `8:1` | `8:1` | ✅ Direct |
| `1:8` | `1:8` | ✅ Direct |
| `21:9` | `21:9` | ✅ Direct |
| `1200:628` | `16:9` | ⚠️ Must remap — invalid for API |

When the user-selected `aspect_ratio` is sent to the Veo video API:

| User value | Veo API value | Notes |
|------------|--------------|-------|
| `9:16` | `9:16` | ✅ Direct |
| `16:9` | `16:9` | ✅ Direct |
| `4:5` | `16:9` | ⚠️ Remapped — invalid for Veo |
| `1:1` | `16:9` | ⚠️ Remapped — invalid for Veo |
| anything else | `16:9` | ⚠️ Fallback |

---

## Recommended Default Format Sets

### Image Formats (recommended defaults)
```typescript
[
  { id: "square",    value: "1:1",  label: "Square",    subtitle: "Instagram Post",    icon: "Square" },
  { id: "portrait",  value: "4:5",  label: "Portrait",  subtitle: "Instagram Feed",    icon: "RectangleVertical" },
  { id: "story",     value: "9:16", label: "Story",     subtitle: "Instagram/TikTok",  icon: "RectangleVertical" },
  { id: "landscape", value: "16:9", label: "Landscape", subtitle: "YouTube/LinkedIn",  icon: "RectangleHorizontal" },
  { id: "pinterest", value: "2:3",  label: "Pinterest", subtitle: "Pin Post",          icon: "RectangleVertical" },
  { id: "facebook",  value: "1200:628", label: "Facebook", subtitle: "Link Preview",  icon: "RectangleHorizontal" },
]
```

### Video Formats (recommended — Veo-valid only)
```typescript
[
  { id: "reel",            value: "9:16", label: "Reel / Short", subtitle: "TikTok / Reels",    icon: "RectangleVertical" },
  { id: "landscape-video", value: "16:9", label: "Landscape",    subtitle: "YouTube / Facebook", icon: "RectangleHorizontal" },
]
```
