---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 01
subsystem: testing
tags: [verification-harness, static-analysis, phase-gate, tsx]

# Dependency graph
requires:
  - phase: 24-visual-critic-and-reroll
    provides: scripts/verify-phase-24.ts as the reference implementation pattern (check/read/exists/readSafe/tagActive helpers, balanced-delimiter extractors, spawnSync functional checks, self-test-not-vacuous convention)
provides:
  - "scripts/verify-phase-25.ts — the 7-tag Phase 25 static+functional phase gate, runnable today by every downstream plan's <verify><automated> command"
affects: [25-02, 25-03, 25-04, 25-05, 25-06, 25-07, 25-08, 25-09, 25-10, 25-11, 25-12, 25-13, 25-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase gate harness scaffold: check(name, cond, detail)/read/exists/readSafe/tagActive + balanced-delimiter extractors (extractZodObjectBody/extractConstObjectLiteral/extractInterfaceBody), copied verbatim from verify-phase-24.ts"
    - "windowAround(src, marker, radius) — generic char-window helper for call-site-proximity assertions (e.g. 'plan.layout_archetype_id near compositeTypography(')"
    - "findMigrationFile(suffix) — glob-by-suffix helper for asserting a not-yet-named migration file exists under supabase/migrations/"
    - "FUNCTIONAL checks wrapped in try/catch around `await import('../shared/schema.js')` / `await import('../server/services/*.service.js')` — never throw, always degrade to an honest FAIL with the caught error as detail"

key-files:
  created:
    - scripts/verify-phase-25.ts
  modified: []

key-decisions:
  - "Followed the exact Phase 24 precedent for spawnSync-based functional checks (scripts/test-carousel-narrative-plan.ts, scripts/test-style-reference-merge.ts) with no exists()-guard before spawning — a not-yet-created target script produces a captured ERR_MODULE_NOT_FOUND stack trace inside the FAIL detail string, not an uncaught exception in the harness's own process (confirmed: the harness completes to its summary/process.exit(1) epilogue every time). This exactly mirrors verify-phase-24.ts's original 24-01 commit (15adf09), so it is established precedent, not a new risk."
  - "Both plan tasks (scaffold+self-test, then the 6 requirement tags) were written and committed as a single file/commit, mirroring how 24-01's equivalent commit (15adf09) also landed the full 6-tag harness in one commit rather than splitting per task."

patterns-established:
  - "PHASE_25_TAGS array + [self-test] check 2 asserts the harness's own source contains all declared tag literals — prevents a future edit from silently dropping a tag."
  - "Every red check's `detail` argument names the exact file path + symbol required to turn it green, per the plan's must_haves.truths."

requirements-completed: [PLAN-05, PLAN-06, PLAN-07, CRSL2-01, CRSL2-02, CRSL2-04]

# Metrics
duration: 18min
completed: 2026-07-28
---

# Phase 25 Plan 01: Phase 25 Verification Harness Summary

**Installed `scripts/verify-phase-25.ts` — the 7-tag Phase 25 phase gate (self-test green, 48 checks across the 6 requirement tags honestly red) — making every downstream plan's `--only=<tag>` verify command runnable today.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 2 (both landed in a single file write / single commit, per Phase 24's established precedent)
- **Files modified:** 1 (new file)

## Accomplishments
- `scripts/verify-phase-25.ts` created following `scripts/verify-phase-24.ts`'s exact structure: `check`/`read`/`exists`/`readSafe`/`tagActive` helpers plus `extractZodObjectBody`/`extractConstObjectLiteral`/`extractInterfaceBody` copied verbatim, plus two small local helpers (`windowAround`, `findMigrationFile`) needed for this phase's window-proximity and migration-glob assertions.
- `[self-test]` tag: 5/5 green — proves the harness executes, contains all 7 tag literals, is wired to invoke both Wave 0 unit harnesses (`scripts/test-carousel-narrative-plan.ts`, `scripts/test-style-reference-merge.ts` — created by 25-03/25-04, not yet on disk), and its absence-detection scanner is not vacuous.
- 6 requirement tags installed, each `--only=<tag>` filterable and reporting well above the 6-check floor: `svc-carousel-narrative` (9), `svc-carousel-compositor` (8), `svc-carousel-textstyle-logo` (7), `svc-aesthetic-dna-catalog` (7), `svc-color-proportion` (6), `svc-style-reference-boards` (11) — 48 checks total across the tag blocks, 53 including `[self-test]`.
- Every one of those 42 currently-red checks embeds the exact file path + symbol (e.g. `server/services/carousel-plan-schema.service.ts` / `assignSlideRoles`, `server/services/style-art-direction.service.ts` / `buildStyleArtDirectionBlock`, `supabase/migrations/*_style_reference_photos.sql`) that the owning plan (25-02..25-13) must create to turn it green.
- Full-suite run confirmed honestly red: 11 PASS / 42 FAIL, harness completes to its own `process.exit(1)` epilogue every time (no uncaught exception in the harness's own process).
- Zero regression: `scripts/verify-phase-24.ts` re-run clean (all 7 tags, including the `[svc-cross-plan]` non-regression sweep against Phases 16/21/21.1/22/23). `npm run check` exits 0 (scripts/ is outside tsconfig's `include`, so this was a fast no-op confirmation, consistent with every prior verify-phase-NN.ts script).

## Task Commits

Both tasks landed in one commit (mirrors 24-01's `15adf09`, which also shipped its full 6-tag harness as a single commit):

1. **Task 1 + Task 2: Harness scaffold + self-test + 6 requirement tags** - `2088ea8` (feat)

## Files Created/Modified
- `scripts/verify-phase-25.ts` - the 7-tag Phase 25 phase gate: `[self-test]` (5 checks, green) + `[svc-carousel-narrative]` (9), `[svc-carousel-compositor]` (8), `[svc-carousel-textstyle-logo]` (7), `[svc-aesthetic-dna-catalog]` (7), `[svc-color-proportion]` (6), `[svc-style-reference-boards]` (11) — all honestly red, naming the exact not-yet-written artifacts for plans 25-02..25-13.

## Decisions Made
- Matched Phase 24's exact spawnSync-without-exists-guard pattern for the two Wave 0 functional checks (`svc-carousel-narrative`'s and `svc-style-reference-boards`'s `spawnSync("npx", ["tsx", "scripts/test-*.ts"])` calls) rather than adding a new existence guard — confirmed via `git show 15adf09` that the reference implementation (24-01) used the identical unguarded pattern, and confirmed by direct test that the resulting child-process `ERR_MODULE_NOT_FOUND` stack trace is captured into the FAIL `detail` string (not thrown as an uncaught exception in the harness's own process — the harness always reaches its summary/`process.exit(1)` epilogue). This is precedent-consistent, not a deviation.
- Single file/commit for both tasks, matching how 24-01's equivalent commit (`15adf09`) shipped its full harness (scaffold + all 6 requirement tags) in one commit rather than two.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1-4 triggers encountered; this is a new, isolated file (`scripts/verify-phase-25.ts`) with no existing behavior to break and no architectural decisions required.

## Issues Encountered

None. The only noteworthy finding during verification was confirming (via `git show` on the Phase 24 precedent commit and a direct reproduction test) that a `spawnSync`-invoked `npx tsx <not-yet-created-file>.ts` prints a captured `ERR_MODULE_NOT_FOUND` Node stack trace as part of the FAIL detail string — this is expected/precedent-consistent behavior, not a harness bug, and does not violate the "zero uncaught exceptions" must-have (the harness's own process never throws; it always completes to its summary and calls `process.exit(1)` intentionally).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `scripts/verify-phase-25.ts` is installed, self-proving, and every one of plans 25-02 through 25-14's `<verify><automated>` commands (`npx tsx scripts/verify-phase-25.ts --only=<tag>`) is runnable today.
- No blockers. Plans 25-02 onward can proceed in their planned wave order; each will turn a subset of this harness's 42 red checks green.

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: scripts/verify-phase-25.ts
- FOUND: .planning/phases/25-narrative-carousels-and-aesthetic-dna/25-01-SUMMARY.md
- FOUND: 2088ea8 (task commit)
