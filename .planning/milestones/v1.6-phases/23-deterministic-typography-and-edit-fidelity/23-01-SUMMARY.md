---
phase: 23-deterministic-typography-and-edit-fidelity
plan: 01
subsystem: infra
tags: [napi-rs-canvas, sharp, inter-font, docker, esbuild, verification-harness]

# Dependency graph
requires:
  - phase: 22-art-director-planning-upgrade
    provides: "text_blocks / layout_archetype_id schema fields on the planning call's structured output"
provides:
  - "@napi-rs/canvas 1.0.2 dependency with a musl binary recorded in package-lock.json"
  - "Bundled Inter v4.1 fonts (Regular/SemiBold/Bold, SIL OFL 1.1) committed to server/assets/fonts/, copied into dist/assets/fonts by script/build.ts"
  - "scripts/smoke-canvas.ts — standalone AVX/musl runtime smoke check guarding Brooooooklyn/canvas#1117"
  - "tests/fixtures/typography/ — pt-BR/es accented-glyph strings + deterministic low/high-contrast 1024x1024 base image fixtures"
  - "scripts/verify-phase-23.ts — the 12-tag Phase 23 phase gate that plans 23-02..23-10 turn green without editing this file"
affects: [23-02, 23-03, 23-04, 23-05, 23-06, 23-07, 23-08, 23-09, 23-10, 23-11]

# Tech tracking
tech-stack:
  added: ["@napi-rs/canvas@1.0.2"]
  patterns:
    - "Per-weight font-alias registration (Inter-Regular/Inter-SemiBold/Inter-Bold) instead of one shared family alias relying on bold-keyword matching"
    - "Bespoke scripts/verify-phase-NN.ts harness convention (check/readSafe/--only=) extended with a tagActive() guard so --only filtering also skips expensive dynamic-import functional checks"

key-files:
  created:
    - server/assets/fonts/Inter-Regular.ttf
    - server/assets/fonts/Inter-SemiBold.ttf
    - server/assets/fonts/Inter-Bold.ttf
    - server/assets/fonts/LICENSE.txt
    - scripts/smoke-canvas.ts
    - tests/fixtures/typography/strings.json
    - tests/fixtures/typography/make-fixtures.ts
    - tests/fixtures/typography/low-contrast-1024.png
    - tests/fixtures/typography/high-contrast-1024.png
    - scripts/verify-phase-23.ts
  modified:
    - package.json
    - package-lock.json
    - script/build.ts

key-decisions:
  - "@napi-rs/canvas pinned to ^1.0.2 (npm view confirmed both @napi-rs/canvas and @napi-rs/canvas-linux-x64-musl at 1.0.2 at install time, matching 23-RESEARCH.md's verified figure)"
  - "Font copy step placed after the esbuild() call in script/build.ts's buildAll(), using fs/promises cp — runner Dockerfile stage only COPYs dist/, so fonts must land inside dist/assets/fonts"
  - "scripts/verify-phase-23.ts's [svc-verify-repair-removed] repo-wide scan covers the full scripts/ directory (not just verify-phase-16.ts) with scripts/verify-phase-06.ts explicitly allowlisted, satisfying both the letter and the evident intent of the plan's phrasing"
  - "Functional (dynamic-import) checks in the harness are gated by a tagActive() helper so `--only=self-test` runs do not pay the cost of attempting imports of not-yet-created modules"

patterns-established:
  - "Phase gate harness pattern: readSafe() for every file a later plan creates, try/catch around every dynamic-import functional check, --only=<tag> substring filter — followed exactly from verify-phase-22.ts"

requirements-completed: [TYPO-02, TYPO-04]

# Metrics
duration: 15min
completed: 2026-07-27
---

# Phase 23 Plan 01: Substrate Foundation Summary

**@napi-rs/canvas + bundled Inter v4.1 fonts + AVX smoke check + pt-BR/es golden-image fixtures + the 12-tag scripts/verify-phase-23.ts phase gate, all wired into the build but deliberately red except `[self-test]` until plans 23-02..23-10 land**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-27T20:56:02Z
- **Completed:** 2026-07-27T21:10:41Z
- **Tasks:** 3
- **Files modified:** 13 (3 modified, 10 created)

## Accomplishments
- `@napi-rs/canvas@1.0.2` installed with its `linux-x64-musl` binary confirmed present in `package-lock.json` (Alpine/Docker runner compatibility)
- Three Inter v4.1 static TTF weights (Regular/SemiBold/Bold, SIL OFL 1.1) downloaded from the official `rsms/inter` GitHub release, verified >= 100 KB each, and committed alongside the license text
- `script/build.ts` now copies `server/assets/fonts` → `dist/assets/fonts` after the esbuild bundle step, so the Docker runner stage (which only `COPY --from=builder /app/dist ./dist`s) can find them
- `scripts/smoke-canvas.ts` creates a real canvas, fills a rect, and PNG-encodes it, guarding against the documented `Illegal instruction` crash on non-AVX musl hosts (Brooooooklyn/canvas#1117)
- A deterministic pt-BR/es golden-image fixture set: `strings.json` (accented-glyph coverage, pt-BR/es sample copy, a long-wrap stress case) plus two byte-identical-on-rerun 1024x1024 PNGs (mid-grey "scrim required" and near-black "scrim not required")
- `scripts/verify-phase-23.ts`: a 12-tag static + functional phase gate (`[self-test]`, `[svc-text-free-prompt]`, `[svc-compositor-archetypes]`, `[svc-contrast-scrim]`, `[svc-golden-image-glyphs]`, `[svc-aspect-crop]`, `[svc-schema-migration]`, `[svc-generation-params]`, `[svc-edit-base-image]`, `[svc-verify-repair-removed]`, `[svc-docker-fonts]`, `[svc-remake-ui]`) — `--only=self-test` is green (7/7); the full run exits 1 with all 11 downstream tags red (53 real failures) and zero uncaught exceptions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add @napi-rs/canvas, commit Inter fonts, ship them into dist/, add the AVX smoke check** - `aad7ead` (feat)
2. **Task 2: Golden-image fixture set (pt-BR/es strings + low/high-contrast base images)** - `a3b8b53` (test)
3. **Task 3: scripts/verify-phase-23.ts — the 12-tag phase gate** - `4da36ba` (feat)

_Note: no TDD tasks in this plan — all three are `type="auto"` static/asset/harness work._

## Files Created/Modified
- `package.json` / `package-lock.json` - added `@napi-rs/canvas` dependency (musl binary confirmed in lockfile)
- `script/build.ts` - copies `server/assets/fonts` → `dist/assets/fonts` after the esbuild bundle step
- `server/assets/fonts/Inter-{Regular,SemiBold,Bold}.ttf` + `LICENSE.txt` - bundled typography fonts (SIL OFL 1.1)
- `scripts/smoke-canvas.ts` - standalone AVX/musl runtime smoke check for `@napi-rs/canvas`
- `tests/fixtures/typography/strings.json` - pt-BR/es accented strings, control tofu char, long-wrap stress case
- `tests/fixtures/typography/make-fixtures.ts` - deterministic `sharp`-based generator for the two contrast fixtures
- `tests/fixtures/typography/{low,high}-contrast-1024.png` - committed generator output (verified byte-identical on re-run)
- `scripts/verify-phase-23.ts` - the 12-tag Phase 23 phase gate; owned by this plan and 23-11 only

## Decisions Made
- **npm registry versions recorded:** `npm view @napi-rs/canvas version` → `1.0.2`; `npm view @napi-rs/canvas-linux-x64-musl version` → `1.0.2` (matches 23-RESEARCH.md exactly, no drift since research).
- **Font-copy comment wording adjusted** so `grep -c 'dist/assets/fonts' script/build.ts` == 2 exactly (the `cp()` call and the `console.log`), per the plan's literal acceptance criterion — the original plan-quoted comment text would have produced a 3rd incidental match; reworded the comment's tail clause without changing its meaning.
- **`[svc-verify-repair-removed]`'s repo-wide scan** covers the entire `scripts/` directory (not narrowly just `scripts/verify-phase-16.ts`) with `scripts/verify-phase-06.ts` allowlisted — this satisfies the plan's explicit mention of needing to allowlist that specific file (which would be moot if the scan were narrowed to a single other file) while still being a genuine "repo-wide" scan.
- **Functional-check gating (`tagActive()`):** added a lightweight filter so `--only=self-test` (and other narrow filters) skip the dynamic-import attempts for modules that don't exist yet, keeping targeted runs fast; this is additive harness behavior, not a weakening of any check.

## Deviations from Plan

None — plan executed exactly as written. The `script/build.ts` comment wording was adjusted only to hit the plan's own literal `grep -c == 2` criterion (not a functional deviation; same information conveyed).

## Issues Encountered
- `scripts/smoke-canvas.ts`'s first draft used CommonJS `require("@napi-rs/canvas/package.json")` to read the installed version for the success message; since `package.json` sets `"type": "module"`, this threw `ReferenceError: require is not defined`. Fixed by using `createRequire(import.meta.url)` from `node:module` — a one-line fix, verified by re-running the script (`SMOKE OK: @napi-rs/canvas 1.0.2 loaded and encoded 137 bytes`).

## User Setup Required

None - no external service configuration required. (The AVX/musl production-host verification remains a manual/live check per 23-VALIDATION.md's Manual-Only Verifications table — not part of this plan's automated scope.)

## Next Phase Readiness
- The Phase 23 substrate is fully in place: `@napi-rs/canvas` loads and encodes on this machine, three Inter weights + license are committed and will reach `dist/assets/fonts` via the build, pt-BR/es + contrast fixtures exist and regenerate deterministically, and `scripts/verify-phase-23.ts` is the standing phase gate for every remaining Phase 23 plan.
- Plans 23-02 (schema migration), 23-03 (aspect crop), 23-04 (compositor), and 23-05 (text-free prompt) can now proceed in parallel per `23-VALIDATION.md`'s wave plan; each turns its own subset of the 12 tags green without editing this harness.
- No blockers identified for downstream plans.

---
*Phase: 23-deterministic-typography-and-edit-fidelity*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 10 created files confirmed present on disk; all 3 task commits (`aad7ead`, `a3b8b53`, `4da36ba`) confirmed in git history.
