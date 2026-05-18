---
status: investigated
trigger: "key-access-3-tier-model-audit"
created: 2026-05-17T00:00:00Z
updated: 2026-05-17T00:00:00Z
---

## Current Focus

hypothesis: Audit of 3-tier API key access model (admin/affiliate own key, regular users platform key)
test: Code review of auth.middleware.ts, quota.ts, all 4 generation routes, settings.tsx, admin.tsx
expecting: Identify any structural inconsistencies, security leaks, or UX gaps
next_action: Delivered findings

## Symptoms

expected: Clean 3-tier model — admin/affiliate use own keys, regular paying users share platform key
actual: Unknown — audit-time question
errors: None reported
reproduction: Code review only
started: After Phase 12.2 shipped

## Evidence

- timestamp: 2026-05-17
  checked: auth.middleware.ts — usesOwnApiKey(), getGeminiApiKey(), getOpenAIApiKey()
  found: usesOwnApiKey() correctly returns true ONLY for is_admin===true OR is_affiliate===true. getGeminiApiKey/getOpenAIApiKey branch cleanly on that result. Both resolve the fallback key from platform_settings via getPlatformDefaultApiKey("gemini_api_key"/"openai_api_key"). No other role flags checked here.
  implication: Tier 1+2 vs Tier 3 split is correctly implemented in the key-resolver functions.

- timestamp: 2026-05-17
  checked: quota.ts — usesOwnApiKey() (local copy, line 61-70)
  found: This is a DIFFERENT usesOwnApiKey() from the one in auth.middleware.ts. It queries the DB directly and returns true for is_admin OR is_affiliate OR is_business. The is_business flag is NOT in the shared profileSchema and NOT checked by the middleware version.
  implication: is_business users bypass credit checks (allowed:true, estimated_cost:0) in checkCredits(), deductCredits(), canUseQuickRemake(). But because the key-resolver functions in auth.middleware.ts do NOT recognize is_business, a business user would fall through to the platform key — meaning the platform key is burned with no credit deduction. This is a BLOCKER.

- timestamp: 2026-05-17
  checked: generate.routes.ts — credit gating pattern
  found: `const creditStatus = !ownApiKey ? await checkCredits(...) : null`. Then `if (creditStatus && !creditStatus.allowed) { return 402 }`. ownApiKey is derived from auth.middleware.ts usesOwnApiKey (without is_business). So a business user hits checkCredits (quota.ts usesOwnApiKey sees is_business=true, returns allowed:true). They proceed to generation using the PLATFORM key (auth.middleware getGeminiApiKey sees is_business=false, falls to platform key). Credits are not deducted (deductCredits skipped because !ownApiKey is false after checkCredits returns allowed:true... wait, no — deductCredits is called if `!ownApiKey` which for business user is true). Actually, deductCredits in the route uses the route-level `ownApiKey` variable (from middleware), not the quota.ts version. Business user: route ownApiKey=false, quota.ts ownApiKey=true → checkCredits allows AND returns cost=0, route calls deductCredits with !ownApiKey=true (runs deduct) but quota.ts deductCredits skips actual deduction (p_is_admin_or_affiliate=true). Net: business user runs on platform key, billing is zero. Confirmed BLOCKER.
  implication: is_business is an orphaned concept: recognized in quota.ts for bypass but not in key-resolver, creating a semantic mismatch.

- timestamp: 2026-05-17
  checked: All 4 generation routes — free user path through checkCredits
  found: All 4 routes (generate, edit, carousel, enhance) gate on `!ownApiKey ? await checkCredits(...) : null` then check `creditStatus.allowed`. The subscription_overage billing model path correctly requires active subscription OR free_generations_remaining > 0. The credits_topup path checks balance >= estimated cost. A user with 0 free generations AND 0 balance AND no subscription is denied with 402. No path allows a zero-credit regular user to reach the platform key.
  implication: Free-user gating is correctly implemented for regular users (is_business aside).

- timestamp: 2026-05-17
  checked: generate.routes.ts vs carousel.routes.ts profile select columns
  found: generate.routes.ts selects "is_admin, is_affiliate, api_key, openai_api_key, image_provider" — NO is_business column. carousel.routes.ts and enhance.routes.ts select "is_admin, is_affiliate, is_business, api_key, openai_api_key, image_provider". edit.routes.ts selects "is_admin, is_affiliate, api_key, openai_api_key, image_provider" — NO is_business. The profile column selection is inconsistent across routes.
  implication: Even if is_business were to be made meaningful for key resolution, 2 of 4 routes wouldn't even fetch it. Maintenance hazard.

- timestamp: 2026-05-17
  checked: resolveImageProviderName() in image-provider.ts
  found: Per-user override fires ONLY when profile.is_admin===true OR profile.is_affiliate===true AND profile.image_provider is set. A regular user with a stale/accidentally-set image_provider DB value would NOT have it honored because the check requires admin/affiliate flag.
  implication: Provider preference is correctly scoped to admin/affiliate only. Regular users always get the global platform_settings.image_provider.

- timestamp: 2026-05-17
  checked: settings.tsx — UI gating for API key and provider cards
  found: Both the "OpenAI API Key" card (line 481) and the "AI Image Provider" card (line 518) are wrapped in `{usesOwnApiKey(profile) && ...}`. The local usesOwnApiKey in settings.tsx only checks is_admin OR is_affiliate (correct). Gemini API key field: NOT visible in settings.tsx — there is no Gemini key input visible in this file. Searching reveals the Gemini key was previously in settings but is now absent.
  implication: Gemini key save UI is missing from settings.tsx. Admin/affiliate users who need to set their own Gemini key (profile.api_key) have no UI to do so from this page. This is a UX GAP — BLOCKER-level for admin usability.

- timestamp: 2026-05-17
  checked: admin.tsx — /admin route access guard
  found: In App.tsx line 231: `if (isAdminMode && profile.is_admin && isAdminRoute)` — admin page renders ONLY if profile.is_admin is true. Affiliate users visiting /admin get no special treatment; they would fall through to the normal app. The PlatformApiKeysSection and ImageProviderSection are rendered inside the "settings" tab of admin page, which is only accessible when profile.is_admin is true (the entire admin page is gated). Server-side, /api/admin/api-keys and /api/admin/image-provider use requireAdminGuard which checks is_admin exclusively — affiliates cannot call these endpoints.
  implication: Admin platform-settings UI and API are correctly gated to is_admin only. Affiliates cannot access or modify platform-wide keys.

- timestamp: 2026-05-17
  checked: Error message accuracy for key-missing scenarios
  found: getGeminiApiKey() returns: "Admin and affiliate accounts must configure their own Gemini API key in Settings before generating." — correctly directs to /settings. getOpenAIApiKey() returns same phrasing. Platform key missing returns: "Gemini/OpenAI API key not configured. Ask the platform admin to set it in /admin → API Keys." — correct direction for regular users. In edit.routes.ts (line 146): when geminiKeyError fires for ownApiKey user, the message is hardcoded as the route-level string, not using the error from getGeminiApiKey. Minor inconsistency but same meaning.
  implication: Error messages are directionally correct.

- timestamp: 2026-05-17
  checked: Admin/affiliate with OpenAI provider but empty openai_api_key
  found: getOpenAIApiKey() returns { key: "", error: "Admin and affiliate accounts must configure their own OpenAI API key in Settings before generating." }. In generate.routes.ts (line 435-440): if provider.name === "openai" and openaiKeyRes.error, sendError with 400 and return. Same pattern in edit, carousel, enhance routes. No silent fallback to Gemini or platform OpenAI key.
  implication: Correctly surfaces error when OpenAI key is missing for admin/affiliate using OpenAI provider.

- timestamp: 2026-05-17
  checked: admin is_admin flag flip (admin becomes regular user)
  found: No special transition code exists. If is_admin flips to false, the next request: auth.middleware getGeminiApiKey would resolve platform key (not own key), checkCredits would run normally (not bypassed). The user would be treated as a regular user. Their previously-set profile.api_key would be ignored. This is structurally correct but may surprise an admin who expects immediate downgrade.
  implication: Graceful transition, no security issue.

- timestamp: 2026-05-17
  checked: Documentation of resolution order
  found: auth.middleware.ts has JSDoc comments on getGeminiApiKey and getOpenAIApiKey explaining the resolution order. image-provider.ts has a JSDoc on resolveImageProviderName listing all 3 tiers (Phase 12.1 comment). No single unified document covers all three decisions together. Provider and key are resolved SEPARATELY (getGeminiApiKey/getOpenAIApiKey vs getActiveImageProvider). They could drift: the factory returns OpenAI provider but key resolver returns Gemini key if called with wrong arguments.
  implication: Separation between provider resolution and key resolution is a structural maintenance risk. Each route manually picks the right key resolver after checking provider.name. If a developer adds a 5th route and forgets the `if (provider.name === "openai")` pattern, they'd call OpenAI with a Gemini key.

## Resolution

root_cause: No single blocking bug in the intended 3-tier model. Two real issues found: (1) is_business in quota.ts creates a 4th implicit tier that uses the platform key for free, contradicting the 3-tier design. (2) Gemini API key field is absent from settings.tsx, leaving admin/affiliate with no UI to set profile.api_key. One structural risk: provider and key are resolved in separate systems with no compile-time guarantee they agree.
fix: N/A — audit only
verification: N/A
files_changed: []
