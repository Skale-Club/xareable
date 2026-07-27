---
phase: 22-art-director-planning-upgrade
plan: 03
subsystem: api
tags: [gemini, openrouter, carousel, admin-ui, i18n, token-budget]

# Dependency graph
requires:
  - phase: 22-art-director-planning-upgrade
    provides: "22-01's aiModelsSchema.planning field (default gemini-2.5-pro) and the fallback-literal type-safety fix in ai-models-card.tsx"
provides:
  - "carousel-generation.service.ts: CAROUSEL_TOKEN_BASE, CAROUSEL_TOKENS_PER_SLIDE, carouselPlanMaxTokens(slideCount) — slide-count-scaled output token budget wired into both callCarouselTextPlan transports"
  - "ai-models-card.tsx: 5th 'Planning (Art Director)' selector bound to ai_models.planning, offering 4 live-verified structured-outputs-capable bare Gemini slugs"
  - "pt.ts/es.ts: translations for the new selector label + helper text"
affects: [22-04, 22-05, 22-06, 25-narrative-carousels-and-aesthetic-dna]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exported, greppable token-budget formula (BASE + PER_SLIDE * clamp(slideCount, 3, 8)) instead of a flat literal ceiling — mirrors the plan's own acceptance-criteria grep contract so a future reader can verify the formula without running code"
    - "Admin model-slug dropdowns always store BARE OpenRouter slugs (no google/ prefix) — normalizeOpenRouterModelSlug() adds the prefix for the gateway path, the direct-Gemini rollback path builds its own URL from the same bare value"

key-files:
  created: []
  modified:
    - server/services/carousel-generation.service.ts
    - client/src/components/admin/post-creation/ai-models-card.tsx
    - client/src/lib/translations/pt.ts
    - client/src/lib/translations/es.ts

key-decisions:
  - "Live re-verified all 4 dropdown slugs (gemini-2.5-pro, gemini-3.1-pro-preview, gemini-3.5-flash, gemini-2.5-flash) against OpenRouter's public structured_outputs model list at implementation time — all 4 confirmed OK, no substitution needed."
  - "Updated the stale 22-01 fallback-literal comment in ai-models-card.tsx (which said the dropdown UI was deferred to 'a later Phase 22 plan') now that this plan supplies that UI — avoids a comment that contradicts the code beneath it."

patterns-established: []

requirements-completed: [PLAN-03]

# Metrics
duration: 4min (first-to-last task commit; excludes read/verification time)
completed: 2026-07-27
---

# Phase 22 Plan 03: Carousel Token-Budget Scaling + Admin Planning-Model Selector Summary

**Carousel master-plan token budget now scales `1200 + 350 * slideCount` (2250 for 3 slides, 4000 for 8) on both transports, and the admin AI Models card gained a 5th "Planning (Art Director)" dropdown wired to `ai_models.planning`.**

## Performance

- **Duration:** 4 min (commit-to-commit; total session including reads/verification was longer)
- **Started:** 2026-07-27T14:38:18-04:00 (first commit)
- **Completed:** 2026-07-27T14:41:41-04:00 (last commit)
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments
- `carousel-generation.service.ts` gained an exported, greppable token-budget formula (`CAROUSEL_TOKEN_BASE = 1200`, `CAROUSEL_TOKENS_PER_SLIDE = 350`, `carouselPlanMaxTokens(slideCount)`) replacing the flat `2048` ceiling on BOTH the OpenRouter (`maxTokens`) and direct-Gemini (`maxOutputTokens`) transports inside `callCarouselTextPlan` — verified `carouselPlanMaxTokens(3) === 2250` and `carouselPlanMaxTokens(8) === 4000` by inspection and via `scripts/verify-phase-22.ts --only=svc-token-budget`.
- Added a scope-note comment above `callCarouselTextPlan`'s `textModel` resolution clarifying carousel intentionally keeps `ai_models.text_generation` this phase (model tier + multimodal references are Phase 25 scope) — prevents a future reader from "fixing" it prematurely.
- `ai-models-card.tsx`'s `CardContent` grid widened to `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5` and gained a new first-position "Planning (Art Director)" selector, writing `ai_models.planning` via the existing `updateModel()` helper, offering 4 bare model slugs.
- Live-reverified all 4 offered slugs against `GET https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs` at implementation time — `gemini-2.5-pro`, `gemini-3.1-pro-preview`, `gemini-3.5-flash`, and `gemini-2.5-flash` all confirmed OK (no MISSING slugs, no substitution needed).
- Added pt/es translations for the new label and helper-text string, placed adjacent to the existing `"Text Generation & Prompts"` entry in each file per the plan's own instruction; no existing keys removed or renamed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scale the carousel master-plan token budget with slide count (PLAN-03)** - `e81c8f4` (feat)
2. **Task 2: Expose the planning model in the admin AI Models card (PLAN-03)** - `5fe91ab` (feat)

**Plan metadata:** (this commit, following SUMMARY.md creation)

## Files Created/Modified
- `server/services/carousel-generation.service.ts` - Exported token-budget formula + both transports wired + scope-note comment
- `client/src/components/admin/post-creation/ai-models-card.tsx` - 5th "Planning (Art Director)" selector, widened grid, updated fallback-literal comment
- `client/src/lib/translations/pt.ts` - 2 new translation keys
- `client/src/lib/translations/es.ts` - 2 new translation keys

## Decisions Made
- Kept the plan's literal formula (`1200 + 350 * slideCount`) as specified — no adjustment needed since both boundary values (2250, 4000) are far under every structured-outputs-capable Gemini model's completion ceiling.
- Re-verified (rather than trusted) the dropdown slugs' `structured_outputs` support live at implementation time per the plan's explicit instruction, since the admin-configurable catalog is dynamic and could drift from any prior research snapshot. All 4 confirmed current.
- Rewrote the 22-01-authored fallback-literal comment in `ai-models-card.tsx` (originally noting the dropdown UI was deferred) to instead point at the now-existing "Planning (Art Director)" selector — keeps the comment truthful.

## Deviations from Plan

None — plan executed exactly as written. Two minor plan-authoring inaccuracies were noted (not deviations, no code changes required):
- The plan's acceptance-criteria grep `grep -n 'value="gemini-2.5-pro"' ... returns 1 line` actually returns 3 lines, because `gemini-2.5-pro` was already a pre-existing option in the "Text Generation & Prompts" and "Audio Transcription" dropdowns before this plan. The new Planning selector's own `value="gemini-2.5-pro"` entry is present and correct; the count mismatch is just the plan's grep not accounting for pre-existing usages of the same string elsewhere in the file.
- The plan's acceptance-criteria grep `grep -c "<Select$\|<Select" ... shows 5 <Select occurrences` actually returns 37 (the unanchored second alternative matches every `<SelectTrigger>`/`<SelectValue>`/`<SelectContent>`/`<SelectItem>`/`<SelectGroup>`/`<SelectLabel>` substring too). Re-running with the properly anchored pattern `grep -n "^\s*<Select$"` confirms exactly 5 bare `<Select` component openers, matching the plan's actual intent (5 selectors).

## Issues Encountered
- Parallel-execution git race (same precedent as prior Phase 21/21.1 plans): the concurrent plan 22-02 agent's final docs commit (`600ad31`) swept up this plan's in-progress, unstaged working-tree edits to `.planning/STATE.md`, `.planning/ROADMAP.md`, and `.planning/REQUIREMENTS.md` (both agents share the same working directory with no worktree isolation). No content was lost — verified via `git diff HEAD -- .planning/STATE.md .planning/ROADMAP.md .planning/REQUIREMENTS.md` returning zero lines after the fact, confirming this plan's decision bullet, requirement checkbox, and roadmap plan-count edits all landed intact inside `600ad31`. This plan's own code commits (`e81c8f4`, `5fe91ab`) and this SUMMARY.md's own commit (`de79c44`) were staged and verified file-by-file via `git status --short` immediately before each commit, so no code or plan-specific doc was ever mis-attributed.

## User Setup Required

None - no external service configuration required. (The live OpenRouter capability check used a public, unauthenticated `GET /api/v1/models` endpoint — no API key needed.)

## Next Phase Readiness

- Both PLAN-03 surfaces this plan owned are closed: carousel's token budget scales with slide count on both transports, and the admin card fully exposes `ai_models.planning`.
- `scripts/verify-phase-22.ts --only=svc-token-budget` (6/6, including the sibling 22-02 plan's `gemini.service.ts` check, which had already landed by the time this plan's verification ran) and `--only=svc-model-tier` (6/6) both green.
- `npm run check` and `npm run build` both pass end-to-end.
- `verify-phase-21.ts` (43/43) and `verify-phase-21.1.ts` (all green, including its embedded `verify-phase-21.ts` regression check) confirm zero regression from this plan's changes.
- No blockers for the remaining Phase 22 plans (22-04, 22-05, 22-06).

---
*Phase: 22-art-director-planning-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/services/carousel-generation.service.ts
- FOUND: client/src/components/admin/post-creation/ai-models-card.tsx
- FOUND: .planning/phases/22-art-director-planning-upgrade/22-03-SUMMARY.md
- FOUND commit: e81c8f4
- FOUND commit: 5fe91ab
