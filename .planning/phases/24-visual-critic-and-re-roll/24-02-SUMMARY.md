---
phase: 24-visual-critic-and-re-roll
plan: 02
subsystem: infra
tags: [openrouter, ai-gateway, abortsignal, fetch, openai-sdk]

# Dependency graph
requires:
  - phase: 24-01
    provides: "FallbackCallClass widened with 'critic', ai_models.critic schema, scripts/verify-phase-24.ts svc-abort-signal tag scaffold"
provides:
  - "chatCompletion(params.callClass) — additive optional call class, defaults to 'text', 100% backward compatible with all 6 existing callers"
  - "chatCompletion(params.signal) — real AbortSignal threaded into the openai SDK's chat.completions.create() RequestOptions second argument"
  - "GatewayImageParams.signal — real AbortSignal threaded into callImageApi's fetch('https://openrouter.ai/api/v1/images', ...) RequestInit"
  - "ImageGenerationInput.signal — forwarded by OpenRouterImageProvider.generate into gatewayGenerateImage; NOT honored by GeminiImageProvider/OpenAIImageProvider (documented gap)"
affects: [24-05, 24-06, 24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive optional param widening a hardcoded literal: replace N hardcoded occurrences with one resolved local (params.X ?? defaultValue), verify all existing callers still resolve to the same default"
    - "AbortSignal threading via the underlying transport's native cancellation channel (openai SDK RequestOptions 2nd arg for chatCompletion; native fetch RequestInit.signal for callImageApi), not cooperative between-stage checks"

key-files:
  created: []
  modified:
    - server/services/ai-gateway.service.ts
    - server/services/image-provider.ts

key-decisions:
  - "Signal passed as the openai SDK's SECOND argument to chat.completions.create(), never inside the request body — RequestOptions.signal is a distinct channel from the payload"
  - "callImageApi's fetch() carries signal directly in RequestInit; generateImage/editImage needed zero changes since they already spread the full params object through to callImageApi/gatewayGenerateImage"
  - "GeminiImageProvider and OpenAIImageProvider deliberately left without a signal field — an unused optional field on a provider that can't honor it would invite a false 'wired' reading; the gap is documented in-code above GeminiImageProvider instead"
  - "ImageEditInput and OpenAIImageProvider untouched — no caller in this phase passes a signal there"

patterns-established:
  - "Scope-fence-in-code pattern: when a capability (real AbortSignal) is deliberately NOT extended to a code path (GeminiImageProvider's direct-Gemini rollback), document the gap as a comment directly above the affected code rather than leaving it silently absent"

requirements-completed: [CRIT-01, CRIT-04]

# Metrics
duration: ~20min
completed: 2026-07-28
---

# Phase 24 Plan 02: Gateway callClass + Real AbortSignal Threading Summary

**`chatCompletion()` gains an additive `callClass` param (defaulting to `"text"`) and a real `AbortSignal` wired to the openai SDK's `RequestOptions`; the OpenRouter Image API's `fetch()` and `OpenRouterImageProvider.generate()` gain the same real-cancellation wiring — all 6 existing `chatCompletion` callers verified byte-unchanged.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-28
- **Tasks:** 2/2 complete
- **Files modified:** 2

## Accomplishments
- `ChatCompletionParams` gained two optional fields: `callClass?: FallbackCallClass` (default `"text"`) and `signal?: AbortSignal`
- Both hardcoded `"text"` literals inside `chatCompletion` (the fallback-chain lookup and the `callWithFallback` call class argument) replaced with one resolved local: `const callClass = params.callClass ?? "text"`
- `client.chat.completions.create()` now receives `{ signal: params.signal }` as its second argument (openai SDK 6.38.0's `RequestOptions.signal?: AbortSignal | undefined | null`, confirmed live in `node_modules/openai/internal/request-options.d.ts`) — a fired signal genuinely cancels the in-flight fetch, not just a between-stage cooperative check
- `GatewayImageParams` gained `signal?: AbortSignal`; `callImageApi`'s `fetch("https://openrouter.ai/api/v1/images", {...})` now includes `signal: params.signal` in its `RequestInit`
- `generateImage`/`editImage` needed no code changes — both already spread the full `params` object through to `callImageApi`, so they transparently inherit the widened interface
- `ImageGenerationInput` (image-provider.ts) gained `signal?: AbortSignal`, forwarded only by `OpenRouterImageProvider.generate` into `gatewayGenerateImage({ ..., signal: input.signal })`
- A scope-fence comment was added directly above `GeminiImageProvider` documenting that the GATE-07 direct-Gemini rollback path receives no signal at all — a deliberate, 24-CONTEXT.md-scoped omission, not an oversight
- `transcribe()`, `ImageEditInput`, and `OpenAIImageProvider` were deliberately left untouched — out of scope per the plan

## Task Commits

1. **Task 1: chatCompletion gains additive callClass + real signal** - `b56dcf6` (feat)
2. **Task 2: Thread a real signal into the Image API fetch and the OpenRouter image provider** - `264fbb4` (feat)

## Files Created/Modified
- `server/services/ai-gateway.service.ts` - `ChatCompletionParams.callClass`/`.signal`; `chatCompletion`'s resolved `callClass` local replacing both hardcoded `"text"` literals; `signal` passed as `chat.completions.create`'s 2nd argument; `GatewayImageParams.signal`; `callImageApi`'s `fetch()` now includes `signal: params.signal`
- `server/services/image-provider.ts` - `ImageGenerationInput.signal`; scope-fence comment above `GeminiImageProvider`; `OpenRouterImageProvider.generate` forwards `signal: input.signal` into `gatewayGenerateImage`

## Backward-Compatibility Verification — the 6 existing `chatCompletion` call sites

Per the plan's explicit output requirement, all 6 pre-Phase-24 callers were opened and confirmed to pass neither `callClass` nor `signal`, so each resolves `callClass === "text"` (identical fallback chain/model_fallback log behavior as before this plan) and `signal === undefined` (an `undefined` signal in `RequestOptions` is explicitly allowed by the installed SDK's typings, equivalent to no signal at all):

1. `server/services/caption-quality.service.ts:73`
2. `server/services/carousel-generation.service.ts:280`
3. `server/services/enhancement.service.ts:252` (pre-screen, image attached, `json_object`)
4. `server/services/enhancement.service.ts:497`
5. `server/services/gemini.service.ts:523`
6. `server/services/gemini.service.ts:834` (planning, image attached, `json_schema`)

Confirmed via `grep -rn 'callClass:\|signal:' server/services/{caption-quality,carousel-generation,enhancement,gemini}.service.ts` returning zero matches inside any `chatCompletion({...})` call — none of the 6 files were edited by this plan.

## Decisions Made
- Followed the plan's exact interface diffs and comment text — no deviation from the specified shape for `callClass`/`signal` on either `ChatCompletionParams` or `GatewayImageParams`/`ImageGenerationInput`
- Confirmed `generateImage`/`editImage` needed zero edits by reading them rather than assuming (per the plan's explicit instruction) — both spread `params` through unmodified

## Deviations from Plan

### Judgment Calls

**1. [Judgment call — REQUIREMENTS.md accuracy] Did NOT run `requirements mark-complete` for CRIT-01/CRIT-04**
- **Found during:** State-update step (post-Task-2)
- **Issue:** This plan's frontmatter lists `requirements: [CRIT-01, CRIT-04]`, but this plan delivers only the enabling gateway plumbing (additive `callClass` param + real `AbortSignal` threading into the underlying transport calls) — not the actual multimodal critic call CRIT-01 describes (plan 24-05's job) nor the full SSE-timer/AbortController wiring in `generate.routes.ts` that CRIT-04 describes (plan 24-06's job, confirmed by this plan's own acceptance criteria: "`verify-phase-24.ts --only=svc-abort-signal` shows checks 1-5 and 9 as PASS (checks 6-8 stay red until plan 24-06 wires generate.routes.ts)"). Follows the identical precedent set by 24-01-SUMMARY.md's judgment call on the same requirement IDs.
- **Action taken:** Skipped `node gsd-tools.cjs requirements mark-complete CRIT-01 CRIT-04`. REQUIREMENTS.md's CRIT-01/CRIT-04 rows remain `Pending` — accurate to actual delivery state. The frontmatter's `requirements-completed` field still lists both IDs per the template's literal instruction (association for the dependency graph, not verified completion).
- **Files modified:** None (a non-action)
- **Verification:** `grep 'CRIT-01\|CRIT-04' .planning/REQUIREMENTS.md` still shows both as `- [ ]` / `Pending`
- **Committed in:** N/A (no REQUIREMENTS.md change made)

---

**Total deviations:** 0 auto-fixed, 1 judgment call (protecting requirements-traceability accuracy)
**Impact on plan:** No code deviation from the plan as written. The requirements decision keeps REQUIREMENTS.md truthful; plan 24-05 (critic call) and plan 24-06 (generate.routes.ts wiring) should mark CRIT-01/CRIT-04 complete when their own verification is green.

## Issues Encountered
None. All acceptance-criteria greps and both `verify-phase-24.ts --only=svc-abort-signal` runs matched the plan's expected PASS/FAIL split exactly (checks 1-2 and 9 green after Task 1; checks 1-5 and 9 green after Task 2, checks 6-8 correctly still red pending plan 24-06's `generate.routes.ts` wiring).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 24-05 (visual-critic.service.ts) can now call `chatCompletion({ ..., callClass: "critic" })` to get its own fallback chain, isolated from the `text` chain used by planning/caption/pre-screen
- Plan 24-06 (`generate.routes.ts` AbortController wiring) can now pass a real `signal` into both `chatCompletion` (for the critic call) and `provider.generate`/`gatewayGenerateImage` (for re-roll image-gen attempts) and expect genuine network-level cancellation, not just a cooperative stage check
- The GATE-07 direct-Gemini rollback path's signal gap is documented in code; no follow-up action expected this milestone (critic is OpenRouter-only per 24-CONTEXT.md)
- No blockers

---
*Phase: 24-visual-critic-and-re-roll*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/services/ai-gateway.service.ts
- FOUND: server/services/image-provider.ts
- FOUND: b56dcf6 (Task 1 commit)
- FOUND: 264fbb4 (Task 2 commit)
