---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 14
subsystem: testing
tags: [verification-harness, cross-plan-invariants, carousel-narrative, aesthetic-dna, runbook]

# Dependency graph
requires:
  - phase: 25-01
    provides: "scripts/verify-phase-25.ts (the 7-tag Phase 25 phase gate) + check()/readSafe()/tagActive() helpers + PHASE_25_TAGS array"
  - phase: 25-02
    provides: "supabase/migrations/20260729000000_post_slides_base_image_typography.sql (additive base_image_url/typography_meta) — read by the LEGACY REACHABILITY check"
  - phase: 25-03
    provides: "carousel-plan-schema.service.ts's CarouselWireSlide interface — read by the ARCHETYPE SINGULARITY check"
  - phase: 25-04
    provides: "style-reference.service.ts's REFERENCE_IMAGE_SLOT_LIMIT export — read by the REFERENCE-SLOT CAP check"
  - phase: 25-06
    provides: "style-art-direction.service.ts's buildStyleArtDirectionBlock + prompt-builder.service.ts's formatBrandColorsProportional — read by the AESTHETIC DNA BOTH PATHS check"
  - phase: 25-09
    provides: "generate.routes.ts's final pipeline wiring (crop/typography/logo/optimize + resolveGenerationReferenceImages) — the single-image half of PIPELINE PARITY and the GATE-08 VIDEO FENCE check"
  - phase: 25-10
    provides: "carousel-generation.service.ts's narrative plan wiring (assignSlideRoles, plan.layout_archetype_id) — the ARCHETYPE SINGULARITY check's carousel half"
  - phase: 25-12
    provides: "carousel-generation.service.ts's final pipeline wiring (crop/typography/logo/uploadSlideBuffer) — the carousel half of PIPELINE PARITY"
  - phase: 25-13
    provides: "carousel.routes.ts's resolveSlideEditTarget/isBaseImage/carouselArchetype — the NO-DOUBLE-RENDER CLOSURE and ARCHETYPE SINGULARITY (c) checks"
provides:
  - "scripts/verify-phase-25.ts's 8th tag, [svc-cross-plan]: pipeline-parity, archetype-singularity (SC1), no-double-render closure, LEGACY reachability, single reference-slot-cap, both-path aesthetic DNA (SC4), GATE-08 video fence, every Phase 25 unit harness, and prior-phase/CI-gate non-regression invariants spanning files no single Phase 25 plan owns"
  - "The full Phase 25 gate green at 71/71 checks across all 8 tags, zero weakened or deleted checks"
  - "The authoritative 8-step MANUAL/LIVE VERIFICATION RUNBOOK embedded at the bottom of verify-phase-25.ts (narrative + on-slide text, composition variation, text-style/logo, no-double-render slide edit, LEGACY slide edit, aesthetic DNA payload, style reference board attachment, no-regression sweep)"
affects: [26]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-plan invariant tag ([svc-cross-plan]): mirrors scripts/verify-phase-23.ts's 23-11 precedent and scripts/verify-phase-24.ts's 24-07 precedent exactly — indexOf-based pipeline-order assertions, a spawnSync-based proof that every Phase 25 unit harness AND every prior-phase/CI harness still exits 0 (both gated behind tagActive so an unrelated --only run stays fast)"
    - "Self-referential scanner false-positive on a NEGATED documentation phrase: the post_slides migration's own comment states 'no default and no backfill' — a naive /backfill/i scan flags that correct, negated documentation as if it were a real backfill marker. Fixed by counting total backfill mentions vs. mentions immediately preceded by 'no ' and only flagging a surplus — same self-referential collision CLASS as 23-09/24-07's fixes, but the first instance of it applying to a negated-prose (not a self-quoting-ticket-number) collision."

key-files:
  created:
    - .planning/phases/25-narrative-carousels-and-aesthetic-dna/25-14-SUMMARY.md
  modified:
    - scripts/verify-phase-25.ts

key-decisions:
  - "Did not run `state advance-plan`/`roadmap update-plan-progress`/`requirements mark-complete` for this plan — all three tools infer full completion from this SUMMARY.md's mere existence or the plan's requirements frontmatter, which would incorrectly flip Phase 25 to 100% complete and PLAN-05/06/07 + CRSL2-01/02/04 to Complete despite Task 3 being an unresolved blocking operator checkpoint. Updated STATE.md and ROADMAP.md by hand instead, mirroring the precedent set in 21.1 Plan 07 Task 3, 22 Plan 06 Task 3, 23 Plan 11 Task 3, and 24 Plan 07 Task 3."
  - "Wrote the runbook's log-line reference block to match the ACTUAL shipped format (`[Reference Images] User <id>: ...`), not the plan interface block's assumed format (`Post <id>`) — 25-09-SUMMARY.md documents this was a deliberate Rule-1 fix (postId doesn't exist at that point in generate.routes.ts; using it would TDZ-crash) — so the runbook is honest about what an operator will actually grep for."

patterns-established: []

requirements-completed: []  # PLAN-05/06/07, CRSL2-01/02/04 remain Pending in REQUIREMENTS.md — this plan's own scope (8th cross-plan tag + operator sign-off) is NOT complete; Task 3 is a blocking checkpoint that was not performed. Do not treat this list as certifying those IDs.

# Metrics
duration: ~35min (Tasks 1-2 only; Task 3 not started)
completed: PARTIAL — Tasks 1-2 of 3 complete, 2026-07-28
---

# Phase 25 Plan 14: Cross-Plan Invariants + Live Runbook + Operator Sign-off Summary

**STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (`scripts/verify-phase-25.ts` is green at 71/71 across 8 tags with zero weakened checks, and the 8-step MANUAL/LIVE VERIFICATION RUNBOOK is embedded); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.**

`scripts/verify-phase-25.ts` now carries an 8th tag, `[svc-cross-plan]`, with 9 invariant-check groups (18 individual PASS lines) that no single earlier Phase 25 plan could assert alone: pipeline parity across BOTH generation paths (`generate.routes.ts` and `carousel-generation.service.ts` each run crop → typography → logo → optimize/upload in strictly increasing source order — one check per file), archetype singularity (SC1: `CarouselWireSlide` carries no per-slide `layout_archetype_id`, `carousel-generation.service.ts` reads only the carousel-level `plan.layout_archetype_id`, and `carousel.routes.ts`'s slide-edit reuses the carousel's own archetype), the no-double-render coverage-gap closure (slides carry composited text AND the slide-edit path is base-image-aware, with zero `CRSL-10`/"do not use on-image text" residue), LEGACY-branch reachability (the migration adds `base_image_url` with no NOT NULL/DEFAULT/UPDATE/BACKFILL, and `carousel.routes.ts` contains a literal `isBaseImage: false` return), the single reference-slot-cap declaration (`REFERENCE_IMAGE_SLOT_LIMIT = 4` exported exactly once, no `slotsRemaining`/old arithmetic drift), both-path aesthetic DNA (SC4: `gemini.service.ts` AND `carousel-generation.service.ts` both call `buildStyleArtDirectionBlock`/`formatBrandColorsProportional`), the frozen GATE-08 video fence (`formatBrandColorsLabeled` survives, `isVideo` gates both new reference tiers), a spawnSync sweep of all 4 Phase 25 no-network unit harnesses, and a spawnSync sweep of all 6 prior-phase/CI gates (Phases 21/21.1/22/23/24 + the golden-image gate). The full suite is 71/71 green (up from 53 baseline checks before this plan; zero checks removed or downgraded). An 8-step operator runbook (narrative + on-slide text, visual composition variation, text-style treatment + logo, no-double-render slide edit, the LEGACY slide edit, the aesthetic-DNA payload, style reference board attachment, and a no-regression sweep) is appended as a pure-insertion comment block at the bottom of the file. Task 3 — operator sign-off on that 8-step runbook — requires the real Coolify production host, the live Supabase project, and real paid generations, none of which are available in this execution environment.

## Performance

- **Duration:** ~35 min (Tasks 1-2)
- **Tasks:** 2 of 3 completed (Task 3 is a blocking checkpoint, not started)
- **Files modified:** 1 (`scripts/verify-phase-25.ts`)

## Accomplishments

- Ran the full harness before any change to establish a baseline: 53/53 checks passed (per 25-13-SUMMARY.md), zero failures across the original 7 tags — no implementation drift since plans 25-01..25-13 landed.
- Added `[svc-cross-plan]` (8th tag) with 9 check groups (18 PASS lines total, since PIPELINE PARITY emits one check per file, the unit-harness sweep emits one check per script, and the regression sweep emits one check per prior-phase/CI harness):
  1. **PIPELINE PARITY ACROSS BOTH GENERATION PATHS** — `generate.routes.ts`: `cropToExactAspectRatio(` → `compositeTypography(` → `applyLogoOverlay(` → `processImageWithThumbnail(` (searched forward from the logo-overlay index, since an earlier unrelated video-branch call to the same function precedes it); `carousel-generation.service.ts`: `cropToExactAspectRatio(` → `compositeTypography(` → `applyLogoOverlay(` → `uploadSlideBuffer(`. Two checks, both green.
  2. **ARCHETYPE SINGULARITY (SC1)** — all three sub-assertions (no per-slide field, carousel-level-only read, edit reuses the carousel archetype) ANDed into one check. Green.
  3. **NO-DOUBLE-RENDER CLOSURE** — the four-way conjunction (generation composites, edit is base-aware, zero `CRSL-10`, zero "do not use on-image text"). Green.
  4. **LEGACY REACHABILITY** — migration absence-of-backfill-signals + `carousel.routes.ts`'s literal `isBaseImage: false`. Green after the scanner fix (see Deviations).
  5. **REFERENCE-SLOT CAP DECLARED EXACTLY ONCE**. Green.
  6. **AESTHETIC DNA REACHES BOTH PATHS (SC4)**. Green.
  7. **GATE-08 VIDEO FENCE STILL HOLDS**. Green.
  8. **EVERY PHASE 25 UNIT HARNESS STILL PASSES** — 4 spawnSync checks (`test-carousel-narrative-plan.ts`, `test-style-reference-merge.ts`, `test-typography-treatment.ts`, `test-slide-edit-resolution.ts`), all exit 0.
  9. **ZERO REGRESSION** — 6 spawnSync checks (`verify-phase-21.ts`, `-21.1.ts`, `-22.ts`, `-23.ts`, `-24.ts`, `verify-golden-image.ts`), all exit 0.
- Updated the `[self-test]` tag-literal assertion text from "7" to "8" tags (the array itself already drove the `.every()` check, so adding the literal `"svc-cross-plan"` to `PHASE_25_TAGS` was the substantive change); updated the file's ownership header comment from prospective ("is extended ONLY by plan 25-14, which adds...") to retrospective ("was extended by plan 25-14, which added...").
- Appended the 8-step MANUAL/LIVE VERIFICATION RUNBOOK as a pure-insertion `//`-comment block, adapting the plan's interface-block content to the ACTUAL shipped log-line format (see Deviations/Decisions) and the real curated `photography_type` string for the `professional` style (verified directly against `shared/schema.ts`'s `DEFAULT_STYLE_CATALOG`, since 25-05-SUMMARY.md's prose didn't quote per-style strings verbatim).
- Ran the full acceptance-criteria verification suite: `npx tsx scripts/verify-phase-25.ts` (71/71, 0 failures, 8 tags), all 4 Phase 25 unit harnesses (15/15, 12/12, 28/28, 20/20), `verify-phase-21.ts`/`-21.1.ts`/`-22.ts`/`-23.ts`/`-24.ts`/`verify-golden-image.ts` (all exit 0, also independently re-proven via the new `[svc-cross-plan]` spawnSync checks), `npm run check` (clean), `npm run build` (clean, both client + server bundles).
- Confirmed grep-based acceptance criteria: `grep -c '"svc-cross-plan"'` = 3, `grep -c "\[svc-cross-plan\]"` = 14 (>=10 required), `grep -c "spawnSync"` = 5 (>=3 required), `grep -c "verify-golden-image"` = 1 (>=1 required), `grep -c 'MANUAL/LIVE VERIFICATION RUNBOOK'` = 1 (exactly 1 required); `git diff --stat` shows only `scripts/verify-phase-25.ts` changed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the 8th [svc-cross-plan] tag with cross-file invariants** - `5bcf75f` (feat)
2. **Task 2: Embed the MANUAL/LIVE VERIFICATION RUNBOOK** - `e19c34b` (docs)

**Task 3: Operator sign-off on the live runbook** — NOT STARTED. This is a `checkpoint:human-verify` task with `gate="blocking"` requiring the real Coolify production host, the live Supabase project, and real paid generations, none available in this execution environment. See "Checkpoint Details" below.

**Plan metadata:** this commit (STATE.md/ROADMAP.md/SUMMARY.md only — Task 3 still pending, so this is NOT a phase-closure commit)

## Files Created/Modified

- `scripts/verify-phase-25.ts` - Added the `[svc-cross-plan]` 8th tag (9 check groups: pipeline parity x2, archetype singularity, no-double-render closure, LEGACY reachability, reference-slot cap, both-path aesthetic DNA, GATE-08 fence, unit-harness sweep x4, prior-phase/CI regression sweep x6), fixed a self-referential backfill-scanner false positive, updated the self-test tag count from 7 to 8, and appended the 8-step MANUAL/LIVE VERIFICATION RUNBOOK as a pure addition.

## Decisions Made

See `key-decisions` in frontmatter. Two notable calls: (1) updated STATE.md and ROADMAP.md by hand rather than via `gsd-tools state advance-plan` / `roadmap update-plan-progress` / `requirements mark-complete`, because those tools infer full completion from this SUMMARY.md's mere existence and would have incorrectly marked Phase 25 100% complete and PLAN-05/06/07 + CRSL2-01/02/04 Complete despite Task 3's unresolved blocking checkpoint; (2) wrote the runbook's log-line reference block against the ACTUAL shipped format (`[Reference Images] User <id>: ...`, confirmed via direct grep of `generate.routes.ts`) rather than the plan's own interface-block assumption (`Post <id>`), since 25-09-SUMMARY.md documents that using `postId` there would TDZ-crash and the real code uses `user.id`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, self-referential scanner false positive] LEGACY REACHABILITY check's backfill scan flagged its own migration's correct, negated documentation**
- **Found during:** Task 1, first run of the newly-added `[svc-cross-plan]` check group
- **Issue:** `supabase/migrations/20260729000000_post_slides_base_image_typography.sql`'s own header comment states "column is nullable with no default and no backfill: slides created before this migration keep base_image_url IS NULL forever" — a naive `/backfill/i` test flags this correct, negated documentation as if it were a real backfill marker, exactly the self-referential collision class documented in 23-09-SUMMARY.md and 24-07-SUMMARY.md (a harness pattern literal tripping its own scan), but the first instance of that class applying to negated prose rather than a self-quoting ticket number.
- **Fix:** Counted total case-insensitive "backfill" mentions vs. mentions immediately preceded by "no " (the documented-absence phrasing) and only treat a surplus as a genuine signal. This migration has exactly one mention, fully accounted for by the negation, so `backfillMentions <= negatedBackfillMentions` correctly passes; a real `-- BACKFILL:` marker or prose describing an actual backfill step (without the "no " prefix) would still fail the check.
- **Files modified:** `scripts/verify-phase-25.ts`
- **Verification:** `npx tsx scripts/verify-phase-25.ts --only=svc-cross-plan` — all 18 PASS lines green; full suite 71/71.
- **Committed in:** `5bcf75f` (Task 1 commit, caught before commit so no separate fix commit was needed)

---

**Total deviations:** 1 auto-fixed (Rule 1 — check-regex precision fix, not an implementation bug). Zero weakened checks; zero checks removed. `check(` call count grew from the 25-01 baseline family (53 at plan start) to 71 in the full suite.
**Impact on plan:** The fix is confined to the harness's own assertion logic (not application code) and makes it strictly more accurate — it now correctly distinguishes "documents no backfill exists" from "a backfill marker is present." No scope creep.

## Issues Encountered

None beyond the one documented deviation above, caught and fixed before its commit — no false negatives or broken acceptance criteria were ever committed.

## User Setup Required

**External/live verification required — Task 3 has NOT been performed.** See "Checkpoint Details" below for the full operator runbook (also embedded at the bottom of `scripts/verify-phase-25.ts`). Access to the live Coolify host + Supabase project, and real paid generations, are required. Both Phase 25 migrations (`20260729000000_post_slides_base_image_typography.sql`, `20260729000001_style_reference_photos.sql`) must be applied to the live Supabase project before running the runbook.

## Next Phase Readiness

- All code-level PLAN-05/06/07 + CRSL2-01/02/04 work is done and gated: `verify-phase-25.ts` 71/71 green across 8 tags (zero weakened checks), all 4 Phase 25 unit harnesses green, Phases 21/21.1/22/23/24 and the golden-image CI gate unregressed, `npm run check` clean, `npm run build` clean.
- **Phase 25 is NOT yet closable.** Task 3 (operator sign-off on the 8-step live runbook) must run before Phase 25's ROADMAP checkbox is checked and before PLAN-05/06/07 + CRSL2-01/02/04 are marked Complete in REQUIREMENTS.md.
- Downstream Phase 26 (Fixes & Polish) depends on Phase 21 and Phase 23's static delivery (already complete and green), not on Phase 25's live sign-off specifically — its planning is not blocked by Task 3's pending status, but the v1.6 milestone cannot be considered fully shipped until it, plus the still-open 21.1 Plan 07 Task 3, 22 Plan 06 Task 3, 23 Plan 11 Task 3, and 24 Plan 07 Task 3 checkpoints, all resolve.

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: PARTIAL (Tasks 1-2 only) — 2026-07-28*

## Self-Check: PASSED

- FOUND: scripts/verify-phase-25.ts (modified, confirmed via commits `5bcf75f` and `e19c34b`)
- FOUND commit: 5bcf75f
- FOUND commit: e19c34b
- `npx tsx scripts/verify-phase-25.ts` exits 0, 71/71 PASS across 8 tags
- `npx tsx scripts/test-carousel-narrative-plan.ts` exits 0 (15/15)
- `npx tsx scripts/test-style-reference-merge.ts` exits 0 (12/12)
- `npx tsx scripts/test-typography-treatment.ts` exits 0 (28/28)
- `npx tsx scripts/test-slide-edit-resolution.ts` exits 0 (20/20)
- `npx tsx scripts/verify-phase-21.ts` / `-21.1.ts` / `-22.ts` / `-23.ts` / `-24.ts` / `verify-golden-image.ts` all exit 0 (also re-proven via `[svc-cross-plan]`'s own spawnSync checks)
- `npm run check` exits 0
- `npm run build` succeeds
- Task 3 correctly NOT recorded as complete

## Checkpoint Details (Task 3 — not performed)

See the "CHECKPOINT REACHED" report returned to the orchestrator for the full structured checkpoint (type: human-verify, gate: blocking). Summary: the operator must run the 8-step runbook embedded at the bottom of `scripts/verify-phase-25.ts`, requiring the real Coolify production host, the live Supabase project, and real paid generations. Both Phase 25 migrations must be applied first.

1. Narrative + on-slide text (CRSL2-01, CRSL2-02, SC1): 5-slide carousel, all slides share one `layout_archetype_id`, correct text-style/logo selections reach `generation_params`.
2. Visual composition variation (CRSL2-01, SC2): visually distinct framing across slides, no `[carousel] composition variation warning:` log line.
3. Text-style treatment + logo (CRSL2-04, SC3): two carousels (bold-promo vs. elegant-serif) show different `fonts[]`/rendered weight; logo in the configured corner on both.
4. Slide edit — no double render (CRSL2-02, plan 25-13): edited slide shows ONE crisp text set; `has_base=true`/archetype unchanged; text-only edit shows "Recomposing slide text..." with no image-provider call.
5. LEGACY slide edit (plan 25-13's LEGACY branch): a pre-deploy carousel's slide edit succeeds unchanged, keeping `base_image_url IS NULL`.
6. Aesthetic DNA in the payload (PLAN-05, PLAN-06, SC4): 3 style/mood combinations show the exact curated `photography_type` string, the "Apply a 60-30-10 color balance:" sentence naming `color_4`, and the "Avoid: " block.
7. Style reference board attachment (PLAN-07, SC5): admin upload persists without "Save Post Settings"; both single-image and carousel generations show N>0 style-board slots in the log; non-admin ACL returns 403.
8. No-regression sweep: video/enhancement/single-image/pre-Phase-25-edit all succeed unchanged with 0 style-board slots on video; admin catalog round-trip + `withDefaultArtDirection` backfill both confirmed.

On resume, a continuation agent should record the operator's per-step outcome in this file under a new "Manual verification (8-step runbook)" heading (an 8-row table: step / expected / observed / PASS-FAIL, per the plan's Task 3 instruction), and only then mark Phase 25's ROADMAP checkbox / close the phase and run `requirements mark-complete PLAN-05 PLAN-06 PLAN-07 CRSL2-01 CRSL2-02 CRSL2-04` — or otherwise stop and capture the failing step verbatim per the plan's Task 3 instructions.
