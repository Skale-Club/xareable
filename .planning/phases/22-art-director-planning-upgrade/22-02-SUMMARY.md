---
phase: 22-art-director-planning-upgrade
plan: 02
subsystem: api
tags: [gemini, openrouter, multimodal, planning, gateway]

# Dependency graph
requires:
  - phase: 22-01
    provides: planning-schema.service.ts (PLANNING_MAX_OUTPUT_TOKENS), aiModelsSchema.planning field, scripts/verify-phase-22.ts harness
provides:
  - GeminiService.generateText() now attaches mergedReferenceImages multimodally on BOTH transports (OpenRouter image_url content parts + direct-Gemini inlineData parts) instead of only a textual "N image(s) provided" sentence
  - The non-video planning call resolves its model from ai_models.planning (default gemini-2.5-pro) instead of the shared ai_models.text_generation
  - Planning output-token ceiling raised from 2048 to 4096 (PLANNING_MAX_OUTPUT_TOKENS) on both transports
affects: [22-04, 22-05, 22-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "buildPlanningContentParts()/buildPlanningGeminiParts() as GeminiService private helpers mirroring generateImage()'s existing inlineData pattern, keeping text-only requests byte-identical (string content, no parts array) when no reference images are present"
    - "contentType === 'video' branch guard used to keep the frozen video planning path (GATE-08) on ai_models.text_generation while the single-image path moves to ai_models.planning"

key-files:
  created: []
  modified:
    - server/services/gemini.service.ts
    - server/routes/generate.routes.ts

key-decisions:
  - "Task 1's plan-authored acceptance-criteria grep (`referenceImages: mergedReferenceImages,` expected exactly 1 match) actually returns 3 in the real file — the other 2 (generateVideo() call, provider.generate() call) already used this exact shape before this plan per the plan's own interfaces section ('ALREADY passed whole to provider.generate() (line 581) and generateVideo() (line 540)'). Not a code issue; the authoritative gate (verify-phase-22.ts --only=svc-multimodal, 6/6 green) already accounts for this correctly."

patterns-established:
  - "Pattern: dedicated admin-configurable model tiers (ai_models.planning) resolved via a content-type branch inside a single shared function (generateText), rather than forking the function, to keep retry/fallback logic unforked across the video/image split"

requirements-completed: [PLAN-01, PLAN-03]

# Metrics
duration: 3min
completed: 2026-07-27
---

# Phase 22 Plan 02: Multimodal Planning Attachment + Higher-Tier Model/Token Budget Summary

**`GeminiService.generateText()` now sends real `image_url`/`inlineData` multimodal parts on both transports whenever reference images exist, resolves its model from the new `ai_models.planning` slug (default `gemini-2.5-pro`) for non-video content, and doubles its output-token ceiling from 2048 to 4096 via `PLANNING_MAX_OUTPUT_TOKENS`.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-27T14:37:00-04:00 (approx, first commit 14:38:49)
- **Completed:** 2026-07-27T14:40:17-04:00 (last commit)
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `GenerateParams.referenceImages` widened from bare `string[]` (base64) to `Array<{ mimeType: string; data: string }>`, matching `generate.routes.ts`'s `mergedReferenceImages` shape exactly.
- Two new private `GeminiService` helpers — `buildPlanningContentParts()` (OpenRouter, reuses Phase 21's `toOpenRouterInputReference()`) and `buildPlanningGeminiParts()` (direct-Gemini, mirrors `generateImage()`'s existing `inlineData` pattern) — wired into `runTextCall`'s two branches. Text-only calls stay byte-identical (plain string / single text part) when no reference images are present.
- `generate.routes.ts`'s planning call site stopped stripping `mimeType` (`referenceImages: mergedReferenceImages,` replacing `.map(img => img.data)`), so the same reference-image set already used for image/video generation now also reaches the planning call.
- `generateText`'s model resolution now branches on `contentType`: video planning keeps reading `ai_models.text_generation` (frozen GATE-08 path, unchanged shape/cost), non-video planning reads the new `ai_models.planning` (default `gemini-2.5-pro`).
- Both transports' `maxTokens`/`maxOutputTokens` literals (`2048`) replaced with `PLANNING_MAX_OUTPUT_TOKENS` (4096, imported from plan 22-01's `planning-schema.service.ts`). `generateCaptionOnly`'s 512-token caption-rescue budget deliberately left untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Attach reference images multimodally to the planning call (PLAN-01)** - `4dffe0d` (feat)
2. **Task 2: Route the planning call to ai_models.planning with a 4096-token ceiling (PLAN-03)** - `8ad38e5` (feat)

**Plan metadata:** (this commit, following SUMMARY.md creation)

## Files Created/Modified
- `server/services/gemini.service.ts` - `GenerateParams.referenceImages` type widened; `buildPlanningContentParts`/`buildPlanningGeminiParts` helpers added; `runTextCall`'s two transports wired to attach images and use `PLANNING_MAX_OUTPUT_TOKENS`; model resolution branches on `contentType` for `ai_models.planning` vs `ai_models.text_generation`
- `server/routes/generate.routes.ts` - planning call site passes full `mergedReferenceImages` objects instead of stripped base64 strings

## Decisions Made
- Kept the plan's literal design verbatim (no substitutions needed) — both helper functions, the `contentType === "video"` branch guard, and the `PLANNING_MAX_OUTPUT_TOKENS` import matched the plan's interfaces section exactly.
- Noted (not fixed) the plan's own acceptance-criteria grep undercount for Task 1 — see `key-decisions` above. The task's actual `<verify><automated>` gate is `verify-phase-22.ts --only=svc-multimodal`, which passed 6/6 and correctly distinguishes the planning call site from the two pre-existing call sites.

## Deviations from Plan

None - plan executed exactly as written. (The acceptance-criteria grep discrepancy noted above required no code change — it's an artifact of the plan's informal checklist not accounting for two pre-existing identical-shape call sites; the binding automated verification passed cleanly.)

## Issues Encountered

None. Ran as a parallel executor alongside plan 22-03 in the same working directory (no worktree isolation) — `git status --short` was checked immediately before both commits, and only the two files in this plan's `files_modified` scope (`server/services/gemini.service.ts`, `server/routes/generate.routes.ts`) were ever staged. Foreign files from the concurrent 22-03 agent (`client/src/components/admin/post-creation/ai-models-card.tsx`, `client/src/lib/translations/{pt,es}.ts`, `server/services/carousel-generation.service.ts`) appeared in `git status` at both commit points but were never added to the index — no git race occurred.

Interestingly, by the time Task 2 ran, `verify-phase-22.ts --only=svc-model-tier` and `--only=svc-token-budget` both showed ALL checks green (including the admin-UI and carousel checks the plan explicitly said would "remain red — belongs to plan 22-03") — the parallel 22-03 agent had already landed that work concurrently. This plan's own scope (gemini.service.ts's model-tier/token-budget checks) is what this plan is responsible for and verified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The planning call's request bodies now carry real reference-image bytes on both transports and read the dedicated `ai_models.planning` tier at 4096 output tokens — ready for plan 22-03's carousel/admin-UI work (already landed concurrently) and later waves (22-04 strict json_schema wiring, 22-05/22-06).
- `server/services/video-generation.service.ts` remains byte-untouched (confirmed via `verify-phase-21.ts` GATE-08 freeze guard, 43/43 green).
- No blockers.

---
*Phase: 22-art-director-planning-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/services/gemini.service.ts (modified, confirmed via git show --stat on both commits)
- FOUND: server/routes/generate.routes.ts (modified, confirmed via git show --stat on commit 4dffe0d)
- FOUND commit: 4dffe0d
- FOUND commit: 8ad38e5
- `npm run check` exits 0
- `npx tsx scripts/verify-phase-22.ts --only=svc-multimodal` exits 0 (6/6)
- `npx tsx scripts/verify-phase-22.ts --only=svc-model-tier` exits 0 (6/6)
- `npx tsx scripts/verify-phase-22.ts --only=svc-token-budget` exits 0 (6/6)
- `npx tsx scripts/verify-phase-21.ts` exits 0 (43/43, GATE-08 video freeze guard intact)
