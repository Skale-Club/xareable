---
phase: 21-openrouter-gateway-foundation
verified: 2026-07-27T14:50:08Z
status: human_needed
score: 6/6 automatable truths verified; 3 success criteria require a live OPENROUTER_API_KEY to fully close
human_verification:
  - test: "Live end-to-end smoke: generate a single-image post, edit a post, transcribe a voice note, generate a carousel, and enhance a product photo, with OPENROUTER_API_KEY provisioned and ai_gateway_routing left at its 'openrouter' default."
    expected: "All five operations complete successfully; each produces a usage_events row with non-null metadata.real_cost_usd_micros and metadata.estimated_cost_usd_micros."
    why_human: "Requires a real, funded OPENROUTER_API_KEY and paid live calls — no key is configured in this environment (.env has zero OPENROUTER_* entries), so the gateway branch cannot be exercised without network/cost side effects the verifier must not incur."
  - test: "Fallback-chain simulation: PATCH /api/admin/ai-model-fallbacks {call_class:'text', chain:['google/gemini-2.5-flash']}, temporarily set style_catalog.ai_models.text_generation to a bogus slug, generate a post, then restore the slug."
    expected: "Generation succeeds via the fallback model; a generation_logs row with event_kind='model_fallback' and metadata {from_model, to_model, reason} appears."
    why_human: "Requires a live OpenRouter call to observe a real 404/model_not_found response and confirm callWithFallback's regex-based trigger actually fires end-to-end; static reading of callWithFallback/logModelFallback confirms the code path exists and is wired to generation_logs, but not that OpenRouter's real error shape matches the regex in production."
  - test: "Rollback flip: PATCH /api/admin/ai-gateway-routing {call_class:'image', mode:'direct'}, generate an image post, confirm success via the legacy Gemini path (usage_events row has NULL metadata), then flip back to 'openrouter'."
    expected: "Generation succeeds on the direct path with no gateway involvement; flipping back restores OpenRouter routing without a deploy."
    why_human: "Requires live Gemini credentials + a running server to exercise both branches of the routing switch; code inspection confirms the branch exists (getCallRouting('image') in image-provider.ts) and is admin-controllable via the endpoint, but not that the direct path still succeeds against a live Gemini key today."
  - test: "GATE-08 video smoke (paid Veo call): generate one video in staging via the direct Google path."
    expected: "Video generation succeeds, confirming the untouched video-generation.service.ts still works end-to-end after all Phase 21 changes landed around it."
    why_human: "Requires a paid Veo API call; this phase's own VALIDATION.md documents this as an explicitly env-gated, non-CI-blocking manual step. Static verification (SHA-256 baseline match, zero OpenRouter references, target host unchanged) is already confirmed automated and passing."
---

# Phase 21: OpenRouter Gateway Foundation Verification Report

**Phase Goal:** All platform AI calls (text/planning, image generation and editing, transcription) run through one OpenRouter gateway service with admin-configurable model slugs and per-call-class fallback chains, real per-request cost flowing into billing, and an emergency rollback to the direct Gemini path — while video stays completely untouched. Two unrelated but trivial production-bug fixes ride along since this phase already touches their files.

**Verified:** 2026-07-27T14:50:08Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Single-image generate, edit, transcribe, carousel, and enhance all route through OpenRouter (not direct raw-fetch) by default | ✓ VERIFIED (code) / ? needs live smoke | `getCallRouting("planning"/"image"/"transcription")` branches confirmed in gemini.service.ts:660, carousel-generation.service.ts:~253, caption-quality.service.ts:68, enhancement.service.ts:240/482, image-provider.ts:357, transcribe.routes.ts:135 — all default to `"openrouter"` per `DEFAULT_ROUTING` in ai-gateway-settings.service.ts. No `OPENROUTER_API_KEY` is provisioned in this environment, so a live end-to-end call cannot be exercised here (see human_verification #1). |
| 2 | Admin can change model slug per call class via `platform_settings` without a deploy; old gemini/openai `image_provider` toggle is gone | ✓ VERIFIED | `resolveImageProviderName`/`getActiveImageProvider` in image-provider.ts no longer call `getPlatformSetting("image_provider")` (grep confirms 0 matches); `ai-models-card.tsx` has 0 `OPENAI_SENTINEL`/`image-provider` references; admin.tsx has 0 `ImageProviderSection` references. Legacy `/api/admin/image-provider` endpoints retained dead (explicit deprecation comment) per additive-deprecation convention — does not block "toggle is gone" from the user/factory perspective. |
| 3 | Simulated 404/deprecation on a call class's primary model triggers the fallback chain automatically, logged to `generation_logs` | ✓ VERIFIED (code) / ? needs live sim | `callWithFallback()` in ai-gateway.service.ts:82-110 implements one-pass-through-chain with a `/404\|410\|5\d\d\|model_not_found/i` trigger regex and calls `logModelFallback()` (writes `event_kind: "model_fallback"` to `generation_logs`, best-effort/never-throws). `event_kind` Zod enum includes `"model_fallback"` (shared/schema.ts). Live trigger against OpenRouter's real error shape not exercised here (see human_verification #2). |
| 4 | Both pre-call estimate and post-call real `usage.cost` are recorded per generation | ✓ VERIFIED | `recordUsageEvent` (quota.ts:579-627) accepts additive `realCostUsdMicros?`/`estimatedCostMicros?`, short-circuits pricing to `realCostUsdMicros × getMarkupMultiplier(userId)` when present, and persists both into `usage_events.metadata` (`hasGatewayMeta` gate). All 6 route call sites (generate, edit, carousel×2, enhance, transcribe) pass both values — confirmed by grep in each file (see Requirements Coverage). `usage_events.metadata` JSONB column migration exists and is additive. |
| 5 | Admin can flip any call class back to the direct Gemini path without a deploy; generation still succeeds via that path | ✓ VERIFIED (code) / ? needs live flip | `GET/PATCH /api/admin/ai-gateway-routing` (admin-settings.routes.ts:65-86) reads/writes `platform_settings.ai_gateway_routing` with no caching (immediate effect), guarded by `requireAdminGuard`. Every migrated call site's direct branch is byte-verified still present (`generativelanguage.googleapis.com` + `x-goog-api-key`, never deleted). Live round-trip not exercised here (see human_verification #3). |
| 6 | Video untouched; carousel aborts immediately on slide-1 failure; video-edit credit estimate correct; zero API keys in query strings | ✓ VERIFIED | SHA-256 of `video-generation.service.ts` recomputed independently (`1b47b62a5...c7daf`) — matches the baseline literal in `scripts/verify-phase-21.ts` exactly; zero `openrouter` references in that file; `BASE_URL` still `generativelanguage.googleapis.com`. `carousel-generation.service.ts:604-607` contains `if (i === 0) { break; }` inside the slide-loop catch block. `edit.routes.ts:145/189` hoists `isVideoPost` before `checkCredits(user.id, "edit", isVideoPost)`. Recursive `grep -rn "?key="` across `server/` returns zero matches (only one code *comment* mentions the string, not a live query string). |

**Score:** 6/6 truths have their code-level mechanics verified; 3 of the 6 (#1, #3, #5) also have an unavoidable live/paid-API component that cannot be exercised without a provisioned `OPENROUTER_API_KEY` — this is architecturally expected (the phase's own VALIDATION.md designates these "Manual-Only Verifications") and is not a code gap.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/services/ai-gateway.service.ts` | `chatCompletion`, `transcribe`, `generateImage`, `editImage`, `toOpenRouterInputReference`, `callWithFallback`, `normalizeOpenRouterModelSlug`, `OPENROUTER_BASE_URL` | ✓ VERIFIED | All present, read in full; matches OpenRouter's live-verified Image API contract (top-level `aspect_ratio`/`resolution`, nested `input_references`, `b64_json`/`usage.cost` response parsing). |
| `server/services/ai-gateway-settings.service.ts` | `getCallRouting`, `setCallRouting`, `getFallbackChain`, `setFallbackChain` | ✓ VERIFIED | All 4 exported; direct-query (no cache) pattern over `platform_settings.ai_gateway_routing`/`ai_model_fallbacks`. |
| `server/services/image-provider.ts` | `OpenRouterImageProvider implements ImageProvider`; routing-aware factory | ✓ VERIFIED | Class present (line 284); factory (`getActiveImageProvider`/`resolveImageProviderName`) branches on `getCallRouting("image")`; legacy `image_provider` platform setting no longer read. |
| `server/quota.ts` | `recordUsageEvent(..., realCostUsdMicros?, estimatedCostMicros?)` | ✓ VERIFIED | Signature extended additively; markup applied via pre-existing `getMarkupMultiplier`; both values written to `usage_events.metadata`. |
| `supabase/migrations/20260718000000_ai_gateway_settings.sql`, `20260718000001_usage_events_metadata.sql` | Seed rows + additive metadata column | ✓ VERIFIED | Both files exist on disk with the expected `INSERT ... ON CONFLICT DO NOTHING` / `ADD COLUMN IF NOT EXISTS` statements. |
| `scripts/verify-phase-21.ts` | Full check registry, GATE-08 real from Wave 1, all 9 other checks flipped real by 21-13 | ✓ VERIFIED | Ran independently: `npx tsx scripts/verify-phase-21.ts` → 43/43 PASS, exit 0. |
| `scripts/test-openrouter-image-adapter.ts` | No-network functional adapter test | ✓ VERIFIED | Ran independently: 3/3 PASS, exit 0 (invoked both directly and via the harness's `spawnSync`). |
| `server/routes/admin-settings.routes.ts` | GET/PATCH `/api/admin/ai-gateway-routing` + `/api/admin/ai-model-fallbacks` | ✓ VERIFIED | All 4 endpoints present, each guarded by `requireAdminGuard`, calling `getCallRouting`/`setCallRouting`/`getFallbackChain`/`setFallbackChain` correctly. |
| `client/src/components/admin/post-creation/ai-models-card.tsx` | OpenAI sentinel/provider-toggle removed | ✓ VERIFIED | Zero `OPENAI_SENTINEL`/`image-provider` references remain. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `gemini.service.ts` / `carousel-generation.service.ts` / `caption-quality.service.ts` / `enhancement.service.ts` | `ai-gateway.service.ts chatCompletion` | routing branch on `getCallRouting("planning")` | ✓ WIRED | Confirmed imports + call sites in all 4 files; direct-path fallback retained in each. |
| `transcribe.routes.ts` | `ai-gateway.service.ts transcribe` | `getCallRouting("transcription")` branch | ✓ WIRED | `aiGatewayTranscribe` imported and called; direct header-auth fallback retained. |
| `image-provider.ts OpenRouterImageProvider` | `ai-gateway.service.ts generateImage/editImage` | delegation | ✓ WIRED | Thin-wrapper class confirmed calling gateway functions with the platform key. |
| `ai-gateway.service.ts callWithFallback` | `generation_logs (event_kind=model_fallback)` | `logModelFallback` best-effort insert | ✓ WIRED | Confirmed insert call with correct `event_kind`; schema enum extended to accept it. |
| All 6 route files | `quota.ts recordUsageEvent(realCostUsdMicros, estimatedCostMicros)` | trailing positional args | ✓ WIRED | Confirmed via grep in generate/edit/carousel(×2)/enhance/transcribe routes.ts — every call site passes both new args. |
| `admin-settings.routes.ts` | `ai-gateway-settings.service.ts setCallRouting/setFallbackChain` | PATCH handlers | ✓ WIRED | Confirmed both PATCH handlers call the settings-service write functions with validated bodies. |

### Data-Flow Trace (Level 4)

Not applicable in the traditional (frontend-render) sense — this phase is backend/service-layer plumbing. The equivalent trace performed: `costUsdMicros` values are read from live API response bodies (`response.usage.cost` / `data.usage.cost`) inside `chatCompletion`, `transcribe`, and `callImageApi` — not hardcoded or defaulted to a non-zero constant — and flow through provider/service result types (`ImageProviderResult.costUsdMicros`, `GeminiTextResponse.costUsdMicros`, `CarouselGenerationResult.costUsdMicrosTotal`, `EnhancementResult.costUsdMicrosTotal`) into every `recordUsageEvent` call site with `undefined` (not `0`) as the no-gateway-cost sentinel, correctly preserving token-table/flat-fallback pricing on direct-path and video runs. This data-flow shape is structurally sound; whether OpenRouter's live response actually contains a non-zero `usage.cost` in production is part of human_verification #1/#4 (deferred, requires a live key).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase verify harness | `npx tsx scripts/verify-phase-21.ts` | 43 PASS / 0 FAIL, exit 0 | ✓ PASS |
| TypeScript compiles | `npm run check` | exit 0 | ✓ PASS |
| Image adapter functional test | `npx tsx scripts/test-openrouter-image-adapter.ts` | 3/3 PASS, exit 0 | ✓ PASS |
| GATE-08 freeze | `sha256sum server/services/video-generation.service.ts` | `1b47b62a50cb12d6cc427ddc16923cb5aa745cab265b85e03b1464b9183c7daf` (matches harness baseline exactly) | ✓ PASS |
| POL-07 recursive scan | `grep -rn "?key=" server/` | 1 match, in a code *comment* only (not a live query string) | ✓ PASS |
| Live OpenRouter round-trip | n/a — no `OPENROUTER_API_KEY` in `.env` (0 `OPENROUTER` lines) | not run | ? SKIP — requires provisioned key + paid calls, routed to human verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| GATE-01 | 21-04, 21-07, 21-08 | Text/planning calls (art-director, carousel plan, caption quality, enhancement caption, pre-screen) via one shared gateway | ✓ SATISFIED | `chatCompletion` used by all 4 named services + gemini.service.ts; each retains a direct rollback branch. |
| GATE-02 | 21-05, 21-06 | Image gen/edit via OpenRouter's dedicated Image API; `ImageProvider` interface preserved | ✓ SATISFIED | `generateImage`/`editImage` target `openrouter.ai/api/v1/images` with top-level `aspect_ratio`/`resolution`; `OpenRouterImageProvider implements ImageProvider`; all 6 call sites untouched (`npm run check` proves compile-compat). |
| GATE-03 | 21-04, 21-09 | Transcription via gateway | ✓ SATISFIED | `transcribe()` (multimodal `input_audio`) wired into `transcribe.routes.ts` with a routing branch. |
| GATE-04 | 21-03, 21-06, 21-08 | Admin-configurable slugs + fallback chain per call class; legacy toggle retired | ✓ SATISFIED | `ai_model_fallbacks` settings row + `getFallbackChain`; carousel's hardcoded `TEXT_MODEL` replaced with `ai_models?.text_generation`; `image_provider` toggle retired from the factory. |
| GATE-05 | 21-03, 21-09, 21-10, 21-11, 21-12 | Billing consumes real `usage.cost` with markup; static tables retired for gateway calls | ✓ SATISFIED | `recordUsageEvent` additive params + markup; wired into all 6 route call sites (generate, edit, carousel generate, carousel slide-edit, enhance, transcribe). |
| GATE-06 | Phase 21.1 (out of scope) | Affiliate BYOK OpenRouter keys | N/A — correctly deferred | REQUIREMENTS.md maps GATE-06 to Phase 21.1, not Phase 21; not claimed by any Phase 21 plan; not a gap. |
| GATE-07 | 21-03, 21-06, 21-07, 21-08, 21-09 | Emergency rollback per call class, no deploy | ✓ SATISFIED | `ai_gateway_routing` settings + admin PATCH endpoint; every migrated call site's direct branch retained and reachable via the routing flag. |
| GATE-08 | 21-01 (frozen throughout) | Video pipeline untouched | ✓ SATISFIED | SHA-256 baseline match independently recomputed; zero OpenRouter references; zero commits in the phase touch `video-generation.service.ts` (confirmed via `git show --stat` across all 27 phase commits). |
| POL-01 | 21-02 | Video-edit credit gate passes `isVideo` | ✓ SATISFIED | `isVideoPost` hoisted before `checkCredits(user.id, "edit", isVideoPost)` in edit.routes.ts. |
| POL-07 | 21-02, 21-07, 21-08, 21-09 | Zero API keys in query strings | ✓ SATISFIED | Recursive `grep -rn "?key=" server/` returns only a code comment, zero live occurrences. |
| CRSL2-03 | 21-02 | Slide-1 failure aborts loop immediately | ✓ SATISFIED | `if (i === 0) { break; }` present in the slide-loop catch block, verified directly. |

**Orphaned requirements check:** REQUIREMENTS.md maps exactly GATE-01..05, GATE-07, GATE-08, POL-01, POL-07, CRSL2-03 to Phase 21 (GATE-06 explicitly to Phase 21.1). Every one of these 10 IDs appears in at least one plan's `requirements:` frontmatter and in 21-13's consolidated final list. No orphans found.

### Anti-Patterns Found

None. Scanned all 14 gateway/route/service files touched by this phase for `TODO`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" — zero matches.

### Human Verification Required

See YAML frontmatter `human_verification` block (4 items — live OpenRouter smoke test across 5 surfaces, fallback-chain live simulation, rollback live round-trip, GATE-08 paid Veo smoke). All 4 are explicitly documented as "Manual-Only Verifications" in the phase's own `21-VALIDATION.md` and inside `scripts/verify-phase-21.ts`'s embedded runbook comment — this phase's design intentionally defers them past static/functional CI since they require a funded, provisioned `OPENROUTER_API_KEY` and paid external API calls. This environment has zero `OPENROUTER_API_KEY` configured (`.env` has 0 matching lines), so none of the 4 can be exercised here without provisioning a key and incurring cost.

### Gaps Summary

No code-level gaps found. All 10 declared requirement IDs (GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-07, GATE-08, POL-01, POL-07, CRSL2-03) have real, independently-verified implementations — not just passing greps in the project's own verify script, but confirmed by direct reads of the actual source (ai-gateway.service.ts, ai-gateway-settings.service.ts, image-provider.ts, gemini.service.ts, carousel-generation.service.ts, caption-quality.service.ts, enhancement.service.ts, transcribe.routes.ts, edit.routes.ts, generate.routes.ts, carousel.routes.ts, enhance.routes.ts, admin-settings.routes.ts, quota.ts, shared/schema.ts) plus independent recomputation of the GATE-08 SHA-256 baseline and a full recursive `?key=` scan. `npm run check` and `npx tsx scripts/verify-phase-21.ts` both exit 0 independently of the summaries' claims. Git history for every commit referenced across the 13 plan summaries was confirmed to exist and touch only the declared files — no scope creep, no accidental edits to `video-generation.service.ts`.

The only open items are the 4 live/paid-API verifications that this phase's own validation strategy explicitly designates as manual, gated behind a provisioned `OPENROUTER_API_KEY` that is not present in this environment. These do not represent missing or stubbed code — every code path they would exercise is present, reads real API response fields (not hardcoded), and has a working rollback. Recommend: provision `OPENROUTER_API_KEY` in a staging environment and run the 4-step runbook embedded at the bottom of `scripts/verify-phase-21.ts` before flipping `ai_gateway_routing` to `"openrouter"` in production, or keep routing at `"direct"` until that smoke test passes (current safe default, since routing defaults to `"openrouter"` in code but the platform key is unset — gateway calls would currently fail fast with a clear "OPENROUTER_API_KEY is not configured" error rather than silently misbehaving).

---

*Verified: 2026-07-27T14:50:08Z*
*Verifier: Claude (gsd-verifier)*
