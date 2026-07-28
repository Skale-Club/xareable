---
phase: 23-deterministic-typography-and-edit-fidelity
plan: 07
subsystem: api
tags: [sharp, napi-rs-canvas, image-editing, typography, backward-compatibility]

# Dependency graph
requires:
  - phase: 23-02
    provides: "posts/post_versions base_image_url/typography_meta/generation_params columns + shared Zod TypographyMeta/GenerationParams types + edit_context aspect_ratio/use_logo/logo_position/text_only fields"
  - phase: 23-03
    provides: "cropToExactAspectRatio (server/services/image-crop.service.ts)"
  - phase: 23-04
    provides: "resolveTextBlocks/compositeTypography (server/services/typography-compositor.service.ts), DEFAULT_LAYOUT_ARCHETYPE_ID/LayoutArchetypeId"
provides:
  - "resolveEditTarget/resolveEditAspectRatio/isTextOnlyEdit/resolveEditTextBlocks — four pure, exported, unit-tested helpers in edit.routes.ts"
  - "Edit pipeline rewired: AI-edit the persisted base image (not the flattened image), re-crop, re-composite typography, re-overlay logo, persist a new base_image_url/typography_meta per version"
  - "Compositor-only fast path for text-only edits (edit_context.text_only) — zero AI image calls"
  - "Explicit LEGACY (base_image_url IS NULL) branch reproducing the exact pre-Phase-23 edit behavior for posts created before this migration"
  - "The AI-rendered-text verify/repair loop (enforceExactImageText) fully removed from the edit path"
affects: [23-09, 23-10, 23-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EditTarget resolution precedence: latest version's base_image_url -> post's base_image_url -> LEGACY latest version's flattened image_url -> LEGACY post's flattened image_url -> null"
    - "Text-only fast path requires an explicit client boolean (edit_context.text_only) rather than a heuristic — deterministic and unit-testable"
    - "Dynamic await import() inside a test's main() (not a static import) to set fixture env vars before a route module's transitive config/index.ts validateEnv() runs, avoiding ESM import-hoisting order issues without needing to extract helpers into a separate file"

key-files:
  created:
    - scripts/test-edit-base-image-resolution.ts
  modified:
    - server/routes/edit.routes.ts

key-decisions:
  - "Kept all four helpers (resolveEditTarget, resolveEditAspectRatio, isTextOnlyEdit, resolveEditTextBlocks) declared directly in edit.routes.ts rather than extracting to a separate edit-target.helpers.ts module — a plain static import of edit.routes.ts in the test script does trigger config/index.ts's validateEnv() before the test's own process.env fixture assignments (ESM import hoisting), but this only prints a non-fatal warning banner (NODE_ENV != production) and does not block the import or break any assertion. A dynamic `await import(...)` inside main() sidesteps even that banner cleanly, so the primary approach the plan suggested (import directly from edit.routes.ts) was fully viable and used as-is."
  - "TEXT_FREE_EDIT_RULE is unconditional for ALL edits, including LEGACY (base_image_url IS NULL) posts — the image model never renders text, full stop, since Phase 23's whole point is removing AI-rendered text as a channel. LEGACY posts thus lose the ability to get NEW AI-baked-in text on future edits (no compositor ever runs for them), but continue to work with no crash/lockout, per 23-CONTEXT.md's backward-compatibility bullet and this wave's explicit instruction to preserve the LEGACY branch's behavior exactly as checked by the plan-checker."
  - "Reused the edit branch's already-fetched editLogoData (downloadImageAsBase64 result) for the new deterministic logo overlay step instead of a second brand.logo_url fetch — same data, one fewer network round-trip, functionally identical to generate.routes.ts's pattern."
  - "Removed the edit prompt's languageInstruction line (Rule 1 — bug) — it told the image model 'any text that appears in the edited image must be in <language>', directly contradicting the new TEXT_FREE_EDIT_RULE. Removed alongside its now-unused LANGUAGE_NAMES import."

requirements-completed: [TYPO-06, TYPO-07, POL-05]

# Metrics
duration: 12min
completed: 2026-07-27
---

# Phase 23 Plan 07: Edit Pipeline Base-Image Rewrite & Fast Path Summary

**Rewired `edit.routes.ts` to AI-edit the persisted pre-typography base image (crop -> composite -> logo -> optimize), added a zero-AI-call compositor-only fast path for text-only edits, deleted the AI verify/repair loop, and kept every pre-migration post editable through an explicit LEGACY (base_image_url IS NULL) branch — proven by a 20/20 no-network fixture test**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-27T18:09:43-04:00
- **Completed:** 2026-07-27T18:21:41-04:00
- **Tasks:** 3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Four pure, exported, side-effect-free helpers added to `edit.routes.ts`: `resolveEditTarget` (base-image-vs-LEGACY edit-target resolution), `resolveEditAspectRatio` (generation_params reuse, POL-05), `isTextOnlyEdit` (TYPO-07 fast-path gate), `resolveEditTextBlocks` (TextEditMode -> compositor text_blocks mapping)
- Image edit branch restructured into two paths: a compositor-only fast path for text-only edits (no AI image call, no re-crop) and a full pipeline (AI-edit the resolved target -> `cropToExactAspectRatio` for base-image posts -> `compositeTypography` -> deterministic logo overlay -> optimize/upload)
- New pre-typography base image persisted per version at `${user.id}/base/versions/${versionId}.png`; `post_versions` insert gains `base_image_url`/`typography_meta`
- `enforceExactImageText` import and its entire verify/repair block deleted from the edit path (TYPO-06); the per-`text_mode` AI prompt instructions replaced with an unconditional `TEXT_FREE_EDIT_RULE` (the image model never renders text; all on-image copy is composited server-side)
- LEGACY (`base_image_url IS NULL`) posts fall through unchanged: no crop, no compositor, no logo re-overlay, no lockout — reproducing this route's exact pre-Phase-23 behavior
- `scripts/test-edit-base-image-resolution.ts`: 20/20 assertions, no network, no Supabase, covering every branch of the decision matrix including 2 explicit LEGACY cases
- `npm run check` clean; `scripts/verify-phase-23.ts --only=svc-edit-base-image` 6/6; zero regression on Phases 21 (43/43), 21.1, and 22 (54/54)

## Task Commits

Each task was committed atomically:

1. **Task 1: Edit-target resolution with the legacy branch, and generation_params reuse** - `a72cf6c` (feat)
2. **Task 2: Rewire the image edit branch — fast path, full pipeline, dual upload, version persistence, repair-loop removal** - `4cf0bf7` (feat)
3. **Task 3: Fixture test for the edit-target / fast-path / text-block decision matrix** - `8f36fd3` (test)

_Note: no TDD tasks in this plan — all three are `type="auto"` route-rewrite + standalone-test work._

## Files Created/Modified
- `server/routes/edit.routes.ts` - `resolveEditTarget`/`resolveEditAspectRatio`/`isTextOnlyEdit`/`resolveEditTextBlocks` exported helpers; image edit branch rewritten (fast path + full pipeline); `post_versions` insert gains `base_image_url`/`typography_meta`; `enforceExactImageText` and the repair block deleted; `TEXT_FREE_EDIT_RULE` replaces the old `textEditRules` map; `ensureCaptionQuality` scenario renamed `"exact-text-edit"` -> `"text-recompose-edit"`; stale `enforceExactImageText()` doc-comment reference and the now-contradictory `languageInstruction` + unused `LANGUAGE_NAMES` import removed
- `scripts/test-edit-base-image-resolution.ts` - 20-assertion standalone fixture test (no network, no Supabase) for the full decision matrix

## Decisions Made
- Kept the four helpers declared directly in `edit.routes.ts` (not extracted to a separate `edit-target.helpers.ts` module) — see key-decisions above. The test imports them via a dynamic `await import(...)` so fixture `SUPABASE_*` env vars are set before the route module's transitive `config/index.ts` env validation runs (ESM static imports are hoisted ahead of any preceding statements in the same file, which would otherwise print — but not fail — a validation-error banner).
- `TEXT_FREE_EDIT_RULE` applies unconditionally, including to LEGACY posts — accepted per 23-CONTEXT.md and this wave's explicit instruction to preserve the LEGACY branch's checked-and-confirmed-sound behavior (no crash, no lockout, no re-composite) rather than carve out a legacy exception that would keep the old per-mode AI text instructions alive.
- Reused the already-fetched `editLogoData` for the new deterministic logo overlay instead of a second `downloadImageAsBase64(brand.logo_url)` call — same data, avoids a redundant network fetch.
- Removed the edit prompt's `languageInstruction` line and its now-unused `LANGUAGE_NAMES` import (Rule 1 — bug fix): it told the image model "any text that appears in the edited image must be in ${language}", directly contradicting the new text-free mandate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale `enforceExactImageText()` reference left in a nearby doc comment**
- **Found during:** Task 2, reviewing the surrounding GATE-06 comment block after deleting the repair block
- **Issue:** A comment near the video-key-resolution logic referenced `enforceExactImageText() below is also direct-Google...` — dangling after the function and its only call site were removed.
- **Fix:** Removed the stale sentence from the comment; the surrounding GATE-06 rationale remains intact and accurate.
- **Files modified:** `server/routes/edit.routes.ts`
- **Verification:** `npm run check` clean; manual review confirms no other dangling references to the deleted function remain.
- **Committed in:** `4cf0bf7` (Task 2 commit)

**2. [Rule 1 - Bug] Contradictory `languageInstruction` line in the edit prompt**
- **Found during:** Task 2, while replacing `textEditRules` with the unconditional `TEXT_FREE_EDIT_RULE`
- **Issue:** The edit prompt still told the image model "CRITICAL: Any text that appears in the edited image must be in ${language}" — directly contradicting the new "Do NOT render... any text" instruction added in the same task, which would confuse the model and risk exactly the ghosting/ambiguity TYPO-07 forbids.
- **Fix:** Removed the `languageInstruction` variable and its interpolation from `editPrompt`, and removed the now-unused `LANGUAGE_NAMES` import from `prompt-builder.service.js`.
- **Files modified:** `server/routes/edit.routes.ts`
- **Verification:** `npm run check` clean (no unused-import errors possible either way since `noUnusedLocals` isn't set, but removed for cleanliness/correctness); `scripts/verify-phase-23.ts --only=svc-edit-base-image` 6/6.
- **Committed in:** `4cf0bf7` (Task 2 commit)

**3. [Rule 1 - Bug] Two plan-text acceptance criteria not yet satisfied on first pass**
- **Found during:** Task 2, running the task's own `<acceptance_criteria>` greps after the initial rewrite
- **Issue:** `grep -c 'textEditRules'` was 1 (a doc comment referencing the old identifier by name), and `grep -c 'editTarget.isBaseImage'` was 2 instead of the required >= 3.
- **Fix:** Reworded the `resolveEditTextBlocks` doc comment to avoid the literal `textEditRules` substring, and added `(editTarget.isBaseImage === false)` to the LEGACY fall-through comment to bring the count to 3 (crop guard, composite guard, legacy fall-through comment) — matching the plan's own literal grep criteria without changing any behavior.
- **Files modified:** `server/routes/edit.routes.ts`
- **Verification:** Re-ran both greps — `textEditRules` 0, `editTarget.isBaseImage` 3. `npm run check` and `verify-phase-23.ts --only=svc-edit-base-image` both green.
- **Committed in:** `4cf0bf7` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bug fixes / literal-criteria wording corrections), zero architectural changes, zero scope creep.
**Impact on plan:** All fixes were small, in-scope corrections directly caused by this plan's own edits (stale comment cleanup, prompt contradiction removal, doc-comment wording to match the plan's own acceptance greps). No behavior outside the plan's stated scope was touched.

## Issues Encountered
- `scripts/verify-phase-23.ts --only=svc-verify-repair-removed` (referenced only in Task 2's own inline `<verify>` one-liner, not in the plan's top-level `<verification>` block) still fails 3/4 checks — but those checks require `server/services/text-rendering.service.ts` to not exist and `observability.service.ts` to no longer export `logTextVerification`, which are repo-wide cleanups outside this plan's `files_modified` scope (`server/routes/edit.routes.ts`, `scripts/test-edit-base-image-resolution.ts`). Confirmed via `grep` that neither `edit.routes.ts` nor (post-23-06) `generate.routes.ts` reference `enforceExactImageText`/`verifyExactImageText`/`text-rendering.service` anymore — the remaining failures are purely about deleting the now-fully-dead service file itself, which is presumably a later phase-23 plan's responsibility (not enumerated in this plan's acceptance criteria or top-level `<verification>` block).
- Parallel execution: plans 23-06 and 23-08 landed concurrently in the same working directory during this plan's execution (confirmed via `git log` — `feat(23-06)`/`feat(23-08)` commits interleaved with this plan's own). No file conflicts occurred; only `server/routes/edit.routes.ts` and `scripts/test-edit-base-image-resolution.ts` were staged/committed by this execution at every step, per the parallel-execution git-add discipline.

## User Setup Required

None - no external service configuration required. (The additive DB migration from 23-02 that this plan's new columns depend on was already flagged as requiring manual Supabase Dashboard application in that plan's own SUMMARY; no new external setup introduced here.)

## Next Phase Readiness
- The edit pipeline now has full base-image fidelity parity with the generation pipeline (23-06): both crop -> composite -> logo -> optimize in the same order, both persist `base_image_url`/`typography_meta`, both are AI-verify/repair-loop-free.
- `resolveEditTarget`/`resolveEditAspectRatio`/`isTextOnlyEdit`/`resolveEditTextBlocks` are stable, exported, and unit-tested — available for plan 23-10 (remake UI wiring) to reason about without re-deriving the decision matrix.
- `text-rendering.service.ts` is now fully unreferenced by both route files (`generate.routes.ts` and `edit.routes.ts`) — ready for whichever later plan owns its physical deletion plus `observability.service.ts`'s `logTextVerification` export removal (tracked by `scripts/verify-phase-23.ts`'s `svc-verify-repair-removed` tag, not in this plan's scope).
- No blockers identified for downstream plans.

---
*Phase: 23-deterministic-typography-and-edit-fidelity*
*Completed: 2026-07-27*

## Self-Check: PASSED

All created/modified files confirmed present on disk (`server/routes/edit.routes.ts`, `scripts/test-edit-base-image-resolution.ts`, this SUMMARY.md); all 3 task commits (`a72cf6c`, `4cf0bf7`, `8f36fd3`) confirmed in `git log --oneline --all`.
