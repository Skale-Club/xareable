# Phase 22: Art Director Planning Upgrade - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning

<domain>
## Phase Boundary

The planning call that drives every single-image generation actually receives reference images multimodally, returns dependable structured JSON from a higher-tier model with a token budget that scales with output size, and its structured output — not a stale mechanical concatenation — is the true source of the final image prompt.

</domain>

<decisions>
## Implementation Decisions

### Multimodal References (PLAN-01)
- Applies to the single-image `/api/generate` planning call (`GeminiService.generateText`) only — carousel's `callCarouselTextPlan` is NOT extended in this phase; carousel-specific reference/style-board work belongs to Phase 25's "Aesthetic DNA" scope.
- Reuses the exact same `mergedReferenceImages` set (brand reference photos + user-uploaded images) already computed in `generate.routes.ts` for the image-gen call — no new fetch/merge logic needed, just attach the same set to the planning call too.
- Multimodal format mirrors existing patterns: `inlineData` parts for the direct-Gemini path (same shape as `generateImage`'s existing reference-image attachment), and the gateway's array/multimodal `content` shape already used for audio (`ai-gateway.service.ts`) for the OpenRouter path.
- The SC1 ablation-run verification (with vs. without reference images measurably changing output) is a technical/testing detail — likely a manual/live test since it requires a real API call to observe a real behavioral difference; exact mechanism left to research + planning.

### Strict Structured Output & Failure Handling (PLAN-02, PLAN-05 fields)
- The planning call uses OpenRouter's real `json_schema` response format (strict structured output), replacing today's loose `{ type: "json_object" }` + prompt-engineered field instructions.
- Schema validation failures (malformed/incomplete JSON not matching the schema) NEVER fall back to `buildLocalTextFallback`'s silent generic template. Instead: log and surface via `generation_logs` (a new `event_kind`, mirroring Phase 21's `model_fallback` pattern).
- The existing transport-error fallback (network/auth failures — genuine connectivity issues, not schema/parse issues) remains unchanged and continues to use the documented fallback path.
- `text_blocks` and `layout_archetype_id` are added to the `json_schema` as required fields with sensible defaults the model can safely emit today, even though Phase 23's compositor is the only future consumer — so the schema never needs reopening.

### Higher-Tier Model & Token Budget (PLAN-03)
- The planning call's model becomes admin-configurable, following the same model-slug settings pattern established in Phase 21 (`ai_gateway_routing`/`ai_model_fallbacks` / `style_catalog.ai_models`), defaulting to a genuinely higher-capability tier than the current Flash-class model.
- Carousel's output token budget scales with `slideCount` (exact formula — base + per-slide increment — left to research/planning, informed by the new schema's expected response size). Single-image generation gets a larger fixed ceiling (no per-slide scaling needed since it's always one image).

### Precedence Bug Fix (PLAN-04)
- The model's `image_prompt` field becomes the schema-required, authoritative field under strict `json_schema` mode — no longer a `||` fallback chain against a mechanically-concatenated flattening of the other creative-plan fields.
- The exact prompt-engineering mechanism (how the schema's field description guides the model to produce a genuinely dense natural-language scene description synthesizing composition/style/color/mood/subject, vs. any remaining programmatic assembly) is a technical implementation detail — Claude's discretion, to be validated carefully during this phase's research step given the nuance uncovered while scoping (today's `raw?.image_prompt || flattenedPrompt` already lets the model's own field win when present; the real fix is making that field reliably rich and schema-guided, not changing which side of an `||` wins).

### Claude's Discretion
- Exact token-budget scaling formula for carousel.
- Exact schema field descriptions/prompt engineering for PLAN-04's dense-description fix.
- Exact new `event_kind` value and `generation_logs` payload shape for schema-failure logging.
- Default model slug chosen for the higher tier.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/services/ai-gateway.service.ts` `chatCompletion()` — already supports array/multimodal `content` (used today for audio input); no new gateway capability needed, just a new caller shape.
- `generate.routes.ts:459-474` — `mergedReferenceImages` (brand + user images, `{mimeType, data}` shape) already fetched before the planning call; same set to attach multimodally.
- `image-provider.ts` / `gemini.service.ts:826-847` `generateImage` — existing `inlineData` multimodal-attachment pattern to mirror for the planning call.
- Phase 21's `model_fallback` `generation_logs` `event_kind` pattern (`ai-gateway.service.ts` `logModelFallback`) — pattern to mirror for the new schema-failure logging.
- Phase 21's admin-configurable model-slug pattern (`ai-gateway-settings.service.ts`, `style_catalog.ai_models`) — pattern to mirror for the planning-call model tier setting.

### Established Patterns
- `normalizeGeminiTextResult` (`gemini.service.ts:352-390`) — current `imagePrompt = raw?.image_prompt || flattenedPrompt` precedence; `buildImagePromptFromStructuredJson` (`prompt-builder.service.ts:69-152`) is today's mechanical-concatenation flattening fallback.
- `buildLocalTextFallback` (`gemini.service.ts:392-431`) — the local-fallback template this phase must stop using for schema-validation failures specifically (transport-error use remains).
- Carousel (`carousel-generation.service.ts`) has NO local-fallback template today — hard failures already surface to the user; this phase's schema-failure logging requirement is analogous but for the single-image path.

### Integration Points
- `server/routes/generate.routes.ts:485` (`gemini.generateText({ referenceImages: ..., ... })`) and `:576` (`prompt: textResult.content.image_prompt`) — the two call sites this phase's changes flow through.
- `server/services/gemini.service.ts` `generateText` (~L602-820) — the core function being upgraded (multimodal request, json_schema, model tier, token budget).
- `server/services/carousel-generation.service.ts` `callCarouselTextPlan` (~L242-316) — token-budget scaling applies here (slide count), but reference-image attachment does NOT (deferred to Phase 25).

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP's stated success criteria and REQUIREMENTS.md's PLAN-01..04 — these are the primary specification, cross-checked against the codebase scout above.

</specifics>

<deferred>
## Deferred Ideas

- Carousel planning-call multimodal reference-image attachment — deferred to Phase 25 (Narrative Carousels & Aesthetic DNA), which already owns carousel-specific style-reference-board work.

</deferred>
