---
phase: 26-fixes-and-polish
plan: 10
subsystem: testing
tags: [verification-harness, cross-plan-invariants, idempotency, logo-overlay, feedback, runbook]

# Dependency graph
requires:
  - phase: 26-01
    provides: "scripts/verify-phase-26.ts (the 9-tag Phase 26 phase gate) + check()/readSafe()/tagActive()/windowAround()/findMigrationFile() helpers + PHASE_26_TAGS array"
  - phase: 26-02
    provides: "DEFAULT_IMAGE_QUALITY = 85 + scripts/verify-webp-text-edge.ts — read by BOTH IMAGE-OPTIMIZATION CHANGES COEXIST and the unit-harness sweep"
  - phase: 26-03
    provides: "drawBlocks()'s per-block ctx.font fix + scripts/test-drawblocks-font-state.ts — read by THE COMPOSITOR CONTRACT IS UNCHANGED and the unit-harness sweep"
  - phase: 26-05
    provides: "docs/cost-reconciliation-runbook.md + scripts/reconcile-openrouter-costs.ts — read by POL-08 IS SET UP BUT GENUINELY NOT SCHEDULED"
  - phase: 26-06
    provides: "generate.routes.ts / edit.routes.ts idempotency pre-flight + supabase/migrations/20260730000000_post_versions_idempotency_key.sql — read by IDEMPOTENCY SURVIVED THE LOGO-OVERLAY RE-EDIT"
  - phase: 26-07
    provides: "applyLogoOverlayDetailed / analyzeRegionContrast reuse + the dropped bottom-right defaults + scripts/test-logo-overlay-contrast.ts — read by BOTH IMAGE-OPTIMIZATION CHANGES COEXIST and NO COVERAGE GAP IN THE LOGO PATH"
  - phase: 26-08
    provides: "posts.feedback column + PATCH /api/posts/:id/feedback + supabase/migrations/20260730000001_posts_feedback.sql — read by FEEDBACK WRITE PATH AND READ PATH ADDRESS THE SAME COLUMN"
  - phase: 26-09
    provides: "admin-quality.routes.ts's feedback select — the read half of FEEDBACK WRITE PATH AND READ PATH ADDRESS THE SAME COLUMN"
provides:
  - "scripts/verify-phase-26.ts's 9th tag, [svc-cross-plan]: idempotency-survives-logo-re-edit, both image-optimization changes coexist, no coverage gap in the logo path, feedback write/read column parity, the compositor contract unchanged by the font fix, POL-08 scheduled-not-run, a spawnSync sweep of every Phase 26 unit harness, and a spawnSync sweep of every prior-phase/CI gate"
  - "The full Phase 26 gate green at 60/60 checks across all 9 tags, zero weakened or deleted checks"
  - "The authoritative 7-step MANUAL/LIVE VERIFICATION RUNBOOK embedded at the bottom of verify-phase-26.ts (live idempotency generate + edit, adaptive JPEG logo, WebP quality/text-edge with the calibrated ratio table, feedback round trip, admin Quality dashboard + non-admin 403, no-regression sweep + POL-08 handoff)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-plan invariant tag ([svc-cross-plan]): mirrors scripts/verify-phase-23.ts's 23-11 precedent, scripts/verify-phase-24.ts's 24-07 precedent, and scripts/verify-phase-25.ts's 25-14 precedent exactly — indexOf-based ordering assertions across two-plan-owned files, a mention-vs-negated-mention count for the POL-08 self-referential-scanner guard, and a spawnSync-based proof that every Phase 26 unit harness AND every prior-phase/CI harness still exits 0 (both gated behind tagActive so an unrelated --only run stays fast)"
    - "Split a single already-drafted file edit back into two atomic task commits: wrote both Task 1 ([svc-cross-plan] checks) and Task 2 (the runbook) into the working tree before committing either, then used Edit to temporarily strip the runbook block back out, committed Task 1 alone, and re-applied the runbook via Edit for a clean, separately-committed Task 2 — preserves the plan's one-commit-per-task contract without re-deriving either block from memory twice"

key-files:
  created: []
  modified:
    - scripts/verify-phase-26.ts

key-decisions:
  - "Did not run `requirements mark-complete` for POL-03/POL-06/POL-09 (POL-02 was already marked Complete by 26-02, whose own verification was fully automated with no live-sign-off gate) and did not run `roadmap update-plan-progress` to flip Phase 26's checkbox — both would incorrectly certify the phase/requirements as done despite Task 3 being an unresolved blocking operator checkpoint. Updated STATE.md and ROADMAP.md by hand instead, mirroring the exact precedent set by 21.1 Plan 07 Task 3, 22 Plan 06 Task 3, 23 Plan 11 Task 3, 24 Plan 07 Task 3, and 25 Plan 14 Task 3."
  - "Verified all seven Task-1 invariant groups directly against the actual shipped code (read generate.routes.ts, edit.routes.ts, image-optimization.service.ts, typography-compositor.service.ts, shared/schema.ts, posts.routes.ts, admin-quality.routes.ts, post-viewer-dialog.tsx, the two Phase 26 migrations, cleanup-cron.service.ts, and .github/workflows/) before writing each check, rather than trusting prior plans' SUMMARY.md prose alone — every check passed on its first run, with zero collision-class rewrites needed this time (unlike 23-11/24-07/25-14, which each hit at least one self-referential-scanner false positive)."
  - "The runbook's step 4 (WebP quality/text-edge) numeric reference table (q40=0.9934, q85=0.9977, q95=0.9992, threshold=0.996) was transcribed verbatim from 26-02-SUMMARY.md's own calibration record, not re-measured, since scripts/verify-webp-text-edge.ts is itself the authoritative automated proof and this runbook step exists only to give the operator's visual judgment a numeric anchor, not to re-derive the threshold."

patterns-established: []

requirements-completed: []  # POL-03/06/09 remain Pending in REQUIREMENTS.md (POL-02 was already Complete before this plan ran) — this plan's own scope (9th cross-plan tag + operator sign-off) is NOT complete; Task 3 is a blocking checkpoint that was not performed. Do not treat this list as certifying any of POL-02/03/06/08/09.

# Metrics
duration: ~50min (Tasks 1-2 only; Task 3 not started)
completed: PARTIAL — Tasks 1-2 of 3 complete, 2026-07-28
---

# Phase 26 Plan 10: Cross-Plan Invariants + Live Runbook + Operator Sign-off Summary

**STATUS: PARTIAL COMPLETION — Tasks 1 and 2 are done and committed (`scripts/verify-phase-26.ts` is green at 60/60 across 9 tags with zero weakened checks, and the 7-step MANUAL/LIVE VERIFICATION RUNBOOK is embedded); Task 3 is a blocking operator checkpoint that has NOT been performed and is NOT being fabricated here.**

`scripts/verify-phase-26.ts` now carries a 9th tag, `[svc-cross-plan]`, with 7 invariant-check groups (20 individual PASS lines, since group 7's subprocess sweep emits one check per script) that no single earlier Phase 26 plan could assert alone:

1. **IDEMPOTENCY SURVIVED THE LOGO-OVERLAY RE-EDIT** (26-06 x 26-07) — in BOTH `generate.routes.ts` and `edit.routes.ts`, the idempotency pre-flight `.eq("idempotency_key"` occurs before `checkCredits(`, which occurs before `applyLogoOverlay(`, by source position. Two checks, both green.
2. **BOTH IMAGE-OPTIMIZATION CHANGES COEXIST** (26-02 x 26-07) — `image-optimization.service.ts` declares `DEFAULT_IMAGE_QUALITY = 85` AND `applyLogoOverlayDetailed` AND `analyzeRegionContrast` AND `DEFAULT_THUMBNAIL_OPTIONS` still has `quality: 70`. Green.
3. **NO COVERAGE GAP IN THE LOGO PATH** — `applyLogoOverlay`'s own signature no longer defaults `position` to `"bottom-right"`, AND neither route collapses an absent `logo_position` with `?? "bottom-right"` / `|| "bottom-right"` before calling it. Green.
4. **FEEDBACK WRITE PATH AND READ PATH ADDRESS THE SAME COLUMN** (26-08 x 26-09) — `posts.routes.ts`'s feedback handler updates `feedback`, `admin-quality.routes.ts` selects `feedback` from `posts`, `post-viewer-dialog.tsx` PATCHes `.../feedback`, and the `*_posts_feedback.sql` migration adds that column — a four-file chain. Green.
5. **THE COMPOSITOR CONTRACT IS UNCHANGED BY THE FONT FIX** (26-03) — `typography-compositor.service.ts` still declares `COMPOSITOR_VERSION = 1` and still contains the zero-text-blocks pass-through early return; `shared/schema.ts`'s `typographyMetaSchema` still lists all 8 original fields. Green.
6. **POL-08 IS SET UP BUT GENUINELY NOT SCHEDULED** — `docs/cost-reconciliation-runbook.md` and `scripts/reconcile-openrouter-costs.ts` both exist, and neither `cleanup-cron.service.ts` nor any file under `.github/workflows/` mentions "reconcile" (0 mentions in each, confirmed by direct grep, not just the mention-vs-negated-mention guard the check code carries for future-proofing). Green.
7. **SUBPROCESS SWEEPS** — the 4 Phase 26 unit harnesses (`verify-webp-text-edge.ts`, `test-drawblocks-font-state.ts`, `test-logo-overlay-contrast.ts`, `reconcile-openrouter-costs.ts`) and the 9 prior-phase/CI gates named in the plan's `<interfaces>` block (`verify-phase-21.ts`, `-21.1.ts`, `-22.ts`, `-23.ts`, `-24.ts`, `-25.ts`, `verify-golden-image.ts`, `verify-phase-12.6.ts`, `test-typography-treatment.ts`) all spawnSync and exit 0. 13 checks, all green.

The full suite is 60/60 green (up from the 40-check baseline reported at the end of 26-09; zero checks removed or downgraded). A 7-step operator runbook (live idempotency generate, live idempotency edit, adaptive JPEG logo, WebP quality/text-edge, feedback round trip, admin Quality dashboard, no-regression sweep + POL-08 handoff) is appended as a pure-insertion comment block at the bottom of the file. Task 3 — operator sign-off on that 7-step runbook — requires the real Coolify production host, the live Supabase project, real uploaded brand logos, and real paid OpenRouter generations, none of which are available in this execution environment.

## Performance

- **Duration:** ~50 min (Tasks 1-2)
- **Tasks:** 2 of 3 completed (Task 3 is a blocking checkpoint, not started)
- **Files modified:** 1 (`scripts/verify-phase-26.ts`)

## Accomplishments

- Ran the full harness before any change to establish a baseline: 40/40 checks passed across the original 8 tags (matching 26-09-SUMMARY.md's own reported state) — no implementation drift since plans 26-01..26-09 landed.
- Read the FULL, post-26-06/post-26-07 `generate.routes.ts` and `edit.routes.ts`, the FULL `image-optimization.service.ts` (post-26-02/post-26-07), the relevant sections of `typography-compositor.service.ts`, `shared/schema.ts`, `posts.routes.ts`, `admin-quality.routes.ts`, `post-viewer-dialog.tsx`, both Phase 26 migrations, `cleanup-cron.service.ts`, and `.github/workflows/` before writing a single check, per the plan's own `<read_first>` instruction.
- Added `[svc-cross-plan]` (9th tag) with the 7 invariant groups described above (20 PASS lines total).
- Confirmed grep-based acceptance criteria: `grep -c "MANUAL/LIVE VERIFICATION RUNBOOK"` = 1, `grep -c "does not block\|does not gate"` = 3 (>= 1 required), `grep -c "spawnSync"` = 6 (>= 2 required); `git diff --stat` on both task commits shows only ADDED lines (197 insertions for Task 1, 115 for Task 2, 0 deletions in either).
- Ran the full acceptance-criteria verification suite twice (once after Task 1 alone, once after Task 2's runbook was re-applied): `npx tsx scripts/verify-phase-26.ts` — 60/60, 0 failures, 9 tags, both times; `npx tsx scripts/verify-phase-26.ts --only=svc-cross-plan` — 20/20; `npx tsx scripts/verify-phase-26.ts --only=self-test` — 6/6; `npm run check` (clean); `npm run build` (clean, both client + server bundles, PWA precache, font copy).
- Appended the 7-step MANUAL/LIVE VERIFICATION RUNBOOK as a pure-insertion `//`-comment block, transcribing exact response shapes from 26-06-SUMMARY.md (`{ idempotent: true, post }` / `{ idempotent: true, version }`), the exact auto-selection tie-break order from 26-07-SUMMARY.md, the exact calibrated ratio table from 26-02-SUMMARY.md, and the exact POL-08 trigger-query/threshold language from `docs/cost-reconciliation-runbook.md` (26-05's own output) — the runbook points to that document rather than restating its procedure.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the 9th [svc-cross-plan] tag with cross-file invariants** - `0555537` (feat)
2. **Task 2: Embed the MANUAL/LIVE VERIFICATION RUNBOOK** - `e363984` (docs)

**Task 3: Operator sign-off on the live runbook** — NOT STARTED. This is a `checkpoint:human-verify` task with `gate="blocking"` requiring the real Coolify production host, the live Supabase project, real uploaded brand logos, and real paid OpenRouter generations, none available in this execution environment. See "Checkpoint Details" below.

**Plan metadata:** this commit (STATE.md/ROADMAP.md/SUMMARY.md only — Task 3 still pending, so this is NOT a phase-closure or milestone-closure commit)

## Files Created/Modified

- `scripts/verify-phase-26.ts` - Added the `[svc-cross-plan]` 9th tag (7 invariant groups, 20 PASS lines: idempotency-survives-logo-re-edit x2, image-optimization coexistence, logo-path coverage gap, feedback write/read parity, compositor contract stability, POL-08 scheduled-not-run, unit-harness sweep x4, prior-phase/CI regression sweep x9) and appended the 7-step MANUAL/LIVE VERIFICATION RUNBOOK as a pure addition below `main().catch(...)`.

## Decisions Made

See `key-decisions` in frontmatter. Two notable calls: (1) updated STATE.md and ROADMAP.md by hand rather than via `gsd-tools state advance-plan` / `roadmap update-plan-progress` / `requirements mark-complete`, because those tools infer full completion from this SUMMARY.md's mere existence and would have incorrectly marked Phase 26 100% complete (and the whole v1.6 milestone closeable) despite Task 3's unresolved blocking checkpoint; (2) split the already-drafted combined edit back into two atomic per-task commits by temporarily stripping the runbook block, committing Task 1, then re-applying the runbook for a separately-committed Task 2 — no functional content was ever re-derived from memory, only the commit boundary was corrected.

## Deviations from Plan

### Auto-fixed Issues

None. All 20 `[svc-cross-plan]` checks and both grep-based acceptance criteria passed on the first run — no collision-class rewrites (self-referential scanner, indexOf substring shadowing, header-comment collision) were needed this time, unlike 23-11/24-07/25-14, each of which hit at least one such issue.

---

**Total deviations:** 0
**Impact on plan:** None — plan executed exactly as written for Tasks 1-2.

## Issues Encountered

None beyond Task 3 being, by design, a blocking operator checkpoint this environment cannot perform.

## User Setup Required

**External/live verification required — Task 3 has NOT been performed.** See "Checkpoint Details" below for the full operator runbook (also embedded at the bottom of `scripts/verify-phase-26.ts`). Access to the live Coolify host + Supabase project, real uploaded brand logos, and real paid OpenRouter generations, are required. Both Phase 26 migrations (`supabase/migrations/20260730000000_post_versions_idempotency_key.sql`, `supabase/migrations/20260730000001_posts_feedback.sql`) must be applied to the live Supabase project before running the runbook.

## Next Phase Readiness

- All code-level POL-02/03/06/08/09 work is done and gated: `verify-phase-26.ts` 60/60 green across 9 tags (zero weakened checks), all 4 Phase 26 unit harnesses green, Phases 21/21.1/22/23/24/25 + the golden-image gate + `verify-phase-12.6.ts` + `test-typography-treatment.ts` unregressed, `npm run check` clean, `npm run build` clean.
- **Phase 26 is NOT yet closable, and the v1.6 milestone is NOT yet closable.** Task 3 (operator sign-off on the 7-step live runbook) must run before Phase 26's ROADMAP checkbox is checked and before POL-03/POL-06/POL-09 are marked Complete in REQUIREMENTS.md (POL-02 was already Complete before this plan, and POL-08 is intentionally never marked Complete — it is Scheduled/non-gating by design per 26-CONTEXT.md).
- Phase 26 is the LAST phase of the v1.6 milestone. Once Task 3's operator sign-off is recorded (all 7 steps pass), a continuation agent should: mark this file's runbook table complete, check Phase 26's ROADMAP checkbox, run `requirements mark-complete POL-03 POL-06 POL-09`, and hand off to the milestone-close workflow. Note also that the still-open checkpoints from 21.1 Plan 07 Task 3, 22 Plan 06 Task 3, 23 Plan 11 Task 3, 24 Plan 07 Task 3, and 25 Plan 14 Task 3 remain unresolved from prior phases — the v1.6 milestone cannot be considered fully shipped until ALL six blocking operator checkpoints (this one included) resolve.

---
*Phase: 26-fixes-and-polish*
*Completed: PARTIAL (Tasks 1-2 only) — 2026-07-28*

## Self-Check: PASSED

- FOUND: scripts/verify-phase-26.ts (modified, confirmed via commits `0555537` and `e363984`)
- FOUND commit: 0555537
- FOUND commit: e363984
- `npx tsx scripts/verify-phase-26.ts` exits 0, 60/60 PASS across 9 tags
- `npx tsx scripts/verify-phase-26.ts --only=svc-cross-plan` exits 0, 20/20
- `npx tsx scripts/verify-phase-26.ts --only=self-test` exits 0, 6/6
- `npm run check` exits 0
- `npm run build` succeeds
- Task 3 correctly NOT recorded as complete

## Checkpoint Details (Task 3 — not performed)

See the "CHECKPOINT REACHED" report returned to the orchestrator for the full structured checkpoint (type: human-verify, gate: blocking). Summary: the operator must run the 7-step runbook embedded at the bottom of `scripts/verify-phase-26.ts`, requiring the real Coolify production host, the live Supabase project, real uploaded brand logos, and real paid OpenRouter generations. Both Phase 26 migrations must be applied first.

1. Live idempotency — generate (POL-06): two identical `POST /api/generate` requests, same `idempotency_key` → second returns `{"idempotent": true, ...}`, no SSE; exactly 1 `posts` row and 1 `usage_events` row for that key.
2. Live idempotency — edit (POL-06): same with `POST /api/edit-post` → `{"idempotent": true, "version": {...}}`; exactly 1 `post_versions` row, `version_number` unchanged. Note: a true concurrent race still surfaces as a generic 500 — intentional, matches carousel/enhance.
3. Adaptive logo — JPEG, no alpha (POL-03): JPEG logo with solid background, `use_logo: true`, no `logo_position` → soft feathered plate, no opaque box, cleanest corner chosen. Explicit `logo_position: "bottom-right"` over a busy background → stays bottom-right (position never overridden).
4. WebP quality + text edges (POL-02): 3-block text layout, crisp glyph edges at 200% zoom, headline visibly larger than CTA (drawBlocks fix); reference ratios q40=0.9934/q85=0.9977/q95=0.9992 against threshold 0.996; storage size increase ~10-20% expected.
5. Feedback round trip (POL-09): thumbs-up → reopen shows active → thumbs-down → thumbs-down again clears; `posts.feedback` goes `up` → `down` → `null`, one row throughout.
6. Admin Quality dashboard (POL-09): `/admin/quality` tally matches step 5's votes and the raw `generation_logs` queries for `visual_critic`/`model_fallback`; 7/90-day window moves the numbers; non-admin `GET /api/admin/quality` returns 403.
7. No-regression sweep + POL-08 handoff: video/carousel/enhancement/single-image/legacy-edit all succeed unchanged; `docs/cost-reconciliation-runbook.md`'s audit log is still empty and its trigger condition unmet — recorded as scheduled/Pending by design, non-blocking.

On resume, a continuation agent should record the operator's per-step outcome in this file under a new "Manual verification (7-step runbook)" heading (a 7-row table: step / expected / observed / PASS-FAIL, per the plan's Task 3 instruction), and only then check Phase 26's ROADMAP checkbox / close the phase and run `requirements mark-complete POL-03 POL-06 POL-09` — or otherwise stop and capture the failing step verbatim per the plan's Task 3 instructions.
