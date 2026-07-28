---
phase: 22-art-director-planning-upgrade
plan: 01
subsystem: api
tags: [zod, json-schema, openrouter, gemini, structured-outputs, observability]

# Dependency graph
requires:
  - phase: 21-openrouter-gateway-foundation
    provides: chatCompletion()/ai-gateway.service.ts gateway, getCallRouting(), toOpenRouterInputReference(), model_fallback generation_logs precedent
provides:
  - scripts/verify-phase-22.ts — 51-check Phase 22 gate with --only=<tag> filter (28 green now, 23 red awaiting later waves)
  - server/services/planning-schema.service.ts — both wire schema dialects (OpenRouter json_schema + direct-Gemini responseSchema), PlanningSchemaError, classifyPlanningFailure, isPlanningSchemaError, validatePlanningWireResult
  - scripts/test-planning-schema-classification.ts — 9-assertion no-network fixture test
  - shared/schema.ts aiModelsSchema.planning (admin-configurable planning-tier model slug, default gemini-2.5-pro)
  - shared/schema.ts generationLogSchema.event_kind widened with "planning_schema_failure"
  - server/services/observability.service.ts logPlanningSchemaFailure emitter
affects: [22-02, 22-03, 22-04, 22-05, 22-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two hand-written schema-dialect literals sharing one TS interface tree (PlanningWirePlan) instead of a Zod-to-JSON-Schema codegen layer — Gemini's uppercase Type enum divergence makes a shared converter not worth building"
    - "PlanningSchemaError classification (schema vs transport) as a pure, no-network function — mirrors ai-gateway.service.ts's model_fallback fire-and-forget logging pattern"
    - "readSafe() sources loaded once at harness top so --only=<tag> checks against not-yet-created later-wave files don't throw"

key-files:
  created:
    - scripts/verify-phase-22.ts
    - server/services/planning-schema.service.ts
    - scripts/test-planning-schema-classification.ts
  modified:
    - shared/schema.ts
    - server/services/observability.service.ts
    - client/src/components/admin/post-creation/ai-models-card.tsx

key-decisions:
  - "Re-verified gemini-2.5-pro against openrouter.ai/api/v1/models?supported_parameters=structured_outputs on 2026-07-27: it DOES support structured_outputs, correcting 22-RESEARCH.md's earlier finding that none of the 3 admin-dropdown Gemini slugs qualified. Kept the plan's literal default (gemini-2.5-pro) rather than substituting gemini-3.5-flash."
  - "validatePlanningWireResult enforces image_prompt length / text_blocks shape / layout_archetype_id enum / creative_plan shape at runtime rather than via JSON-Schema keywords (minLength/enum-of-object), since strict-mode JSON Schema doesn't reliably support those constraints."

patterns-established:
  - "Pattern: PlanningWire* interfaces (zero `?` optionals, explicit `| null`) named distinctly from gemini.service.ts's normalized Gemini* types to avoid collision when Wave 2+ wires them together"

requirements-completed: [PLAN-02, PLAN-03]

# Metrics
duration: 12min
completed: 2026-07-27
---

# Phase 22 Plan 01: Verification Harness + Planning-Schema Contracts Summary

**Built the Phase 22 verification harness (51 live checks, `--only=<tag>` filter) plus the standalone `planning-schema.service.ts` module carrying both wire-format schema dialects (OpenRouter `json_schema` strict mode and direct-Gemini uppercase `responseSchema`), a schema-vs-transport failure classifier, and the `ai_models.planning` / `logPlanningSchemaFailure` observability plumbing later waves will wire into `gemini.service.ts`.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-27T13:59Z (first commit)
- **Completed:** 2026-07-27T14:09Z (last commit)
- **Tasks:** 3 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `scripts/verify-phase-22.ts` created as a structural copy of `verify-phase-21.1.ts`'s skeleton, with 51 real (non-stub) assertions across 8 tags; self-test green immediately, full run red (28/51 green after this plan, 23 remaining for later waves) — proves the checks are live signals, not stubs.
- `server/services/planning-schema.service.ts` exports both schema dialects (OpenRouter strict `json_schema` with `additionalProperties: false` at 13 object levels / every property required / nullable unions for `text_rendering` and `logo_integration`; a separate direct-Gemini `responseSchema` in the uppercase `Type` dialect with `nullable: true`), `PlanningSchemaError`, `classifyPlanningFailure`, `isPlanningSchemaError`, and `validatePlanningWireResult` — all proven by a 9-assertion no-network fixture test.
- `aiModelsSchema.planning` added (default `gemini-2.5-pro`, live-reverified against OpenRouter's structured-outputs-capable model list), `text_generation` left untouched, and `generationLogSchema.event_kind` widened with `"planning_schema_failure"` (no migration — the column is unconstrained TEXT).
- `logPlanningSchemaFailure` added to `observability.service.ts`, mirroring the `model_fallback` fire-and-forget contract established in Phase 21.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the Phase 22 verification harness with live (red) checks** - `336b4ca` (feat)
2. **Task 2: Create planning-schema.service.ts (both dialects + error/classification contracts) and its fixture test** - `adc4cd0` (test, RED) → `4b349dd` (feat, GREEN)
3. **Task 3: Add ai_models.planning, widen event_kind, add logPlanningSchemaFailure** - `cdf9bc8` (feat)

**Plan metadata:** (this commit, following SUMMARY.md creation)

## Files Created/Modified
- `scripts/verify-phase-22.ts` - Phase 22 static/functional gate, 51 checks across 8 tags, `--only=<tag>` filter
- `server/services/planning-schema.service.ts` - Both wire schema dialects + error/classification/validation contracts
- `scripts/test-planning-schema-classification.ts` - 9-assertion no-network functional test
- `shared/schema.ts` - `aiModelsSchema.planning` field; `generationLogSchema.event_kind` widened
- `server/services/observability.service.ts` - `logPlanningSchemaFailure` emitter
- `client/src/components/admin/post-creation/ai-models-card.tsx` - fallback default literal gained a `planning` key (Rule 3 auto-fix, see Deviations)

## Decisions Made
- Live-reverified the `gemini-2.5-pro` default against OpenRouter's `structured_outputs`-capable model catalog (2026-07-27) rather than trusting 22-RESEARCH.md's earlier snapshot, which had found none of the 3 admin-dropdown Gemini slugs qualified. The live check now confirms `google/gemini-2.5-pro` supports `structured_outputs`, so the plan's literal default was kept as-is (no substitution needed).
- Reworded two header-comment phrases in `planning-schema.service.ts` (from the plan's suggested text) to avoid the bare word "additionalProperties" appearing outside an `additionalProperties: false` literal — needed so the file's `additionalProperties: false` count and total `additionalProperties` count stay equal, satisfying the plan's own acceptance-criteria grep. Meaning is unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed TS compile break in ai-models-card.tsx caused by the new required `planning` field**
- **Found during:** Task 3 (adding `aiModelsSchema.planning`)
- **Issue:** `aiModelsSchema.planning` has `.default(...)`, making its z.infer output type a required (non-optional) `string`. `ai-models-card.tsx`'s fallback default object literal (`catalog.ai_models || {...}`) only had the original 4 fields, so `npm run check` failed with a type error once `planning` became part of the required `AIModels` shape.
- **Fix:** Added `planning: "gemini-2.5-pro"` to the fallback literal. This is a type-safety-only fix — it does NOT add the admin dropdown UI slot for `planning` (no new `<Select>`, no `updateModel("planning"` call site); that UI work is out of this plan's `files_modified` scope and is deferred to a later Phase 22 plan (confirmed via `verify-phase-22.ts --only=svc-model-tier`, which still correctly shows those 2 checks red).
- **Files modified:** `client/src/components/admin/post-creation/ai-models-card.tsx`
- **Verification:** `npm run check` exits 0; `verify-phase-22.ts --only=svc-model-tier` shows exactly the 4 checks this plan's scope covers as green, the 2 UI/gemini.service.ts checks belonging to later plans remain red.
- **Committed in:** `cdf9bc8` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep `npm run check` green after the additive schema change; no scope creep — the actual planning-model admin UI selector remains for a later plan.

## Issues Encountered
None beyond the deviation above.

## User Setup Required

None - no external service configuration required. (The live OpenRouter capability check used a public, unauthenticated `GET /api/v1/models` endpoint — no API key needed.)

## Next Phase Readiness

- All contracts plans 22-02 through 22-05 need are now in place and compile-clean: both schema dialects, the error/classification pair, the `ai_models.planning` field, and `logPlanningSchemaFailure`.
- `scripts/verify-phase-22.ts` gives every subsequent wave a `<10s automated feedback loop` via `--only=<tag>`; 23 checks remain red by design, scoped to `gemini.service.ts`, `carousel-generation.service.ts`, `generate.routes.ts`, and `prompt-builder.service.ts` edits in later plans.
- No blockers. `git diff` confirms `server/services/gemini.service.ts` is byte-unchanged by this plan (per the plan's own success criterion) — existing `GeminiCreativePlan`/`GeminiStructuredImagePrompt` consumers are untouched.

---
*Phase: 22-art-director-planning-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: scripts/verify-phase-22.ts
- FOUND: server/services/planning-schema.service.ts
- FOUND: scripts/test-planning-schema-classification.ts
- FOUND: .planning/phases/22-art-director-planning-upgrade/22-01-SUMMARY.md
- FOUND commit: 336b4ca
- FOUND commit: adc4cd0
- FOUND commit: 4b349dd
- FOUND commit: cdf9bc8
- Confirmed `git diff HEAD~4 -- server/services/gemini.service.ts` is empty (0 lines) — byte-unchanged, satisfying the plan's own success criterion.
