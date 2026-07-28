---
status: partial
phase: 21-openrouter-gateway-foundation
source: [21-VERIFICATION.md]
started: 2026-07-27T14:52:09Z
updated: 2026-07-27T14:52:09Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live 5-surface smoke test
expected: Generate a single-image post, edit a post, transcribe a voice note, generate a carousel, and enhance a product photo, with `OPENROUTER_API_KEY` provisioned and `ai_gateway_routing` left at its 'openrouter' default. All five operations complete successfully; each produces a `usage_events` row with non-null `metadata.real_cost_usd_micros` and `metadata.estimated_cost_usd_micros`.
result: [pending]

### 2. Fallback-chain live simulation
expected: PATCH `/api/admin/ai-model-fallbacks` with a fallback chain configured, set the primary model to a bogus slug, generate a post, then restore the slug. Generation succeeds via the fallback model; a `generation_logs` row with `event_kind='model_fallback'` and metadata `{from_model, to_model, reason}` appears.
result: [pending]

### 3. Rollback live round-trip
expected: PATCH `/api/admin/ai-gateway-routing` `{call_class:'image', mode:'direct'}`, generate an image post, confirm success via the legacy Gemini path (usage_events row has NULL metadata), then flip back to 'openrouter'. Generation succeeds on the direct path with no gateway involvement; flipping back restores OpenRouter routing without a deploy.
result: [pending]

### 4. GATE-08 paid Veo smoke test
expected: Generate one video in staging via the direct Google path. Video generation succeeds, confirming the untouched `video-generation.service.ts` still works end-to-end after all Phase 21 changes landed around it.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
