# Phase 21: OpenRouter Gateway Foundation - Research

**Researched:** 2026-07-18
**Domain:** OpenRouter API gateway migration (chat/image/transcription) for a live billed Node/Express SaaS; billing real-cost wiring; admin-configurable model fallback chains; emergency rollback; two production-bug fixes
**Confidence:** HIGH — this document verifies the milestone-level research's #1 flagged gap (OpenRouter's dedicated Image API request/response shape) against live docs and an official OpenRouter-maintained GitHub skill repo, and grounds every architectural claim in the actual current codebase (file + line citations below).

This document is a **delta** on top of `.planning/research/STACK.md`, `ARCHITECTURE.md`, and `PITFALLS.md` (milestone-level, read in full — do not re-derive what they already cover). It does not repeat their content except where new live verification changes or sharpens a claim. Read those three files alongside this one.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Gateway service shape**
- New `server/services/ai-gateway.service.ts` exposing three call classes: `chatCompletion()` (planning, captions, caption-quality, pre-screen), image `generate()`/`edit()`, and `transcribe()`.
- Chat + transcription use the existing `openai` npm SDK with `baseURL: "https://openrouter.ai/api/v1"` (STACK.md confirmed). Image calls use **raw `fetch` against OpenRouter's dedicated Image API (`POST /api/v1/images`)** — the SDK cannot reach it; pass top-level `aspect_ratio` and `resolution` params natively.
- The `ImageProvider.generate()/edit()` interface in `server/services/image-provider.ts` is PRESERVED — a new `OpenRouterImageProvider` implements it by delegating to the gateway. The existing `GeminiImageProvider` stays alive as the rollback target (GATE-07). `OpenAIImageProvider` may be deleted (retired by GATE-04) once rollback only targets direct Gemini.
- The 5 raw-fetch Gemini call sites (`gemini.service.ts` text call, `carousel-generation.service.ts` master plan, `caption-quality.service.ts`, `enhancement.service.ts` pre-screen+caption, `transcribe.routes.ts`) all migrate to the gateway's `chatCompletion()`/`transcribe()`. Verify-phase script asserts zero remaining `generativelanguage.googleapis.com` fetches outside video-generation.service.ts and the legacy rollback path.

**Routing + emergency rollback (GATE-07)**
- New `platform_settings` row `ai_gateway_routing`: `{ "planning": "openrouter"|"direct", "image": "openrouter"|"direct", "transcription": "openrouter"|"direct" }`, default `"openrouter"`. Read per request (no restart), same cached-settings pattern as `getPlatformSetting`.
- `"direct"` routes to the retained legacy Gemini code path (header-auth version). This is how rollback survives the retirement of the old gemini/openai `image_provider` toggle (GATE-04) — they are orthogonal controls.

**Model slugs + fallback chains (GATE-04)**
- Primary slugs live in the EXISTING `style_catalog.ai_models` fields (values become OpenRouter slugs, e.g. `google/gemini-2.5-flash`, `google/gemini-3.1-flash-image`). No new config surface for primaries.
- New `platform_settings` row `ai_model_fallbacks`: `{ "text": [slug,...], "image": [...], "transcription": [...] }` — one ordered chain per call class.
- Fallback triggers: OpenRouter 404 / `model_not_found` / 410 on the slug, and 5xx/502 upstream errors. One pass through the chain, first success wins. Every fallback engagement logged to `generation_logs` (event_kind `model_fallback`, metadata: from-slug, to-slug, reason) — satisfies Phase 21 SC3.
- `profiles.image_provider` + `platform_settings.image_provider` toggle retired: resolution function returns OpenRouter path unconditionally (except `ai_gateway_routing` overrides). Columns retained dead (additive precedent from Phase 12.1→12.3).

**Billing with real cost (GATE-05)**
- `recordUsageEvent` gains an ADDITIVE optional param (mirrors `checkCredits(slideCount?)` convention): `realCostUsdMicros?: number`. When present: `cost_usd_micros = realCostUsdMicros`, `charged_amount_micros = realCostUsdMicros × getMarkupMultiplier()` (existing underused helper).
- OpenRouter returns `usage.cost` (USD float) by default on every response — convert `Math.round(cost × 1_000_000)` to micros. The Image API response's cost field is confirmed at implementation time (research gap #1 — live check during plan research).
- Pre-call estimate path (`checkCredits`/`estimateBaseCostMicros`) UNCHANGED this phase. Both the pre-call estimate AND post-call actual are stored in the usage event metadata JSON (SC4). Static token tables remain as fallback when `usage.cost` is absent, and for video (off-gateway).

**Keys + env (platform scope only)**
- New env `OPENROUTER_API_KEY` added to `server/config/index.ts` Zod schema. Platform-wide key this phase; affiliate BYOK is Phase 21.1 (GATE-06) — `getGeminiApiKey`-style resolution for OpenRouter keys lands there, this phase uses the platform key for all gateway traffic and BYO affiliates temporarily continue on the legacy direct path via `ai_gateway_routing` if needed (documented operator note).
- POL-07: eliminate ALL `?key=` query strings — the retained direct-Gemini legacy paths in `gemini.service.ts` / `caption-quality.service.ts` / `text-rendering.service.ts` switch to the `x-goog-api-key` header (pattern already used in `image-generation.service.ts`). OpenRouter uses `Authorization: Bearer`.
- Include OpenRouter attribution headers (`HTTP-Referer: https://xareable.com`, `X-Title: Xareable`) on gateway calls.

**Ride-along production fixes**
- CRSL2-03: in `carousel-generation.service.ts` slide loop — if slide 1 fails, `break` immediately (no doomed slides 2..N calls with null base64).
- POL-01: in `edit.routes.ts` — `checkCredits(user.id, "edit", post.content_type === "video")` so the estimate matches the real flat video charge.

**Video freeze guard (GATE-08)**
- `scripts/verify-phase-21.ts` static harness: (a) `video-generation.service.ts` has zero OpenRouter imports/references and still targets `generativelanguage.googleapis.com`; (b) no `?key=` query strings anywhere in server/; (c) gateway file exists with the three call classes; (d) fallback chain config read path exists; (e) `recordUsageEvent` signature includes the additive real-cost param. Live video smoke test gated behind env flag (paid API) — optional, not CI-blocking.

### Claude's Discretion
- Exact error-normalization shape of gateway errors; per-call timeouts via AbortSignal (suggest ~60s text / ~150s image, tuned during implementation); retry-on-429 semantics (keep existing single-retry patterns); file/module internal naming; whether `OpenAIImageProvider` is deleted now or in Phase 26 cleanup.

### Deferred Ideas (OUT OF SCOPE)
- Affiliate BYOK provisioning/rotation + billing attribution → Phase 21.1 (GATE-06).
- Planning-call content upgrades (refs attached, json_schema, prompt precedence) → Phase 22.
- SSE timer re-derivation + AbortSignal cancellation → Phase 24 (CRIT-04).
- Any prompt-content or style-catalog changes → Phases 22/25.
- Deleting dead legacy code paths → Phase 26 or later cleanup (keep rollback viable first).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GATE-01 | Text/planning calls route through shared gateway (OpenAI SDK + baseURL), replacing 5 raw-fetch impls | Confirmed OpenAI SDK compatible with `/api/v1/chat/completions` (STACK.md HIGH). Exact 5 call sites + line numbers identified below. `structured-outputs` docs re-verified live: unsupported models now **fail loudly** (see Pitfall 9 refinement below), simplifying error handling. |
| GATE-02 | Image gen/edit through OpenRouter's dedicated Image API (raw HTTP), preserving `ImageProvider` interface | **Live-verified this phase** (see "Image API — Live-Verified Shape" below): request/response fields, header auth, `input_references` format. Cross-checked against 2 independent official sources (blog + OpenRouterTeam/skills repo) — now HIGH confidence (was MEDIUM in milestone research). |
| GATE-03 | Audio transcription routes through gateway | Live-verified: both JSON (`input_audio`) and multipart (OpenAI-SDK-compatible) request shapes confirmed; `usage.cost` present. See below. |
| GATE-04 | Admin-configurable model slugs + fallback chain per call class; retire `image_provider` toggle | `style_catalog.ai_models` (shared/schema.ts:179-185) already free-text, admin-editable — no schema change needed for primaries. New `platform_settings.ai_model_fallbacks` needs a read pattern — see "Platform Settings: object-shaped values" gotcha below (existing `getPlatformSetting` helper returns strings only, even for JSON objects). |
| GATE-05 | Real per-request cost into billing via additive `recordUsageEvent` param | `usage.cost` (USD float) confirmed present on chat, image, and transcription responses (all 3 live-verified below). Exact current `recordUsageEvent` signature and 4 call sites documented below (quota.ts:579, generate.routes.ts:755, edit.routes.ts:549/967(carousel), transcribe.routes.ts:174). |
| GATE-07 | Emergency rollback per call class without deploy | Existing `getPlatformSetting`/`setPlatformSetting` (app-settings.service.ts:187-213) is the exact mechanism — no new infra needed, just a new settings key + 3-way branch per call class. |
| GATE-08 | Video pipeline untouched; regression smoke test | `video-generation.service.ts` read in full — already uses `x-goog-api-key` header (not `?key=`), targets `generativelanguage.googleapis.com` directly, zero shared-module dependency on `gemini.service.ts`/`image-generation.service.ts`. Confirms it's already structurally isolated — the verify script only needs to assert this isolation holds, not create it. |
| POL-01 | Fix `isVideo` credit gate in edit route | Exact bug confirmed: `edit.routes.ts:182` calls `checkCredits(user.id, "edit")` with no 3rd arg (defaults `isVideo=false`), while `generate.routes.ts:197` correctly passes it. Fallback pricing differs 30x between image ($0.117 sell) and video ($3.60 sell) fallback tables (quota.ts:123-135) — real under-estimation risk on video edits. |
| POL-07 | No API keys in query strings | Exact 4 remaining `?key=` sites enumerated below with line numbers; 4 already-compliant sites (using `x-goog-api-key` header) also enumerated so the planner doesn't waste a task "fixing" code that's already correct. |
| CRSL2-03 | Slide-1 failure aborts loop immediately | Exact code location confirmed: `carousel-generation.service.ts:503-508`, the `catch` block inside the slide loop currently logs+continues for ALL slides including slide 1; needs a slide-1-specific `break`/throw before the loop continues to slide 2. |
</phase_requirements>

## Summary

Phase 21 is a **plumbing migration**, not a feature phase: the target behavior (planning call output, image quality, caption quality, transcription accuracy) must be bit-for-bit equivalent to today, just routed through OpenRouter with admin-configurable slugs, fallback chains, real cost, and a working rollback switch. The milestone-level research (STACK/ARCHITECTURE/PITFALLS) already did the heavy lifting; this phase's research closes the one explicitly-flagged gap — **the exact request/response shape of OpenRouter's dedicated Image API** — via live docs plus the OpenRouterTeam's own official `skills/openrouter-images` GitHub repo (a maintained reference implementation, not a blog post), cross-verified across two independent sources.

**Primary recommendation:** Build `ai-gateway.service.ts` as three independently-callable functions (`chatCompletion`, `generateImage`/`editImage`, `transcribe`) — chat/transcribe via the `openai` SDK pointed at OpenRouter's `baseURL`, image via raw `fetch` to `POST https://openrouter.ai/api/v1/images` reading `data[0].b64_json` and `usage.cost`. Wire `usage.cost` into `recordUsageEvent`'s new additive param on every call class. Keep every existing call site signature-compatible (the `ImageProvider` interface and `recordUsageEvent`'s positional params are both already additive-friendly). Fix POL-01/POL-07/CRSL2-03 as small, independently-testable surgical patches in the same phase since they touch adjacent code but are logically separable from the gateway work.

## Image API — Live-Verified Shape (research gap #1, closed)

Milestone research (STACK.md, ARCHITECTURE.md) flagged this as MEDIUM confidence, ~4 weeks post-launch, WebSearch-only. This phase re-verified directly against **(a)** OpenRouter's official blog announcement, **(b)** the OpenRouterTeam-maintained `skills/openrouter-images` GitHub repo (`SKILL.md` + `scripts/generate.ts`), and **(c)** `openrouter.ai/docs/guides/overview/multimodal/image-generation`. All three agree on the core shape below — confidence is now **HIGH**.

### Request

```
POST https://openrouter.ai/api/v1/images
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
HTTP-Referer: https://xareable.com
X-Title: Xareable
```

```json
{
  "model": "google/gemini-3.1-flash-image",
  "prompt": "...",
  "aspect_ratio": "4:5",
  "resolution": "2K",
  "input_references": [
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,<...>" } }
  ]
}
```

- `model`, `prompt` required. `aspect_ratio`, `resolution` are **top-level fields**, not nested (confirmed independently by both the milestone research's live `/endpoints` introspection and this phase's docs/skills-repo re-check).
- `input_references` accepts **either** `https://...` URLs or `data:` base64 URLs, wrapped in `{ type: "image_url", image_url: { url } }` objects (OpenAI-chat-content-block-shaped, NOT a bare string array — this is a concrete detail the milestone research did not pin down). Current codebase's `ReferenceImage` type (`image-provider.ts:10-13`) is `{ mimeType, data }` (bare base64, no `data:` prefix) — the gateway's image call needs a small adapter: `data:${mimeType};base64,${data}` wrapped in the `image_url` object shape, not a direct pass-through.
- Editing (image-to-image) uses the **same endpoint**, sending the current image via `input_references` — there is no separate `/edit` path. This confirms the `ImageProvider.generate()` vs `.edit()` split is purely an application-level distinction; both map to the same OpenRouter request shape with `input_references` populated or empty.
- Other optional fields exist (`n`, `quality`, `output_format`, `background`, `seed`, `provider.only`/`provider.options`) but are **not required for parity with today's behavior** — do not add them speculatively; only wire what CONTEXT.md's locked decisions require (`aspect_ratio`, `resolution`, `input_references`).

### Response

```json
{
  "created": 1748372400,
  "data": [
    { "b64_json": "<base64-encoded-image>", "media_type": "image/png" }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 4175,
    "total_tokens": 4175,
    "cost": 0.04
  }
}
```

- Image bytes: `data[0].b64_json` (base64 string, no `data:` prefix — matches what `ImageProviderResult.buffer` already expects after a `Buffer.from(..., "base64")` decode, same pattern as the existing `GeminiImageProvider`).
- MIME type: `data[0].media_type`.
- **Cost: `usage.cost` (USD float, e.g. `0.04`) — confirmed present on the Image API response**, same field name/shape as chat completions and transcription. This directly satisfies GATE-05's dependency on `usage.cost` being available for image calls, closing the exact open question CONTEXT.md flagged at line 37 ("confirmed at implementation time").
- Convert to micros: `Math.round(usage.cost * 1_000_000)`.

### Errors (for fallback-chain triggers, GATE-04)

Confirmed via `openrouter.ai/docs/api-reference/errors`-equivalent content (live-fetched):

```json
// 404 — model not found/deprecated
{ "error": { "code": 404, "message": "...", "metadata": { "error_type": "not_found" } } }

// 400 — malformed/unsupported parameter
{ "error": { "code": 400, "message": "...", "metadata": { "error_type": "invalid_request" } } }

// 429 — rate limited (also sends a Retry-After header)
{ "error": { "code": 429, "message": "...", "metadata": { "error_type": "rate_limit_exceeded" } } }
```

This matches CONTEXT.md's fallback-trigger design (404/`model_not_found`/410, 5xx/502) — **codewise, check `response.status` and/or `body.error.code`, not just HTTP status**, since OpenRouter nests a numeric `code` inside the JSON body that mirrors the HTTP status but is the documented field to branch on. No live-test was performed against a real deprecated slug (would require a paid API key + intentionally-broken model string) — this remains a MEDIUM-confidence mechanical detail; the shape is documented consistently but the fallback code should defensively also treat non-2xx as fallback-worthy regardless of the exact body shape, in case of provider-level errors that don't perfectly match the documented shape (this is a pre-existing pitfall documented in PITFALLS.md Pitfall 9 — "provider-specific quirks silently differ").

### SDK compatibility (unchanged from milestone research, re-confirmed)

- Image API: **raw `fetch` required**, not reachable via `openai` SDK's `images.generate()` or `chat.completions.create()`. No source contradicts this.
- Chat completions + structured outputs: `openai` SDK's `chat.completions.create({ baseURL: "https://openrouter.ai/api/v1", ... })` works, confirmed by the quickstart pattern (STACK.md) — this phase's re-check did not surface any contradiction.
- Audio transcription: **newly confirmed with an explicit code sample** (not present in milestone research) —

```javascript
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
});
await client.audio.transcriptions.create({
  model: "openai/whisper-large-v3",
  file: audioFile, // File/Blob — multipart
});
```

  Response: `{ text: "...", usage: { seconds, total_tokens, input_tokens, output_tokens, cost } }` — `usage.cost` confirmed present here too.

  **Implementation nuance for this codebase:** today's `transcribe.routes.ts` receives `audioData` as a base64 string + `mimeType` (`req.body.audioData`), not a `File`/`Blob`. Two viable paths for `aiGateway.transcribe()`:
  1. Construct a Node `File` from the base64 buffer (`new File([Buffer.from(audioData, "base64")], "audio", { type: mimeType })` — Node 20+ has a global `File`, and this Docker image runs `node:24-alpine`, so this works) and call the SDK's multipart `audio.transcriptions.create()`.
  2. Use the **JSON `input_audio` variant** directly via raw `fetch` (bypassing the SDK for this one call), which accepts `{ model, input_audio: { data: base64, format }, language }` — this avoids constructing a `File` object and is a closer match to the current data shape.

  Both are valid; CONTEXT.md locks "existing `openai` npm SDK" for transcription, which points at path 1, but path 2 is worth flagging as **Claude's discretion during implementation** if the `File` construction proves awkward — it is not a violation of the locked decision's intent (SDK-compatible OpenAI-shaped call), just a different transport for the same endpoint. Recommend documenting whichever is chosen in a code comment since both are "correct."

## Codebase Grounding — Exact Call Sites

### The 5 raw-fetch text/transcription call sites (GATE-01/03)

| File | Function | Line | Auth pattern today |
|---|---|---|---|
| `server/services/gemini.service.ts` | `generateText` (main planning call) | 653 | `?key=` query string |
| `server/services/gemini.service.ts` | `generateCaptionOnly` (local-fallback caption) | 426 | `?key=` query string |
| `server/services/gemini.service.ts` | `transcribeAudio` (dead code — duplicated by `transcribe.routes.ts`) | 835 | `?key=` query string |
| `server/services/carousel-generation.service.ts` | `callCarouselTextPlan` | 244 | `x-goog-api-key` header (already correct) |
| `server/services/caption-quality.service.ts` | `callGeminiForCaption` | 66 | `?key=` query string |
| `server/services/enhancement.service.ts` | `runPreScreen` | 177 | `x-goog-api-key` header (already correct) |
| `server/services/enhancement.service.ts` | `generateEnhancementCaption` | 383 | `x-goog-api-key` header (already correct) |
| `server/routes/transcribe.routes.ts` | inline fetch | 132 | `?key=` query string |

Note: `gemini.service.ts::generateImage()` (line 778) and `::transcribeAudio()` (line 829, dead code) both exist in the same file as `generateText`/`generateCaptionOnly` — the class has mixed auth patterns internally today (`generateImage` already uses the header). This confirms POL-07 isn't "convert one service," it's "convert 4 specific functions across 4 files," not a blanket file-level change.

### POL-07 exact remediation list

**Needs fixing (still `?key=` query string):**
1. `gemini.service.ts:426` (`generateCaptionOnly`)
2. `gemini.service.ts:653` (`generateText`)
3. `gemini.service.ts:835` (`transcribeAudio` — dead code; fix or delete, since GATE-01 replaces its only caller anyway)
4. `caption-quality.service.ts:66` (`callGeminiForCaption`)
5. `text-rendering.service.ts:79` (`verifyExactImageText`)
6. `transcribe.routes.ts:132` (inline fetch — replaced entirely by GATE-03's gateway migration, so this line disappears rather than being patched)

**Already compliant (no change needed — do not "fix" what isn't broken):**
- `image-generation.service.ts:113,214` (`generateImage`/`editImage`) — `x-goog-api-key` header
- `carousel-generation.service.ts:248` — `x-goog-api-key` header
- `enhancement.service.ts:184,387` — `x-goog-api-key` header
- `video-generation.service.ts:106,181,233` — `x-goog-api-key` header (frozen, don't touch regardless)
- `gemini.service.ts:784` (`generateImage` method) — `x-goog-api-key` header

Since GATE-01/03 replace items 1, 2, 3, 6 wholesale (their call sites move to the gateway entirely), the **only line that is a pure "patch in place, keep on direct Gemini" fix** is #4 (`caption-quality.service.ts`) — no wait, `caption-quality.service.ts` is also migrated to the gateway's `chatCompletion()` per GATE-01's locked decision (`ensureCaptionQuality` is one of the 5 target call sites in CONTEXT.md's "Gateway service shape" section). Re-reading CONTEXT.md's exact list of 5 migrated sites: `gemini.service.ts`, `carousel-generation.service.ts` (already-header, migrates for consistency/model-config not security), `caption-quality.service.ts`, `enhancement.service.ts` (already-header, same reasoning), `transcribe.routes.ts`. **This means item #5 (`text-rendering.service.ts:79`) is the one genuinely "left on direct Gemini and needs a standalone header fix"** — `text-rendering.service.ts` (the exact-text verify/repair loop) is NOT in the 5-site migration list and is NOT deleted this phase (that's TYPO-06, Phase 23). It keeps calling direct Gemini via `editImage()`/its own `verifyExactImageText` fetch, so it needs the `?key=` → header fix as a standalone patch, independent of the gateway migration.

**Precise task-shape implication:** POL-07 is two different kinds of work — (a) for sites that also migrate to the gateway (1,2,3,6 above), the fix is a side effect of GATE-01/03's rewrite, not a separate patch; (b) `text-rendering.service.ts:79` is the one site needing an isolated header-only patch since it stays on direct Gemini this phase (it's a `verify` call inside the retained legacy exact-text repair loop, deleted only in Phase 23/TYPO-06).

### Billing chain — `recordUsageEvent` call sites (GATE-05)

Current signature (`server/quota.ts:579-585`):
```typescript
export async function recordUsageEvent(
  userId: string,
  postId: string | null,
  eventType: "generate" | "edit" | "transcribe",
  tokens?: UsageTokenData,
  models?: UsageModelData,
): Promise<RecordedUsageEvent>
```

Call sites needing the new 6th param (`realCostUsdMicros?: number`):
| File | Line | Event type |
|---|---|---|
| `server/routes/generate.routes.ts` | 755 | `"generate"` |
| `server/routes/edit.routes.ts` | 549 | `"edit"` |
| `server/routes/carousel.routes.ts` | 470 | `"generate"` (carousel) |
| `server/routes/carousel.routes.ts` | 967 | `"edit"` (slide edit) |
| `server/routes/transcribe.routes.ts` | 174 | `"transcribe"` |
| `server/services/enhancement.service.ts` | — (enhancement route calls this; verify exact line at implementation, not directly read this pass) | `"generate"` |

Internally, `recordUsageEvent` already branches to `calculateCostMicros(tokens, ...)` when `tokens` is present, else `getOperationFallbackCostMicros(...)`. The additive `realCostUsdMicros` param should short-circuit **before** that branch (highest priority: real cost > token-table estimate > flat fallback) — matches CONTEXT.md's decision verbatim. `isVideo` detection already exists inline (`models?.image_model === "veo-3.1-generate-preview"`, quota.ts:587) and stays relevant for `getOperationFallbackCostMicros`'s fallback path only (video never gets a real gateway cost since it's off-gateway).

### `getMarkupMultiplier()` — confirmed underused, ready to use (quota.ts:324-345)

Already implemented, queries `platform_settings.markup_regular`/`markup_affiliate` based on `profiles.referred_by_affiliate_id`, defaults to `3`, floors at `1`. Currently **only called from `deductCredits`** to back-compute a markup ratio for RPC logging (quota.ts:539-541: `rawCostMicros > 0 ? Math.round((chargedCostMicros / rawCostMicros) * 100) / 100 : 1`) — it is NOT currently used to compute `charged_amount_micros` directly anywhere in `recordUsageEvent`. CONTEXT.md's design (`charged_amount_micros = realCostUsdMicros × getMarkupMultiplier()`) is the first real caller of this function for its originally-apparent purpose. No blockers found — the function signature (`getMarkupMultiplier(userId: string): Promise<number>`) is directly callable from `recordUsageEvent` (which already receives `userId` as its first param).

### GATE-04 — reading object-shaped `platform_settings` (gotcha for `ai_gateway_routing` / `ai_model_fallbacks`)

`getPlatformSetting(key)` (app-settings.service.ts:187-197) has this exact behavior:
```typescript
const v = data?.setting_value;
return typeof v === "string" ? v : v == null ? null : JSON.stringify(v);
```
Every existing caller uses this for **scalar string settings** (`gemini_api_key`, `openai_api_key`, `image_provider` — the latter stored as the JSON string literal `"gemini"`, so it round-trips as a plain string already). There is **no existing precedent** for reading a JSON *object*-shaped setting through this helper — `ai_gateway_routing: { planning: "openrouter", ... }` and `ai_model_fallbacks: { text: [...], ... }` are both objects, so `getPlatformSetting` will `JSON.stringify()` them, forcing the caller to `JSON.parse()` the result back — a redundant round-trip.

**Two viable patterns, pick one for the plan:**
1. Use `getPlatformSetting` + `JSON.parse(raw || "{}")` at each read site — minimal new code, but every call site repeats the parse+fallback boilerplate.
2. Follow `quota.ts`'s own established alternate pattern instead (`getPlatformSettingNumber`, quota.ts:85-109, and `getMarkupMultiplier`, quota.ts:324-345) — both bypass `getPlatformSetting` entirely and query `platform_settings` directly via `createAdminSupabase()`, then read `data?.setting_value?.someField` directly since Supabase's JS client already deserializes JSONB columns into JS objects/arrays natively (no manual `JSON.parse` needed at all when querying directly). This is **the cleaner pattern for object-shaped settings** and is already proven in this exact codebase for exactly this kind of data (numeric/object config in `platform_settings`).

Recommend pattern 2 (direct query, object-shaped) for `ai_gateway_routing` and `ai_model_fallbacks` reads — it avoids inventing a third settings-access convention and matches what `quota.ts` already does for structurally similar object-shaped platform config. Reserve `getPlatformSetting`/`setPlatformSetting` for genuinely scalar values (this pattern is what's used for `OPENROUTER_API_KEY`-adjacent settings if a platform-level OpenRouter key row is ever added, matching `gemini_api_key`/`openai_api_key`'s existing shape — though per CONTEXT.md, this phase's `OPENROUTER_API_KEY` is an **env var** in `server/config/index.ts`, not a `platform_settings` row, so this consideration doesn't block Phase 21 directly, only informs the fallback-chain/routing settings' access pattern).

### `event_kind` — Zod enum needs extending (GATE-04's fallback logging)

`generation_logs` table's `event_kind` column is `TEXT` (unconstrained, migration `20260508000000_generation_logs_observability.sql:15`) — no DB migration needed to add a new value. **But** `shared/schema.ts:1058` has:
```typescript
event_kind: z.enum(["text_verification", "caption_quality", "subject_fidelity"]).nullable().optional(),
```
This Zod enum **must be extended** with `"model_fallback"` (additive, per the existing pattern — this schema is used for read-side validation/typing per `GenerationLog`, e.g. in an admin dashboard query, not for insert-side validation, since `observability.service.ts`'s emitters `.insert()` directly via the Supabase admin client without going through this Zod schema). Miss this and any code that reads `generation_logs` rows through `generationLogSchema.parse()`/`.safeParse()` will fail or drop `model_fallback` rows.

### `checkCredits` / POL-01 — exact signature and bug confirmation

```typescript
// server/quota.ts:353-358
export async function checkCredits(
  userId: string,
  operationType: "generate" | "edit" | "transcribe",
  isVideo: boolean = false,
  slideCount?: number,
): Promise<CreditStatus>
```
- `generate.routes.ts:197`: `checkCredits(user.id, "generate", false, parsed.slide_count)` — explicit, correct (single/carousel images are never video via this route... actually `generate.routes.ts` DOES support video content_type; verify at implementation time whether `isVideo` should be threaded here too, or whether this route already branches before reaching this call — not in this phase's scope per REQUIREMENTS.md, POL-01 only names the edit route, but worth a quick sanity check since the same class of bug could theoretically exist elsewhere).
- `edit.routes.ts:182`: `checkCredits(user.id, "edit")` — **the bug**: 3rd arg omitted, defaults to `false`, even though `post.content_type === "video"` is known at this point in the route (checked later at line 234: `const isVideoPost = post.content_type === "video";` — **computed AFTER the credit check**, meaning the fix requires either moving the `isVideoPost` computation earlier in the route, or computing `post.content_type === "video"` inline at the `checkCredits` call site before `isVideoPost` is otherwise assigned). This is the exact code-motion detail the planner needs: **`post.content_type === "video"` is available immediately after the `post` fetch (~line 129-138), well before the current `isVideoPost` assignment at line 234** — so the fix can reference `post.content_type === "video"` directly at the `checkCredits` call site (line 182) without waiting for or duplicating the later `isVideoPost` variable.
- Fallback cost tables (quota.ts:111-136): image edit fallback = `39,000` cost / `117,000` sell micros ($0.039/$0.117); video fallback = `1,200,000` cost / `3,600,000` sell micros ($1.20/$3.60) — a **~30x** difference, confirming the bug's real financial exposure (video edits estimated at image-tier pricing when `isVideo` isn't threaded).

### CRSL2-03 — exact code location and fix shape

`carousel-generation.service.ts:443-509` (the slide loop). Current catch block (lines 503-508):
```typescript
} catch (err: any) {
    const reason = String(err?.message ?? err);
    console.warn(`[carousel] slide ${i + 1} failed:`, reason);
    params.onProgress?.({ type: "slide_failed", slideNumber: i + 1, reason });
    // continue — partial-success contract absorbs this
}
```
This `continue`-by-omission (no `break`/`throw`) applies uniformly to every slide index, including `i === 0`. Downstream, `slide1Succeeded` (set only on success at line 470) is checked post-loop at line 514 (`if (!slide1Succeeded || successfulSlides.length === 0) throw new CarouselFullFailureError(...)`) — so a slide-1 failure **already correctly fails the whole carousel eventually**, but only after the loop has already attempted slides 2..N with `slide1Base64`/`slide1MimeType` still `null` (since they're only assigned inside the `i === 0` success branch, lines 468-469). `generateSlideN` (line 306) unconditionally uses `slide1Base64!`/`slide1MimeType!` (non-null-asserted) as `currentImage` — meaning slides 2..N, when slide 1 failed, call `provider.edit()` with a `data: null!` reference image, which will either throw a confusing runtime error (not the intended `SlideGenerationError`) or (worse) get coerced to a string `"null"` and sent to the OpenRouter/Gemini API as-is. **The fix is a `break` (not `continue`) specifically when `i === 0` fails**, added inside the existing catch block via an `if (i === 0) break;` before/after the `onProgress` emit — small, isolated, matches CONTEXT.md's exact wording ("if slide 1 fails, break immediately").

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `openai` npm package | GATE-01, GATE-03 (chat + transcription via SDK) | Yes (already a dependency) | Installed `6.38.0`; latest on registry `6.48.0` (verified via `npm view openai version`, 2026-07-18) — bump recommended per STACK.md, not required for correctness | N/A — SDK-agnostic `fetch` fallback exists if a bump introduces a breaking change, but no known breaking change between 6.38→6.48 relevant to `chat.completions.create`/`audio.transcriptions.create` |
| Node global `fetch`/`File`/`Blob` | Image API raw calls; transcription multipart construction | Yes — Node 24 (Dockerfile: `node:24-alpine`; `@types/node: 20.19.27` in package.json is a type-defs version, not the runtime) | Node 24 (runtime) | N/A |
| `OPENROUTER_API_KEY` (new env var) | All gateway calls | **Not yet configured** — must be added to `server/config/index.ts` Zod schema (additive, optional like `CRON_SECRET`) and to the actual Coolify/Hetzner deployment env before the gateway can be exercised against the real API | — | Local dev/CI: static/regex-based `verify-phase-21.ts` checks do not require a live key; any live-call smoke test needs the key present and should be skippable/env-flag-gated (mirrors `scripts/verify-cron-jobs.ts`'s `SK_TEST_*`-gated Mode B pattern from Phase 15) |
| OpenRouter API reachability (network) | Any live verification during implementation/testing | Not verified in this research pass (no API key available to this research session) — all shapes above are documented/live-doc-verified, not live-response-verified against a real key | — | If live verification is needed during planning/implementation and no key is available yet, treat the documented shapes as HIGH confidence (2 independent official sources agree) but flag any live-call task as blocked until `OPENROUTER_API_KEY` is provisioned |

**Missing dependencies with no fallback:**
- `OPENROUTER_API_KEY` — the phase cannot be functionally verified end-to-end (live smoke test) without this; static verification (`verify-phase-21.ts` regex/structural checks) can proceed without it.

**Missing dependencies with fallback:**
- None blocking for the static-verification-first approach this codebase already uses (see Validation Architecture below).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-vendor model routing/fallback | A custom provider-class-per-vendor abstraction on top of OpenRouter | `platform_settings.ai_model_fallbacks` + a simple ordered-array retry loop in `ai-gateway.service.ts` | OpenRouter already IS the multi-vendor router (ARCHITECTURE.md Anti-Pattern 1) — a second abstraction layer adds indirection with no behavioral value |
| Real-cost billing computation | Reconstructing cost from a static per-model/per-token price table for gateway calls | `usage.cost` (confirmed present on chat/image/transcription responses) → `Math.round(cost * 1_000_000)` micros | OpenRouter's routing/pricing decisions (provider chosen, cache discounts, BYOK) aren't reconstructable client-side; the authoritative number is in the response |
| JSON-object platform settings access | A new bespoke settings-object caching/parsing layer | `quota.ts`'s existing direct-query pattern (`getPlatformSettingNumber`/`getMarkupMultiplier`) — Supabase JS client auto-deserializes JSONB | Codebase already has 2 proven examples of this exact pattern for object-shaped `platform_settings` rows |
| Fallback-chain retry logic | A generic retry/circuit-breaker library | A simple `for` loop over the ordered fallback array, first success wins, one pass (per CONTEXT.md's locked design) | The requirement is explicitly "one pass through the chain," not exponential backoff or circuit-breaking — matches the existing single-retry pattern already used for 429s (`carousel-generation.service.ts:331-354`) |

## Common Pitfalls

(See `.planning/research/PITFALLS.md` for the full milestone-level list — Pitfalls 1-3, 6, 12 are P0/this-phase-relevant. Below are refinements/corrections found during this phase's live verification, plus phase-specific additions not covered at milestone granularity.)

### Refinement to Pitfall 9 (structured outputs silently ignored)

Milestone PITFALLS.md states structured-output/provider-param unsupported-model requests are "silently ignored, not rejected." **This phase's live re-check of `openrouter.ai/docs/features/structured-outputs` found current docs stating the opposite for `response_format: json_schema` specifically**: *"The request will fail with an error indicating lack of support"* when the selected model doesn't support structured outputs — not a silent pass-through. This is a **documentation-stated behavior**, not independently live-tested by this research pass (no API key available), so treat as MEDIUM confidence — but it means the runtime-assertion backstop PITFALLS.md recommends (Pitfall 9's "How to avoid") is still good defensive practice, just less likely to be the *only* line of defense than the milestone research assumed. This mostly matters for Phase 22 (planning-call `json_schema` adoption), not Phase 21 directly, since GATE-01 doesn't lock in `json_schema` usage this phase (PLAN-02 does, next phase) — but the gateway's chat-completion wrapper should still surface the OpenRouter error message verbatim on failure (not swallow it), since Phase 22 will depend on that error being visible.

### New Pitfall: `input_references` shape mismatch will silently corrupt reference images if not adapted

The codebase's `ReferenceImage` type (`{ mimeType, data }`, bare base64) does not match OpenRouter's `input_references` shape (`{ type: "image_url", image_url: { url: "data:..." } }`). If the gateway's image-call adapter naively passes the existing `ReferenceImage[]` array through, brand reference photos and carousel slide-1-as-reference calls will send malformed reference data — OpenRouter will likely either reject the request (400) or silently ignore unrecognized reference entries, producing an image generated without the intended reference, which looks like a "the model ignored my reference image" quality bug rather than an obvious wiring error. **This is exactly the kind of silent quality regression the milestone's "do not regress image quality" priority (CONTEXT.md §specifics) warns about.** Verification: a task/test should assert the adapter function's output shape matches `{ type: "image_url", image_url: { url } }` before any live-call testing, and a manual QA pass comparing a reference-image generation before/after the gateway migration is worth flagging as a verification step (not just static checks) given this is exactly the kind of thing static regex checks can't catch.

### New Pitfall: `checkCredits`'s `isVideo` computation ordering in `edit.routes.ts`

As detailed above, `post.content_type === "video"` is available early in the route (right after the `post` fetch) but the existing `isVideoPost` variable is computed later (line 234), after the credit check (line 182). A naive fix that adds `isVideoPost` as the 3rd arg to `checkCredits` without moving/duplicating the computation will hit a "used before declared" TypeScript error or require hoisting — small, but worth flagging so the task is scoped as "add an early `const isVideo = post.content_type === "video"` computation and use it both at the credit-check call site and later" rather than "just add a 3rd argument," which undersells the actual code change needed.

## Code Examples

### Gateway image call — request construction (adapter from existing `ReferenceImage` shape)

```typescript
// server/services/ai-gateway.service.ts (illustrative — exact naming is discretion)
function toOpenRouterInputReference(ref: ReferenceImage) {
  return {
    type: "image_url" as const,
    image_url: { url: `data:${ref.mimeType};base64,${ref.data}` },
  };
}

export async function generateImage(params: {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  referenceImages?: ReferenceImage[];
}): Promise<ImageProviderResult & { costUsdMicros?: number }> {
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${params.apiKey}`,
      "HTTP-Referer": "https://xareable.com",
      "X-Title": "Xareable",
    },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      input_references: params.referenceImages?.map(toOpenRouterInputReference),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // Source: openrouter.ai/docs error shape — { error: { code, message, metadata } }
    throw new Error(`OpenRouter image generation failed: ${response.status} - ${body?.error?.message ?? "unknown"}`);
  }

  const data = await response.json();
  const image = data?.data?.[0];
  if (!image?.b64_json) {
    throw new Error("OpenRouter image response contained no image data");
  }

  return {
    buffer: Buffer.from(image.b64_json, "base64"),
    mimeType: image.media_type || "image/png",
    model: params.model,
    costUsdMicros: typeof data?.usage?.cost === "number" ? Math.round(data.usage.cost * 1_000_000) : undefined,
  };
}
```
Source: request/response shapes verified 2026-07-18 against `openrouter.ai/blog/announcements/image-api/` and `github.com/OpenRouterTeam/skills/skills/openrouter-images/` (SKILL.md + scripts/generate.ts + scripts/lib.js).

### Fallback chain — one-pass retry (matches existing 429 single-retry style)

```typescript
// Illustrative — matches carousel-generation.service.ts:331-354's existing retry shape
async function callWithFallback<T>(
  slugs: string[],
  callFn: (model: string) => Promise<T>,
): Promise<{ result: T; modelUsed: string; fellBack: boolean }> {
  let lastError: unknown;
  for (let i = 0; i < slugs.length; i++) {
    try {
      const result = await callFn(slugs[i]);
      if (i > 0) {
        // log to generation_logs: event_kind "model_fallback", metadata { from: slugs[0], to: slugs[i], reason: String(lastError) }
      }
      return { result, modelUsed: slugs[i], fellBack: i > 0 };
    } catch (err: any) {
      const isFallbackWorthy = /\b(404|410|5\d\d|model_not_found)\b/i.test(String(err?.message ?? err));
      if (!isFallbackWorthy || i === slugs.length - 1) throw err;
      lastError = err;
    }
  }
  throw lastError; // unreachable if slugs.length > 0
}
```

## Open Questions

1. **Should `generate.routes.ts`'s `checkCredits` call also receive a more careful `isVideo` audit, beyond `edit.routes.ts`?**
   - What we know: `generate.routes.ts:197` already passes `isVideo` explicitly (`false`, hardcoded for the non-carousel/non-video branches read so far).
   - What's unclear: whether every branch of `generate.routes.ts` that can produce `content_type: "video"` correctly threads `isVideo` into its `checkCredits` call, or whether a similar latent bug exists there too.
   - Recommendation: out of POL-01's stated scope (which only names the edit route) — flag as a quick sanity-check task, not a required fix, unless the planner's own read of `generate.routes.ts` in full surfaces a second instance of the same bug class.

2. **Exact transport for `transcribe()` — SDK multipart `File` vs raw-fetch JSON `input_audio`?**
   - What we know: both are documented, OpenAI-SDK-compatible, and return the same `usage.cost`-bearing shape.
   - What's unclear: which is less code / more reliable given the existing `audioData` (base64 string) + `mimeType` input shape from `transcribe.routes.ts`.
   - Recommendation: default to constructing a Node `File` (matches CONTEXT.md's "use the openai SDK" framing most literally), but treat the raw-fetch JSON path as an acceptable Claude's-discretion swap if `File` construction proves awkward in practice — both satisfy GATE-03.

3. **Does `ai_model_fallbacks`/`ai_gateway_routing` need a settings-cache TTL, or is uncached-per-request (like `getStyleCatalogPayload`/`getPlatformSetting`) acceptable?**
   - What we know: `getStyleCatalogPayload()` (style-catalog.routes.ts:17) and `getPlatformSetting()` (app-settings.service.ts:187) both hit the DB fresh on every call, no cache — this is the existing precedent for "admin changes take effect without restart." `quota.ts`'s own `getPlatformSettingNumber` DOES cache (60s TTL) but that's a different helper for a different setting family (pricing).
   - What's unclear: whether per-request DB reads for routing/fallback settings (called on every single generate/edit/carousel/enhance/transcribe request) introduce meaningful latency at current traffic levels.
   - Recommendation: match `getPlatformSetting`'s no-cache precedent for consistency and correctness-first (admin toggles a rollback switch expecting IMMEDIATE effect — GATE-07's entire value proposition is "without a deploy," and a stale cache would undermine emergency-rollback response time). If latency becomes a concern later, add a short TTL cache as a follow-up, not a day-one requirement.

## Validation Architecture

Nyquist validation is enabled for this project (`.planning/config.json` has no `workflow.nyquist_validation` key — treated as enabled per default). This project has **no formal test framework** (no jest/vitest/mocha in `package.json`; `npm run check` is `tsc` type-checking only). The established validation pattern across Phases 5-20 is a **custom static + functional verification harness** per phase: `scripts/verify-phase-{N}.ts`, run via `npx tsx scripts/verify-phase-{N}.ts`, using regex/string-matching against source file contents (see `scripts/verify-phase-12.ts`, read in full above, as the closest analog — same domain, image-provider abstraction). Some harnesses also `spawnSync` a small standalone functional test script (e.g. `scripts/test-openai-converter.ts`) for logic that can't be verified by regex alone.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None (no jest/vitest) — custom `tsx`-executed static/functional verification scripts, project-established pattern |
| Config file | None — each `scripts/verify-phase-{N}.ts` is self-contained |
| Quick run command | `npx tsx scripts/verify-phase-21.ts` |
| Full suite command | Same — this project has no separate "full suite"; `npm run check` (tsc) should also be run as a compile-gate alongside the verify script |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-01 | 5 raw-fetch text call sites migrated to gateway | static (regex: zero `generativelanguage.googleapis.com` in the 4 migrated files + `transcribe.routes.ts`; gateway import present) | `npx tsx scripts/verify-phase-21.ts` | ❌ Wave 0 — create `verify-phase-21.ts` |
| GATE-02 | Image gen/edit via dedicated Image API, `ImageProvider` interface unchanged | static (regex: `OpenRouterImageProvider` implements `ImageProvider`; fetch target is `openrouter.ai/api/v1/images`; `aspect_ratio`/`resolution` passed top-level) + functional (small script instantiating the adapter function with a fixture `ReferenceImage`, asserting output shape `{type: "image_url", image_url: {url}}`) | `npx tsx scripts/verify-phase-21.ts` (static) + a small `scripts/test-openrouter-image-adapter.ts` (functional, no network) mirroring `test-openai-converter.ts`'s pattern | ❌ Wave 0 |
| GATE-03 | Transcription via gateway | static (regex: `transcribe.routes.ts` no longer contains `generativelanguage.googleapis.com`; gateway `transcribe()` call present) | `npx tsx scripts/verify-phase-21.ts` | ❌ Wave 0 |
| GATE-04 | Fallback chain engages on simulated 404/deprecation; logged to `generation_logs` | static (config read path exists, `event_kind` Zod enum includes `model_fallback`) + **manual/live** (simulate a bad model slug against the real API — requires `OPENROUTER_API_KEY`; not CI-blocking per CONTEXT.md's GATE-08 precedent of gating live checks behind an env flag) | `npx tsx scripts/verify-phase-21.ts` (static) + manual live check (documented steps, run once during implementation, not automated) | ❌ Wave 0 (static); live check has no file — manual runbook step |
| GATE-05 | Real cost flows into billing; estimate + actual both in metadata | static (regex: `recordUsageEvent` signature has 6th param; call sites pass `costUsdMicros` from gateway responses) | `npx tsx scripts/verify-phase-21.ts` | ❌ Wave 0 |
| GATE-07 | Rollback switch works per call class | static (settings read path branches `openrouter`/`direct` per call class) + **manual** (toggle the setting in a test env, confirm a generation actually uses the direct path — genuinely requires exercising both paths, hard to fully automate without 2 live API keys) | `npx tsx scripts/verify-phase-21.ts` (static) + manual toggle-and-observe step | ❌ Wave 0 (static) |
| GATE-08 | Video pipeline untouched | static (regex: `video-generation.service.ts` has zero OpenRouter references, still targets `generativelanguage.googleapis.com`; no `?key=` anywhere in `server/`) | `npx tsx scripts/verify-phase-21.ts` | ❌ Wave 0 |
| POL-01 | `isVideo` threaded into edit credit check | static (regex: `checkCredits(user.id, "edit", ` followed by a video-content-type expression, not a bare `checkCredits(user.id, "edit")` call) | `npx tsx scripts/verify-phase-21.ts` | ❌ Wave 0 |
| POL-07 | Zero `?key=` in server/ | static (regex over all `server/**/*.ts`: no `[?&]key=` in a URL-construction context) | `npx tsx scripts/verify-phase-21.ts` | ❌ Wave 0 (same check as GATE-08's `?key=` assertion — can be one shared check) |
| CRSL2-03 | Slide-1 failure breaks the loop immediately | static (regex: an `if (i === 0)` + `break` inside the catch block in `carousel-generation.service.ts`) + functional (mock `imageProvider.generate()` to reject on the first call, run `generateCarousel()` with a stub Supabase admin client, assert `successfulSlides.length === 0` and no `imageProvider.edit()` call was made — i.e., slide 2 was never attempted) | `npx tsx scripts/verify-phase-21.ts` (static) + a small functional script (mirrors `test-openai-converter.ts`'s pattern of a standalone invocation test, since this is a case where regex alone can't prove the *behavior*, only the code shape) | ❌ Wave 0 — the functional test needs a stub/mock harness for `generateCarousel`'s Supabase + provider dependencies (not present today; this is the one genuinely non-trivial test-infrastructure gap in this phase) |

### Sampling Rate

- **Per task commit:** `npx tsx scripts/verify-phase-21.ts` (fast, no network, seconds) + `npm run check` (tsc compile gate)
- **Per wave merge:** Same command, plus the standalone functional scripts (`test-openrouter-image-adapter.ts`, the carousel slide-1-break functional test) if created
- **Phase gate:** Full `verify-phase-21.ts` green + `npm run check` exits 0 + the two manual/live steps (GATE-04 fallback simulation, GATE-07 rollback toggle) executed at least once and documented (mirrors Phase 15's `verify-cron-jobs.ts` "Mode B" live-path pattern) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `scripts/verify-phase-21.ts` — does not exist yet; needs creation following the `verify-phase-12.ts` pattern (regex checks against file contents, `check(name, cond, detail)` helper, exit 1 on any failure)
- [ ] `scripts/test-openrouter-image-adapter.ts` — small functional script (no network) asserting the `ReferenceImage → input_references` adapter shape, mirrors `scripts/test-openai-converter.ts`'s existing pattern
- [ ] A functional/mock harness for `generateCarousel()`'s slide-1-break behavior — this is the one gap requiring new test infrastructure (a way to stub `ImageProvider` + the Supabase admin client so the carousel service's loop logic can be exercised without hitting real APIs/DB). No existing fixture for this in the repo; the closest precedent is `scripts/test-openai-converter.ts` (pure-function testing, no I/O) — carousel's loop test will need actual dependency injection/stubbing since `generateCarousel` calls `createAdminSupabase()` internally rather than receiving it as a param. Flag this as a real Wave 0 task, not a trivial one — it may require a small refactor (accept an optional injected Supabase client for testability) or accepting a lighter-weight static-only check (regex-verify the `if (i===0) break` code shape, skip the full behavioral test) if dependency injection is out of scope for this phase.

## Sources

### Primary (HIGH confidence)
- Codebase (read in full, this research pass): `server/services/gemini.service.ts`, `image-provider.ts`, `carousel-generation.service.ts`, `caption-quality.service.ts`, `enhancement.service.ts`, `image-generation.service.ts`, `text-rendering.service.ts`, `video-generation.service.ts`, `quota.ts`, `app-settings.service.ts`, `config/index.ts`, `middleware/auth.middleware.ts`, `routes/edit.routes.ts`, `routes/transcribe.routes.ts`, `routes/generate.routes.ts` (partial), `routes/carousel.routes.ts` (partial), `observability.service.ts`, `style-catalog.routes.ts`, `shared/schema.ts` (partial), `package.json`, `Dockerfile`, `scripts/verify-phase-12.ts`, `supabase/migrations/20260508000000_generation_logs_observability.sql`
- `openrouter.ai/blog/announcements/image-api/` — request/response example, live-fetched 2026-07-18
- `github.com/OpenRouterTeam/skills/skills/openrouter-images/` (SKILL.md, scripts/generate.ts, scripts/lib.js references) — official OpenRouter-maintained reference implementation, live-fetched 2026-07-18
- `openrouter.ai/docs/guides/overview/multimodal/image-generation` — request/response fields, live-fetched 2026-07-18
- `openrouter.ai/docs/features/structured-outputs` — unsupported-model failure behavior, live-fetched 2026-07-18
- `openrouter.ai/docs/guides/overview/multimodal/stt` — transcription request/response shape + SDK compatibility code sample, live-fetched 2026-07-18
- `npm view openai version` / `npm view openai versions` — registry query, 2026-07-18: latest `6.48.0`, installed `6.38.0`

### Secondary (MEDIUM confidence)
- OpenRouter error-response shapes (404/400/429) — live-fetched from a docs errors page, single-source (not cross-verified against a second independent source this pass); mechanically consistent with the milestone research's PITFALLS.md fallback-trigger design, but no live API call was made against a real deprecated model slug to confirm the exact shape end-to-end.
- `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md` — milestone-level research, dated same day (2026-07-18), treated as current; this document supersedes their Image API confidence level (MEDIUM → HIGH) but otherwise defers to their findings.

### Tertiary (LOW confidence)
- None flagged new to this research pass beyond what STACK.md already flags (Chirp 3 exact slug string, BYOK-on-Image-API coverage — both out of scope for Phase 21 per CONTEXT.md's deferrals).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — reuses milestone STACK.md findings verbatim, no changes needed for this phase's scope
- Architecture: HIGH — every call site, line number, and current behavior grounded in a direct read of the actual current codebase this session
- Image API shape (the phase's flagged research gap): HIGH — cross-verified across 2 independent official sources (OpenRouter blog + OpenRouterTeam GitHub skills repo) plus the docs guide; upgraded from milestone research's MEDIUM
- Pitfalls: HIGH for codebase-specific findings (POL-01 bug mechanics, CRSL2-03 code path, `input_references` adapter gap); MEDIUM for the structured-outputs-failure-mode refinement (single live-doc source, not independently cross-verified)
- Validation architecture: HIGH for the test-framework/pattern identification (directly matches existing `verify-phase-12.ts`); MEDIUM for the CRSL2-03 functional-test feasibility (identified a real gap — `generateCarousel` isn't currently dependency-injectable for testing — which the planner must explicitly decide how to handle)

**Research date:** 2026-07-18
**Valid until:** 14 days (OpenRouter's Image API is ~4 weeks old at milestone-research time per STACK.md; treat as a fast-moving surface until it's been stable in production for a full quarter — re-verify request/response shape if implementation is delayed beyond 2 weeks from this research date)
