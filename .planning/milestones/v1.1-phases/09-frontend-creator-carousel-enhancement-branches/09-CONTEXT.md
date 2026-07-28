# Phase 9: Frontend Creator — Carousel & Enhancement Branches - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the existing `client/src/components/post-creator-dialog.tsx` so the user can choose **Carousel** and **Enhancement** as content types alongside Image and Video, in a single creation surface, with type-specific step branches and per-branch generation flow.

**Hard scope rules:**
- No new dialog files (`carousel-creator-dialog.tsx`, `enhancement-creator-dialog.tsx`, etc.)
- No new sidebar entry points — the existing "+ New Post" button in [app-sidebar.tsx](client/src/components/app-sidebar.tsx) remains the single creation launcher
- Backend (`POST /api/carousel/generate`, `POST /api/enhance`) and admin scenery catalog (Phase 8) consumed unchanged
- PostViewer slide navigation is Phase 10 work, not this phase — carousel completion uses an interim in-creator grid

</domain>

<decisions>
## Implementation Decisions

### Content Type step gating

- **D-01:** Replace the current `VIDEO_ENABLED: false` boolean with a `CONTENT_TYPE_ENABLED` config object in `post-creator-dialog.tsx`:
  ```ts
  const CONTENT_TYPE_ENABLED = {
    image: true,
    video: false,
    carousel: true,
    enhancement: true,
  };
  ```
  Initial state ships with Video disabled, others enabled. Flag is flipped per-type by editing this constant (same operational model as the existing `VIDEO_ENABLED` flag).

- **D-02:** "Content Type" step renders **only when 2+ types are enabled**. The picker shows only enabled types. If exactly 1 type is enabled, the step is hidden entirely and `contentType` is pre-set to that single value — the user goes straight into that type's step branch without a single-option picker.

- **D-03:** Disabled types do not appear at all (no "Upgrade" badge — that's the existing per-type billing/upgrade gate which is a separate runtime concern, not a hard disable).

### Carousel branch steps

- **D-04:** After Content Type → "Carousel" is selected, step list becomes: **Slides → Reference → Mood → Format**.
  - Slides: count picker 3–8 (CRSL-04)
  - Reference: same UX as Image branch (text + reference images + voice input)
  - Mood: same `post_mood` picker as Image branch
  - Format: aspect ratio picker locked to `1:1` and `4:5` only (CRSL-04). All slides share the chosen ratio.
- **D-05:** No "Text on image" step (CRSL-10 — backend skips `enforceExactImageText` for carousels in v1.1).
- **D-06:** No "Logo Placement" step — carousels do not run logo overlay in v1.1.
- **D-07:** Final button text: `"Generate Carousel"`.

### Enhancement branch steps

- **D-08:** After Content Type → "Enhancement" is selected, step list becomes: **Upload Photo → Scenery Picker**.
- **D-09:** Upload step: file input accepting JPEG/PNG/WEBP, ≤ 5 MB. Client-side validation rejects out-of-spec files with a toast and never uploads them. **Any aspect ratio accepted** — frontend does not constrain ratio (1:1, 4:5, 16:9, portrait, landscape all OK). Backend [enhancement.service.ts](server/services/enhancement.service.ts) normalizes to 1:1 via sharp before the Gemini call (ENHC-05). Multi-ratio output is deferred to v2 (ENHC-V2-x).
- **D-10:** No Mood, no Text-on-image, no Logo, no Format steps for Enhancement (ENHC-08 enforces this on the backend; frontend simply doesn't expose them).
- **D-11:** Final button text: `"Enhance Photo"`.

### Scenery picker UX

- **D-12:** Scenery picker is rendered as a **responsive grid of cards** mirroring the Phase 8 admin SceneriesCard pattern: `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4`. Each card shows:
  - `aspect-video` thumbnail from `scenery.preview_image_url` (with `<ImageIcon>` placeholder when null)
  - `scenery.label` as the card title
  - First line of `scenery.prompt_snippet` truncated as supporting text
  - Selected card: `border-violet-400 bg-violet-400/10` (matches existing dialog selection style)
- **D-13:** Filters list to `scenery.is_active !== false`. Inactive sceneries never surface to the user.
- **D-14:** Sceneries fetched via the existing `useQuery({ queryKey: ["/api/style-catalog"] })` hook already in `post-creator-dialog.tsx` — `catalog.sceneries.filter(...)`. No new query.

### Empty scenery catalog (edge case)

- **D-15 (Claude's Discretion):** If the filtered active-scenery list is empty:
  1. The "Enhancement" option is hidden in the Content Type step
  2. An inline note appears: `"Photo enhancement is currently unavailable."`
  3. The user is not allowed to enter the Enhancement branch
  Rationale: cleanest UX; users don't enter a flow they can't complete. If the user wants a different behavior after seeing it live, this is easily flippable.

### Carousel progress visualization

- **D-16:** During carousel generation, render **N progressive thumbnail placeholders** in a row (one per requested slide). Each placeholder starts as a spinner. As each `slide_complete` SSE event arrives carrying an `image_url`, that placeholder swaps to the real slide thumbnail. Backend already emits per-slide events (Phase 7 D-05).
- **D-17:** A textual status above the row reads `"Generating slide {n} of {total}…"` and updates per slide event. Aggregate progress bar (existing `<Progress>` component) reflects overall percentage.
- **D-18:** Failed slides (`slide_failed` event) render with a red `<AlertTriangle>` icon in the placeholder; if partial-success threshold is met (≥ 50%), generation continues and the result is saved as `draft` (CRSL-07).

### Result handoff per content type

- **D-19 (Carousel):** **Stay in the creator** after completion. The dialog shifts to a new view mode `"result"` showing:
  - All N successful slides in a grid (re-using the same thumbnail row from the generating state)
  - The unified caption (CRSL-09) in a read-only block
  - Two buttons: `"Save & Close"` (closes the dialog) and `"Generate Another"` (resets to Content Type)
  - Does NOT call `openViewer(...)` because PostViewer doesn't navigate slides yet (GLRY-03 / Phase 10).
  - When Phase 10 ships with slide navigation, this view can be replaced with `openViewer(...)` — D-19 is intentionally a Phase 9 interim choice that decouples from Phase 10.
- **D-20 (Enhancement):** **Open the existing PostViewer** with the enhanced image, same handoff as Image and Video. Caption is plain (ENHC-08), Quick Remake and Edit buttons remain available. Zero new viewer code.

### Validation per branch (what blocks the Generate button)

- **D-21:**
  - Image: existing rules unchanged
  - Video: existing rules unchanged
  - Carousel: requires `(reference_text OR reference_images.length > 0)`, `slide_count ∈ [3, 8]`, `aspect_ratio ∈ {"1:1", "4:5"}`
  - Enhancement: requires `uploaded photo file present`, `scenery_id selected`

### Reset behavior on Content Type change

- **D-22 (Claude's Discretion):** When the user navigates back to the Content Type step and selects a different type, **reset all subsequent step state** (selected mood, copy text, format, slide count, uploaded photo, selected scenery). The Reference text/images and Content Language could theoretically be preserved across types but are reset for predictability. The existing close-and-reopen flow already does a full reset; this just extends the same logic to mid-flow type changes.

### Idempotency and i18n

- **D-23:** Each Generate click produces a fresh UUID via `crypto.randomUUID()` and includes it in the request body as `idempotency_key` (CRTR-04, BILL-04). Network retry of the same generation reuses the same key (already handled inside `fetchSSE` retry helpers if applicable).
- **D-24:** All new user-facing strings flow through `useTranslation()` and are added to `client/src/lib/translations.ts` for EN, PT, and ES (CRTR-06).

### Pattern reuse (no new abstractions)

- **D-25:** File upload follows the same pattern used in [client/src/pages/onboarding.tsx](client/src/pages/onboarding.tsx#L131) (brand logo) and [Phase 8 sceneries-card.tsx](client/src/components/admin/post-creation/sceneries-card.tsx) (admin preview upload):
  1. Validate MIME + size client-side
  2. `URL.createObjectURL()` for in-dialog preview
  3. Send file as base64 (Carousel/Enhancement existing routes accept base64) OR upload to Supabase Storage (depends on the existing route contract — researcher will confirm)
- **D-26:** SSE consumed via the existing `fetchSSE` helper in `client/src/lib/sse-fetch.ts` — same pattern `/api/generate` already uses.
- **D-27:** Voice input (`<VoiceInputButton>`) reused for the Carousel Reference step. Not used in Enhancement.

### Sidebar / entry points

- **D-28:** No changes to `client/src/components/app-sidebar.tsx`. The existing "+ New Post" button is the single launcher. No new sidebar items, no new pages, no new routes for the creator.

### Claude's Discretion

- **D-15** (empty scenery catalog) — picked block-at-Content-Type with inline note (user said "nao entendi", treated as defer to me)
- **D-22** (reset on type change) — picked full reset for predictability

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 9 frontend (this phase)
- `client/src/components/post-creator-dialog.tsx` — The dialog being extended. Existing `contentType` state at line ~123, `IMAGE_STEPS`/`VIDEO_STEPS` arrays at lines 87/96, `VIDEO_ENABLED` flag at line 83, `handleGenerate` at line 351 (calls `/api/generate` via `fetchSSE`).
- `client/src/lib/sse-fetch.ts` — `fetchSSE(url, body, { onProgress, onComplete })` helper used by all SSE consumers.

### Phase 8 patterns to mirror
- `client/src/components/admin/post-creation/sceneries-card.tsx` — Card grid + file upload + AlertDialog pattern. Card layout `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` and `aspect-video` thumbnail come from here.
- `client/src/pages/onboarding.tsx` §125-152 — Brand logo upload to Supabase Storage; canonical pattern for file inputs.

### Schema / types
- `shared/schema.ts` — `Scenery`, `StyleCatalog`, `carouselRequestSchema`, `enhanceRequestSchema`, `postSchema.content_type` enum, `idempotencyKeySchema` if exported.
- `client/src/lib/auth.tsx` — `useAuth()` exposing `user` (for upload paths if needed).

### Backend contract (read-only, do not modify in this phase)
- `server/services/enhancement.service.ts` — `EnhancementParams` interface (line 98), `EnhancementProgressEvent` (line 109), `EnhancementResult` (line 118). Confirms: server accepts `image: { mimeType, data: base64 }`, `sceneryId`, `idempotencyKey`, `contentLanguage` (hardcoded to "en" in route per Phase 7 D-XX).
- `server/services/carousel-generation.service.ts` — Carousel SSE event shapes; consumed by `/api/carousel/generate` route.
- `.planning/phases/07-server-routes/07-CONTEXT.md` §SSE event shape (D-03/D-04/D-05) — the exact event shapes the frontend must consume.
- `server/routes/style-catalog.routes.ts` — `getStyleCatalogPayload()` cache path; sceneries served here.

### Roadmap / requirements
- `.planning/ROADMAP.md` Phase 9 section — Goal + Success Criteria 1–6.
- `.planning/REQUIREMENTS.md` §Creator UI (CRTR-01..06) — **needs update before/during planning**: CRTR-01/02/03 still describe separate dialogs; planner or a doc-fix plan should rewrite these to match the unified-dialog decisions in this CONTEXT.

### Prior context to carry forward
- `.planning/phases/06-server-services/06-CONTEXT.md` — Carousel and enhancement service contracts (read for understanding only).
- `.planning/phases/07-server-routes/07-CONTEXT.md` — SSE wiring decisions, idempotency gate (D-01).
- `.planning/phases/08-admin-scenery-catalog/08-01-SUMMARY.md` — Card-grid + upload patterns established by Phase 8 (the reference for SceneryPicker UX).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `<VoiceInputButton>` — already used in `post-creator-dialog.tsx` Reference step; reuse for Carousel Reference verbatim. Skip in Enhancement.
- `<TypographySelector>` / `TextStylePickerSheet` — Image-specific, not reused for Carousel (no Text-on-image) or Enhancement.
- `<GeneratingLoader>` + `<Progress>` — existing generation indicators; carousel adapts these by adding the per-slide thumbnail row above.
- `<Dialog>`, `<AlertDialog>` (shadcn) — already imported and used; new branches don't introduce new primitives.
- `<AddCreditsModal>` and `<UpgradePlanModal>` — already wired for credit gating; reuse with `slide_count` multiplier on the credit pre-check call.
- `usePostCreator()` hook — already provides `isOpen`, `closeCreator`, `markCreated`, `contentLanguage`, `setContentLanguage`. Extends if any new shared state is needed.
- `usePostViewer()` hook — `openViewer(...)` for Enhancement handoff.

### Established Patterns
- **Step-by-step wizard with branches:** `IMAGE_STEPS` / `VIDEO_STEPS` arrays already drive a step-list pattern. Add `CAROUSEL_STEPS` and `ENHANCEMENT_STEPS` arrays. `currentStepTitle = steps[step]` already does branch routing in `renderStepContent()`.
- **State reset on close:** `useEffect(() => { if (!isOpen) { ...resets } }, [isOpen])` pattern at line 183 of the current dialog.
- **File upload + Supabase Storage:** Phase 8 sceneries upload pattern + onboarding logo upload pattern. Both work with `user_assets` bucket and admin/user-scoped paths.
- **Credit pre-check:** `useQuery<CreditStatus>({ queryKey: ["/api/credits/check?operation=generate"] })` already in dialog. For Carousel, the credit endpoint accepts a `slide_count` query param (per BILL-01).

### Integration Points
- `app-sidebar.tsx` "+ New Post" button → opens `usePostCreator().open()` → renders `<PostCreatorDialog />` → all four content types share this same instance.
- `<PostCreatorDialog />` is mounted globally in `App.tsx`; extension is purely internal.
- Backend routes already registered in `server/routes/index.ts` per Phase 7-03; no server-side changes for Phase 9.

### Constraints
- Avoid extracting "branch components" (e.g., `CarouselBranch.tsx`) unless they grow >150 lines — the user prefers iterative refinement over speculative abstraction (Phase 8 lesson).
- All commit messages, code comments, user-facing strings authored in English (PROJECT.md constraint).
- 2-space indentation on client side (CONVENTIONS.md).

</code_context>

<specifics>
## Specific Ideas

- User wants the `CONTENT_TYPE_ENABLED` flag pattern modeled after the current `VIDEO_ENABLED` boolean — same operational model: flip a constant in code, that's it. No admin UI for enabling/disabling content types in v1.1 (out of scope).
- User confirmed "thumbnails progressivas" for carousel — the visual reveal as each slide finishes generating. This drives a noticeable interaction differentiator vs the existing single-image generating state.
- User confirmed "stay in creator" with a slide grid for carousel completion — explicitly chose to NOT depend on Phase 10 PostViewer slide navigation.
- User chose to accept any-aspect-ratio uploads in Enhancement — surfacing of the bug-driven 1:1 normalization stays invisible to the user.
- Empty scenery catalog handling deferred to Claude's Discretion — block at Content Type step if zero active.

</specifics>

<deferred>
## Deferred Ideas

These came up during discussion or are pre-recorded in REQUIREMENTS.md §v2; they belong outside Phase 9.

### Already in REQUIREMENTS.md v2
- **ENHC-V2-01** — Free-text scenery modifier appended to preset prompt
- **ENHC-V2-02** — Before/after toggle UI with side-by-side comparison
- **ENHC-V2-03** — Multi-photo batch enhancement
- **ENHC-V2-04** — User-uploaded custom sceneries
- **CRSL-V2-01** — Individual slide regeneration
- **CRSL-V2-02** — Extend slide cap to 10
- **CRSL-V2-03** — ZIP download of all slides
- **CRSL-V2-04** — Per-slide on-image text rendering
- **CRSL-V2-05** — Embla swipe viewer in gallery (different surface from Phase 9)
- **SHRD-V2-01** — Credit preview ("This will use N credits") inside creator dialog before submit

### Newly raised in Phase 9 discussion
- **Multi-aspect-ratio Enhancement output** — user asked about it, recommended option was "accept any input ratio, output stays 1:1". True multi-ratio output requires backend change to `enhancement.service.ts:506-526` (re-square defense + ENHC-05 normalization). Track as an extension of ENHC-V2 if desired in a future milestone.
- **Admin UI for Content Type enabling** — user described the operational pattern as a code-flip flag (matching VIDEO_ENABLED). A dedicated admin card for it is a v2 nice-to-have, not blocking.

</deferred>

---

*Phase: 09-frontend-creator-carousel-enhancement-branches*
*Context gathered: 2026-04-29*
