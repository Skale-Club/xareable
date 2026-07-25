# Pitfalls Research

**Domain:** Migrating a live, billed, single-container SaaS from direct Gemini/OpenAI calls to an OpenRouter gateway, while adding server-side deterministic typography compositing (sharp/SVG) and a multimodal visual-critic re-roll loop inside an existing SSE + hard-timer generation flow.
**Researched:** 2026-07-18
**Confidence:** MEDIUM-HIGH (OpenRouter-specific claims web-verified against OpenRouter docs/blog and third-party production reports, July 2026; sharp/fontconfig claims verified against upstream GitHub issues and Alpine wiki; a few claims below are explicitly flagged LOW where only third-party blogs could be found)

## Critical Pitfalls

### Pitfall 1: BYOK architecture mismatch breaks the affiliate "own key" cost model

**What goes wrong:**
Xareable's current model (`server/middleware/auth.middleware.ts` — `usesOwnApiKey`, `getGeminiApiKey`, `getOpenAiApiKey`) fetches a per-user `profiles.api_key` / `profiles.openai_api_key` from the DB at request time and calls the provider SDK directly with it — trivial per-request key passthrough. OpenRouter's BYOK is **not** a per-request "use this raw key for this call" parameter. Provider credentials are registered at the workspace/account level (dashboard or Provisioning API `/api/v1/keys`) and *pinned* to a specific OpenRouter API key via filters — the pattern is "one OpenRouter API key per customer, with a BYOK provider credential filtered to it," which requires provisioning an OpenRouter API key **per affiliate** ahead of time, not injecting a raw key inline on each HTTP call the way `getGeminiApiKey()` does today.

**Why it happens:**
Teams assume "bring your own key" means the same thing across every gateway. It doesn't — OpenRouter's Provisioning API documents per-user key creation with spend caps, but BYOK *provider* credentials (the actual upstream Gemini/OpenAI key) are documented as account/workspace-level objects, not a field settable inline per chat-completion request. Nothing in OpenRouter's public docs confirms a "pass a raw upstream key on this one request" mechanism.

**How to avoid:**
- Design the affiliate-key flow around **provisioned per-affiliate OpenRouter API keys** (via the Provisioning API, with spend limits) rather than trying to pass affiliates' raw Gemini/OpenAI keys inline.
- If affiliates must keep using their own upstream provider account, register each affiliate's key as a BYOK credential filtered to their dedicated OpenRouter key — this is an onboarding/admin flow change, not a drop-in code swap.
- Treat "migrate affiliate BYOK" as its own scoped task; do not assume it falls out for free from "swap the SDK call."
- Explicitly decide (and document) the fallback behavior: OpenRouter falls back across *providers* even when a BYOK key is used and fails, unless the request sets `"provider": {"only": [...]}` — without this, an affiliate's failed own-key call can silently route to a different provider and bill the **platform's** OpenRouter balance, defeating the entire point of "affiliates use their own key."

**Warning signs:**
- Affiliate usage suddenly appears on the platform's OpenRouter invoice.
- No admin UI path exists for an affiliate to register/rotate an OpenRouter-compatible key before the migration ships.
- Code still reads `profiles.api_key` and tries to forward it as an OpenRouter request header/param.

**Phase to address:**
P0 — OpenRouter gateway foundation (must be resolved before affiliate/admin BYO-key support is considered "migrated," not deferred to polish).

---

### Pitfall 2: Cost accounting silently diverges from the billing invariant

**What goes wrong:**
CLAUDE.md states the billing invariant: every paid generation flows through `checkCredits → recordUsageEvent → deductCredits`, and `server/quota.ts` computes `estimatedBaseCostMicros` from an internal price table per `operationType`. OpenRouter returns an authoritative `usage.cost` per request, but that figure is **not reconstructable** by multiplying tokens × a static price table: the same model ID can be served by different upstream providers (primary/fallback/BYOK) at different prices, cache discounts apply, and — critically — `usage.cost_details.upstream_inference_cost` is populated **only for BYOK requests**; for standard/platform-key requests it's 0/null. If OpenRouter fails over mid-request to a second provider that had already charged partial tokens before erroring, some providers bill for both attempts.

**Why it happens:**
Migrating "the API call" without migrating "the cost model" — teams keep the existing static per-model price table and just change which HTTP endpoint it calls, assuming the old estimate-then-reconcile pattern still holds when the actual authoritative cost now varies per-request based on routing decisions Xareable doesn't control.

**How to avoid:**
- Use OpenRouter's per-request `usage.cost` (via usage accounting / generation endpoint) as the **actual charge to reconcile against**, not just as an audit log — `estimateBaseCostMicros` becomes a pre-check estimate only; `deductCredits`/`recordUsageEvent` should reconcile against real `usage.cost` after the call completes, the same way the existing pipeline already separates "credit check" from "deduct."
- Explicitly decide what happens when actual cost > estimate (undercharge risk) or provider fallback occurred (unexpected provider/price) — log both figures to `generation_logs` metadata for audit, matching the existing OBS-01..04 pattern already used for text/caption verification.
- Pin `"provider": {"only": [...]}` or an explicit fallback allowlist per model so cost variance is bounded and auditable, rather than letting OpenRouter's default routing pick arbitrarily-priced fallbacks.

**Warning signs:**
- `pending_overage_micros` / weekly overage batch totals drift from what OpenRouter's dashboard shows as actual spend.
- Support tickets about being charged differently for what looks like "the same generation."

**Phase to address:**
P0 — OpenRouter gateway foundation (billing reconciliation must land with the gateway swap, not be retrofitted after users are already billed incorrectly).

---

### Pitfall 3: Hardcoded model slugs break silently on provider-side deprecation

**What goes wrong:**
OpenRouter is a router in front of upstream providers, not a stable model catalog — providers deprecate, rename, and reprice models on their own schedule (more than 70 models have been pulled/deprecated across providers in recent years). If Xareable hardcodes a single model slug (e.g., the text-planning model or the image model) with no fallback chain, the day that provider deprecates or renames it, **every generation path** (single post, carousel, enhancement, transcription) fails simultaneously until code is edited and redeployed — a full-outage-class incident for a billed production app.

**Why it happens:**
Direct Gemini/OpenAI integration trains teams to treat "the model name" as a stable constant chosen once; OpenRouter's value proposition (routing flexibility) is exactly the thing that makes a single hardcoded slug fragile, and it's easy to migrate 1:1 without adding the fallback/preset layer OpenRouter provides for this.

**How to avoid:**
- Configure model selection through OpenRouter **presets** or an explicit `models: [primary, fallback1, fallback2]` array per call site, not a bare model string.
- Keep model slugs in `platform_settings`/admin-configurable config (the codebase already does this pattern for scenery catalog and pricing) so a deprecation can be fixed with a config update, not a redeploy.
- Add an alert/log when OpenRouter serves a request via a fallback model different from the configured primary, so drift is visible before it becomes a user-facing quality regression.

**Warning signs:**
- 4xx/404 "model not found" errors appearing in `generation_logs` for a model that worked yesterday.
- No monitoring differentiates "served by primary model" vs "served by fallback."

**Phase to address:**
P0 — OpenRouter gateway foundation.

---

### Pitfall 4: Critic auto-re-roll double-bills or breaks the credit-gate invariant

**What goes wrong:**
The new visual critic triggers "automatic re-roll on low score." If a re-roll re-invokes the full generate-image call without careful integration into `checkCredits → recordUsageEvent → deductCredits`, one of two bad outcomes results: (a) the user is charged once per re-roll attempt (silent multi-charge for what they perceive as a single generation), or (b) re-rolls bypass `checkCredits` entirely (free, unbounded regeneration that erodes margin and can be abused). Both are worse than today's status quo, where `enforceExactImageText`/`ensureCaptionQuality` repair loops already exist but don't multiply billing.

**Why it happens:**
Re-roll loops are usually designed for output quality first; billing implications are an afterthought bolted on late, especially because the existing repair-loop pattern (text verification, caption quality) was explicitly *not* billed per-attempt, so a new critic loop copied from that pattern inherits the "free retries" assumption in a place where retries are now a **second paid generation**, not a cheap text check.

**How to avoid:**
- Decide and document explicitly, before implementation: is a re-roll (a) charged to the user as a full additional generation, (b) absorbed by the platform up to N free attempts, or (c) capped and then surfaced to the user as "keep this lower-scoring result or pay for another attempt"?
- Whatever the decision, route every actual re-roll image-generation call through the same `checkCredits`/`recordUsageEvent`/`deductCredits` invariant already documented in CLAUDE.md — do not add a side-channel "regenerate" path that skips it.
- Cap re-roll attempts hard (2–3 max, consistent with general production LLM-judge retry guidance) and log every attempt + score to `generation_logs`, mirroring the existing OBS-01..04 structured-log pattern for `repair_triggered`/`repair_succeeded`/`repair_failed`.

**Warning signs:**
- Users reporting "I was charged 2-3 credits for one post."
- `recordUsageEvent` call sites for the critic re-roll path not covered by the same test suite as the primary generate path.

**Phase to address:**
P1 — Multimodal visual critic with automatic re-roll (must be designed together with billing, not after).

---

### Pitfall 5: Alpine/musl container ships with no fonts, no fontconfig, no emoji glyphs

**What goes wrong:**
The production Dockerfile (`node:24-alpine`) installs only `libc6-compat` — needed because sharp ships a prebuilt `@img/sharp-linuxmusl-x64` binary — and installs **no** `fontconfig` package and **no** font files. The moment server-side SVG text compositing goes live, headline/support/CTA text will render as tofu boxes or fall back to whatever minimal default typeface librsvg/resvg can find (often none), and pt-BR/es diacritics (ã, ç, é, ñ, ü) and any emoji in captions/CTAs will be missing glyphs entirely, since Alpine's package manager reserves `/usr/share/fonts` for `apk`-installed font packages and nothing is installed there today.

**Why it happens:**
Sharp "just works" for image resize/optimize without any font dependency, so the team's existing Alpine image was never audited for font support — this need only surfaces the moment SVG `<text>` elements are introduced, and Alpine's minimal-by-design philosophy means nothing is present unless explicitly `apk add`-ed (unlike Debian-based images, which often carry more default fonts).

**How to avoid:**
- Add `RUN apk add --no-cache fontconfig` plus the specific font families the design system needs (e.g., `font-noto`, `font-noto-emoji` for color emoji, and whichever brand/display fonts the typography system requires — self-hosted, not system-default, since brand fonts won't be in any OS package).
- Run `fc-cache -fv` in the image build step after installing fonts, and verify with a build-time smoke test that renders a sample string containing pt-BR/es diacritics + an emoji, comparing output against a golden image — do this in CI, not just locally (local dev is very likely Windows/macOS with full font support, masking the gap until it hits Coolify).
- Explicitly test on the exact `node:24-alpine` base, not a generic Linux dev box — font resolution differences between sharp versions on "the same" fontconfig setup have been reported upstream (lovell/sharp#2936).

**Warning signs:**
- Local dev renders text perfectly (Windows/macOS has fonts); Coolify-deployed container renders blank boxes or wrong glyphs — a "works on my machine" gap discovered only after deploy.
- No emoji or accented-character test fixtures in the typography test suite.

**Phase to address:**
P0 — Deterministic typography (font provisioning must be part of the Docker image build, verified before this pillar is considered done — not discovered during P1/P2 QA).

---

### Pitfall 6: No rollback path if OpenRouter has an outage or regresses quality

**What goes wrong:**
"ALL AI calls except video migrate to OpenRouter" reads as a one-way door. If OpenRouter has an outage, a regional routing incident, or silently degrades output quality on a given model (a documented real risk — provider quotas mean the same model can be healthy one moment and overloaded the next), a live billed SaaS with no fallback to direct Gemini/OpenAI has no mitigation except waiting out the vendor's incident, directly harming paying customers and consuming the newly added credit/overage budget on failed generations.

**Why it happens:**
The existing pluggable image-provider abstraction (Gemini default, OpenAI alternative, admin/affiliate provider preference — shipped v1.1 Phase 12) already proves the codebase knows how to keep multiple providers switchable. It's tempting to delete that abstraction wholesale in favor of "OpenRouter is now the only path," discarding a safety net that cost real engineering effort to build.

**How to avoid:**
- Keep the admin provider-toggle abstraction's *shape* even as the underlying call goes through OpenRouter — i.e., the toggle should still be able to select "direct Gemini" as an emergency fallback for a defined transition window, even if OpenRouter is the default and eventual sole path.
- Stage the cutover: ship OpenRouter behind the existing admin toggle first, validate in production with real billed traffic before removing the direct-API code paths entirely.
- Because video is explicitly frozen on the direct Google API this milestone, the codebase will retain *some* direct-Gemini calling code regardless — don't delete the shared low-level Gemini client/helper that video depends on while "cleaning up" the image/text migration.

**Warning signs:**
- PR removes the `PROV-01..07` provider-abstraction code paths in the same change that adds OpenRouter, with no admin escape hatch left.
- No documented manual procedure for "OpenRouter is down, what do we do" in `docs/production-cron.md`-style runbooks.

**Phase to address:**
P0 — OpenRouter gateway foundation (rollback strategy is part of "done," not an afterthought).

---

### Pitfall 7: SSE hard timer (260–280s) doesn't account for gateway + critic-loop latency stacking

**What goes wrong:**
The existing SSE safety timer (fixed at Phase 13, HARD-02) is tuned for direct-API round trips. OpenRouter adds its own request handling (community-reported ~25–150ms typical overhead, more under cold-start/low-balance/fallback-retry conditions) on top of the base model latency, and a visual critic + automatic re-roll now adds one or more **additional full model round trips inside the same request lifecycle**. Stacking gateway overhead + critic scoring + a re-roll generation inside a timer that was calibrated for a single direct call risks the safety timer firing mid-legitimate-generation, aborting work the user already started paying for.

**Why it happens:**
The 260–280s figure was chosen for the old single-call pipeline; nobody re-derives the budget when two new latency-adding stages (gateway hop, critic-and-reroll) are inserted into the same envelope, because each change is planned/reviewed as an independent feature rather than against the shared timer budget.

**How to avoid:**
- Re-derive the timer budget explicitly: (base image-gen latency) + (typical OpenRouter overhead, and worst-case fallback-retry overhead) + (critic call latency × up to N re-roll attempts) + margin. Treat this as arithmetic to verify, not a constant to leave untouched.
- Ensure the HTTP client used for OpenRouter calls has its own timeout raised to match (community guidance: default client timeouts around 60–120s are too short for slow models/streams; the overall request needs a timeout in the 300s range to match a Coolify long-running host, not a serverless-function-style short timeout).
- If the full estimated budget exceeds what's acceptable for UX, cap re-roll attempts more aggressively (1 re-roll, not 2-3) rather than expanding the timer indefinitely — the milestone notes "timers/AbortSignal aligned to Coolify long-running host" as in scope; this is the natural place to redo the math.

**Warning signs:**
- Increase in `error_type: timeout`/abort-related entries in `generation_logs` correlated with the critic-loop rollout.
- SSE safety-timer test coverage (Phase 13, HARD-02) not updated to include a critic-loop-active scenario.

**Phase to address:**
P1 — Multimodal visual critic with automatic re-roll (timer re-derivation should ship in the same phase that introduces the loop, since P0's gateway migration alone likely fits inside the existing budget but P1's added round trip may not).

---

### Pitfall 8: Negative prompts alone don't reliably produce text-free images

**What goes wrong:**
The typography redesign depends on the image model reliably producing **text-free** images (reserving space for server-side compositing). Both Gemini's image models and gpt-image-family models are documented as unreliable at honoring negative instructions embedded in the main prompt — models tend to fixate on the named concept even when negated (e.g., "no collar" → puppy gets a collar), and Gemini's own guidance explicitly recommends avoiding negative phrasing in favor of describing the desired positive scene instead of relying on a "don't do X" instruction. There is no guaranteed "text: off" switch on either model family comparable to a hard API parameter.

**Why it happens:**
Teams treat "add a negative prompt for text" as sufficient compliance, because it works most of the time in casual testing, then discover in production that a meaningful minority of generations still render stray text/watermark-like artifacts, especially on scenes that plausibly contain signage, labels, or packaging (a strong pull toward text tokens the model has seen constantly in training).

**How to avoid:**
- Phrase the instruction positively wherever possible ("a clean, uncluttered surface with empty negative space in the upper third" rather than "no text"), consistent with Gemini's own prompting guidance.
- Treat the visual critic's automated text-detection as the actual enforcement mechanism, not the prompt — the prompt reduces the *rate* of unwanted text, the critic is what catches and re-rolls the remainder. Do not ship "text-free" as a prompt-only guarantee.
- Track and log the text-free compliance rate per model in `generation_logs` (mirroring the existing text-verification outcome union already used for `enforceExactImageText`) so a real, measured failure rate is visible — this also becomes the metric that tells you whether the re-roll cap is set correctly.

**Warning signs:**
- No metric exists for "% of generations where the critic detected unwanted text on first attempt" — if this isn't measured, the team is flying blind on whether re-roll budget/cost estimates are realistic.
- QA testing only against a handful of prompt types (e.g., only lifestyle photos) rather than categories known to invite stray text (product labels, storefronts, screens/devices in-frame).

**Phase to address:**
P1 — Multimodal visual critic (this is precisely the safety net the milestone already plans; the pitfall is treating the P0 negative-prompt change as sufficient on its own and shipping the critic as "extra" rather than "required").

---

## Moderate Pitfalls

### Pitfall 9: Structured outputs / provider-specific params silently ignored, not rejected

**What goes wrong:**
OpenRouter's OpenAI-compatible `response_format`/`json_schema` structured-output mode is silently ignored on models that don't support it — the call succeeds, but the model reverts to free-text output that then fails downstream JSON parsing in a way that looks like a content bug, not a config bug. Similarly, provider-specific params (cache-control directives, `reasoning`, long `user` fields, tool definitions) have been reported dropped without error across multiple client integrations.

**Why it happens:**
Developers assume an accepted 200 response means the request was honored as specified; OpenRouter's compatibility-shim design prioritizes "don't hard-fail across a huge model catalog" over "fail loudly on unsupported params," which is reasonable for a router but dangerous for a caller that depends on a specific capability (structured JSON output for the planning call) actually being enforced.

**How to avoid:**
- Explicitly select/pin a planning-call model documented to support **both** structured outputs (`json_schema`) **and** multimodal image input (reference-image attachment) — this is a real constraint that narrows the model list; verify via OpenRouter's model listing (`supported_parameters`) rather than assuming any vision model supports structured outputs.
- Add a runtime assertion after the planning call: if the response isn't valid against the expected schema, treat it as a hard failure (log + fallback), not a silent pass-through of malformed data into image generation.

**Phase to address:** P0 — Art director fixed (planning-call upgrade).

---

### Pitfall 10: SVG text layout has no browser layout engine — overflow/wrapping breaks on longer pt-BR/es strings

**What goes wrong:**
sharp/librsvg has no built-in flow-layout, text-measurement-then-wrap, or bidi engine comparable to a browser. Font-size and line-wrap logic hand-tuned against English headline lengths will overflow, clip, or produce awkward breaks when the same semantic content is rendered in Portuguese or Spanish, which routinely run 15-30% longer than English for equivalent copy.

**Why it happens:**
Prototyping and QA happen in English first; the wrap/measure logic gets calibrated against English string lengths and ships without dedicated pt-BR/es test fixtures, since the visual difference is invisible until a longer real caption is composited.

**How to avoid:**
- Measure actual glyph advances per font (not character-count heuristics) before computing wrap points — heuristic character-count wrapping is exactly what breaks across languages with different average character widths.
- Build test fixtures with real pt-BR/es copy (not lorem ipsum) at the actual lengths the planning-call model tends to produce for headline/support/CTA, and assert no clipping/overflow across all three configured content languages before calling this pillar done.

**Phase to address:** P0 — Deterministic typography.

---

### Pitfall 11: WebP recompression blurs or rings the composited text layer

**What goes wrong:**
WebP's block-based prediction/transform coding is tuned for photographic content; it introduces ringing artifacts around sharp edges and text, and ordinary lossy WebP quality settings (the milestone targets "WebP q85+") can still visibly soften anti-aliased text edges compared to the crisp vector the SVG layer produced, undermining the whole point of moving typography out of the lossy AI-image path.

**Why it happens:**
The WebP quality bump (q85+) is planned at the whole-image level, but the text was just moved into a deterministic, high-fidelity vector layer specifically to avoid AI-model artifacts — re-flattening it through the same lossy WebP encode as the photographic background reintroduces a milder version of the exact problem being solved.

**How to avoid:**
- Verify empirically (not just by default settings) that the chosen WebP quality preserves text edge sharpness — test with real composited output, not synthetic test images, and compare against a lossless or near-lossless reference.
- Consider higher quality specifically for the composited/final export path than for intermediate assets, since the milestone's whole reason for existing is professional-designer-quality output.

**Phase to address:** P2 — polish & hygiene (WebP q85+ item), but validate against the P0 typography output specifically, not in isolation.

---

### Pitfall 12: Shared Gemini/service code accidentally regresses the frozen video pipeline

**What goes wrong:**
PROJECT.md explicitly freezes video this milestone ("Veo is not available on OpenRouter; video stays on the direct Google API untouched"). If the OpenRouter migration touches shared low-level helper modules (e.g., a shared Gemini client/service used by both image-generation and video code paths), it's easy to accidentally alter behavior video depends on while "cleaning up" the image/text call sites.

**Why it happens:**
Service modules in this codebase are organized by capability, not strictly by call site, and a broad "route everything through OpenRouter" refactor invites touching shared code without auditing every consumer.

**How to avoid:**
- Before starting the migration, enumerate every caller of the current Gemini/OpenAI service modules and explicitly mark which ones are in-scope (text, image, transcription) vs frozen (video).
- Add a regression test/smoke check for the video generation path that runs as part of this milestone's CI, specifically to catch accidental breakage from refactoring shared helpers — even though video itself isn't being changed, its test coverage becomes the tripwire for scope creep.

**Phase to address:** P0 — OpenRouter gateway foundation (scope boundary must be enforced from the first commit, not caught in P1/P2 QA).

---

## Minor Pitfalls

### Pitfall 13: Non-deterministic critic scores break CI/regression tests

**What goes wrong:** LLM-as-judge style critics are inherently stochastic; a test asserting "this known-good image scores above threshold" can flake without any real regression.

**How to avoid:** Mock/stub the critic in unit and integration tests (deterministic fixture scores); reserve real critic calls for a small, monitored slice of production traffic or manual QA, not CI gating.

### Pitfall 14: Emoji-in-caption compositing missing color-emoji glyphs even after fontconfig is installed

**What goes wrong:** Installing a generic emoji font (e.g., `font-noto-emoji`, which may be monochrome) doesn't guarantee color emoji rendering — librsvg/resvg color-font (COLR/CBDT) support has open upstream gaps, so even a "fixed" Alpine font setup can still render emoji as flat/black-and-white or as tofu depending on the exact rendering path sharp uses under the hood.

**How to avoid:** Explicitly test with `noto-color-emoji` (not just any emoji-labeled package) and visually diff the output; if color-emoji support proves unreliable in the sharp/librsvg pipeline, consider excluding emoji from the deterministic text layer and leaving them out of headline/CTA copy by design/prompt-guidance instead.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Ship OpenRouter migration without provider fallback chains ("just swap the model string") | Faster P0 delivery | Full-outage-class incident on next upstream deprecation/rename | Never for production — add at minimum a 1-item fallback array before cutover |
| Reuse the text-verification repair-loop billing pattern (free retries) for the visual-critic re-roll | Fast to implement, pattern already exists in codebase | Re-roll is a full paid image generation, not a cheap text check — free retries erode margin or double-bill depending on how it's wired | Never — must be designed explicitly, not copy-pasted from a cheaper repair loop |
| Skip explicit HTTP client timeout tuning for OpenRouter calls (accept library defaults) | Nothing to configure, ships faster | Requests silently killed by a client-side default (often 60-120s) well before the app's own 260-280s safety timer fires, producing confusing "works sometimes" failures | Never in this codebase — the whole point of the existing safety-timer work (Phase 13, HARD-02) is to control this precisely |
| Delete the v1.1 pluggable-provider abstraction entirely instead of keeping it as an emergency toggle | Cleaner code, less to maintain | No rollback path if OpenRouter has an outage/regression on a billed live product | Acceptable only after OpenRouter has run in production, at 100% of non-video traffic, for a defined stability window with no incidents |
| Treat "text-free negative prompt" as done without measuring compliance rate | Ships P0 typography faster | Unknown real-world failure rate means the P1 critic re-roll budget/cost estimate is guesswork | Acceptable only as a temporary state between P0 ship and P1 critic instrumentation landing — must be measured before P1 is considered complete |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenRouter (model routing) | Hardcoding a single model slug per call site | Configure `models: [primary, fallback...]` or a preset; make the slug admin/config-editable (`platform_settings`), not a code constant |
| OpenRouter (BYOK / affiliate keys) | Assuming affiliates' existing Gemini/OpenAI keys pass through unchanged | Provision per-affiliate OpenRouter API keys (Provisioning API) with BYOK provider credentials pinned/filtered to them; treat as a distinct migration task with admin UI changes |
| OpenRouter (cost accounting) | Reconstructing cost from a static internal price table post-migration | Reconcile `deductCredits`/`recordUsageEvent` against OpenRouter's authoritative per-request `usage.cost`, logging both estimate and actual |
| OpenRouter (structured outputs) | Assuming `response_format: json_schema` is enforced on any model that accepts the request | Verify `supported_parameters` for the specific model before relying on structured output; add a runtime schema-validation hard-fail as a backstop |
| OpenRouter (image aspect ratio/size) | Assuming all image models on OpenRouter support the same aspect-ratio set as native Gemini API | Check each model's supported aspect ratios (varies per model, e.g. Gemini 3.1 Flash Image supports 14 vs Seedream's 18); pass explicit pixel size only when it won't conflict with a resolution/aspect_ratio param (conflicting params return a 400) |
| OpenRouter (SSE / long requests) | Leaving default HTTP client timeouts in place | Explicitly raise client timeout to match (or exceed) the existing 260-280s safety timer envelope, accounting for gateway + critic-loop overhead |
| sharp + SVG (fonts) | Assuming the existing Alpine Docker image "already has fonts" because sharp works for resize/optimize today | Explicitly `apk add fontconfig` + specific font packages + `fc-cache`, verified with a CI golden-image test rendering pt-BR/es diacritics + emoji |
| Gemini / gpt-image (text-free prompting) | Relying on a negative-prompt instruction as a hard guarantee | Phrase instructions positively per Gemini's own guidance; treat the visual critic's detection as the actual enforcement layer, log compliance rate |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Stacking gateway latency + critic call + re-roll inside the existing fixed SSE timer | Timeouts/aborts increase right after the critic-loop ships, correlated with `error_type: timeout` in `generation_logs` | Re-derive the timer budget arithmetically (gateway overhead + critic latency × re-roll cap + margin); cap re-rolls conservatively (1, not 2-3) if budget is tight | As soon as the critic-loop phase ships, on the single-instance Coolify container under any concurrent load |
| In-process `overageBatchRunning` boolean lock (existing, documented ⚠️ in Key Decisions) combined with a new per-request OpenRouter cost-reconciliation step | Weekly overage batch double-processes or misses reconciled-cost adjustments if a second instance is ever added | This is an existing known limitation (documented) — do not let the OpenRouter cost-reconciliation logic assume single-instance without re-confirming that assumption still holds | If Coolify deployment ever moves to multi-instance |
| Font/glyph resolution cost inside the hot image-generation request path | Slower P95 latency on generation once SVG compositing is added, if fontconfig cache isn't warmed | Warm `fc-cache` at container build time (not first request); avoid re-scanning font directories per request | Noticeable under concurrent generation load on a single Hetzner container |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing/forwarding affiliate OpenRouter keys the same way `profiles.api_key` is stored today, without re-auditing header-only transmission (already a P2 goal: "API keys via headers only") | Key leakage via logs/URLs if the OpenRouter migration reintroduces a body/query-param pattern | Apply the milestone's own P2 "API keys via headers only" requirement to the new OpenRouter key paths as part of P0, not deferred to P2, since this is a net-new integration point |
| Trusting OpenRouter's default routing/provider selection for requests containing brand reference images or user PII in the reference-image planning call | Reference images or brand data could be routed to an upstream provider with different data-retention/training policies than expected | Pin `provider` preferences explicitly for any call carrying user-uploaded reference images (brand photos), rather than accepting default routing, consistent with the migration's own point that "one slug" doesn't guarantee data-retention/training policy |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|------------------|
| Critic re-roll happens silently and the user has no idea a lower-scoring first attempt was discarded (or billed) | Confusing charges, no transparency into why generation "took longer" | Surface re-roll attempts in the SSE progress stream (e.g., "refining composition...") and be explicit in billing UI about whether a re-roll was charged |
| Text-free image + server-composited text fails silently in a language the team didn't test (wrapping/clipping) | Users in pt-BR/es markets get visibly broken output while English users see polished results | Require pt-BR/es/en parity testing as an explicit gate before shipping the typography pillar, not an afterthought |
| Admin image-provider toggle during migration doesn't clearly communicate which provider (OpenRouter vs direct fallback) served a given generation | Support can't diagnose "why does this post look different" reports | Log and (at least in admin/debug views) surface which model/provider actually served each generation, given OpenRouter's routing can vary per request |

## "Looks Done But Isn't" Checklist

- [ ] **OpenRouter migration:** Often missing a fallback model chain per call site — verify each call configures `models: [...]` or a preset, not a bare string, and that a simulated 404/deprecation on the primary model is tested.
- [ ] **Affiliate/admin BYOK:** Often missing the actual provisioning flow for per-affiliate OpenRouter keys — verify an affiliate can rotate/register a key and that a failed BYOK call doesn't silently bill the platform's own OpenRouter balance (test with `"only"` provider pinning).
- [ ] **Cost accounting:** Often missing reconciliation against OpenRouter's real `usage.cost` — verify `generation_logs`/billing records show both the pre-call estimate and the actual post-call cost, and that they're compared/alerted on divergence.
- [ ] **Deterministic typography:** Often missing pt-BR/es/emoji font coverage in the actual Docker image — verify with a CI-run golden-image render test on the exact `node:24-alpine` base, not local dev.
- [ ] **Text-free image generation:** Often missing a measured compliance rate — verify a metric exists for "% of first-attempt generations with critic-detected unwanted text," not just an assumption that the negative prompt "mostly works."
- [ ] **Critic re-roll loop:** Often missing billing integration — verify every re-roll attempt is traceable through `checkCredits`/`recordUsageEvent`/`deductCredits` (or an explicit, documented free-retry policy), and that attempts are capped and logged.
- [ ] **SSE timer budget:** Often missing re-derivation after adding gateway + critic-loop latency — verify the 260-280s figure was actually recalculated (with worst-case fallback-retry and re-roll-cap latency), not left untouched from the pre-OpenRouter pipeline.
- [ ] **Video freeze:** Often missing a regression test for the frozen video path — verify a smoke test exists proving video generation still works unchanged after the shared-service refactor for OpenRouter.
- [ ] **Rollback path:** Often missing a working "OpenRouter is down" runbook step — verify the admin provider toggle can still force a direct-Gemini fallback (at least during the transition window), and that this has been exercised once, not just theorized.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|-----------------|
| Affiliate BYOK billed to platform balance due to fallback | MEDIUM | Add `"provider": {"only": [...]}` pinning retroactively; audit past invoices for affiliate-attributable spend and reconcile/credit affected affiliates |
| Cost-accounting drift discovered post-launch | MEDIUM-HIGH | Backfill `generation_logs` cost reconciliation from OpenRouter's generation-ID lookup (where available) for the affected window; add real-time reconciliation going forward; consider a one-time manual credit adjustment for clearly overcharged users |
| Hardcoded model deprecated in production (full outage) | LOW-MEDIUM (once presets/fallback exist) | Update the admin-configurable model slug/preset immediately (no redeploy if stored in `platform_settings`); if hardcoded, hotfix + redeploy, then retroactively add the fallback-chain pattern to prevent recurrence |
| Missing fonts/glyphs discovered in production (tofu boxes on live posts) | LOW | `apk add` the missing font packages + `fc-cache`, rebuild image, redeploy; for already-generated broken posts, offer regeneration (decide billing treatment — should not be charged again) |
| Critic re-roll double-billing discovered after ship | MEDIUM | Identify affected `recordUsageEvent` rows via the re-roll code path's logging; issue credit reversals/adjustments; fix the billing integration; add a regression test asserting one charge per user-visible generation regardless of internal re-roll count |
| SSE timer firing mid-legitimate-generation after critic-loop ship | LOW-MEDIUM | Raise the timer / lower the re-roll cap as an immediate config change; re-derive the budget properly as a follow-up; check whether prematurely-aborted generations were incorrectly billed and reverse if so |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|---------------|
| BYOK architecture mismatch (Pitfall 1) | P0 — OpenRouter gateway foundation | Affiliate can provision/rotate a key end-to-end; a simulated BYOK-key failure is proven not to bill the platform's OpenRouter balance |
| Cost accounting divergence (Pitfall 2) | P0 — OpenRouter gateway foundation | `generation_logs`/billing rows show estimate vs actual `usage.cost`, with alerting on divergence beyond a threshold |
| Hardcoded model slugs (Pitfall 3) | P0 — OpenRouter gateway foundation | Simulated model-deprecation test (force a 404 on primary) proves fallback chain engages without a redeploy |
| Critic re-roll double-billing (Pitfall 4) | P1 — Multimodal visual critic | Test asserts exactly one billing event per user-visible generation regardless of internal re-roll count |
| Missing fonts/glyphs on Alpine (Pitfall 5) | P0 — Deterministic typography | CI golden-image test renders pt-BR/es diacritics + emoji on the actual `node:24-alpine` image and passes |
| No rollback path (Pitfall 6) | P0 — OpenRouter gateway foundation | Admin toggle demonstrably forces direct-Gemini fallback in a staging exercise before 100% cutover |
| SSE timer budget not re-derived (Pitfall 7) | P1 — Multimodal visual critic | Timer budget documented with worst-case arithmetic (gateway + critic × re-roll cap + margin); load test confirms no premature aborts under realistic latency |
| Negative-prompt-only text-free reliance (Pitfall 8) | P1 — Multimodal visual critic | Compliance-rate metric exists and is reviewed before considering P1 complete |
| Structured output silently ignored (Pitfall 9) | P0 — Art director fixed | Planning-call model verified to support `json_schema` + image input; schema-validation hard-fail exists as backstop |
| SVG layout no browser engine (Pitfall 10) | P0 — Deterministic typography | pt-BR/es test fixtures at realistic string lengths pass without clipping/overflow |
| WebP text artifacts (Pitfall 11) | P2 — polish & hygiene (validated against P0 output) | Visual diff of composited text at chosen WebP quality vs lossless reference shows no perceptible ringing/blur |
| Video pipeline regression via shared code (Pitfall 12) | P0 — OpenRouter gateway foundation | Video smoke test included in this milestone's CI, passing unchanged after the refactor |

## Sources

- [OpenRouter Image Generation - Complete Documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) — aspect ratio/resolution/size param behavior, per-model clamping
- [Introducing the Unified Image API — OpenRouter Blog](https://openrouter.ai/blog/announcements/image-api/)
- [How OpenRouter Model Routing Works: Providers, Fallbacks & Auto Router](https://openrouter.ai/blog/insights/model-routing/)
- [Keep Your Agent Running When Models Disappear — OpenRouter Blog](https://openrouter.ai/blog/tutorials/keep-your-agent-running-when-models-disappear/) — model deprecation frequency, hardcoded-slug risk
- [OpenRouter Rate Limits Explained](https://www.datastudios.org/post/openrouter-rate-limits-explained-request-caps-free-model-limits-provider-quotas-scaling-issues) (third-party, MEDIUM confidence)
- [BYOK - Bring Your Own Keys to OpenRouter](https://openrouter.ai/docs/guides/overview/auth/byok)
- [Why Am I Still Being Charged When Using My Own Key (BYOK)?](https://openrouter.zendesk.com/hc/en-us/articles/43219817892123-Why-Am-I-Still-Being-Charged-When-Using-My-Own-Key-BYOK) — official OpenRouter support, HIGH confidence on fallback-across-providers behavior
- [BYOK on OpenRouter: Provider Keys, Prioritization, and Fallback Strategy](https://tygartmedia.com/openrouter-byok-strategy/) (third-party, MEDIUM confidence on per-key filtering pattern)
- [Provisioning API Keys | OpenRouter Documentation](https://openrouter.ai/docs/features/provisioning-api-keys) — per-user key creation with spend limits, HIGH confidence
- [Usage Accounting - Track AI Model Token Usage](https://openrouter.ai/docs/cookbook/administration/usage-accounting) — `usage.cost`, `cost_details.upstream_inference_cost` BYOK-only population
- [OpenRouter Pricing, BYOK, Routing Costs, and Cost Optimization Strategies](https://www.datastudios.org/post/openrouter-pricing-byok-routing-costs-and-cost-optimization-strategies-how-openrouter-actually-c) (third-party, MEDIUM confidence)
- [Latency and Performance | Minimizing Gateway Latency — OpenRouter](https://openrouter.ai/docs/guides/best-practices/latency-and-performance) — official latency guidance
- [LLM Router Latency Benchmark 2026: OpenAI Direct vs Router APIs](https://opper.ai/blog/llm-router-latency-benchmark-2026) (third-party benchmark, MEDIUM confidence)
- [OpenRouter Timeout Fix: Solve Production API Errors Fast](https://markaicode.com/errors/openrouter-timeout-error-fix-production/) (third-party, LOW-MEDIUM confidence on specific timeout numbers — verify against official docs before hardcoding)
- [API Error Handling and Debugging - OpenRouter](https://openrouter.ai/docs/api_reference/errors-and-debugging)
- [OpenRouter proxy: tool calls silently dropped after AI SDK migration](https://github.com/RooCodeInc/Roo-Code/issues/11419) — real-world silent param-drop report
- [SVG text not working in docker container · lovell/sharp#2317](https://github.com/lovell/sharp/issues/2317)
- [SVG font rendering differences since 0.29.0 · lovell/sharp#2936](https://github.com/lovell/sharp/issues/2936)
- [Fonts - Alpine Linux Wiki](https://wiki.alpinelinux.org/wiki/Fonts) — `/usr/share/fonts` reserved for apk packages, `~/.fonts` for user fonts
- [fontconfig - Alpine Linux packages](https://pkgs.alpinelinux.org/package/edge/main/x86/fontconfig)
- [Support color fonts · linebender/resvg#487](https://github.com/linebender/resvg/issues/487) — color-emoji (COLR/CBDT) gaps
- [Emoji's (and other unicode characters) not rendering · linebender/resvg#485](https://github.com/linebender/resvg/issues/485)
- [How to prompt Gemini 2.5/3.1 Flash Image Generation for the best results — Google Developers Blog](https://developers.googleblog.com/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/) — official Google guidance on positive-vs-negative phrasing
- [Image prompts ignore specific negative instructions - OpenAI Developer Community](https://community.openai.com/t/image-prompts-ignore-specific-negative-instructions-to-not-include-something/648023) — real-world gpt-image negative-prompt failure reports
- [GPT Image Generation Models Prompting Guide — OpenAI Cookbook](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)
- [The FFmpeg Flags That Actually Matter for WebP](https://2webp.com/guides/ffmpeg-flags-for-webp) — text preset, quality/ringing tradeoffs (third-party, MEDIUM confidence)
- [LLM API Resilience in Production: Rate Limits, Failover, and the Hidden Costs of Naive Retry Logic](https://tianpan.co/blog/2026-03-11-llm-api-resilience-production)
- [How to build LLM-as-a-Judge evaluators that hold up in production — Arize AI](https://arize.com/blog/how-to-build-llm-as-a-judge-evaluators-that-hold-up-in-production/) — async/off-critical-path judge pattern, retry caps
- Internal codebase inspection: `Dockerfile` (node:24-alpine, libc6-compat only, no fontconfig), `server/quota.ts` (`checkCredits`/`deductCredits`/`recordUsageEvent`), `server/middleware/auth.middleware.ts` (`usesOwnApiKey`, `getGeminiApiKey`, `getOpenAiApiKey`), `.planning/PROJECT.md` (v1.6 milestone scope, video freeze, timer/AbortSignal note)

---
*Pitfalls research for: OpenRouter migration + deterministic typography + visual critic on a live billed SaaS (Xareable v1.6)*
*Researched: 2026-07-18*
