# Phase 24: Visual Critic & Re-roll - Research

**Researched:** 2026-07-27
**Domain:** Multimodal LLM structured-output scoring (OpenRouter `chatCompletion` + vision + `json_schema`), AbortController/AbortSignal real-cancellation threading through the `openai` SDK and raw `fetch()`, additive billing-metadata accumulation, fire-and-forget observability logging
**Confidence:** HIGH for codebase mechanics (every integration point read in full, exact line numbers verified against the live file, not the CONTEXT.md scouting draft); MEDIUM for the exact critic-model default slug and SSE-timeout constants (fast-moving OpenRouter catalog + no empirical latency measurement available in this research pass — flagged explicitly below)

## Summary

This phase inserts a new multimodal scoring step into `server/routes/generate.routes.ts`'s image branch, between the existing image-generation call and the existing Phase 23 crop/typography/logo pipeline. No new gateway capability is required — `chatCompletion()` already supports both multimodal `content` arrays (proven today by `enhancement.service.ts`'s pre-screen call) and `json_schema` strict structured output (proven today by Phase 22's art-director planning call, which is the ONLY existing call site in this codebase that combines an attached image with `json_schema` strict mode — this is real, shipped precedent, not a hypothetical). The critic call reuses that exact plumbing: `toOpenRouterInputReference()` to wrap the freshly-generated image buffer as a base64 `image_url` content part, and a new `CRITIC_JSON_SCHEMA` literal mirroring `PLANNING_JSON_SCHEMA`'s dialect.

Three things in the existing code are NOT as reusable as CONTEXT.md's scouting pass assumed, and are the most important findings of this research pass:

1. **`chatCompletion()` hardcodes its fallback call-class to `"text"`** (`ai-gateway.service.ts` lines 133-138) — it has no `callClass` parameter at all. Every existing caller (planning, enhancement pre-screen, enhancement caption) is silently lumped into the `ai_model_fallbacks.text` chain and logged as `call_class: "text"` on fallback. If the critic call is wired through bare `chatCompletion()` as-is, it will inherit that SAME text fallback chain — which may contain non-vision models — defeating CONTEXT.md's explicit "separate call class from planning" decision. This needs a small additive change (new optional `callClass` param, default `"text"` for 100% backward compatibility).
2. **Numeric `minimum`/`maximum` JSON-Schema keywords are not proven reliable under this gateway's strict mode** — Phase 22's own code comment (`planning-schema.service.ts` line 22-26) explicitly avoided a length keyword for exactly this reason ("OpenAI-style strict mode does not reliably support those keywords"), preferring runtime validation instead. The critic schema should follow the SAME precedent the planning schema already uses successfully: bound each score with an `enum` of allowed integers (proven to work today via `layout_archetype_id`'s `enum`), not `minimum`/`maximum`.
3. **The AbortSignal threading is genuinely net-new** — no fetch/SDK call in this codebase currently receives a real `AbortSignal`. The existing `carousel.routes.ts`/`enhance.routes.ts` pattern (`controller.signal` on an `AbortController`) is checked ONLY cooperatively between awaited stages (`if (params.signal?.aborted) throw/break`) and never passed into the underlying `fetch()`/SDK call. Both the `openai` SDK (installed `6.38.0`) and Node's global `fetch()` DO support real cancellation via a `signal` option — confirmed directly from the installed package's typings — so the plumbing is a small, low-risk addition, not a discovery project.

**Primary recommendation:** Restructure the existing single-shot image-gen try/catch (`generate.routes.ts` lines 572-613) into a bounded `for` loop (max 3 iterations) that calls `provider.generate(...)` then a new `runVisualCritic(...)` helper after each attempt; accumulate re-roll cost/attempt metadata locally; keep the SINGLE existing `recordUsageEvent`/`deductCredits` call site (lines 880-905) completely unchanged in position, only widening `recordUsageEvent`'s signature with one new optional `extraMetadata` parameter.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CRIT-01 | A multimodal critic call scores every generated image on composition, text legibility zone, color harmony, and unwanted-AI-text before post-processing | `chatCompletion()` + `toOpenRouterInputReference()` + new `CRITIC_JSON_SCHEMA` (mirrors `PLANNING_JSON_SCHEMA`'s proven strict-mode dialect); insertion point verified at generate.routes.ts line 613-615, before line 656's crop comment |
| CRIT-02 | On threshold failure the pipeline re-rolls sequentially (cap 2 attempts); unwanted rendered text is a hard-fail gate | Loop-restructuring pattern documented below; existing `provider.generate()` call (line 596-603) is directly re-callable with identical params per attempt |
| CRIT-03 | Re-rolls are integrated with the billing invariant — user charged once; platform-side re-roll cost tracked in usage event metadata | `recordUsageEvent()` (quota.ts lines 579-633) needs one new optional `extraMetadata` param; single call site at generate.routes.ts lines 880-896 stays put |
| CRIT-04 | SSE safety timers re-derived for gateway+critic latency budget; AbortSignal wired so a fired timer cancels in-flight work | `AbortController` pattern ported from carousel.routes.ts/enhance.routes.ts (lines below); REAL cancellation via `openai` SDK's `RequestOptions.signal` (confirmed in installed typings) and native `fetch()`'s `signal` option in `ai-gateway.service.ts` |
| CRIT-05 | Critic scores, re-roll count, text-free compliance logged to `generation_logs`, compliance rate queryable | New `logVisualCritic()` in `observability.service.ts` mirroring `logCaptionQuality`'s exact shape; `event_kind` enum widen (no migration — column is unconstrained TEXT, confirmed against the actual migration SQL) |

</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Critic Call & Re-roll Logic (CRIT-01, CRIT-02)**
- The critic step is inserted immediately after the image-generation call returns (`server/routes/generate.routes.ts`, right after the try block around line ~613/615), BEFORE the crop → typography compositor → logo overlay pipeline (Phase 23's work) begins.
- Implemented via `chatCompletion` with multimodal content parts (an `image_url` content part carrying the generated image, same shape as `toOpenRouterInputReference`/OpenRouter's existing image-attachment pattern) plus `responseFormat: {type:"json_schema", ...}` for structured scores — following Phase 22's proven json_schema precedent. No new gateway capability needed.
- New admin-configurable `ai_models.critic` field (mirrors Phase 22's `ai_models.planning` field pattern) — a separate call class from `planning`, not repointing the existing field.
- Exact scoring rubric, score scale, and pass/fail thresholds are Claude's technical discretion, informed by research.
- Re-roll trigger logic: unwanted AI-rendered text is an ALWAYS hard-fail gate — an image with detected unwanted text is never accepted, even as a "best available" fallback after the retry cap. Composition/color-harmony/legibility scores below threshold are a soft-fail: sequential re-roll, capped at 2 additional attempts (3 total generations max). If the cap is exhausted without any attempt passing the soft-fail thresholds (but none had hard-fail unwanted text), accept the best-scoring of the 3 attempts rather than failing the entire generation. If ALL 3 attempts hard-fail on unwanted text, the generation genuinely fails and surfaces an error to the user (rare edge case).

**Billing & Cost Tracking (CRIT-03)**
- No structural billing change — reuses the existing single `recordUsageEvent`/`deductCredits` call site in `generate.routes.ts` (already runs exactly once, after the full pipeline including any re-roll loop completes).
- The user is billed the real cost of ONLY the final accepted attempt (normal Phase 21 real-cost billing behavior) — not the sum of all re-roll attempts.
- The cost of discarded re-roll attempts (extra image-gen + critic calls) is tracked separately in the usage event's `metadata` field (e.g. `reroll_cost_usd_micros`, `reroll_attempt_count`) as platform-side, informational cost — never added to what the user is charged.

**SSE Timer & AbortSignal (CRIT-04)**
- Adopt the `AbortController`+`signal` pattern already used in `carousel.routes.ts`/`enhance.routes.ts` into `generate.routes.ts`, which currently has neither (only a bare `setTimeout` with no abort capability).
- New safety-timeout value is derived from a formula (base + critic-call-latency-estimate + up to 2 extra re-roll image-gen-call-latency-estimates) — exact formula/value is Claude's technical discretion. The existing 280s constant is a carried-over Vercel serverless kill-window assumption, not a real Coolify constraint (production has been on Coolify/long-running-host since 2026-05-30) — it may be revised upward as needed, not treated as a ceiling.
- Unlike the existing "cooperative" AbortSignal pattern elsewhere (checked only between awaited pipeline stages, never reaching the actual `fetch()`/SDK calls), this phase threads a REAL abort signal into `ai-gateway.service.ts`'s underlying `fetch()`/SDK calls (`chatCompletion`, `generateImage`/`callImageApi`) so that a fired timer genuinely cancels in-flight network requests — this is what SC3/CRIT-04 literally requires ("the wired AbortSignal actually cancels the in-flight call").

**Observability (CRIT-05)**
- New `event_kind: "visual_critic"` added to the existing `generation_logs.event_kind` Zod enum (widen, no migration — the column is unconstrained TEXT, same precedent as `model_fallback`/`planning_schema_failure`).
- New `logVisualCritic()` function in `observability.service.ts`, following the exact fire-and-forget pattern of `logCaptionQuality`/`logPlanningSchemaFailure` — records scores, `attempt_count`, and text-free compliance once per generation (whether it ultimately passed, exhausted the re-roll cap, or hard-failed), never blocks the response.

### Claude's Discretion
- Exact critic scoring rubric, score scale, and pass/fail thresholds.
- Exact new SSE safety-timeout formula/value.
- Exact `ai_models.critic` default model slug (must be vision/multimodal-capable — verify live at implementation time, following Phase 22's precedent of re-verifying model capability against the live OpenRouter catalog rather than assuming).
- Exact `generation_logs.metadata` shape for critic scores/re-roll cost tracking.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.

</user_constraints>

## Project Constraints (from CLAUDE.md)

- Backend: Express 5 + `tsx`; validation via Zod `safeParse` on all request bodies (`shared/schema.ts` is the single source of truth for types/schemas).
- AI calls: Google Gemini/OpenRouter REST — this phase's critic call must go through the shared `server/services/ai-gateway.service.ts` gateway, not a new raw-fetch implementation (matches GATE-01 pattern already established for all other text/planning calls).
- `createServerSupabase(token)` for user-scoped writes, `createAdminSupabase()` for service-role/admin writes — `logVisualCritic()` must use `createAdminSupabase()` exactly like every other `observability.service.ts` emitter and `logGenerationError`.
- All AI API keys sent via headers only, never query strings (POL-07, already enforced platform-wide) — the critic call inherits this for free via `chatCompletion()`'s existing `Authorization: Bearer` header.
- No emojis in code/docs. Path aliases `@`→`client/src/`, `@shared`→`shared/` (not relevant to this backend-only phase).

## Architecture Patterns

### Recommended Insertion Point (verified exact line numbers, 2026-07-27)

`server/routes/generate.routes.ts` (943 lines total) — the prior scouting pass's line numbers were verified accurate against the live file:

| Element | Lines | Notes |
|---|---|---|
| `GENERATION_SAFETY_TIMEOUT_MS` const | 37 | Module-scope; needs the new critic/re-roll budget added here (or a second derived const) |
| Safety timer `setTimeout` (bare, no AbortController) | 434-443 | This is what CRIT-04 replaces with `AbortController` + `controller.signal` |
| Image-gen call (single-shot try/catch) | 572-613 | THIS is the block that becomes the bounded re-roll loop. `provider.generate({...})` itself is lines 596-603 |
| Crop to exact aspect ratio | 659-663 | Runs on `finalImageBuffer` — critic scores `imageResult.buffer` BEFORE this, per CONTEXT.md |
| `base_image_url` upload (TYPO-05) | 665-675 | Unaffected — still uploads whichever `finalImageBuffer` the loop settled on |
| Typography compositor (TYPO-02/03) | 677-695 | Unaffected |
| Logo overlay | 697-725 | Unaffected |
| Optimize + upload + thumbnail | 727-748 | Unaffected |
| `recordUsageEvent` call | 880-896 | Signature needs ONE new optional param (`extraMetadata`); call site itself is otherwise untouched |
| `deductCredits` call | 898-905 | Untouched — receives `usageEvent.cost_usd_micros`/`charged_amount_micros`, which are already re-roll-cost-exclusive by construction |
| `finally { clearTimeout(safetyTimer) }` | 938-940 | Becomes `clearTimeout(safetyTimer)` (timer var renamed/kept) — no `controller.abort()` call needed here since normal completion just needs the timer cleared, exactly like today |

### Pattern 1: Bounded sequential re-roll loop (CRIT-01, CRIT-02)

Replace lines 572-613 with a loop. Sketch (illustrative — not literal production code, but every referenced symbol/pattern below is real and verified):

```typescript
// Source: existing provider.generate() call at generate.routes.ts:596-603,
// existing chatCompletion() + toOpenRouterInputReference() precedent from
// gemini.service.ts:834-846 and ai-gateway.service.ts:254-259
const MAX_REROLL_ATTEMPTS = 2; // 3 total generations, per CONTEXT.md
let imageResult: ImageProviderResult | undefined;
let criticOutcome: CriticOutcome | undefined;
let bestAttempt: { imageResult: ImageProviderResult; criticOutcome: CriticOutcome } | undefined;
let rerollAttemptCount = 0;
let rerollCostUsdMicros = 0;

for (let attempt = 1; attempt <= MAX_REROLL_ATTEMPTS + 1; attempt++) {
    imageResult = await provider.generate({ /* identical params every attempt */ });
    criticOutcome = await runVisualCritic({
        apiKey: openRouterApiKey || config.OPENROUTER_API_KEY,
        model: styleCatalog.ai_models?.critic,
        imageBuffer: imageResult.buffer,
        imageMimeType: imageResult.mimeType,
        layoutArchetypeId: textResult.content.layout_archetype_id,
        signal: controller.signal, // CRIT-04
    });

    if (criticOutcome.unwantedTextDetected) {
        // hard-fail: never accept, but still track as "best" candidate slot
        // only if we need SOME fallback bookkeeping — CONTEXT.md says an
        // all-3-hard-fail run must throw, so do NOT set bestAttempt here.
    } else if (criticOutcome.passesThresholds) {
        break; // accept immediately, no more attempts needed
    } else if (!bestAttempt || criticOutcome.averageScore > bestAttempt.criticOutcome.averageScore) {
        bestAttempt = { imageResult, criticOutcome };
    }

    if (attempt <= MAX_REROLL_ATTEMPTS) {
        rerollAttemptCount++;
        rerollCostUsdMicros += (imageResult.costUsdMicros ?? 0) + (criticOutcome.costUsdMicros ?? 0);
    }
}

// Resolve final: accept immediate pass, else best soft-fail, else throw if
// every attempt hard-failed on unwanted text (CONTEXT.md's rare-edge-case path).
```

**Why this shape:** it changes ZERO lines outside 572-613 structurally — `imageResult` remains the same variable name consumed unchanged by the crop/typography/logo/optimize block starting at line 656. The loop absorbs 100% of the new complexity in one place.

### Pattern 2: Critic call — multimodal `content` + strict `json_schema` (CRIT-01)

This exact combination (image attached + `json_schema` strict mode) is NOT hypothetical — it is already live in this codebase whenever a user attaches reference images to the art-director planning call (`gemini.service.ts` lines 834-846, `buildPlanningContentParts` at lines 738-745). That is the strongest possible precedent: same gateway function, same `toOpenRouterInputReference()` helper, same `responseFormat: {type:"json_schema", ...}` field.

```typescript
// Source: mirrors gemini.service.ts:738-745 (buildPlanningContentParts) and
// ai-gateway.service.ts:254-259 (toOpenRouterInputReference)
import { chatCompletion, toOpenRouterInputReference } from "./ai-gateway.service.js";

const content: ChatMessageContent = [
    { type: "text", text: CRITIC_PROMPT },
    toOpenRouterInputReference({ mimeType: imageResult.mimeType, data: imageResult.buffer.toString("base64") }),
];

const result = await chatCompletion({
    apiKey: orKey,
    model: styleCatalog.ai_models?.critic || DEFAULT_CRITIC_MODEL,
    messages: [{ role: "user", content }],
    temperature: 0.2, // scoring should be low-variance, not creative
    maxTokens: 512,   // scores + a short rationale, not a long document
    responseFormat: { type: "json_schema", json_schema: CRITIC_JSON_SCHEMA },
});
```

Contrast: `enhancement.service.ts`'s pre-screen call (lines 252-265) ALSO attaches an image via `chatCompletion`, but uses the LOOSER `{ type: "json_object" }`, not `json_schema` — this is the only other image+chatCompletion call site in the codebase, and it deliberately avoided strict mode (likely because its 3-field schema was written before Phase 22 established the `json_schema` pattern, not because of a documented incompatibility). No official OpenRouter documentation was found (live-checked 2026-07-27) that flags a specific image+strict-json_schema incompatibility; the planning call's existing production use is the strongest evidence available that the combination works.

### Pattern 3: Critic JSON Schema — use `enum`, not `minimum`/`maximum`, for bounded scores

```typescript
// Source: mirrors PLANNING_JSON_SCHEMA's proven enum pattern
// (planning-schema.service.ts:135-139, layout_archetype_id) — NOT its
// numeric-bound pattern, because no numeric bound exists there to copy;
// planning-schema.service.ts's own comment (line 22-26, MIN_IMAGE_PROMPT_LENGTH)
// explicitly documents avoiding length/range JSON-Schema keywords under
// strict mode as unreliable, validating this choice.
export const CRITIC_JSON_SCHEMA = {
  name: "visual_critic_score",
  strict: true,
  schema: {
    type: "object",
    properties: {
      composition_score: { type: "integer", enum: [1, 2, 3, 4, 5], description: "1=poor composition, 5=excellent." },
      color_harmony_score: { type: "integer", enum: [1, 2, 3, 4, 5], description: "1=clashing/muddy, 5=cohesive." },
      text_legibility_zone_score: { type: "integer", enum: [1, 2, 3, 4, 5], description: "1=no clean negative space for on-image text, 5=ample clean space matching the intended layout archetype." },
      unwanted_text_detected: { type: "boolean", description: "True if the image contains ANY AI-rendered letters, words, numbers, or watermark-like text." },
      unwanted_text_detail: { type: "string", description: "What text was detected and where. Empty string when unwanted_text_detected is false." },
      reasoning: { type: "string", description: "One to two sentence rationale for the scores." },
    },
    required: [
      "composition_score", "color_harmony_score", "text_legibility_zone_score",
      "unwanted_text_detected", "unwanted_text_detail", "reasoning",
    ],
    additionalProperties: false,
  },
};
```
Runtime bounds should ALSO be re-validated in application code after parsing (same defense-in-depth `validatePlanningWireResult` already does for the planning call) — strict mode reduces but does not eliminate malformed output risk.

### Pattern 4: `chatCompletion()` needs a `callClass` parameter (net-new finding, not in CONTEXT.md's scouting)

Current code (`ai-gateway.service.ts` lines 133-138):
```typescript
/** GATE-01: chat/planning/caption/pre-screen calls. Fallback chain read from ai_model_fallbacks.text unless the caller passes its own. */
export async function chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  const fallbacks = params.fallbackModels ?? (await getFallbackChain("text"));
  const client = getOpenRouterClient(params.apiKey);

  const { result, modelUsed } = await callWithFallback(params.model, fallbacks, "text", async (model) => {
```
Both the `getFallbackChain("text")` default AND the literal `"text"` argument to `callWithFallback` are hardcoded — `chatCompletion()` has NO way today to use a different fallback chain or report a different `call_class` in `model_fallback` logs. Recommended minimal-diff fix:
```typescript
export interface ChatCompletionParams {
  // ...existing fields...
  callClass?: FallbackCallClass; // NEW, default "text" — 100% backward compatible
  signal?: AbortSignal;          // NEW, CRIT-04
}

export async function chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  const callClass = params.callClass ?? "text";
  const fallbacks = params.fallbackModels ?? (await getFallbackChain(callClass));
  const client = getOpenRouterClient(params.apiKey);
  const { result, modelUsed } = await callWithFallback(params.model, fallbacks, callClass, async (model) => {
    const response = await client.chat.completions.create({ /* ...unchanged... */ }, { signal: params.signal });
    // ...
  });
```
This requires widening `FallbackCallClass` (currently `"text" | "image" | "transcription"`, `ai-gateway-settings.service.ts` line 21) to include `"critic"`, plus a matching `DEFAULT_FALLBACKS.critic: []` entry (line 29-33) and admin UI plumbing for `ai_model_fallbacks.critic` (GATE-04 parity). Every EXISTING caller of `chatCompletion()` (gemini.service.ts, enhancement.service.ts) needs zero changes — `callClass` is optional and defaults to today's exact behavior.

### Pattern 5: Real AbortSignal threading (CRIT-04)

Confirmed directly from the installed `openai@6.38.0` package (`node_modules/openai/internal/request-options.d.ts`): every SDK resource method accepts a second `options: RequestOptions` argument with `signal?: AbortSignal | undefined | null` that IS wired into the underlying `fetch()` — this is genuine cancellation, not cooperative. Confirmed on `chat.completions.create(body, options)` specifically (`node_modules/openai/resources/chat/completions/completions.d.ts` line 55-57).

```typescript
// chatCompletion() — pass signal as the SDK's second arg
const response = await client.chat.completions.create(
  { model: normalizeOpenRouterModelSlug(model), messages: params.messages as any, /* ... */ },
  { signal: params.signal },
);

// callImageApi() — Node's global fetch() natively supports `signal` in RequestInit
const response = await fetch("https://openrouter.ai/api/v1/images", {
  method: "POST",
  headers: { /* ...unchanged... */ },
  body: JSON.stringify({ /* ...unchanged... */ }),
  signal: params.signal, // NEW
});
```

**Why aborting mid-fallback-loop is already safe without extra code:** `callWithFallback`'s catch block (`ai-gateway.service.ts` lines 102-107) only retries the next fallback model when `isFallbackWorthy = /\b(404|410|5\d\d|model_not_found)\b/i.test(msg)` matches. An `AbortError`'s message (`"This operation was aborted"` / `"The operation was aborted"`, depending on runtime) will NOT match that regex, so `!isFallbackWorthy` is true and the loop re-throws immediately instead of burning time trying more fallback models after a timer fires. This should be covered by a verification-script assertion (feed a synthetic AbortError message through the same regex) rather than assumed silently.

### Pattern 6: `AbortController` + safety timer (port from carousel/enhance)

Existing precedent, `carousel.routes.ts` lines 271-275 and `enhance.routes.ts` lines 266-271:
```typescript
const controller = new AbortController();
const safetyTimer = setTimeout(() => {
    controller.abort();
}, CAROUSEL_SAFETY_TIMEOUT_MS); // or the phase-specific derived constant
```
`generate.routes.ts` currently (lines 434-443) has a bare `setTimeout` that logs + calls `sse.sendError` directly, with NO `AbortController` at all. CRIT-04 requires BOTH behaviors: keep the existing user-facing timeout notification AND add `controller.abort()` so the in-flight gateway call is actually cancelled. Recommended merge:
```typescript
const controller = new AbortController();
const safetyTimer = setTimeout(async () => {
    controller.abort();
    await logGenerationError({ userId: user.id, errorMessage: "Generation timed out...", errorType: "unknown", requestParams: sanitizedRequestParams });
    sse.sendError({ message: "Generation timed out. Please try again.", statusCode: 504 });
}, GENERATION_SAFETY_TIMEOUT_MS_WITH_CRITIC_BUDGET);
```
Every gateway call site inside the try block (`chatCompletion` for text-gen AND critic, `provider.generate`/`generateImage` for image-gen) then needs `signal: controller.signal` threaded through its params object — mirroring exactly how `carousel.routes.ts` line 373 passes `signal: controller.signal` into `generateCarousel(...)`.

### SSE Timeout Formula (Claude's discretion — documented reasoning, MEDIUM-LOW confidence on the exact constants)

No empirical latency measurement was available in this research pass (no live OpenRouter API key was exercised against `gemini-*` vision+json_schema calls). The recommended formula is a conservative, clearly-labeled-as-estimate constant set, structured so it can be tuned from real Coolify production data without touching the pipeline logic:

```typescript
// All three constants below are ESTIMATES pending real production latency
// data (Coolify, post-launch). Override via env if they prove wrong.
const CRITIC_CALL_LATENCY_ESTIMATE_MS = 15_000; // flash-tier vision + json_schema, generous ceiling
const IMAGE_GEN_CALL_LATENCY_ESTIMATE_MS = 25_000; // existing slowest single pipeline step
const MAX_REROLL_ATTEMPTS = 2; // 3 total generations, CONTEXT.md-locked

// New work this phase adds beyond today's single image-gen call:
// (MAX_REROLL_ATTEMPTS + 1) critic calls (one per attempt, always run) +
// MAX_REROLL_ATTEMPTS extra image-gen calls (attempt 1's image-gen is
// already inside today's 280s budget).
const CRITIC_REROLL_BUDGET_MS =
  (MAX_REROLL_ATTEMPTS + 1) * CRITIC_CALL_LATENCY_ESTIMATE_MS +
  MAX_REROLL_ATTEMPTS * IMAGE_GEN_CALL_LATENCY_ESTIMATE_MS; // = 45,000 + 50,000 = 95,000ms

const GENERATION_SAFETY_TIMEOUT_MS =
  (config.GENERATION_SAFETY_TIMEOUT_MS ?? 280_000) + CRITIC_REROLL_BUDGET_MS; // ≈ 375s
```
This mirrors the file's existing self-documenting-constant style (see `CAROUSEL_SAFETY_TIMEOUT_MS`'s derivation in `carousel.routes.ts` line 43). Recommend keeping `GENERATION_SAFETY_TIMEOUT_MS` itself overridable via the SAME env var so ops can raise it without a redeploy, exactly like today.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Attaching a generated image to a chat-completion request | A new base64/data-URI builder | `toOpenRouterInputReference()` (`ai-gateway.service.ts` lines 254-259) | Already proven, already exported, already the exact shape OpenRouter expects |
| Strict-mode JSON schema for scores | Hand-rolled prompt-engineered "return JSON with these fields" text parsing | `responseFormat: {type:"json_schema", json_schema: CRITIC_JSON_SCHEMA}` via `chatCompletion` | Proven in production today (Phase 22 planning call); eliminates the fragile regex/code-block JSON extraction this codebase already has to work around elsewhere (`parseGeminiJson` in gemini.service.ts) |
| Retry-with-different-model on transient failure | A new critic-specific retry loop | `callWithFallback()` (`ai-gateway.service.ts` lines 82-110) — already handles this, just needs `callClass="critic"` threaded through | One retry mechanism for the whole gateway, not two competing ones |
| Cancelling an in-flight OpenRouter request | A manual "check a flag after every await" pattern (what carousel/enhance already do) | The `openai` SDK's `RequestOptions.signal` + native `fetch()`'s `signal` (both real `AbortController` integrations) | This phase's entire point (CRIT-04) is to stop doing the cooperative-only pattern — reinventing another cooperative check would fail the actual requirement |
| Admin-configurable model slug + fallback chain for a new call purpose | A bespoke settings row/table | `styleCatalogSchema.aiModelsSchema` (additive Zod field, auto-backfilled via `.parse()`) + `ai-gateway-settings.service.ts`'s existing `FallbackCallClass`/`DEFAULT_FALLBACKS` widening | Exact precedent already shipped for `planning` in Phase 22 — zero new infrastructure, one enum/type widen |

**Key insight:** every piece of plumbing this phase needs already has a shipped precedent ONE phase away (Phase 22) or in a sibling route file (carousel/enhance). The actual net-new engineering is: (1) the re-roll loop's control flow, (2) widening two narrow union types (`FallbackCallClass`, `generationLogSchema.event_kind`), and (3) threading `signal` through three call sites that never had it. Everything else is "apply the existing pattern."

## Common Pitfalls

### Pitfall 1: `chatCompletion()`'s hardcoded `"text"` call class silently defeats "separate call class" (see Pattern 4)
**What goes wrong:** Wiring the critic call through `chatCompletion()` unmodified makes it invisibly share the `ai_model_fallbacks.text` chain and get logged as `call_class: "text"` on fallback — GATE-04's "no hardcoded slugs... fallback chain per call class" silently does not apply to it.
**Why it happens:** `chatCompletion()` was written for exactly one call class (`"text"`, covering planning/caption/pre-screen) and never needed a parameter for it until now.
**How to avoid:** Add the optional `callClass` param (Pattern 4) before wiring the critic call site.
**Warning signs:** Admin flips `ai_model_fallbacks.critic` in the UI and the critic call's actual fallback behavior doesn't change; `model_fallback` log rows for critic failures show `call_class: "text"`.

### Pitfall 2: `minimum`/`maximum` JSON-Schema keywords are unreliable under this gateway's strict mode
**What goes wrong:** A critic schema using `{"type":"integer","minimum":1,"maximum":5}` may let the model emit out-of-range values or otherwise behave inconsistently.
**Why it happens:** Documented in this exact codebase — `planning-schema.service.ts` (line 22-26) explicitly avoided a JSON-Schema length keyword for the same reason, opting for prompt-text instruction plus a separate runtime check instead.
**How to avoid:** Use `enum: [1,2,3,4,5]` (proven pattern, see `layout_archetype_id`) and ALSO defensively re-validate the parsed result in application code (mirror `validatePlanningWireResult`).
**Warning signs:** Scores occasionally outside [1,5], or occasional schema-validation-style transport errors.

### Pitfall 3: Cooperative-only abort checks give a false sense of CRIT-04 compliance
**What goes wrong:** Copying the `carousel.routes.ts`/`enhance.routes.ts` `if (params.signal?.aborted) throw/break` pattern verbatim satisfies "there's an AbortController" but NOT CRIT-04's literal requirement ("the wired AbortSignal actually cancels the in-flight call") — a fired timer during an in-flight fetch would still let that fetch run to completion.
**Why it happens:** That pattern is the ONLY existing precedent in the codebase, and it is genuinely cooperative-only today (verified: no `signal` property reaches any `fetch()`/SDK call anywhere in `ai-gateway.service.ts`, `image-generation.service.ts`, or `image-provider.ts`).
**How to avoid:** Thread `signal` all the way into `client.chat.completions.create(body, {signal})` and `fetch(url, {signal})` (Pattern 5) — the cooperative checks are still worth keeping BETWEEN stages (cheap, avoids starting a new attempt after abort) but are not sufficient alone.
**Warning signs:** A verify script or live test that starts a slow request, aborts, and observes the request's underlying socket/promise still resolving instead of rejecting with an AbortError.

### Pitfall 4: The direct-Gemini GATE-07 rollback path gets no abort/critic parity unless explicitly built
**What goes wrong:** `ai_gateway_routing.image = "direct"` (emergency rollback) routes through `image-generation.service.ts`'s raw `fetch()` calls (lines 109, 212) — CONTEXT.md's Integration Points section only names `ai-gateway.service.ts`'s functions for signal-threading, not this file. If a critic-loop implementation only checks `getActiveImageProvider`'s returned `ImageProvider.generate()` without regard to which concrete provider it is, the AbortSignal will silently do nothing during a "direct" rollback.
**Why it happens:** GATE-07 rollback is an emergency, short-lived state by design (per Phase 21.1's own precedent) and CONTEXT.md scopes signal-threading narrowly to the gateway file.
**How to avoid:** Decide explicitly (this is a genuine open question, not resolved by CONTEXT.md) whether GATE-07 parity for real cancellation is in scope for this phase or explicitly deferred; document the choice either way rather than leaving it silently unhandled.
**Warning signs:** A safety-timer fire during an active "direct" rollback incident does not actually free up the Node process/connection.

### Pitfall 5: `recordUsageEvent`'s current signature has no metadata passthrough
**What goes wrong:** Assuming CRIT-03's `reroll_cost_usd_micros`/`reroll_attempt_count` can simply be "added to metadata" without checking the function signature — today's `recordUsageEvent` builds its `metadata` object internally from only `estimatedCostMicros`/`realCostUsdMicros` (quota.ts lines 617-619); there is no parameter for arbitrary extra fields.
**Why it happens:** `metadata` was scoped narrowly for Phase 21's GATE-05 need and never revisited.
**How to avoid:** Add one new optional `extraMetadata?: Record<string, unknown>` param, spread into the existing metadata object, and widen the `hasGatewayMeta` condition to also fire when `extraMetadata` has keys (so re-roll metadata isn't silently dropped to `null` on a run that had no re-roll cost fields set but the caller still passed critic scores).
**Warning signs:** `usage_events.metadata` never contains `reroll_*` keys despite the loop clearly running more than once.

### Pitfall 6: OpenRouter model-capability data is genuinely volatile — do not trust a single research-pass snapshot
**What goes wrong:** Phase 22's OWN research (dated 2026-07-27, this same date) found `gemini-2.5-pro` did NOT support `structured_outputs` on OpenRouter at the time it checked; a live re-check performed for THIS research pass (also 2026-07-27) shows `google/gemini-2.5-pro` DOES appear in the `structured_outputs`-capable, vision-capable model list. Either the catalog genuinely changed within the same day, or the catalog is non-deterministic/mocked in this environment — either way, the lesson is identical: a model-capability check from an hour ago is not a safe assumption for the code being written today.
**Why it happens:** OpenRouter's model catalog (and the per-model `supported_parameters` array) is dynamic; the 22-RESEARCH.md file itself flags "Valid until: 7 days" for exactly this reason.
**How to avoid:** Re-verify `openrouter.ai/api/v1/models?supported_parameters=structured_outputs` filtered for `architecture.input_modalities` including `"image"` immediately before writing the plan's default `ai_models.critic` value, not from this document alone.
**Warning signs:** Every critic call fails at the transport level immediately after deploy with a `structured_outputs`/schema-rejection error from OpenRouter.

## Code Examples

### `logVisualCritic()` — mirrors `logCaptionQuality`'s exact shape (`observability.service.ts`)
```typescript
// Source: mirrors observability.service.ts:59-81 (logCaptionQuality) and
// :127-146 (logPlanningSchemaFailure) — identical fire-and-forget contract.
export interface VisualCriticLogParams {
  postId: string | null;
  outcome: "pass" | "soft_fail_accepted_best" | "hard_fail_all_attempts";
  attemptCount: number;              // 1-3
  textFreeCompliant: boolean;        // false only on the hard-fail path
  finalScores: { composition: number; color_harmony: number; text_legibility_zone: number } | null;
  durationMs: number;
}

export async function logVisualCritic(params: VisualCriticLogParams): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    await supabase.from("generation_logs").insert({
      status: params.outcome === "hard_fail_all_attempts" ? "failed" : "ok",
      error_message: params.outcome === "hard_fail_all_attempts"
        ? `All ${params.attemptCount} attempt(s) contained unwanted rendered text`
        : "",
      error_type: params.outcome === "hard_fail_all_attempts" ? "image_generation" : null,
      post_id: params.postId,
      event_kind: "visual_critic",
      outcome: params.outcome,
      attempt_count: params.attemptCount,
      duration_ms: params.durationMs,
      metadata: {
        text_free_compliant: params.textFreeCompliant,
        final_scores: params.finalScores,
      },
    });
  } catch {
    // Best-effort: swallow. Logging must never break the generation flow.
  }
}
```
Compliance-rate query (illustrative, for the admin dashboard this enables per CRIT-05's "measurable via a query"):
```sql
SELECT outcome, COUNT(*) FROM generation_logs
WHERE event_kind = 'visual_critic'
GROUP BY outcome;
```

### `recordUsageEvent()` widening (`quota.ts`) — minimal additive diff
```typescript
// Source: quota.ts:579-633, widened
export async function recordUsageEvent(
  userId: string,
  postId: string | null,
  eventType: "generate" | "edit" | "transcribe",
  tokens?: UsageTokenData,
  models?: UsageModelData,
  realCostUsdMicros?: number,
  estimatedCostMicros?: number,
  extraMetadata?: Record<string, unknown>, // NEW — Phase 24 CRIT-03: reroll_cost_usd_micros, reroll_attempt_count
): Promise<RecordedUsageEvent> {
  // ...unchanged pricing resolution...
  const hasGatewayMeta =
    typeof realCostUsdMicros === "number" ||
    typeof estimatedCostMicros === "number" ||
    (extraMetadata != null && Object.keys(extraMetadata).length > 0);
  // ...
  metadata: hasGatewayMeta
    ? { estimated_cost_usd_micros: estimatedCostMicros ?? null, real_cost_usd_micros: realCostUsdMicros ?? null, ...extraMetadata }
    : null,
  // ...
}
```
Call site (`generate.routes.ts` lines 880-896) then passes one new argument:
```typescript
const usageEvent = await recordUsageEvent(
  user.id, postId, "generate",
  { /* ...unchanged token fields... */ },
  { text_model: textResult.model, image_model: imageResult?.model || "veo-3.1-generate-preview" },
  gatewayRealCost,
  creditStatus?.estimated_cost_micros,
  content_type === "video" ? undefined : {
    reroll_attempt_count: rerollAttemptCount,
    reroll_cost_usd_micros: rerollCostUsdMicros,
    critic_final_scores: criticOutcome ? { /* ... */ } : null,
  },
);
```

### Admin UI selector — mirrors `ai-models-card.tsx`'s `planning` block exactly
```tsx
// Source: client/src/components/admin/post-creation/ai-models-card.tsx:50-69 (planning block), adapted
<div className="space-y-2">
    <Label className="text-sm font-medium">{t("Visual Critic")}</Label>
    <Select value={aiModels.critic} onValueChange={(value) => updateModel("critic", value)}>
        <SelectTrigger className="w-full"><SelectValue placeholder={t("Select a model")} /></SelectTrigger>
        <SelectContent>
            <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
            <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
        </SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground">
        {t("Scores every generated image before compositing (composition, color harmony, text-free compliance). Must support vision input AND OpenRouter structured outputs.")}
    </p>
</div>
```
`aiModels` fallback object (line 17-25) and `aiModelsSchema` (shared/schema.ts lines 180-197) both need the additive `critic: z.string().default(...)` field — same `.parse()`-backfill mechanism already proven for `planning` (no migration).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| No visual quality gate — whatever the image model returns goes straight to compositing | Multimodal critic scores every base image before compositing; bounded sequential re-roll on soft-fail, hard-fail on unwanted text | This phase | First automated quality/compliance gate in the generation pipeline; enables a measurable compliance rate |
| Cooperative-only `AbortSignal` (checked between stages, never reaches network calls) | Real signal threaded into `openai` SDK calls and raw `fetch()` | This phase (`ai-gateway.service.ts`) | First genuinely-cancellable AI call in the codebase; sets precedent other routes could adopt later |
| `chatCompletion()` fallback chain hardcoded to `"text"` | Optional `callClass` param, default `"text"` | This phase (recommended) | Makes GATE-04's "per call class" fallback promise actually true for every current AND future call class, not just the three that predate this phase |

**Deprecated/outdated:** None — this phase is additive only; no existing behavior is removed.

## Open Questions

1. **Does the critic call need GATE-07 "direct" rollback parity (a raw-Gemini fallback path), or is OpenRouter-only acceptable?**
   - What we know: CONTEXT.md says "No new gateway capability needed," implying reuse of the existing `chatCompletion` (OpenRouter-only) path. `planning`/`image`/`transcription` all have a `"direct"` rollback branch; `critic` would not, under this reading.
   - What's unclear: whether omitting rollback parity for a brand-new call class is acceptable risk, or whether the planner should budget a small direct-Gemini branch too (mirroring `generateText()`'s `routing === "direct"` branch, lines 878-938 in `gemini.service.ts`).
   - Recommendation: default to OpenRouter-only for `critic` (matches CONTEXT.md's literal wording and keeps the diff small); document the gap explicitly rather than silently omitting it.

2. **Should the re-roll attempt's prompt be identical each time, or should critic feedback be injected into the retry prompt?**
   - What we know: CONTEXT.md describes "sequential re-roll" with no mention of prompt modification; the existing `provider.generate()` call is directly re-callable with identical params.
   - What's unclear: whether re-using the IDENTICAL prompt across all 3 attempts (relying purely on generation stochasticity) is an acceptable re-roll strategy, or whether appending the critic's `reasoning`/`unwanted_text_detail` to the prompt for attempt 2/3 would materially improve pass rates.
   - Recommendation: start with identical prompts (simplest, zero new prompt-engineering surface, matches CONTEXT.md's literal scope); flag prompt-injection as a possible v2 enhancement, not required this phase.

3. **What are the REAL latency numbers for a critic call and an image-gen call on Coolify?**
   - What we know: no live OpenRouter API key was exercised in this research pass; the SSE-timeout formula's constants (`CRITIC_CALL_LATENCY_ESTIMATE_MS = 15_000`, `IMAGE_GEN_CALL_LATENCY_ESTIMATE_MS = 25_000`) are reasoned estimates, not measurements.
   - What's unclear: real p95 latency for `gemini-2.5-flash`-tier vision+`json_schema` calls and for the current image-generation model via OpenRouter's Image API, under Coolify's network conditions.
   - Recommendation: instrument `durationMs` in `logVisualCritic()` (already planned) and in a parallel image-gen timing log from day one, then tune the safety-timeout constants from real data after the first week of production traffic — the formula's SHAPE (base + N×critic + M×image-gen) is sound regardless of the exact constants.

4. **Exact pass/fail thresholds and "best of 3" tie-breaking rule.**
   - What we know: CONTEXT.md explicitly delegates this to "Claude's technical discretion, informed by research."
   - What's unclear: whether a 1-5 integer scale with "any dimension below 3 = soft-fail" is the right bar, versus a weighted-average threshold.
   - Recommendation: 1-5 integer enum per dimension (Pitfall 2's rationale), soft-fail trigger = ANY of the three scored dimensions < 3, "best of 3" tie-break = highest sum of the three dimension scores. Document this explicitly in the plan so it's a reviewable, changeable constant, not buried logic.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| OpenRouter API (`api.openrouter.ai`, actually `openrouter.ai/api/v1`) | Critic call (`chatCompletion`), image-gen re-rolls | Reachable from this research environment (live model-catalog fetch succeeded, HTTP 200) | N/A (hosted API) | `ai_gateway_routing` GATE-07 "direct" switch exists platform-wide but (per Open Question 1) may not extend to `critic` this phase |
| `openai` npm SDK | `chatCompletion()`'s signal-threading (Pattern 5) | ✓ installed | `6.38.0` (package.json) — confirmed `RequestOptions.signal` present in this exact installed version's typings | N/A — already a hard dependency |
| Node global `fetch()` with `signal` support | `callImageApi()`'s signal-threading | ✓ (Node 18+; this repo already uses global `fetch` extensively) | N/A | N/A |

No missing dependencies. No new package installs required for this phase.

## Validation Architecture

> `workflow.nyquist_validation` is absent from `.planning/config.json` — treated as enabled per the default rule.

### Test Framework
| Property | Value |
|---|---|
| Framework | Custom static-verification harness — no jest/vitest/pytest configured. Pattern: `scripts/verify-phase-N.ts` (per-phase gate, tag-filterable) + standalone `scripts/test-*.ts` (no-network unit-style checks) |
| Config file | none — each `verify-phase-N.ts` is a standalone `tsx`-run script, no shared config |
| Quick run command | `npx tsx scripts/verify-phase-24.ts --only=<tag>` (pattern from `verify-phase-23.ts` line 21-22's `--only=` filter) |
| Full suite command | `npx tsx scripts/verify-phase-24.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| CRIT-01 | Critic call attaches image + strict json_schema, model configurable via `ai_models.critic` | static (source-pattern check, mirrors `verify-phase-22.ts --only=svc-multimodal`) | `npx tsx scripts/verify-phase-24.ts --only=svc-critic-call` | ❌ Wave 0 |
| CRIT-02 | Re-roll loop caps at 2 extra attempts; unwanted-text is unconditional hard-fail; best-of-3 fallback logic | static + a no-network `scripts/test-critic-reroll-logic.ts` unit harness (mirrors `scripts/test-planning-schema-classification.ts`'s pattern — pure functions, fed synthetic critic outcomes) | `npx tsx scripts/test-critic-reroll-logic.ts` | ❌ Wave 0 |
| CRIT-03 | `recordUsageEvent` charges only final attempt; `metadata.reroll_*` present when a re-roll occurred | static (regex/AST-style source check on the call site + signature) | `npx tsx scripts/verify-phase-24.ts --only=svc-billing-reroll` | ❌ Wave 0 |
| CRIT-04 | `controller.signal` reaches `chatCompletion`/`generateImage`/`callImageApi`'s actual network call; abort does not trigger extra fallback attempts | static (source check for `signal:` reaching the SDK/`fetch()` call) + the AbortError-regex assertion from Pattern 5 | `npx tsx scripts/verify-phase-24.ts --only=svc-abort-signal` | ❌ Wave 0 |
| CRIT-05 | `logVisualCritic` fires exactly once per generation; `event_kind` enum includes `"visual_critic"`; compliance query returns rows | static (schema/enum check) + a `createAdminSupabase()`-gated live-insert smoke test (mirrors `scripts/verify-cron-jobs.ts`'s real-Supabase pattern) | `npx tsx scripts/verify-phase-24.ts --only=svc-observability` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant `--only=<tag>` slice
- **Per wave merge:** full `npx tsx scripts/verify-phase-24.ts` + `npm run check` (tsc)
- **Phase gate:** full suite green + `npm run check` clean before `/gsd:verify-work`, mirroring every prior phase's precedent (21/21.1/22/23 all followed this exact gate shape)

### Wave 0 Gaps
- [ ] `scripts/verify-phase-24.ts` — new file, needs the 5 tags above (mirrors `verify-phase-23.ts`'s tag-filter scaffold, lines 21-22)
- [ ] `scripts/test-critic-reroll-logic.ts` — new no-network unit harness for the pure re-roll decision function (hard-fail gate, soft-fail threshold, best-of-3 tie-break), mirroring `scripts/test-planning-schema-classification.ts`
- [ ] A live/OPENROUTER_API_KEY-gated smoke test for an actual critic call against a real image (mirrors `scripts/verify-planning-ablation.ts`'s SKIP-when-no-key pattern) — needed to validate the real json_schema+vision combination against the live API, not just statically
- [ ] Framework install: none — no new test framework needed, same `tsx`-script pattern as every prior phase

## Sources

### Primary (HIGH confidence — read in full from the live repo)
- `server/routes/generate.routes.ts` (943 lines, read in full) — exact line numbers for every integration point above
- `server/services/ai-gateway.service.ts` (342 lines, read in full) — `chatCompletion`, `callWithFallback`, `callImageApi`, `toOpenRouterInputReference`
- `server/services/ai-gateway-settings.service.ts` (92 lines, read in full) — `CallClass`, `FallbackCallClass`, `getFallbackChain`, `getCallRouting`
- `server/routes/carousel.routes.ts` (lines 255-390 read) — `AbortController`/safety-timer precedent
- `server/routes/enhance.routes.ts` (lines 255-360, 600-660 read) — same, plus cooperative-check-only proof
- `server/services/enhancement.service.ts` (lines 220-320, 470-540 read) — the ONLY other image+`chatCompletion` call site (uses `json_object`, not `json_schema`)
- `server/services/gemini.service.ts` (lines 720-1000 read) — the ONLY existing image+strict-`json_schema` call site (proves Pattern 2 works today)
- `server/services/planning-schema.service.ts` (read in full) — `PLANNING_JSON_SCHEMA` dialect, the `MIN_IMAGE_PROMPT_LENGTH` comment that grounds Pitfall 2
- `server/quota.ts` (676 lines, read in full) — `recordUsageEvent`, `deductCredits`, `checkCredits`
- `server/services/observability.service.ts` (146 lines, read in full) — `logCaptionQuality`, `logPlanningSchemaFailure` exact pattern
- `shared/schema.ts` (lines 175-230, 1100-1290 read) — `aiModelsSchema`, `generationLogSchema`, `usageEventSchema`
- `server/services/image-provider.ts` (read in full) — `ImageProvider` interface, `OpenRouterImageProvider`/`GeminiImageProvider`
- `server/lib/sse.ts` (read in full) — `SSEWriter` interface
- `server/config/index.ts` (read in full) — `GENERATION_SAFETY_TIMEOUT_MS` env schema
- `client/src/components/admin/post-creation/ai-models-card.tsx` (read in full) — admin UI pattern for `planning` field
- `supabase/migrations/20260508000000_generation_logs_observability.sql` — confirms `event_kind TEXT` has no CHECK constraint (no migration needed)
- `node_modules/openai/internal/request-options.d.ts` and `node_modules/openai/resources/chat/completions/completions.d.ts` (installed `openai@6.38.0`) — confirms real `signal` support in the exact installed SDK version
- `.planning/phases/22-art-director-planning-upgrade/22-RESEARCH.md` — cross-phase precedent for `json_schema` pitfalls and OpenRouter model-catalog volatility (directly informs Pitfall 2 and Pitfall 6)
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/phases/24-visual-critic-and-re-roll/24-CONTEXT.md` — phase scope and locked decisions

### Secondary (MEDIUM confidence)
- Live fetch of `https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs` (2026-07-27, HTTP 200, 254 models returned, 144 also vision-capable) — confirms `google/gemini-2.5-flash` and `google/gemini-2.5-pro` both currently report `structured_outputs` + image input support. Flagged LOW-durability per Pitfall 6 (same-day contradiction against Phase 22's own live check).

### Tertiary (LOW confidence — unverified/general web results)
- WebSearch results on "OpenRouter structured outputs + multimodal" — general documentation summaries found, but no source explicitly confirmed or denied a vision+strict-json_schema-specific limitation; treated as inconclusive, not as evidence either way.

## Metadata

**Confidence breakdown:**
- Standard stack / plumbing reuse: HIGH — every function/line cited was read directly from the live repository, not inferred.
- Architecture (insertion point, loop shape, signal threading): HIGH for the codebase-mechanical parts (verified against installed SDK typings and existing sibling-route precedent); MEDIUM for the exact SSE-timeout constants (no empirical latency data).
- Pitfalls: HIGH for the three codebase-specific findings not in CONTEXT.md's scouting (`chatCompletion`'s hardcoded call class, the `minimum`/`maximum` json-schema keyword risk, the GATE-07 parity gap) — all independently re-derived from source, not assumed.
- Model-slug default: LOW-MEDIUM — the live catalog check is inherently time-sensitive (see Pitfall 6); re-verify immediately before implementation.

**Research date:** 2026-07-27
**Valid until:** 30 days for codebase-structural findings (stable until this phase's own code lands); 3-7 days for the OpenRouter model-catalog/capability specifics (demonstrated same-day volatility in this very research pass)
