# Project Research Summary

**Project:** Xareable — v1.6 Professional Design Quality Overhaul + OpenRouter Gateway
**Domain:** AI social media content creation SaaS — brownfield quality overhaul + AI gateway migration
**Researched:** 2026-07-18
**Confidence:** HIGH on strategic direction; MEDIUM on implementation details (live OpenRouter API checks needed)

## Executive Summary

v1.6 is a high-risk, high-impact quality overhaul solving the single biggest "looks AI-generated" tell (malformed AI-rendered glyphs) through deterministic server-side typography compositing, on top of a consolidated OpenRouter gateway replacing 5 independent raw-fetch Gemini call sites. Research surfaces clear consensus on strategic direction, and identifies FIVE BLOCKER-class pitfalls requiring P0 resolution before downstream phases can succeed:

1. **BYOK architecture mismatch** — Affiliates' per-request key model is incompatible with OpenRouter's workspace-level BYOK; requires per-affiliate OpenRouter key provisioning (its own scoped design task, not a drop-in swap)
2. **Cost accounting divergence** — Static pricing tables can't reconstruct OpenRouter's real per-request cost (varies by provider routing/fallback/BYOK); must reconcile against live `usage.cost`
3. **Hardcoded model slugs are fragile** — 70+ models deprecate annually; one hardcoded slug = full outage on provider deprecation; requires `platform_settings` config + fallback chains, exercised by a forced-404 test
4. **Critic re-roll double-bills or breaks the credit gate** — A re-roll is a second full paid image generation; must integrate explicitly with `checkCredits`/`recordUsageEvent`/`deductCredits`, not copy the "free retry" pattern of the old repair loops
5. **Alpine container has no fonts** — `node:24-alpine` ships without fontconfig/font files; typography renders tofu at deploy unless the Docker build adds fonts + `fc-cache`, guarded by a CI golden-image render test

Plus: negative prompts alone don't reliably produce text-free images — the critic's automated detection is the actual enforcement mechanism, not the prompt.

**Technology is solid and low-risk:** @napi-rs/canvas is mature with prebuilt binaries for all targets; OpenRouter is confirmed compatible (with the caveat that images need the dedicated raw-HTTP Image API, not the SDK); sharp is unchanged. **The risk is operational correctness and integration complexity, not technology choice.**

## Key Findings by Dimension

### Stack (STACK.md)
- **Split gateway integration**: OpenAI SDK (`baseURL: https://openrouter.ai/api/v1`) for chat/planning + audio transcription; **dedicated Image API (`POST /api/v1/images`, raw fetch)** for image generation — the SDK cannot reach it. Gemini image models on the Image API accept top-level `aspect_ratio` (14 values) and `resolution` (512/1K/2K/4K); `input_references` up to 14 images.
- `usage.cost` (real per-request cost) is returned by default on every response — retires the maintained token pricing tables.
- Structured outputs (`json_schema` + `strict`) confirmed for Gemini/GPT/Claude families on OpenRouter.
- **@napi-rs/canvas** chosen for typography (Skia-based, `GlobalFonts.registerFromPath`, no fontconfig dependency, prebuilt Windows/Linux binaries, PNG output feeds sharp `.composite()`).
- No other new dependencies; contrast analysis via sharp `.extract().stats()` (optional `wcag-contrast` helper).

### Features (FEATURES.md)
- **Layout archetypes (concrete)**: bottom band (gradient scrim, bottom 25-35%), top stack (top 20-30%), centered hero (requires prompt-reserved negative space). Split-panel is an anti-feature — image models can't reliably reserve exact half-canvas space.
- **Safe zones per format** documented for 1:1, 4:5, 9:16, 1200×628 — including the IG profile-grid re-crop of 4:5 (outer ~10% top/bottom).
- Typography rules: 3 roles (highlight/support/cta), max 2 fonts, 1.5–3:1 size ratios, 60-30-10 color usage.
- **Critic**: score composition, legibility zone, color harmony, unwanted-text (hard fail); **sequential threshold-triggered re-roll (cap 2-3)** — parallel best-of-N conflicts with per-post credit billing.
- Narrative carousel: hook → content → CTA slide typing with per-slide composition variation.

### Architecture (ARCHITECTURE.md)
- Collapse 5 raw-fetch call sites into one gateway; **preserve the `ImageProvider.generate()/edit()` interface** so 6 call sites stay untouched.
- Model slugs live in the existing `aiModelsSchema` (`platform_settings.style_catalog`) — no new config surface; retire the gemini|openai toggle (but keep a per-call-class OpenRouter↔direct-Gemini emergency rollback).
- Key migration is **additive**: new `profiles.openrouter_api_key`; old key columns retained dead (matches Phase 12.1→12.3 staged-deprecation precedent).
- Typography requires persisting **`base_image_url`** (pre-typography AI output) + `typography_meta` — edit flows must target the base or double-render text. Fonts must be bundled in the Coolify Docker image.
- Billing: additive `recordUsageEvent(..., realCostUsdMicros?)` param + `getMarkupMultiplier()`; keep `video_fallback_pricing` (video off-gateway).
- **Build order**: Gateway → Typography → (Critic can parallel) → Narrative Carousels → Polish.

### Pitfalls (PITFALLS.md)
- 8 blocker-class pitfalls with prevention strategies and phase mapping (5 summarized above + silent model fallback routing, SSE timer stacking, WebP-over-text artifacts).
- SSE safety timers (260-280s) were calibrated for the old single-call pipeline — must be re-derived: base latency + gateway overhead + critic-latency×cap + margin, WITH AbortSignal actually cancelling work.
- Text-free compliance must be **measured** (critic logs), not assumed from negative prompts.

## Cross-Cutting Dependencies

- **Gateway → everything**: structured outputs, real cost, vision/critic calls all ride on it.
- **Typography → narrative carousels** (hard dependency — carousels have zero on-slide text today).
- **Critic ∥ Typography**: critic depends only on gateway; sequenced after typography to avoid simultaneous `generate.routes.ts` churn.
- **Timer re-derivation ships WITH the critic phase**, not retrofitted.

## Gaps / Open Questions (for phase-level research)

1. OpenRouter Image API exact request/response shape + error semantics — verify live before implementation (API is ~4 weeks old).
2. BYOK provisioning flow end-to-end (can the Provisioning API attach credentials programmatically per affiliate key?) — needs direct API testing.
3. Final font package selection for the Docker image (depends on design-system font choices).
4. Carousel composition-variation directive algorithm (conceptually defined, not algorithmically).
5. Critic rubric thresholds — tune against production compliance data, not guesses.
6. Cost reconciliation audit (`generation_logs` vs OpenRouter invoice) — post-ship item.

---
*Synthesized: 2026-07-18 from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md (v1.6). Replaces the v1.1 summary (2026-04-21).*
