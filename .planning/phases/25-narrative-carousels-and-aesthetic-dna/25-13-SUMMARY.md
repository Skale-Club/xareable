---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 13
subsystem: api
tags: [compositor, typography, carousel, edit, base-image, legacy-fallback]

# Dependency graph
requires:
  - phase: 25-narrative-carousels-and-aesthetic-dna (25-02)
    provides: "post_slides/post_slide_versions base_image_url + typography_meta columns"
  - phase: 25-narrative-carousels-and-aesthetic-dna (25-07)
    provides: "typography-compositor.service.ts's resolveTypographyTreatment + compositeTypography's additive treatment? param"
  - phase: 25-narrative-carousels-and-aesthetic-dna (25-12)
    provides: "carousel-generation.service.ts persisting base_image_url/typography_meta per slide and generation_params on the parent post — the real, populated data this plan reads at edit time"
  - phase: 23-deterministic-typography-and-edit-fidelity
    provides: "edit.routes.ts's resolveEditTarget/resolveEditAspectRatio/isTextOnlyEdit/resolveEditTextBlocks pattern, mirrored 1:1 here for carousel slides"
provides:
  - "carousel.routes.ts's POST /api/carousel/slide/edit: typography-aware, edits post_slides.base_image_url (or post_slide_versions' own base), never the flattened composited slide"
  - "resolveSlideEditTarget/resolveSlideEditAspectRatio/resolveCarouselLayoutArchetype/isSlideTextOnlyEdit — exported, pure, pinned by scripts/test-slide-edit-resolution.ts"
  - "text-only slide edits take a zero-AI-call compositor-only fast path"
  - "per-version base_image_url/typography_meta persistence in post_slide_versions + post_slides"
  - "closes the last red check in [svc-carousel-compositor] — Phase 25's svc-carousel-compositor tag is now fully green"
affects: [26]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One batched sibling-slides query (post_slides ordered by slide_number) serves BOTH the slide-1 style anchor (now the BASE image, pre-typography) AND resolveCarouselLayoutArchetype's first-non-null-wins recovery — avoids a second round-trip edit.routes.ts didn't need (it has no sibling-slide concept)"
    - "getActiveImageProvider/selectImageApiKey/openaiKeyForImage resolution moved inside the else (non-text-only) branch of the AI-call decision, since it can early-return the whole request on an OpenAI key error and must not run on the text-only fast path"

key-files:
  created:
    - scripts/test-slide-edit-resolution.ts
  modified:
    - server/routes/carousel.routes.ts
    - scripts/verify-phase-12.6.ts

key-decisions:
  - "adminSb (createAdminSupabase) and the latest-slide-version fetch were hoisted from inside the SSE-streamed try block (old step 14) to right after the brand fetch (old step 6), so editTarget can be resolved — and the request can 400 cleanly — before the SSE stream ever opens."
  - "versionId's declaration was moved earlier (immediately before the re-composite pipeline) instead of its original position after the optimize/upload step, because the new base-image storage path needs it before step 14 now runs."
  - "carouselContextSuffix's slide-2..N clause was rewritten from '...match its visual style, color palette, and typographic tone' to '...match its visual style, color palette, lighting and texture — but do NOT copy its composition, and keep the frame completely text-free', aligning the edit path with 25-10's regenerated-slide instruction and TEXT_FREE_EDIT_RULE instead of contradicting both."

requirements-completed: [CRSL2-02, CRSL2-04]

# Metrics
duration: ~25min
completed: 2026-07-28
---

# Phase 25 Plan 13: Typography-Aware Carousel Slide Edit Summary

**`POST /api/carousel/slide/edit` now edits the slide's persisted pre-typography `base_image_url` and re-runs crop -> compositeTypography (carousel-level archetype + text-style treatment) -> logo overlay -> upload, mirroring Phase 23's `edit.routes.ts` 1:1, with a LEGACY (`base_image_url IS NULL`) branch that reproduces pre-Phase-25 behavior byte-for-byte.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 (all completed, each committed atomically)
- **Files modified:** 2 (`server/routes/carousel.routes.ts`, `scripts/verify-phase-12.6.ts`); 1 created (`scripts/test-slide-edit-resolution.ts`)

## Accomplishments

- **Task 1 (CRSL2-02/CRSL2-04 foundation):** Four pure, exported helpers added to `carousel.routes.ts` — `resolveSlideEditTarget` (mirrors `edit.routes.ts`'s `resolveEditTarget` four-branch preference order: latest-version base image -> slide's own base image -> LEGACY latest-version flattened image -> LEGACY slide flattened image -> null), `resolveSlideEditAspectRatio` (carousel-only `"1:1"|"4:5"` enum, explicit client value -> persisted `generation_params.aspect_ratio` -> `"1:1"` default; deliberately no video-style regex fallback), `resolveCarouselLayoutArchetype` (first-valid-entry-wins recovery of the ONE carousel-level archetype from an array of slide `typography_meta`s, coercing any malformed stored value to `DEFAULT_LAYOUT_ARCHETYPE_ID` without throwing), and `isSlideTextOnlyEdit` (same predicate as `isTextOnlyEdit` minus the video term). `scripts/test-slide-edit-resolution.ts` (new, 20 assertions, zero network) pins the full decision matrix using the same dynamic-`import()`-inside-`main()` + fixture-env-stub pattern as `scripts/test-edit-base-image-resolution.ts`.
- **Task 2 (base-image edit target + text-free prompt + text-only fast path):** The slide fetch now selects `base_image_url`/`typography_meta` and the parent post's `generation_params`. `createAdminSupabase()` and a full `post_slide_versions` fetch were hoisted before the SSE stream opens, resolving `editTarget` via `resolveSlideEditTarget` up front (400s cleanly if nothing to edit). The slide-1 style anchor now comes from one batched `post_slides` query ordered by `slide_number`, preferring each slide's BASE image over its composited image (fixing the edit-time twin of 25-RESEARCH.md Pitfall 3 — the edit model no longer sees another slide's burned-in text and never tries to reproduce or "clean up" it) — the same query feeds `resolveCarouselLayoutArchetype`. The stale CRSL-10 "no on-slide text" comment and the `textEditRules`/"Text handling" prompt line were deleted and replaced with the same `TEXT_FREE_EDIT_RULE` `edit.routes.ts` uses; `carouselContextSuffix` no longer asks the model to match "typographic tone." Text-only edits (`isSlideTextOnlyEdit`) skip the AI image call entirely, reusing `currentBuf`; the real gateway cost (`slideEditCostUsdMicros`) is `undefined` on that path and correctly falls through to `recordUsageEvent`'s flat estimate.
- **Task 3 (re-composite pipeline + per-version persistence, CRSL2-04):** `selectedTextStyleIds` now falls back to the carousel's persisted `generation_params.text_style_ids` when an edit resends none, so a plain edit never silently drops the creator's original type treatment; `resolveTypographyTreatment(selectedTextStyles)` is resolved once per edit. Base-image slides now run the full pipeline after the AI edit (or the text-only pass-through): persist the new pre-typography base as a lossless PNG (non-fatal on upload failure, degrading the NEXT edit to the LEGACY branch, exactly like 25-12's generation-time base upload) -> `resolveEditTextBlocks` -> `compositeTypography` using the CAROUSEL-level `carouselArchetype` (never a per-slide value) and the resolved `typographyTreatment` -> the existing logo overlay. LEGACY slides (`editTarget.isBaseImage === false`) fall through unchanged — no crop, no compositor, no logo re-overlay, no lockout. `post_slide_versions`' insert and `post_slides`' update now both persist `base_image_url`/`typography_meta` (the slide update only writes these for base-image slides, so a LEGACY slide's NULLs are never overwritten and it keeps routing to the LEGACY branch forever). The endpoint's JSDoc header was rewritten to describe the new pipeline instead of the stale "does NOT modify edit.routes.ts" note.

## Task Commits

1. **Task 1: four exported slide-edit resolution helpers + no-network decision-matrix test** - `f9aae1a` (feat)
2. **Task 2: base-image edit target + text-free prompt inversion + text-only fast path** - `029e96f` (feat)
3. **Task 3: re-composite pipeline + per-version base/typography persistence** - `171630e` (feat)

**Plan metadata:** (this commit, below)

## Files Created/Modified

- `server/routes/carousel.routes.ts` — four new exported helpers (`resolveSlideEditTarget`, `resolveSlideEditAspectRatio`, `resolveCarouselLayoutArchetype`, `isSlideTextOnlyEdit`), the slide-edit endpoint rewritten around the base-image edit target, text-free prompt, text-only fast path, and the full re-composite/persistence pipeline
- `scripts/test-slide-edit-resolution.ts` (new) — 20-assertion no-network harness pinning the decision matrix
- `scripts/verify-phase-12.6.ts` — CRSL-EDIT-05 check widened (see Deviations)

## Decisions Made

- `adminSb`/the latest-slide-version fetch were hoisted out of the SSE-streamed section to right after the brand fetch, so a slide with genuinely nothing to edit 400s before any SSE headers are sent (matches `edit.routes.ts`'s pre-SSE `editTarget` resolution).
- `versionId`'s declaration moved earlier (right before the re-composite pipeline) since the new base-image storage path needs it ahead of the original "step 14" position.
- `carouselContextSuffix`'s slide-2..N clause rewritten to stop asking the model to match "typographic tone" (contradicts `TEXT_FREE_EDIT_RULE`) and to explicitly forbid copying slide 1's composition (aligns with 25-10's regenerated-slide instruction).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, self-authored] My own replacement comment for the deleted CRSL-10 note initially contained the exact literal substring the acceptance criteria required to be gone**
- **Found during:** Task 2, immediately after writing `TEXT_FREE_EDIT_RULE`'s explanatory comment (which literally quoted "reverses CRSL-10")
- **Issue:** The plan's own suggested comment text for `TEXT_FREE_EDIT_RULE` contains the literal substring "CRSL-10" (the same self-referential collision class documented in 25-12-SUMMARY.md's "Fix #2") — this would make `grep -c "CRSL-10" server/routes/carousel.routes.ts` return 1, failing Task 2's own acceptance criterion (expected 0).
- **Fix:** Reworded the comment to convey the same meaning ("reverses the old 'carousels have no on-slide text' assumption") without the literal ticket-number substring.
- **Files modified:** `server/routes/carousel.routes.ts`
- **Verification:** `grep -c "CRSL-10" server/routes/carousel.routes.ts` returns 0.
- **Committed in:** `029e96f`

**2. [Rule 3 - Blocking] `scripts/verify-phase-12.6.ts`'s CRSL-EDIT-05 check hardcoded the exact literal `.eq("slide_number", 1)` query that Task 2 deliberately replaced**
- **Found during:** Task 3's zero-regression sweep (`npx tsx scripts/verify-phase-12.6.ts`)
- **Issue:** The check required the literal regex `/\.eq\("slide_number",\s*1\)/` in the slide-edit route window. Task 2's design (per the plan's own action text) replaces the separate slide-1-only query with ONE batched `post_slides` query (ordered by `slide_number`) that also recovers the carousel-level layout archetype, then does `.find((s) => s.slide_number === 1)` — a deliberate, plan-mandated architecture change, not a regression. The literal `.eq("slide_number", 1)` substring no longer exists anywhere in the file.
- **Fix:** Widened the check to accept either the original direct-query form OR the new batched-query-plus-`.find` form (`/slide_number\s*===\s*1/`), preserving the actual invariant being verified (a slide-1-identifying lookup gates the anchor fetch) without weakening it to a no-op.
- **Files modified:** `scripts/verify-phase-12.6.ts`
- **Verification:** `npx tsx scripts/verify-phase-12.6.ts` — CRSL-EDIT-05 went from FAIL to PASS (7/7 overall); no other check in the file was touched.
- **Committed in:** `171630e`

---

**Total deviations:** 2 auto-fixed (1 Rule-1 self-authored comment bug, 1 Rule-3 blocking cross-phase-harness update for a deliberate, plan-mandated implementation change).
**Impact on plan:** Both fixes are comment/regex-only; zero runtime behavior change beyond what the plan itself specified. No scope creep beyond this plan's own files plus the one cross-phase harness line the deliberate architecture change required.

## Issues Encountered

One informal discrepancy, not a functional gap (same class already documented in 25-12-SUMMARY.md's "Issues Encountered"): Task 2/3's acceptance-criteria text expected `grep -c "compositeTypography("` / `"cropToExactAspectRatio("` / `"applyLogoOverlay("` / `"resolveTypographyTreatment("` to each return 2 ("import + call"), but this codebase's named-import style (`import { name } from "..."`) never produces the literal substring `name(` for the imported identifier itself — so the real counts are 1 each (call site only). Confirmed harmless: the AUTHORITATIVE gate, `scripts/verify-phase-25.ts`'s own indexOf/regex-based assertions (the file plans 25-02..25-13 are actually gated against), passed in full — `[svc-carousel-compositor]` is 8/8 green, and the full Phase 25 suite passes with zero failures.

## User Setup Required

None — no external service configuration required. Pure server-side route logic change; no new migrations (all columns this plan reads/writes already existed from 25-02/25-12).

## Next Phase Readiness

- `[svc-carousel-compositor]` is now fully green — this plan closed the last red check (`resolveSlideEditTarget`) left after 25-12.
- Carousel slide editing is now typography-aware end to end, matching the single-image edit path's guarantees: no double-rendered/ghosted text, carousel-level archetype/treatment consistency preserved across edits, and byte-for-byte LEGACY compatibility for slides created before this migration.
- Full verification: `scripts/test-slide-edit-resolution.ts` (20/20), `scripts/verify-phase-25.ts` (full suite green), `npm run check`/`npm run build` clean, zero regression on `verify-phase-21.ts`, `verify-phase-21.1.ts`, `verify-phase-22.ts`, `verify-phase-23.ts` (incl. its `[svc-cross-plan]` sweep), `verify-phase-24.ts`, `verify-phase-12.6.ts` (7/7), `verify-golden-image.ts` (22/22).
- Remaining Phase 25 work: plan 25-14 (not yet executed). No blockers left by this plan.

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/routes/carousel.routes.ts
- FOUND: scripts/test-slide-edit-resolution.ts
- FOUND: scripts/verify-phase-12.6.ts
- FOUND: .planning/phases/25-narrative-carousels-and-aesthetic-dna/25-13-SUMMARY.md
- FOUND: f9aae1a (Task 1 commit)
- FOUND: 029e96f (Task 2 commit)
- FOUND: 171630e (Task 3 commit)
