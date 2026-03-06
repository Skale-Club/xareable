# Generation API Reference

All endpoints require a valid Supabase JWT via `Authorization: Bearer <token>` header.

---

## POST /api/generate

The primary content generation endpoint. Handles both image and video generation.

**File:** [`server/app-routes.ts`](../../server/app-routes.ts) ~line 587

### Request

```typescript
// Validated by: generateRequestSchema in shared/schema.ts
{
  reference_text?:   string,                  // optional user text context
  reference_images?: Array<{
    mimeType: string,                         // e.g. "image/jpeg"
    data:     string,                         // base64-encoded image
  }>,                                         // max 4 images
  post_mood:         string,                  // mood id from catalog, e.g. "promo"
  copy_text?:        string,                  // text to include on the image/video
  aspect_ratio:      AspectRatioEnum,         // see formats.md
  use_logo?:         boolean,
  logo_position?:    LogoPosition,            // e.g. "bottom-right"
  content_language:  SupportedLanguage,       // e.g. "en", "pt"
  content_type:      "image" | "video",
}
```

**Current `aspect_ratio` enum** (in schema, needs expansion):
```
"1:1" | "4:5" | "9:16" | "16:9" | "2:3" | "1200:628"
```

### Response

```typescript
{
  image_url:     string,          // public URL of the generated asset (image or video)
  thumbnail_url: string | null,   // same as image_url for images; null for videos
  content_type:  "image" | "video",
  caption:       string,          // AI-generated social caption
  headline:      string,          // short visual headline
  subtext:       string,          // supporting text line
  post_id:       string,          // UUID of the created posts record
}
```

### Behavior by content_type

#### `"image"`
1. Phase 1: text model → `{ headline, subtext, image_prompt, caption }`
2. Phase 2: image model → base64 PNG → Buffer
3. Upload to Supabase Storage
4. Insert into `posts` with `thumbnail_url = image_url`
5. Return response

#### `"video"`
1. Phase 1: text model → `{ headline, subtext, image_prompt, caption }`
2. Phase 2: Veo 3.1 long-running operation
   - `POST predictLongRunning` with video prompt
   - Poll for up to 6 minutes
   - Download MP4 from returned URI
3. Upload to Supabase Storage
4. Insert into `posts` with `thumbnail_url = null`
5. Return response (client handles thumbnail separately)

### Error Responses

| Status | Condition |
|--------|-----------|
| `400` | Invalid request body (Zod validation fail) |
| `401` | Missing or invalid JWT |
| `402` | Insufficient credits (`insufficient_credits` in message) |
| `404` | No brand configured for user |
| `500` | Generation failure (AI API error, upload error, etc.) |

### Credit Deduction

Credits are deducted only after a successful generation. Admin and affiliate users are exempt.

---

## POST /api/edit-post

Edit an existing post image using a text prompt. Creates a new version in `post_versions`.

**File:** [`server/app-routes.ts`](../../server/app-routes.ts)

### Request

```typescript
{
  post_id:    string,   // UUID of the post to edit
  edit_prompt: string,  // natural language description of the edit
}
```

### Behavior
1. Fetch the post's latest version image (or original `image_url`)
2. Download the image from Supabase Storage
3. Send image + edit_prompt to image model (image editing mode)
4. Upload the new version
5. Insert into `post_versions` with incremented `version_number`
6. Return the new image URL

### Response
```typescript
{
  image_url: string,      // URL of the new edited image
  version:   number,      // version number assigned
}
```

---

## POST /api/posts/:id/thumbnail

Upload a thumbnail for a video post. Used by the client after extracting a frame from the generated video.

**File:** [`server/app-routes.ts`](../../server/app-routes.ts) ~line 452

### Request

```typescript
{
  file:        string,          // base64-encoded image data (JPEG)
  contentType: "image/jpeg",    // MIME type
}
```

### Constraints
- Post must exist and belong to the authenticated user
- Post must have `content_type === "video"` (returns 400 otherwise)
- Image size limit: enforced server-side

### Response
```typescript
{
  thumbnail_url: string,   // public URL of the uploaded thumbnail
}
```

### Side Effects
- Uploads to `{userId}/thumbnails/{postId}-{uuid}.jpg` in `user_assets` bucket
- Updates `posts.thumbnail_url` in the database

---

## POST /api/transcribe

Convert voice audio to text.

### Request
```typescript
{
  audio:     string,   // base64-encoded audio
  mimeType:  string,   // e.g. "audio/webm"
}
```

### Response
```typescript
{
  text: string,   // transcribed text
}
```

---

## GET /api/style-catalog

Returns the active style catalog (styles, moods, formats, model configuration).

### Response (StyleCatalog)
```typescript
{
  styles:       BrandStyle[],
  post_moods:   PostMood[],
  post_formats: PostFormat[],    // image formats
  video_formats: PostFormat[],   // video formats (new)
  ai_models: {
    image_generation:    string,
    text_generation:     string,
    audio_transcription: string,
    video_generation:    string,
  }
}
```

---

## GET /api/posts

Returns paginated post gallery for the authenticated user.

### Query Params
```
page:     number (default 1)
per_page: number (default 12)
```

### Response
```typescript
{
  posts: PostGalleryItem[],
  totalCount: number,
}
```

---

## GET /api/credits/check

Check credit balance and generation limits.

### Response (CreditStatus)
```typescript
{
  free_generations_remaining: number,
  paid_credits_remaining:     number,
  can_generate:               boolean,
}
```

---

## Admin Endpoints

All admin endpoints require `profiles.is_admin === true`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/stats` | Platform stats (users, posts, revenue) |
| `GET` | `/api/admin/users` | List all users |
| `PATCH` | `/api/admin/users/:id/admin` | Toggle admin status |
| `GET` | `/api/style-catalog` | (shared with users) |
| `PATCH` | `/api/admin/style-catalog` | Update style catalog (models, formats, moods) |
| `GET` | `/api/admin/landing/content` | Get landing page copy |
| `PATCH` | `/api/admin/landing/content` | Update landing page copy |

---

## Authentication Pattern

All requests must include:
```
Authorization: Bearer <supabase_jwt>
```

On the server:
```typescript
// server/app-routes.ts
const token = req.headers.authorization?.split(" ")[1];
const { data: { user } } = await createServerSupabase(token).auth.getUser();
if (!user) return res.status(401).json({ message: "Unauthorized" });
```

User-scoped clients respect RLS. Admin operations use `createAdminSupabase()` (service role).
