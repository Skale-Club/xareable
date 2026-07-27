---
phase: 23
slug: deterministic-typography-and-edit-fidelity
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-27
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (no jest/vitest) — bespoke `scripts/verify-phase-NN.ts` static + functional harness, following `verify-phase-22.ts`'s exact pattern |
| **Config file** | none — Wave 0 installs `scripts/verify-phase-23.ts` |
| **Quick run command** | `npx tsx scripts/verify-phase-23.ts --only=<tag>` |
| **Full suite command** | `npx tsx scripts/verify-phase-23.ts && npm run check` |
| **Estimated runtime** | ~15 seconds (includes golden-image render) |

---

## Sampling Rate

- **After every task commit:** `npx tsx scripts/verify-phase-23.ts --only=<relevant-tag>`
- **After every plan wave:** `npx tsx scripts/verify-phase-23.ts && npm run check`
- **Phase gate:** Full suite green, plus the golden-image test actually executed against an Alpine-based build (not just a developer's local non-Alpine machine), before `/gsd:verify-work`

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 23-01 T3 | 23-01 | 1 | all (infra) | static harness (Wave 0) | `npx tsx scripts/verify-phase-23.ts --only=self-test` | ⬜ W0 | ⬜ pending |
| 23-05 T1-T3 | 23-05 | 2 | TYPO-01 | static (grep, 4 leak channels) + functional (schema fixture) | `npx tsx scripts/verify-phase-23.ts --only=svc-text-free-prompt` + `npx tsx scripts/test-planning-schema-classification.ts` | ⬜ W0 | ⬜ pending |
| 23-04 T1,T3 | 23-04 | 2 | TYPO-02 | functional (archetype render + glyph check) | `npx tsx scripts/verify-phase-23.ts --only=svc-compositor-archetypes` | ⬜ W0 | ⬜ pending |
| 23-04 T2-T3 | 23-04 | 2 | TYPO-03 | functional (low/high-contrast fixtures) | `npx tsx scripts/verify-phase-23.ts --only=svc-contrast-scrim` | ⬜ W0 | ⬜ pending |
| 23-04 T3 / 23-08 T1 | 23-04, 23-08 | 2, 3 | TYPO-04 | functional golden-image, Docker/CI | `npx tsx scripts/verify-phase-23.ts --only=svc-golden-image-glyphs` + `npx tsx scripts/verify-golden-image.ts` | ⬜ W0 | ⬜ pending |
| 23-08 T2-T3 | 23-08 | 3 | TYPO-04 | static (Dockerfile + CI grep) | `npx tsx scripts/verify-phase-23.ts --only=svc-docker-fonts` | ⬜ W0 | ⬜ pending |
| 23-02 T1-T2 | 23-02 | 2 | TYPO-05 | static (migration + column grep) | `npx tsx scripts/verify-phase-23.ts --only=svc-schema-migration` | ⬜ W0 | ⬜ pending |
| 23-06 T1 / 23-07 T2 / 23-09 T1-T2 | 23-06, 23-07, 23-09 | 3, 4 | TYPO-06 | static (file-absence + repo grep) | `npx tsx scripts/verify-phase-23.ts --only=svc-verify-repair-removed` | ⬜ W0 | ⬜ pending |
| 23-07 T1-T3 | 23-07 | 3 | TYPO-07 | static + functional (NULL-base-image fixture) | `npx tsx scripts/verify-phase-23.ts --only=svc-edit-base-image` + `npx tsx scripts/test-edit-base-image-resolution.ts` | ⬜ W0 | ⬜ pending |
| 23-03 T1-T2 | 23-03 | 2 | POL-04 | functional (crop across all 15 enum values) | `npx tsx scripts/verify-phase-23.ts --only=svc-aspect-crop` + `npx tsx scripts/test-aspect-crop.ts` | ⬜ W0 | ⬜ pending |
| 23-06 T2 / 23-07 T1 | 23-06, 23-07 | 3 | POL-05 | static + functional | `npx tsx scripts/verify-phase-23.ts --only=svc-generation-params` | ⬜ W0 | ⬜ pending |
| 23-10 T1-T3 | 23-10 | 4 | POL-05 (UI) | static (client grep + build) | `npx tsx scripts/verify-phase-23.ts --only=svc-remake-ui` | ⬜ W0 | ⬜ pending |
| 23-11 T1 | 23-11 | 5 | all | cross-plan invariants + full suite | `npx tsx scripts/verify-phase-23.ts` | ⬜ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Prior-phase regression guards (run alongside every 23-05 task)

23-05 edits four files that Phase 22 asserts against, including both planning-schema
dialects. Its tasks therefore carry these prior-phase harnesses as blocking criteria:

| Guard | Command | Why |
|-------|---------|-----|
| Phase 22 strict-mode + prompt-precedence | `npx tsx scripts/verify-phase-22.ts` (54/54) | `additionalProperties: false` count floor, `strict: true`, `nullable: true`, `FALLBACK-ONLY` marker, lazy-flattening regex |
| Phase 22 classification fixture | `npx tsx scripts/test-planning-schema-classification.ts` | The typed `validFixture: PlanningWirePlan` loses its `text_rendering: null` member |
| Phase 21 GATE-08 video freeze | `npx tsx scripts/verify-phase-21.ts` (43/43) | `buildContextPrompt`'s `isVideo` branch and `video-generation.service.ts` must be byte-identical |

---

## Wave 0 Requirements

All Wave 0 items are assigned to plan **23-01** (wave 1), except the Dockerfile/CI decision which is assigned to plan **23-08** (wave 3, since the golden-image test it gates needs the compositor from 23-04).

- [ ] `scripts/verify-phase-23.ts` — new harness, following `verify-phase-22.ts`'s exact convention (23-01 Task 3; 12 tags + a 13th `[svc-cross-plan]` added by 23-11). Its `[svc-text-free-prompt]` tag must load `planning-schema.service.ts` and `prompt-builder.service.ts` in addition to `gemini.service.ts`, so all four TYPO-01 leak channels are asserted.
- [ ] `npm install @napi-rs/canvas` — not yet a dependency (23-01 Task 1)
- [ ] `server/assets/fonts/` — Inter static TTF weight files (regular/semibold/bold minimum), downloaded from the `rsms/inter` v4.1 GitHub release (SIL OFL 1.1 license) and committed (23-01 Task 1; plus the `script/build.ts` copy into `dist/assets/fonts`, without which the Docker runner stage cannot see them)
- [ ] A golden-image fixture set — sample pt-BR/es strings with accented characters (á, ç, ñ, ã, õ, í, ú, ê) and representative base images (one low-contrast, one high-contrast) for the contrast/scrim test (23-01 Task 2)
- [ ] Dockerfile changes — `fontconfig` + `fc-cache` apk addition, plus a decision on whether the golden-image test runs as a Docker build `RUN` step or a CI workflow step — DECIDED: both, via `scripts/verify-golden-image.ts` (23-08 Tasks 2-3)
- [ ] AVX runtime smoke check (`node -e "require('@napi-rs/canvas')"` or equivalent) added to build/deploy verification (23-01 Task 1 `scripts/smoke-canvas.ts`; wired into the Dockerfile builder AND runner stages by 23-08 Task 2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production Alpine host AVX compatibility | `@napi-rs/canvas` runtime (all TYPO-02+) | Cannot be verified from a dev sandbox — requires the real Coolify/Hetzner production container | After deploy, run the AVX smoke check on the actual production host; confirm `@napi-rs/canvas` loads without `Illegal instruction`. |
| Golden-image glyph coverage in the real Docker build | TYPO-04 | Requires an actual Alpine container build (font rendering can differ from a developer's local non-Alpine machine) | Build the Docker image; run the golden-image test inside the built container; visually confirm no tofu/missing-glyph boxes for pt-BR/es sample text. |
| Live planning call emits a text-free `image_prompt` | TYPO-01 | Static greps prove the schema and prompts no longer ask for rendered text, but only a real planning call proves the model actually complies | After 23-05 ships, run a real generation with `use_text: true` and inspect the persisted `ai_prompt_used`: it must describe a text-free scene with a named reserved zone, and the returned base image must contain no rendered lettering. |
| Full generate→edit→remake round-trip with real AI calls | TYPO-07, POL-04, POL-05 | Requires a real generation + edit + remake cycle against live AI APIs to confirm no ghosted/double-rendered text and correct param reuse end-to-end | Generate a post, edit it, remake it; visually confirm crisp single-rendered text, correct aspect ratio, and that generation_params were reused (not re-guessed) at each step. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — every one of the 29 tasks across plans 23-01..23-11 carries an `<automated>` command
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — assigned to 23-01 (deps, fonts, fixtures, harness, AVX smoke) and 23-08 (Dockerfile/CI)
- [x] No watch-mode flags
- [x] Feedback latency < 15s (`--only=<tag>` targeted runs)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — will be set by gsd-plan-checker during the verification loop
</content>
