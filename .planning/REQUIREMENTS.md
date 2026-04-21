# Requirements: My Social Autopilot — v1.1 Media Creation Expansion

**Defined:** 2026-04-21
**Core Value:** Users can generate on-brand visual content (single posts, multi-slide carousels, and professionally enhanced product photos) in seconds from a prompt or a reference image.

## v1.1 Requirements

Requirements for the Media Creation Expansion milestone. Each maps to a roadmap phase.

### Schema & Storage (SCHM)

- [ ] **SCHM-01**: `posts.content_type` enum is extended to include `carousel` and `enhancement`, enforced via CHECK constraint so no existing code path regresses
- [ ] **SCHM-02**: A `post_slides` table exists with `id`, `post_id`, `slide_number`, `image_url`, `thumbnail_url`, `created_at`; RLS policies mirror `posts` ownership in the same migration commit
- [ ] **SCHM-03**: A `slide_count` column on `posts` reflects total slides for carousel posts and is `NULL` for other content types
- [ ] **SCHM-04**: Shared Zod schemas (`postSlideSchema`, `carouselRequestSchema`, `enhanceRequestSchema`, `scenerySchema`) compile and are exported from `shared/schema.ts`
- [ ] **SCHM-05**: A client-provided `idempotency_key` column on `posts` prevents duplicate generations when a client retries after SSE disconnect
- [ ] **SCHM-06**: Storage cleanup removes all per-slide images + thumbnails + enhancement source files when a post expires or is deleted (no orphaned storage objects)

### Carousel Generator (CRSL)

- [ ] **CRSL-01**: User can generate a multi-slide Instagram carousel from a single text prompt, choosing a slide count between 3 and 8
- [ ] **CRSL-02**: The server produces one master text-generation call returning shared visual style, per-slide prompts, and one unified caption (no N independent text calls)
- [ ] **CRSL-03**: Slides 2..N are generated with slide 1's output buffer passed as `inlineData` reference to enforce visual consistency
- [ ] **CRSL-04**: The creator restricts aspect ratio to Instagram-safe values (`1:1`, `4:5`) and all slides in one carousel share the same ratio
- [ ] **CRSL-05**: Each slide generation emits a distinct SSE progress event so the client can show per-slide progress
- [ ] **CRSL-06**: The carousel route times out gracefully before Vercel's function cap (safety timer at 260s) and surfaces a clear error to the client
- [ ] **CRSL-07**: When at least 50% of slides (including slide 1) succeed and the rest fail, the post is saved with `status = "draft"`, `slide_count` reflects actual successful slides, and the user is told which slides were produced
- [ ] **CRSL-08**: When a client retries a carousel request with the same `idempotency_key`, the server returns the existing post instead of re-running generation or re-charging
- [ ] **CRSL-09**: Caption quality enforcement runs once on the unified caption, not per slide, to stay within the safety timer budget
- [ ] **CRSL-10**: On-image text rendering (`enforceExactImageText`) is skipped for carousels in v1.1 (runs only on single-image posts)

### Image Enhancement (ENHC)

- [ ] **ENHC-01**: User can upload a single product photo (≤ 5 MB, JPEG/PNG/WEBP) and receive a professionally enhanced version without logo, caption text overlay, or headline composition
- [ ] **ENHC-02**: User selects one scenery preset from the admin-curated catalog before generation; no free-text scenery prompt input in v1.1
- [ ] **ENHC-03**: The server strips EXIF metadata via `sharp().rotate().toBuffer()` before both Gemini submission and Supabase storage
- [ ] **ENHC-04**: The enhancement prompt includes explicit subject-preservation language so the product identity (shape, color, proportions) is retained
- [ ] **ENHC-05**: The server normalizes uploads to `1:1` with sharp before the Gemini editing call (working around the confirmed aspectRatio-ignored bug)
- [ ] **ENHC-06**: A Gemini text-model pre-screen rejects uploads that are faces, screenshots, or explicitly unsafe content with HTTP 400 before the image model is called
- [ ] **ENHC-07**: The enhancement result is uploaded to `user_assets/{userId}/enhancement/{postId}.webp` and the original source is retained at `user_assets/{userId}/enhancement/{postId}-source.webp` for the expiration window
- [ ] **ENHC-08**: Enhancement posts never run logo overlay or caption quality post-processing

### Billing & Credits (BILL)

- [ ] **BILL-01**: `checkCredits` accepts a `slideCount` (or equivalent) multiplier so carousel cost equals N × single-image cost; enhancement cost equals 1 × single-image cost
- [ ] **BILL-02**: One `usage_events` row is recorded per carousel post with token totals summed across all slides and the master text call — not N rows
- [ ] **BILL-03**: When a carousel saves as `draft` (partial success), credit deduction equals successful slides × single-image cost, not the upfront N × cost
- [ ] **BILL-04**: Client retries with a matching `idempotency_key` do not create additional `usage_events` or deductions

### Admin — Scenery Catalog (ADMN)

- [ ] **ADMN-01**: The admin style catalog page has a Sceneries section where an admin can create, edit, and delete scenery presets (`id`, `label`, `prompt_snippet`, `preview_image_url`, `is_active`)
- [ ] **ADMN-02**: Twelve initial sceneries are seeded via migration: white-studio, marble-light, marble-dark, wooden-table, concrete-urban, outdoor-natural, kitchen-counter, dark-premium, softbox-studio, pastel-flat, seasonal-festive, cafe-ambience
- [ ] **ADMN-03**: Sceneries are served as part of the existing `getStyleCatalogPayload()` response so the frontend consumes them through the same cache path as text styles and post moods

### Creator UI (CRTR)

- [ ] **CRTR-01**: A new `carousel-creator-dialog.tsx` exists, launched from the sidebar or gallery, with steps: slide count (3–8) → aspect ratio (1:1 / 4:5) → prompt/reference → generate
- [ ] **CRTR-02**: A new `enhancement-creator-dialog.tsx` exists, launched from the sidebar or gallery, with steps: upload photo → pick scenery → generate
- [ ] **CRTR-03**: The existing `post-creator-dialog.tsx` is not extended for the new types; the three dialogs coexist and share only extracted helper components where duplication would otherwise occur
- [ ] **CRTR-04**: The client generates a UUID `idempotency_key` per submission and includes it in the request body for both new routes
- [ ] **CRTR-05**: Both dialogs stream progress via SSE and display per-slide progress (carousel) or single-phase progress (enhancement)
- [ ] **CRTR-06**: All new UI strings are authored in English and added to the existing i18n files (EN/PT/ES) following the established pattern

### Gallery Surface (GLRY)

- [ ] **GLRY-01**: The posts gallery renders carousel posts with slide 1 as the cover image and a "Carousel · N" badge sourced from `posts.slide_count`
- [ ] **GLRY-02**: The posts gallery renders enhancement posts with their result image and an "Enhanced" badge
- [ ] **GLRY-03**: Clicking a carousel tile opens a viewer that shows each slide sequentially (simple next/prev navigation; embla viewer deferred to v2)
- [ ] **GLRY-04**: A TypeScript `never` exhaustiveness guard is added to the content_type switch in the gallery so any new value forces a compile error instead of silently falling through
- [ ] **GLRY-05**: TanStack Query `invalidateQueries(['posts'])` fires on both SSE `complete` and SSE `error` events so partial-draft carousels appear in the gallery immediately

## v2 Requirements

Deferred to future releases. Tracked but not in the current roadmap.

### Carousel v2

- **CRSL-V2-01**: Individual slide regeneration (requires persisting `shared_style` per carousel)
- **CRSL-V2-02**: Extend slide cap to 10 (requires raising SSE safety timer / validating hosting limits)
- **CRSL-V2-03**: ZIP download of all slides in a carousel
- **CRSL-V2-04**: Per-slide on-image text rendering with `enforceExactImageText`
- **CRSL-V2-05**: Embla-based swipe viewer in the gallery carousel dialog

### Enhancement v2

- **ENHC-V2-01**: Free-text scenery modifier appended to preset prompt
- **ENHC-V2-02**: Before/after toggle UI with precise side-by-side comparison
- **ENHC-V2-03**: Multi-photo batch enhancement in one job
- **ENHC-V2-04**: User-uploaded custom sceneries saved to the user's brand profile

### Shared v2

- **SHRD-V2-01**: Credit preview ("This will use N credits") shown inside the creator dialog before submit

## Out of Scope

Explicitly excluded from v1.1. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Video in carousels | Image-only carousels for v1.1; video carousels deferred |
| Text or logo overlay on enhancement results | Enhancement is a clean product shot, not a branded post |
| User-uploaded custom sceneries | Scenery catalog is admin-curated for v1.1 |
| Panoramic / spanning backgrounds across slides | Anti-feature — fragile against Instagram crop behavior |
| General-purpose photo editor (crop, rotate, filter) | Enhancement upgrades photos with AI scenery; it is not an editor |
| Mobile app | Web-first, deferred indefinitely |
| Direct social media publishing | Generation only; no OAuth to Instagram / Meta platforms |

## Traceability

Populated by the roadmapper when `ROADMAP.md` is created.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHM-01 | — | Pending |
| SCHM-02 | — | Pending |
| SCHM-03 | — | Pending |
| SCHM-04 | — | Pending |
| SCHM-05 | — | Pending |
| SCHM-06 | — | Pending |
| CRSL-01 | — | Pending |
| CRSL-02 | — | Pending |
| CRSL-03 | — | Pending |
| CRSL-04 | — | Pending |
| CRSL-05 | — | Pending |
| CRSL-06 | — | Pending |
| CRSL-07 | — | Pending |
| CRSL-08 | — | Pending |
| CRSL-09 | — | Pending |
| CRSL-10 | — | Pending |
| ENHC-01 | — | Pending |
| ENHC-02 | — | Pending |
| ENHC-03 | — | Pending |
| ENHC-04 | — | Pending |
| ENHC-05 | — | Pending |
| ENHC-06 | — | Pending |
| ENHC-07 | — | Pending |
| ENHC-08 | — | Pending |
| BILL-01 | — | Pending |
| BILL-02 | — | Pending |
| BILL-03 | — | Pending |
| BILL-04 | — | Pending |
| ADMN-01 | — | Pending |
| ADMN-02 | — | Pending |
| ADMN-03 | — | Pending |
| CRTR-01 | — | Pending |
| CRTR-02 | — | Pending |
| CRTR-03 | — | Pending |
| CRTR-04 | — | Pending |
| CRTR-05 | — | Pending |
| CRTR-06 | — | Pending |
| GLRY-01 | — | Pending |
| GLRY-02 | — | Pending |
| GLRY-03 | — | Pending |
| GLRY-04 | — | Pending |
| GLRY-05 | — | Pending |

**Coverage:**
- v1.1 requirements: 42 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 42 ⚠️ (populated during roadmap creation)

---
*Requirements defined: 2026-04-21*
*Last updated: 2026-04-21 after initial definition*
