---
id: SEED-005
status: dormant
planted: 2026-05-08
planted_during: v1.1 milestone post-completion (plan/ folder review)
trigger_when: when generation quality complaints surface, OR before next round of prompt changes, OR when subject-fidelity / exact-text issues are reported by users
scope: Small
---

# SEED-005: Post-generation rebuild — quality observability + dead-helper cleanup

## Why This Matters

The "post-generation rebuild" track from `plan/in-progress/post-generation-rebuild/` shipped its core scope: shared creative services across create/edit/quick-remake/video/caption-remake, exact-text verification, multi-style typography, hierarchy-aware text blocks, caption quality service. All real, all in code.

The plan's own `06-implementation-status.md` file lists a "Next Slice" that **was never executed**:

1. Run new typography hierarchy + quick-remake flows against real cases and **collect before/after evidence**
2. Add **operational logging** for:
   - exact-text verification outcomes
   - exact-text repair triggers (when did the model fail and need a repair pass?)
   - subject-fidelity failures (when did the reference get lost?)
3. **Remove the remaining dead caption helper functions** still left in `server/routes/posts.routes.ts`
4. Tighten subject-fidelity + adaptive logo overlay rules further if QA still drifts

Without (1)+(2), we cannot tell when the new pipeline regresses. The system silently degrades and we'd only notice through user complaints. With (3) we have orphan code paths that confuse future readers. (4) is conditional and only matters if QA reveals drift.

## When to Surface

**Trigger:** any of the following:
- A user reports "my product looks generic now" or "the price text came out wrong" → indicates subject-fidelity / exact-text regression
- Before any prompt-engineering change in `gemini.service.ts`, `caption-quality.service.ts`, or `text-rendering.service.ts` — establish a baseline first
- When AB-testing prompts becomes desirable (needs the metrics to compare)
- Quarterly quality review

Surface during `/gsd:new-milestone` if scope touches: prompt engineering, generation quality, content fidelity, exact-text rendering.

## Scope Estimate

**Small** — three discrete tasks plus an optional fourth:

- Add `generation_logs` rows for `exact_text_verification_*`, `exact_text_repair_triggered`, `subject_fidelity_failure` (table already exists, schema is extensible)
- Run a fixed set of fixtures from `plan/in-progress/post-generation-rebuild/fixtures/` end-to-end, save outputs, mark as baseline
- Grep + delete dead caption helpers in `server/routes/posts.routes.ts`

(Optional 4th task) tighten subject-fidelity / logo-overlay rules — only if baseline run reveals drift.

## Breadcrumbs

Implemented services (target of observability):
- `server/services/gemini.service.ts` — text gen with hierarchy + multi-style
- `server/services/text-rendering.service.ts` — exact-text verification + repair
- `server/services/caption-quality.service.ts` — caption validation/retry/repair/fallback
- `server/services/image-generation.service.ts` — canonical image gen path
- `server/routes/generate.routes.ts` — currently uses these services
- `server/routes/edit.routes.ts` — currently uses these services
- `server/routes/posts.routes.ts` — has dead caption helpers (per plan's "Next Slice")

Existing logging surface to extend:
- `supabase/migrations/20260306000000_generation_logs.sql` — `generation_logs` table
- `server/routes/generate.routes.ts:logGenerationError` helper

Fixtures already authored (preserved at `tests/fixtures/generation/` before `plan/` deletion):
- [tests/fixtures/generation/create-food-offer-exact-text.json](tests/fixtures/generation/create-food-offer-exact-text.json)
- [tests/fixtures/generation/create-product-reference.json](tests/fixtures/generation/create-product-reference.json)
- [tests/fixtures/generation/edit-replace-exact-text.json](tests/fixtures/generation/edit-replace-exact-text.json)
- [tests/fixtures/generation/video-caption-pt-br.json](tests/fixtures/generation/video-caption-pt-br.json)

Original plan (will be deleted with `plan/`):
- `plan/in-progress/post-generation-rebuild/06-implementation-status.md` — "Next Slice" section

## Notes

The four fixture JSON payloads were preserved at `tests/fixtures/generation/` when `plan/` was deleted (2026-05-08). They are real test payloads, not planning prose, and serve as the baseline scenario set when this seed graduates into a phase.

This is a small, low-stakes seed. The core feature works. The seed exists so we don't ship the next prompt change blind.
