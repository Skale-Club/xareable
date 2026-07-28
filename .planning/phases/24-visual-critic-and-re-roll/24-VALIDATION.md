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
| TBD | TBD | 0 | all | static harness (Wave 0) | `npx tsx scripts/verify-phase-24.ts --only=self-test` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | CRIT-01 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-critic-call` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | CRIT-02 | static + functional (no-network unit) | `npx tsx scripts/test-critic-reroll-logic.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | CRIT-03 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-billing-reroll` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | CRIT-04 | static | `npx tsx scripts/verify-phase-24.ts --only=svc-abort-signal` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | CRIT-05 | static + live-gated smoke | `npx tsx scripts/verify-phase-24.ts --only=svc-observability` | ❌ W0 | ⬜ pending |

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
