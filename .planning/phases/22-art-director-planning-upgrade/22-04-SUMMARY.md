---
phase: 22-art-director-planning-upgrade
plan: 04
subsystem: api
tags: [gemini, openrouter, structured-outputs, json-schema, error-handling, observability]

# Dependency graph
requires:
  - phase: 22-01
    provides: planning-schema.service.ts (PLANNING_JSON_SCHEMA, PLANNING_GEMINI_RESPONSE_SCHEMA, PlanningSchemaError, validatePlanningWireResult, classifyPlanningFailure, isPlanningSchemaError), logPlanningSchemaFailure
  - phase: 22-02
    provides: generateText()'s multimodal reference-image attachment + ai_models.planning model-tier resolution + PLANNING_MAX_OUTPUT_TOKENS wiring (the exact runTextCall shape this plan edits)
provides:
  - GeminiService.generateText() now requests strict json_schema (OpenRouter) / responseSchema (direct-Gemini) for non-video planning, validating every parsed payload via validatePlanningWireResult before normalization
  - A double schema-validation failure on the planning retry throws PlanningSchemaError (logged to generation_logs as event_kind='planning_schema_failure') instead of silently returning buildLocalTextFallback()'s generic template
  - generate.routes.ts's inner catch(textError) discriminates isPlanningSchemaError and rethrows before buildTextFallback() can absorb it; the route's existing outer catch converts that into an SSE 500 for the user
affects: [22-05, 22-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "validate-before-normalize: raw parsed JSON is run through validatePlanningWireResult() BEFORE normalizeGeminiTextResult(), since normalize is deliberately defensive/lenient and would otherwise paper over a schema-invalid payload with local defaults"
    - "schema-vs-transport discrimination happens once, at the outer two-attempt catch (on secondError only) — CONTEXT.md's exact wording ('if the retry ALSO fails schema validation') is honored literally, so a transport blip on attempt 2 after a schema failure on attempt 1 still takes the pre-existing local-fallback path"

key-files:
  created: []
  modified:
    - server/services/gemini.service.ts
    - server/routes/generate.routes.ts

key-decisions:
  - "Two of the plan's own literal acceptance-criteria greps overcounted by 1 due to substring collisions with surrounding prose/type-annotations, not code issues: grep -n '{ type: \"json_object\" }' returns 2 (the runtime ternary branch on line 747 PLUS the TypeScript union-type annotation on line 745 that spells out the same literal string as part of its type declaration); grep -c 'buildTextFallback(' in generate.routes.ts returns 3 (the function definition, the single remaining call site, PLUS a code comment that mentions 'buildTextFallback()'s generic template'). Both were verified functionally correct via the plan's actual binding gate (verify-phase-22.ts --only=svc-schema / --only=svc-schema-failure-log, both fully green) — same category of informal-grep-undercount precedent documented in 22-02-SUMMARY.md."

patterns-established: []

requirements-completed: [PLAN-02]

# Metrics
duration: 3min
completed: 2026-07-27
---

# Phase 22 Plan 04: Strict Structured Output + Loud Schema Failures Summary

**`GeminiService.generateText()`'s single-image planning call now requests strict `json_schema`/`responseSchema` structured output on both transports, validates every parsed payload before normalization, and — on a double schema-validation failure — throws a logged `PlanningSchemaError` that the route layer rethrows as a real user-facing error instead of silently degrading to a generic templated post.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-27T14:52:04-04:00 (first commit)
- **Completed:** 2026-07-27T14:54:29-04:00 (last commit)
- **Tasks:** 3 completed
- **Files modified:** 2

## Accomplishments
- Non-video planning requests now carry `response_format: { type: "json_schema", json_schema: PLANNING_JSON_SCHEMA }` on the OpenRouter transport and `generationConfig.responseSchema: PLANNING_GEMINI_RESPONSE_SCHEMA` on the direct-Gemini rollback transport; the frozen video planning call keeps the loose `{ type: "json_object" }` shape on both, byte-equivalent to before.
- Every parsed planning payload (both transports, both attempts) runs through `validatePlanningWireResult()` before `normalizeGeminiTextResult()` — the raw model text is captured in `lastRawResponseText` for later log payloads regardless of which transport answered.
- If the retry (attempt 2) also fails schema validation for non-video planning, `generateText()` fires `logPlanningSchemaFailure()` (writing a `generation_logs` row with `event_kind='planning_schema_failure'`, `outcome='schema_validation_failed'`, `post_id: null`) and then throws `PlanningSchemaError` with a user-facing message — `buildLocalTextFallback()` is no longer reachable from a schema-validation failure. Transport failures (network/auth/empty completion) and the frozen video path are completely unchanged and still return the local-fallback template.
- `generate.routes.ts`'s inner `catch (textError)` now checks `isPlanningSchemaError(textError)` first, logs it via the existing `logGenerationError()` call, and rethrows — bypassing `buildTextFallback()` entirely for schema failures. The route's pre-existing outer catch (unchanged) converts the rethrown error into `sse.sendError({ message, statusCode: 500 })`. Manually traced the full path: `runTextCall(1) throws -> runTextCall(2) throws PlanningSchemaError -> logPlanningSchemaFailure -> throw PlanningSchemaError -> route catch(textError) -> isPlanningSchemaError -> logGenerationError -> rethrow -> outer catch -> sse.sendError(500)`. Confirmed via grep that `deductCredits()` (line ~879) is called well after the post-insert (line ~802), which is itself well after the text-generation try/catch (lines ~480-533) — no credits are ever deducted on this path.

## Task Commits

Each task was committed atomically:

1. **Task 1: Request strict structured output on both transports (PLAN-02)** - `f2d1022` (feat)
2. **Task 2: Hard-fail + log exhausted schema failures instead of silently templating (PLAN-02)** - `bbda60b` (feat)
3. **Task 3: Stop the route-level fallback from absorbing schema failures (PLAN-02)** - `16d0d03` (fix)

**Plan metadata:** (this commit, following SUMMARY.md creation)

## Files Created/Modified
- `server/services/gemini.service.ts` - Extended the planning-schema import block (added `PLANNING_JSON_SCHEMA`, `PLANNING_GEMINI_RESPONSE_SCHEMA`, `PlanningSchemaError`, `validatePlanningWireResult`, `isPlanningSchemaError`) and `logPlanningSchemaFailure` from `observability.service.js`; added `planningResponseFormat` selector + `lastRawResponseText` capture slot; both `runTextCall` transport branches now validate-before-normalize and set `responseFormat`/`responseSchema`; the innermost `catch (secondError)` block now discriminates schema vs. transport failures, logging + throwing `PlanningSchemaError` on the former while leaving the latter's `buildLocalTextFallback()` path untouched.
- `server/routes/generate.routes.ts` - Added `isPlanningSchemaError` import; the inner `catch (textError)` around the `generateText()` call now rethrows schema failures (after logging) before falling through to the unchanged `buildTextFallback()` template path.

## Decisions Made
See `key-decisions` in frontmatter — both are documentation of plan-authored acceptance-criteria grep overcounts (substring collisions with prose/type text), not code changes. The plan's actual binding automated gates (`verify-phase-22.ts --only=svc-schema`, `--only=svc-schema-failure-log`) passed fully green in both cases, confirming the implementation itself is correct.

## Deviations from Plan

None - plan executed exactly as written. (The two acceptance-criteria grep discrepancies noted above required no code change — they are artifacts of the plan's informal checklist not accounting for substring matches inside comments/type annotations; the binding `<verify><automated>` gates passed cleanly on first attempt for all three tasks.)

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `scripts/verify-phase-22.ts` full run: 47/47 green across all tags this plan's scope covers (`svc-schema-module`, `svc-model-tier`, `svc-token-budget`, `svc-multimodal`, `svc-schema`, `svc-schema-failure-log`); the only remaining reds are the 4 `svc-prompt-precedence` checks, which are plan 22-05's (PLAN-04) scope, not this plan's.
- `npm run check` exits 0; `scripts/test-planning-schema-classification.ts` exits 0 (9/9); `scripts/verify-phase-21.ts` exits 0 (43/43, GATE-08 freeze guard intact, no regression); `scripts/verify-phase-21.1.ts` exits 0 (54/54, no regression).
- The planning call's failure topology is now exactly as CONTEXT.md locked it: schema failures are loud (logged + thrown + surfaced to the user), transport failures and the frozen video path are byte-equivalent to Phase 21. `buildLocalTextFallback` (service-level) and `buildTextFallback` (route-level) both still exist with clearly non-overlapping roles — no third fallback template was introduced.
- No blockers. Ready for plan 22-05 (PLAN-04, image_prompt precedence fix) and 22-06.

---
*Phase: 22-art-director-planning-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/services/gemini.service.ts (modified, confirmed via git show --stat on commits f2d1022 and bbda60b)
- FOUND: server/routes/generate.routes.ts (modified, confirmed via git show --stat on commit 16d0d03)
- FOUND commit: f2d1022
- FOUND commit: bbda60b
- FOUND commit: 16d0d03
- `npm run check` exits 0
- `npx tsx scripts/verify-phase-22.ts --only=svc-schema` exits 0 (25/25 for that filter's checks incl. svc-schema-module)
- `npx tsx scripts/verify-phase-22.ts --only=svc-schema-failure-log` exits 0 (7/7)
- `npx tsx scripts/verify-phase-22.ts` (full run) shows 47/47 green outside the 4 out-of-scope svc-prompt-precedence checks
- `npx tsx scripts/test-planning-schema-classification.ts` exits 0 (9/9)
- `npx tsx scripts/verify-phase-21.ts` exits 0 (43/43, no regression)
- `npx tsx scripts/verify-phase-21.1.ts` exits 0 (54/54, no regression)
