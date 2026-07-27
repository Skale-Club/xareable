# Phase 22: Art Director Planning Upgrade - Research

**Researched:** 2026-07-27
**Domain:** LLM structured-output APIs (OpenRouter `json_schema` + direct-Gemini `responseSchema`), multimodal chat-completion requests, admin-configurable model routing (Phase 21 patterns)
**Confidence:** HIGH for codebase mechanics (all claims verified by direct file reads); MEDIUM for OpenRouter model-capability specifics (live-checked today, but the model catalog is dynamic and should be re-checked at implementation time)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Multimodal References (PLAN-01)**
- Applies to the single-image `/api/generate` planning call (`GeminiService.generateText`) only — carousel's `callCarouselTextPlan` is NOT extended in this phase; carousel-specific reference/style-board work belongs to Phase 25's "Aesthetic DNA" scope.
- Reuses the exact same `mergedReferenceImages` set (brand reference photos + user-uploaded images) already computed in `generate.routes.ts` for the image-gen call — no new fetch/merge logic needed, just attach the same set to the planning call too.
- Multimodal format mirrors existing patterns: `inlineData` parts for the direct-Gemini path (same shape as `generateImage`'s existing reference-image attachment), and the gateway's array/multimodal `content` shape already used for audio (`ai-gateway.service.ts`) for the OpenRouter path.
- The SC1 ablation-run verification (with vs. without reference images measurably changing output) is a technical/testing detail — likely a manual/live test since it requires a real API call to observe a real behavioral difference; exact mechanism left to research + planning.

**Strict Structured Output & Failure Handling (PLAN-02, PLAN-05 fields)**
- The planning call uses OpenRouter's real `json_schema` response format (strict structured output), replacing today's loose `{ type: "json_object" }` + prompt-engineered field instructions.
- Schema validation failures (malformed/incomplete JSON not matching the schema) NEVER fall back to `buildLocalTextFallback`'s silent generic template. Instead: log and surface via `generation_logs` (a new `event_kind`, mirroring Phase 21's `model_fallback` pattern).
- The existing transport-error fallback (network/auth failures — genuine connectivity issues, not schema/parse issues) remains unchanged and continues to use the documented fallback path.
- `text_blocks` and `layout_archetype_id` are added to the `json_schema` as required fields with sensible defaults the model can safely emit today, even though Phase 23's compositor is the only future consumer — so the schema never needs reopening.

**Higher-Tier Model & Token Budget (PLAN-03)**
- The planning call's model becomes admin-configurable, following the same model-slug settings pattern established in Phase 21 (`ai_gateway_routing`/`ai_model_fallbacks` / `style_catalog.ai_models`), defaulting to a genuinely higher-capability tier than the current Flash-class model.
- Carousel's output token budget scales with `slideCount` (exact formula — base + per-slide increment — left to research/planning, informed by the new schema's expected response size). Single-image generation gets a larger fixed ceiling (no per-slide scaling needed since it's always one image).

**Precedence Bug Fix (PLAN-04)**
- The model's `image_prompt` field becomes the schema-required, authoritative field under strict `json_schema` mode — no longer a `||` fallback chain against a mechanically-concatenated flattening of the other creative-plan fields.
- The exact prompt-engineering mechanism (how the schema's field description guides the model to produce a genuinely dense natural-language scene description synthesizing composition/style/color/mood/subject, vs. any remaining programmatic assembly) is a technical implementation detail — Claude's discretion, to be validated carefully during this phase's research step given the nuance uncovered while scoping (today's `raw?.image_prompt || flattenedPrompt` already lets the model's own field win when present; the real fix is making that field reliably rich and schema-guided, not changing which side of an `||` wins).

### Claude's Discretion
- Exact token-budget scaling formula for carousel.
- Exact schema field descriptions/prompt engineering for PLAN-04's dense-description fix.
- Exact new `event_kind` value and `generation_logs` payload shape for schema-failure logging.
- Default model slug chosen for the higher tier.

### Deferred Ideas (OUT OF SCOPE)
- Carousel planning-call multimodal reference-image attachment — deferred to Phase 25 (Narrative Carousels & Aesthetic DNA), which already owns carousel-specific style-reference-board work.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-01 | User reference images and brand reference photos are actually attached (multimodal) to the planning call | Confirmed via code read: `generate.routes.ts:485` currently strips `mimeType` and sends only `.data` (bare base64 strings) into `GenerateParams.referenceImages: string[]`, and `generateText()`'s actual HTTP request bodies (both OpenRouter `messages` and direct-Gemini `contents`) never include image parts at all — reference images today only appear as a **textual count mention** in the prompt. See Architecture Patterns → "Attaching multimodal reference images" for the exact fix, reusing `toOpenRouterInputReference()`. |
| PLAN-02 | Planning call uses strict structured outputs (`json_schema`); schema failures logged/surfaced, not silently local-templated | OpenRouter's exact `response_format.json_schema` shape verified live (2 sources). `ai-gateway.service.ts`'s `ChatCompletionParams.responseFormat` type already declares this shape — no caller uses it yet. `generation_logs.event_kind` is an **unconstrained TEXT column** (verified via migration files) — a new value needs zero DB migration, only a Zod enum widen. See Common Pitfalls → strict-mode all-fields-required-nullable trap. |
| PLAN-03 | Planning model admin-configurable at a higher tier; carousel token budget scales with slide count | `aiModelsSchema` (`shared/schema.ts:180-186`) + `AIModelsCard` admin UI (`ai-models-card.tsx`) are the exact precedent to extend. Live-verified against OpenRouter's `/models?supported_parameters=structured_outputs` endpoint today: none of the 3 Gemini slugs currently in the admin dropdown (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3.1-flash`) appear in the structured-outputs-capable list — a new slug must be added. `slide_count` is `z.number().int().min(3).max(8)` (`shared/schema.ts:944`), giving concrete bounds for the formula. |
| PLAN-04 | Structured creative plan is the source of truth for `image_prompt`; final prompt is dense natural language, not mechanical concatenation | Confirmed via code read: `normalizeGeminiTextResult` (`gemini.service.ts:352-390`) already has `raw?.image_prompt || flattenedPrompt` — the model's field already wins when present. `textResult.content.image_prompt` is consumed only as opaque text downstream (`generate.routes.ts` lines 576, 660) — no other code parses/regex-matches it, so making it denser is safe. The real fix is schema-enforced richness (field `description` + `required`), not the `||` operator. |
</phase_requirements>

## Summary

Phase 22's four requirements are all concentrated in one function: `GeminiService.generateText()` in `server/services/gemini.service.ts` (~L665-821), called from `generate.routes.ts:481`. Three concrete, code-verified bugs justify the phase:

1. **Reference images are computed but never sent.** `mergedReferenceImages` (full `{mimeType, data}` objects) is correctly built in `generate.routes.ts` and passed to the image-generation call, but the planning call at line 485 does `mergedReferenceImages.map(img => img.data)` — discarding `mimeType` — and neither of `generateText()`'s two HTTP-request branches (OpenRouter `chat.completions.create` or direct-Gemini `generateContent`) ever puts those base64 strings into a request body. The model only sees a textual sentence like "The user has provided 2 reference image(s)." This is why an ablation test (SC1) would show **no difference** today — the images were never in the request to begin with, regardless of on/off state.
2. **The planning call uses loose `{ type: "json_object" }` plus prompt-engineered field examples, not a real schema.** `ai-gateway.service.ts`'s `ChatCompletionParams.responseFormat` type already supports `{ type: "json_schema", json_schema: {...} }` (built in Phase 21 for a future caller) — Phase 22 is that caller. Live verification of OpenRouter's docs confirms the exact request shape and confirms it **errors** (not silently ignores) when the selected model/endpoint doesn't support structured outputs — this makes model selection a real gate, not a soft preference.
3. **The `image_prompt` precedence "bug" is mostly already fixed at the code level** (`raw?.image_prompt || flattenedPrompt`) — the actual gap is that nothing *forces* the model to make `image_prompt` rich. Under strict `json_schema` with a well-written field `description` and `required: ["image_prompt", ...]`, the model has no way to omit or under-fill it, which is the real mechanism that closes PLAN-04, not further `||`-chain surgery.

A live check against OpenRouter's model catalog today found that **none of the three Gemini slugs currently offered in the admin "AI Models" card support structured outputs** — `gemini-2.5-flash`, `gemini-2.5-pro`, and `gemini-3.1-flash` are all absent from `/models?supported_parameters=structured_outputs`, while newer slugs (`google/gemini-3.5-flash`, `google/gemini-3.6-flash`, `google/gemini-3.1-flash-lite`) are present with a 65,536-token output ceiling. This is dynamic data — re-verify at implementation time — but it means picking a default model is not just a "pick something Pro-tier" exercise; it is gated on live structured-outputs support, and the admin dropdown needs a new option added regardless of which slug is chosen as the new default.

**Primary recommendation:** Add a schema-builder module (small, composable functions mirroring the existing `GeminiStructuredImagePrompt`/`GeminiCreativePlan` TypeScript shape) that emits (a) the OpenRouter `json_schema` object (lowercase JSON Schema types, `strict: true`, `additionalProperties: false` at every object level, every field in `required` with `null` unions for anything optional) and (b) the direct-Gemini `responseSchema` object (Google's uppercase `Type` enum strings — a structurally different format, not a drop-in reuse of the same object). Attach reference images via the existing `toOpenRouterInputReference()` adapter (already exported from `ai-gateway.service.ts`) placed directly into the chat `content` array for the OpenRouter branch, and via `inlineData` parts (mirroring `generateImage()`) for the direct branch. Add a new admin-configurable model field (recommend a NEW `ai_models.planning` key, not overloading `ai_models.text_generation`, since the latter is shared with caption-only/pre-screen calls that don't need the upgrade). Scale carousel's `maxTokens` via a `base + perSlide * slideCount` formula using the existing `slide_count` bounds (3-8). Log schema failures via a new best-effort helper mirroring `logModelFallback`'s exact pattern (fire-and-forget insert into `generation_logs`, new `event_kind` value — no migration needed since the column is unconstrained `TEXT`).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `openai` (SDK) | `^6.38.0` declared, `6.49.0` installed (verified via `npm view openai version` → registry latest `6.49.0`, matches installed) | `chat.completions.create()` — already the transport for `chatCompletion()` in `ai-gateway.service.ts`; accepts `response_format: { type: "json_schema", json_schema: {...} }` and array `content` (multimodal) unchanged from Phase 21 | Already the sole gateway client in this codebase (GATE-01); no new package needed for either PLAN-01 (multimodal) or PLAN-02 (json_schema) — both are just new *shapes* passed into the same `chatCompletion()` call |
| `zod` | `^3.24.2` (already a dependency) | Widen `generationLogSchema.event_kind` enum; optionally add a `planningStructuredResultSchema` for runtime-validating the model's JSON against the same shape the `json_schema` describes | Codebase's single source of truth for request/response shapes (`shared/schema.ts`) |

### Supporting
No new packages required. This phase is a request/response-shape change inside existing services, not a new integration.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Building `json_schema`/`responseSchema` as plain TS object literals | A schema-definition library (e.g. `zod-to-json-schema`) to derive both formats from one Zod schema | Rejected for this phase: Gemini's direct `responseSchema` uses **uppercase** `Type` enum strings (`"OBJECT"`, `"STRING"`) which no standard JSON-Schema-from-Zod library targets — a converter would need custom uppercase-mapping logic anyway, and the "direct" path is a legacy GATE-07 rollback rarely exercised (Phase 21 note: routing defaults to `"openrouter"`). Two small hand-written object literals (OpenRouter lowercase + Gemini uppercase) sharing a single TypeScript interface for type-safety is more maintainable than a build-time codegen step, given this schema is edited by a human occasionally, not machine-generated per-request. |

**Installation:** None — no new packages.

**Version verification:**
```bash
npm view openai version   # → 6.49.0 (2026-07-27). Installed: 6.49.0 (package-lock). No bump needed.
```

## Architecture Patterns

### Recommended Project Structure
No new files are strictly required — all changes are surgical edits to existing files. If a schema-builder module is preferred for clarity (recommended, given the schema's size once `text_blocks`/`layout_archetype_id` are added):
```
server/services/
├── gemini.service.ts               # generateText() — model tier, multimodal request, json_schema wiring
├── ai-gateway.service.ts           # chatCompletion() — unchanged interface, new caller shape; toOpenRouterInputReference() reused
├── ai-gateway-settings.service.ts  # unchanged — routing/fallback logic orthogonal to schema
├── prompt-builder.service.ts       # buildImagePromptFromStructuredJson() becomes a pure fallback-only helper (transport-failure path), no longer primary
├── planning-schema.service.ts      # NEW (recommended, not required) — exports the shared TS interface + two builder fns: toOpenRouterJsonSchema(), toGeminiResponseSchema()
└── observability.service.ts        # NEW helper: logPlanningSchemaFailure() — mirrors logTextVerification/logCaptionQuality pattern
```

### Pattern 1: Attaching multimodal reference images (PLAN-01)

**What:** Today, `GenerateParams.referenceImages` is typed `string[]` (bare base64, `mimeType` discarded at the call site) and is used ONLY to build a textual sentence ("The user has provided N reference image(s)...") in `buildContextPrompt()`. The actual bytes never enter either HTTP request body in `generateText()`.

**When to use:** Whenever `mergedReferenceImages.length > 0` for the single-image `/api/generate` planning call only (carousel excluded per CONTEXT.md).

**Fix shape:**
1. Change `GenerateParams.referenceImages` from `string[]` to `Array<{ mimeType: string; data: string }>` (matches `mergedReferenceImages`'s existing shape exactly — no new type needed).
2. Update `generate.routes.ts:485` from `mergedReferenceImages.map(img => img.data)` to `mergedReferenceImages` (pass the full objects through — this is the entire fix at the call site).
3. In `generateText()`'s **direct-Gemini branch**, append `inlineData` parts exactly as `generateImage()` already does (`gemini.service.ts:839-847`):
   ```typescript
   const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
     { text: tightenedPrompt },
   ];
   for (const image of params.referenceImages ?? []) {
     parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
   }
   // body: { contents: [{ parts }], generationConfig: {...} }
   ```
4. In `generateText()`'s **OpenRouter branch**, reuse the already-exported `toOpenRouterInputReference()` from `ai-gateway.service.ts` (built in Phase 21 for the dedicated Image API's `input_references`, but its output shape — `{ type: "image_url", image_url: { url: "data:mime;base64,..." } }` — is *exactly* the OpenAI-compatible vision content-part shape OpenRouter's chat completions endpoint expects; live-verified against OpenRouter docs today, 2+ independent sources agree):
   ```typescript
   const content: ChatMessageContent = [
     { type: "text", text: tightenedPrompt },
     ...(params.referenceImages ?? []).map(toOpenRouterInputReference),
   ];
   // messages: [{ role: "user", content }]
   ```
   Note `messages[0].content` today is a plain string (`content: tightenedPrompt`) — this must become the array form only when `referenceImages.length > 0` (or unconditionally, since a single `{type:"text",...}` entry array is equivalent to a plain string for text-only calls — verify this is accepted, or branch on `.length` to minimize behavioral diff for the common no-reference-images case).

**SC1 ablation verification:** Per CONTEXT.md, this is a manual/live test, not a static check — the harness (`verify-phase-22.ts`) can statically assert the request-construction code *includes* the reference-image parts when present (regex/structural check that `inlineData`/`image_url` appears in the built request object), but proving the model's *output* measurably differs requires two real API calls (with vs. without images) compared by a human or a follow-up script gated behind a live API key — mirror the `SK_TEST_*`-gated pattern from `scripts/verify-cron-jobs.ts`.

### Pattern 2: Strict `json_schema` structured output (PLAN-02, PLAN-05 fields)

**What:** OpenRouter's `response_format.json_schema` shape, live-verified 2026-07-27 against `openrouter.ai/docs/guides/features/structured-outputs`:

```typescript
// Source: https://openrouter.ai/docs/guides/features/structured-outputs (live-fetched 2026-07-27)
{
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "art_director_plan",       // required identifier
      strict: true,                     // enforce exact schema compliance where the endpoint supports it
      schema: {
        type: "object",
        properties: { /* ... */ },
        required: [ /* EVERY key in properties, even "optional" ones */ ],
        additionalProperties: false,    // required at EVERY object level, not just the root
      },
    },
  },
}
```

**Critical constraint (verified, HIGH confidence, cross-referenced against OpenAI community docs + OpenRouter docs — this is the standard "strict mode" behavior OpenRouter inherits):** under `strict: true`, **every property must appear in `required`** — there is no true "optional" field. Fields that are conceptually optional (e.g. today's `logo_integration?`, `structured_image_prompt?`, `text_rendering?`) must be modeled as `required` + a nullable union (`{ "type": ["object", "null"] }` or `anyOf: [{...}, {type:"null"}]`), with the model instructed via the field `description` to emit `null` when not applicable. This is a real, non-trivial restructuring of the existing `GeminiCreativePlan`/`GeminiStructuredImagePrompt` TS interfaces (currently full of `?` optionals) — budget real implementation effort for this, not a one-line change.

**Where the model choice matters:** OpenRouter's docs (live-checked) state unsupported-model requests **fail with an explicit error**, not a silent pass-through — this is a **change from the milestone-level PITFALLS.md assumption** (which said "silently ignored"), refined during Phase 21's research and reconfirmed here. This means: if the chosen default model/endpoint doesn't support `structured_outputs`, every planning call will hard-fail at the transport level (a `4xx` from OpenRouter) — which, per this phase's own PLAN-02 design, is a **transport-level failure** (documented fallback path applies), not a schema-validation failure. Get the model right, or every generation silently degrades to the local template via the *transport* path, defeating the point of this phase.

### Pattern 3: Direct-Gemini `responseSchema` — does NOT mirror `json_schema`'s casing (new pitfall, not previously flagged)

**What:** Google's native Gemini REST API (`generateContent`) uses `generationConfig.responseMimeType: "application/json"` + `generationConfig.responseSchema: {...}` (both already camelCase in this codebase's existing direct-path body construction, e.g. `gemini.service.ts:753`, currently only setting `responseMimeType`). Live-verified (2 sources: `ai.google.dev/api/generate-content` + cross-referenced Vertex AI / Firebase AI Logic docs): **the schema's `type` field uses UPPERCASE enum strings** (`"OBJECT"`, `"STRING"`, `"ARRAY"`, `"NUMBER"`, `"BOOLEAN"`, `"INTEGER"`) — not lowercase JSON Schema (`"object"`, `"string"`). `description`, `required`, `enum`, `items`, `properties` are all supported, but the type-casing divergence means **the OpenRouter `json_schema.schema` object and the direct-Gemini `responseSchema` object cannot be the same JS object** — a second, differently-cased schema literal (or a small case-transform function) is needed for the GATE-07 rollback branch.

```typescript
// OpenRouter (lowercase, standard JSON Schema)
{ type: "object", properties: { subject: { type: "string", description: "..." } }, required: ["subject"], additionalProperties: false }

// Direct Gemini (uppercase Type enum — Source: ai.google.dev/api/generate-content, live-fetched 2026-07-27)
{ type: "OBJECT", properties: { subject: { type: "STRING", description: "..." } }, required: ["subject"] }
// Note: Gemini's dialect does not document additionalProperties as required/meaningful the same way; omit or verify empirically.
```

**Confidence:** MEDIUM — verified via 2 independent Google doc pages agreeing on uppercase type strings, but not live-tested against a real API key in this research pass (no key available, consistent with Phase 21's research constraints).

### Pattern 4: Admin-configurable planning-tier model (PLAN-03)

**What:** `aiModelsSchema` (`shared/schema.ts:180-186`) is the exact established pattern — 4 keys today (`image_generation`, `text_generation`, `audio_transcription`, `video_generation`), each rendered as a `<Select>` in `AIModelsCard` (`client/src/components/admin/post-creation/ai-models-card.tsx`), stored inside the `style_catalog` JSONB row (`app_settings`/`platform_settings` table, keyed `setting_key = 'style_catalog'`). Adding a new key is **purely additive** — Zod's `.default(...)` fills it in when the stored JSON lacks the key; no DB migration needed (same mechanism that let Phase 21 add `video_generation` without a migration).

**Recommendation:** add a **new** `planning` key rather than repointing `text_generation` to a Pro-tier default. Evidence: `text_generation` is read by 4 distinct call purposes today — `generateText()`'s main planning call, its own `generateCaptionOnly()` rescue helper (same `model` variable, `gemini.service.ts:810`), `callCarouselTextPlan()`'s master plan (`carousel-generation.service.ts:253`), and `ensureCaptionQuality()`'s caption polish (`generate.routes.ts:771`, `caption-quality.service.ts`). Silently bumping `text_generation`'s default to a pricier tier would 2-4x the cost of every caption/pre-screen call too — not what "the planning call's model becomes admin-configurable ... defaulting to a higher tier" is asking for. A dedicated `planning` field, read only by `generateText()`'s primary call, keeps blast radius scoped to exactly what CONTEXT.md's Phase Boundary describes ("the planning call that drives every single-image generation"). Per CONTEXT.md, `callCarouselTextPlan` keeps using `text_generation` (only its token budget changes this phase, not its model tier) — the Phase Boundary text and the two decision sentences under PLAN-03 support this split reading (model-tier sentence has no carousel mention; token-budget sentence explicitly is carousel-only).

**Default slug — live-verified today, re-check before finalizing:**
```bash
curl -s "https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs" | grep -o '"id":"[^"]*gemini[^"]*"'
```
As of 2026-07-27, this returned (Gemini-family, structured-outputs-capable): `google/gemini-3.6-flash`, `google/gemini-3.5-flash`, `google/gemini-3.5-flash-lite`, `google/gemini-3.1-flash-lite`, plus two image-only models (`gemini-3.1-flash-image`, `gemini-3-pro-image` — not usable for a text planning call). **None of the 3 slugs currently in the admin dropdown** (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3.1-flash`) **appeared in this filtered list** — meaning today's admin-selectable "Pro" option would not actually work under strict `json_schema` mode. Recommend defaulting the new `planning` field to `"gemini-3.5-flash"` (confirmed structured-outputs support + 65,536-token ceiling, comfortably above any realistic budget for this schema) and adding it as a new option in `AIModelsCard`'s dropdown(s). This is genuinely a newer model generation than today's default (`gemini-2.5-flash`), even though OpenRouter doesn't currently expose a Gemini "Pro"-class text model with confirmed structured-outputs support — flag this tension for the planner (see Open Questions).

**Token budget formula (carousel, PLAN-03):** `slide_count` is bounded `min(3).max(8)` (`shared/schema.ts:944`). Today's hardcoded `maxTokens: 2048` (both `callCarouselTextPlan` attempts, `carousel-generation.service.ts:268,294`) is already tight for the *current* minimal per-slide shape (`slide_number`, `image_prompt` only) at 8 slides, and will be insufficient once the schema is enriched. Recommended formula (Claude's discretion per CONTEXT.md — tune during planning):
```typescript
const CAROUSEL_TOKEN_BASE = 1200;      // shared_style + caption + JSON scaffolding
const CAROUSEL_TOKENS_PER_SLIDE = 350; // dense image_prompt + text_blocks + layout fields, per slide
const maxTokens = CAROUSEL_TOKEN_BASE + CAROUSEL_TOKENS_PER_SLIDE * params.slideCount;
// slideCount=3 → 2250, slideCount=8 → 4000 — comfortably under the ~65,536 ceiling of the recommended model
```
Single-image gets a fixed, larger ceiling (no scaling needed — always exactly one image's worth of plan): recommend `maxTokens: 4096` (2x today's `2048`), enough headroom for the richer schema (`creative_plan` + `structured_image_prompt` + `text_blocks` + `layout_archetype_id` + a dense `image_prompt`).

### Pattern 5: Distinguishing schema failures from transport failures (PLAN-02 logging)

**What:** Today, `generateText()`'s outer `try { attempt1 } catch { try { attempt2 } catch { buildLocalTextFallback() } }` treats **every** failure identically — a JSON parse error and a network timeout both silently degrade to the same local template, logged only via `console.error` (never a `generation_logs` row). This is the literal "silent fallback" PLAN-02 targets.

**Recommended shape** (mirrors `ai-gateway.service.ts`'s `logModelFallback` — same fire-and-forget, never-throw contract):
```typescript
// New distinguishable error, thrown from the JSON-parse/schema-validation catch site only
class PlanningSchemaError extends Error {
  constructor(message: string, public rawText: string, public attempt: 1 | 2) {
    super(message);
  }
}

// New observability helper (server/services/observability.service.ts, alongside logTextVerification etc.)
export async function logPlanningSchemaFailure(params: {
  postId: string | null;
  model: string;
  attemptCount: number;
  rawResponsePreview: string; // truncate — avoid huge base64/text blobs in a JSONB column
  errorMessage: string;
}): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    await supabase.from("generation_logs").insert({
      status: "failed",
      error_message: params.errorMessage,
      error_type: "text_generation",
      event_kind: "planning_schema_failure", // NEW value — Zod enum widen only, no migration (column is TEXT)
      outcome: "schema_validation_failed",
      attempt_count: params.attemptCount,
      metadata: { model: params.model, raw_response_preview: params.rawResponsePreview },
    });
  } catch {
    // Best-effort: swallow. Never throw — logging must not break generation flow.
  }
}
```
**Recommended behavior on exhaustion:** when BOTH attempts fail with `PlanningSchemaError` specifically, call `logPlanningSchemaFailure()` (new, distinct observability) and then still return `buildLocalTextFallback()`'s content — directly mirroring the `model_fallback` precedent, where `logModelFallback()` is called but the fallback model's result is still returned to the user (Phase 21's own design: log the anomaly, don't block the user). This satisfies the literal CONTEXT.md wording ("log and surface via `generation_logs`") without inventing a new "hard fail the whole generation" behavior not otherwise specified — see Open Questions for the alternative reading and why this one is recommended.

For genuine transport failures (fetch throws, non-2xx after model-fallback-chain exhaustion, missing API key) — these already throw naturally from within `runTextCall` without ever reaching JSON.parse, so they continue reaching `buildLocalTextFallback()` exactly as today, with **no new logging required** (CONTEXT.md: "remains unchanged").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multimodal image attachment for OpenRouter | A new base64→content-part converter | `toOpenRouterInputReference()` (already exported from `ai-gateway.service.ts`, built in Phase 21 for GATE-02's `input_references`) | Its output shape (`{type:"image_url", image_url:{url:"data:..."}}`) is *exactly* the OpenAI-compatible vision content-part shape chat completions expects (live-verified) — one function, two call sites |
| JSON-Schema-from-TypeScript codegen | A Zod→JSON-Schema library to derive both OpenRouter's and Gemini's schema dialects from one source | Two small hand-written object literals, one shared TS interface for compile-time shape parity | Gemini's uppercase `Type` enum divergence means no off-the-shelf converter targets both dialects; hand-written is simpler than building/maintaining a custom case-transform layer for a schema that changes rarely |
| Retry/fallback orchestration for schema failures | A new generic retry framework | The existing 2-attempt `runTextCall(1)`/`runTextCall(2)` structure, just with error-type discrimination added to the catch | The retry shape (tightened prompt on attempt 2) already exists and works; only the *classification* of the final failure is new |
| generation_logs schema widening | A new migration adding a CHECK constraint for `event_kind` | Add the new value string directly (e.g. `"planning_schema_failure"`) — column is unconstrained `TEXT`, narrowing lives only in `shared/schema.ts`'s Zod enum | Verified via `20260508000000_generation_logs_observability.sql`'s own comment: "error_type column stays unconstrained... adding a CHECK now would be a destructive regression" — same precedent applies to `event_kind`, which was added by the same migration with no CHECK either |

**Key insight:** every piece of new plumbing this phase needs (multimodal content-part shape, admin-configurable model slug, fire-and-forget `generation_logs` insert) already has a working precedent shipped in Phase 21 one file away. The work is almost entirely "apply the existing pattern to a new call site," not "invent a new pattern."

## Common Pitfalls

### Pitfall 1: Strict `json_schema` mode requires every field in `required` — no true optionals
**What goes wrong:** A schema built by literally transcribing today's `GeminiStructuredImagePrompt`/`GeminiCreativePlan` TS interfaces (full of `?` optional fields) into JSON Schema, without restructuring, will either be rejected by OpenRouter (`additionalProperties`/strict-mode validation error) or force the model to always emit every field (defeating fields like `logo_integration` that should be absent/null when no logo is requested).
**Why it happens:** OpenAI-style strict structured outputs (which OpenRouter's `json_schema` inherits) require `required` to list every key in `properties`; there is no partial/optional concept — optionality must be expressed as a nullable union.
**How to avoid:** Model every currently-optional field as `required` + `type: [X, "null"]` (or `anyOf`), with a field `description` instructing the model to emit `null` when not applicable (e.g. `logo_integration`: "null when use_logo is false").
**Warning signs:** OpenRouter returns a `400`-class error mentioning `additionalProperties` or a missing required property; or the model starts hallucinating filler content for fields that should be empty.

### Pitfall 2: OpenRouter structured-outputs support is per-model-per-endpoint, and today's admin-selectable Gemini slugs don't have it
**What goes wrong:** Defaulting the new "higher tier" model to `gemini-2.5-pro` (already in the admin dropdown, looks like the obvious "upgrade") will make every planning call fail at the transport level once `strict: true` is turned on, because — per a live check against `openrouter.ai/api/v1/models?supported_parameters=structured_outputs` on 2026-07-27 — that slug (and `gemini-2.5-flash`, `gemini-3.1-flash`) does not appear in the structured-outputs-capable list.
**Why it happens:** OpenRouter's docs (live-verified) state support is "determined per endpoint, not just per model" and changes as providers add capabilities — the admin dropdown was populated before this constraint existed/mattered.
**How to avoid:** Live-check the exact slug against `/models?supported_parameters=structured_outputs` before hardcoding it as a default (`google/gemini-3.5-flash` and `google/gemini-3.6-flash` were confirmed-capable today with a 65,536-token ceiling); add it as a new admin dropdown option; treat this as a "verify at implementation time" fact, not a permanent one — OpenRouter's catalog is dynamic.
**Warning signs:** OpenRouter returns an error citing "lack of support" for the selected model/endpoint (per Phase 21's research refinement — this is now a documented, explicit failure, not a silent pass-through).

### Pitfall 3: Two near-duplicate local-fallback template builders already exist — don't add a third
**What goes wrong:** `GeminiService.buildLocalTextFallback` (`gemini.service.ts:392-431`, used when `generateText()`'s internal 2 attempts both fail) and `buildTextFallback` (`generate.routes.ts:98-161`, used in the route's OUTER catch when `generateText()` itself throws — which, given the internal catch swallows everything today, is effectively dead code) produce nearly identical output via slightly different code paths.
**Why it happens:** Defense-in-depth was added at two layers over time without consolidating.
**How to avoid:** When adding schema-failure handling, be explicit about which of the two builders is invoked and why; don't add a third variant. Given the internal builder already exists and is exercised, extending its call site (adding the new logging call alongside it) is more surgical than trying to make the route-level catch reachable for the first time.
**Warning signs:** A change that "fixes" schema-failure handling by throwing out of `generateText()` for the first time will suddenly exercise the previously-dead route-level catch and its `buildTextFallback` — a behavior change beyond what's needed, and a second template to keep in sync going forward.

### Pitfall 4: `generation_logs` admin viewer does not select `event_kind`/`outcome`/`metadata` — "surfaced" means the row exists, not that it's visible in the admin UI
**What goes wrong:** Assuming the new schema-failure log will appear in the existing `/api/admin/generations` list (`admin-generations.routes.ts`) — it won't; that endpoint's `.select(...)` only includes `id, user_id, created_at, error_message, request_params, error_type, status`, omitting all of Phase 16's observability columns. This is also true today for `model_fallback` rows.
**Why it happens:** The admin generations list was built before Phase 16's observability columns existed and was never extended.
**How to avoid:** Treat "logged and surfaced in `generation_logs`" as satisfied by the INSERT existing and being queryable via Supabase directly (same bar Phase 21's `model_fallback` met) — do not scope-creep into building new admin UI for this unless CONTEXT.md/REQUIREMENTS.md asks for it (they don't; POL-09's admin quality dashboard is Phase 26, separate).
**Warning signs:** A verification check that greps the admin UI for the new `event_kind` string will fail — that's expected, not a bug, per this precedent.

### Pitfall 5: `text_blocks`/`layout_archetype_id` risk duplicating `headline`/`subtext` if not scoped carefully
**What goes wrong:** The existing `TextBlock` type (`shared/schema.ts:174-178`, `role: "highlight"|"support"|"cta"`, `text`) is conceptually close to `headline` (≈ highlight) + `subtext` (≈ support) — adding a model-generated `text_blocks` array alongside the still-present `headline`/`subtext` fields creates two sources of truth for the same information, inert until Phase 23 wires it in.
**Why it happens:** CONTEXT.md explicitly says these fields are "only consumed by Phase 23's compositor" this phase — i.e., deliberately inert/forward-compatible, not deduplicated yet.
**How to avoid:** Document (don't silently ignore) that `headline`/`subtext` remain the fields actually used this phase; `text_blocks`/`layout_archetype_id` are schema-present, populated, but unread by any Phase-22 code path. Flag the redundancy explicitly for Phase 23 to resolve (likely: `text_blocks` supersedes `headline`/`subtext` once the compositor lands), rather than have it look like an oversight.
**Warning signs:** A reviewer asking "why do we have both `headline` and `text_blocks[role=highlight]`" mid-Phase-22 — the answer is "intentional, per ROADMAP's day-one schema-forward-compatibility requirement," not a bug.

## Code Examples

### OpenRouter multimodal chat-completion request (PLAN-01, direct call construction)
```typescript
// Source: openrouter.ai/docs/guides/overview/multimodal/image-understanding (live-fetched 2026-07-27)
// + this codebase's existing toOpenRouterInputReference() (server/services/ai-gateway.service.ts:254-259)
import { toOpenRouterInputReference } from "./ai-gateway.service.js";

const content: Array<{ type: string; [k: string]: unknown }> = [
  { type: "text", text: tightenedPrompt },
  ...(params.referenceImages ?? []).map(toOpenRouterInputReference),
];

await chatCompletion({
  apiKey: orKey,
  model,
  messages: [{ role: "user", content }],
  responseFormat: { type: "json_schema", json_schema: artDirectorJsonSchema },
  maxTokens: 4096,
});
```

### Direct-Gemini request body with both reference images and responseSchema (PLAN-01 + PLAN-02 direct-path parity)
```typescript
// Mirrors generateImage()'s existing inlineData pattern (gemini.service.ts:835-847)
const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
  { text: tightenedPrompt },
];
for (const image of params.referenceImages ?? []) {
  parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
}

await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
  body: JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: attempt === 1 ? 0.8 : 0.2,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: artDirectorGeminiSchema, // uppercase Type strings — see Pattern 3
    },
  }),
});
```

### `event_kind` Zod widen (no migration)
```typescript
// shared/schema.ts — additive only, mirrors the existing 4-value enum
event_kind: z.enum([
  "text_verification",
  "caption_quality",
  "subject_fidelity",
  "model_fallback",
  "planning_schema_failure", // NEW — Phase 22
]).nullable().optional(),
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `{ type: "json_object" }` + prompt-engineered "respond with ONLY valid JSON" instructions, 2-strategy regex/markdown JSON extraction (`parseGeminiJson`) | `{ type: "json_schema", json_schema: {...}, strict: true }` — the model literally cannot return non-conforming JSON on a supporting endpoint | This phase (PLAN-02) | Eliminates the `no_json_found` parse-failure class entirely on supporting models; shifts the failure mode from "malformed JSON" to "unsupported model/endpoint" (a config problem, not a runtime one) |
| `referenceImages: string[]` mentioned only in prompt text | `referenceImages: Array<{mimeType,data}>` attached as real multimodal content parts | This phase (PLAN-01) | The model can actually see the reference image pixels during planning, not just take the user's word that N images exist |
| `image_prompt` optionally present, mechanically-flattened fallback used liberally | `image_prompt` schema-`required`, field-description-guided to be dense NL, flattening reserved for genuine schema/transport-failure fallback only | This phase (PLAN-04) | The image-generation model receives a coherent scene description instead of a bullet-list-style mechanical concatenation |
| `ai_models.text_generation` shared across 4 unrelated call purposes | Dedicated `ai_models.planning` field, scoped to the single-image art-director call only | This phase (PLAN-03, recommended) | Avoids silently 2-4x'ing the cost of caption/pre-screen calls when only the planning call needs a higher tier |

**Deprecated/outdated:**
- Milestone-level `PITFALLS.md`'s claim that unsupported structured-output requests are "silently ignored" — Phase 21's research already refined this to "the request fails with an explicit error" (re-confirmed independently in this research pass).

## Open Questions

1. **Should a schema-validation failure (after 2 exhausted attempts) still produce a locally-templated post, or should it hard-fail the whole generation?**
   - What we know: CONTEXT.md says "NEVER fall back to `buildLocalTextFallback`'s silent generic template. Instead: log and surface via `generation_logs`." Read literally ("never fall back"), this could mean the generation should hard-fail (no post produced) on a genuine schema failure. Read by analogy to the `model_fallback` precedent (log the anomaly, still return a usable result), it means "never *silently* fall back" — logging turns the same fallback into an observable event.
   - What's unclear: which reading CONTEXT.md's author intended. The word "silent" appears explicitly in the decision text ("silent generic template"), which leans toward the analogy reading (add logging, keep using the fallback) rather than removing the fallback outcome altogether.
   - Recommendation: implement the analogy reading (log via new `event_kind`, still return `buildLocalTextFallback()`'s content) as the default plan, since it (a) matches the literal `model_fallback` precedent CONTEXT.md cites, (b) avoids a user-facing hard failure for what should become a rare event under strict schema mode anyway, and (c) is reversible/low-risk to change later if the planner or a stakeholder wants the harder behavior. Flag this explicitly as a decision point in the plan for a human to confirm before implementation, since the "never fall back" wording is genuinely ambiguous.

2. **Does `ai_models.planning` (new field, this research's recommendation) or reusing `ai_models.text_generation` better match CONTEXT.md's intent?**
   - What we know: CONTEXT.md's PLAN-03 decision text describes "the planning call's model becomes admin-configurable, following the same model-slug settings pattern" (singular "the planning call," not "carousel and single-image both"), and separately scopes carousel to token-budget only.
   - What's unclear: whether "the same model-slug settings pattern" means "add a new key using the same pattern" (this research's reading) or "reuse the existing `text_generation` key, just change its default value" (simpler, but ripples into `generateCaptionOnly`/`ensureCaptionQuality`/carousel cost).
   - Recommendation: new dedicated `ai_models.planning` key, per the evidence in Architecture Pattern 4 (4 distinct call sites currently share `text_generation`). Flag for confirmation during planning since it's a naming/scope decision with real cost implications, not a pure implementation detail.

3. **Which exact model slug should be the `planning` field's default?**
   - What we know: live-verified today, `google/gemini-3.5-flash` and `google/gemini-3.6-flash` support `structured_outputs` with a 65,536-token ceiling; none of today's 3 admin-dropdown Gemini slugs do.
   - What's unclear: OpenRouter's catalog is dynamic (their own docs direct users to check `/models?supported_parameters=structured_outputs` live rather than hardcode) — this fact may already be stale by implementation time, and neither confirmed slug is a "Pro"-tier model (CONTEXT.md's wording implies stepping above Flash-class, which no Gemini text model currently exposes with confirmed structured-outputs support on OpenRouter).
   - Recommendation: re-run the live check (`curl -s "https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs" | grep gemini`) immediately before implementation; default to the newest confirmed-capable Flash-generation slug if no Gemini Pro-tier text model has structured-outputs support by then, and note this openly in the plan/commit message as a known tension with the "higher tier than Flash-class" phrasing rather than silently picking a slug that doesn't actually satisfy it.

4. **Exact placement of `text_blocks`/`layout_archetype_id` in the schema — top-level sibling of `headline`/`caption`, or nested inside `creative_plan`?**
   - What we know: `TextBlock` (`role`, `text`) already exists as a shared Zod type; the 3 layout archetypes are named in ROADMAP.md's TYPO-02 text ("bottom band w/ scrim, top stack, centered hero").
   - What's unclear: no code currently reads either field (Phase 23 doesn't exist yet), so there's no existing consumer shape to match against.
   - Recommendation: place both at the top level of `GeminiTextResult` (sibling to `headline`/`subtext`/`image_prompt`/`caption`/`creative_plan`), reusing the existing `TextBlock` Zod type verbatim for `text_blocks` (max 3, matching the existing `textBlockSchema.max(3)` precedent at `shared/schema.ts:904`), and a `layout_archetype_id: z.enum(["bottom_band","top_stack","centered_hero"])` for `layout_archetype_id`, defaulting the model's guidance toward `"bottom_band"` when uncertain (common, safe default for social captions). Flag for Phase 23 to confirm/adjust once the compositor's real needs are known.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `openai` npm package | `chat.completions.create()` with multimodal `content` + `json_schema` | Yes | Installed `6.49.0` (registry latest, verified `npm view openai version`) | N/A |
| `OPENROUTER_API_KEY` (platform env) | All gateway-routed planning calls | Configured per Phase 21 (STATE.md confirms Phase 21 fully shipped and gate-verified) | — | Direct-Gemini rollback path (`ai_gateway_routing.planning = "direct"`) if flipped |
| OpenRouter model catalog reachability (network) | Verifying which Gemini slug supports `structured_outputs` before hardcoding a default | Reachable — live-fetched successfully during this research pass (2026-07-27) | — | If unreachable at implementation time, fall back to the last-known-good slugs listed in this document, but re-verify as soon as possible after |
| Node global `fetch` | Direct-Gemini branch's raw HTTP calls (unchanged from today) | Yes — Node 24 runtime (verified `node --version` → v24.13.0) | v24.13.0 | N/A |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** OpenRouter model-catalog liveness (fallback: use this document's live-verified slugs as of 2026-07-27, re-check ASAP).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (no jest/vitest/mocha in `package.json`) — this codebase uses hand-written `scripts/verify-phase-NN.ts` static/structural + gated-live harnesses, run directly via `tsx` |
| Config file | none — see Wave 0 |
| Quick run command | `npx tsx scripts/verify-phase-22.ts` (new file, follows `verify-phase-21.ts`'s exact structure: numbered `check()` calls, `--only=<tag>` filter, exit-code-driven) |
| Full suite command | `npx tsx scripts/verify-phase-22.ts && npm run check` (TypeScript compile is the closest thing to a full suite in this repo) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-01 | `generate.routes.ts` passes full `{mimeType,data}` objects (not `.map(img => img.data)`) into `generateText()`; `generateText()`'s request-construction code includes `inlineData`/`image_url` parts when `referenceImages.length > 0` | static (regex/AST-style source check) | `npx tsx scripts/verify-phase-22.ts --only=svc-multimodal` | ❌ Wave 0 |
| PLAN-01 (SC1 ablation) | A real generation with vs. without reference images produces measurably different `image_prompt`/output | manual/live (per CONTEXT.md — requires a real API key + human/scripted comparison) | documented runbook step, gated behind `OPENROUTER_API_KEY` presence, mirrors `scripts/verify-cron-jobs.ts`'s `SK_TEST_*` gate | ❌ Wave 0 |
| PLAN-02 | `chatCompletion()` call site passes `responseFormat: {type:"json_schema", json_schema:{...}}` (not `json_object`); direct-Gemini branch passes `responseSchema` | static | `npx tsx scripts/verify-phase-22.ts --only=svc-schema` | ❌ Wave 0 |
| PLAN-02 (failure logging) | Schema-validation failure path calls a distinct logging helper with a new `event_kind`, not silently `buildLocalTextFallback()`-only | static (assert helper exists + is called in the right catch branch) + functional (no-network unit test feeding a malformed-JSON fixture through the classification logic) | `npx tsx scripts/verify-phase-22.ts --only=svc-schema-failure-log`; `npx tsx scripts/test-planning-schema-classification.ts` (new, mirrors `scripts/test-openrouter-image-adapter.ts`'s no-network pattern) | ❌ Wave 0 |
| PLAN-03 | New `ai_models.planning` (or chosen field) exists in `aiModelsSchema`, has a structured-outputs-capable default, admin UI exposes it; carousel `maxTokens` scales with `slideCount` via the chosen formula | static | `npx tsx scripts/verify-phase-22.ts --only=svc-model-tier`, `--only=svc-token-budget` | ❌ Wave 0 |
| PLAN-04 | `image_prompt` is `required` in the schema (not optional); no mechanical-flattening call site remains as the primary path (only as documented-fallback path) | static | `npx tsx scripts/verify-phase-22.ts --only=svc-prompt-precedence` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsx scripts/verify-phase-22.ts --only=<relevant-tag>` + `npm run check`
- **Per wave merge:** `npx tsx scripts/verify-phase-22.ts` (full harness) + `npm run check`
- **Phase gate:** Full harness green + `npm run check` clean before `/gsd:verify-work`; SC1's live ablation step is a documented manual runbook item (cannot be gated in CI without a funded API key, consistent with Phase 21's precedent for live-only checks)

### Wave 0 Gaps
- [ ] `scripts/verify-phase-22.ts` — new harness file, structural copy of `verify-phase-21.ts`'s pattern (numbered checks, `--only` filter)
- [ ] `scripts/test-planning-schema-classification.ts` — new, no-network functional test asserting schema-vs-transport error classification logic returns the right branch for fixture inputs (malformed JSON string, valid-but-schema-mismatched JSON, and a simulated network-error object), mirrors `scripts/test-openrouter-image-adapter.ts`'s existing no-network-fixture-test pattern
- [ ] No shared fixtures needed beyond small inline literals in the new test script

## Sources

### Primary (HIGH confidence)
- `server/services/ai-gateway.service.ts` (read in full) — `ChatCompletionParams.responseFormat` type already declaring `json_schema` shape; `toOpenRouterInputReference()`; `logModelFallback()` pattern
- `server/services/gemini.service.ts` (read in full) — `generateText()`, `normalizeGeminiTextResult()`, `buildLocalTextFallback()`, `generateImage()`'s `inlineData` pattern
- `server/services/prompt-builder.service.ts` (read in full) — `buildImagePromptFromStructuredJson()`
- `server/routes/generate.routes.ts` (read L1-170, L400-780) — `mergedReferenceImages` construction, `buildTextFallback()`, all `creative_plan`/`image_prompt` consumer call sites
- `server/services/carousel-generation.service.ts` (read L200-340) — `callCarouselTextPlan()`, `validateCarouselTextPlan()`
- `server/services/ai-gateway-settings.service.ts` (read in full) — `getCallRouting`/`getFallbackChain` pattern
- `shared/schema.ts` (read relevant ranges) — `aiModelsSchema`, `textBlockSchema`, `generationLogSchema` (`event_kind` unconstrained), `slide_count` bounds
- `client/src/components/admin/post-creation/ai-models-card.tsx` (read in full) — admin model-slug dropdown pattern
- `supabase/migrations/20260306000000_generation_logs.sql` + `20260508000000_generation_logs_observability.sql` (read in full) — confirms `event_kind`/`error_type` are unconstrained `TEXT`, no CHECK constraint, explicit migration-comment precedent for additive-only Zod narrowing
- `server/services/observability.service.ts` (read in full) — `logTextVerification`/`logCaptionQuality`/`logSubjectFidelityFailure` fire-and-forget pattern to mirror
- `server/routes/admin-generations.routes.ts` (read in full) — confirms observability columns not selected/surfaced in admin UI today
- `.planning/phases/21-openrouter-gateway-foundation/21-RESEARCH.md` (read relevant sections) — structured-outputs-failure-mode refinement, `input_references` adapter precedent
- `openrouter.ai/docs/guides/features/structured-outputs` (live-fetched 2026-07-27) — exact `json_schema` request shape, strict-mode requirement, unsupported-model error behavior
- `openrouter.ai/api/v1/models?supported_parameters=structured_outputs` (live-fetched 2026-07-27) — exact list of currently structured-outputs-capable Gemini slugs + `max_completion_tokens`
- `ai.google.dev/api/generate-content` (live-fetched 2026-07-27) — `responseMimeType`/`responseSchema` field names, uppercase `Type` enum confirmation
- `npm view openai version` (run 2026-07-27) — confirms installed SDK version current

### Secondary (MEDIUM confidence)
- OpenRouter chat-completions multimodal `image_url` content-part shape — verified via WebSearch across 2+ independent sources (OpenRouter's own multimodal image-understanding doc + a third-party integration guide agreeing on the same shape)
- Gemini `responseSchema` uppercase `Type` enum — cross-referenced via WebSearch against Vertex AI / Firebase AI Logic docs alongside the primary `ai.google.dev` fetch; not live-tested against a real API key in this research pass

### Tertiary (LOW confidence)
- None flagged — all findings above were either directly verified against this codebase's source files or cross-checked against 2+ independent official documentation sources during this research pass.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, existing SDK version confirmed current
- Architecture: HIGH for codebase mechanics (multimodal gap, precedence logic, admin pattern — all directly read from source); MEDIUM for the exact OpenRouter/Gemini schema dialect details (live-verified today, officially documented, but not tested against a real API key)
- Pitfalls: HIGH for codebase-specific findings (dual fallback builders, admin UI column gap, mimeType-stripping bug); MEDIUM for OpenRouter model-capability specifics (dynamic catalog, verified today but time-sensitive)

**Research date:** 2026-07-27
**Valid until:** 7 days for the OpenRouter model-capability/default-slug specifics (fast-moving, live-verified catalog data); 30 days for the codebase-structural findings (multimodal gap, dual fallback builders, schema shape requirements — stable until this phase's own code changes land)
