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
| TBD | TBD | 0 | PLAN-01..04 | static harness (Wave 0) | `npx tsx scripts/verify-phase-22.ts --only=self-test` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | PLAN-01 (multimodal) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-multimodal` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | PLAN-01 (SC1 ablation) | manual/live | documented runbook step, gated behind `OPENROUTER_API_KEY` | n/a | ⬜ pending |
| TBD | TBD | 1+ | PLAN-02 (json_schema) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-schema` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | PLAN-02 (failure logging) | static + functional | `npx tsx scripts/verify-phase-22.ts --only=svc-schema-failure-log`; `npx tsx scripts/test-planning-schema-classification.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | PLAN-03 (model tier + token budget) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-model-tier`, `--only=svc-token-budget` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | PLAN-04 (precedence fix) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-prompt-precedence` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-22.ts` — new harness file, structural copy of `verify-phase-21.ts`'s pattern (numbered `check()` calls, `--only=<tag>` filter, exit-code-driven)
- [ ] `scripts/test-planning-schema-classification.ts` — new, no-network functional test asserting schema-vs-transport error classification logic returns the right branch for fixture inputs (malformed JSON string, valid-but-schema-mismatched JSON, simulated network-error object) — mirrors `scripts/test-openrouter-image-adapter.ts`'s no-network-fixture pattern

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
