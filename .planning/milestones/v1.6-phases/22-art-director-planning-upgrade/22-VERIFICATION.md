---
phase: 22-art-director-planning-upgrade
verified: 2026-07-27T20:15:00Z
status: human_needed
score: 5/5 must-haves verified (static/code level); 6/6 live-verification steps pending (deferred by explicit user decision)
human_verification:
  - test: "SC1 live ablation: OPENROUTER_API_KEY=... npx tsx scripts/verify-planning-ablation.ts --image=./reference.jpg"
    expected: "Exit 0, prints ABLATION PROVEN with overlap ratio < 0.95; with-images prompt names subject details only visible in the photo"
    why_human: "Requires a real funded OPENROUTER_API_KEY and a live model call to observe an actual behavioral difference — cannot be simulated without cost"
  - test: "SC2 live structured output: generate one real single-image post in staging with a brand reference photo saved"
    expected: "Post completes; no generation_logs row with event_kind='planning_schema_failure'; usage_events.metadata carries real gateway cost"
    why_human: "Requires staging access and a live OpenRouter-billed generation"
  - test: "SC2 schema-failure hard-fail: force a schema failure per the embedded runbook's documented technique (unsupported model slug or direct-Gemini responseSchema rejection)"
    expected: "SSE error 'The art director planning step could not produce a valid creative plan.'; a generation_logs row with event_kind='planning_schema_failure'; NO new posts row and NO new usage_events row"
    why_human: "Requires deliberately misconfiguring live admin settings and observing production-path behavior end-to-end"
  - test: "GATE-07 rollback parity: PATCH ai-gateway-routing to direct for planning, generate with a reference image, confirm success via direct Gemini path"
    expected: "Generation succeeds via generativelanguage.googleapis.com with inlineData reference parts and the uppercase responseSchema dialect"
    why_human: "Requires a live Gemini API key and toggling production routing config"
  - test: "SC3 carousel token budget: generate an 8-slide carousel"
    expected: "All 8 slides present in the master plan, no truncation"
    why_human: "Requires a live, billed carousel generation to observe real completion behavior"
  - test: "GATE-08 video regression: generate one video"
    expected: "Succeeds via the direct Google path; planning call used ai_models.text_generation, not ai_models.planning"
    why_human: "Requires a live, billed Veo call"
---

# Phase 22: Art Director Planning Upgrade Verification Report

**Phase Goal:** The planning call that drives every single-image generation actually receives reference images multimodally, returns dependable structured JSON from a higher-tier model with a token budget that scales with output size, and its structured output — not a stale mechanical concatenation — is the true source of the final image prompt.
**Verified:** 2026-07-27T20:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Summary

All PLAN-01..04 code-level must-haves are independently verified against the actual source (not just the 54/54 `verify-phase-22.ts` harness, which was also re-run and confirmed green). The remaining phase-closure item — plan 22-06 Task 3, a `checkpoint:human-verify` gate requiring a funded `OPENROUTER_API_KEY`, staging access, and a paid Veo call — was **not performed**, by explicit user/operator decision, and its 6 pending steps are already recorded as `[pending]` in `22-HUMAN-UAT.md`. Per the orchestrator's instruction, this is reflected as `human_needed`, not a blocking gap: the static implementation is real, wired, and correct; only the live/paid proof steps remain outstanding.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Reference images (user + brand) reach the planning call as real multimodal parts on both transports | ✓ VERIFIED | `generate.routes.ts:492` passes `mergedReferenceImages` (full `{mimeType,data}` objects, no longer `.map(img => img.data)`); `gemini.service.ts:726-748` `buildPlanningContentParts`/`buildPlanningGeminiParts` build `image_url`/`inlineData` parts; `toOpenRouterInputReference` imported and used |
| 2 | Non-video planning call uses strict `json_schema`/`responseSchema`; video keeps loose `json_object` | ✓ VERIFIED | `gemini.service.ts:788-791` (`planningResponseFormat` ternary keyed on `isVideoPlanning`), `:887` (`responseSchema: PLANNING_GEMINI_RESPONSE_SCHEMA` gated the same way); video's own prompt template (`:567-597`) is a separate early-return branch, untouched |
| 3 | Schema-validation failure on both attempts is a real, logged, user-visible error — never a silently degraded generic post | ✓ VERIFIED | `gemini.service.ts:947-969`: `isPlanningSchemaError(secondError)` branch fires `logPlanningSchemaFailure` then `throw new PlanningSchemaError(...)`, entirely bypassing the `buildLocalTextFallback` path below it; `generate.routes.ts:514-521` rethrows before `buildTextFallback` (line 529) can run; `deductCredits` (line 881) only executes after image generation + post insert, which never happens on this path |
| 4 | Planning model is admin-configurable at a dedicated higher tier; carousel/single-image token budgets scale | ✓ VERIFIED | `shared/schema.ts:195` `planning: z.string().default("gemini-2.5-pro")` (text_generation untouched at `:182`); `gemini.service.ts:779-782` branches model resolution on `isVideoPlanning`; `PLANNING_MAX_OUTPUT_TOKENS=4096` used on both transports (`:833`, `:882`); `carousel-generation.service.ts` exports `CAROUSEL_TOKEN_BASE=1200`, `CAROUSEL_TOKENS_PER_SLIDE=350`, `carouselPlanMaxTokens()`, wired at both transport call sites (`:285`, `:311`); admin card exposes a 5th "Planning (Art Director)" selector bound to `ai_models.planning` |
| 5 | Model's own `image_prompt` is structurally authoritative; mechanical flattening is a lazy, unreachable-when-present fallback | ✓ VERIFIED | `gemini.service.ts:406-410`: `modelImagePrompt` computed first; `flattenedPrompt` computed only in the `: ""` branch when `modelImagePrompt` is falsy; `buildImagePromptFromStructuredJson`'s JSDoc explicitly documents `FALLBACK-ONLY` (`prompt-builder.service.ts:66`); prompt task 4 (`gemini.service.ts:650`) instructs a 120-200 word dense prose brief and explicitly bans "label fragments" |
| 6 | `text_blocks`/`layout_archetype_id` flow through every `GeminiTextResult` producer (forward-compat for Phase 23) | ✓ VERIFIED | `GeminiTextResult` interface (`:79-92`) carries both fields; `normalizeGeminiTextResult` populates them (`:413-430`); `buildLocalTextFallback` and route-level `buildTextFallback` both populate them too (grep-confirmed) |

**Score:** 6/6 code-level truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/services/planning-schema.service.ts` | Both schema dialects, error/classification contract, validator | ✓ VERIFIED | 509 lines; `PLANNING_JSON_SCHEMA` (OpenRouter, `strict:true`, `additionalProperties:false` at every object level, all required), `PLANNING_GEMINI_RESPONSE_SCHEMA` (uppercase `Type`, `nullable:true`, no `additionalProperties`), `PlanningSchemaError`, `validatePlanningWireResult`, `classifyPlanningFailure`, `isPlanningSchemaError`, `LAYOUT_ARCHETYPE_IDS`, `PLANNING_MAX_OUTPUT_TOKENS=4096` all present and exported exactly as specified |
| `scripts/test-planning-schema-classification.ts` | No-network functional test | ✓ VERIFIED | Independently re-run: 9/9 PASS lines, exit 0 |
| `server/services/gemini.service.ts` | Multimodal builders, model-tier branch, strict schema wiring, hard-fail path, precedence fix | ✓ VERIFIED | All read directly; matches plan text precisely (see Truths 1-6 evidence) |
| `server/routes/generate.routes.ts` | Full reference objects passed through; route-level schema-failure guard | ✓ VERIFIED | `referenceImages: mergedReferenceImages,` (line 492, no stripping); `isPlanningSchemaError(textError)` guard (line 514) precedes `buildTextFallback` |
| `server/services/carousel-generation.service.ts` | Slide-count-scaled token budget | ✓ VERIFIED | `CAROUSEL_TOKEN_BASE=1200`, `CAROUSEL_TOKENS_PER_SLIDE=350`, `carouselPlanMaxTokens()` wired at both `maxTokens`/`maxOutputTokens` call sites; zero leftover flat `2048` |
| `client/src/components/admin/post-creation/ai-models-card.tsx` | 5th "Planning (Art Director)" selector | ✓ VERIFIED | Selector present, bound to `ai_models.planning`, 4 bare structured-outputs-capable slugs offered, grid widened to `xl:grid-cols-5` |
| `shared/schema.ts` | `ai_models.planning` field; widened `event_kind` enum | ✓ VERIFIED | `planning: z.string().default("gemini-2.5-pro")` additive; `event_kind` enum includes `"planning_schema_failure"`; `text_generation` byte-unchanged |
| `server/services/observability.service.ts` | `logPlanningSchemaFailure` emitter | ✓ VERIFIED | Fire-and-forget, try/catch-swallow, emits `event_kind:"planning_schema_failure"`, `outcome:"schema_validation_failed"` |
| `server/services/prompt-builder.service.ts` | `buildImagePromptFromStructuredJson` demoted to FALLBACK-ONLY | ✓ VERIFIED | JSDoc explicitly says "FALLBACK-ONLY (Phase 22, PLAN-04)"; function body unchanged |
| `scripts/verify-phase-22.ts` | Full static/functional gate | ✓ VERIFIED | Independently re-run: 54/54 PASS, exit 0 |
| `scripts/verify-planning-ablation.ts` | OPENROUTER_API_KEY-gated live SC1 harness | ✓ VERIFIED (skip path) | Independently re-run with no key set: prints SKIP line, exit 0 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `generate.routes.ts` `mergedReferenceImages` | `GeminiService.generateText` `params.referenceImages` | full object pass-through | ✓ WIRED | Confirmed line 492; `.map(img => img.data)` stripping confirmed gone (grep, zero hits) |
| `gemini.service.ts` OpenRouter branch | OpenRouter multimodal `content` array | `toOpenRouterInputReference()` | ✓ WIRED | `buildPlanningContentParts` maps images through it; import confirmed at top of file |
| `gemini.service.ts` direct branch | `generativelanguage.googleapis.com` `contents[0].parts` | `inlineData` parts via `buildPlanningGeminiParts` | ✓ WIRED | Confirmed at line 879 |
| `runTextCall` (OpenRouter) | `response_format.json_schema` | `planningResponseFormat` | ✓ WIRED | Confirmed line 834; video carve-out confirmed via `isVideoPlanning` gate |
| `runTextCall` (direct) | `generationConfig.responseSchema` | conditional spread `...(isVideoPlanning ? {} : {responseSchema: ...})` | ✓ WIRED | Confirmed line 887 |
| `generateText` outer catch | `generation_logs.event_kind='planning_schema_failure'` | `logPlanningSchemaFailure` | ✓ WIRED | Confirmed lines 956-963; fires before `throw new PlanningSchemaError` |
| `generate.routes.ts` catch (textError) | SSE error to user, bypassing `buildTextFallback` | `isPlanningSchemaError` guard + rethrow | ✓ WIRED | Confirmed lines 514-521 — rethrow happens strictly before line 529's `buildTextFallback` call; outer catch (line 901) converts to `sse.sendError(500)`; `deductCredits` (line 881) unreachable on this path since no post/image was ever created |
| `carouselPlanMaxTokens(params.slideCount)` | `chatCompletion maxTokens` AND `generationConfig.maxOutputTokens` | both carousel transports | ✓ WIRED | Confirmed at lines 285 and 311 of `carousel-generation.service.ts` |
| `AIModelsCard` planning `<Select>` | `style_catalog.ai_models.planning` | `updateModel("planning", ...)` | ✓ WIRED | Confirmed in `ai-models-card.tsx` |

### Data-Flow Trace (Level 4)

Not applicable in the traditional UI-rendering sense — this phase's artifacts are backend prompt-construction and request-shaping logic, not components rendering fetched state. The equivalent trace (does the schema-validated model output actually reach the image-generation call, rather than a stubbed/static value) was performed as part of Truth 5/6 verification above: `image_prompt` flows from `normalizeGeminiTextResult`'s `modelImagePrompt` (sourced from the live-parsed, schema-validated `raw.image_prompt`) through to `provider.generate({ prompt: textResult.content.image_prompt })` at `generate.routes.ts` (confirmed via the plan's documented call sites, consistent with grep evidence gathered above). No static/hardcoded stand-in was found on this path.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 22 static/functional harness passes | `npx tsx scripts/verify-phase-22.ts` | 54/54 PASS, "All Phase 22 checks passed." | ✓ PASS |
| Schema-vs-transport classification fixture test | `npx tsx scripts/test-planning-schema-classification.ts` | 9/9 PASS | ✓ PASS |
| No regression in Phase 21 | `npx tsx scripts/verify-phase-21.ts` | 43/43 PASS | ✓ PASS |
| No regression in Phase 21.1 | `npx tsx scripts/verify-phase-21.1.ts` | 54/54 PASS | ✓ PASS |
| TypeScript compiles clean | `npm run check` | exit 0, no output | ✓ PASS |
| Production build succeeds | `npm run build` | client + server bundles built, exit 0 | ✓ PASS |
| Ablation harness CI-safe skip path | `npx tsx scripts/verify-planning-ablation.ts` (no key) | `SKIP verify-planning-ablation — OPENROUTER_API_KEY not set...`, exit 0 | ✓ PASS |
| Live SC1 ablation (real API call) | `OPENROUTER_API_KEY=... npx tsx scripts/verify-planning-ablation.ts --image=...` | not run — no funded key in this environment | ? SKIP (routed to human verification) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| PLAN-01 | 22-02, 22-06 | Reference images actually attached (multimodal) to the planning call | ✓ SATISFIED (static) / pending live ablation proof | Multimodal builders wired on both transports (Truth 1); live ablation is the deferred Task 3 item |
| PLAN-02 | 22-01, 22-04, 22-05 | Strict `json_schema` structured output; silent local-fallback removed for schema errors; transport fallback retained | ✓ SATISFIED (static) / pending live structured-output + hard-fail proof | Schema wiring, validator, hard-fail path, and logging all confirmed (Truths 2, 3, 6); live proof is deferred Task 3 |
| PLAN-03 | 22-01, 22-02, 22-03 | Admin-configurable higher-tier planning model; token budget scales with slide count | ✓ SATISFIED (static) / pending live carousel + rollback proof | `ai_models.planning`, admin selector, `carouselPlanMaxTokens` all confirmed (Truth 4); live carousel/GATE-07 proof deferred |
| PLAN-04 | 22-05 | Structured creative plan is source of truth for image prompt; dense natural-language, not mechanical concatenation | ✓ SATISFIED (static) | Lazy-flattening precedence fix and prompt rewrite both confirmed directly in source (Truth 5); no live proof required by the plan for this specific requirement beyond the qualitative spot-check in runbook step 6 |

No orphaned requirements: cross-referencing `.planning/REQUIREMENTS.md`'s "Phase 22" rows (PLAN-01..04) against the `requirements:` frontmatter declared across `22-01-PLAN.md` through `22-06-PLAN.md` shows all four IDs claimed by at least one plan, matching exactly.

### Anti-Patterns Found

None found at blocker or warning severity. No `TODO`/`FIXME`/`PLACEHOLDER` markers, no empty handlers, and no hardcoded-empty stand-ins were found on any of the files touched by this phase's plans. The one "silent generic fallback" pattern this phase specifically targeted (`buildLocalTextFallback` winning over a model-authored `image_prompt`, and schema failures being silently absorbed) was independently confirmed removed:
- `normalizeGeminiTextResult`'s `flattenedPrompt` is computed lazily and only reachable when `modelImagePrompt` is empty (transport-fallback path only).
- The schema-failure path throws before either `buildLocalTextFallback` (service-level) or `buildTextFallback` (route-level) can run.

### Human Verification Required

The following 6 items constitute plan `22-06`'s Task 3 (`checkpoint:human-verify`, `gate="blocking"`), already recorded as `[pending]` in `22-HUMAN-UAT.md` and deferred by explicit user/operator decision (funded `OPENROUTER_API_KEY`, staging access, and a paid Veo call are not available in this environment):

1. **SC1 live ablation (PLAN-01)**
   **Test:** `OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-planning-ablation.ts --image=./reference.jpg`
   **Expected:** Exit 0, `ABLATION PROVEN` with overlap ratio < 0.95; with-images prompt names subject details only visible in the photo.
   **Why human:** Requires a real funded API key and a live, paid model completion to observe an actual behavioral difference.

2. **SC2 live structured output (PLAN-02/03)**
   **Test:** Generate one real single-image post in staging with a brand reference photo saved.
   **Expected:** Post completes; no `generation_logs` row with `event_kind='planning_schema_failure'`; `usage_events.metadata` carries real gateway cost.
   **Why human:** Requires staging access and a live, billed generation.

3. **SC2 schema-failure hard-fail (PLAN-02)**
   **Test:** Force a schema failure per the runbook's documented technique (unsupported model slug, or direct-Gemini `responseSchema` rejection).
   **Expected:** SSE error text "The art director planning step could not produce a valid creative plan."; a `generation_logs` row with `event_kind='planning_schema_failure'`; NO new `posts` row and NO new `usage_events` row.
   **Why human:** Requires deliberately misconfiguring live admin settings and observing the production error path end-to-end.

4. **GATE-07 rollback parity**
   **Test:** PATCH `/api/admin/ai-gateway-routing` `{ call_class: "planning", mode: "direct" }`; generate with a reference image; confirm success via the direct Gemini path; flip back.
   **Expected:** Generation succeeds via `generativelanguage.googleapis.com` using `inlineData` parts and the uppercase `responseSchema` dialect.
   **Why human:** Requires a live Gemini API key and toggling production routing config.

5. **SC3 carousel token budget (PLAN-03)**
   **Test:** Generate an 8-slide carousel.
   **Expected:** All 8 slides present in the master plan; no truncation.
   **Why human:** Requires a live, billed carousel generation.

6. **GATE-08 video regression**
   **Test:** Generate one video.
   **Expected:** Succeeds via the direct Google path; planning call used `ai_models.text_generation`, not `ai_models.planning`.
   **Why human:** Requires a live, billed Veo call.

### Gaps Summary

No code-level gaps found. Every PLAN-01..04 must-have was independently verified by reading the actual source (not just trusting the 54/54 harness or the SUMMARY files' claims), including the three areas specifically flagged for extra scrutiny:

1. **Video carve-out** — confirmed real and consistent across all four surfaces: model-tier resolution (`isVideoPlanning` ternary), response-format selection (`json_object` for video vs. `json_schema` for non-video), the direct-path `responseSchema` conditional spread, and the schema-failure hard-fail branch (`!isVideoPlanning && isPlanningSchemaError(...)`). The video prompt template itself is a separate, untouched early-return branch in `buildContextPrompt`.
2. **Two schema dialects** — confirmed genuinely separate literals: `PLANNING_JSON_SCHEMA` (lowercase types, `strict:true`, `additionalProperties:false` at every object level, `anyOf`-null unions for optional fields) vs. `PLANNING_GEMINI_RESPONSE_SCHEMA` (uppercase `Type` strings, no `additionalProperties`, `nullable:true` for optional fields) — not a shared object with cosmetic differences.
3. **Schema-failure hard-fail path** — confirmed it genuinely bypasses both fallback templates: `buildLocalTextFallback` (service-level, gemini.service.ts) is unreachable once `isPlanningSchemaError(secondError)` is true (the `throw` happens before that code path), and `buildTextFallback` (route-level, generate.routes.ts) is unreachable because the route's catch rethrows before reaching it. `deductCredits` is confirmed to run only after image generation and post insertion succeed, both of which never happen on the schema-failure path — the user is never charged.

The only outstanding item is Phase 22's final operator sign-off (plan 22-06 Task 3) on 6 live/paid verification steps, which was deferred by explicit user decision and is already tracked in `22-HUMAN-UAT.md` and `STATE.md`'s Blockers section. This phase's ROADMAP checkbox is correctly left unchecked pending that sign-off — consistent with the codebase's actual state.

---

*Verified: 2026-07-27T20:15:00Z*
*Verifier: Claude (gsd-verifier)*
