---
phase: 24-visual-critic-and-re-roll
plan: 04
subsystem: admin-ui
tags: [zod, express, react, shadcn, i18n, ai-gateway]

# Dependency graph
requires:
  - phase: 24-01
    provides: "aiModelsSchema.critic (default gemini-2.5-flash), FallbackCallClass widened with 'critic', ai-models-card.tsx compile-fix fallback literal"
provides:
  - "PATCH /api/admin/ai-model-fallbacks accepts call_class: 'critic' (own fallback chain, isolated from the shared text chain)"
  - "GET/PATCH /api/admin/ai-gateway-routing still correctly rejects call_class: 'critic' (OpenRouter-only, no direct-Gemini rollback, per 24-CONTEXT.md)"
  - "AI Models admin card: 'Visual Critic' model selector bound to ai_models.critic, in the same grid as the other 5 call-class selectors"
  - "pt-BR and es translations for the 'Visual Critic' label and its capability-warning helper text"
affects: [24-05, 24-06, 24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admin call-class selector pattern (ai-models-card.tsx): Label + Select bound to aiModels.<field> via updateModel(field, value), with a helper <p> stating capability requirements — now used identically for planning, image_generation, text_generation, audio_transcription, video_generation, and critic"
    - "Fallback-chain-only call classes (no GATE-07 routing membership): FALLBACK_CLASSES can be a strict superset of CALL_CLASSES when a call class is OpenRouter-only by design"

key-files:
  created: []
  modified:
    - server/routes/admin-settings.routes.ts
    - client/src/components/admin/post-creation/ai-models-card.tsx
    - client/src/lib/translations/pt.ts
    - client/src/lib/translations/es.ts

key-decisions:
  - "FALLBACK_CLASSES widened to 4 members (text, image, transcription, critic); CALL_CLASSES (GATE-07 routing union) deliberately left at 3 — the critic has a fallback chain but no direct-Gemini routing rollback, matching 24-CONTEXT.md's locked OpenRouter-only scope for the critic call class"
  - "New selector inserted immediately after 'Planning (Art Director)' (not appended last) so the two admin-only/quality-gate call classes stay visually adjacent; CardContent grid widened xl:grid-cols-5 -> xl:grid-cols-6 to keep all six selectors on one row at xl"

patterns-established: []

requirements-completed: [CRIT-01]

# Metrics
duration: ~10min
completed: 2026-07-28
---

# Phase 24 Plan 04: Critic Admin Surfaces Summary

**Widened the fallback-chain admin endpoint to accept `call_class: "critic"` and added a "Visual Critic" model selector (pt/es translated) to the AI Models admin card, making `ai_models.critic` admin-configurable on both surfaces every other call class already has, while the GATE-07 routing endpoint keeps correctly rejecting `critic` per its locked OpenRouter-only scope.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 2/2 complete
- **Files modified:** 4

## Accomplishments
- `server/routes/admin-settings.routes.ts`: `FALLBACK_CLASSES` widened to `["text", "image", "transcription", "critic"] as const`, with an in-code comment explaining the rationale (isolated critic-model deprecation from the shared text chain); `CALL_CLASSES` (the GATE-07 routing union) explicitly left untouched with a comment stating why (OpenRouter-only, no direct-Gemini rollback, 24-CONTEXT.md locked decision); PATCH validation error message and both endpoint JSDoc comments updated to match
- `client/src/components/admin/post-creation/ai-models-card.tsx`: new "Visual Critic" `Label`/`Select` block inserted immediately after "Planning (Art Director)", bound to `aiModels.critic` via `updateModel("critic", value)`, with three model options (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3.1-flash`) and a helper `<p>` warning that an unsupported model disables the quality gate; `CardContent` grid class changed `xl:grid-cols-5` -> `xl:grid-cols-6`; the local `aiModels` fallback literal's `critic` comment updated from "no selector UI yet" to reference this new selector
- `client/src/lib/translations/pt.ts` / `es.ts`: both gained `"Visual Critic"` and the long capability-warning helper-text key, placed next to the existing "Planning (Art Director)" entries; the English helper-text key is byte-identical across `ai-models-card.tsx`, `pt.ts`, and `es.ts` (verified via `diff` on the extracted literal, not eyeballing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Accept call_class "critic" on the fallback-chain admin endpoints** - `200da6f` (feat)
2. **Task 2: Add the Visual Critic model selector + pt/es translations** - `b87c97f` (feat)

## Files Created/Modified
- `server/routes/admin-settings.routes.ts` - `FALLBACK_CLASSES` widened with `"critic"`; `CALL_CLASSES` deliberately unchanged (with scope-boundary comment); validation error message + JSDoc updated
- `client/src/components/admin/post-creation/ai-models-card.tsx` - New "Visual Critic" selector bound to `ai_models.critic`; grid widened to 6 columns
- `client/src/lib/translations/pt.ts` - `"Visual Critic"` + capability-warning helper text (pt-BR)
- `client/src/lib/translations/es.ts` - `"Visual Critic"` + capability-warning helper text (es)

## Decisions Made
- Kept `CALL_CLASSES` at 3 members rather than widening it alongside `FALLBACK_CLASSES` — the plan and 24-CONTEXT.md are explicit that GATE-07's direct-Gemini rollback endpoint must keep rejecting `critic`; only the fallback-chain endpoint (OpenRouter-model-to-OpenRouter-model chain, no direct-Gemini involved) gains critic support
- Placed the new selector directly after "Planning (Art Director)" (not at the end of the grid) since both are admin/pipeline-quality call classes, keeping related controls visually grouped
- Also updated the two `/api/admin/ai-model-fallbacks` JSDoc comments (not explicitly required by the plan's action list, but directly follows from the `FALLBACK_CLASSES` widen and keeps the endpoint's documented contract accurate) — minor accuracy fix within the same task's causal chain, not a new deviation

## Deviations from Plan

None - plan executed exactly as written. (The JSDoc comment updates above are a direct, same-file, same-task extension of the required `FALLBACK_CLASSES`/error-message change, not a separate deviation.)

**Judgment call — REQUIREMENTS.md accuracy:** did NOT run `requirements mark-complete CRIT-01`, despite this plan's frontmatter listing `requirements: [CRIT-01]`. CRIT-01's actual text ("A multimodal critic call scores every generated image on composition, text legibility zone, color harmony, and unwanted-AI-text before post-processing") describes the critic call itself, which does not exist yet — `npx tsx scripts/verify-phase-24.ts --only=svc-critic-call` still shows 9/10 checks failing (`visual-critic.service.ts` doesn't exist). This plan only makes the future `ai_models.critic` admin-configurable on both surfaces; it delivers an enabling condition for CRIT-01, not CRIT-01 itself. Same precedent as 24-01-SUMMARY.md's identical judgment call. `REQUIREMENTS.md`'s CRIT-01 row remains `Pending`, accurate to actual delivery state — the plan (24-05 or 24-06) that lands `visual-critic.service.ts` and wires the actual call should mark it complete.

## Issues Encountered

None. One parallel-execution note: `git status` showed `server/quota.ts` (Task 1) and `server/services/observability.service.ts` (Task 2) modified by sibling parallel agents (24-02/24-03) at staging time; both were correctly left unstaged per the shared-working-directory protocol, and only this plan's own files were added/committed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `ai_models.critic` is now admin-configurable end-to-end (model slug via the AI Models card, fallback chain via `PATCH /api/admin/ai-model-fallbacks`), in all three locales (en/pt-BR/es) — GATE-04's "no hardcoded slugs, admin-configurable per call class" promise now holds for `critic` too.
- `npm run check`, `npm run build`, and `npx tsx scripts/verify-phase-21.ts` (43/43) all pass with zero regression.
- `npx tsx scripts/verify-phase-24.ts --only=svc-critic-call` check 9 (`aiModelsSchema.critic` half) is satisfied; the check's overall PASS still depends on `generate.routes.ts` referencing `ai_models?.critic`, which belongs to a later Wave-2 plan (24-05/24-06) that writes the actual critic call site — expected and correct per 24-01-SUMMARY.md's phase-gate design.
- No blockers for 24-05/24-06/24-07.

---
*Phase: 24-visual-critic-and-re-roll*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/routes/admin-settings.routes.ts
- FOUND: client/src/components/admin/post-creation/ai-models-card.tsx
- FOUND: client/src/lib/translations/pt.ts
- FOUND: client/src/lib/translations/es.ts
- FOUND: 200da6f (Task 1 commit)
- FOUND: b87c97f (Task 2 commit)
