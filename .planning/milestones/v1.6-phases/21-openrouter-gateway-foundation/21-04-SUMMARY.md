---
phase: 21-openrouter-gateway-foundation
plan: 04
subsystem: api
tags: [openrouter, openai-sdk, gateway, chat-completion, transcription, fallback-chain]

# Dependency graph
requires:
  - phase: 21-openrouter-gateway-foundation (21-03)
    provides: ai-gateway-settings.service.ts (getCallRouting, getFallbackChain, setCallRouting, setFallbackChain) + config.OPENROUTER_API_KEY
provides:
  - "server/services/ai-gateway.service.ts core: chatCompletion(), transcribe(), callWithFallback(), normalizeOpenRouterModelSlug(), OPENROUTER_BASE_URL"
  - "One-pass fallback-chain execution helper reusable by the image call classes landing in 21-05"
  - "Best-effort model_fallback event logging to generation_logs"
affects: [21-05-image-calls, 21-07-gemini-service-migration, 21-08-carousel-caption-enhancement-migration, 21-09-transcribe-routes-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "openai npm SDK pointed at OpenRouter's baseURL (https://openrouter.ai/api/v1) with defaultHeaders attribution (HTTP-Referer, X-Title) instead of raw fetch against generativelanguage.googleapis.com"
    - "callWithFallback<T>(primary, fallbacks[], callClass, callFn) — one-pass generic fallback loop; fallback-worthy errors detected via message regex (404/410/5xx/model_not_found), any other error rethrows immediately without exhausting the chain"
    - "Best-effort logging via try/catch-swallow (mirrors observability.service.ts) so a logging failure never breaks the generation flow"

key-files:
  created:
    - server/services/ai-gateway.service.ts
  modified: []

key-decisions:
  - "transcribe() implemented via chatCompletion's multimodal input_audio content part (not the openai SDK's whisper-only audio.transcriptions.create) — preserves admin-configurability of the same Gemini-family model already used via style_catalog.ai_models.audio_transcription"
  - "normalizeOpenRouterModelSlug() defaults bare model names (no '/') to the google/ provider prefix — keeps existing style_catalog.ai_models values (stored bare today) working without a data migration"
  - "OpenAI client instance cached by API key (single-entry cache) to avoid re-constructing the SDK client on every call within the same platform-key process"

patterns-established:
  - "Pattern: any future OpenRouter call class (image calls in 21-05) reuses callWithFallback() rather than writing its own retry loop"

requirements-completed: [GATE-01, GATE-03, GATE-04]

# Metrics
duration: 5min
completed: 2026-07-27
---

# Phase 21 Plan 04: AI Gateway Core (chatCompletion + transcribe) Summary

**Built the OpenRouter-backed `chatCompletion()` and `transcribe()` entrypoints in `server/services/ai-gateway.service.ts`, wrapped in a shared one-pass fallback-chain helper with best-effort `model_fallback` logging to `generation_logs`.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-27T14:01:27Z
- **Completed:** 2026-07-27T14:06:00Z (approx)
- **Tasks:** 2/2 completed
- **Files modified:** 1 (created)

## Accomplishments
- `ai-gateway.service.ts` created with the openai SDK client factory pointed at OpenRouter's `baseURL`, carrying `HTTP-Referer`/`X-Title` attribution headers
- `callWithFallback()` generic one-pass fallback loop implemented — first success wins, fallback-worthy errors detected via 404/410/5xx/model_not_found regex, any other error rethrows immediately
- `chatCompletion()` (GATE-01) — reads the `text` fallback chain from `ai-gateway-settings.service.ts` unless the caller supplies its own, extracts `usage.cost` into `costUsdMicros` for billing
- `transcribe()` (GATE-03) — reuses `chatCompletion`'s call pattern via the multimodal `input_audio` content part, same fallback-chain + cost-extraction contract
- Best-effort `logModelFallback()` writes `event_kind: "model_fallback"` rows to `generation_logs`, swallowing all errors (never breaks generation)

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold ai-gateway.service.ts — client factory, fallback loop, chatCompletion()** - `02843bf` (feat)
2. **Task 2: transcribe() — audio transcription via chatCompletion's multimodal input_audio content part** - `3603b4b` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `server/services/ai-gateway.service.ts` - New gateway service: `OPENROUTER_BASE_URL`, `OPENROUTER_ATTRIBUTION_HEADERS`, `normalizeOpenRouterModelSlug()`, `callWithFallback()`, `chatCompletion()`, `transcribe()`, plus their param/result types

## Decisions Made
- None beyond what's already documented in 21-CONTEXT.md/21-RESEARCH.md — plan's literal code was implemented as specified, since it was already fully designed against the verified 21-03 interfaces and live-verified OpenRouter error shapes.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' code blocks were used verbatim; all acceptance criteria (grep patterns for exports, attribution headers, `event_kind: "model_fallback"`, `input_audio`, `getFallbackChain("transcription")`) matched on first pass, and `npm run check` exited 0 after each task.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. (`OPENROUTER_API_KEY` env var was already added to `server/config/index.ts` in Plan 21-03; no new call sites wired to this file yet, so no live OpenRouter traffic is generated by this plan.)

## Next Phase Readiness

- `ai-gateway.service.ts` now exports the full text/transcription contract (`chatCompletion`, `transcribe`, `callWithFallback`, `normalizeOpenRouterModelSlug`, `OPENROUTER_BASE_URL`) that Plans 21-07/21-08/21-09 will import to migrate `gemini.service.ts`, `carousel-generation.service.ts`, `caption-quality.service.ts`, `enhancement.service.ts`, and `transcribe.routes.ts`.
- Plan 21-05 (image call classes) can now add `generate()`/`edit()` to this same file and reuse `callWithFallback()` unchanged.
- No call sites are wired yet — verified via `grep -c "export "` returning 11 (all exports intact) and no stray `generativelanguage.googleapis.com` references added to this file.
- No blockers.

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/services/ai-gateway.service.ts
- FOUND: 02843bf (Task 1 commit)
- FOUND: 3603b4b (Task 2 commit)
