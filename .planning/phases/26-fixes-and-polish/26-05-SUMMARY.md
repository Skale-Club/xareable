---
phase: 26-fixes-and-polish
plan: 05
subsystem: docs
tags: [runbook, supabase, tsx-script, cost-reconciliation, openrouter]

# Dependency graph
requires:
  - phase: 26-fixes-and-polish
    provides: "26-01's scripts/verify-phase-26.ts [svc-cost-reconciliation-runbook] tag group (4 honestly-red checks naming this plan's two artifacts)"
provides:
  - "docs/cost-reconciliation-runbook.md — the authoritative, dated POL-08 audit procedure (source-of-truth table, computable trigger, 5% threshold, 6-step procedure, benign-delta guidance, empty audit log)"
  - "scripts/reconcile-openrouter-costs.ts — operator-run, credential-gated usage_events cost summary (by day / by model / grand total), unscheduled anywhere"
affects: [26-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Manual audit-aid tsx script convention: exits 0 (never throws, never exits non-zero) on missing Supabase credentials, mirroring scripts/verify-critic-live.ts's no-key SKIP path rather than scripts/verify-cron-jobs.ts's hard-fail path — deliberate, since this script's job is a sandbox-safe scaffold, not a CI gate"
    - "Runbook convention mirrored from docs/production-cron.md: dated header, numbered copy-pasteable procedure, exact file/function references, an explicit 'who runs this and when' section, lives forever in the repo"

key-files:
  created:
    - docs/cost-reconciliation-runbook.md
    - scripts/reconcile-openrouter-costs.ts
  modified:
    - .planning/REQUIREMENTS.md

key-decisions:
  - "POL-08 deliberately left Pending in REQUIREMENTS.md/SUMMARY.md's requirements-completed — this plan schedules the audit, it does not run or close it, per 26-CONTEXT.md and the plan's own verification step 5"
  - "reconcile-openrouter-costs.ts queries usage_events ONLY (never generation_logs) and is never imported by server/, never registered in cleanup-cron.service.ts, and never referenced in .github/workflows/ — confirmed by grep, not just by omission"
  - "No dotenv.config() added to the scaffold script — it reads process.env directly (mirrors verify-critic-live.ts's explicit-env-export convention), so it never silently attempts a live query against this sandbox's real .env-configured Supabase project during automated verification"

requirements-completed: []

# Metrics
duration: ~20min
completed: 2026-07-28
---

# Phase 26 Plan 05: Cost Reconciliation Runbook + Scaffold Summary

**POL-08 scheduled (not run): a dated runbook naming `usage_events.cost_usd_micros` as the sole source of truth, a 5% discrepancy threshold, a computable trigger date, and an operator-run `reconcile-openrouter-costs.ts` scaffold that safely no-ops without Supabase credentials.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-28
- **Tasks:** 2/2
- **Files modified:** 3 (2 created, 1 corrected)

## Accomplishments

- `scripts/reconcile-openrouter-costs.ts` (283 lines) — CLI `--from=YYYY-MM-DD --to=YYYY-MM-DD` (regex-parsed, plain `process.argv`, no argument-parsing dependency), defaulting to the previous full calendar UTC month when omitted. Pages `usage_events` in blocks of 1000 via `.range()`, aggregating in-process into three plain-`console.log` tables (by day with an implied markup ratio, by model preferring `image_model` over `text_model` bucketing nulls as `(unknown)`, and a grand total), followed by a `NEXT STEP` block that tells the operator exactly what this script cannot do (fetch the OpenRouter dashboard side) and points them at the runbook's threshold.
- `docs/cost-reconciliation-runbook.md` (110 lines) — mirrors `docs/production-cron.md`'s dated-runbook convention: a source-of-truth table (`usage_events.cost_usd_micros` primary, `generation_logs` investigation-only), a computable trigger-date SQL query plus a 30-day-after-full-OpenRouter-cutover rule and quarterly cadence thereafter, a numbered 6-step procedure with three verbatim `generation_logs` investigation queries (visual-critic re-roll cost sum, model-fallback count by call class, per-day `usage_events` vs `generation_logs` count), a 5% material-discrepancy threshold with its rounding/timing-skew justification, four named benign-delta sources (critic re-roll cost, fallback-model rate mismatch, affiliate BYOK's own-account billing, day-boundary UTC skew), and an empty audit log table.
- Both artifacts cross-reference each other by exact filename/invocation as required by the plan's `key_links`.
- Corrected a pre-existing inconsistency in `.planning/REQUIREMENTS.md`: POL-08 was left marked `[x]`/"Complete" by plan 26-01's execution (its frontmatter incorrectly listed POL-08 among requirements it "completed" by installing an honestly-red harness check) — reverted to `[ ]`/"Scheduled (non-gating)" to match this plan's own explicit, unambiguous intent.

## Task Commits

1. **Task 1: scripts/reconcile-openrouter-costs.ts** - `96150f5` (feat)
2. **Task 2: docs/cost-reconciliation-runbook.md** - `5068aea` (docs)
3. **Deviation fix: revert POL-08's premature Complete mark** - `dab09ab` (fix)

_Plan metadata commit follows this summary._

## Files Created/Modified

- `scripts/reconcile-openrouter-costs.ts` - operator-run `usage_events` cost summary; sandbox-safe (exits 0 with no credentials), unscheduled anywhere
- `docs/cost-reconciliation-runbook.md` - the authoritative POL-08 audit procedure, schedule, threshold, and owner
- `.planning/REQUIREMENTS.md` - POL-08 checkbox + traceability row reverted from an incorrect "Complete" to the accurate "Scheduled (non-gating)"

## Decisions Made

- Used an exclusive upper-bound query (`.lt("created_at", toExclusiveIso)`, computed as the day after `--to`) rather than a literal `.lte(toDate)` string comparison, so a timestamp landing anywhere within the inclusive `--to` calendar day is captured correctly — the plan text named the variable `toExclusiveEnd` but showed `.lte`; implemented the semantically correct version matching the variable's own name and the "inclusive ISO dates" requirement.
- Did not add a `docs/README.md` pointer for the new runbook: that index only catalogs the `generation/` and `integrations/` subfolders, and does not list any of the repo's other existing top-level singleton docs either (`production-cron.md`, `deployment-hetzner.md`, `performance-optimizations.md`, `e2e-validation.md` are all absent from it too) — per the plan's own instruction to skip rather than invent a section, this matches existing precedent exactly.
- Left `requirements-completed: []` in this summary's frontmatter rather than listing POL-08, and did not run `requirements mark-complete POL-08` during state updates — both would restate the exact premature-completion bug this plan's Deviation fix just reverted. POL-08 is intentionally not closed by this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reverted POL-08's incorrect "Complete" status in REQUIREMENTS.md**
- **Found during:** Post-Task-2 verification (checking the plan's own `<verification>` item 5: "POL-08 remains marked Pending in REQUIREMENTS.md")
- **Issue:** `.planning/REQUIREMENTS.md` already showed POL-08 as `[x]` / "Complete" — traced to plan 26-01's execution, whose PLAN.md frontmatter listed `requirements: [POL-02, POL-03, POL-06, POL-08, POL-09]` (the 5 tags whose harness checks it installed) and whose SUMMARY.md accordingly listed the same 5 IDs under `requirements-completed`, which the standard `state advance-plan`/`requirements mark-complete` workflow step then marked Complete — even though 26-01 only installed honestly-RED checks for POL-08, not an actual completed audit. This directly contradicted 26-CONTEXT.md's explicit non-gating design and this plan's own verification checklist.
- **Fix:** Reverted the checkbox to `[ ]` and the traceability-table status to "Scheduled (non-gating) — runbook + scaffold set up in 26-05, audit runs post-ship". Left POL-02/03/06/09's same-bug entries untouched — those are sibling plans' (26-02/26-03/26-04/26-08/26-09) in-flight scope in this same wave, not mine to adjudicate.
- **Files modified:** `.planning/REQUIREMENTS.md`
- **Verification:** `git diff` on the commit shows exactly 2 lines changed (the POL-08 checkbox and its traceability row), nothing else.
- **Committed in:** `dab09ab`

---

**Total deviations:** 1 auto-fixed (1 bug — correcting a prior plan's incorrect requirement-completion marking)
**Impact on plan:** Necessary to keep REQUIREMENTS.md honest about POL-08's real, deliberately-unclosed state. No scope creep — touched only POL-08's own two lines.

## Issues Encountered

**Cross-agent git race (self-corrected):** While committing Task 2 as one of four parallel executors sharing this working directory, a sibling agent's `git add`'d file (`server/services/image-optimization.service.ts`, belonging to plan 26-02's in-flight work) landed in the git index between this plan's own `git add docs/cost-reconciliation-runbook.md` and the immediately following `git commit`, and was swept into that commit. Caught immediately by post-commit `git show --stat` inspection (not part of the standard protocol, added as an extra safety check here given the parallel-execution warning). Corrected via `git reset --soft HEAD~1` (undo the commit, keep the index), `git reset HEAD -- server/services/image-optimization.service.ts` (unstage only the foreign file, restoring it to the same unstaged-modified state the sibling agent had left it in), then re-committing with only this plan's own file staged. Verified the corrected commit (`5068aea`) contains exactly 1 file / 110 insertions. No sibling agent's work was lost or altered — their file's content was never touched, only its staging state was corrected.

## User Setup Required

None - no external service configuration required. `scripts/reconcile-openrouter-costs.ts` requires `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` to be exported in the shell (not `.env`-loaded) when an operator eventually runs the real audit — documented in the runbook's Procedure step 1.

## Next Phase Readiness

- `docs/cost-reconciliation-runbook.md` and `scripts/reconcile-openrouter-costs.ts` are both complete, cross-referenced, and ready for an operator to use once the trigger condition (Procedure section) is met — no further Phase 26 work depends on this plan.
- `scripts/verify-phase-26.ts --only=svc-cost-reconciliation-runbook` is 4/4 green; the tag's contribution to the full-suite count is now accounted for ahead of plan 26-10's cross-plan closure.
- POL-08 stays honestly Pending in REQUIREMENTS.md, matching ROADMAP's own non-gating callout — plan 26-10 (or a future post-ship session) is the one that will eventually run the audit and close it, not this plan.
- Zero regression risk: this plan touched no production source file (only `scripts/` and `docs/`, plus the one-line-scoped REQUIREMENTS.md fix); `npm run check` clean.

---
*Phase: 26-fixes-and-polish*
*Completed: 2026-07-28*

## Self-Check: PASSED

All claimed files found on disk (`docs/cost-reconciliation-runbook.md`, `scripts/reconcile-openrouter-costs.ts`, this SUMMARY.md). All claimed commits (`96150f5`, `5068aea`, `dab09ab`) found in `git log --oneline --all`.
