---
phase: 22
slug: art-director-planning-upgrade
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (no jest/vitest) — hand-written `scripts/verify-phase-NN.ts` static/structural + gated-live harnesses, run via `tsx`, following `verify-phase-21.ts`'s exact pattern |
| **Config file** | none — Wave 0 installs `scripts/verify-phase-22.ts` |
| **Quick run command** | `npx tsx scripts/verify-phase-22.ts` |
| **Full suite command** | `npx tsx scripts/verify-phase-22.ts && npm run check` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** `npx tsx scripts/verify-phase-22.ts --only=<relevant-tag>` + `npm run check`
- **After every plan wave:** Full `npx tsx scripts/verify-phase-22.ts` + `npm run check`
- **Before `/gsd:verify-work`:** Full harness green + `npm run check` clean; SC1's live ablation step is a documented manual runbook item (cannot be gated in CI without a funded API key, consistent with Phase 21's precedent)
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| T1 | 22-01 | 1 | PLAN-01..04 | static harness (Wave 0) | `npx tsx scripts/verify-phase-22.ts --only=self-test` | ⬜ W0 | ⬜ pending |
| T2 | 22-01 | 1 | PLAN-02 (schema module) | static + functional | `npx tsx scripts/verify-phase-22.ts --only=svc-schema-module`; `npx tsx scripts/test-planning-schema-classification.ts` | ⬜ W0 | ⬜ pending |
| T3 | 22-01 | 1 | PLAN-03 (ai_models.planning), PLAN-02 (event_kind + emitter) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-schema-failure-log` | ✅ T1 | ⬜ pending |
| T1 | 22-02 | 2 | PLAN-01 (multimodal) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-multimodal` | ✅ T1 | ⬜ pending |
| T2 | 22-02 | 2 | PLAN-03 (model tier + token ceiling) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-model-tier`, `--only=svc-token-budget` | ✅ T1 | ⬜ pending |
| T1 | 22-03 | 2 | PLAN-03 (carousel token budget) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-token-budget` | ✅ T1 | ⬜ pending |
| T2 | 22-03 | 2 | PLAN-03 (admin UI) | static + build | `npx tsx scripts/verify-phase-22.ts --only=svc-model-tier`; `npm run build` | ✅ T1 | ⬜ pending |
| T1 | 22-04 | 3 | PLAN-02 (json_schema request) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-schema` | ✅ T1 | ⬜ pending |
| T2 | 22-04 | 3 | PLAN-02 (hard-fail + logging) | static + functional | `npx tsx scripts/verify-phase-22.ts --only=svc-schema-failure-log`; `npx tsx scripts/test-planning-schema-classification.ts` | ✅ T1 | ⬜ pending |
| T3 | 22-04 | 3 | PLAN-02 (route guard) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-schema-failure-log` | ✅ T1 | ⬜ pending |
| T1 | 22-05 | 4 | PLAN-04 (dense prompt guidance) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-prompt-precedence` | ✅ T1 | ⬜ pending |
| T2 | 22-05 | 4 | PLAN-04 (precedence) + PLAN-02 (forward-compat fields) | static + build | `npx tsx scripts/verify-phase-22.ts --only=svc-prompt-precedence`; `npm run build` | ✅ T1 | ⬜ pending |
| T1 | 22-06 | 5 | PLAN-01..04 (full gate) | static + functional | `npx tsx scripts/verify-phase-22.ts` | ✅ T1 | ⬜ pending |
| T2 | 22-06 | 5 | PLAN-01 (SC1 ablation harness) | gated-live (CI-safe skip) | `npx tsx scripts/verify-planning-ablation.ts` | ⬜ 22-06 T2 | ⬜ pending |
| T3 | 22-06 | 5 | PLAN-01..04 (SC1/SC2/SC3 live) | manual/operator | 6-step runbook in `scripts/verify-phase-22.ts` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-22.ts` — new harness file (owned by plan 22-01 Task 1; checks are written LIVE not stubbed, so each later task turns its own tag green), structural copy of `verify-phase-21.ts`'s pattern (numbered `check()` calls, `--only=<tag>` filter, exit-code-driven)
- [ ] `scripts/test-planning-schema-classification.ts` — owned by plan 22-01 Task 2; no-network functional test asserting schema-vs-transport error classification logic returns the right branch for fixture inputs (malformed JSON string, valid-but-schema-mismatched JSON, simulated network-error object) — mirrors `scripts/test-openrouter-image-adapter.ts`'s no-network-fixture pattern

*No shared fixtures needed beyond small inline literals in the new test script.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live ablation run | PLAN-01 (SC1) | Requires a real, funded `OPENROUTER_API_KEY` and a real generation to observe a measurable prompt difference with vs. without reference images — not CI-blocking, mirrors Phase 21's live-only-check precedent | 1) Generate a post with a brand reference photo/user-uploaded image attached. 2) Generate an equivalent post with reference images removed. 3) Compare `image_prompt` output — confirm a measurable difference attributable to the reference images. |
| Live structured-output schema call | PLAN-02/PLAN-03 | Requires a real API key to confirm the chosen model slug actually honors `json_schema` strict mode in production (research is live-verified via docs/catalog, not a live authenticated call) | Generate a real post; confirm the planning-call response validates against the schema with zero parse retries needed under normal conditions. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — will be set by gsd-plan-checker during the verification loop
