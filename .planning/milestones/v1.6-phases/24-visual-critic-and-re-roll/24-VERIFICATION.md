---
phase: 24-visual-critic-and-re-roll
verified: 2026-07-28T04:19:48Z
status: human_needed
score: 31/32 must-haves verified (code-level); 1/32 requires production operator sign-off
human_verification:
  - test: "Live critic call — OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-critic-live.ts --image=./<png>"
    expected: "Exits 0 with 5/5 assertions against a real vision-capable model (json_schema + multimodal combination works end-to-end)."
    why_human: "Requires a funded OPENROUTER_API_KEY and a real network call to OpenRouter; cannot be simulated statically."
  - test: "Real cancellation — same command with --abort-probe"
    expected: "The in-flight call genuinely REJECTS via real fetch/SDK abortion, not a cooperative-only check."
    why_human: "Requires observing actual network-level cancellation behavior under a real slow/hanging call."
  - test: "Happy-path generation on the live Coolify host"
    expected: "One live generation produces a generation_logs row with outcome='pass' and usage_events.metadata.reroll_attempt_count=0."
    why_human: "Requires the real production host, live Supabase, and a paid AI call."
  - test: "Forced re-roll billing split"
    expected: "usage_events.cost_usd_micros reflects only the accepted attempt's cost; the extra re-roll cost appears only in metadata.reroll_cost_usd_micros (CRIT-03)."
    why_human: "Requires triggering a real re-roll against production traffic/data."
  - test: "Hard-fail path (unwanted text across all 3 attempts)"
    expected: "No posts row, no usage_events row, and exactly one hard_fail_all_attempts generation_logs row."
    why_human: "Requires a real model call that reliably renders unwanted text three times in a row."
  - test: "Safety-timer cancellation under load (GENERATION_SAFETY_TIMEOUT_MS=5000)"
    expected: "Client receives 504 (not a later generic 500), no duplicate error log row, request genuinely stops."
    why_human: "Requires real network timing under load on the production host; cannot be simulated statically."
  - test: "Compliance-rate query"
    expected: "select outcome, count(*) from generation_logs where event_kind='visual_critic' group by outcome; returns a sensible distribution after >=10 live generations."
    why_human: "Requires a real population of production generation_logs rows."
  - test: "No-regression sweep"
    expected: "One video, one carousel, one enhancement all succeed with zero visual_critic rows; admin fallback-chain PATCH for critic returns 200; admin routing PATCH for critic still returns 400 (GATE-07 scope fence)."
    why_human: "Requires live end-to-end runs against production infrastructure."
---

# Phase 24: Visual Critic & Re-roll Verification Report

**Phase Goal:** Every generated base image is scored by a multimodal critic on composition, text-legibility zone, color harmony, and unwanted AI-rendered text before it proceeds to compositing; images that fail the threshold automatically re-roll (bounded), the user is still charged exactly once, and SSE timers/AbortSignal are re-derived for the added latency.

**Verified:** 2026-07-28T04:19:48Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Summary

Every code-level must-have across all 7 plans (24-01 through 24-07) is independently confirmed present, substantive, and wired by direct source reading — not by trusting `scripts/verify-phase-24.ts`'s self-report (though it was also run independently and is genuinely green at 55/55 across all 7 tags). `npm run check` is clean. The no-network unit harness (`scripts/test-critic-reroll-logic.ts`) passes all 24 assertions. `scripts/verify-critic-live.ts` correctly SKIPs (exit 0) with no `OPENROUTER_API_KEY`, confirming CI-safety.

The single remaining item — 24-07 Task 3, operator sign-off against the real Coolify production host, live Supabase, and paid OpenRouter calls — was explicitly deferred by user decision and is already persisted as a `partial`-status runbook at `.planning/phases/24-visual-critic-and-re-roll/24-HUMAN-UAT.md` (8 tests, all `pending`). This is reflected here as `human_needed`, not a blocking gap, per instruction.

## Independent Verification of the 6 Flagged Risk Areas

### 1. `chatCompletion()`'s `callClass` param — additive/backward-compatible

**Verified.** `server/services/ai-gateway.service.ts:160` — `const callClass = params.callClass ?? "text";`. Read all 6 pre-existing call sites directly:
- `server/services/gemini.service.ts:523` and `:834` — no `callClass` passed
- `server/services/carousel-generation.service.ts:280` — no `callClass` passed
- `server/services/caption-quality.service.ts:73` — no `callClass` passed
- `server/services/enhancement.service.ts:252` and `:497` — no `callClass` passed

All 6 fall through to the `"text"` default, unchanged from pre-Phase-24 behavior. Only `server/services/visual-critic.service.ts:361` passes `callClass: "critic"`. The harness's own `[svc-cross-plan]` "BACKWARD COMPATIBILITY" check (grep for `callClass:` across the 6 files, expecting zero) also passes independently.

### 2. SSE timeout race fix in `generate.routes.ts`

**Verified — both halves.** Read `server/routes/generate.routes.ts:461-475` (safety timer body) directly:
```
const safetyTimer = setTimeout(async () => {
    controller.abort();                                              // line 462, first statement
    sse.sendError({ message: "Generation timed out...", statusCode: 504 });   // line 468
    await logGenerationError({ ... }).catch(() => {});               // line 469, AFTER sendError
}, GENERATION_SAFETY_TIMEOUT_MS);
```
The 504 is sent before the DB round-trip, and `logGenerationError` carries `.catch(() => {})` so a rejection there can never leave the client hanging.

Read the outer catch at `:1053-1065` directly:
```
} catch (error) {
    console.error("Generation error:", error);            // logging only, no race-causing I/O
    if (controller.signal.aborted) {                       // line 1063 — first race-relevant statement
        return;
    }
    ... (unchanged 500 path) ...
```
The guard is `controller.signal.aborted` (signal-based), not string-sniffing an error message — matches the requirement's intent exactly. It is the first statement with any bearing on the SSE response/DB-write race (the preceding `console.error` is server-side-only logging, not part of the race). This prevents the outer catch's generic 500 and duplicate `generation_logs` row from ever reaching the client/DB ahead of, or in addition to, the timer's 504 + single error row.

### 3. Hard-fail vs soft-fail asymmetry — structurally unselectable

**Verified.** Read `server/services/visual-critic.service.ts:95-130` (`selectFinalAttempt`) directly. Rule 1 requires `!unwantedTextDetected`; Rule 2's best-of-3 loop explicitly `continue`s past any `unwantedTextDetected` candidate; Rule 3 only considers `status === "unavailable"` attempts (which always have `unwantedTextDetected: false` by construction — see `unavailableCriticOutcome()`). An attempt with `unwantedTextDetected === true` cannot match any of the three acceptance rules at any attempt count — it can only fall through to Rule 4 (`hard_fail_all_attempts`, `acceptedIndex: null`). Confirmed by the independently-run unit harness: `selectFinalAttempt([hardFail(15), softFail(6)]) -> accepted 2` (a hard-fail attempt is never selected even with a strictly higher total score) and `selectFinalAttempt([hardFail, hardFail, hardFail]) -> accepted null, outcome hard_fail_all_attempts`.

### 4. Billing isolation — discarded re-roll cost never flows into the charge

**Verified.** Read `server/routes/generate.routes.ts:966-1028` directly. `realCostUsdMicros` is computed from exactly `textCostMicros + imageCostMicros + acceptedCriticCostMicros` (line 976-979) — where `acceptedCriticCostMicros` is explicitly `acceptedAttempt?.outcome.costUsdMicros` (the ACCEPTED attempt only, line 975). `rerollMeta = computeRerollMetadata(criticAttempts, criticSelection?.acceptedIndex ?? null)` (line 985) is a separately-computed value that flows only into `recordUsageEvent`'s 8th arg (`extraMetadata`, line 1021-1027) — never into `realCostUsdMicros`/`gatewayRealCost`. Traced `computeRerollMetadata` itself (`visual-critic.service.ts:138-150`): it explicitly `continue`s past `candidate.index === acceptedIndex`, summing only discarded attempts. `server/quota.ts`'s `recordUsageEvent` `pricing` expression (lines 590-597) derives only from `realCostUsdMicros`/`tokens`/fallback table — `extraMetadata` is spread only into the write-only `metadata` JSON column (line 623), confirmed by direct read and by the harness's independent regex check that neither `pricing` nor `realCostUsdMicros`/`gatewayRealCost` contain `reroll` (case-insensitive).

### 5. Real AbortSignal — genuinely reaches the SDK/fetch calls

**Verified — both legs.** `server/services/ai-gateway.service.ts:165-174` — `chatCompletion`'s `client.chat.completions.create({...}, { signal: params.signal })` — the signal is the openai SDK's documented second `RequestOptions` argument, which the SDK wires to the underlying `fetch`. `server/services/ai-gateway.service.ts:311-328` — `callImageApi`'s `fetch("https://openrouter.ai/api/v1/images", { ..., signal: params.signal })` — a native `fetch()` `RequestInit.signal`, genuine network-layer cancellation. Traced the full chain for the image leg: `generate.routes.ts:654` (`signal: controller.signal`) → `image-provider.ts:312` (`OpenRouterImageProvider.generate` forwards `signal: input.signal`) → `ai-gateway.service.ts:357-361` (`generateImage` passes `params` including `signal` through to `callImageApi`) → `fetch()`. For the critic leg: `generate.routes.ts:673` (`signal: controller.signal`) → `visual-critic.service.ts:366` (`runVisualCritic` passes `signal: params.signal` to `chatCompletion`) → SDK's second argument. The one honestly-documented scope fence: `GeminiImageProvider` (the direct/legacy Gemini rollback path) does NOT receive the signal — this is explicitly commented as a deliberate, 24-CONTEXT.md-scoped omission (`image-provider.ts:55-63`), not a gap, since the critic call class is OpenRouter-only with no direct rollback path.

### 6. GATE-08 video pipeline — untouched

**Verified.** `git diff 44c2dec..HEAD -- server/services/video-generation.service.ts` returns zero lines — the file is byte-for-byte unmodified across every Phase 24 commit. The video branch inside `generate.routes.ts` (lines 590-609) contains no `runVisualCritic`, `controller.signal`, or `criticAttempts` reference (confirmed by direct read and by the harness's independent "VIDEO FENCE" check). `git diff 44c2dec..HEAD --stat` confirms the full changed-file list matches exactly what the 7 plans claim to touch — no unexpected files.

## Goal Achievement

### Observable Truths (aggregated must_haves across 24-01..24-07, 32 total)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `--only=self-test` proves the harness itself is not vacuous | ✓ VERIFIED | `scripts/verify-phase-24.ts` self-test group; ran full harness, 55/55 PASS |
| 2 | `"critic"` is a legal `FallbackCallClass` and legal `ai_models` key | ✓ VERIFIED | `ai-gateway-settings.service.ts:26`, `shared/schema.ts:215` |
| 3 | A `generation_logs` row with `event_kind='visual_critic'` passes Zod validation | ✓ VERIFIED | `shared/schema.ts:1193` |
| 4 | A caller can send a chat completion under a non-`"text"` call class without changing existing callers | ✓ VERIFIED | See risk area 1 above |
| 5 | `AbortController.abort()` cancels the in-flight chat request at the network layer | ✓ VERIFIED | See risk area 5 above |
| 6 | `AbortController.abort()` cancels the in-flight image request at the network layer | ✓ VERIFIED | See risk area 5 above |
| 7 | An abort never causes the fallback chain to try another model | ✓ VERIFIED | `ai-gateway.service.ts:104` `isFallbackWorthy` regex excludes abort messages; harness `[svc-abort-signal]` check 9 re-executes the regex |
| 8 | A usage event can carry platform-side metadata without changing what the user is charged | ✓ VERIFIED | `quota.ts` `pricing` expression excludes `extraMetadata` (line 590-597) |
| 9 | A critic outcome can be written to `generation_logs` without ever breaking a generation | ✓ VERIFIED | `logVisualCritic` wraps body in try/catch, never throws (`observability.service.ts:180-205`) |
| 10 | Compliance rate answerable with a single `GROUP BY` | ✓ VERIFIED (structurally) | `event_kind`/`outcome` columns unconstrained TEXT, no migration needed; query correctness needs real data — human item 7 |
| 11 | Admin can change the critic model slug without a deploy | ✓ VERIFIED | `ai-models-card.tsx:77-78` `updateModel("critic", value)` |
| 12 | Admin can set a critic-specific fallback chain via PATCH | ✓ VERIFIED | `admin-settings.routes.ts:65` `FALLBACK_CLASSES` includes `"critic"` |
| 13 | Critic selector reads correctly in pt-BR and es | ✓ VERIFIED | `pt.ts:470`, `es.ts:407` — `"Visual Critic": "Crítico Visual"` |
| 14 | Unwanted-text image never selected as delivered, at any attempt count | ✓ VERIFIED | See risk area 3 above |
| 15 | All-3-soft-fail selects highest-scoring attempt deterministically | ✓ VERIFIED | `selectFinalAttempt` Rule 2, unit-tested (tie → lowest index) |
| 16 | All-3-unwanted-text selects nothing, caller must fail | ✓ VERIFIED | `selectFinalAttempt` Rule 4; `generate.routes.ts:685-701` throws |
| 17 | Critic outage doesn't fail generation, doesn't consume re-roll attempts | ✓ VERIFIED | `shouldRerollAfter` returns false for `status==="unavailable"` |
| 18 | A fired abort signal propagates out of the critic, not swallowed as an outage | ✓ VERIFIED | `visual-critic.service.ts:403-412` `isAbortLikeError` re-throws before fail-open |
| 19 | Discarded-attempt cost computable without touching accepted attempt's cost | ✓ VERIFIED | See risk area 4 above |
| 20 | Every generated base image scored before crop/typography/logo pipeline runs | ✓ VERIFIED | Pipeline order confirmed by direct read + harness `indexOf` ordering check |
| 21 | Soft-fail triggers up to 2 sequential re-rolls with identical prompt | ✓ VERIFIED | `generate.routes.ts:648` uses `textResult.content.image_prompt` unchanged every attempt |
| 22 | Unwanted-text image never delivered, at any attempt count | ✓ VERIFIED | Duplicate of #14, re-confirmed at call site |
| 23 | User charged once, for final accepted attempt only; discarded attempts in metadata | ✓ VERIFIED | See risk area 4 above |
| 24 | Fired safety timer aborts the in-flight gateway call instead of leaving it running | ✓ VERIFIED | See risk area 2 above |
| 25 | Timed-out generation shows 504, not generic 500 AbortError; exactly one error row | ✓ VERIFIED | See risk area 2 above |
| 26 | Exactly one `visual_critic` row per image generation, including hard-fail | ✓ VERIFIED | `logVisualCritic` called exactly twice (success/hard-fail), mutually exclusive by control flow (hard-fail `throw`s before reaching the success call site) |
| 27 | Video generation byte-for-byte unaffected | ✓ VERIFIED | See risk area 6 above |
| 28 | Full Phase 24 harness green with zero weakened checks | ✓ VERIFIED | Ran independently: 55 PASS / 0 FAIL |
| 29 | Invariants spanning files no single plan owns are asserted, not assumed | ✓ VERIFIED | `[svc-cross-plan]` tag, 7 checks, all independently re-verified by direct source read |
| 30 | No prior phase harness regressed | ✓ VERIFIED | Harness's `spawnSync` proof for phases 16/21/21.1/22/23 all pass |
| 31 | (24-01) Full harness exits non-zero for not-yet-written code | ✓ VERIFIED (historical) | Confirmed true at Wave-1 time via commit history; moot now that all waves are complete and the harness is green |
| 32 | An operator has confirmed the live critic call, a real re-roll, hard-fail, cancellation, and compliance query against production data | ✗ NOT DONE | Deferred by explicit user decision; tracked in `24-HUMAN-UAT.md` (8/8 pending) — **human_needed** |

**Score:** 31/32 truths verified at the code level; 1/32 requires the human/production checkpoint already tracked separately.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/verify-phase-24.ts` | 7-tag phase gate harness | ✓ VERIFIED | 906 lines, 55/55 checks pass on independent run |
| `shared/schema.ts` | `aiModelsSchema.critic` + `generationLogSchema.event_kind` widen | ✓ VERIFIED | Lines 215, 1193 |
| `server/services/ai-gateway-settings.service.ts` | `FallbackCallClass` widened, `DEFAULT_FALLBACKS.critic` | ✓ VERIFIED | Lines 26, 34-39 |
| `server/services/ai-gateway.service.ts` | `callClass` + `signal` on chat/image params | ✓ VERIFIED | Lines 131, 139, 299 |
| `server/services/image-provider.ts` | `ImageGenerationInput.signal` forwarded | ✓ VERIFIED | Lines 24, 312 |
| `server/quota.ts` | `recordUsageEvent` `extraMetadata` passthrough | ✓ VERIFIED | Line 587, spread at 623 |
| `server/services/observability.service.ts` | `logVisualCritic` emitter | ✓ VERIFIED | Lines 150-205 |
| `server/routes/admin-settings.routes.ts` | `FALLBACK_CLASSES` includes `critic` | ✓ VERIFIED | Line 65 |
| `client/src/components/admin/post-creation/ai-models-card.tsx` | Visual Critic selector | ✓ VERIFIED | Lines 25-27, 75-78 |
| `client/src/lib/translations/pt.ts`, `es.ts` | "Visual Critic" translated | ✓ VERIFIED | pt.ts:470, es.ts:407 |
| `server/services/visual-critic.service.ts` | Schema + pure selection logic + `runVisualCritic` | ✓ VERIFIED | 415 lines; all named exports present |
| `scripts/test-critic-reroll-logic.ts` | No-network unit harness | ✓ VERIFIED | Ran independently: 24/24 assertions PASS |
| `scripts/verify-critic-live.ts` | `OPENROUTER_API_KEY`-gated live smoke test | ✓ VERIFIED | Ran independently: correctly SKIPs (exit 0) with no key |
| `server/routes/generate.routes.ts` | AbortController + re-roll loop + billing metadata + log sites | ✓ VERIFIED | Lines 460-1028 (232-line diff), all wiring traced directly |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `chatCompletion(params.callClass)` | `getFallbackChain` + `callWithFallback` | resolved local, replacing 2 hardcoded `"text"` literals | ✓ WIRED | `ai-gateway.service.ts:160-164` |
| `client.chat.completions.create(body, { signal })` | openai SDK `RequestOptions` | 2nd arg | ✓ WIRED | Line 173 |
| `fetch(images endpoint, { signal })` | native `fetch` `RequestInit.signal` | direct | ✓ WIRED | Line 327 |
| `recordUsageEvent(extraMetadata)` | `usage_events.metadata` | object spread, gated by widened `hasGatewayMeta` | ✓ WIRED | `quota.ts:604,623` |
| `logVisualCritic` | `generation_logs.event_kind='visual_critic'` | `createAdminSupabase().insert` | ✓ WIRED | `observability.service.ts:191` |
| `ai-models-card.tsx Select` | `style_catalog.ai_models.critic` | `updateModel('critic', value)` | ✓ WIRED | Lines 77-78 |
| `PATCH /api/admin/ai-model-fallbacks` | `setFallbackChain('critic', chain)` | `FALLBACK_CLASSES` membership check | ✓ WIRED | `admin-settings.routes.ts:65,115,121` |
| `runVisualCritic` | `chatCompletion({callClass:'critic', responseFormat: json_schema, signal})` | `ai-gateway.service.ts` | ✓ WIRED | `visual-critic.service.ts:355-367` |
| `runVisualCritic` | `toOpenRouterInputReference` | multimodal image_url part | ✓ WIRED | Line 352 |
| `safetyTimer` | `controller.abort()` | setTimeout body, first statement | ✓ WIRED | `generate.routes.ts:461-462` |
| `controller.signal` | `provider.generate` + `runVisualCritic` | signal param per attempt | ✓ WIRED | Lines 654, 673 |
| `selectFinalAttempt`+`computeRerollMetadata` | `recordUsageEvent extraMetadata` (8th arg) | `reroll_*` keys | ✓ WIRED | Lines 985, 1021-1027 |
| `critic loop` | `logVisualCritic` | 1 call after post insert, 1 before hard-fail throw (postId null) | ✓ WIRED | Lines 691-700, 992-1003 |
| outer catch | safety timer's 504 | `controller.signal.aborted` early return | ✓ WIRED | Line 1063 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `runVisualCritic` call site | critic model slug | `styleCatalog.ai_models?.critic` (from `getStyleCatalogPayload()`, DB-backed `style_catalog` row) | Yes — real Zod-defaulted DB value, not hardcoded | ✓ FLOWING |
| critic loop `imageResult` | accepted image buffer | `attemptBuffers.get(criticSelection.acceptedIndex)`, populated from `provider.generate()` per attempt | Yes — real image bytes from the provider call, not a stub | ✓ FLOWING |
| `ai-models-card.tsx` critic Select | `aiModels.critic` | `useState`/query hydrated from `GET` style-catalog admin payload | Yes — round-trips through the real PATCH endpoint | ✓ FLOWING |
| `recordUsageEvent` `metadata.reroll_*` | `rerollMeta` | `computeRerollMetadata(criticAttempts, acceptedIndex)` over real per-attempt cost data | Yes — sums actual `imageCostUsdMicros`/`outcome.costUsdMicros` from provider/gateway responses | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full Phase 24 harness (7 tags) | `npx tsx scripts/verify-phase-24.ts` | `PASS: 55`, "All Phase 24 checks passed." | ✓ PASS |
| No-network re-roll decision matrix | `npx tsx scripts/test-critic-reroll-logic.ts` | 24/24 assertions PASS, "All CRIT-02 re-roll decision tests passed." | ✓ PASS |
| TypeScript project-wide check | `npm run check` | Exits 0, no errors | ✓ PASS |
| Live critic smoke test CI-safety | `OPENROUTER_API_KEY= npx tsx scripts/verify-critic-live.ts` | `SKIP verify-critic-live — OPENROUTER_API_KEY not set` | ✓ PASS |
| GATE-08 video file untouched | `git diff 44c2dec..HEAD -- server/services/video-generation.service.ts` | 0 lines | ✓ PASS |
| Prior-phase regression (16/21/21.1/22/23) | via harness `[svc-cross-plan]` `spawnSync` | all report exit 0 | ✓ PASS |
| Live critic call, real cancellation, live re-roll/hard-fail, safety-timer-under-load, compliance query, no-regression sweep | requires Coolify prod + live Supabase + paid OpenRouter | — | ? SKIP (routed to human — see below) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| CRIT-01 | 24-01, 24-02, 24-04, 24-05, 24-06, 24-07 | Multimodal critic scores every image on composition/text-legibility/color-harmony/unwanted-text before post-processing | ✓ SATISFIED (code) | `visual-critic.service.ts` schema + rubric; wired in `generate.routes.ts` before crop/typography/logo |
| CRIT-02 | 24-01, 24-05, 24-06, 24-07 | Sequential re-roll (cap 2), unwanted text is hard-fail gate | ✓ SATISFIED (code) | `selectFinalAttempt`/`shouldRerollAfter`, unit-tested |
| CRIT-03 | 24-01, 24-03, 24-06, 24-07 | User charged once; platform-side re-roll cost in metadata only | ✓ SATISFIED (code) | Billing isolation traced end-to-end (risk area 4) |
| CRIT-04 | 24-01, 24-02, 24-06, 24-07 | SSE timers re-derived for gateway+critic latency; AbortSignal genuinely cancels in-flight work | ✓ SATISFIED (code) | Real signal wiring + timeout race fix (risk areas 2, 5) |
| CRIT-05 | 24-01, 24-03, 24-06, 24-07 | Critic outcomes logged to `generation_logs`; compliance rate measurable | ✓ SATISFIED (code) | `logVisualCritic`, schema widen; live compliance number is human item 7 |

All 5 requirement IDs declared across the 7 plans are accounted for; cross-referenced against `.planning/REQUIREMENTS.md` lines 43-47 — no orphaned requirement IDs (REQUIREMENTS.md maps exactly CRIT-01..05 to Phase 24, all present in at least one plan's `requirements` frontmatter). REQUIREMENTS.md itself still correctly shows all 5 as **Pending** (not Complete) — appropriately conservative, since the live/production sign-off (Task 3) has not occurred. This verification's code-level findings do NOT flip that status; that remains gated on the human checkpoint.

### Anti-Patterns Found

None. Scanned every file modified in Phase 24 (`server/services/visual-critic.service.ts`, `ai-gateway.service.ts`, `ai-gateway-settings.service.ts`, `image-provider.ts`, `server/quota.ts`, `server/services/observability.service.ts`, `server/routes/generate.routes.ts`, `server/routes/admin-settings.routes.ts`, `shared/schema.ts`, `client/src/components/admin/post-creation/ai-models-card.tsx`, `scripts/verify-phase-24.ts`, `scripts/test-critic-reroll-logic.ts`, `scripts/verify-critic-live.ts`) for TODO/FIXME/XXX/HACK/PLACEHOLDER/"not yet implemented"/"coming soon" markers, empty stub returns, and hardcoded-empty props. Only matches were legitimate UI `placeholder={t("Select a model")}` attributes on existing `<SelectValue>` inputs — not stubs.

### Human Verification Required

The following 8 items were already identified by plan 24-07 and are persisted verbatim (with `pending` status) at `.planning/phases/24-visual-critic-and-re-roll/24-HUMAN-UAT.md`. They require the real Coolify production host, live Supabase, and paid OpenRouter calls — none of which are available in a static-verification context. Per explicit user decision, Task 3 of plan 24-07 (the operator sign-off gate covering these) was deferred rather than performed or fabricated.

1. **Live critic call** — `OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-critic-live.ts --image=./<png>` should exit 0 with 5/5 assertions against a real vision-capable model.
2. **Real cancellation** — same command with `--abort-probe` should show the in-flight call genuinely REJECTS (real fetch/SDK abortion).
3. **Happy-path generation** — one live generation should produce a `generation_logs` row with `outcome='pass'` and `usage_events.metadata.reroll_attempt_count=0`.
4. **Forced re-roll** — `usage_events.cost_usd_micros` should reflect only the accepted attempt's cost; extra re-roll cost only in `metadata.reroll_cost_usd_micros`.
5. **Hard-fail path** — an unwanted-text hard-fail across all 3 attempts should produce no `posts` row, no `usage_events` row, exactly one `hard_fail_all_attempts` `generation_logs` row.
6. **Safety-timer cancellation under load** — with `GENERATION_SAFETY_TIMEOUT_MS=5000`, a forced-slow request should be genuinely aborted (504, not a later 500; no duplicate error log row).
7. **Compliance rate query** — after >=10 live generations, the `GROUP BY outcome` query should return a sensible distribution.
8. **No-regression sweep** — one video/carousel/enhancement should each succeed with zero `visual_critic` rows; admin fallback-chain PATCH for `critic` returns 200; admin routing PATCH for `critic` still returns 400 (GATE-07 scope fence).

### Gaps Summary

No code-level gaps found. All 31 automatable must-haves across the 7 plans were independently re-verified by direct source reading (not by trusting the harness's self-report, though the harness was also run and is genuinely green at 55/55). The 6 specifically-flagged risk areas — `callClass` backward compatibility, the SSE timeout race fix, the hard-fail/soft-fail structural asymmetry, billing isolation, real AbortSignal propagation, and the frozen GATE-08 video path — all check out exactly as documented, with no discrepancy between what the SUMMARYs claim and what the code does.

The only open item is the human/production operator sign-off (24-07 Task 3), which was a deliberate, already-documented deferral, not an oversight. It blocks REQUIREMENTS.md from flipping CRIT-01..05 to Complete and blocks the phase from being marked fully done in STATE.md/ROADMAP.md — both of which correctly still show it as pending/blocking. This verification treats that single item as `human_needed` rather than a gap, per instruction.

---

_Verified: 2026-07-28T04:19:48Z_
_Verifier: Claude (gsd-verifier)_
