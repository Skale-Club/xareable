---
phase: 23-deterministic-typography-and-edit-fidelity
plan: 11
subsystem: testing
tags: [verification-harness, cross-plan-invariants, docker, runbook, typography]

# Dependency graph
requires:
  - phase: 23-05
    provides: "gemini.service.ts's four TYPO-01 text-free prompt channels (buildNegativeSpaceInstruction/buildTextFidelityInstruction/buildTextStyleCopyInstruction)"
  - phase: 23-06
    provides: "generate.routes.ts's crop -> typography -> logo -> optimize pipeline + base_image_url/typography_meta/generation_params persistence"
  - phase: 23-07
    provides: "edit.routes.ts's base-image edit target resolution, LEGACY (base_image_url IS NULL) branch, and the TYPO-07 text-only compositor fast path"
  - phase: 23-08
    provides: "verify-golden-image.ts + Dockerfile fontconfig/fc-cache/AVX gates"
  - phase: 23-09
    provides: "text-rendering.service.ts deletion (TYPO-06) — the AI verify/repair loop is fully gone"
  - phase: 23-10
    provides: "remake UI wiring (post-edit-dialog Format & Logo step, quick-remake generation_params forwarding, text_only signal)"
provides:
  - "scripts/verify-phase-23.ts's 13th tag, [svc-cross-plan]: 4 invariant checks spanning files no single plan owns (pipeline order in both routes, no-coverage-gap between compositor and deleted repair loop, legacy branch real reachability, prior-phase non-regression via spawnSync)"
  - "The full Phase 23 gate green at 80/80 checks across all 13 tags, zero weakened or deleted checks"
  - "The authoritative 7-step MANUAL/LIVE VERIFICATION RUNBOOK embedded at the bottom of verify-phase-23.ts (migration application, Alpine/AVX smoke, in-container golden image, live generate, live edit ghosting, text-only fast path + remake fidelity, legacy + video regression)"
affects: [24, 25, 26]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-plan invariant tag ([svc-cross-plan]): a dedicated tag for assertions that intentionally span multiple files/plans (pipeline byte-offset ordering across two route files, absence-of-a-deleted-service AND presence-of-its-replacement checked together, prior-phase harnesses spawned via spawnSync and gated behind --only via tagActive()) — distinct from the per-plan tags that only ever read one plan's own files"
    - "indexOf-based pipeline-order assertion needs a starting offset when an earlier, unrelated branch reuses the same function name — a bare first-occurrence indexOf() can silently collide with an earlier call in a sibling code branch (video branch calling processImageWithThumbnail before the image branch's real pipeline step); search forward from the last confirmed marker instead of from position 0"

key-files:
  created: []
  modified:
    - scripts/verify-phase-23.ts

key-decisions:
  - "Fixed a substring collision in the plan's own literal generate.routes.ts pipeline-order snippet: indexOf(\"processImageWithThumbnail(\") found the VIDEO branch's earlier, unrelated reference-image-thumbnail call (line 641) instead of the real image-pipeline optimize step (line 730), because the video branch appears earlier in file order despite running on a different content_type. Fixed by searching for the optimize marker starting FROM the logo-overlay position rather than from 0 — makes the assertion exact, not weakened (documented inline + here per the plan's Rule for check-regex fixes)."
  - "Did not run `state advance-plan`/`roadmap update-plan-progress` for this plan — both tools infer full completion from this SUMMARY.md's mere existence, which would incorrectly flip Phase 23 to 100% (11/11) and 'ready for verification' despite Task 3 being an unresolved blocking operator checkpoint. Updated STATE.md and ROADMAP.md by hand instead, mirroring the precedent set in Phase 21.1 Plan 07 Task 3 and Phase 22 Plan 06 Task 3."

patterns-established: []

requirements-completed: []  # TYPO-01..07/POL-04/POL-05 were already marked Complete in REQUIREMENTS.md by prior plans (23-01..23-10) delivering the static implementation; this plan's OWN scope (full-gate cross-plan proof + operator sign-off) is NOT complete — Task 3 is a blocking checkpoint that was not performed. Do not treat this list as re-certifying those IDs via live proof.

# Metrics
duration: ~20min (Tasks 1-2 only; Task 3 not started)
completed: PARTIAL — Tasks 1-2 of 3 complete, 2026-07-27
---

# Phase 23 Plan 11: Full Harness Green + Cross-Plan Invariants + Live/Alpine Runbook Summary

**STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (verify-phase-23.ts is green at 80/80 across 13 tags with zero weakened checks, and the 7-step MANUAL/LIVE VERIFICATION RUNBOOK is embedded); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.**

`scripts/verify-phase-23.ts` now carries a 13th tag, `[svc-cross-plan]`, with 4 invariant checks that no single earlier plan could assert alone: pipeline order in BOTH `generate.routes.ts` and `edit.routes.ts` (crop → typography/composite → logo → optimize, verified by byte-offset comparison), the simultaneous "compositor is wired AND the repair loop is gone" no-coverage-gap property, the legacy (`base_image_url IS NULL`) branch's real reachability (guard-count + ordering), and a spawnSync-based proof that none of Phases 16/21/21.1/22's harnesses regressed. The full suite is 80/80 green (up from 72/72 before this plan, zero checks removed or downgraded). A 7-step operator runbook (migration application, Alpine/AVX smoke referencing the open Brooooooklyn/canvas#1117 issue, in-container golden-image glyph coverage, live generate, live edit ghosting, the text-only fast path + remake fidelity, and the legacy/video regressions) is appended as a pure-insertion comment block at the bottom of the file. Task 3 — operator sign-off on that 7-step runbook — requires the real Coolify/Hetzner Alpine production host, the live Supabase project, and real paid AI calls, none of which are available in this execution environment.

## Performance

- **Duration:** ~20 min (Tasks 1-2)
- **Tasks:** 2 of 3 completed (Task 3 is a blocking checkpoint, not started)
- **Files modified:** 1 (`scripts/verify-phase-23.ts`)

## Accomplishments
- Ran the full harness BEFORE any change to establish a baseline: 72/72 checks passed, zero failures across the original 12 tags — no implementation drift since plans 23-01..23-10 landed.
- Added `[svc-cross-plan]` (13th tag) with 4 checks:
  a) **Pipeline order** — `generate.routes.ts`: `cropToExactAspectRatio(` → `compositeTypography(` → `applyLogoOverlay(` → `processImageWithThumbnail(`, verified by byte-offset comparison; `edit.routes.ts`: crop → composite → optimize with logo overlay confirmed after composite.
  b) **No double-render surface** — `compositeTypography(` present in `generate.routes.ts` AND `server/services/text-rendering.service.ts` does not exist AND `enforceExactImageText` absent from both routes, asserted simultaneously (the exact condition the TYPO-06 sequencing rule protects).
  c) **Legacy safety** — `edit.routes.ts` contains `isBaseImage: false`, the `LEGACY (base_image_url IS NULL)` marker, `editTarget.isBaseImage` referenced >=3 times, and its first reference precedes both `cropToExactAspectRatio(` and `compositeTypography(` (proving the legacy branch actually guards those calls rather than running them unconditionally).
  d) **No prior-phase regression** — `scripts/verify-phase-16.ts`, `-21.ts`, `-21.1.ts`, `-22.ts` spawned via `spawnSync` and asserted to exit 0, gated behind `tagActive("svc-cross-plan")` so an unrelated `--only` run stays fast.
- Found and fixed one substring collision in the plan's own literal code snippet: a bare `indexOf("processImageWithThumbnail(")` in the `generate.routes.ts` pipeline-order check matched the VIDEO branch's earlier, unrelated reference-image-thumbnail call (line 641) instead of the real image-pipeline optimize step (line 730) — because the video branch's code appears earlier in file order even though it runs on a different `content_type`. Fixed by searching for the marker starting from the logo-overlay position instead of from 0; the assertion is now exact, not weakened.
- Updated the `[self-test]` tag-literal list and its assertion text from "12" to "13" tags; updated the file's ownership header comment to note 23-11 has now landed the 13th tag.
- Appended the 7-step MANUAL/LIVE VERIFICATION RUNBOOK as a pure-insertion `//`-comment block (`git diff --stat` for that commit: 84 insertions, 0 deletions) covering: (1) migration application via Supabase SQL editor with a column-count verification query; (2) the Alpine/AVX smoke check referencing the open `Brooooooklyn/canvas#1117` issue, both a full `docker build` and an in-container `require('@napi-rs/canvas')` check on the real production host; (3) the golden-image test run inside the actual Docker `builder` target (not a developer's non-Alpine machine), confirming crisp `PROMOÇÃO RELÂMPAGO`/`¡OFERTA DEL DÍA!` with zero tofu boxes; (4) a live generate with `use_text=true`/`text_mode="exact"`/`aspect_ratio="1200:628"`, checking exact ratio, correct text, all three persistence columns populated, and zero `text_verification` rows in `generation_logs`; (5) a live edit checking for exactly one set of crisp text (no ghosting); (6) the text-only fast path + Quick Remake fidelity check; (7) a legacy (`base_image_url IS NULL`) post regression plus one video post regression (GATE-08).
- Ran the full acceptance-criteria verification suite: `npx tsx scripts/verify-phase-23.ts` (80/80, 0 failures), `npx tsx scripts/verify-golden-image.ts` (22/22), `npx tsx scripts/test-aspect-crop.ts` (22/22), `npx tsx scripts/test-edit-base-image-resolution.ts` (20/20), `npx tsx scripts/verify-phase-06.ts` (7/7), `npx tsx scripts/verify-phase-12.6.ts` (7/7, skipped 0), `npx tsx scripts/verify-phase-16.ts`, `verify-phase-21.ts`, `verify-phase-21.1.ts`, `verify-phase-22.ts` (all exit 0, also independently re-proven via the new `[svc-cross-plan]` spawnSync checks), `npm run check` (clean), `npm run build` (clean, both client + server bundles).
- Confirmed grep-based acceptance criteria: `grep -c '\[svc-cross-plan\]'` = 8 (>=5 required); `grep -c 'check('` = 84 before-vs-after comparison shows growth from 79 to 84 (checks added, never removed); `grep -cE 'check\([^,]+,\s*true\s*[,)]'` = 1 (only `[self-test] harness executes`); `grep -c 'MANUAL/LIVE VERIFICATION RUNBOOK'` = 1; `grep -c '1117'` = 1; `grep -c 'PROMOÇÃO'` = 1; `grep -c 'text_verification'` = 3; `grep -c 'base_image_url is null'` = 1 (lowercase, matching the runbook's literal SQL).

## Task Commits

Each task was committed atomically:

1. **Task 1: Full gate green + three cross-plan invariant checks** - `2f0ffa3` (feat)
2. **Task 2: Embed the MANUAL/LIVE VERIFICATION RUNBOOK** - `4119d75` (docs)

**Task 3: Operator sign-off on the live/Alpine runbook** — NOT STARTED. This is a `checkpoint:human-verify` task with `gate="blocking"` requiring the real Coolify/Hetzner Alpine production host, the live Supabase project, and real paid AI calls, none available in this execution environment. See "Checkpoint Details" below.

**Plan metadata:** this commit (STATE.md/ROADMAP.md/SUMMARY.md only — Task 3 still pending, so this is NOT a phase-closure commit)

## Files Created/Modified
- `scripts/verify-phase-23.ts` - Added the `[svc-cross-plan]` 13th tag (4 checks: pipeline order x2, no-double-render, legacy safety, prior-phase regression via spawnSync), fixed a substring collision in the generate.routes.ts pipeline-order check, updated the self-test tag count from 12 to 13, and appended the 7-step MANUAL/LIVE VERIFICATION RUNBOOK as a pure addition.

## Decisions Made

See `key-decisions` in frontmatter. Two notable calls: (1) fixed a real substring collision in the plan's own literal `indexOf` snippet (the video branch's earlier `processImageWithThumbnail(` call was shadowing the real image-pipeline occurrence) by searching forward from the logo-overlay marker instead of from 0 — this makes the check MORE precise per the plan's own instruction ("fix the regex to be MORE precise, never less"), not a weakening; (2) updated STATE.md and ROADMAP.md by hand rather than via `gsd-tools state advance-plan` / `roadmap update-plan-progress`, because both tools infer full completion from SUMMARY.md's mere existence and would have incorrectly marked Phase 23 100% complete despite Task 3's unresolved blocking checkpoint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, check-regex precision] Fixed a substring collision in the generate.routes.ts pipeline-order invariant**
- **Found during:** Task 1, first run of the newly-added `[svc-cross-plan]` check group
- **Issue:** The plan's own literal snippet used a bare `generateRouteSrc.indexOf("processImageWithThumbnail(")`. `generate.routes.ts`'s VIDEO branch calls `processImageWithThumbnail(firstRefBuffer)` at line 641 (generating a thumbnail from a reference image) — earlier in file order than the IMAGE branch's real crop→typography→logo→optimize sequence (crop at 661, typography at 686, logo at 704, the real optimize call at 730), even though the two branches are mutually exclusive at runtime (gated on `content_type`). A first-occurrence `indexOf` found the video branch's call and incorrectly reported the optimize step happening BEFORE the logo overlay.
- **Fix:** Changed `const o = generateRouteSrc.indexOf("processImageWithThumbnail(")` to `const o = l > -1 ? generateRouteSrc.indexOf("processImageWithThumbnail(", l) : -1` — searching forward from the logo-overlay position so the marker found is guaranteed to be the real image-pipeline occurrence, not the earlier video-branch call. Documented inline with a `NOTE (deviation, see 23-11-SUMMARY.md)` comment.
- **Before regex/logic:** `generateRouteSrc.indexOf("processImageWithThumbnail(")`
- **After regex/logic:** `l > -1 ? generateRouteSrc.indexOf("processImageWithThumbnail(", l) : -1`
- **Justification:** The fix makes the assertion MORE precise (correctly locates the intended call site instead of an unrelated same-named call in a different branch), not less strict — the check still requires all four markers to exist and to be in the correct relative order.
- **Files modified:** `scripts/verify-phase-23.ts`
- **Verification:** `npx tsx scripts/verify-phase-23.ts --only=svc-cross-plan` — all 8 checks pass; full suite 80/80.
- **Committed in:** `2f0ffa3` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — check-regex precision fix, not an implementation bug). Zero weakened checks; zero checks removed. `check(` count grew from 79 (baseline) to 84 (post-Task-1).
**Impact on plan:** The fix is confined to the harness's own assertion logic (not application code) and makes it strictly more accurate. No scope creep.

## Issues Encountered

None beyond the substring collision documented above (caught and fixed on the first run of the new check group, before it was ever committed as a false negative).

## User Setup Required

**External/live verification required — Task 3 has NOT been performed.** See "Checkpoint Details" below for the full operator runbook (also embedded at the bottom of `scripts/verify-phase-23.ts`).

## Next Phase Readiness

- All code-level TYPO-01..07/POL-04/POL-05 work is done and gated: `verify-phase-23.ts` 80/80 green across 13 tags (zero weakened checks), `verify-golden-image.ts`/`test-aspect-crop.ts`/`test-edit-base-image-resolution.ts` all green, Phases 06/12.6/16/21/21.1/22 unregressed, `npm run check` clean, `npm run build` clean.
- **Phase 23 is NOT yet closable.** Task 3 (operator sign-off on the 7-step live runbook) must run before Phase 23's ROADMAP checkbox is checked. Per the plan's own instruction, TYPO-01..07/POL-04/POL-05 are NOT being additionally re-certified via live proof by this plan — their existing "Complete" status in REQUIREMENTS.md reflects prior plans' (23-01..23-10) legitimate static-delivery completion, not this plan's live-verification scope.
- Downstream Phase 24 (Visual Critic & Re-roll) and Phase 25 (Narrative Carousels & Aesthetic DNA) both depend on Phase 23's static delivery (already complete and green) — their planning is not blocked by Task 3's pending status, but the v1.6 milestone cannot be considered fully shipped until it, plus the still-open Phase 21.1 Plan 07 Task 3 and Phase 22 Plan 06 Task 3 checkpoints, all resolve.

---
*Phase: 23-deterministic-typography-and-edit-fidelity*
*Completed: PARTIAL (Tasks 1-2 only) — 2026-07-27*

## Self-Check: PASSED

- FOUND: scripts/verify-phase-23.ts (modified, confirmed via `git show --stat` on commits `2f0ffa3` and `4119d75`)
- FOUND commit: 2f0ffa3
- FOUND commit: 4119d75
- `npx tsx scripts/verify-phase-23.ts` exits 0, 80/80 PASS across 13 tags
- `npx tsx scripts/verify-golden-image.ts` exits 0 (22/22)
- `npx tsx scripts/test-aspect-crop.ts` exits 0 (22/22)
- `npx tsx scripts/test-edit-base-image-resolution.ts` exits 0 (20/20)
- `npx tsx scripts/verify-phase-06.ts` exits 0 (7/7)
- `npx tsx scripts/verify-phase-12.6.ts` exits 0 (7/7, skipped 0)
- `npx tsx scripts/verify-phase-16.ts` / `verify-phase-21.ts` / `verify-phase-21.1.ts` / `verify-phase-22.ts` all exit 0 (also re-proven via `[svc-cross-plan]`'s own spawnSync checks)
- `npm run check` exits 0
- `npm run build` succeeds
- Task 3 correctly NOT recorded as complete

## Checkpoint Details (Task 3 — not performed)

See the "CHECKPOINT REACHED" report returned to the orchestrator for the full structured checkpoint (type: human-verify, gate: blocking). Summary: the operator must run the 7-step runbook embedded at the bottom of `scripts/verify-phase-23.ts`, requiring the real Coolify/Hetzner Alpine production host, the live Supabase project, and real paid AI calls: (1) apply the migration via the Supabase SQL editor and confirm 3 new columns on `posts` + 2 on `post_versions`; (2) `docker build -t xareable:phase23 .` succeeds, then `docker exec <prod container> node -e "require('@napi-rs/canvas');console.log('AVX OK')"` prints `AVX OK`; (3) build the `builder` target and run `verify-golden-image.ts` inside the real Alpine container, confirming zero tofu boxes on pt-BR/es accented text; (4) a live generate with `use_text=true`/`text_mode="exact"`/`aspect_ratio="1200:628"`, confirming exact ratio, crisp correct text, all three persistence columns populated, and zero `text_verification` rows in `generation_logs`; (5) a live edit with a visual-concept change, confirming exactly one set of crisp text (no ghosting); (6) a text-only edit confirming the fast path (no AI image call) and correct pre-filled Format & Logo controls, plus a Quick Remake still returning 1200:628; (7) a legacy (pre-migration) post edit confirming no lockout and no double text, plus one video post edit confirming the GATE-08-frozen path still works. On resume, a continuation agent should record the operator's per-step outcome in this file under a new "Manual verification (7-step runbook)" heading, and only then mark Phase 23's ROADMAP checkbox / close the phase — or otherwise stop and capture the failure verbatim per the plan's Task 3 instructions.
