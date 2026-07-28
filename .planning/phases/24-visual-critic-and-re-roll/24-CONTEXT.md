# Phase 24: Visual Critic & Re-roll - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Every generated base image is scored by a multimodal critic on composition, text-legibility zone, color harmony, and unwanted AI-rendered text before it proceeds to compositing; images that fail the threshold automatically re-roll (bounded), the user is still charged exactly once, and SSE timers/AbortSignal are re-derived for the added latency.

</domain>

<decisions>
## Implementation Decisions

### Critic Call & Re-roll Logic (CRIT-01, CRIT-02)
- The critic step is inserted immediately after the image-generation call returns (`server/routes/generate.routes.ts`, right after the try block around line ~613/615), BEFORE the crop → typography compositor → logo overlay pipeline (Phase 23's work) begins.
- Implemented via `chatCompletion` with multimodal content parts (an `image_url` content part carrying the generated image, same shape as `toOpenRouterInputReference`/OpenRouter's existing image-attachment pattern) plus `responseFormat: {type:"json_schema", ...}` for structured scores — following Phase 22's proven json_schema precedent. No new gateway capability needed.
- New admin-configurable `ai_models.critic` field (mirrors Phase 22's `ai_models.planning` field pattern) — a separate call class from `planning`, not repointing the existing field.
- Exact scoring rubric, score scale, and pass/fail thresholds are Claude's technical discretion, informed by research.
- Re-roll trigger logic: unwanted AI-rendered text is an ALWAYS hard-fail gate — an image with detected unwanted text is never accepted, even as a "best available" fallback after the retry cap. Composition/color-harmony/legibility scores below threshold are a soft-fail: sequential re-roll, capped at 2 additional attempts (3 total generations max). If the cap is exhausted without any attempt passing the soft-fail thresholds (but none had hard-fail unwanted text), accept the best-scoring of the 3 attempts rather than failing the entire generation. If ALL 3 attempts hard-fail on unwanted text, the generation genuinely fails and surfaces an error to the user (rare edge case).

### Billing & Cost Tracking (CRIT-03)
- No structural billing change — reuses the existing single `recordUsageEvent`/`deductCredits` call site in `generate.routes.ts` (already runs exactly once, after the full pipeline including any re-roll loop completes).
- The user is billed the real cost of ONLY the final accepted attempt (normal Phase 21 real-cost billing behavior) — not the sum of all re-roll attempts.
- The cost of discarded re-roll attempts (extra image-gen + critic calls) is tracked separately in the usage event's `metadata` field (e.g. `reroll_cost_usd_micros`, `reroll_attempt_count`) as platform-side, informational cost — never added to what the user is charged.

### SSE Timer & AbortSignal (CRIT-04)
- Adopt the `AbortController`+`signal` pattern already used in `carousel.routes.ts`/`enhance.routes.ts` into `generate.routes.ts`, which currently has neither (only a bare `setTimeout` with no abort capability).
- New safety-timeout value is derived from a formula (base + critic-call-latency-estimate + up to 2 extra re-roll image-gen-call-latency-estimates) — exact formula/value is Claude's technical discretion. The existing 280s constant is a carried-over Vercel serverless kill-window assumption, not a real Coolify constraint (production has been on Coolify/long-running-host since 2026-05-30) — it may be revised upward as needed, not treated as a ceiling.
- Unlike the existing "cooperative" AbortSignal pattern elsewhere (checked only between awaited pipeline stages, never reaching the actual `fetch()`/SDK calls), this phase threads a REAL abort signal into `ai-gateway.service.ts`'s underlying `fetch()`/SDK calls (`chatCompletion`, `generateImage`/`callImageApi`) so that a fired timer genuinely cancels in-flight network requests — this is what SC3/CRIT-04 literally requires ("the wired AbortSignal actually cancels the in-flight call").

### Observability (CRIT-05)
- New `event_kind: "visual_critic"` added to the existing `generation_logs.event_kind` Zod enum (widen, no migration — the column is unconstrained TEXT, same precedent as `model_fallback`/`planning_schema_failure`).
- New `logVisualCritic()` function in `observability.service.ts`, following the exact fire-and-forget pattern of `logCaptionQuality`/`logPlanningSchemaFailure` — records scores, `attempt_count`, and text-free compliance once per generation (whether it ultimately passed, exhausted the re-roll cap, or hard-failed), never blocks the response.

### Resolved Design Questions (from research)
- **GATE-07 "direct" rollback parity for the critic call class:** NOT in scope. The critic is a new, additive call class (not one of Phase 21's originally-migrated call classes) — it is OpenRouter-only, with no direct-Gemini fallback path. Keeps the phase's scope minimal; can be added later if ever needed.
- **Re-roll retry prompt strategy:** re-roll attempts use the IDENTICAL generation prompt (no critic-feedback injection into the retry). Keeps the re-roll loop simple and avoids a second class of prompt-engineering complexity in this phase — sequential blind retry, not adaptive retry.
- **`chatCompletion()`'s hardcoded `"text"` call-class fallback:** research found `chatCompletion()` currently hardcodes its fallback-chain call class to `"text"` with no parameter to override it — using it unmodified for the critic would silently share the planning/caption/pre-screen fallback chain, contradicting the "separate call class" decision above. Add one additive optional `callClass` param to `chatCompletion()` (defaulting to `"text"` for full backward compatibility with all existing callers) so the critic call site can pass `callClass: "critic"`.

### Claude's Discretion
- Exact critic scoring rubric, score scale, and pass/fail thresholds.
- Exact new SSE safety-timeout formula/value.
- Exact `ai_models.critic` default model slug (must be vision/multimodal-capable — verify live at implementation time, following Phase 22's precedent of re-verifying model capability against the live OpenRouter catalog rather than assuming).
- Exact `generation_logs.metadata` shape for critic scores/re-roll cost tracking.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/services/ai-gateway.service.ts`'s `chatCompletion()` already supports multimodal `content` arrays (used today for audio input, and image attachment via `toOpenRouterInputReference`'s shape) — the critic call reuses this, no new gateway plumbing.
- Phase 22's `json_schema` structured-output precedent (`planning-schema.service.ts`) — pattern to mirror for the critic's structured score response.
- `carousel.routes.ts`/`enhance.routes.ts`'s existing `AbortController` + safety-timer pattern (`CAROUSEL_SAFETY_TIMEOUT_MS = GENERATION_SAFETY_TIMEOUT_MS - 20_000`) — pattern to port into `generate.routes.ts`, then extend further (real fetch-level abortion, not just cooperative stage checks).
- `observability.service.ts`'s `logCaptionQuality`/`logPlanningSchemaFailure` fire-and-forget pattern — template for `logVisualCritic`.
- Phase 22's `ai_models.planning` admin-configurable-model-slug precedent (`ai-models-card.tsx`, `ai_gateway_routing`/`ai_models` settings pattern) — template for `ai_models.critic`.

### Established Patterns
- `generate.routes.ts`'s single post-pipeline `recordUsageEvent`/`deductCredits` call site (after full pipeline, including any future re-roll loop) — billing invariant naturally supports "bill once" as long as only the final accepted attempt's cost feeds the charge.
- `generation_logs.event_kind` is an unconstrained TEXT column — new event kinds are additive Zod-enum widens, no migration needed.

### Integration Points
- `server/routes/generate.routes.ts` — critic/re-roll loop inserted right after image generation (~line 613-615), before Phase 23's crop/typography/logo pipeline; new `AbortController` replacing the current bare `setTimeout`.
- `server/services/ai-gateway.service.ts` — `chatCompletion`/`generateImage`/`callImageApi` gain a `signal?: AbortSignal` parameter threaded into their actual `fetch()`/SDK calls (currently absent entirely — even the existing "cooperative" pattern in `enhancement.service.ts` doesn't reach this layer).
- `shared/schema.ts` — `generation_logs.event_kind` enum widened with `"visual_critic"`.
- `server/services/observability.service.ts` — new `logVisualCritic()`.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP's stated success criteria and REQUIREMENTS.md's CRIT-01..05 — these are the primary specification, cross-checked against the codebase scout above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
