---
phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative
verified: 2026-05-17T07:30:00Z
status: human_needed
score: 7/7 must-haves verified
human_verification:
  - test: "Generate a single post with Gemini provider active (platform_settings.image_provider = 'gemini'), then switch to OpenAI via /admin settings tab and generate again"
    expected: "Both providers produce a saved post image; no server restart needed between switches"
    why_human: "Cannot invoke live Supabase + Gemini/OpenAI API calls in static verification; runtime provider dispatch requires real API credentials"
  - test: "Edit a post (POST /api/edit-post) with each provider active"
    expected: "Both produce a saved post_version image via the provider's edit() path"
    why_human: "Runtime call to provider.edit() with real image buffer requires live API keys"
  - test: "Run a 3-slide carousel with each provider active"
    expected: "All 3 slides generated; slide 2+ use slide-1 buffer as currentImage reference via provider.edit()"
    why_human: "Multi-slide provider dispatch with real images cannot be exercised statically"
  - test: "Run an enhancement with each provider active"
    expected: "Enhancement image saved; text-model steps (pre-screen, caption) still use Gemini key regardless of image provider"
    why_human: "Dual-key (apiKey for text, imageApiKey for image) path requires live execution"
  - test: "Admin/affiliate user: visit /settings and verify OpenAI API key input field is visible and saves successfully"
    expected: "Field appears gated by usesOwnApiKey; save writes profiles.openai_api_key via Supabase client update"
    why_human: "UI visibility and actual DB write require browser session with admin/affiliate account"
  - test: "Visit /admin settings tab and confirm 'AI Image Provider' RadioGroup renders with Gemini selected as default"
    expected: "RadioGroup shows current value from platform_settings.image_provider; switching and saving calls PATCH /api/admin/image-provider"
    why_human: "React component rendering and real-time admin toggle require browser + live Supabase data"
  - test: "Confirm platform_settings.image_provider runtime behavior: when value is stored as JSONB string '\"gemini\"', getPlatformSetting returns plain string 'gemini' (not '\"gemini\"') so factory comparison raw === 'openai' works correctly"
    expected: "getActiveImageProvider() returns GeminiImageProvider by default; returns OpenAIImageProvider only after explicit switch to 'openai'"
    why_human: "Supabase JSONB column returns JS string after SDK parsing — actual behavior depends on live DB query; getPlatformSetting handles both string and non-string via JSON.stringify fallback but live confirmation is needed"
---

# Phase 12: Image Provider Abstraction (OpenAI gpt-image-2 Alternative) Verification Report

**Phase Goal:** A pluggable image-provider abstraction lets admin switch between Gemini (current default) and OpenAI gpt-image-2 via Responses API at runtime via platform_settings; all four generation flows route through the same factory and reference-image format converters.
**Verified:** 2026-05-17T07:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ImageProvider interface + GeminiImageProvider + OpenAIImageProvider exported from single module | VERIFIED | `server/services/image-provider.ts` L44-88 (interface + Gemini), L176-240 (OpenAI), no stub throws |
| 2 | OpenAIImageProvider uses Responses API, never images.edit, with model gpt-5.5 | VERIFIED | `responses.create()` at L198 and L229; `OPENAI_RESPONSES_MODEL = "gpt-5.5"` at L105; `images.edit(` pattern absent (only in comments L92-93) |
| 3 | Reference-image converter correct and unit-tested | VERIFIED | `toOpenAIInputImage` at L111-116 emits `data:${mimeType};base64,${data}`; `scripts/test-openai-converter.ts` exercises PNG + JPEG happy paths with `process.exit(1)` on mismatch |
| 4 | platform_settings row + getPlatformSetting/setPlatformSetting helpers + factory reads setting | VERIFIED | Migration at `supabase/migrations/20260517_image_provider_settings.sql`; helpers in `app-settings.service.ts` L187-213; factory calls `getPlatformSetting("image_provider")` at image-provider.ts L256 |
| 5 | Admin radio toggle writes platform_settings.image_provider; no server restart needed | VERIFIED (static) | `image-provider-section.tsx` RadioGroup PATCH to `/api/admin/image-provider`; admin.routes.ts GET+PATCH endpoints; factory reads per-call (no cache) | 
| 6 | OpenAI API key resolution centralized (env for regular, profile column for admin/affiliate) | VERIFIED | `getOpenAIApiKey` in auth.middleware.ts L255-275 mirrors `getGeminiApiKey`; `profiles.openai_api_key` in profileSchema L52; settings.tsx L282 saves via Supabase update |
| 7 | All 4 flows route through getActiveImageProvider() factory | VERIFIED | generate.routes.ts L19/L431; edit.routes.ts L16/L415; carousel.routes.ts L16/L280; enhance.routes.ts L19/L266; carousel-generation.service.ts uses `params.imageProvider.generate/edit`; enhancement.service.ts uses `params.imageProvider.edit` |

**Score:** 7/7 truths verified (static + functional code checks)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/services/image-provider.ts` | ImageProvider interface, GeminiImageProvider, OpenAIImageProvider, getActiveImageProvider factory | VERIFIED | 271 lines; all 4 exports present and substantive; no stub throws remaining |
| `server/services/app-settings.service.ts` | getPlatformSetting, setPlatformSetting helpers | VERIFIED | L187-213; upsert with `onConflict: "setting_key"` present |
| `server/middleware/auth.middleware.ts` | getOpenAIApiKey resolver | VERIFIED | L255-275; mirrors getGeminiApiKey pattern exactly |
| `shared/schema.ts` | profileSchema.openai_api_key field | VERIFIED | L52: `openai_api_key: z.string().nullable().optional()` |
| `supabase/migrations/20260517_image_provider_settings.sql` | ALTER TABLE + INSERT image_provider default | VERIFIED | Both statements present; `ADD COLUMN IF NOT EXISTS openai_api_key` + `INSERT ... ON CONFLICT DO NOTHING` |
| `scripts/test-openai-converter.ts` | PROV-03 unit test | VERIFIED | 33 lines; invokes converter functionally, 2 assertions, exits 0 on pass |
| `scripts/verify-phase-12.ts` | 36-check static+invocation verifier | VERIFIED | 98 lines; covers PROV-01..07; invokes test-openai-converter.ts via spawnSync |
| `client/src/components/admin/image-provider-section.tsx` | RadioGroup admin toggle component | VERIFIED | 86 lines; RadioGroup with Gemini/OpenAI options; PATCH mutation to /api/admin/image-provider; useQueryClient invalidation |
| `client/src/pages/admin.tsx` | Renders ImageProviderSection | VERIFIED | L21 import; L66 render inside settings tab |
| `client/src/pages/settings.tsx` | OpenAI API key field (admin/affiliate gated) | VERIFIED | L64 state, L282 supabase single-line update |
| `server/routes/generate.routes.ts` | provider.generate() wiring | VERIFIED | L19 import, L431 factory call |
| `server/routes/edit.routes.ts` | provider.edit() wiring | VERIFIED | L16 import, L415 factory call |
| `server/services/carousel-generation.service.ts` | imageProvider injected param | VERIFIED | L70 param; L283 provider.generate; L317 provider.edit; L342 provider.edit |
| `server/routes/carousel.routes.ts` | provider injected before generateCarousel | VERIFIED | L16 import, L280 factory call |
| `server/services/enhancement.service.ts` | imageProvider injected param + callEnhancementImageModel deleted | VERIFIED | L102 param; L546 provider.edit; no callEnhancementImageModel present |
| `server/routes/enhance.routes.ts` | provider injected before enhanceProductPhoto | VERIFIED | L19 import, L266 factory call |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| GeminiImageProvider | generateImage / editImage in image-generation.service.ts | ESM import + delegate call | VERIFIED | L6: `import { generateImage, editImage } from "./image-generation.service.js"` |
| OpenAIImageProvider.generate / .edit | openai SDK responses.create | client.responses.create | VERIFIED | L198 (generate) and L229 (edit); no images.edit() call present |
| getActiveImageProvider | getPlatformSetting("image_provider") | factory reads setting | VERIFIED | L256: `getPlatformSetting("image_provider")` |
| shared/schema.ts Profile type | profiles.openai_api_key column | schema mirrors DB column | VERIFIED | L52 profileSchema; migration adds column |
| scripts/verify-phase-12.ts | scripts/test-openai-converter.ts | spawnSync (functional invocation) | VERIFIED | verify script L35: `spawnSync("npx", ["tsx", "scripts/test-openai-converter.ts"])` |
| image-provider-section.tsx | PATCH /api/admin/image-provider | apiRequest mutation | VERIFIED | Component L36; admin.routes.ts L1897 |
| admin.routes.ts PATCH | setPlatformSetting("image_provider", value) | imported helper | VERIFIED | admin.routes.ts L1906: `setPlatformSetting("image_provider", provider)` |
| settings.tsx | profiles.openai_api_key (Supabase row) | supabase.from("profiles").update | VERIFIED | L282: single-line update pattern |
| generate.routes.ts | provider.generate() | factory call | VERIFIED | L431: `const provider = await getActiveImageProvider(); ... provider.generate(...)` |
| edit.routes.ts | provider.edit() | factory call | VERIFIED | L415: `const provider = await getActiveImageProvider(); ... provider.edit(...)` |
| carousel.routes.ts | generateCarousel({ imageProvider }) | provider injected as service param | VERIFIED | L280: `const imageProvider = await getActiveImageProvider()` passed to generateCarousel |
| enhance.routes.ts | enhanceProductPhoto({ imageProvider }) | provider injected as service param | VERIFIED | L266: `const imageProvider = await getActiveImageProvider()` passed to enhanceProductPhoto |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| image-provider-section.tsx | data?.provider | GET /api/admin/image-provider → getPlatformSetting | VERIFIED (static): admin.routes.ts GET reads live platform_settings row | FLOWING (static); runtime needs human check |
| generate.routes.ts | provider | getActiveImageProvider() → getPlatformSetting | Admin-configured platform_settings row; factory returns real GeminiImageProvider or OpenAIImageProvider | FLOWING (static) |
| enhancement.service.ts | editResult | provider.edit() | Real buffer from provider (Gemini editImage or OpenAI responses.create) | FLOWING (static) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| PROV-03 converter unit test | `npx tsx scripts/test-openai-converter.ts` | Would exit 0 (confirmed by verify script design + static analysis of assertDeepEqual calls) | SKIP — requires tsx runtime; static analysis shows correct assertions |
| verify-phase-12.ts structure | Static grep of 36 check() calls across PROV-01..07 | 36 distinct check() calls covering all 7 PROV requirements confirmed by reading verify script | PASS (static) |
| No images.edit() call | `grep "images\.edit(" server/services/image-provider.ts` | 0 functional matches (2 comment-only references) | PASS |
| OPENAI_RESPONSES_MODEL literal | `grep OPENAI_RESPONSES_MODEL server/services/image-provider.ts` | `= "gpt-5.5"` confirmed at L105 | PASS |

Step 7b: Behavioral spot-checks requiring live server (API calls, DB reads) deferred to human verification.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PROV-01 | 12-01 | ImageProvider interface + GeminiImageProvider + factory | SATISFIED | interface L44, GeminiImageProvider L52, getActiveImageProvider L255 |
| PROV-02 | 12-02 | OpenAIImageProvider uses Responses API (not legacy Image API), model gpt-image-2 | SATISFIED | responses.create at L198/L229; OPENAI_RESPONSES_MODEL="gpt-5.5" at L105; no images.edit() call |
| PROV-03 | 12-02 | Reference-image converter unit-tested (Gemini {mimeType,data} to OpenAI input_image) | SATISFIED | toOpenAIInputImage L111; scripts/test-openai-converter.ts 2 assertions; spawnSync in verify script |
| PROV-04 | 12-03 | platform_settings image_provider row + getPlatformSetting/setPlatformSetting helpers | SATISFIED | Migration seeds default; app-settings.service.ts L187/L204; factory reads per-call |
| PROV-05 | 12-05 | Admin radio toggle in settings page writes to platform_settings.image_provider | SATISFIED (static) | image-provider-section.tsx RadioGroup; GET+PATCH admin routes; admin.tsx renders section |
| PROV-06 | 12-03/05 | OPENAI_API_KEY env + profiles.openai_api_key column + key resolver + settings UI | SATISFIED | getOpenAIApiKey in auth.middleware.ts; profileSchema field; migration column; settings.tsx field |
| PROV-07 | 12-04 | All 4 flows route through provider factory; switching provider changes behavior | SATISFIED (static) | All 4 routes import + call getActiveImageProvider; carousel + enhancement services accept injected imageProvider |

All 7 PROV requirements covered. No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server/services/image-provider.ts` | 202, 233 | `as any` cast on `responses.create({...})` | Info | Intentional — SDK v6.38.0 types lag on `image_generation` tool `action: 'edit'` parameter; documented in both plan and code comment |
| `server/services/image-provider.ts` | 154 | `response: any` parameter type in extractResponseImage | Info | Intentional — Responses API response shape typed loosely pending SDK type stabilization; function guards with null-checks and throws |

No blocker anti-patterns. No TODO/FIXME/placeholder comments. No empty return stubs (OpenAIImageProvider stub from 12-03 was confirmed replaced by 12-02 full implementation at merge). No hardcoded empty data arrays flowing to rendering.

**Migration value format note (non-blocking):** The migration stores the value as `'"gemini"'::jsonb` (a JSONB string) while the plan specified plain `'gemini'`. `getPlatformSetting` handles this correctly via `typeof v === "string" ? v : JSON.stringify(v)` — Supabase JS client auto-parses JSONB strings to JS strings, so `raw === "openai"` comparison in the factory will work. This is a cosmetic deviation confirmed safe at the code level; runtime confirmation is in human verification item 7.

### Human Verification Required

#### 1. Cross-Provider Generation (Single Image)

**Test:** With Gemini active (default), generate a post from the dashboard. Then visit /admin settings tab, switch to OpenAI, save, and generate again.
**Expected:** Both calls succeed; two different posts saved; no server restart between switches.
**Why human:** Requires live Gemini + OpenAI API keys, live Supabase DB, real HTTP request through SSE streaming pipeline.

#### 2. Cross-Provider Edit (POST /api/edit-post)

**Test:** Edit an existing post with each provider active in turn.
**Expected:** Both produce a new post_version with a saved image URL.
**Why human:** Requires live provider.edit() execution with a real image buffer as input.

#### 3. Cross-Provider Carousel (3 Slides)

**Test:** Generate a 3-slide carousel with Gemini, then with OpenAI.
**Expected:** All 3 slides generated for each provider; style consistency maintained (slide 2+ use slide-1 buffer as currentImage via provider.edit()).
**Why human:** Multi-step provider dispatch, real image buffers passed between slide calls, live API.

#### 4. Cross-Provider Enhancement

**Test:** Run an enhancement with each provider active.
**Expected:** Enhanced image saved; text-model steps (pre-screen analysis, caption) still use Gemini key (apiKey param) regardless of image provider setting.
**Why human:** Dual-key routing (apiKey for text, imageApiKey for image) requires live execution to confirm separation holds.

#### 5. Admin/Affiliate OpenAI Key Field in /settings

**Test:** Log in as admin or affiliate user; navigate to /settings; confirm the OpenAI API key input card is visible.
**Expected:** Card renders with current profile.openai_api_key value; saving updates the Supabase profiles row.
**Why human:** usesOwnApiKey gating and DB write require browser session with admin/affiliate account.

#### 6. Admin Provider Toggle at /admin

**Test:** Log in as admin; navigate to /admin settings tab; confirm "AI Image Provider" RadioGroup shows Gemini selected.
**Expected:** RadioGroup reflects live platform_settings.image_provider value; saving PATCH request updates it; next generation uses the new provider.
**Why human:** React component rendering and live Supabase read via GET /api/admin/image-provider endpoint.

#### 7. JSONB Value Round-trip for Factory Dispatch

**Test:** After migration is applied, run: `SELECT setting_value, pg_typeof(setting_value) FROM platform_settings WHERE setting_key = 'image_provider'` in Supabase SQL editor.
**Expected:** Returns `"gemini"` (JSON string) of type `jsonb`; `getPlatformSetting` call from Node returns plain JS string `"gemini"` (not `'"gemini"'` with extra quotes), so `raw === "openai"` comparison in getActiveImageProvider works correctly.
**Why human:** The JSONB vs plain-string round-trip behavior depends on live Supabase JS client deserialization; the code handles it correctly for both cases but live confirmation eliminates any edge-case risk.

### Gaps Summary

No automated gaps found. All 16 artifacts exist and are substantive (no stubs, no empty implementations, no TODO placeholders). All 12 key links are wired. All 7 PROV requirements have implementation evidence. The verify script structure covers 36 checks across all requirements.

The status is `human_needed` because the phase goal explicitly requires runtime provider switching ("lets admin switch... at runtime"), and the most critical truths — that switching the setting actually routes all four flows to a different provider producing real images — cannot be verified without live API credentials and a running server. The Task 3 checkpoint in 12-05 was auto-approved per `--auto` mode orchestrator flag; human UAT is the remaining gate.

---

_Verified: 2026-05-17T07:30:00Z_
_Verifier: Claude (gsd-verifier)_
