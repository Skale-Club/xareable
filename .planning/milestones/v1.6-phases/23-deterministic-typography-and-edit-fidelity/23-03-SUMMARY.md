---
phase: 23-deterministic-typography-and-edit-fidelity
plan: 03
subsystem: infra
tags: [sharp, image-processing, aspect-ratio, cropping]

# Dependency graph
requires:
  - phase: 23-01
    provides: "@napi-rs/canvas substrate, Inter fonts, tests/fixtures/typography/, scripts/verify-phase-23.ts phase gate"
provides:
  - "server/services/image-crop.service.ts — generic 'W:H' parser (parseAspectRatio) + deterministic center-crop (cropToExactAspectRatio) + measureAspectRatio helper"
  - "scripts/test-aspect-crop.ts — standalone 22-assertion functional proof covering all 15 accepted aspect_ratio enum values plus identity/degenerate cases"
affects: [23-06, 23-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generic 'W:H' string parsing for aspect ratio (never a lookup table) — closes Pitfall 9 (the existing ASPECT_RATIO_DIMENSIONS table only covers 6/15 enum values)"
    - "Buffer-in/buffer-out sharp service convention (mirrors image-optimization.service.ts): never throws, returns input unchanged on unreadable/degenerate input"

key-files:
  created:
    - server/services/image-crop.service.ts
    - scripts/test-aspect-crop.ts
  modified: []

key-decisions:
  - "Reworded the plan's mandated header comment to avoid the literal substring 'ASPECT_RATIO_DIMENSIONS' — the actual scripts/verify-phase-23.ts harness (owned by 23-01/23-11, not editable by this plan) does a strict whole-file !includes('ASPECT_RATIO_DIMENSIONS') check with no comment exception; quoting the identifier verbatim (as the plan's action text literally specifies) would have failed that real automated gate. Same information preserved (identifies the incomplete 6-of-15-value lookup table and cites Pitfall 9) without the exact token."

requirements-completed: [POL-04]

# Metrics
duration: 7min
completed: 2026-07-27
---

# Phase 23 Plan 03: Deterministic Aspect-Ratio Crop Summary

**Generic 'W:H' center-crop service (`cropToExactAspectRatio`) via `sharp .extract()` that normalizes any of the 15 accepted `aspect_ratio` enum values to within 0.01 of exact, proven by a standalone 22-assertion test with zero network calls**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-27T21:19:00Z
- **Completed:** 2026-07-27T21:25:32Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- `server/services/image-crop.service.ts`: `parseAspectRatio` (throw-safe generic "W:H" parser), `cropToExactAspectRatio` (center-crop via `sharp.extract()`, no-op when already within `ASPECT_RATIO_TOLERANCE = 0.005`, returns the original buffer unchanged on any parse/metadata/sharp failure), and `measureAspectRatio` (harness/logging helper)
- Deliberately does NOT import or reference `prompt-builder.service.ts`'s `ASPECT_RATIO_DIMENSIONS`/`toGeminiAspectRatio` — that lookup table covers only 6 of the 15 accepted enum values (23-RESEARCH.md Pitfall 9); ratios are parsed generically from the string instead
- `scripts/test-aspect-crop.ts`: standalone, no-network functional test — 22/22 assertions pass, covering all 15 `aspect_ratio` enum values (including extremes `1:8`, `8:1`, `4:1`, `1:4`, `21:9`), the no-op identity case (byte-identical output via `Buffer.compare`), 4 degenerate inputs (`"abc"`, `"0:1"`, `"1:0"`, `""`) that never throw, and `parseAspectRatio` identity assertions
- `npx tsx scripts/verify-phase-23.ts --only=svc-aspect-crop` exits 0 (4/4 checks including the harness's own functional block across 1:1/4:5/16:9/1200:628/21:9/1:8/8:1)
- `npm run check` exits 0; prior-phase harnesses (`verify-phase-21.ts` 43/43, `verify-phase-21.1.ts`, `verify-phase-22.ts` 54/54) all still pass

## Task Commits

Each task was committed atomically:

1. **Task 1: image-crop.service.ts — generic W:H parser + deterministic center-crop** - `b13891a` (feat)
2. **Task 2: Prove the crop against every accepted aspect_ratio enum value** - `8a6f6e8` (test)

_Note: no TDD tasks in this plan — both are `type="auto"` service + standalone-test work._

## Files Created/Modified
- `server/services/image-crop.service.ts` - `parseAspectRatio`, `cropToExactAspectRatio`, `measureAspectRatio`, `ASPECT_RATIO_TOLERANCE` constant
- `scripts/test-aspect-crop.ts` - 22-assertion standalone functional proof (no network, <15s runtime)

## Decisions Made
- **Header comment reworded to avoid the literal `ASPECT_RATIO_DIMENSIONS` token** (see key-decisions above / Deviations section) — necessary to pass the actual `scripts/verify-phase-23.ts` gate, which does a strict whole-file substring check with no allowance for comments.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's literal mandated header text would fail the actual automated verification gate**
- **Found during:** Task 1
- **Issue:** The plan's `<action>` block specifies the header comment must literally state "...deliberately NOT looked up in prompt-builder.service.ts's ASPECT_RATIO_DIMENSIONS, which covers only 6 of the 15 accepted enum values...". However, `scripts/verify-phase-23.ts` (written in plan 23-01, not owned/editable by this plan) checks `!imageCropSrc.includes("ASPECT_RATIO_DIMENSIONS")` — a strict whole-file check with no comment exception. Writing the identifier verbatim, as the plan's action text specifies, would cause this real check (and the actual `<verify><automated>` command for this task) to fail.
- **Fix:** Reworded the header comment to convey the identical information — that ratios are parsed generically rather than looked up in the existing incomplete 6-of-15-value dimension table in `prompt-builder.service.ts`, citing "23-RESEARCH.md Pitfall 9" — without using the literal token `ASPECT_RATIO_DIMENSIONS`.
- **Files modified:** `server/services/image-crop.service.ts`
- **Verification:** `npx tsx scripts/verify-phase-23.ts --only=svc-aspect-crop` — the "[svc-aspect-crop] contains NO reference to ASPECT_RATIO_DIMENSIONS" check now passes; the harness's own functional crop-ratio check also passes.
- **Committed in:** `b13891a` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — plan text vs. actual harness conflict)
**Impact on plan:** No scope creep; same documented intent preserved, only wording changed to satisfy the real automated gate rather than the plan's illustrative (but harness-incompatible) exact phrasing.

## Issues Encountered
- **Transient parallel-execution TS noise (not a real issue):** Mid-execution, `npm run check` briefly showed errors in `client/src/components/post-creator-dialog.tsx` and `client/src/pages/posts.tsx` (missing `base_image_url`/`typography_meta`/`generation_params` on the post type). This was caused by the sibling parallel plan 23-02's in-flight, uncommitted edits to `shared/schema.ts` sitting in the shared working directory at that instant — not by anything this plan touched. Confirmed clean (`npm run check` exits 0) both immediately after this plan's Task 1 commit and again at final verification once 23-02 completed its own commits. No action taken on those files (out of scope per the parallel-execution boundary).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `cropToExactAspectRatio` is a self-contained, drop-in service ready for `generate.routes.ts` (23-06) and `edit.routes.ts` (23-07) to call as the first step of the post-generation pipeline, before typography/logo compositing.
- No route changes were made in this plan (by design — plan scope was the service + its proof only).
- No blockers identified for downstream plans.

---
*Phase: 23-deterministic-typography-and-edit-fidelity*
*Completed: 2026-07-27*

## Self-Check: PASSED

Both created files confirmed present on disk (`server/services/image-crop.service.ts`, `scripts/test-aspect-crop.ts`); both task commits (`b13891a`, `8a6f6e8`) confirmed in git history.
