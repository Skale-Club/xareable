---
phase: 25
slug: narrative-carousels-and-aesthetic-dna
status: draft
nyquist_compliant: true
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
| **Estimated runtime** | ~10 seconds (the `[svc-cross-plan]` subprocess sweep adds ~60s and is `tagActive`-guarded) |

---

## Sampling Rate

- **After every task commit:** `npx tsx scripts/verify-phase-25.ts --only=<this-task's-tag>`
- **After every plan wave:** full `npx tsx scripts/verify-phase-25.ts` + `npm run check`
- **Phase gate:** full suite green, plus a `spawnSync` non-regression sweep against `verify-phase-21.ts`/`verify-phase-21.1.ts`/`verify-phase-22.ts`/`verify-phase-23.ts`/`verify-phase-24.ts`/`verify-golden-image.ts`, before `/gsd:verify-work`

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| T1 | 25-01 | 1 | all (Wave 0) | static harness scaffold | `npx tsx scripts/verify-phase-25.ts --only=self-test` | ❌ W0 | ⬜ pending |
| T2 | 25-01 | 1 | all (Wave 0) | static harness, honestly red | `npx tsx scripts/verify-phase-25.ts --only=self-test && npx tsx scripts/verify-phase-25.ts; test $? -eq 1` | ❌ W0 | ⬜ pending |
| T1 | 25-02 | 1 | PLAN-05, PLAN-07 | functional (Zod parse fixtures) | `npx tsx scripts/verify-phase-25.ts --only=svc-aesthetic-dna-catalog; npm run check` | ❌ W0 | ⬜ pending |
| T2 | 25-02 | 1 | CRSL2-02 | functional (postSlideSchema defaults) | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-compositor; npm run check` | ❌ W0 | ⬜ pending |
| T3 | 25-02 | 1 | PLAN-07 | static (migration/RLS grep) | `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards` | ❌ W0 | ⬜ pending |
| T1 | 25-03 | 2 | CRSL2-01 | functional (no-network unit) | `npx tsx scripts/test-carousel-narrative-plan.ts` | ❌ W0 | ⬜ pending |
| T2 | 25-03 | 2 | CRSL2-01 | static (dual-dialect) + functional (validator) | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-narrative` | ❌ W0 | ⬜ pending |
| T1 | 25-04 | 2 | PLAN-07 | functional (no-network unit) | `npx tsx scripts/test-style-reference-merge.ts` | ❌ W0 | ⬜ pending |
| T2 | 25-04 | 2 | PLAN-07 | static (exports) + functional | `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards; npx tsx scripts/test-style-reference-merge.ts` | ❌ W0 | ⬜ pending |
| T1 | 25-05 | 2 | PLAN-05 | functional (import DEFAULT_STYLE_CATALOG.styles) | `npx tsx scripts/verify-phase-25.ts --only=svc-aesthetic-dna-catalog` | ❌ W0 | ⬜ pending |
| T2 | 25-05 | 2 | PLAN-05 | functional (import DEFAULT_STYLE_CATALOG.post_moods) | `npx tsx scripts/verify-phase-25.ts --only=svc-aesthetic-dna-catalog` | ❌ W0 | ⬜ pending |
| T3 | 25-05 | 2 | PLAN-05 | functional (withDefaultArtDirection backfill) | `npx tsx scripts/verify-phase-25.ts --only=svc-aesthetic-dna-catalog; npm run check` | ❌ W0 | ⬜ pending |
| T1 | 25-06 | 2 | PLAN-06 | functional (fixture brands, null degradation) | `npx tsx scripts/verify-phase-25.ts --only=svc-color-proportion` | ❌ W0 | ⬜ pending |
| T2 | 25-06 | 2 | PLAN-05 | functional (block builder + negative block) | `npx tsx scripts/verify-phase-25.ts --only=svc-aesthetic-dna-catalog` | ❌ W0 | ⬜ pending |
| T1 | 25-07 | 2 | CRSL2-04 | functional (no-network unit) | `npx tsx scripts/test-typography-treatment.ts` | ❌ W0 | ⬜ pending |
| T2 | 25-07 | 2 | CRSL2-04 | functional (byte-identity) + CI golden-image gate | `npx tsx scripts/test-typography-treatment.ts && npx tsx scripts/verify-golden-image.ts` | ✅ | ⬜ pending |
| T1 | 25-08 | 2 | PLAN-07 | static (admin-guard grep) | `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards; npm run check` | ❌ W0 | ⬜ pending |
| T2 | 25-08 | 2 | PLAN-07 | static (router registration) + build | `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards; npm run build` | ❌ W0 | ⬜ pending |
| T1 | 25-09 | 3 | PLAN-05, PLAN-06 | static (call sites) + Phase 23 regression | `npx tsx scripts/verify-phase-25.ts --only=svc-color-proportion; npx tsx scripts/verify-phase-23.ts` | ❌ W0 | ⬜ pending |
| T2 | 25-09 | 3 | PLAN-07 | static (call site) + Phase 24 regression | `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards; npx tsx scripts/verify-phase-24.ts` | ❌ W0 | ⬜ pending |
| T1 | 25-10 | 3 | CRSL2-01, PLAN-05, PLAN-06 | static (carousel prompt call sites) | `npx tsx scripts/verify-phase-25.ts --only=svc-color-proportion; npm run check` | ❌ W0 | ⬜ pending |
| T2 | 25-10 | 3 | CRSL2-01 | static (dialect isolation) + functional unit | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-narrative; npx tsx scripts/test-carousel-narrative-plan.ts` | ❌ W0 | ⬜ pending |
| T3 | 25-10 | 3 | CRSL2-01 | static (slide-2..N prompt inversion) + build | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-narrative; npm run build` | ❌ W0 | ⬜ pending |
| T1 | 25-11 | 3 | PLAN-05 | type-check + build | `npm run check && npm run build` | ✅ | ⬜ pending |
| T2 | 25-11 | 3 | PLAN-07 | type-check + build | `npm run check && npm run build` | ✅ | ⬜ pending |
| T3 | 25-11 | 3 | PLAN-05, PLAN-07 | type-check + build (i18n key parity) | `npm run check && npm run build` | ✅ | ⬜ pending |
| T1 | 25-12 | 4 | CRSL2-02 | static (pipeline-order + anchor discipline) | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-compositor` | ❌ W0 | ⬜ pending |
| T2 | 25-12 | 4 | CRSL2-04 | static + functional unit | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-textstyle-logo; npx tsx scripts/test-typography-treatment.ts` | ❌ W0 | ⬜ pending |
| T3 | 25-12 | 4 | PLAN-07 | static (carousel reference plumbing) + build | `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards; npm run build` | ❌ W0 | ⬜ pending |
| T1 | 25-13 | 5 | CRSL2-02 | functional (no-network decision matrix) | `npx tsx scripts/test-slide-edit-resolution.ts && npx tsx scripts/verify-phase-25.ts --only=svc-carousel-compositor` | ❌ W0 | ⬜ pending |
| T2 | 25-13 | 5 | CRSL2-02 | functional unit + type-check | `npx tsx scripts/test-slide-edit-resolution.ts && npm run check` | ❌ W0 | ⬜ pending |
| T3 | 25-13 | 5 | CRSL2-02, CRSL2-04 | static (edit pipeline order) + Phase 23 regression + build | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-compositor && npx tsx scripts/verify-phase-23.ts && npm run build` | ❌ W0 | ⬜ pending |
| T1 | 25-14 | 6 | all | static cross-plan + spawnSync regression sweep | `npx tsx scripts/verify-phase-25.ts --only=svc-cross-plan && npx tsx scripts/verify-phase-25.ts && npm run check` | ❌ W0 | ⬜ pending |
| T2 | 25-14 | 6 | all | full suite + all 4 unit harnesses + build | `npx tsx scripts/verify-phase-25.ts && npx tsx scripts/test-carousel-narrative-plan.ts && npx tsx scripts/test-style-reference-merge.ts && npx tsx scripts/test-typography-treatment.ts && npx tsx scripts/test-slide-edit-resolution.ts && npm run check && npm run build` | ❌ W0 | ⬜ pending |
| T3 | 25-14 | 6 | all | checkpoint:human-verify (live runbook) | manual — 8-step runbook embedded in `scripts/verify-phase-25.ts` | n/a | ⬜ pending |

**Tags:** `self-test`, `svc-carousel-narrative`, `svc-carousel-compositor`, `svc-carousel-textstyle-logo`, `svc-aesthetic-dna-catalog`, `svc-color-proportion`, `svc-style-reference-boards` (plan 25-01) + `svc-cross-plan` (plan 25-14) = 8 tags.

**Requirement coverage across the 14-plan set:**

| Requirement | Plans |
|-------------|-------|
| PLAN-05 | 25-01, 25-02, 25-05, 25-06, 25-09, 25-10, 25-11, 25-14 |
| PLAN-06 | 25-01, 25-06, 25-09, 25-10, 25-14 |
| PLAN-07 | 25-01, 25-02, 25-04, 25-08, 25-09, 25-11, 25-12, 25-14 |
| CRSL2-01 | 25-01, 25-02, 25-03, 25-10, 25-14 |
| CRSL2-02 | 25-01, 25-02, 25-12, 25-13, 25-14 |
| CRSL2-04 | 25-01, 25-07, 25-12, 25-13, 25-14 |

**Sampling continuity:** no 3 consecutive tasks lack an automated verify — all 35 tasks across the 14 plans carry an `<automated>` command except 25-14 T3, the terminal human gate.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-25.ts` (plan 25-01) — new harness, mirrors `verify-phase-24.ts`'s `--only=` filter scaffold, 7 tags initially (25-14 appends the 8th), all requirement tags initially red
- [ ] `scripts/test-carousel-narrative-plan.ts` (plan 25-03) — no-network fixture test for role/composition_note deterministic-assignment + meaningful-variation check (SC2), mirrors `scripts/test-critic-reroll-logic.ts`'s pure-logic-import style
- [ ] `scripts/test-style-reference-merge.ts` (plan 25-04) — no-network fixture test for the reference-image priority-merge arithmetic (PLAN-07); the merge logic is extracted into `planReferenceImageSlots`, a pure function, rather than left inline in `generate.routes.ts`

Two further no-network unit harnesses land alongside their owning plans and are swept by `[svc-cross-plan]` (plan 25-14, check 8):

- [ ] `scripts/test-typography-treatment.ts` (plan 25-07) — treatment derivation + the byte-identical identity default that protects Phase 23's golden-image gate
- [ ] `scripts/test-slide-edit-resolution.ts` (plan 25-13) — the slide-edit decision matrix (`resolveSlideEditTarget` / `resolveSlideEditAspectRatio` / `resolveCarouselLayoutArchetype` / `isSlideTextOnlyEdit`), mirroring `scripts/test-edit-base-image-resolution.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Runbook Step | Test Instructions |
|----------|-------------|------------|--------------|-------------------|
| Real visual composition variation across slides | CRSL2-01 (SC2) | The automated check only compares structured `composition_note` text fields — actual visual framing variation requires human/visual judgment | 2 | Generate a real carousel; visually confirm the hook/content/CTA slides show genuinely different framing/composition, not just different text labels. Grep the server log for `[carousel] composition variation warning:` — expect it absent. |
| Real on-slide text + narrative structure end-to-end | CRSL2-01, CRSL2-02 | Requires a live AI generation + compositor render to confirm the full pipeline produces crisp, correctly-placed text per slide | 1, 4 | Generate a real carousel; confirm each slide shows correct on-slide text with consistent fonts/colors/layout archetype (SQL on `post_slides.typography_meta`). Then edit a slide and confirm no double-rendered/ghosted text. |
| Aesthetic DNA prompt quality | PLAN-05, PLAN-06 | Static checks confirm the dense fields exist and are injected, but actual generated-image quality/adherence requires visual judgment | 6 | Generate posts across several style/mood combinations; confirm the style's `photography_type` string appears verbatim in the prompt payload and the 10% accent clause names `color_4`; visually confirm recognizable photography type, lighting, and 60-30-10 color usage. |
| Style reference board attachment | PLAN-07 | Requires a live generation with an admin-curated board attached to confirm the images actually reach and influence the model | 7 | Attach a style reference board to a style/mood as admin; generate a post AND a carousel with that style selected; confirm the `style-board = N/4` log lines show N > 0 and the reference images visibly influenced the output; confirm 403 for a non-admin writer. |

The runbook (embedded at the bottom of `scripts/verify-phase-25.ts` by plan 25-14) adds three further live steps that no row above covers on its own: text-style treatment + per-slide logo (step 3, CRSL2-04/SC3), the LEGACY `base_image_url IS NULL` slide-edit branch (step 5), and the frozen-path/admin-round-trip no-regression sweep (step 8).

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s (per-tag runs; the `[svc-cross-plan]` subprocess sweep is `tagActive`-guarded and only runs on the full suite or an explicit `--only=svc-cross-plan`)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — will be set by gsd-plan-checker during the verification loop
</content>
