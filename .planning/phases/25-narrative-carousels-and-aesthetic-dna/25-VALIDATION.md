---
phase: 25
slug: narrative-carousels-and-aesthetic-dna
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-28
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (no jest/vitest) — bespoke `scripts/verify-phase-NN.ts` static + functional harness, following `verify-phase-24.ts`'s exact pattern |
| **Config file** | none — Wave 0 installs `scripts/verify-phase-25.ts` |
| **Quick run command** | `npx tsx scripts/verify-phase-25.ts --only=<tag>` |
| **Full suite command** | `npx tsx scripts/verify-phase-25.ts && npm run check` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** `npx tsx scripts/verify-phase-25.ts --only=<this-task's-tag>`
- **After every plan wave:** full `npx tsx scripts/verify-phase-25.ts` + `npm run check`
- **Phase gate:** full suite green, plus a `spawnSync` non-regression sweep against `verify-phase-21.ts`/`verify-phase-21.1.ts`/`verify-phase-22.ts`/`verify-phase-23.ts`/`verify-phase-24.ts`, before `/gsd:verify-work`

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | all | static harness (Wave 0) | `npx tsx scripts/verify-phase-25.ts --only=self-test` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | CRSL2-01 | functional (no-network, fixture plan) | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-narrative` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | CRSL2-02 | static (pipeline-order grep) | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-compositor` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | CRSL2-04 | static + functional | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-textstyle-logo` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | PLAN-05 | functional (import DEFAULT_STYLE_CATALOG) | `npx tsx scripts/verify-phase-25.ts --only=svc-aesthetic-dna-catalog` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | PLAN-06 | functional (fixture brands) | `npx tsx scripts/verify-phase-25.ts --only=svc-color-proportion` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | PLAN-07 | static (migration/RLS grep) + functional (priority-merge fixture) | `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-25.ts` — new harness, mirrors `verify-phase-24.ts`'s `--only=` filter scaffold, all tags initially red
- [ ] `scripts/test-carousel-narrative-plan.ts` — no-network fixture test for role/composition_note deterministic-assignment + meaningful-variation check (SC2), mirrors `scripts/test-critic-reroll-logic.ts`'s pure-logic-import style
- [ ] A no-network fixture test for the reference-image priority-merge arithmetic (PLAN-07), mirroring `scripts/test-aspect-crop.ts`'s style — merge logic must be extracted into a testable pure function, not left inline in `generate.routes.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real visual composition variation across slides | CRSL2-01 (SC2) | The automated check only compares structured `composition_note` text fields — actual visual framing variation requires human/visual judgment | Generate a real carousel; visually confirm the hook/content/CTA slides show genuinely different framing/composition, not just different text labels. |
| Real on-slide text + narrative structure end-to-end | CRSL2-01, CRSL2-02 | Requires a live AI generation + compositor render to confirm the full pipeline produces crisp, correctly-placed text per slide | Generate a real carousel with `use_text=true`; confirm each slide shows correct on-slide text with consistent fonts/colors/layout archetype. |
| Aesthetic DNA prompt quality | PLAN-05, PLAN-06 | Static checks confirm the dense fields exist and are injected, but actual generated-image quality/adherence requires visual judgment | Generate posts across several style/mood combinations; visually confirm recognizable photography type, lighting, and 60-30-10 color usage. |
| Style reference board attachment | PLAN-07 | Requires a live generation with an admin-curated board attached to confirm the images actually reach and influence the model | Attach a style reference board to a style/mood as admin; generate a post/carousel with that style selected; confirm the reference images were attached to the generation call and visibly influenced the output. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — will be set by gsd-plan-checker during the verification loop
