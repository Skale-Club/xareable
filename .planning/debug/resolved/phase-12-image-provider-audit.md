---
status: resolved
trigger: "phase-12-image-provider-audit — proactive code review of Phase 12 + 12.1"
created: 2026-05-17T00:00:00Z
updated: 2026-05-17T11:00:00Z
resolution: "1 BLOCKER + 5 WARNINGs fixed; note #7 (provider-aware pricing) deferred; verify extended 36→43 checks, all green."
---

## Current Focus

hypothesis: CONFIRMED — 8 areas investigated; multiple findings of varying severity
test: Complete static code audit of all touched files
expecting: N/A — audit complete
next_action: Return findings to user for prioritization

## Symptoms

expected: All 4 image flows work end-to-end on both providers; per-user preference overrides global correctly; no orphaned code; types sound; error paths symmetric; verify script catches regressions
actual: Unknown — proactive audit
errors: None reported. npm run check and verify script pass.
reproduction: N/A — code review

## Eliminated

(none — audit mode, not reactive)

## Evidence

- timestamp: 2026-05-17
  checked: server/services/image-provider.ts
  found: @ts-ignore on sharp import (line 96); two `as any` casts on responses.create calls (lines 202, 233); extractResponseImage uses `any` throughout
  implication: #1 area finding — partially unsafe but pattern is documented

- timestamp: 2026-05-17
  checked: generate.routes.ts + edit.routes.ts + carousel.routes.ts + enhance.routes.ts profile SELECT queries
  found: All 4 routes do a secondary profile fetch with explicit column list that omits `image_provider`. generate and edit use "is_admin, is_affiliate, api_key, openai_api_key"; carousel and enhance use "is_admin, is_affiliate, is_business, api_key, openai_api_key"
  implication: BLOCKER — profile.image_provider is always undefined in getActiveImageProvider(); 12.1 per-user override is silently dead for all flows

- timestamp: 2026-05-17
  checked: server/services/image-provider.ts generateSlideOne / generateSlideNWithSignature / generateSlideNFallbackSingleTurn in carousel-generation.service.ts
  found: slide1ThoughtSignature is always null (set from result.thoughtSignature which is always null — provider abstraction doesn't propagate thoughtSignature). The multi-turn signature path (lines 500-520) will never execute; always falls through to single-turn fallback. generateSlideNWithSignature function signature still takes slide1ThoughtSignature param but doesn't use it.
  implication: WARNING — functionally not broken (fallback works), but dead code branch and misleading naming

- timestamp: 2026-05-17
  checked: server/quota.ts calculateCostMicros
  found: Single token-pricing path for both Gemini and OpenAI. OpenAI token usage (input/output tokens from Responses API) is recorded and priced identically to Gemini tokens. No provider-aware pricing multiplier.
  implication: NOTE — may under/over-charge for OpenAI depending on actual token costs; flagged per checklist

- timestamp: 2026-05-17
  checked: admin.routes.ts PATCH /api/admin/image-provider
  found: Correctly writes to platform_settings (not profiles). Properly scoped.
  implication: No issue — area 5b confirmed correct

- timestamp: 2026-05-17
  checked: resolveImageProviderName regular-user path (image-provider.ts line 269)
  found: Gate checks profile.is_admin === true || profile.is_affiliate === true before reading profile.image_provider. Regular users cannot trigger the per-user path regardless of profile.image_provider value.
  implication: No issue — area 5c confirmed correct

- timestamp: 2026-05-17
  checked: scripts/verify-phase-12.ts
  found: Zero 12.1-specific checks. No checks for: profiles.image_provider migration, profileSchema.image_provider field, resolveImageProviderName export, factory accepting profile, routes passing profile to factory, or settings.tsx RadioGroup with 3 options.
  implication: WARNING — verify script gives false confidence that 12.1 is regression-proof

- timestamp: 2026-05-17
  checked: carousel-generation.service.ts and enhancement.service.ts for dead/orphaned code
  found: callEnhancementImageModel deleted cleanly (confirmed absent). image-generation.service.ts still imported from image-provider.ts (GeminiImageProvider uses it — correct) and from text-rendering.service.ts (exact-text repair — correct). No orphaned route-level direct Gemini image calls.
  implication: No orphaned code issue

- timestamp: 2026-05-17
  checked: client/src/lib/translations.ts for Phase 12/12.1 strings
  found: None of the new strings added in settings.tsx (AI Image Provider, Use platform default, Gemini, OpenAI (gpt-image-2), Save Provider Preference, Failed to save image provider preference, Image provider preference saved, Choose which provider generates your images...) or admin ImageProviderSection appear in translations.ts. Also: Save OpenAI Key, OpenAI API Key, Required when AI Image Provider is set to OpenAI are untranslated.
  implication: NOTE — English-only for PT/ES users; consistent with the pattern of not translating admin/power-user strings, but should be flagged

- timestamp: 2026-05-17
  checked: client/src/components/admin/image-provider-section.tsx useState initialization
  found: const [selected, setSelected] = useState<ProviderName>(current) where current = data?.provider ?? "gemini". useState only captures the initial value at mount. data is undefined on mount (async query). So selected always starts as "gemini" regardless of actual global setting. The button is disabled when selected === current, so if global is "openai", button is always enabled and user sees "gemini" pre-selected even though "openai" is active.
  implication: WARNING — admin UI shows wrong pre-selected value; user must manually re-select the already-active provider before saving, which is confusing

- timestamp: 2026-05-17
  checked: OpenAI error messages in image-provider.ts
  found: Gemini errors surface via image-generation.service.ts which throws with "Image Generation Error: ..." prefix. OpenAI generate() wraps as "Image Generation Error: {msg}" (line 207) and edit() wraps as "Image Edit Error: {msg}" (line 237). Prefix is slightly different between generate and edit paths. Gemini editImage throws its own prefix. Routes treat all of these as generic errors and log/forward the message.
  implication: WARNING — minor asymmetry between generate ("Image Generation Error") and edit ("Image Edit Error") prefixes in OpenAI path. The edit.routes.ts error classifier at line 634 matches `lower.includes("image generation")` which will NOT match "Image Edit Error" — edit-path OpenAI errors are classified as "unknown" instead of "image_generation"

## Resolution

root_cause: Multiple findings — see AUDIT REPORT section
fix: N/A — investigation only
verification: N/A
files_changed: []

---

## AUDIT REPORT

### Area 1 — Untyped/unsafe casts

**File:** `server/services/image-provider.ts`

| Location | Pattern | Notes |
|----------|---------|-------|
| Line 96 | `// @ts-ignore` on sharp import | Documented pattern; mirrors image-generation.service.ts |
| Line 139 | `extractResponseImage(response: any)` | Full function param typed as any; all internal accesses also any |
| Lines 188, 217 | `inputContent: any[]` | Content array is any[] |
| Lines 202, 233 | `} as any` on `responses.create(...)` | Bypasses SDK type check for `tools` shape |

**File:** `server/routes/carousel.routes.ts`

| Line 298 | `brand as any` | Brand type mismatch between shared schema and Supabase return type |

**Verdict:** 🟡 **WARNING**. The `as any` casts on `responses.create` and `extractResponseImage` are the most risky — if the Responses API shape changes, TypeScript will not catch it. The `extractResponseImage` function in particular accesses multiple nested fields without type safety.

---

### Area 2 — Error-handling symmetry

**Gemini path** (via `image-generation.service.ts`):
- `generateImage` throws errors with prefix: `"Image Generation Error: {msg}"`
- `editImage` throws errors with prefix: `"Image Edit Error: {msg}"`

**OpenAI path** (in `image-provider.ts`):
- `generate()` wraps as: `"Image Generation Error: {msg}"` — MATCHES Gemini generate prefix
- `edit()` wraps as: `"Image Edit Error: {msg}"` — MATCHES Gemini edit prefix

**Route classification** (`edit.routes.ts` line 632-641):
```ts
lower.includes("image generation") → "image_generation"
lower.includes("upload")           → "upload"
```
`"Image Edit Error"` does NOT contain `"image generation"` so OpenAI edit errors are classified as `"unknown"` in `generation_logs`, not `"image_generation"`.

**Missing-key errors**: Both providers return a clear error before any API call (`"OpenAI API key is required"` / `"Admin and affiliate accounts must configure their own OpenAI API key in Settings"`). These reach the route's SSE error handler correctly.

**4xx/5xx surfacing**: Both providers wrap HTTP errors inside a standard JS Error and re-throw. Routes catch these and forward via `sse.sendError()`. Symmetric.

**Verdict:** 🟡 **WARNING** — Edit-path OpenAI errors are misclassified in `generation_logs` as "unknown" instead of "image_generation". Low impact (logging only) but makes analytics/alerting on edit failures less reliable.

---

### Area 3 — Carousel slide-1-as-reference for OpenAI

**(a) Slide-1 buffer conversion:**
`generateSlideOne` returns `result.buffer` (raw PNG Buffer) and `result.mimeType` ("image/png" for OpenAI). The main loop captures `rawBase64 = result.buffer.toString("base64")` and `mimeType = result.mimeType`. `generateSlideNWithSignature` / `generateSlideNFallbackSingleTurn` construct `slide1Image: ReferenceImage = { mimeType: slide1MimeType, data: slide1Base64 }` and pass it as `currentImage` to `provider.edit()`. OpenAI's `edit()` calls `normalizeForOpenAI(input.currentImage)` which handles PNG/JPEG/WEBP passthrough. **Correct.**

**(b) shared_style in prompt:**
Both `generateSlideNWithSignature` and `generateSlideNFallbackSingleTurn` prepend `plan.shared_style` to the prompt: `` `${plan.shared_style}\n\n${plan.slides[slideIndex].image_prompt}` ``. **Correct** — OpenAI gets the same style instructions as Gemini.

**(c) Partial-success contract on per-slide OpenAI error:**
OpenAI errors from `provider.edit()` bubble as a standard Error. `runSlideWithRetry` retries on 429/RESOURCE_EXHAUSTED pattern. Other errors propagate to the `catch (err)` at carousel loop line 571, which logs and calls `onProgress({type: "slide_failed"})`, then `continue`s. **Correct** — partial success works identically for both providers.

**(d) ThoughtSignature dead branch:**
`generateSlideOne` sets `thoughtSignature: null` always (code comment confirms this). In the main loop, `slide1ThoughtSignature` is always null, so the multi-turn branch (lines 500-519) that calls `generateSlideNWithSignature` is **never entered**. The fallback is always used. The `slide1ThoughtSignature` parameter in `generateSlideNWithSignature`'s signature is accepted but never read.

**Verdict:** 🟡 **WARNING** on the thoughtSignature dead branch — functionally OK (fallback path works correctly for both providers) but the multi-turn code path is dead and the parameter name is misleading. Future maintainers may think multi-turn with signature is active.

---

### Area 4 — Credit/billing accounting

`recordUsageEvent` in `quota.ts` uses a single `calculateCostMicros` function driven by token counts from the `usage` field of `ImageProviderResult`. The `usage` field maps:
- Gemini: `promptTokenCount` / `candidatesTokenCount` — actual Gemini token counts
- OpenAI: `input_tokens` / `output_tokens` from the Responses API usage field

Both are fed into the same `token_pricing_image_input` / `token_pricing_image_output` pricing rates (stored in `platform_settings`). No provider-aware multiplier exists.

OpenAI gpt-image-2 pricing is approximately $0.21/image (high quality) to $0.05/image (low quality) flat — NOT token-based. The Responses API usage tokens measure the wrapper LLM cost (gpt-5.5), not the image generation cost directly. This means billing will likely under-charge for OpenAI images unless the admin configures image_output token pricing to match gpt-image-2 flat cost.

**Verdict:** 🔵 **NOTE** — Not a code bug; the platform's configurable pricing rates can be adjusted by admin. However, there is no documentation or UI hint that different rate calibration is needed when switching to OpenAI. No automatic provider-aware pricing adjustment exists.

---

### Area 5 — Per-user vs global setting precedence

**(a) All 4 routes pass profile to factory?**

| Route | Profile variable | Columns selected | image_provider included? |
|-------|-----------------|-----------------|--------------------------|
| generate.routes.ts | `profile` (line 184 second fetch) | `is_admin, is_affiliate, api_key, openai_api_key` | **NO** |
| edit.routes.ts | `editProfile` (line 136) | `is_admin, is_affiliate, api_key, openai_api_key` | **NO** |
| carousel.routes.ts | `profile` (line 107) | `is_admin, is_affiliate, is_business, api_key, openai_api_key` | **NO** |
| enhance.routes.ts | `profile` (line 105) | `is_admin, is_affiliate, is_business, api_key, openai_api_key` | **NO** |

All 4 routes pass their respective profile to `getActiveImageProvider(profile)`. The factory correctly reads `profile.image_provider`. **However**, the profile objects passed in all 4 routes are fetched with narrow column selects that omit `image_provider`. The column is therefore always `undefined` at runtime.

`resolveImageProviderName` checks `profile.image_provider` — which is `undefined` — and treats it as falsy, falling through to the global platform_settings. **The Phase 12.1 per-user override is silently non-functional for all 4 flows.**

**(b) Admin PATCH writes to platform_settings?**
`admin.routes.ts` line 1906: `await setPlatformSetting("image_provider", provider)`. **Correct** — global only.

**(c) Regular-user case ignores profile.image_provider?**
`resolveImageProviderName` line 269: guards with `profile.is_admin === true || profile.is_affiliate === true`. **Correct** — regular users cannot trigger per-user override.

**Verdict:** 🔴 **BLOCKER** — The `image_provider` column is never selected from the database in any of the 4 generation routes. `profile.image_provider` is always `undefined`. The Phase 12.1 admin/affiliate per-user provider preference feature is completely non-functional despite the DB column, migration, schema type, and UI all being in place.

**Fix needed:** Add `image_provider` to the SELECT column list in all 4 routes' profile fetch queries (or use `select("*")`).

---

### Area 6 — verify-phase-12.ts coverage of 12.1 paths

The verify script (97 lines) covers PROV-01 through PROV-07 only. Phase 12.1 shipped in commit 3a4c2bc after the verify script was written. **Zero 12.1 checks exist.**

Missing checks:

| Check | What to test |
|-------|-------------|
| 12.1-A | Migration `20260517100000_profiles_image_provider.sql` exists and contains `ADD COLUMN IF NOT EXISTS image_provider` |
| 12.1-B | `profileSchema` in `shared/schema.ts` has `image_provider: z.enum(["gemini", "openai"]).nullable().optional()` |
| 12.1-C | `resolveImageProviderName` is exported from `image-provider.ts` |
| 12.1-D | `getActiveImageProvider` accepts optional profile parameter |
| 12.1-E | All 4 routes' profile SELECT includes `image_provider` column (**this check would have caught the blocker above**) |
| 12.1-F | `settings.tsx` has `radiogroup-image-provider-pref` testid (3-option RadioGroup with global/gemini/openai values) |
| 12.1-G | `handleSaveImageProviderPref` writes `null` to DB when "global" selected |

**Verdict:** 🟡 **WARNING** — Verify script gives false confidence on 12.1. Check 12.1-E would have caught the BLOCKER in Area 5. Recommend adding all 7 checks above.

---

### Area 7 — Orphaned/dead code

**carousel-generation.service.ts:**
- `generateSlideOne`, `generateSlideNWithSignature`, `generateSlideNFallbackSingleTurn`: still present and actively used (not orphaned). `generateSlideNWithSignature` receives `slide1ThoughtSignature` param it never uses — this is dead parameter, not dead function.
- `uploadFile` imported at top and used via the `void uploadFile` retain-reference at line 672. The comment explains why — this is intentional, not dead code.
- `GEMINI_BASE` and `IMAGE_MODEL` constants are still present (lines 25-26) but are no longer used for image generation (only `TEXT_MODEL` + `GEMINI_BASE` are used in `callCarouselTextPlan`). `IMAGE_MODEL` is referenced only in the result `imageModel` field at line 663. Minor dead constant.

**enhancement.service.ts:**
- `callEnhancementImageModel` was deleted cleanly — confirmed absent. No orphaned reference.
- `TEXT_MODEL`, `IMAGE_MODEL`, `GEMINI_BASE` constants: all three remain. `TEXT_MODEL` and `GEMINI_BASE` are used in `runPreScreen` and `generateEnhancementCaption`. `IMAGE_MODEL` is used only in the result `imageModel` field at line 644. Same minor dead constant issue as carousel.

**image-generation.service.ts:**
- Still imported from `image-provider.ts` (GeminiImageProvider uses `generateImage` and `editImage` — legitimate).
- Still imported from `text-rendering.service.ts` (exact-text repair — legitimate).
- No duplicate paths.

**Verdict:** 🟡 **WARNING** — Minor: `IMAGE_MODEL` constant is defined in both carousel and enhancement services but is only used in a string interpolation for the result metadata field, not for any actual model call. This is cosmetically misleading (suggests direct Gemini image calls) but not a runtime bug. The dead `slide1ThoughtSignature` parameter in `generateSlideNWithSignature` is also misleading.

---

### Area 8 — i18n strings

**settings.tsx new strings (Phase 12 / 12.1) — NOT in translations.ts:**

| String | Location |
|--------|----------|
| `"AI Image Provider"` (CardTitle) | settings.tsx line 521 |
| `"Choose which provider generates your images. Leave on 'Use platform default' to follow the global admin setting."` | settings.tsx line 523 |
| `"Use platform default"` | settings.tsx line 535 |
| `"Gemini"` | settings.tsx line 541 |
| `"OpenAI (gpt-image-2)"` | settings.tsx line 546 |
| `"Save Provider Preference"` | settings.tsx line 563 |
| `"Image provider preference saved"` | toast, line 317 |
| `"Failed to save image provider preference"` | toast, line 312 |
| `"OpenAI API Key"` (CardTitle) | settings.tsx line 484 |
| `"Required when AI Image Provider is set to OpenAI"` | settings.tsx line 486 |
| `"OpenAI API Key"` (Label) | settings.tsx line 491 |
| `"Save OpenAI Key"` | settings.tsx line 512 |
| `"OpenAI API Key saved"` | settings.tsx line 299 (toast) |
| `"Failed to save OpenAI API key"` | settings.tsx line 294 (toast) |

**admin ImageProviderSection strings — NOT translated (component uses hardcoded English strings, no `t()` wrapper):**
- `"AI Image Provider"`, `"Switch the image-generation backend for ALL flows..."`, `"Gemini (gemini-3.1-flash-image-preview)..."`, `"OpenAI (gpt-image-2 via Responses API...)"`

**Note:** `"Gemini"` as a standalone word is already in the EN dictionary but NOT in PT or ES dictionaries. However, the component doesn't use `t()` at all.

**Verdict:** 🔵 **NOTE** — Consistent with the project's pattern of not translating admin/power-user features. The admin panel (`ImageProviderSection`) has no `t()` calls at all, matching how other admin components are structured. The settings.tsx strings use `t()` wrappers but the keys are missing from PT/ES dictionaries. PT/ES users who are admins or affiliates will see English strings in the image provider preference section. Not a runtime bug.
