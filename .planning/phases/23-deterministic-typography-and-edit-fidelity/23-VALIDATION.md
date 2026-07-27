---
phase: 23
slug: deterministic-typography-and-edit-fidelity
status: draft
nyquist_compliant: false
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
| TBD | TBD | 0 | all | static harness (Wave 0) | `npx tsx scripts/verify-phase-23.ts --only=self-test` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | TYPO-01 | static (grep) | `npx tsx scripts/verify-phase-23.ts --only=svc-text-free-prompt` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | TYPO-02 | functional (golden-image render + pixel/glyph check) | `npx tsx scripts/verify-phase-23.ts --only=svc-compositor-archetypes` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | TYPO-03 | functional (low-contrast fixture) | `npx tsx scripts/verify-phase-23.ts --only=svc-contrast-scrim` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | TYPO-04 | functional golden-image, Docker/CI | `npx tsx scripts/verify-phase-23.ts --only=svc-golden-image-glyphs` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | TYPO-05 | static (migration + column grep) | `npx tsx scripts/verify-phase-23.ts --only=svc-schema-migration` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | TYPO-06 | static (file-absence + grep) | `npx tsx scripts/verify-phase-23.ts --only=svc-verify-repair-removed` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | TYPO-07 | static + functional (NULL-base-image fixture) | `npx tsx scripts/verify-phase-23.ts --only=svc-edit-base-image` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | POL-04 | functional (crop across representative aspect ratios) | `npx tsx scripts/verify-phase-23.ts --only=svc-aspect-crop` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | POL-05 | static + functional | `npx tsx scripts/verify-phase-23.ts --only=svc-generation-params` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-23.ts` — new harness, following `verify-phase-22.ts`'s exact convention
- [ ] `npm install @napi-rs/canvas` — not yet a dependency
- [ ] `server/assets/fonts/` — Inter static TTF weight files (regular/semibold/bold minimum), downloaded from the `rsms/inter` v4.1 GitHub release (SIL OFL 1.1 license) and committed
- [ ] A golden-image fixture set — sample pt-BR/es strings with accented characters (á, ç, ñ, ã, õ, í, ú, ê) and representative base images (one low-contrast, one high-contrast) for the contrast/scrim test
- [ ] Dockerfile changes — `fontconfig` + `fc-cache` apk addition, plus a decision on whether the golden-image test runs as a Docker build `RUN` step or a CI workflow step
- [ ] AVX runtime smoke check (`node -e "require('@napi-rs/canvas')"` or equivalent) added to build/deploy verification

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production Alpine host AVX compatibility | `@napi-rs/canvas` runtime (all TYPO-02+) | Cannot be verified from a dev sandbox — requires the real Coolify/Hetzner production container | After deploy, run the AVX smoke check on the actual production host; confirm `@napi-rs/canvas` loads without `Illegal instruction`. |
| Golden-image glyph coverage in the real Docker build | TYPO-04 | Requires an actual Alpine container build (font rendering can differ from a developer's local non-Alpine machine) | Build the Docker image; run the golden-image test inside the built container; visually confirm no tofu/missing-glyph boxes for pt-BR/es sample text. |
| Full generate→edit→remake round-trip with real AI calls | TYPO-07, POL-04, POL-05 | Requires a real generation + edit + remake cycle against live AI APIs to confirm no ghosted/double-rendered text and correct param reuse end-to-end | Generate a post, edit it, remake it; visually confirm crisp single-rendered text, correct aspect ratio, and that generation_params were reused (not re-guessed) at each step. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — will be set by gsd-plan-checker during the verification loop
