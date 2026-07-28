---
phase: 24
slug: visual-critic-and-re-roll
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (no jest/vitest) — bespoke `scripts/verify-phase-NN.ts` static + functional harness, following `verify-phase-23.ts`'s exact pattern |
| **Config file** | none — Wave 0 installs `scripts/verify-phase-24.ts` |
| **Quick run command** | `npx tsx scripts/verify-phase-24.ts --only=<tag>` |
| **Full suite command** | `npx tsx scripts/verify-phase-24.ts && npm run check` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** the relevant `--only=<tag>` slice
- **After every plan wave:** full `npx tsx scripts/verify-phase-24.ts` + `npm run check`
- **Phase gate:** full suite green + `npm run check` clean before `/gsd:verify-work`

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| T1 | 24-01 | 1 | all (Wave 0) | static harness | `npx tsx scripts/verify-phase-24.ts --only=self-test` | ❌ W0 | ⬜ pending |
| T2 | 24-01 | 1 | CRIT-01, CRIT-05 | static (schema/enum widen) | `npx tsx scripts/verify-phase-24.ts --only=svc-observability` | ❌ W0 | ⬜ pending |
| T3 | 24-01 | 1 | CRIT-01 | type-check | `npm run check && npx tsx scripts/verify-phase-21.ts` | ✅ | ⬜ pending |
| T1 | 24-02 | 2 | CRIT-01, CRIT-04 | static + functional regex | `npx tsx scripts/verify-phase-24.ts --only=svc-abort-signal` | ❌ W0 | ⬜ pending |
| T2 | 24-02 | 2 | CRIT-04 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-abort-signal` | ❌ W0 | ⬜ pending |
| T1 | 24-03 | 2 | CRIT-03 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-billing-reroll` | ❌ W0 | ⬜ pending |
| T2 | 24-03 | 2 | CRIT-05 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-observability` | ❌ W0 | ⬜ pending |
| T1 | 24-04 | 2 | CRIT-01 | type-check | `npm run check && npx tsx scripts/verify-phase-21.ts` | ✅ | ⬜ pending |
| T2 | 24-04 | 2 | CRIT-01 | build | `npm run check && npm run build` | ✅ | ⬜ pending |
| T1 | 24-05 | 3 | CRIT-02 | functional (no-network unit) | `npx tsx scripts/test-critic-reroll-logic.ts` | ❌ W0 | ⬜ pending |
| T2 | 24-05 | 3 | CRIT-01 | static + functional | `npx tsx scripts/verify-phase-24.ts --only=svc-critic-call` | ❌ W0 | ⬜ pending |
| T3 | 24-05 | 3 | CRIT-01, CRIT-04 | live-gated smoke (SKIP without key) | `npx tsx scripts/verify-critic-live.ts` | ❌ W0 | ⬜ pending |
| T1 | 24-06 | 4 | CRIT-04 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-abort-signal` | ❌ W0 | ⬜ pending |
| T2 | 24-06 | 4 | CRIT-01, CRIT-02 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-reroll-logic` | ❌ W0 | ⬜ pending |
| T3 | 24-06 | 4 | CRIT-03, CRIT-05 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-billing-reroll` | ❌ W0 | ⬜ pending |
| T1 | 24-07 | 5 | all | static cross-plan + spawnSync regression | `npx tsx scripts/verify-phase-24.ts --only=svc-cross-plan` | ❌ W0 | ⬜ pending |
| T2 | 24-07 | 5 | all | full suite + build | `npx tsx scripts/verify-phase-24.ts && npm run check && npm run build` | ❌ W0 | ⬜ pending |
| T3 | 24-07 | 5 | all | checkpoint:human-verify (live runbook) | manual — 8-step runbook embedded in verify-phase-24.ts | n/a | ⬜ pending |

**Tags:** `self-test`, `svc-critic-call`, `svc-reroll-logic`, `svc-billing-reroll`, `svc-abort-signal`, `svc-observability` (plan 24-01) + `svc-cross-plan` (plan 24-07).

**Sampling continuity:** no 3 consecutive tasks lack an automated verify — every task in all 7 plans carries an `<automated>` command except 24-07 T3, which is the terminal human gate.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-24.ts` — new harness, 5 tags, mirrors `verify-phase-23.ts`'s `--only=` filter scaffold
- [ ] `scripts/test-critic-reroll-logic.ts` — new no-network unit harness for the pure re-roll decision function (hard-fail gate, soft-fail threshold, best-of-3 tie-break), mirroring `scripts/test-planning-schema-classification.ts`
- [ ] A live/`OPENROUTER_API_KEY`-gated smoke test for an actual critic call against a real image (mirrors `scripts/verify-planning-ablation.ts`'s SKIP-when-no-key pattern)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live critic scoring against a real image + real model | CRIT-01, CRIT-02 | Requires a funded `OPENROUTER_API_KEY` and a real vision-capable model call to confirm the json_schema+multimodal combination actually works end-to-end in production | Generate a post; confirm the critic call succeeds and returns valid structured scores; deliberately trigger a re-roll (e.g. a known-bad prompt) and confirm the sequential retry + best-of-3 fallback behaves as designed. |
| Real AbortSignal cancellation under load | CRIT-04 | Requires observing actual network-level cancellation behavior (not just code presence) under a real slow/hanging call | Force a safety-timer fire (e.g. simulate a hung critic/image call); confirm the underlying `fetch()`/SDK call is genuinely aborted (no zombie request continuing server-side) via server logs. |
| Compliance-rate query against real generation_logs data | CRIT-05 | Requires a population of real generations to produce a meaningful compliance-rate number | After a batch of live generations, run a query against `generation_logs` filtering `event_kind='visual_critic'`; confirm scores/re-roll counts/text-free compliance are queryable and produce a sensible rate. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — will be set by gsd-plan-checker during the verification loop
