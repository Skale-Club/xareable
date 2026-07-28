---
phase: 23-deterministic-typography-and-edit-fidelity
plan: 05
subsystem: api
tags: [gemini, openrouter, planning-schema, prompt-engineering, typography]

# Dependency graph
requires:
  - phase: 23-04
    provides: "typography-compositor.service.ts's ARCHETYPE_NEGATIVE_SPACE_ZONE (archetype-to-negative-space-copy map)"
provides:
  - "buildNegativeSpaceInstruction/buildTextFidelityInstruction/buildTextStyleCopyInstruction replacing buildTextModeInstruction/buildTextStyleInstruction in gemini.service.ts"
  - "structured_image_prompt schema (both OpenRouter json_schema and direct-Gemini responseSchema dialects) with the legacy text_rendering sub-object removed entirely"
  - "prompt-builder.service.ts's buildImagePromptFromStructuredJson with its text_rendering flattening branch removed (FALLBACK-ONLY path can no longer emit typography direction)"
  - "text_mode reframed to planning-call wording fidelity per 23-CONTEXT.md's locked semantic shift"
affects: [23-06, 23-07, 23-10, 23-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Negative-space prompt inversion: buildNegativeSpaceInstruction addresses the PLANNING model (image_prompt must reserve the chosen archetype's zone) instead of the image model (render this text)"
    - "text_mode governs planning-call wording fidelity (verbatim/guided/auto for text_blocks), not image-model literalness"
    - "Text-style catalog's prompt_hints.typography/layout/avoid are no longer read anywhere — only label/description/emphasis inform text_blocks tone"
    - "Declaration-vs-call-site grep-count discipline: buildNegativeSpaceInstruction's parameter list is formatted across multiple lines specifically so its declaration does not literally contain the substring 'buildNegativeSpaceInstruction(params', keeping the harness's call-site count accurate"

key-files:
  created: []
  modified:
    - server/services/gemini.service.ts
    - server/services/planning-schema.service.ts
    - server/services/prompt-builder.service.ts
    - scripts/test-planning-schema-classification.ts

key-decisions:
  - "buildLocalTextFallback (no LLM in the loop) does not interpolate buildTextStyleCopyInstruction or the post-Task-3 buildTextHierarchyInstruction wording — both address a PLANNING model, and there is no planning model on this transport-failure path; interpolating planning-facing meta-commentary directly into a raw image_prompt would be nonsensical even though it wouldn't reintroduce a text-rendering leak"
  - "structured_image_prompt.text_rendering removed entirely rather than repurposed — every one of its six fields is now derived deterministically downstream (text_blocks duplicates headline_text/subtext_text, layout_archetype_id is text_placement, the TYPO-03 contrast/scrim algorithm is readability/text_contrast, bundled Inter weights are typography_style) and keeping a second non-authoritative copy would let the planning model contradict text_blocks"
  - "3 doc-comment-vs-acceptance-criterion self-contradictions in the plan text were resolved by paraphrasing (never spelling out the literal forbidden old-identifier or 'text_rendering' substring in a nearby comment) rather than by relaxing the harness's zero-occurrence checks — the harness (scripts/verify-phase-23.ts) is authoritative and unmodifiable per its ownership note"
  - "requestedText/selectedTextStyles/highlightText/supportText locals in buildDefaultCreativePlan were removed once text_rendering's removal made them dead code in that function (they remain used, unchanged, elsewhere in the file for other call paths)"

patterns-established:
  - "When a plan's own suggested doc-comment text collides with that same plan's zero-occurrence grep acceptance criterion, prefer paraphrasing over reintroducing the forbidden literal — verified via the plan's own inline verify one-liners before committing each task"

requirements-completed: [TYPO-01]

# Metrics
duration: 12min
completed: 2026-07-27
---

# Phase 23 Plan 05: Text-Free Prompt Inversion Summary

**Inverted all four AI-renders-text prompt/schema leak channels in gemini.service.ts/planning-schema.service.ts/prompt-builder.service.ts into a negative-space, compositor-only contract — `scripts/verify-phase-23.ts --only=svc-text-free-prompt` now 23/23 green**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-27T21:45:00Z (approx, from first task commit)
- **Completed:** 2026-07-27T21:57:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Deleted `buildTextModeInstruction` (which told the image model to "Render these on-image text blocks EXACTLY as provided") and `buildTextStyleInstruction` (which concatenated literal "Typography directions: ..." into the image prompt), replacing them with `buildNegativeSpaceInstruction` (reserved-negative-space request to the planning model, sourced from `ARCHETYPE_NEGATIVE_SPACE_ZONE`), `buildTextFidelityInstruction` (planning-call wording fidelity per `text_mode`), and `buildTextStyleCopyInstruction` (tone/word-choice only, reading `prompt_hints.emphasis` but never `.typography`/`.layout`/`.avoid`)
- `buildLocalTextFallback` (the transport-failure, no-LLM-in-the-loop path) now uses `buildNegativeSpaceInstruction(params, DEFAULT_LAYOUT_ARCHETYPE_ID)` directly instead of any planning-facing instruction string
- `buildContextPrompt`'s non-video task list injects the negative-space instruction adjacent to task 4 (the authoritative `image_prompt` brief) and the fidelity + style-copy instructions adjacent to task 5 (the `text_blocks` task); task 3's residual "the text rendering rules above must be respected" branch and task 4's authoritative-paragraph sentence both now assert text-free explicitly
- Removed `structured_image_prompt.text_rendering` entirely from both planning-schema dialects (OpenRouter `json_schema` and direct-Gemini `responseSchema`), the matching `GeminiStructuredImagePrompt` TS member, `buildDefaultCreativePlan`'s hardcoded literal, and the embedded planning-prompt JSON example's `text_rendering` block
- Removed `prompt-builder.service.ts`'s `text_rendering` flattening branch (`Render this headline text prominently: "..."` / `Typography: ...`) from `buildImagePromptFromStructuredJson` — the FALLBACK-ONLY path can no longer emit typography direction on either the no-model-prompt path or the transport-failure `flattenedPrompt || image_prompt` path
- Closed the remaining residual leak phrases: the non-video `languageInstruction` line, `IMAGE_PROMPT_DESCRIPTION`, `TEXT_BLOCKS_DESCRIPTION`, `LAYOUT_ARCHETYPE_DESCRIPTION`, and the embedded JSON example's sample `text_blocks` value all now either assert text-free or explicitly name the server-side compositor as consumer
- `scripts/verify-phase-23.ts --only=svc-text-free-prompt` is fully green (23/23, all four leak channels closed); zero regression on Phases 21 (43/43), 21.1 (54/54), 22 (54/54); `npm run check` clean; the GATE-08 frozen video branch of `buildContextPrompt` and all of `video-generation.service.ts` are byte-unchanged (confirmed via `git diff`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace the three image-facing prompt builders with planning/compositor-facing ones** - `f252404` (feat)
2. **Task 2: Excise the legacy text_rendering sub-object from the schema, the flattener, and the prompt's JSON example** - `1bd0e29` (feat)
3. **Task 3: Sweep the remaining AI-renders-text prompt residue and turn the phase tag green** - `1743ca2` (fix)

_Note: no TDD tasks in this plan — all three are `type="auto"` prompt/schema-editing work, verified via the plan's inline eval scripts and `scripts/verify-phase-23.ts --only=<tag>`._

## Files Created/Modified
- `server/services/gemini.service.ts` — `buildNegativeSpaceInstruction`/`buildTextFidelityInstruction`/`buildTextStyleCopyInstruction` replace `buildTextModeInstruction`/`buildTextStyleInstruction`; `buildTextHierarchyInstruction` reframed for the compositor's type scale; `buildDefaultCreativePlan`, `buildLocalTextFallback`, and `buildContextPrompt` all updated to the new instruction set; `GeminiStructuredImagePrompt.text_rendering` removed; embedded JSON example's `text_rendering` block and sample text removed; `languageInstruction`'s non-video branch reworded
- `server/services/planning-schema.service.ts` — `structured_image_prompt.text_rendering` removed from `PlanningWireStructuredImagePrompt`, both dialect literals (`PLANNING_JSON_SCHEMA`, `PLANNING_GEMINI_RESPONSE_SCHEMA`), and both `required` arrays; `TEXT_RENDERING_DESCRIPTION` constant removed; `IMAGE_PROMPT_DESCRIPTION`/`TEXT_BLOCKS_DESCRIPTION`/`LAYOUT_ARCHETYPE_DESCRIPTION` gained explicit text-free/compositor-consumer language
- `server/services/prompt-builder.service.ts` — `buildImagePromptFromStructuredJson`'s `text_rendering` flattening block removed; `FALLBACK-ONLY` doc block gained one clarifying line
- `scripts/test-planning-schema-classification.ts` — removed the now-nonexistent `text_rendering: null,` field from the typed `validFixture`

## Decisions Made
- **`structured_image_prompt.text_rendering` removed entirely, not repurposed** — every field had a deterministic downstream owner post-Phase-23 (see key-decisions in frontmatter); keeping a second copy would let the planning model contradict `text_blocks`.
- **`buildLocalTextFallback` does not call `buildTextStyleCopyInstruction` or interpolate the updated `buildTextHierarchyInstruction`** — both explicitly address a planning model ("do NOT ask the image model to draw them" / "do NOT describe typography... in image_prompt"), and there is no planning model in this transport-failure loop. Feeding that meta-commentary straight into a raw `image_prompt` would be nonsensical even though it would not reintroduce an actual text-rendering leak. Documented inline in the code and here per the plan's own instruction to record this choice.
- **Task 1's task-3 bullet `- The selected text style directions: ${labels}` was deleted rather than moved to task 5** — it was fully redundant with the new `buildTextStyleCopyInstruction` injection already placed adjacent to task 5, and task 3 feeds `structured_image_prompt` (which no longer has any typography surface to receive it).
- **`buildNegativeSpaceInstruction`'s parameter list is formatted across multiple lines** (`(\n  params: GenerateParams,\n  archetypeId?: LayoutArchetypeId,\n): string`) specifically so the literal substring `buildNegativeSpaceInstruction(params` does not appear in its own declaration — this keeps the plan's own call-site grep count (`== 2`: the `buildLocalTextFallback` and `buildContextPrompt` call sites) accurate, since the declaration would otherwise be a third accidental match. This mirrors 23-04's precedent of formatting doc comments/declarations around literal-substring grep constraints.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Three self-contradicting doc-comment/acceptance-criterion collisions in the plan text**
- **Found during:** Tasks 1 and 2, while running the plan's own inline `<verify>` one-liners
- **Issue:** The plan's literal suggested doc-comment text for (a) `buildTextStyleCopyInstruction` ("renamed from buildTextStyleInstruction, which concatenated..."), (b) `buildDefaultCreativePlan`'s removal-site comment ("...structured_image_prompt.text_rendering channel was removed..."), and (c) `prompt-builder.service.ts`'s `FALLBACK-ONLY` doc addendum ("the text_rendering branch was removed...") each spell out a literal identifier/string (`buildTextStyleInstruction`, `text_rendering`) that the SAME task's own zero-occurrence grep acceptance criteria (and, in two cases, the immutable `scripts/verify-phase-23.ts` harness) require to be completely absent from that file.
- **Fix:** Paraphrased all three doc comments to preserve their documentation intent without reproducing the forbidden literal substring (e.g. "renamed from the prior text-style prompt builder", "the legacy structured-image-prompt typography sub-object", "the legacy structured-prompt typography sub-object's flattening branch").
- **Files modified:** `server/services/gemini.service.ts`, `server/services/prompt-builder.service.ts`
- **Verification:** Re-ran each task's inline `<verify>` node one-liner after the fix — all zero-occurrence assertions pass; `scripts/verify-phase-23.ts --only=svc-text-free-prompt` confirms zero regressions from the paraphrasing.
- **Committed in:** `f252404` (Task 1), `1bd0e29` (Task 2) — fixed inline before each task's commit, so no separate fix-up commit was needed.

---

**Total deviations:** 1 auto-fixed (Rule 1, three instances of the same class of issue)
**Impact on plan:** Pure documentation-wording fix; zero functional/behavioral change. All harness checks and acceptance criteria pass as originally specified.

## Issues Encountered
None beyond the doc-comment/grep-criterion collisions documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `gemini.service.ts`'s planning prompt now asks exclusively for a text-free `image_prompt` with reserved archetype negative space, and `text_blocks`/`layout_archetype_id` are the sole on-image-copy channel — ready for plan 23-06 to wire `compositeTypography()` into `generate.routes.ts`'s crop → typography → logo pipeline using these fields as its only inputs.
- `planning-schema.service.ts`'s `structured_image_prompt` no longer has any surface a future plan could accidentally reintroduce typography direction through — the schema is now a clean single-purpose art-direction contract.
- `scripts/verify-phase-23.ts --only=svc-text-free-prompt` is 23/23 green; full-harness run stands at 55 PASS / 17 FAIL, with every remaining failure scoped to plans 23-06 through 23-11 (edit base-image wiring, verify/repair removal, Docker fontconfig, remake UI) — none touch this plan's files.
- No blockers identified for downstream plans.

---
*Phase: 23-deterministic-typography-and-edit-fidelity*
*Completed: 2026-07-27*

## Self-Check: PASSED

`server/services/gemini.service.ts`, `server/services/planning-schema.service.ts`, `server/services/prompt-builder.service.ts`, and `scripts/test-planning-schema-classification.ts` confirmed present and modified on disk; all 3 task commits (`f252404`, `1bd0e29`, `1743ca2`) confirmed in `git log --oneline -5`.
