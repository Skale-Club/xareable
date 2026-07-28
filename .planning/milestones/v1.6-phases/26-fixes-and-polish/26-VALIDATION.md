---
phase: 26
slug: fixes-and-polish
status: planned
nyquist_compliant: true
wave_0_complete: false  # 26-01 delivers it
created: 2026-07-28
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (no jest/vitest) — bespoke `scripts/verify-phase-NN.ts` static + functional harness, following `verify-phase-25.ts`'s exact pattern |
| **Config file** | none — Wave 0 installs `scripts/verify-phase-26.ts` |
| **Quick run command** | `npx tsx scripts/verify-phase-26.ts --only=<tag>` |
| **Full suite command** | `npx tsx scripts/verify-phase-26.ts && npm run check` |
| **Estimated runtime** | ~10 seconds |

CI (`.github/workflows/build-deploy.yml`'s `verify` job) runs `npm run check` → `verify-golden-image.ts` → gitleaks. It does NOT run `verify-phase-N.ts` scripts (those are execution-time gates). The drawBlocks font fix and WebP quality change must stay compatible with `verify-golden-image.ts` since that one IS CI-wired.

---

## Sampling Rate

- **After every task commit:** the specific new tag(s) that task's plan added
- **After every plan wave:** full `npx tsx scripts/verify-phase-26.ts` + `npx tsx scripts/verify-golden-image.ts` + `npm run check`
- **Phase gate:** full suite green + zero-regression sweep of `verify-phase-21.ts`/`-21.1.ts`/`-22.ts`/`-23.ts`/`-24.ts`/`-25.ts`, before `/gsd:verify-work`

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 26-01 T1 | 26-01 | 1 | all (POL-03 fixtures) | fixture generator (idempotent) | `npx tsx tests/fixtures/logo/make-logo-fixtures.ts && git status --porcelain tests/fixtures/logo` | ✅ this plan | ⬜ pending |
| 26-01 T2 | 26-01 | 1 | all | static harness (Wave 0) | `npx tsx scripts/verify-phase-26.ts --only=self-test` | ✅ this plan | ⬜ pending |
| 26-01 T3 | 26-01 | 1 | all | static harness (Wave 0) | `npx tsx scripts/verify-phase-26.ts --only=self-test && npm run check` | ✅ this plan | ⬜ pending |
| 26-02 T1 | 26-02 | 2 | POL-02 | functional (fixture, TDD RED) | `npx tsx scripts/verify-webp-text-edge.ts` | ✅ 26-01 | ⬜ pending |
| 26-02 T2 | 26-02 | 2 | POL-02 | static + functional | `npx tsx scripts/verify-phase-26.ts --only=svc-webp-quality && npx tsx scripts/verify-phase-26.ts --only=svc-webp-edge-check && npx tsx scripts/verify-golden-image.ts` | ✅ 26-01 | ⬜ pending |
| 26-03 T1 | 26-03 | 2 | (bugfix) | functional (fixture, TDD RED) | `npx tsx scripts/test-drawblocks-font-state.ts` | ✅ 26-01 | ⬜ pending |
| 26-03 T2 | 26-03 | 2 | (bugfix) | functional + regression sweep | `npx tsx scripts/verify-phase-26.ts --only=svc-drawblocks-font-fix && npx tsx scripts/verify-golden-image.ts && npx tsx scripts/test-typography-treatment.ts && npx tsx scripts/verify-phase-23.ts` | ✅ 26-01 | ⬜ pending |
| 26-04 T1 | 26-04 | 2 | POL-06 (client) | type check | `npm run check` | n/a | ⬜ pending |
| 26-04 T2 | 26-04 | 2 | POL-06 (client) | type check + build | `npm run check && npm run build` | n/a | ⬜ pending |
| 26-05 T1 | 26-05 | 2 | POL-08 | runtime smoke (no creds) | `npx tsx scripts/reconcile-openrouter-costs.ts --from=2026-01-01 --to=2026-01-31 && npm run check` | ✅ this plan | ⬜ pending |
| 26-05 T2 | 26-05 | 2 | POL-08 | static (runbook content) | `npx tsx scripts/verify-phase-26.ts --only=svc-cost-reconciliation-runbook` | ✅ 26-01 | ⬜ pending |
| 26-06 T1 | 26-06 | 3 | POL-06 (server) | type check + build | `npm run check && npm run build` | n/a | ⬜ pending |
| 26-06 T2 | 26-06 | 3 | POL-06 (server) | static (route ordering) | `npx tsx scripts/verify-phase-26.ts --only=svc-idempotency && npm run check && npm run build` | ✅ 26-01 | ⬜ pending |
| 26-07 T1 | 26-07 | 4 | POL-03 | functional (fixture, TDD) | `npx tsx scripts/test-logo-overlay-contrast.ts && npm run check` | ✅ 26-01 | ⬜ pending |
| 26-07 T2 | 26-07 | 4 | POL-03 | static (call sites) | `npx tsx scripts/verify-phase-26.ts --only=svc-logo-contrast && npm run check && npm run build` | ✅ 26-01 | ⬜ pending |
| 26-08 T1 | 26-08 | 4 | POL-09 | static + type check | `npm run check` | ✅ 26-01 | ⬜ pending |
| 26-08 T2 | 26-08 | 4 | POL-09 | type check + build | `npm run check && npm run build` | n/a | ⬜ pending |
| 26-09 T1 | 26-09 | 5 | POL-09 | type check + build | `npm run check && npm run build` | n/a | ⬜ pending |
| 26-09 T2 | 26-09 | 5 | POL-09 | static (route + UI wiring) | `npx tsx scripts/verify-phase-26.ts --only=svc-quality-dashboard && npm run check && npm run build` | ✅ 26-01 | ⬜ pending |
| 26-10 T1 | 26-10 | 6 | all | full suite + cross-plan sweep | `npx tsx scripts/verify-phase-26.ts && npm run check` | ✅ 26-01 | ⬜ pending |
| 26-10 T2 | 26-10 | 6 | all | full suite (runbook is a comment) | `npx tsx scripts/verify-phase-26.ts && npm run check` | ✅ 26-01 | ⬜ pending |
| 26-10 T3 | 26-10 | 6 | all | **checkpoint:human-verify** (blocking) | `npx tsx scripts/verify-phase-26.ts` + the embedded 7-step live runbook | ✅ 26-01 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-26.ts` — new harness, ~7 tags (self-test + one per POL-02/03/06/08/09 + drawBlocks bugfix), mirrors `verify-phase-25.ts`'s exact structural precedent
- [ ] A no-alpha JPEG logo fixture + an alpha-transparent PNG logo fixture under `tests/fixtures/` — none currently exist, needed for POL-03's functional tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live idempotency duplicate-request proof | POL-06 | Requires real Supabase + real network to prove a genuine duplicate request returns the existing post/version, not a new one, with no double charge | Submit two identical `/api/generate` (and `/api/edit-post`) requests with the same `idempotency_key`; confirm only one post/version row and one usage_event exist. |
| Thumbs-up/down UI interaction | POL-09 | Requires real UI interaction to confirm the feedback control works and persists | As a user, thumbs-up then thumbs-down the same post; confirm the vote overwrites rather than duplicates. |
| Admin Quality dashboard visual check | POL-09 | Static checks confirm the route/query shape but not visual correctness | View the admin Quality tab; confirm feedback tally + critic/fallback rates render sensibly against real data. |
| Adaptive logo overlay visual check | POL-03 | Static/functional checks confirm the mechanism but not visual quality | Generate posts with a no-alpha JPEG logo and a low-contrast background; visually confirm no opaque box and a sensible plate/shadow treatment. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (21/21 tasks across 10 plans)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — every task has one
- [x] Wave 0 covers all MISSING references (26-01 delivers `scripts/verify-phase-26.ts` + 3 logo fixtures; the 3 unit harnesses it spawnSyncs are owned by 26-02/26-03/26-07 and are RED until then, by design)
- [x] No watch-mode flags
- [x] Feedback latency < 10s (harness ~10s; unit harnesses 1-4s each)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — will be set by gsd-plan-checker during the verification loop
