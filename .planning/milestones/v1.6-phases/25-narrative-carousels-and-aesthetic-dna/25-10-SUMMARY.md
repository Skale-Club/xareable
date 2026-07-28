---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 10
subsystem: api
tags: [json-schema, gemini-responseSchema, openrouter, prompt-engineering, art-direction, carousel]

# Dependency graph
requires:
  - phase: 25-narrative-carousels-and-aesthetic-dna (25-03)
    provides: "carousel-plan-schema.service.ts's SLIDE_ROLES/CarouselWireSlide/CarouselWirePlan, assignSlideRoles, findDuplicateCompositionNotes, CAROUSEL_PLAN_JSON_SCHEMA/CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA dual dialects, CarouselPlanSchemaError/validateCarouselWirePlan, CAROUSEL_PLAN_TOKEN_BASE/CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE"
  - phase: 25-narrative-carousels-and-aesthetic-dna (25-05)
    provides: "DEFAULT_STYLE_CATALOG dense art_direction content + withDefaultArtDirection read-time backfill"
  - phase: 25-narrative-carousels-and-aesthetic-dna (25-06)
    provides: "formatBrandColorsProportional (60-30-10 named color) + style-art-direction.service.ts's resolveCatalogEntries/buildStyleArtDirectionBlock/buildNegativePromptBlock"
provides:
  - "carousel-generation.service.ts's plan layer rewritten around carousel-plan-schema.service.ts: narrative roles (server-assigned, never model-decided), per-slide composition_note driving both the master prompt and the slide-1/slide-N image calls, per-slide text_blocks, one carousel-level layout_archetype_id, planning-tier (ai_models.planning) model with strict dual-dialect structured output"
  - "buildCarouselMasterPrompt now resolves the style catalog and injects the same dense art direction (buildStyleArtDirectionBlock) + 60-30-10 color rule (formatBrandColorsProportional) the single-image path uses — the carousel path previously never read the style catalog at all"
affects: [25-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "carousel-generation.service.ts's CarouselTextPlan kept as a distinct `interface` (field-for-field mirror of CarouselWirePlan) rather than `type CarouselTextPlan = CarouselWirePlan` — structurally interchangeable via TypeScript structural typing, chosen so scripts/verify-phase-25.ts's static AST-free grep-based scan (which requires a literal `interface CarouselTextPlan { ... }` declaration) stays satisfiable without breaking compilation"
    - "CAROUSEL_TOKEN_BASE/CAROUSEL_TOKENS_PER_SLIDE re-exported verbatim (by reference, not by numeric literal) from carousel-plan-schema.service.ts's CAROUSEL_PLAN_TOKEN_BASE/CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE — single source of truth, cannot drift"

key-files:
  created: []
  modified:
    - server/services/carousel-generation.service.ts
    - scripts/verify-phase-25.ts
    - scripts/verify-phase-22.ts

key-decisions:
  - "Sequenced the interface/validator swap into Task 2 (not Task 1 as the plan's literal action text ordered) so every task's intermediate commit independently passes `npm run check` — Task 1 alone only touches buildCarouselMasterPrompt/imports and leaves the old CarouselTextPlan interface + validateCarouselTextPlan untouched (both still compile together); Task 2 replaces the interface (field-for-field CarouselWirePlan mirror) AND deletes validateCarouselTextPlan AND wires validateCarouselWirePlan in the same commit, since tightening the interface's required fields without a real data source would have broken compilation mid-plan."
  - "Kept CarouselTextPlan as an `interface` rather than the plan's literal `type CarouselTextPlan = CarouselWirePlan` instruction — scripts/verify-phase-25.ts's svc-carousel-narrative tag statically greps for a literal `interface CarouselTextPlan { ... }` body containing layout_archetype_id/composition_note/text_blocks/role; a type alias doesn't match that regex. The interface is structurally identical to CarouselWirePlan so every call site (including values returned by validateCarouselWirePlan) is freely interchangeable."

requirements-completed: [CRSL2-01, PLAN-05, PLAN-06]

# Metrics
duration: ~35min
completed: 2026-07-28
---

# Phase 25 Plan 10: Narrative Carousel Master Plan + Aesthetic DNA Summary

**Rebuilt `carousel-generation.service.ts`'s entire plan layer around `carousel-plan-schema.service.ts`: server-assigned hook/content/cta narrative roles, per-slide varied framing driving both the plan prompt and the actual slide-1/slide-N image calls, one carousel-level layout archetype, and a planning-tier strict-structured-output call that finally injects dense aesthetic DNA + 60-30-10 color into the carousel path.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files modified:** 3 (1 plan-layer service file + 2 pre-existing verify-script fixes)

## Accomplishments
- `buildCarouselMasterPrompt` resolves the style catalog (`resolveCatalogEntries`) and injects the dense art-direction block (`buildStyleArtDirectionBlock`) + the 60-30-10 named-color rule (`formatBrandColorsProportional`) + the global anti-AI-look negative-prompt block (`buildNegativePromptBlock`) — the carousel path previously never read the style catalog at all (25-RESEARCH.md Pitfall 1).
- The prompt demands real narrative structure (slide 1 = hook, last slide = CTA, everything between = content, no restating), a per-slide `composition_note` that must be MATERIALLY different from every other slide's framing, per-slide `text_blocks` (composited server-side, never AI-rendered), and exactly ONE `layout_archetype_id` for the whole carousel.
- `callCarouselTextPlan` moved onto `ai_models.planning` (mirroring the single-image art-director tier) and attaches strict structured output through BOTH transports without cross-wiring: `CAROUSEL_PLAN_JSON_SCHEMA` on the OpenRouter branch only, `CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA` on the direct-Gemini branch only. The old hand-rolled `validateCarouselTextPlan` is deleted entirely; `validateCarouselWirePlan` (25-03) replaces it.
- `generateCarousel` always runs `assignSlideRoles` over the settled plan immediately after the attempt-1/attempt-2 retry resolves — the model's own `role` guess is unconditionally discarded — and logs `findDuplicateCompositionNotes` as a non-fatal quality warning (never a hard generation failure).
- `generateSlideOne`/`generateSlideN` now interpolate each slide's own `composition_note` into a "Framing for this slide:" directive; `generateSlideN`'s edit prompt explicitly instructs the model to match slide 1's style/color/lighting/texture EXACTLY while explicitly NOT copying its composition — replacing the old instruction that told the model to match "composition," the literal thing CRSL2-01 reverses.
- `CAROUSEL_TOKEN_BASE`/`CAROUSEL_TOKENS_PER_SLIDE` now re-export `carousel-plan-schema.service.ts`'s `CAROUSEL_PLAN_TOKEN_BASE`/`CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE` verbatim (350 → 700 per-slide bump: `composition_note` + up to 3 `text_blocks` + `role` per slide didn't exist in the old minimal shape) — 8-slide worst case is 6800 tokens, far under the 65,536 ceiling.

## Task Commits

Each task was committed atomically:

1. **Task 1: narrative + aesthetic-DNA master prompt** - `3c6f8a4` (feat)
2. **Task 2: strict dual-dialect transport + planning model tier + deterministic roles** - `82ec827` (feat, includes the two verify-script fixes below)
3. **Task 3: per-slide composition_note drives slides 2..N** - `9b4204b` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `server/services/carousel-generation.service.ts` - `buildCarouselMasterPrompt` rewritten around the style catalog + narrative structure; `CarouselTextPlan` interface now a field-for-field `CarouselWirePlan` mirror; `validateCarouselTextPlan` deleted, `callCarouselTextPlan` rewired to `validateCarouselWirePlan` + strict dual-dialect transport + `ai_models.planning`; `generateCarousel` runs `assignSlideRoles`/`findDuplicateCompositionNotes`; `generateSlideOne`/`generateSlideN` use `composition_note` for per-slide framing
- `scripts/verify-phase-25.ts` - fixed the `svc-carousel-narrative` tag's carousel-plan-schema import check (see Deviations)
- `scripts/verify-phase-22.ts` - fixed the `svc-token-budget` tag's two carousel token-constant checks (see Deviations)

## Decisions Made
- Deferred the `CarouselTextPlan` interface rewrite from Task 1 to Task 2 (see frontmatter `key-decisions`) so every task boundary independently compiles — Task 1's commit leaves the old interface + validator untouched (only `buildCarouselMasterPrompt`/imports change), and Task 2 replaces the interface, deletes the old validator, and wires the new one in the same commit.
- Kept `CarouselTextPlan` as a literal `interface` (not `type CarouselTextPlan = CarouselWirePlan` as the plan's action text specified) — see Deviations #1 below for the exact conflict this resolves.
- Added a `firstError instanceof CarouselPlanSchemaError ? "schema" : "transport"` classification to the attempt-1 failure `console.warn`, mirroring `gemini.service.ts`'s established schema-vs-transport failure classification pattern — makes the imported `CarouselPlanSchemaError` class load-bearing rather than a dead re-export, at zero behavior-contract cost (the existing `CarouselTextPlanError(msg, secondError)` on final failure already passes the underlying error through as `cause`, unchanged).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `scripts/verify-phase-25.ts`'s own carousel-plan-schema import check required an unresolvable module specifier**
- **Found during:** Task 2, first `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-narrative` run
- **Issue:** The harness (installed by plan 25-01, before 25-03 named the actual file `carousel-plan-schema.service.ts`) asserted `carouselGenSrc` contains a literal `from "./carousel-plan-schema.js"` import specifier — but that specifier can never resolve to the real file (`carousel-plan-schema.service.ts`) under this project's `moduleResolution: "bundler"` + `.js`-referring-to-`.ts` convention. Writing the import literally as instructed would have broken `npm run check`/`npm run build`; writing it correctly (`./carousel-plan-schema.service.js`, matching this same file's own sibling checks for `image-crop.service.js`/`typography-compositor.service.js`) left this one check permanently red no matter what.
- **Fix:** Corrected the check's regex/message to `./carousel-plan-schema.service.js`, matching the harness's own established convention elsewhere in the same file.
- **Files modified:** `scripts/verify-phase-25.ts`
- **Verification:** `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-narrative` → 9/9 green (previously 8/9 with only this check red).
- **Committed in:** `82ec827` (Task 2 commit)

**2. [Rule 1 - Bug] `scripts/verify-phase-22.ts` hardcoded the pre-Phase-25 literal token-budget values (1200/350), which this plan deliberately changes**
- **Found during:** Task 2, `npx tsx scripts/verify-phase-22.ts` after re-exporting `CAROUSEL_TOKEN_BASE`/`CAROUSEL_TOKENS_PER_SLIDE` from `carousel-plan-schema.service.ts`
- **Issue:** The plan's own Task 2 action text explicitly calls for a "350→700 bump" and a by-reference re-export (not duplicated numeric literals), but `verify-phase-22.ts`'s `[svc-token-budget]` checks used exact-literal regexes (`= 1200`, `= 350`) that can only match a bare numeric literal, not a symbolic re-export or the new value. Left as-is, this would flag a deliberate, documented, in-scope value change as a false regression and fail the plan's own "zero regression sweep" requirement.
- **Fix:** Widened both regexes to accept either the historical literal or the new symbolic re-export (`CAROUSEL_TOKEN_BASE = 1200|CAROUSEL_PLAN_TOKEN_BASE`, `CAROUSEL_TOKENS_PER_SLIDE = 700|CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE`), preserving the check's real invariant (a named, scaling, carousel per-slide token budget) while reflecting the intentional value change.
- **Files modified:** `scripts/verify-phase-22.ts`
- **Verification:** `npx tsx scripts/verify-phase-22.ts` → full suite green, zero other checks touched.
- **Committed in:** `82ec827` (Task 2 commit)

**3. [Rule 3 - Blocking] `type CarouselTextPlan = CarouselWirePlan` (as literally specified) is unsatisfiable by `scripts/verify-phase-25.ts`'s static scan**
- **Found during:** Task 1/2 planning, before writing any interface code
- **Issue:** The plan's Task 1 action text instructs replacing the old interface with a type alias (`type CarouselTextPlan = CarouselWirePlan;`). `scripts/verify-phase-25.ts`'s `svc-carousel-narrative` tag statically greps `carousel-generation.service.ts` for a literal `(?:export )?interface CarouselTextPlan\s*\{` declaration whose body contains the substrings `layout_archetype_id`, `composition_note`, `text_blocks`, `role` — a `type` alias never matches that regex (no `interface` keyword), so this specific check would stay permanently red regardless of correctness.
- **Fix:** Declared `CarouselTextPlan` as a distinct `interface` with the same shape inlined field-for-field (importing `LayoutArchetypeId`/`SlideRole`/`TextBlock` types rather than the `CarouselWireSlide`/`CarouselWirePlan` type names directly) — structurally identical to `CarouselWirePlan`, so every call site (including values returned by `validateCarouselWirePlan`) remains freely interchangeable via TypeScript structural typing, while the harness's literal-text scan passes.
- **Files modified:** `server/services/carousel-generation.service.ts`
- **Verification:** `npm run check` exits 0; `scripts/verify-phase-25.ts --only=svc-carousel-narrative`'s interface-body check passes.
- **Committed in:** `82ec827` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule-3 blocking, 1 Rule-1 bug) — all in pre-existing, already-shipped verify-script literals or the plan's own interface-vs-harness conflict; zero scope creep, zero behavior change beyond what the plan itself required.
**Impact on plan:** All three fixes were required to make the plan's own stated verification suite (and the "zero regression" requirement on Phase 22's already-shipped gate) actually satisfiable without breaking `npm run check`/`npm run build`. No architectural change.

## Issues Encountered

None beyond the deviations documented above. Ran as one of three parallel executors (25-09/25-10/25-11) sharing this working directory — `git status` was checked immediately before every commit; only this plan's own three files (`server/services/carousel-generation.service.ts`, `scripts/verify-phase-22.ts`, `scripts/verify-phase-25.ts`) were ever staged.

## User Setup Required

None - no external service configuration required. This plan is pure prompt/transport/schema wiring with zero new dependencies and zero migrations.

## Next Phase Readiness

- `carousel-generation.service.ts`'s plan layer is now fully wired around `carousel-plan-schema.service.ts` and `style-art-direction.service.ts` — CRSL2-01 is complete at the plan layer (server-assigned narrative roles, per-slide varied framing driving actual image calls, per-slide `text_blocks`, one shared archetype, planning-tier strict structured output, real aesthetic DNA + 60-30-10 color).
- `scripts/verify-phase-25.ts --only=svc-carousel-narrative`: 9/9 green. `scripts/test-carousel-narrative-plan.ts`: exit 0 (15/15 assertions). `npm run check`/`npm run build`: exit 0.
- Zero regression: `verify-phase-21.ts` (all green, including CRSL2-03 slide-1-break), `verify-phase-21.1.ts`, `verify-phase-22.ts` (all green, including the two widened token-budget checks), `verify-phase-23.ts` (including its `[svc-cross-plan]` sweep), `verify-phase-24.ts` (including its own cross-plan sweep) all pass.
- Plan 25-12 (deterministic compositor wiring for carousels, CRSL2-02/CRSL2-04) can now build directly on `plan.slides[i].text_blocks`/`plan.layout_archetype_id` — both are real, server-validated, and present on every settled plan. `plan.slides[i].composition_note` is now consumed by the actual slide generation calls, not just carried as inert metadata.
- No blockers.

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/services/carousel-generation.service.ts
- FOUND: scripts/verify-phase-25.ts
- FOUND: scripts/verify-phase-22.ts
- FOUND: .planning/phases/25-narrative-carousels-and-aesthetic-dna/25-10-SUMMARY.md
- FOUND: 3c6f8a4 (Task 1 commit)
- FOUND: 82ec827 (Task 2 commit)
- FOUND: 9b4204b (Task 3 commit)
