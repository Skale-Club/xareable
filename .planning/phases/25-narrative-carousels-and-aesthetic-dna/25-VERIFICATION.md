---
phase: 25-narrative-carousels-and-aesthetic-dna
verified: 2026-07-28T13:03:41Z
status: human_needed
score: 6/6 code-level truths verified; 1 blocking human-verification checkpoint outstanding (deferred by explicit user decision)
must_haves:
  truths:
    - "A generated carousel shows a distinct hook slide, one or more developing content slides, and a CTA slide, each carrying its own on-slide text composited deterministically, with fonts/colors/layout archetype held consistent across all slides"
    - "Slides visibly vary: an automated inter-slide composition-similarity check confirms no two slides share the same framing/layout"
    - "A carousel honors the creator's previously-dead text-style selection and use_logo/logo_position choices — the deterministic logo overlay is applied per slide"
    - "Selecting any style/mood produces output with a recognizable, specific photography type, lighting treatment, and correct 60-30-10 brand-color usage (using color_4)"
    - "Admin can attach a platform-curated style reference board to a style/mood, and those images are attached to the image-generation call as style references"
    - "layout_archetype_id is chosen once for the whole carousel and genuinely recovered (not re-derived) on slide edit"
  artifacts:
    - path: "server/services/carousel-generation.service.ts"
      provides: "narrative master plan, per-slide compositor pipeline (crop->typography->logo->upload), server-side role assignment, 3-tier reference merge, GATE-07 text-only rollback"
    - path: "server/services/carousel-plan-schema.service.ts"
      provides: "dual-dialect narrative schema, deterministic assignSlideRoles, composition-variation Jaccard check"
    - path: "server/routes/carousel.routes.ts"
      provides: "typography-aware slide edit: resolveSlideEditTarget, resolveCarouselLayoutArchetype, LEGACY branch, text-only fast path"
    - path: "server/services/style-reference.service.ts"
      provides: "pure 3-tier (user>brand>style-board) 4-slot reference merge shared by both generation paths"
    - path: "server/services/style-art-direction.service.ts"
      provides: "dense art-direction block builder + GLOBAL_ANTI_AI_NEGATIVE_PROMPT"
    - path: "server/services/prompt-builder.service.ts"
      provides: "formatBrandColorsProportional (60-30-10, color_4 = accent)"
    - path: "shared/schema.ts"
      provides: "artDirectionSchema + dense DEFAULT_STYLE_CATALOG content (9 styles + 12 moods) + styleReferencePhotoSchema"
    - path: "server/routes/style-references.routes.ts"
      provides: "admin-only CRUD for style_reference_photos"
    - path: "supabase/migrations/20260729000000_post_slides_base_image_typography.sql"
      provides: "additive base_image_url/typography_meta on post_slides + post_slide_versions"
    - path: "supabase/migrations/20260729000001_style_reference_photos.sql"
      provides: "style_reference_photos table + inverted-ACL RLS"
  key_links:
    - from: "carousel-generation.service.ts"
      to: "carousel-plan-schema.service.ts assignSlideRoles"
      via: "plan = { ...plan, slides: assignSlideRoles(plan.slides) } — server overrides model's role guess"
    - from: "carousel-generation.service.ts compositeTypography call"
      to: "plan.layout_archetype_id"
      via: "single carousel-level value passed to every slide's compositeTypography() call"
    - from: "carousel.routes.ts resolveCarouselLayoutArchetype"
      to: "post_slides.typography_meta.layout_archetype_id"
      via: "first-valid-entry-wins recovery from persisted per-slide typography_meta"
    - from: "generate.routes.ts / carousel-generation.service.ts"
      to: "style-reference.service.ts resolveGenerationReferenceImages/planReferenceImageSlots"
      via: "shared 4-slot user>brand>style-board priority merge, REFERENCE_IMAGE_SLOT_LIMIT=4"
    - from: "carousel-generation.service.ts callCarouselTextPlan direct-Gemini branch"
      to: "GATE-07 rollback"
      via: "referenceImages param accepted but deliberately unused — stays text-only"
gaps: []
human_verification:
  - test: "25-14 Task 3 — 8-step live operator runbook (embedded at the bottom of scripts/verify-phase-25.ts, mirrored in 25-HUMAN-UAT.md)"
    expected: "Real narrative carousel with shared layout_archetype_id, real composited slide text, real per-slide framing variation, real text-style/logo treatment, a slide edit with no double-render, a LEGACY slide edit unaffected, real aesthetic-DNA payload content (photography_type/60-30-10/color_4/Avoid block), a real style-reference-board attachment, and a no-regression sweep (video/enhancement/single-image/legacy edit) — all against the live Coolify host + live Supabase project with real paid AI calls"
    why_human: "Requires the real production host, live Supabase project (with both Phase 25 migrations applied), and real paid Gemini/OpenRouter calls — none available in this execution environment. Explicitly deferred by user decision; status is persisted as 'partial' (9/9 steps pending) in 25-HUMAN-UAT.md."
---

# Phase 25: Narrative Carousels & Aesthetic DNA Verification Report

**Phase Goal:** Carousels produce a genuine visual narrative (hook slide → developing content slides → CTA slide) with per-slide composition variation and real on-slide text via the deterministic compositor; every style/mood in the platform catalog carries dense, professional art direction — photography type, lighting, 60-30-10 named-color usage, anti-AI-look negative prompts — with admin-curated style reference boards attached to generation.

**Verified:** 2026-07-28T13:03:41Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

This phase's ROADMAP entry shows 13/14 plans executed. Plan 25-14's Tasks 1-2 (the 8th `[svc-cross-plan]` harness tag + the embedded live runbook) are done; Task 3 (operator sign-off on that runbook) is a `checkpoint:human-verify`/`gate=blocking` task that was explicitly deferred by user decision, with its 9-step tracking table already persisted (all `pending`) in `25-HUMAN-UAT.md`. Per the verification brief, this is reported as `human_needed`, not a code gap.

All CODE-LEVEL must-haves across all 14 plans were independently re-verified by reading the actual source (not by trusting `scripts/verify-phase-25.ts`'s exit code alone, though that script was also independently re-run and reproduced 71/71 green, and `npm run check` was independently re-run clean).

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Carousel narrative structure: hook/content/cta, one archetype for all slides, per-slide on-slide text | ✓ VERIFIED | `carousel-plan-schema.service.ts:70-84` (`assignSlideRoles`, index-based hook/content/cta); `carousel-generation.service.ts:639` re-applies it server-side after the plan call, discarding the model's own role guess; `CarouselWireSlide` (schema.service.ts:48-54) carries no per-slide archetype field — only `CarouselWirePlan.layout_archetype_id` (line 58) exists, and `carousel-generation.service.ts:768` passes `plan.layout_archetype_id` (the single carousel-level value) to every slide's `compositeTypography()` call |
| 2 | Per-slide composition variation, automated similarity check | ✓ VERIFIED | `findDuplicateCompositionNotes`/`jaccard` (schema.service.ts:127-173) — Jaccard token-overlap check at a 0.8 threshold, called at `carousel-generation.service.ts:643` and logged (not hard-failed) as `[carousel] composition variation warning:`; master prompt (`buildCarouselMasterPrompt`, lines 248-250) explicitly instructs materially different framing per slide while keeping style/color/lighting/archetype constant |
| 3 | Text-style treatment + logo overlay applied per slide | ✓ VERIFIED | `resolveTypographyTreatment` resolved once before the loop (`carousel-generation.service.ts:686`) and passed into every slide's `compositeTypography()`; `applyLogoOverlay` called once per slide inside the loop (line 778); `IDENTITY_TYPOGRAPHY_TREATMENT` default (typography-compositor.service.ts:104-109) preserves byte-identical Phase 23 output when no treatment is selected |
| 4 | Dense, specific aesthetic DNA (photography type/lighting/60-30-10/color_4/negative prompts) reaches both single-image and carousel prompts | ✓ VERIFIED | `shared/schema.ts:306-574` — all 9 styles + 12 post moods have distinct, non-generic `photography_type`/`lighting`/`composition`/`texture`/`negative_prompts` (spot-checked verbatim, e.g. "editorial corporate photography, 50mm prime lens..." vs "high-speed action photography, telephoto motion-freeze..."); `formatBrandColorsProportional` (`prompt-builder.service.ts:389-422`) names `color_4`'s value explicitly as the 10% accent, degrades gracefully when null; both `gemini.service.ts:644` (image branch) and `carousel-generation.service.ts:241` call `buildStyleArtDirectionBlock`/inject `formatBrandColorsProportional` |
| 5 | Admin-curated style reference boards attached to generation, priority-capped at 4 | ✓ VERIFIED | `style-reference.service.ts` — `planReferenceImageSlots` (user>brand>style-board, hard 4-cap via sequential `.slice(remaining)`); wired into `generate.routes.ts:483` and `carousel-generation.service.ts:597` identically; `style-references.routes.ts` admin CRUD gated by `requireAdminGuard` (403 on non-admin, confirmed in `auth.middleware.ts:203-206`), registered in `server/routes/index.ts:27,132` |
| 6 | Slide-edit typography-awareness: no double-render, LEGACY branch unregressed | ✓ VERIFIED | `carousel.routes.ts` — `resolveSlideEditTarget` (lines 77-105) prefers persisted `base_image_url` over the flattened image; `resolveCarouselLayoutArchetype` (145-155) recovers the ONE persisted archetype value (never re-derives); the `if (editTarget.isBaseImage)` block (1164-1218) runs the full re-composite pipeline while the LEGACY (`isBaseImage === false`) path falls through completely unchanged (no crop/compositor/logo) — genuinely distinct branches, not a shared code path with a flag |

**Score:** 6/6 code-level truths verified. The phase's 7th "truth" — a live human confirming all of this end-to-end against production — is the one deferred, `human_needed` item.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `server/services/carousel-generation.service.ts` | narrative plan + full per-slide compositor pipeline + reference merge | ✓ VERIFIED | All wiring present and load-bearing (crop→persist-base→typography→logo→upload, in that exact source order) |
| `server/services/carousel-plan-schema.service.ts` | dual-dialect schema + deterministic role/variation logic | ✓ VERIFIED | `assignSlideRoles`, `findDuplicateCompositionNotes`, `validateCarouselWirePlan`, both schema dialects present and structurally distinct (lowercase/strict vs UPPERCASE/no-strict) |
| `server/routes/carousel.routes.ts` | typography-aware slide edit | ✓ VERIFIED | All 4 exported helpers present and used; LEGACY branch confirmed genuinely distinct |
| `server/services/style-reference.service.ts` | pure 3-tier reference merge | ✓ VERIFIED | `REFERENCE_IMAGE_SLOT_LIMIT=4`, `planReferenceImageSlots`, `resolveGenerationReferenceImages` all present, consumed by both generation paths |
| `server/services/style-art-direction.service.ts` | dense art-direction block + global negative prompt | ✓ VERIFIED | `buildStyleArtDirectionBlock`, `buildNegativePromptBlock`, `GLOBAL_ANTI_AI_NEGATIVE_PROMPT` (10 distinct AI-look failure modes) |
| `server/services/prompt-builder.service.ts` | 60-30-10 color formula | ✓ VERIFIED | `formatBrandColorsProportional` explicitly uses `color_4`'s value as the 10% accent; degrades gracefully when color_3/color_4 absent |
| `shared/schema.ts` | artDirectionSchema + dense catalog content + style_reference_photos schema | ✓ VERIFIED | All 9 styles/12 moods carry distinct, specific 5-field art direction; `withDefaultArtDirection`/`isEmptyArtDirection` backfill present |
| `server/routes/style-references.routes.ts` | admin CRUD | ✓ VERIFIED | GET/POST/DELETE all admin-gated, storage cleanup on delete, cap-checked against `MAX_STYLE_REFERENCE_PHOTOS` |
| Both Phase 25 migrations | additive schema + inverted-ACL RLS | ✓ VERIFIED | `post_slides`/`post_slide_versions` gain nullable no-default/no-backfill columns; `style_reference_photos` has public SELECT + admin-only INSERT/UPDATE/DELETE, matching the `app_settings` precedent |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `carousel-generation.service.ts` | `carousel-plan-schema.service.ts` | `assignSlideRoles(plan.slides)` overwrite after the plan call | ✓ WIRED | Called at generation time (line 639) — model's own role field is discarded, not merely requested via prompt |
| `carousel-generation.service.ts` compositor call | `plan.layout_archetype_id` | single carousel-level value | ✓ WIRED | `CarouselWireSlide` has no per-slide archetype field at all — structurally impossible to vary per slide |
| `carousel.routes.ts` `resolveCarouselLayoutArchetype` | persisted `typography_meta.layout_archetype_id` | first-valid-entry-wins recovery over sibling slides | ✓ WIRED | Reads the value `compositeTypography` wrote at generation time (`typography-compositor.service.ts:650`) — a genuine recovery, not a re-derivation |
| `generate.routes.ts` + `carousel-generation.service.ts` | `style-reference.service.ts` | `resolveGenerationReferenceImages`/`planReferenceImageSlots` | ✓ WIRED | Identical 4-slot cap consumed by both paths; `isVideo` gates both new reference tiers off entirely for video |
| `carousel-generation.service.ts` direct-Gemini branch | GATE-07 rollback | `referenceImages` param accepted but unused | ✓ WIRED (confirmed text-only) | Comment + code confirm the direct-Gemini emergency-rollback branch never attaches multimodal image parts |
| `gemini.service.ts` / `carousel-generation.service.ts` | `style-art-direction.service.ts` | `buildStyleArtDirectionBlock`/`formatBrandColorsProportional` | ✓ WIRED | Both call sites confirmed; video branch in `gemini.service.ts` uses the frozen `formatBrandColorsLabeled` instead (GATE-08 fence intact) |
| `style-references.routes.ts` | `auth.middleware.ts` | `requireAdminGuard` | ✓ WIRED | Every route (GET/POST/DELETE) calls it first; non-admin gets 403 |

### Data-Flow Trace (Level 4)

Not applicable in the traditional sense (no React component rendering fetched state) — the equivalent server-side trace is the prompt-payload injection chain, which was directly verified: `DEFAULT_STYLE_CATALOG` (real, dense per-entry data) → `resolveCatalogEntries` → `buildStyleArtDirectionBlock`/`buildNegativePromptBlock` → interpolated verbatim into both `gemini.service.ts`'s `buildContextPrompt` and `carousel-generation.service.ts`'s `buildCarouselMasterPrompt`. No hardcoded/empty fallback found on this path — `isArtDirectionEmpty` only omits the art-direction lines (never breaks the block) when a catalog entry genuinely predates PLAN-05, and `withDefaultArtDirection` backfills that case at read time.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Full Phase 25 static+functional harness | `npx tsx scripts/verify-phase-25.ts` | 71/71 PASS across 8 tags (independently reproduced, not just trusted from SUMMARY) | ✓ PASS |
| TypeScript compiles clean | `npm run check` | exits 0, no errors | ✓ PASS |
| Admin UI wiring for art-direction fields | grep for `updateArtDirection`/`art_direction.photography_type` bindings in `brand-styles-card.tsx`/`post-moods-card.tsx` | present, wired to real onChange handlers, not cosmetic placeholders | ✓ PASS |
| Live AI-call-dependent behaviors (real narrative output, real composition variation, real image quality, real reference-board influence) | N/A — requires paid API calls against live Coolify/Supabase | not run | ? SKIP (routed to human_verification) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| PLAN-05 | 25-01,02,05,06,09,10,11,14 | Dense art direction + global anti-AI-look negative block | ✓ SATISFIED (code) | `DEFAULT_STYLE_CATALOG` dense content, `buildStyleArtDirectionBlock`, `GLOBAL_ANTI_AI_NEGATIVE_PROMPT`, both-path injection confirmed |
| PLAN-06 | 25-01,06,09,10,14 | 60-30-10 named-color proportion, `color_4` included | ✓ SATISFIED (code) | `formatBrandColorsProportional` explicitly uses `color_4`'s value as the accent |
| PLAN-07 | 25-01,02,04,08,09,11,12,14 | Platform-curated style reference boards attached to generation | ✓ SATISFIED (code) | `style_reference_photos` table + RLS, admin CRUD, 4-slot merge wired into both generation paths |
| CRSL2-01 | 25-01,02,03,10,14 | Narrative typing + layout archetype + composition variation directive | ✓ SATISFIED (code) | `assignSlideRoles`, `findDuplicateCompositionNotes`, single carousel-level archetype |
| CRSL2-02 | 25-01,02,12,13,14 | Per-slide typography with shared style tokens held constant | ✓ SATISFIED (code) | Full compositor pipeline wired generation-time AND edit-time (25-13 closes the edit-time regression risk) |
| CRSL2-04 | 25-01,07,12,13,14 | Text styles feed the compositor; logo overlay applies per slide | ✓ SATISFIED (code) | `resolveTypographyTreatment` wired both at generation and edit time; logo overlay confirmed per-slide |

No orphaned requirements: the phase's declared requirement set (PLAN-05, PLAN-06, PLAN-07, CRSL2-01, CRSL2-02, CRSL2-04) is exactly the union of `requirements:` fields across all 14 plans — nothing in REQUIREMENTS.md maps additional IDs to Phase 25 that no plan claims.

**Documentation-consistency note (not a code gap):** `.planning/REQUIREMENTS.md` already shows all 6 of this phase's requirement IDs as `[x]` **Complete** (flipped incrementally by 25-09/25-10/25-12's own commits, e.g. `dfa3f93` marked CRSL2-04 Complete on 2026-07-28), while `STATE.md` and `25-14-SUMMARY.md` — written later, after 25-12 — both assert these IDs "remain Pending" pending Task 3's operator sign-off. This is an inconsistency between tracking artifacts: REQUIREMENTS.md was not held back the way STATE.md/ROADMAP.md correctly were. It does not affect any runtime behavior, but a continuation agent should NOT treat REQUIREMENTS.md's current `[x]` marks as proof the live sign-off happened — `25-HUMAN-UAT.md` (9/9 steps still `pending`) is the authoritative source on that question.

### Anti-Patterns Found

None classified as blocker or warning. Two informational items, both already self-documented and judged non-blocking by the executor (confirmed independently):

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `server/services/typography-compositor.service.ts` | `drawBlocks`/`layoutBlocks` | Pre-existing (Phase 23) font-state bug: `drawBlocks` doesn't reset `ctx.font` per block, so non-last blocks in a multi-block layout may render with the last-measured block's font | ℹ️ Info | Predates Phase 25; fixing it would change Phase 23's own golden-image output, which is explicitly out of this phase's scope. Logged in `deferred-items.md` for a future hygiene pass. |
| `.planning/REQUIREMENTS.md` | lines 37-39, 51-54 | Requirement checkboxes marked Complete before the phase's own blocking human-verification checkpoint (Task 3) ran | ℹ️ Info | Documentation-consistency only (see note above); does not reflect a code defect. |

### Human Verification Required

### 1. 25-14 Task 3 — 8-Step Live Operator Runbook

**Test:** Run the 8-step runbook embedded at the bottom of `scripts/verify-phase-25.ts` (mirrored in `25-HUMAN-UAT.md`) against the real Coolify production host and the live Supabase project, after applying both Phase 25 migrations (`20260729000000_post_slides_base_image_typography.sql`, `20260729000001_style_reference_photos.sql`):
1. Narrative + on-slide text (CRSL2-01/02, SC1) — one shared `layout_archetype_id`, real per-slide `generation_params`.
2. Visual composition variation (SC2) — visibly distinct framing, no `[carousel] composition variation warning:` log line.
3. Text-style treatment + logo (CRSL2-04, SC3) — bold-promo vs. elegant-serif visibly differ; logo applies per slide.
4. Slide edit — no double render (CRSL2-02) — one crisp text set; text-only edit shows "Recomposing slide text..." with zero image-provider calls.
5. LEGACY slide edit — a pre-Phase-25 carousel edits unchanged, `base_image_url` stays NULL.
6. Aesthetic DNA in the payload (PLAN-05/06, SC4) — the `professional` style's exact `photography_type` string appears verbatim; a 60-30-10 sentence names `color_4`; an "Avoid: " block is present.
7. Style reference board attachment (PLAN-07, SC5) — `[Reference Images]`/`[carousel] reference images:` logs show board images attached; non-admin gets 403.
8. No-regression sweep — video/enhancement/single-image/legacy-edit all unaffected.

**Expected:** All 8 steps PASS with real, paid AI-generated output.
**Why human:** Requires the real production host, live Supabase project, and real paid Gemini/OpenRouter API calls — none available in this execution environment. This was explicitly deferred by user decision (not by the executor skipping scope); its 9-row tracking table is already persisted, all `pending`, in `25-HUMAN-UAT.md`.

### Gaps Summary

No code-level gaps found. Every must-have truth, artifact, and key link declared across all 14 plans' frontmatter was independently re-verified against the actual source (not merely against `scripts/verify-phase-25.ts`'s exit code, though that was also independently re-run and reproduced 71/71 green, and `npm run check` was independently re-run clean). `layout_archetype_id` is structurally a single carousel-level value with no per-slide field anywhere in the type system; `assignSlideRoles` is genuinely server-enforced (called after the plan call, overwriting the model's own guess); the slide-edit LEGACY branch is a genuinely distinct, non-overlapping code path from the base-image-aware branch; the reference-image 4-slot cap is declared exactly once and shared by both generation paths, with the GATE-07 direct-Gemini rollback confirmed text-only; the aesthetic-DNA catalog content is genuinely dense and non-generic per entry; GATE-08's video pipeline shows zero Phase 25 commits touching it.

The only outstanding item is the blocking human-verification checkpoint (25-14 Task 3 / `25-HUMAN-UAT.md`), which requires a live production environment and real paid AI calls this environment cannot provide, and which the user has already explicitly decided to defer rather than fabricate. Status is reported as `human_needed` rather than `gaps_found` per that decision.

---

_Verified: 2026-07-28T13:03:41Z_
_Verifier: Claude (gsd-verifier)_
