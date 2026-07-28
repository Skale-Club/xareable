---
phase: 22-art-director-planning-upgrade
plan: 05
subsystem: api
tags: [gemini, prompt-engineering, structured-outputs, art-direction]

# Dependency graph
requires:
  - phase: 22-01
    provides: planning-schema.service.ts (PLANNING_JSON_SCHEMA/PLANNING_GEMINI_RESPONSE_SCHEMA field descriptions already stating the "THE authoritative art-direction brief" / 120-200 word contract, LAYOUT_ARCHETYPE_IDS, DEFAULT_LAYOUT_ARCHETYPE_ID, validatePlanningWireResult's MIN_IMAGE_PROMPT_LENGTH floor)
  - phase: 22-04
    provides: strict json_schema/responseSchema request wiring + validate-before-normalize pipeline this plan's normalizeGeminiTextResult rewrite slots into
provides:
  - buildContextPrompt's non-video task list now instructs the model that image_prompt is THE authoritative 120-200 word prose art-direction brief (task 4), documents text_blocks/layout_archetype_id (task 5), and no longer tells the model to deprioritize image_prompt in favor of structured_image_prompt
  - normalizeGeminiTextResult computes the mechanical flattening lazily (only when raw.image_prompt is empty), making the label-fragment concatenation structurally unreachable whenever the model produced a prompt
  - GeminiTextResult carries text_blocks: TextBlock[] and layout_archetype_id: LayoutArchetypeId end-to-end (normalize, buildLocalTextFallback, route-level buildTextFallback) for Phase 23's typography compositor
affects: [23]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "lazy-fallback-computation: expensive/undesirable fallback values (buildImagePromptFromStructuredJson's flattening) are computed only inside the branch that needs them, not eagerly before a `||` chain — makes precedence a structural property of the code, not an ordering convention that can silently invert"

key-files:
  created: []
  modified:
    - server/services/gemini.service.ts
    - server/services/prompt-builder.service.ts
    - server/routes/generate.routes.ts

key-decisions:
  - "planning-schema.service.ts (plan 22-01) already carried the load-bearing field descriptions ('THE authoritative art-direction brief... 120-200 words...') inside PLANNING_JSON_SCHEMA/PLANNING_GEMINI_RESPONSE_SCHEMA — this plan's Task 1 scope was specifically the separate human-readable buildContextPrompt() task-list text (a different string sent alongside the schema), which still contained the old deprioritizing 'Optionally provide a flattened image_prompt' instruction. Both now agree."

patterns-established: []

requirements-completed: [PLAN-02, PLAN-04]

# Metrics
duration: 5min
completed: 2026-07-27
---

# Phase 22 Plan 05: Art Director Prompt Precedence Fix Summary

**The planning prompt now tells the model `image_prompt` is THE authoritative 120-200 word prose art-direction brief (not an optional flattened afterthought), and `normalizeGeminiTextResult` computes the mechanical label-fragment flattening lazily so it can never win over a model-authored prompt.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-27T15:00:36-04:00 (session start, following 22-04)
- **Completed:** 2026-07-27T15:05:16-04:00 (last commit)
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- Rewrote `buildContextPrompt`'s non-video task item 4 (previously "Optionally provide a flattened image_prompt string, but prioritize the creative_plan.structured_image_prompt object") into an explicit instruction that `image_prompt` is THE authoritative art-direction brief handed verbatim to the image model, briefed as a 120-200 word continuous-prose paragraph covering subject state, camera framing/angle, lens/depth-of-field, lighting setup/direction, surface/material texture, background treatment, named brand-color placement, mood, and reserved negative space for typography — explicitly banning bullet points and label fragments like "Composition: ..., Lighting: ...". Added new task 5 documenting `text_blocks`/`layout_archetype_id`; renumbered the caption instruction to task 6. Updated the JSON response-format example to match (removed "optional flattened image prompt string", added the `text_blocks`/`layout_archetype_id` example keys). The video planning branch (`if (isVideo) { ... }`, lines ending at 567) is byte-unchanged — confirmed via `git diff` showing the only hunks are below that boundary.
- Made precedence structural in `normalizeGeminiTextResult`: `flattenedPrompt` is now computed lazily inside a ternary keyed on `modelImagePrompt` (the trimmed `raw?.image_prompt`), so `buildImagePromptFromStructuredJson` is only ever invoked when the model produced no prompt at all. The old eager `const flattenedPrompt = structuredImagePrompt ? buildImagePromptFromStructuredJson(...) : ""` followed by `raw?.image_prompt || flattenedPrompt || ""` is gone — there is no longer an `||` chain where the mechanical concatenation could win.
- `GeminiTextResult` gained `text_blocks: TextBlock[]` and `layout_archetype_id: LayoutArchetypeId`, populated by all three producers: `normalizeGeminiTextResult` (validates/clamps the model's raw `text_blocks`/`layout_archetype_id` to at most 3 valid role-tagged blocks and one of the three known archetypes, defaulting to `DEFAULT_LAYOUT_ARCHETYPE_ID`), `buildLocalTextFallback` (passes through `params.textBlocks` clamped to 3, defaults the archetype), and `generate.routes.ts`'s route-level `buildTextFallback` (same shape, using the imported `DEFAULT_LAYOUT_ARCHETYPE_ID` constant rather than a bare string literal so it type-narrows to `LayoutArchetypeId`).
- `buildImagePromptFromStructuredJson`'s JSDoc in `prompt-builder.service.ts` now explicitly documents it as `FALLBACK-ONLY (Phase 22, PLAN-04)`, explaining it is reachable only on the transport-failure local-template path and must never be reintroduced as a primary or `||`-preferred path. Its function body is unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite the art-director task block so image_prompt is the authoritative dense brief (PLAN-04)** - `561655b` (feat)
2. **Task 2: Make precedence structural and carry text_blocks / layout_archetype_id (PLAN-04, PLAN-02)** - `35f971a` (feat)

**Plan metadata:** (this commit, following SUMMARY.md creation)

## Files Created/Modified
- `server/services/gemini.service.ts` - Rewrote non-video `buildContextPrompt` task items 4-6 + response-format example; extended `GeminiTextResult` interface; added `TEXT_BLOCK_ROLES` value import and `LAYOUT_ARCHETYPE_IDS`/`DEFAULT_LAYOUT_ARCHETYPE_ID`/`LayoutArchetypeId` to the planning-schema import block; rewrote `normalizeGeminiTextResult`'s tail (lazy flattening + text_blocks/layout_archetype_id passthrough with validation/clamping); extended `buildLocalTextFallback`'s return.
- `server/services/prompt-builder.service.ts` - Replaced `buildImagePromptFromStructuredJson`'s JSDoc with a FALLBACK-ONLY warning; function body untouched.
- `server/routes/generate.routes.ts` - Extended the `isPlanningSchemaError` import to also pull `DEFAULT_LAYOUT_ARCHETYPE_ID`; `buildTextFallback`'s `content` literal gained `text_blocks`/`layout_archetype_id` fields.

## Decisions Made
See `key-decisions` in frontmatter — plan 22-01 had already written the correct load-bearing field *descriptions* inside the strict JSON schemas; this plan's actual gap (confirmed via the plan's own read_first step) was the separate human-readable task-list prose in `buildContextPrompt()`, which is sent as the user-facing instructions alongside (not inside) the schema and still contained the old deprioritizing wording. No code-level ambiguity encountered beyond what the plan already anticipated.

## Deviations from Plan

None - plan executed exactly as written. Every action, code block, and acceptance-criteria grep in the plan matched the real codebase state exactly (all greps passed on first attempt for both tasks); no architectural questions arose.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `scripts/verify-phase-22.ts` full run: 51/51 green (all four `svc-prompt-precedence` checks now pass; every check from plans 22-01 through 22-04 still green — no regression).
- `npm run check` exits 0; `npm run build` succeeds (client + server bundles built cleanly).
- `scripts/verify-phase-21.ts` exits 0 (43/43, GATE-08 freeze guard intact, no regression); `scripts/verify-phase-21.1.ts` exits 0 (54/54, no regression); `scripts/test-planning-schema-classification.ts` exits 0 (9/9).
- Read-back check: confirmed via grep that `buildImagePromptFromStructuredJson(` has exactly 2 call sites in `gemini.service.ts` — one inside `normalizeGeminiTextResult`'s lazy ternary (gated on `modelImagePrompt` being empty) and one inside `buildLocalTextFallback` (itself only reachable on the transport-failure path per 22-04's contract) — neither can execute when `raw.image_prompt` is a non-empty string.
- `GeminiTextResult.text_blocks`/`layout_archetype_id` are now populated end-to-end and ready for Phase 23's typography compositor to consume; Phase 22's remaining scope is plan 22-06.
- No blockers. Ready for plan 22-06.

---
*Phase: 22-art-director-planning-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/services/gemini.service.ts (modified, confirmed via git show --stat on commits 561655b and 35f971a)
- FOUND: server/services/prompt-builder.service.ts (modified, confirmed via git show --stat on commit 35f971a)
- FOUND: server/routes/generate.routes.ts (modified, confirmed via git show --stat on commit 35f971a)
- FOUND commit: 561655b
- FOUND commit: 35f971a
- `npm run check` exits 0
- `npm run build` succeeds
- `npx tsx scripts/verify-phase-22.ts --only=svc-prompt-precedence` exits 0 (4/4)
- `npx tsx scripts/verify-phase-22.ts` (full run) shows 51/51 green
- `npx tsx scripts/verify-phase-21.ts` exits 0 (43/43, no regression)
- `npx tsx scripts/verify-phase-21.1.ts` exits 0 (54/54, no regression)
- `npx tsx scripts/test-planning-schema-classification.ts` exits 0 (9/9)
