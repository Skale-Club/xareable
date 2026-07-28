# Phase 13: carousel-quick-remake-and-edit-image — Research

**Researched:** 2026-05-18
**Domain:** Carousel post editing — per-slide edit + Quick Remake; image-provider abstraction integration
**Confidence:** HIGH

---

## Summary

Phase 13 unlocks two editing affordances on carousel posts that are currently hard-gated behind `content_type !== "carousel"` in `post-viewer-dialog.tsx` (lines 608 and 624): **Edit Image** (targeted single-slide edit with a structured prompt) and **Quick Remake** (regenerate the currently visible slide with the same commercial intent). Both are already fully working for single-image posts; the task is to extend them to carousel posts with the correct slide-level semantics.

**Carousel slide persistence is in `post_slides` (a dedicated table, not `posts.slides` JSON and not `post_versions`).** The `post_versions` table belongs exclusively to single-image and video posts. A separate persistence model for carousel slide edits is required — either augmenting `post_slides` with a versions concept (a new `post_slide_versions` table) or an in-place `UPDATE` on the target `post_slides` row. Research recommends a new `POST /api/carousel/slide/edit` endpoint that calls `provider.edit()` with slide-1 as the `currentImage` reference (for slides 2..N), saves a new `post_slide_versions` row, and streams SSE like `edit.routes.ts`. Quick Remake reuses the same endpoint with `source: "quick_remake"`.

**Primary recommendation:** Add `POST /api/carousel/slide/edit` as a new route (no changes to `POST /api/edit-post` which remains single-image/video only). Reuse `PostEditDialog` with a new `slideIndex` prop and `PostEditDialog` contentType `"carousel-slide"` variant. `QuickRemakeGeneratingState` overlay reused as-is. Version storage: new `post_slide_versions` table (mirrors `post_versions` structure but keyed on `post_slide_id + version_number`).

---

## Open Questions Resolved

### 1. Where are carousel slides persisted?

**RESOLVED — HIGH confidence.**

Slides are in a separate `post_slides` table (see `supabase/migrations/20260421000000_v1_1_schema_foundation.sql` Part 3):

```sql
create table if not exists public.post_slides (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  slide_number integer not null,
  image_url text not null,
  thumbnail_url text,
  created_at timestamp with time zone not null
);
```

Schema in `shared/schema.ts`: `postSlideSchema` (`id`, `post_id`, `slide_number`, `image_url`, `thumbnail_url`, `created_at`). There is **no** `post_slides.version_number`, no JSON column on `posts`, and `post_versions` has no `slide_number` column.

### 2. Does a single-slide edit produce a new version or replace in-place?

**RESOLVED — design decision required.**

The existing `post_versions` table cannot be used for carousel slides because:
- Its `version_number` is global per `post_id`, not per slide.
- The viewer already uses `post_versions` exclusively for single-image/video, with complex nav UI, version deletion, etc.
- Mixing carousel slide versions and single-image versions in `post_versions` would corrupt the version counter and the existing viewer navigation.

**Recommended approach:** New `post_slide_versions` table keyed on `(post_slide_id, version_number)`. This mirrors `post_versions` exactly but scoped to individual slides.

Schema to add:
```sql
create table if not exists public.post_slide_versions (
  id uuid default gen_random_uuid() primary key,
  post_slide_id uuid references public.post_slides on delete cascade not null,
  version_number integer not null,
  image_url text not null,
  thumbnail_url text,
  edit_prompt text,
  created_at timestamp with time zone default timezone('utc', now()) not null
);
create unique index on public.post_slide_versions (post_slide_id, version_number);
```

RLS mirrors `post_slides` RLS: users can view/insert versions for slides they own (join to `post_slides` → `posts` → `user_id = auth.uid()`).

**Alternative (simpler, no new table):** Store slide edits directly in `post_slide_versions` OR update `post_slides.image_url` in-place and store old images in `post_slide_versions`. The in-place-update approach loses history, so it is not recommended.

### 3. For Quick Remake of carousel — active slide or full carousel?

**RESOLVED — active slide only (Phase 13 scope).**

Full carousel regeneration is expensive (3–8 image calls + master text call), would require re-running `generateCarousel()` with a new idempotency key, and is out of scope for a "quick" action. Phase 13 quick remake regenerates only the **currently visible slide** in the viewer. The "full carousel remake" can be a future affordance or handled via the creator dialog.

Precedent from REQUIREMENTS.md: `CRSL-V2-01` ("Individual slide regeneration") was deferred to v2 exactly because it "requires persisting `shared_style` per carousel". Phase 13 resolves this by using `post.ai_prompt_used` (the original carousel prompt) as the regeneration seed, combined with slide-1 as the style anchor — the same pattern `generateSlideN()` uses.

### 4. Is there an existing `/api/carousel/slide/edit` endpoint?

**RESOLVED — does not exist.**

Checked all routes in `server/routes/`. Only `POST /api/edit-post` handles edits, and it is scoped entirely to single-image/video posts. A new `POST /api/carousel/slide/edit` must be added. It should NOT modify `edit.routes.ts` to accept carousel posts — that would entangle two different persistence models (post_versions vs post_slide_versions) in one handler.

### 5. Does PostEditDialog need changes for carousels?

**RESOLVED — minimal changes needed.**

`PostEditDialog` currently accepts `contentType: "image" | "video"` (line 46 of `post-edit-dialog.tsx`). It needs a third value `"carousel-slide"` to:
1. Skip the "Text on Image" step (carousel slides have no on-image text in v1.1 per CRSL-10).
2. Send `POST /api/carousel/slide/edit` instead of `POST /api/edit-post`.
3. Pass `slide_id` (the `post_slides.id` UUID) in the request body.

The "Edit Goal" step renders identically for carousel slides. The VoiceInputButton, focus areas, content language selector — all reuse without change.

The `onGenerated` callback signature changes slightly: for carousel slides it returns `{ version_number, image_url, slide_id }` instead of `{ version_number, image_url }`. The viewer handles this to update `carouselSlides[currentSlideIndex]` in local state.

### 6. currentSlideIndex plumbing in the viewer

**RESOLVED — already tracked as state.**

`post-viewer-dialog.tsx` lines 55–56:
```typescript
const [carouselSlides, setCarouselSlides] = useState<PostSlide[]>([]);
const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
```

The index is already maintained. The Edit Image button simply passes `carouselSlides[currentSlideIndex].id` as the `slide_id` parameter to the edit endpoint. Quick Remake passes `carouselSlides[currentSlideIndex]` data to build the request.

---

## Standard Stack

### Core (all pre-existing in the project — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express 5 | installed | Route handler for new carousel/slide/edit endpoint | Project standard |
| Supabase JS | installed | `post_slide_versions` DB reads/writes; RLS auth | Project standard |
| `server/lib/sse.ts` | project | SSE streaming for long-running edits | All edit/generate endpoints use SSE |
| `server/services/image-provider.ts` | project | `getActiveImageProvider()` + `provider.edit()` | Phase 12 mandate — never call gemini directly |
| `server/services/image-optimization.service.ts` | project | `processImageWithThumbnail()` | Used by edit.routes.ts |
| `server/services/storage-cleanup.service.ts` | project | Background cleanup on version delete | Used by edit.routes.ts |
| TanStack Query v5 | installed | Client-side cache invalidation after slide edit | Project standard |
| `client/src/lib/sse-fetch.ts` | project | `fetchSSE()` client consumer | All SSE endpoints use this |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended Project Structure (new/modified files)

```
supabase/migrations/
  YYYYMMDD_post_slide_versions.sql  — new table + RLS + cleanup trigger

server/routes/
  carousel.routes.ts                — ADD POST /api/carousel/slide/edit

shared/schema.ts                    — ADD postSlideVersionSchema + slideEditRequestSchema

client/src/components/
  post-viewer-dialog.tsx            — Unlock Edit Image + Quick Remake for carousels
  post-edit-dialog.tsx              — ADD "carousel-slide" contentType variant
```

### Pattern 1: New Route `POST /api/carousel/slide/edit`

Mirrors `edit.routes.ts` structure but:
1. Request body: `{ slide_id, edit_prompt, content_language, source, edit_context }`
2. Auth + profile + credits: identical to `edit.routes.ts`
3. Fetch target slide from `post_slides` (join to `posts` for ownership + `post_id`)
4. For slide 1: use slide's own `image_url` as `currentImage` in `provider.edit()`
5. For slide 2..N: fetch slide 1's `image_url` as well; pass as `currentImage`, active slide URL as reference via `additionalRefs` — OR simply use the active slide as `currentImage` and slide-1 as `additionalRefs[0]` for style anchoring.
6. Upload new image to `user_assets/{userId}/carousel/{postId}/slide-{N}-edit-{UUID}.webp`
7. Insert `post_slide_versions` row
8. SSE `complete` event returns `{ slide_version_id, version_number, image_url, thumbnail_url, slide_id }`

**Style anchoring decision for slide edits:**
- The `generateSlideN()` function passes slide-1 as `currentImage` and the target slide's prompt as the text prompt. For user-initiated edits, the user's edit prompt is the primary intent, so the **active slide** should be `currentImage` (being edited) and slide-1 should be in `additionalRefs` for style consistency. This matches `ImageEditInput` which already has `additionalRefs?: ReferenceImage[]`.

```typescript
// Source: server/services/image-provider.ts ImageEditInput interface
export interface ImageEditInput {
  prompt: string;
  currentImage: ReferenceImage;      // slide being edited (any slide number)
  apiKey: string;
  model?: string;
  logoImageData?: ReferenceImage | null;
  additionalRefs?: ReferenceImage[]; // slide-1 for style consistency (slide 2..N only)
}
```

### Pattern 2: `PostEditDialog` — "carousel-slide" contentType

Add to `EditPostDialogProps`:
```typescript
contentType?: "image" | "video" | "carousel-slide";
// When "carousel-slide":
slideId?: string;  // post_slides.id
postId?: string;   // still needed for credit billing association
```

Steps for `"carousel-slide"`:
- STEP_TITLES = `["Edit Goal"]` only (no "Text on Image" step — CRSL-10)
- `handleGenerateEdit()` targets `POST /api/carousel/slide/edit` instead of `POST /api/edit-post`
- Request body includes `slide_id` instead of `post_id`

The `onGenerated` callback for the carousel-slide case receives `{ version_number, image_url, slide_id }`. The viewer uses this to update `carouselSlides` local state with the new `image_url`.

### Pattern 3: Quick Remake for Carousel (active slide)

In `post-viewer-dialog.tsx`, the existing `handleQuickRemake()` needs a carousel branch:

```typescript
if (post.content_type === "carousel") {
  // Quick remake of active slide
  const activeSlide = carouselSlides[currentSlideIndex];
  // Build request to POST /api/carousel/slide/edit with source: "quick_remake"
  // Use aiPromptUsed (original carousel prompt) as regeneration seed
  // activeSlide.id as slide_id
}
```

No new `buildCarouselSlideRemakeRequest()` helper is strictly required — the existing `buildQuickRemakeRequest()` pattern can be adapted, but a new helper in `client/src/lib/quick-remake.ts` makes intent clearer. The server endpoint handles `source: "quick_remake"` identically to `edit.routes.ts`.

### Pattern 4: Viewer UI Changes

**Edit Image button** (line 624): Remove `post.content_type !== "carousel"` gate. When `content_type === "carousel"`, open `PostEditDialog` with:
- `contentType="carousel-slide"`
- `slideId={carouselSlides[currentSlideIndex]?.id}`
- `postId={post.id}` (for billing association)

**Quick Remake button** (line 608): Remove `post.content_type !== "carousel"` gate. When `content_type === "carousel"`, call carousel-specific quick remake handler.

**Post-edit state update:** After a successful carousel slide edit, update `carouselSlides` local state with the new `image_url` at `currentSlideIndex`. Do NOT reload the full post or all slides — just splice the updated slide into the array.

**Version navigation for carousel slides:** The existing version nav UI (prev/next version buttons with delete) is scoped to `post.content_type !== "carousel"` and should remain so. Carousel slide versions use a separate inline indicator in the slide viewer (e.g., "Edited" badge on the slide counter). Full version browsing per-slide is v2 scope.

### Anti-Patterns to Avoid

- **Using `post_versions` for carousel slide edits**: The version counter is global per post; mixing slide edits would corrupt existing version navigation for non-carousel posts sharing the same `post_id` bucket logic.
- **Calling `edit.routes.ts` with a carousel post_id**: The handler fetches `post.content_type` to decide video vs image path; a carousel post would fall into the image path and edit `post.image_url` (the cover/slide-1 URL), not the intended slide. Wrong result.
- **Re-using the full `generateCarousel()` service for Quick Remake**: The service does a master text call + N image calls + DB insert of a new post. For a single-slide remake we want a single image call + `post_slide_versions` insert.
- **Storing slide edits in-place (UPDATE post_slides.image_url)**: Destroys original slide, breaks the "compare versions" use case. Always insert into `post_slide_versions`.
- **Omitting the slide-1 style anchor for slide 2..N edits**: Would let the model drift from the carousel's visual language. Always pass slide-1 image as `additionalRefs[0]` when editing slides 2..N.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image editing via Gemini or OpenAI | Custom provider call | `provider.edit()` from `image-provider.ts` | Phase 12 mandate; handles Responses API bug, format conversion, both providers |
| SSE streaming | Custom response flushing | `initSSE(res)` from `server/lib/sse.ts` | Heartbeat, closed-client detection, event format already standardized |
| Client SSE consumption | Custom EventSource | `fetchSSE()` from `client/src/lib/sse-fetch.ts` | Handles auth headers, progress/complete/error events |
| Image optimization + thumbnail | Manual sharp calls | `processImageWithThumbnail()` | Already handles WebP conversion, thumbnail sizing, size logging |
| Credit deduction | Custom billing | `checkCredits()` + `deductCredits()` + `recordUsageEvent()` from `server/quota.ts` | Handles free tier, ownApiKey bypass, budget controls |

---

## Common Pitfalls

### Pitfall 1: OpenAI Responses API — use `provider.edit()`, not images.edit

**What goes wrong:** Calling OpenAI's legacy `images.edit` SDK method returns an SDK bug error rejecting `gpt-image-2` (confirmed SDK bug #1844, documented in Phase 12 research).
**Why it happens:** `OpenAIImageProvider.edit()` uses Responses API with `tools: [{ type: "image_generation", action: "edit" }]`. The legacy `images.edit` path is not supported for `gpt-image-2`.
**How to avoid:** Always call `provider.edit()` — never import from `openai` directly in routes or new services.
**Warning signs:** TypeScript import of `openai` SDK directly in carousel routes.

### Pitfall 2: Credit accounting — single-slide edit = 1 image cost

**What goes wrong:** Carousel generation bills for N slides. A slide edit must bill only 1× image cost (same as `edit.routes.ts`).
**Why it happens:** Developer copies `carousel.routes.ts` credit gate which passes `slide_count` to `checkCredits()`.
**How to avoid:** Call `checkCredits(user.id, "edit")` (no slideCount) — identical to `edit.routes.ts` line 165.
**Warning signs:** `checkCredits(user.id, "edit", false, N)` where N > 1.

### Pitfall 3: Style drift — editing slide 1 invalidates style anchor

**What goes wrong:** The style-consistency mechanism for slides 2..N relies on slide-1's image as anchor. If the user edits slide 1, the new slide-1 image now differs from what slides 2..N were generated against.
**Why it happens:** Structural — the slide-1 buffer was the original style anchor at generation time.
**Policy decision:** For Phase 13, editing slide 1 is allowed without cascading to other slides. Warn the user in the UI ("Editing slide 1 may affect visual consistency"). Full cascade re-generation is a v2 affordance (CRSL-V2-01).
**How to surface:** Add a tooltip/disclaimer in the Edit Image dialog header when `currentSlideIndex === 0 && post.content_type === "carousel"`.

### Pitfall 4: `post_slides` RLS — service role client required for insert

**What goes wrong:** Inserting `post_slide_versions` from the server fails with RLS violation if using the user-scoped Supabase client.
**Why it happens:** `post_slide_versions` RLS should mirror `post_slides` RLS (users can insert for their own slides). But server-side inserts should use `createAdminSupabase()` to bypass RLS — the same pattern used by `carousel-generation.service.ts` and `edit.routes.ts`.
**How to avoid:** Use `createAdminSupabase()` for all DB writes in the new route handler (consistent with every other server-side write in the project).

### Pitfall 5: Slide index vs slide_number

**What goes wrong:** `carouselSlides` is a 0-based JS array. `post_slides.slide_number` is 1-based (set by the generation service `i + 1`). Accidentally passing `currentSlideIndex` as `slide_number` to a query instead of `slide_number === currentSlideIndex + 1`.
**Why it happens:** Off-by-one in index/number mapping.
**How to avoid:** Always identify a slide by its `id` (UUID) on the server side, not by `slide_number`. The client passes `carouselSlides[currentSlideIndex].id` to the endpoint; the server looks up the row by `id`. Never trust client-sent `slide_number`.

### Pitfall 6: `editPostRequestSchema` does not accept carousel posts

**What goes wrong:** Sending a carousel post's `post_id` to `POST /api/edit-post` returns a valid edit, but it edits the post's `image_url` (which is the cover/slide-1 image) and stores a new `post_versions` row — not the intended slide. The edit also runs `enforceExactImageText` which is wrong for carousels.
**Why it happens:** `edit.routes.ts` has no `content_type` guard; it fetches whatever `post.image_url` is.
**How to avoid:** The new `POST /api/carousel/slide/edit` route is separate. Do NOT modify `edit.routes.ts` to handle carousels.

### Pitfall 7: Re-fetching all slides after each edit is expensive

**What goes wrong:** Calling `loadCarouselSlides()` after each slide edit re-fetches all slides from Supabase.
**Why it happens:** Temptation to reuse the existing load function.
**How to avoid:** After a slide edit, do a local state splice: `setCarouselSlides(prev => prev.map((s, i) => i === currentSlideIndex ? { ...s, image_url: newImageUrl } : s))`. Only invalidate the full gallery query (not the slide list in the viewer) via `window.dispatchEvent(new CustomEvent("post:version-created", ...))`.

---

## Runtime State Inventory

This section is not applicable — Phase 13 is not a rename/refactor/migration phase. No runtime state items need auditing.

---

## Environment Availability

Phase 13 is pure code changes (new route, new migration, frontend edits). No new external tools or services are introduced. All dependencies (Supabase, Gemini/OpenAI providers, SSE infrastructure) are already operational from Phases 6–12.

Step 2.6: SKIPPED (no new external dependencies identified — all required services operational from prior phases).

---

## Code Examples

Verified patterns from existing source code:

### Provider edit call (image-provider.ts)

```typescript
// Source: server/services/image-provider.ts ImageEditInput
const result = await provider.edit({
  prompt: editPrompt,
  currentImage: { mimeType: activeSlide.mimeType, data: activeSlide.base64 },
  apiKey: imageApiKey,
  logoImageData: editLogoData,
  additionalRefs: slideIndex > 0 ? [slide1Image] : undefined,  // style anchor
});
```

### SSE initialization (server/lib/sse.ts pattern)

```typescript
// Source: server/routes/edit.routes.ts lines 240-243
const sse = initSSE(res);
sse.startHeartbeat();
sse.sendProgress("auth", "Verified. Starting slide edit...", 10);
const safetyTimer = setTimeout(() => { sse.sendError(...); }, 280_000);
```

### PostSlide state update after edit (client pattern)

```typescript
// Update only the edited slide in local state — no full reload
setCarouselSlides(prev =>
  prev.map((slide, i) =>
    i === currentSlideIndex
      ? { ...slide, image_url: resultData.image_url, thumbnail_url: resultData.thumbnail_url ?? slide.thumbnail_url }
      : slide
  )
);
```

### Schema for new `editSlideRequestSchema`

```typescript
// To add in shared/schema.ts
export const editSlideRequestSchema = z.object({
  slide_id: z.string().uuid(),
  edit_prompt: z.string().min(1),
  content_language: z.enum(SUPPORTED_LANGUAGES).default("en"),
  source: z.enum(["manual", "quick_remake"]).default("manual"),
  edit_context: editPostRequestSchema.shape.edit_context, // reuse existing shape
});
export type EditSlideRequest = z.infer<typeof editSlideRequestSchema>;
```

### Storage path convention for slide versions

```typescript
// Mirror existing slide storage path pattern from carousel-generation.service.ts
// Original: user_assets/{userId}/carousel/{postId}/slide-{N}.webp
// Versions: user_assets/{userId}/carousel/{postId}/slide-{N}-v{version}.webp
const versionId = randomUUID();
const imagePath = `${userId}/carousel/${postId}/slide-${slideNumber}-v${nextVersionNumber}-${versionId}.webp`;
```

---

## Validation Architecture

`workflow.nyquist_validation` key is absent from `.planning/config.json` — treat as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | No automated test framework detected (project uses manual verify scripts + `scripts/verify-phase-*.ts`) |
| Config file | None — ad-hoc verify scripts |
| Quick run command | `npx tsx scripts/verify-phase-13.ts` (to be created in Wave 0) |
| Full suite command | `npm run check` (TypeScript typecheck) + `npx tsx scripts/verify-phase-13.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRSL-EDIT-01 | Edit Image button visible + functional on carousel posts | smoke | Manual — UI interaction | N/A |
| CRSL-EDIT-02 | Quick Remake button visible + functional on carousel posts | smoke | Manual — requires live AI key | N/A |
| CRSL-EDIT-03 | Slide edit creates `post_slide_versions` row, not `post_versions` row | integration | `npx tsx scripts/verify-phase-13.ts` | Wave 0 |
| CRSL-EDIT-04 | Single-slide edit billed as 1× edit cost (not carousel N× cost) | integration | `npx tsx scripts/verify-phase-13.ts` | Wave 0 |
| CRSL-EDIT-05 | Slide-1 style anchor passed as `additionalRefs[0]` for slides 2..N edits | unit | `npx tsx scripts/verify-phase-13.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run check` (TypeScript zero-errors gate)
- **Per wave merge:** `npm run check && npx tsx scripts/verify-phase-13.ts`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `scripts/verify-phase-13.ts` — covers CRSL-EDIT-03, CRSL-EDIT-04, CRSL-EDIT-05
- [ ] Supabase migration for `post_slide_versions` table
- [ ] `shared/schema.ts` additions: `postSlideVersionSchema`, `editSlideRequestSchema`

---

## Phase Requirements (to be assigned by planner)

| ID | Description | Research Support |
|----|-------------|------------------|
| CRSL-EDIT-01 | Edit Image button is visible and functional for carousel posts in PostViewerDialog, acting on the currently visible slide | Post-viewer lines 608/624 gate removal; new PostEditDialog carousel-slide contentType |
| CRSL-EDIT-02 | Quick Remake button is visible and functional for carousel posts, regenerating only the currently visible slide | Post-viewer Quick Remake handler carousel branch; POST /api/carousel/slide/edit endpoint |
| CRSL-EDIT-03 | Per-slide edits are persisted in `post_slide_versions` (new table), not in `post_versions`; slide's local image_url in the viewer updates without full page reload | New migration + new route + client state splice |
| CRSL-EDIT-04 | A single-slide edit deducts credits equivalent to 1 single-image edit, not N × carousel cost | checkCredits(userId, "edit") — no slideCount |
| CRSL-EDIT-05 | For slides 2..N, the slide-1 image is passed as `additionalRefs[0]` to `provider.edit()` to preserve carousel style consistency | ImageEditInput.additionalRefs pattern |

---

## Sources

### Primary (HIGH confidence)

- `client/src/components/post-viewer-dialog.tsx` — exact gate lines (608, 624), `currentSlideIndex` state, `carouselSlides` state, `PostEditDialog` usage pattern
- `client/src/components/post-edit-dialog.tsx` — full EditPostDialogProps interface, step structure, `fetchSSE` call pattern
- `server/routes/edit.routes.ts` — complete edit route implementation: auth, credits, provider.edit(), SSE, post_versions insert
- `server/services/carousel-generation.service.ts` — `generateSlideN()` pattern: slide-1 as `currentImage` in `provider.edit()`, style consistency mechanism
- `server/services/image-provider.ts` — `ImageEditInput.additionalRefs` field, `provider.edit()` signature for both Gemini and OpenAI
- `shared/schema.ts` — `postSlideSchema`, `editPostRequestSchema`, `postVersionSchema` shapes
- `supabase/migrations/20260421000000_v1_1_schema_foundation.sql` — `post_slides` table definition (no `version_number` column confirmed)
- `supabase/migrations/20260304000002_add_post_versions_table.sql` — `post_versions` structure (no `slide_number` column confirmed)
- `client/src/lib/quick-remake.ts` — `buildQuickRemakeRequest()` helper pattern
- `.planning/STATE.md` — Phase 12 decisions: provider abstraction boundary, `additionalRefs` for style consistency

### Secondary (MEDIUM confidence)

- `REQUIREMENTS.md` CRSL-V2-01 — confirms full individual slide regeneration was deferred to v2, validating Phase 13 active-slide-only scope
- `.planning/ROADMAP.md` Phase 13 goal — phase objective and hard constraints stated

---

## Metadata

**Confidence breakdown:**
- Slide persistence model: HIGH — confirmed by reading actual migration SQL and `shared/schema.ts`
- New endpoint architecture: HIGH — direct analogy from `edit.routes.ts` pattern
- Provider abstraction path: HIGH — Phase 12 implementation confirmed in `image-provider.ts`
- UI gate locations: HIGH — exact line numbers read from `post-viewer-dialog.tsx`
- Credit accounting: HIGH — `checkCredits` call in `edit.routes.ts` read directly
- Style-anchor policy (slide-1 drift): MEDIUM — policy decision, no prior implementation to validate against; proposed approach follows `generateSlideN()` pattern

**Research date:** 2026-05-18
**Valid until:** 2026-06-17 (stable domain — no fast-moving dependencies)
