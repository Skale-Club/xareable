---
phase: 26
slug: fixes-and-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| TBD | TBD | 0 | all | static harness (Wave 0) | `npx tsx scripts/verify-phase-26.ts --only=self-test` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | POL-02 | static | `npx tsx scripts/verify-phase-26.ts --only=svc-webp-quality` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | POL-02 | functional (fixture) | `npx tsx scripts/verify-phase-26.ts --only=svc-webp-edge-check` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | POL-03 | functional (fixture) | `npx tsx scripts/verify-phase-26.ts --only=svc-logo-contrast` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | POL-06 | static + manual/live | `npx tsx scripts/verify-phase-26.ts --only=svc-idempotency` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | POL-09 | static + manual UI | `npx tsx scripts/verify-phase-26.ts --only=svc-quality-dashboard` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | POL-08 | static (runbook existence) | `npx tsx scripts/verify-phase-26.ts --only=svc-cost-reconciliation-runbook` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | (bugfix) | functional (fixture) | `npx tsx scripts/verify-phase-26.ts --only=svc-drawblocks-font-fix` | ❌ W0 | ⬜ pending |

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — will be set by gsd-plan-checker during the verification loop
