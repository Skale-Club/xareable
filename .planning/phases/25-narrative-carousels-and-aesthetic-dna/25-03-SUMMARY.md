---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 03
subsystem: api
tags: [zod-adjacent-schema, json-schema, gemini-responseSchema, openrouter, tdd]

# Dependency graph
requires:
  - phase: 25-narrative-carousels-and-aesthetic-dna (25-01)
    provides: scripts/verify-phase-25.ts's [svc-carousel-narrative] tag (9 checks) this plan turns 6/9 green
  - phase: 22-art-director-planning-upgrade
    provides: server/services/planning-schema.service.ts's dual-dialect discipline (LAYOUT_ARCHETYPE_IDS/DEFAULT_LAYOUT_ARCHETYPE_ID/MIN_IMAGE_PROMPT_LENGTH, the strict-json_schema-vs-responseSchema pattern this plan mirrors) and shared/schema.ts's TEXT_BLOCK_ROLES/TextBlock
provides:
  - "server/services/carousel-plan-schema.service.ts — the carousel narrative-plan contract: SLIDE_ROLES/SlideRole, CarouselWireSlide/CarouselWirePlan, assignSlideRoles (deterministic server-side hook/content/cta), normalizeCompositionNote/findDuplicateCompositionNotes/compositionNotesAreVaried (token-Jaccard composition-variation check), CAROUSEL_PLAN_JSON_SCHEMA + CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA dual dialects, CarouselPlanSchemaError/validateCarouselWirePlan, CAROUSEL_PLAN_TOKEN_BASE/CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE"
  - "scripts/test-carousel-narrative-plan.ts — 15-assertion no-network fixture proof of role assignment + composition-variation detection"
affects: [25-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "assignSlideRoles<T extends {role?:string}> generic overwrite pattern: server-side deterministic role assignment that discards the model's own guess entirely, returning new objects (never mutates input) — this is the pattern 25-10 wires into carousel-generation.service.ts's per-slide loop"
    - "Token-Jaccard composition-variation check (normalize -> tokenize -> drop short tokens -> Jaccard >= 0.8 threshold), with an exact-match fast path on the pre-token-drop normalized string so two empty-string notes still count as duplicates"
    - "NFD-decompose + \\u0300-\\u036f diacritic strip for accent-insensitive text normalization (mirrors shared/utils.ts's normalizeForComparison) instead of \\p{L}/\\p{N} unicode-property regex classes, which require an ES2018+ target this project's tsconfig does not set"
    - "Array.from(new Set(...)) for de-duplication + plain-array for-of iteration instead of iterating a Set directly, since this tsconfig has no explicit `target` (defaults tsc to ES3, which rejects for-of over Set without --downlevelIteration)"

key-files:
  created:
    - server/services/carousel-plan-schema.service.ts
    - scripts/test-carousel-narrative-plan.ts
  modified: []

key-decisions:
  - "Split Task 1 into a genuine TDD RED (test committed first, confirmed failing via ERR_MODULE_NOT_FOUND) then GREEN (pure-logic module committed second, confirmed all 15 assertions pass) pair of commits, then Task 2 (schemas+validator) as its own commit — three commits total for two plan tasks, matching the tdd=\"true\" task attribute literally rather than the plan's action-text ordering (source-file-first) alone."
  - "Corrected two import-path typos found in the plan's own text/acceptance-criteria (which write '../server/services/carousel-plan-schema.js' and './planning-schema.js', omitting the '.service' infix that both real files carry) to the actual working paths ('carousel-plan-schema.service.js', 'planning-schema.service.js') — verified against the established codebase convention (test-critic-reroll-logic.ts imports '../server/services/visual-critic.service.js') and confirmed these were shorthand/typos, not a literal contract, since npx tsx immediately proved the plan's literal path unresolvable."

patterns-established:
  - "CarouselWireSlide/CarouselWirePlan as the canonical post-validation carousel plan shape 25-10 will consume, replacing carousel-generation.service.ts's current minimal CarouselTextPlan interface"

requirements-completed: [CRSL2-01]

# Metrics
duration: 20min
completed: 2026-07-28
---

# Phase 25 Plan 03: Carousel Narrative Plan Schema Summary

**`carousel-plan-schema.service.ts` — deterministic server-side hook/content/cta role assignment (model's own guess always discarded), a token-Jaccard inter-slide composition-variation check, and the dual-dialect (OpenRouter strict json_schema / direct-Gemini responseSchema) carousel plan contract with a coercing validator — all provable with zero AI calls.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (Task 1 split into RED+GREEN commits per its `tdd="true"` attribute; Task 2 its own commit)
- **Files modified:** 2 (both new)

## Accomplishments
- `assignSlideRoles` deterministically overwrites every slide's narrative role — slide 1 is always `hook`, the last slide is always `cta`, everything between is `content` — regardless of what the model itself emitted, per 25-CONTEXT.md's locked decision. Proven never to mutate its input and always to return new objects.
- `findDuplicateCompositionNotes`/`compositionNotesAreVaried` implement ROADMAP SC2's automated inter-slide composition-similarity check: exact-match (post-normalization) fast path plus a token-Jaccard ratio (`>= COMPOSITION_SIMILARITY_THRESHOLD = 0.8`) over normalized, punctuation-stripped, short-token-dropped tokens — catching both byte-identical repeats and near-identical framing ("the busy cafe" vs "a busy cafe").
- `CAROUSEL_PLAN_JSON_SCHEMA` (OpenRouter, `strict: true` + `additionalProperties: false` at every level) and `CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA` (direct-Gemini, UPPERCASE `Type` literals, no `strict`/`additionalProperties`) exist as two structurally distinct objects sharing only their field-description text constants — confirmed never cross-wired by both the harness's dedicated check and manual inspection.
- `validateCarouselWirePlan` coerces an absent/invalid `layout_archetype_id` to `DEFAULT_LAYOUT_ARCHETYPE_ID` rather than throwing, normalizes every `slide_number` to `index + 1` (so a mis-numbering model can't desync the per-slide loop), truncates `text_blocks` to the first 3 valid entries, and always routes `role` through `assignSlideRoles` before returning — the model's own role guess never survives into the returned plan.
- `scripts/test-carousel-narrative-plan.ts`: 15 no-network `PASS` assertions (>= the 12 floor) covering every bullet in the plan's Task 1 `<behavior>` block, run via `npx tsx`.

## Task Commits

1. **Task 1 (RED): failing test for role assignment + composition variation** - `799bb8e` (test)
2. **Task 1 (GREEN): pure-logic implementation** - `5eb6464` (feat)
3. **Task 2: dual-dialect schema + validator** - `90c8f0e` (feat)

**Plan metadata:** bundled into `d944825` (sibling plan 25-07's own `docs(25-07): complete typography-compositor-treatment plan` commit) — a shared git-index race (this plan's `git add` of STATE.md/ROADMAP.md/REQUIREMENTS.md/25-03-SUMMARY.md landed in the index moments before 25-07's own docs-commit step ran, and that commit picked up everything staged at that instant, not just its own files). Content verified byte-identical to this file's working-tree version and to the intended STATE.md/ROADMAP.md edits — no data loss, only the commit boundary/authorship label differs from a dedicated `docs(25-03)` commit. Same class of git-mechanics deviation 25-07 itself flagged for its own task commits.

## Files Created/Modified
- `server/services/carousel-plan-schema.service.ts` (431 lines) - `SLIDE_ROLES`/`SlideRole`, `CarouselWireSlide`/`CarouselWirePlan`, `assignSlideRoles`, `normalizeCompositionNote`/`findDuplicateCompositionNotes`/`compositionNotesAreVaried`, `CAROUSEL_PLAN_JSON_SCHEMA`, `CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA`, `CarouselPlanSchemaError`/`isCarouselPlanSchemaError`, `validateCarouselWirePlan`, `CAROUSEL_PLAN_TOKEN_BASE`/`CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE`
- `scripts/test-carousel-narrative-plan.ts` (152 lines) - 15-assertion no-network fixture harness

## Decisions Made
- Genuine TDD RED->GREEN split for Task 1 (test committed first and confirmed failing via `ERR_MODULE_NOT_FOUND`, then the pure-logic module committed second and confirmed all 15 assertions green) rather than a single combined commit — the task carries `tdd="true"`, and this mirrors 24-05's precedent ("genuine TDD RED->GREEN") more closely than 25-02's "verify via acceptance criteria directly" fallback (which applied there only because the target *test harness* didn't yet exist — here the test harness itself is exactly what Task 1 produces, so a real RED state was achievable and used).
- Reused `shared/utils.ts`'s NFD-decompose + `̀-ͯ` diacritic-strip pattern for `normalizeCompositionNoteString` instead of a `\p{L}/\p{N}` unicode-property regex (Rule 1 fix — see Deviations), since this project's tsconfig has no explicit `target` and therefore defaults `tsc` to ES3, which rejects the `u` regex flag.
- `jaccard()` takes plain token arrays (not `Set`s) and de-duplicates via `Array.from(new Set(...))` rather than iterating a `Set` directly, for the same ES3-default-target reason (Rule 1 fix — see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two import-path typos matching the plan's own imprecise shorthand blocked module resolution**
- **Found during:** Task 1 (initial RED test run) and Task 2 (initial `npm run check`)
- **Issue:** The plan's action text and acceptance-criteria commands consistently write `../server/services/carousel-plan-schema.js` and `./planning-schema.js` (omitting the `.service` infix), but the real files are `carousel-plan-schema.service.ts` and `planning-schema.service.ts`. Following the plan's literal text verbatim in both my test file's import and my new file's import of `planning-schema` produced `ERR_MODULE_NOT_FOUND` / `TS2307`.
- **Fix:** Corrected both import specifiers to include `.service.js`, matching the established codebase convention (e.g. `test-critic-reroll-logic.ts` importing `../server/services/visual-critic.service.js`). Confirmed the plan's own acceptance-criteria inline `npx tsx -e` command needed the same correction to run at all.
- **Files modified:** `scripts/test-carousel-narrative-plan.ts`, `server/services/carousel-plan-schema.service.ts`
- **Verification:** `npx tsx scripts/test-carousel-narrative-plan.ts` and the inline validator smoke test both run and pass after the fix; `npm run check` exits 0.
- **Committed in:** `5eb6464` (test-file fix), `90c8f0e`-preceding `5eb6464` (service-file import)

**2. [Rule 1 - Bug] Unicode-property regex flag (`\p{L}\p{N}` with `/gu`) and direct `Set` iteration both violate this project's implicit ES3 `tsc` target**
- **Found during:** Task 1, first `npm run check` after writing the pure-logic module
- **Issue:** `tsconfig.json` declares no explicit `target` (defaults `tsc` to ES3). The plan's literal spec for `normalizeCompositionNote` (`/[^\p{L}\p{N}\s]/gu`) and my initial `jaccard(a: Set<string>, b: Set<string>)` (`for (const token of a)`) both produced real `tsc` errors (`TS1501`, `TS2802`) — not stylistic warnings.
- **Fix:** Rewrote `normalizeCompositionNoteString` to mirror `shared/utils.ts`'s existing `normalizeForComparison` pattern (`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ")`), and rewrote `jaccard` to accept plain token arrays, de-duplicating via `Array.from(new Set(...))` (already an established pattern in `cleanup-cron.service.ts`/`trash.routes.ts`) instead of iterating a `Set` directly.
- **Files modified:** `server/services/carousel-plan-schema.service.ts`
- **Verification:** `npm run check` exits 0; all 15 `scripts/test-carousel-narrative-plan.ts` assertions (including the accent-sensitive and near-identical-framing cases) still pass after the rewrite.
- **Committed in:** `5eb6464`

---

**Total deviations:** 2 auto-fixed (1 Rule-3 blocking, 1 Rule-1 bug)
**Impact on plan:** Both fixes were required for the code to run/compile at all — no scope creep, no architectural change. All behavior specified in the plan's `<behavior>` bullets is preserved; only the exact regex mechanism and import paths changed.

## Issues Encountered
One git-mechanics race (not a code deviation): this plan's final docs commit (STATE.md/ROADMAP.md/REQUIREMENTS.md/this SUMMARY.md) landed bundled inside sibling plan 25-07's own `docs(25-07)` commit (`d944825`) because both agents' staged changes occupied the same shared git index at the moment 25-07 ran its commit step — see "Plan metadata" note above. Content verified intact; no fix needed.

## User Setup Required

None - no external service configuration required. This plan is pure server-side logic/schema with zero AI calls, zero database access, and zero new dependencies.

## Next Phase Readiness

- `server/services/carousel-plan-schema.service.ts` is fully self-contained and importable: `scripts/verify-phase-25.ts --only=svc-carousel-narrative` shows 6/9 checks green (every check this plan owns), with the remaining 3 (`carousel-generation.service.ts`'s `CarouselTextPlan` interface, its import from `./carousel-plan-schema.js`, and its call to `assignSlideRoles(`) correctly still red — those are 25-10's wiring job, not this plan's.
- Zero regression: `scripts/verify-phase-22.ts` (6/6 checks) re-run clean; `npm run check` exits 0.
- No blockers. 25-10 can import `CAROUSEL_PLAN_JSON_SCHEMA`/`CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA`/`validateCarouselWirePlan`/`assignSlideRoles` directly and swap `carousel-generation.service.ts`'s `callCarouselTextPlan`/`CarouselTextPlan` over to this module's dual-dialect transport + wire types.

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/services/carousel-plan-schema.service.ts
- FOUND: scripts/test-carousel-narrative-plan.ts
- FOUND: .planning/phases/25-narrative-carousels-and-aesthetic-dna/25-03-SUMMARY.md
- FOUND: 799bb8e (Task 1 RED commit)
- FOUND: 5eb6464 (Task 1 GREEN commit)
- FOUND: 90c8f0e (Task 2 commit)
