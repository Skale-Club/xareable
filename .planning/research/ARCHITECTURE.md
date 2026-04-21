# Architecture Patterns

**Domain:** AI Social Media SaaS — v1.1 Media Creation Expansion (Carousel + Enhancement)
**Researched:** 2026-04-21
**Scope:** Integration points for carousel generator and image enhancement into the existing brownfield architecture

---

## Recommended Architecture

### Component Boundaries (New vs Modified)

#### New Components

| Component | Type | Location | Purpose |
|-----------|------|----------|---------|
| `carousel.routes.ts` | Route module | `server/routes/` | POST /api/carousel/generate — N-slide carousel SSE pipeline |
| `enhance.routes.ts` | Route module | `server/routes/` | POST /api/enhance — image-to-image enhancement SSE pipeline |
| `carousel-generation.service.ts` | Service | `server/services/` | Orchestrates N sequential Gemini image calls; returns ordered slide buffers |
| `enhancement.service.ts` | Service | `server/services/` | image-to-image Gemini call with scenery prompt injection |
| `carousel-creator-dialog.tsx` | Component | `client/src/components/` | Dedicated wizard for carousel creation |
| `enhancement-creator-dialog.tsx` | Component | `client/src/components/` | Dedicated wizard for photo enhancement |
| `post_slides` table | DB migration | `supabase/migrations/` | Slide storage for carousel posts |
| `sceneries` field in `styleCatalogSchema` | Schema | `shared/schema.ts` | Admin-curated scenery presets for enhancement |

#### Modified Components

| Component | Change Required |
|-----------|----------------|
| `shared/schema.ts` | Extend `content_type` enum, add `post_slides` types, add carousel/enhance request/response schemas, add `scenerySchema` to `styleCatalogSchema` |
| `server/routes/index.ts` | Register `carouselRoutes` and `enhanceRoutes` via `router.use()` |
| `server/quota.ts` | Add `"carousel"` and `"enhance"` to `operationType` union in `checkCredits` / `recordUsageEvent`; add carousel multiplier pricing logic |
| `server/services/storage-cleanup.service.ts` | Extend cleanup to handle slide paths under `user_assets/{userId}/slides/{postId}/` |
| `client/src/pages/posts.tsx` | Gallery tile rendering for `carousel` and `enhancement` content types |
| `client/src/components/app-sidebar.tsx` | Surface entry points for carousel and enhancement creators |
| `shared/schema.ts` `postSchema` / `postGalleryItemSchema` | Add `slide_count` field for carousels |
| `shared/schema.ts` `billingStatementItemSchema` | Expand `content_type` to include `"carousel"` and `"enhancement"` |

---

## 1. Routing Strategy

**Decision: New dedicated route files — `carousel.routes.ts` and `enhance.routes.ts`.**

Do not extend `/api/generate` with additional `content_type` values. Rationale:

- The carousel pipeline is structurally different: it runs N sequential (or parallel-with-ordering) image generation calls, produces N storage uploads, and inserts into `post_slides` rather than just `posts.image_url`. Cramming this into the `generate.routes.ts` `if/else` chain (which already handles image vs video divergence) would make the file unmanageable.
- Enhancement is image-to-image with no text generation phase, no caption quality step, no logo overlay, and no `post_slides` — almost none of the generate pipeline applies. A shared route handler would be mostly dead branches.
- The existing `edit.routes.ts` precedent shows the project already splits distinct operations into separate files even when they share services.
- SSE event shapes can evolve independently. Carousel needs per-slide progress events (`slide_1_of_5`, `slide_2_of_5`) that do not map to the existing event vocabulary (`text_generation`, `image_generation`, `optimization`, `saving`).

**Module locations:**
- `server/routes/carousel.routes.ts` — handles `POST /api/carousel/generate`
- `server/routes/enhance.routes.ts` — handles `POST /api/enhance`

Both files follow the exact same middleware/structure pattern as `generate.routes.ts`: `authenticateUser` → `getGeminiApiKey` → fetch brand → `safeParse` → `checkCredits` → `initSSE` → pipeline → `recordUsageEvent` → `deductCredits` → `sse.sendComplete`.

---

## 2. Schema Design for Multi-Slide Carousels

**Decision: Option A — new `post_slides` table. Keep `posts.image_url` as the cover/first slide.**

Rationale against the alternatives:

- **Option B (JSON array column):** PostgreSQL JSONB arrays are not queryable per-slide for storage cleanup, RLS enforcement, or per-slide edit flows. Supabase Storage cleanup service needs to enumerate individual slide paths — impossible without iterating a JSON blob in application code. Thumbnail generation per slide becomes unwieldy. Rejected.
- **Option C (repurpose `post_versions`):** `post_versions` has `edit_prompt` and `version_number` semantics; slides have `slide_number` and are all created atomically during the same generation. Mixing concepts into one table breaks the edit flow: `edit.routes.ts` reads `post_versions` to find the latest version — carousel slides would pollute that query. A future "edit one slide" feature would be impossible to implement cleanly. Rejected as a hack that would require a rewrite later.
- **Option A (new table):** Clean separation. RLS policy mirrors `posts` (user owns post → user owns slides). Gallery query joins `post_slides` via `post_id` to get slide count. Storage cleanup queries `post_slides` to find all slide paths before deleting. Per-slide editing in a future milestone is a clean `UPDATE post_slides SET image_url = ...` without touching post_versions. The migration cost is one new table.

**`post_slides` table schema:**

```sql
CREATE TABLE post_slides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  slide_number INTEGER NOT NULL CHECK (slide_number >= 1),
  image_url   TEXT NOT NULL,
  thumbnail_url TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id, slide_number)
);

-- RLS: user owns slide if they own the parent post
CREATE POLICY "Users can view own slides"
  ON post_slides FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM posts WHERE posts.id = post_slides.post_id AND posts.user_id = auth.uid()
  ));
```

**`posts` table changes for carousels:**
- `posts.image_url` stores the cover/first slide public URL (backward compatible — existing gallery queries continue to work).
- `posts.thumbnail_url` stores the cover slide thumbnail.
- Add `slide_count INTEGER DEFAULT NULL` column: populated only for carousels, `NULL` for image/video/enhancement. Gallery can filter/display this without a join.

**Shared schema additions in `shared/schema.ts`:**

```typescript
export const postSlideSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  slide_number: z.number().int().positive(),
  image_url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
  created_at: z.string(),
});
export type PostSlide = z.infer<typeof postSlideSchema>;

// Gallery item gets slide count
export const postGalleryItemSchema = z.object({
  // ... existing fields ...
  content_type: z.enum(["image", "video", "carousel", "enhancement"]).default("image"),
  slide_count: z.number().int().nonnegative().nullable().default(null),
});
```

---

## 3. content_type Enum Expansion

**Decision: Extend the single `content_type` column to `["image", "video", "carousel", "enhancement"]`.**

Do not add a separate `media_type` or `kind` column. The existing `content_type` discriminator already drives gallery rendering, billing statement grouping, and frontend filter tabs. A second column would require all consumers to check both columns to determine behavior — a recipe for inconsistency.

**Every place `content_type` is used — required changes:**

| Location | Current Values | Change |
|----------|---------------|--------|
| `shared/schema.ts` `postSchema.content_type` | `["image", "video"]` | Extend to `["image", "video", "carousel", "enhancement"]` |
| `shared/schema.ts` `postGalleryItemSchema.content_type` | `["image", "video"]` | Same extension |
| `shared/schema.ts` `generateResponseSchema.content_type` | `["image", "video"]` | Leave as-is (generate route only produces image/video) |
| `shared/schema.ts` `billingStatementItemSchema.content_type` | `["image", "video"]` | Extend to include `"carousel"` and `"enhancement"` |
| `shared/schema.ts` `usageEventSchema.event_type` | `["generate", "edit", "transcribe"]` | Leave as-is; carousel uses `"generate"`, enhancement uses `"generate"` event type. The `content_type` on the post row provides the sub-type |
| `server/routes/generate.routes.ts` `buildTextFallback` | `contentType: "image" | "video"` | Leave as-is — this function is not called from carousel/enhance routes |
| `server/quota.ts` `checkCredits` `operationType` | `"generate" | "edit" | "transcribe"` | No change needed — carousel and enhancement both pass `"generate"` as `operationType`; `isVideo` flag replaced by `isCarousel` / multiplier pattern (see §4) |
| `server/routes/edit.routes.ts` `isVideoPost` guard | `post.content_type === "video"` | Extend to also guard against `"carousel"` and `"enhancement"` (cannot image-edit a carousel slide via the existing edit endpoint — needs carousel-specific route in a future milestone) |
| `client/src/pages/posts.tsx` gallery tile renderer | `content_type === "video"` check | Add `"carousel"` and `"enhancement"` branches |
| Supabase DB `posts.content_type` column | `image | video` CHECK constraint | Migration to extend the enum/CHECK |

**DB migration pattern:**
```sql
-- Extend CHECK constraint (preferred over Postgres ENUM for flexibility)
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_content_type_check;
ALTER TABLE posts ADD CONSTRAINT posts_content_type_check
  CHECK (content_type IN ('image', 'video', 'carousel', 'enhancement'));

ALTER TABLE posts ADD COLUMN IF NOT EXISTS slide_count INTEGER DEFAULT NULL;
```

---

## 4. Billing Integration

### Carousel: N image generations

**Decision: One `usage_events` row with summed tokens.**

Record a single `usage_events` row after all N slides complete, with:
- `text_input_tokens` / `text_output_tokens`: from the single Gemini text generation call (carousel has one text plan pass, not N).
- `image_input_tokens` / `image_output_tokens`: sum across all N slide image generations.
- `image_model`: the model used (e.g., `gemini-3.1-flash-image-preview`).
- `event_type`: `"generate"`.

This keeps the billing statement UI (`billingStatementItemSchema`) working without changes — each carousel shows as one line item. The statement UI already groups by `event_type`, not by slide count.

Do not record N separate usage events. Rationale: The billing statement table shows per-post line items. N rows per carousel would confuse users and inflate usage counts. The admin billing report groups by `event_type` — N rows would make carousels appear as N separate "generate" events.

The cost is naturally N × image cost because the summed `image_output_tokens` reflects N full image generations. No special multiplier field is needed.

**Quota pre-check for carousels:** Pass `isCarousel: true` (or just the slide count) to `checkCredits` so the estimated cost can be N × the single-image estimate. Add an optional `slide_count` parameter to `checkCredits`:

```typescript
// server/quota.ts
export async function checkCredits(
  userId: string,
  operationType: "generate" | "edit" | "transcribe",
  isVideo: boolean = false,
  slideCount: number = 1,  // NEW: carousel multiplier
): Promise<CreditStatus>
```

The `estimateBaseCostMicros` result is multiplied by `slideCount` before comparison with balance. This keeps the pre-check accurate without a new operation type.

### Enhancement: Single image-to-image

Enhancement is charged as a single image generation (one `image_input_tokens` + `image_output_tokens` call). No text generation phase occurs. Record one `usage_events` row with:
- `text_input_tokens: null`, `text_output_tokens: null` (no Gemini text model call).
- `image_input_tokens` / `image_output_tokens` from the image model response.
- `event_type: "generate"`.

The image-to-image token accounting from the Gemini API is identical in structure to text-to-image — both return `promptTokenCount` and `candidatesTokenCount`. No pricing changes required.

**`billingResourceUsageItemSchema.resource_key`** currently is `z.enum(["generate", "edit", "transcribe"])`. This is the billing dashboard "resource usage" grouping. Carousel and enhancement both map to `"generate"`. No change needed — they aggregate correctly under the existing "Generate" line item.

---

## 5. Frontend UX

**Decision: Separate dedicated dialogs — `carousel-creator-dialog.tsx` and `enhancement-creator-dialog.tsx` — launched from the sidebar or a "New" menu.**

Do not extend `post-creator-dialog.tsx` with a step-0 type selector. Rationale:

- `post-creator-dialog.tsx` is already 700+ lines managing two diverging wizard flows (image vs video). Adding two more flows via a step-0 selector would require quadrupling the conditional logic throughout every step renderer. The `IMAGE_STEPS` / `VIDEO_STEPS` arrays, all the `contentType === "video"` guards, and the `viewMode` state machine would all need to fork for carousel and enhancement — making the file impossible to maintain.
- Carousel and enhancement have fundamentally different inputs: carousel needs a slide count selector, narrative arc framing, and aspect ratio (1:1 or 4:5 for IG); enhancement needs a photo upload (required, not optional), scenery selector, and no text/logo steps. These are specializations, not extensions.
- Separate dialogs have independent state and can be tested/modified without risk to the existing post creator.
- Future media types can each get their own dialog without touching existing code.

**Entry point:** Add a "Create" or "New Content" dropdown/menu in `app-sidebar.tsx` with four options: Image Post, Video, Carousel, Enhance Photo. This replaces/extends the current single "New Post" trigger that opens `PostCreatorDialog`.

**Shared components across dialogs:**
- `useAuth` hook — same
- Credit check display — extract into `<CreditGateAlert>` shared component
- SSE progress bar pattern — extract into `<GenerationProgress>` shared component (currently duplicated between post creator and edit dialogs)
- `fetchSSE` from `@/lib/sse-fetch` — same

### Gallery tile rendering for carousel and enhancement

**Carousel tile:**
- Display the cover slide (slide 1) as the tile image.
- Overlay a badge: "Carousel · N slides" (using `slide_count` from the posts query — no extra join required since it is stored on the `posts` row).
- Add a subtle stacked-card visual effect (CSS `box-shadow` layers) to signal multiple slides.
- Clicking opens a carousel viewer within the existing `PostViewerDialog` pattern (or a new `CarouselViewerDialog`), showing a swipeable slide strip.

**Enhancement tile:**
- Render identically to an image tile — it is a single image.
- Optionally badge with a "Enhanced" label to distinguish from generated images.
- No special viewer needed beyond the existing image viewer.

---

## 6. Storage Path Conventions

**Carousel:**

```
user_assets/{userId}/slides/{postId}/slide-1.webp
user_assets/{userId}/slides/{postId}/slide-2.webp
...
user_assets/{userId}/slides/{postId}/slide-N.webp
user_assets/{userId}/thumbnails/slides/{postId}/slide-1.webp
user_assets/{userId}/thumbnails/slides/{postId}/slide-2.webp
...
```

Cover (slide 1) is also copied/uploaded to the canonical path for backward compatibility with `posts.image_url`:

```
user_assets/{userId}/{postId}.webp          ← cover slide (slide 1)
user_assets/{userId}/thumbnails/{postId}.webp  ← cover thumbnail
```

This means `posts.image_url` and `posts.thumbnail_url` are always valid standalone images regardless of content type — the existing gallery renderer, expiration cleanup, and post viewer all work without modification for the cover.

**Enhancement:**

```
user_assets/{userId}/enhancements/{postId}-source.webp   ← retained original (resized to max 2K)
user_assets/{userId}/{postId}.webp                        ← enhanced result
user_assets/{userId}/thumbnails/{postId}.webp             ← result thumbnail
```

Retaining the original allows a future "try different scenery" re-enhancement without the user re-uploading. The source is stored under `enhancements/` to distinguish it from generated content. The result follows the same canonical path as image posts so all existing downstream code works unchanged.

**Storage cleanup:** `storage-cleanup.service.ts` must be extended to also enumerate and delete `slides/{postId}/` directories and `thumbnails/slides/{postId}/` directories when a carousel post expires or is deleted.

---

## 7. Scenery Catalog (for Enhancement)

**Decision: Extend `styleCatalogSchema` with a `sceneries` array field, stored in the existing `platform_settings` table under `setting_key = "style_catalog"`, and administered through the existing admin style catalog UI.**

This reuses the full existing pattern: `getStyleCatalogPayload()` returns sceneries alongside `text_styles`, `post_moods`, etc. The admin `PATCH /api/admin/style-catalog` endpoint handles saves. The admin UI for the style catalog tab gets a new "Sceneries" section.

**Schema additions in `shared/schema.ts`:**

```typescript
export const scenerySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  prompt_snippet: z.string().min(1),   // injected into the image model prompt
  preview_image_url: z.string().nullable().default(null),  // admin-uploaded reference image
  categories: z.array(z.string().min(1)).default([]),      // e.g. ["food", "product", "outdoor"]
});
export type Scenery = z.infer<typeof scenerySchema>;

// Add to styleCatalogSchema:
export const styleCatalogSchema = z.object({
  // ... existing fields ...
  sceneries: z.array(scenerySchema).optional(),
});
```

**Initial seed:** Insert via the admin style catalog UI on first deploy, or via a SQL seed in a migration file that UPDATEs the existing `platform_settings` row for `style_catalog`. No new table needed.

**Enhancement request schema:**

```typescript
export const enhanceRequestSchema = z.object({
  source_image: z.object({
    mimeType: z.string(),
    data: z.string(),        // base64
  }),
  scenery_id: z.string().min(1),      // references scenery.id in style catalog
  aspect_ratio: z.enum(["1:1", "4:5", "16:9"]).default("1:1"),
  content_language: z.enum(SUPPORTED_LANGUAGES).default("en"),
});
export type EnhanceRequest = z.infer<typeof enhanceRequestSchema>;
```

---

## Data Flow Changes

### Carousel Generation Data Flow

```
POST /api/carousel/generate
  authenticateUser()
  getGeminiApiKey()
  fetch brand
  carouselRequestSchema.safeParse()
  checkCredits(userId, "generate", false, slideCount)
  initSSE()
  sendProgress("text_generation", 10%)
    gemini.generateCarouselPlan() → { slides: [{image_prompt, headline, ...}], caption }
  for slide 1..N:
    sendProgress("slide_N_of_total", image_generation, 20% + (60%/N)*i)
    carousel-generation.service → generateImageAsset(slide.image_prompt)
    processImageWithThumbnail()
    uploadFile(user_assets/{userId}/slides/{postId}/slide-N.webp)
    uploadFile(user_assets/{userId}/thumbnails/slides/{postId}/slide-N.webp)
  uploadFile(user_assets/{userId}/{postId}.webp)          ← cover = slide 1
  uploadFile(user_assets/{userId}/thumbnails/{postId}.webp)
  sendProgress("saving", 90%)
    supabase.from("posts").insert({ content_type: "carousel", image_url: coverUrl, slide_count: N })
    supabase.from("post_slides").insert([...N rows])
  ensureCaptionQuality()
  recordUsageEvent(userId, postId, "generate", {summed tokens}, {models})
  deductCredits()
  sse.sendComplete({ post, slides: [{slide_number, image_url, thumbnail_url}], caption })
```

### Enhancement Data Flow

```
POST /api/enhance
  authenticateUser()
  getGeminiApiKey()
  fetch brand (for context, not for logo/text composition)
  enhanceRequestSchema.safeParse()
  checkCredits(userId, "generate", false, 1)
  initSSE()
  sendProgress("loading_scenery", 10%)
    getStyleCatalogPayload() → find scenery by scenery_id
  sendProgress("enhancing", 30%)
    enhancement.service.enhance({
      sourceImageBase64, mimeType,
      sceneryPromptSnippet: scenery.prompt_snippet,
      aspectRatio,
    })
    → Gemini image-to-image call
  processImageWithThumbnail()
  sendProgress("uploading", 75%)
    uploadFile(user_assets/{userId}/enhancements/{postId}-source.webp)  ← original retained
    uploadFile(user_assets/{userId}/{postId}.webp)
    uploadFile(user_assets/{userId}/thumbnails/{postId}.webp)
  sendProgress("saving", 90%)
    supabase.from("posts").insert({ content_type: "enhancement", image_url: resultUrl })
  recordUsageEvent(userId, postId, "generate", {image tokens only}, {image_model})
  deductCredits()
  sse.sendComplete({ post, image_url, thumbnail_url })
```

---

## Build Order (Phase Sequence)

Dependencies flow from shared types → DB → server → client.

### Phase 1: Schema & Database Foundation

1. Extend `shared/schema.ts`:
   - `content_type` enum to `["image", "video", "carousel", "enhancement"]`
   - Add `postSlideSchema` and `PostSlide` type
   - Add `slide_count` to `postSchema` and `postGalleryItemSchema`
   - Add `scenerySchema` and extend `styleCatalogSchema`
   - Add `carouselRequestSchema`, `carouselResponseSchema`
   - Add `enhanceRequestSchema`, `enhanceResponseSchema`
   - Extend `billingStatementItemSchema.content_type`
2. Write Supabase migration:
   - Extend `posts.content_type` CHECK constraint
   - Add `posts.slide_count` column
   - Create `post_slides` table with RLS
3. Seed initial sceneries via admin UI or migration SQL

**Gate:** TypeScript compiles (`npm run check`), migration applies cleanly.

### Phase 2: Server Services

4. `server/services/carousel-generation.service.ts` — orchestrates N image generation calls, returns ordered `{buffer, thumbnail, slideNumber}[]`
5. `server/services/enhancement.service.ts` — single image-to-image call with scenery prompt injection
6. Extend `server/quota.ts` — add `slideCount` param to `checkCredits` and `estimateBaseCostMicros` for carousel multiplier
7. Extend `server/services/storage-cleanup.service.ts` — add slide path enumeration and deletion

**Gate:** Services can be unit-tested with mock Gemini responses.

### Phase 3: Server Routes

8. `server/routes/carousel.routes.ts` — full SSE pipeline wired to phase-2 services
9. `server/routes/enhance.routes.ts` — full SSE pipeline wired to phase-2 services
10. Register both in `server/routes/index.ts`
11. Extend admin `PATCH /api/admin/style-catalog` to validate `sceneries` field (covered by schema change in Phase 1)

**Gate:** Manual API test with curl/Postman; carousel and enhancement return valid SSE streams.

### Phase 4: Admin UI (Scenery Catalog)

12. Extend the admin style catalog tab to include a "Sceneries" section (add/edit/delete scenery entries with label, prompt snippet, categories, preview image upload)

**Gate:** Admin can manage sceneries end to end.

### Phase 5: Frontend Creator Dialogs

13. `client/src/components/carousel-creator-dialog.tsx` — wizard (slide count → aspect ratio → prompt → generation → viewer)
14. `client/src/components/enhancement-creator-dialog.tsx` — wizard (upload photo → pick scenery → generate → viewer)
15. Update `app-sidebar.tsx` — "New" menu with four options
16. Extract shared `<GenerationProgress>` / `<CreditGateAlert>` components

**Gate:** End-to-end user flows work in dev; carousel shows N slides, enhancement shows result.

### Phase 6: Gallery Surface Updates

17. Extend `client/src/pages/posts.tsx` gallery tile to handle `carousel` (stacked-card badge + slide count) and `enhancement` (optional badge)
18. Implement carousel viewer (slide strip in PostViewerDialog or CarouselViewerDialog)
19. Guard `edit.routes.ts` against carousel/enhancement content types (return 400 with "Use carousel edit endpoint" message rather than silently processing)

**Gate:** Gallery correctly renders all four content types; edit guard prevents accidental misuse.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Extending generate.routes.ts with carousel/enhancement

**What goes wrong:** The route file grows to 1500+ lines with four diverging content type branches. SSE event names conflict (the carousel `slide_2_of_5` event has no home in the existing vocabulary). Changes to carousel billing break the image pipeline.

**Instead:** Dedicated route files per media creation surface, as the project already does with `edit.routes.ts`.

### Anti-Pattern 2: JSON array for slides in posts table

**What goes wrong:** Storage cleanup cannot enumerate slide URLs from a JSONB column without loading all posts into memory. Per-slide RLS is impossible. Future "edit one slide" requires JSON mutation instead of a row update.

**Instead:** `post_slides` table with `post_id` FK and `slide_number`.

### Anti-Pattern 3: N usage_events rows for carousel

**What goes wrong:** The billing statement shows N line items per carousel. Resource usage aggregation shows the carousel as N "generate" operations. Users are confused by their usage history.

**Instead:** One usage_events row per carousel with summed token counts.

### Anti-Pattern 4: Extending PostCreatorDialog with step-0 type selector

**What goes wrong:** The 700-line wizard requires conditional branching in every step for four content types. State becomes entangled (which fields apply to which type?). Testing regressions is high risk.

**Instead:** Dedicated dialog per media type; shared utilities extracted as components/hooks.

### Anti-Pattern 5: Separate `sceneries` table in the database

**What goes wrong:** Requires a new DB table, new admin CRUD endpoints, separate RLS policies, and a new service — all for what is structurally identical to `text_styles`, `post_moods`, and `post_formats` which already live in `platform_settings`.

**Instead:** Extend `styleCatalogSchema` with `sceneries` array; reuse `getStyleCatalogPayload()` and the existing admin style catalog PATCH endpoint.

---

## Sources

- Codebase direct analysis: `server/routes/generate.routes.ts`, `server/routes/edit.routes.ts`, `server/routes/style-catalog.routes.ts`, `server/quota.ts`, `shared/schema.ts`, `client/src/components/post-creator-dialog.tsx`, `client/src/pages/posts.tsx`
- Planning docs: `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/codebase/CONVENTIONS.md`
- Confidence: HIGH — all recommendations are derived from direct codebase reading, not web search. All integration points verified against actual source files.
