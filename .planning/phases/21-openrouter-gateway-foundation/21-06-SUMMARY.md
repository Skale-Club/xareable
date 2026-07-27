---
phase: 21-openrouter-gateway-foundation
plan: 06
subsystem: api
tags: [openrouter, image-generation, admin, gateway-routing, gemini, express]

# Dependency graph
requires:
  - phase: 21-openrouter-gateway-foundation (21-05)
    provides: OpenRouterImageProvider class + gatewayGenerateImage/gatewayEditImage (ai-gateway.service.ts Image API adapter)
  - phase: 21-openrouter-gateway-foundation (21-03)
    provides: ai-gateway-settings.service.ts (getCallRouting/setCallRouting/getFallbackChain/setFallbackChain)
provides:
  - getActiveImageProvider now routes through OpenRouter by default (GATE-02 live) with GeminiImageProvider rollback via ai_gateway_routing.image = "direct" (GATE-07)
  - Legacy gemini/openai image_provider toggle retired from the factory (GATE-04) — platform_settings.image_provider no longer read by getActiveImageProvider
  - GET/PATCH /api/admin/ai-gateway-routing and GET/PATCH /api/admin/ai-model-fallbacks admin endpoints for no-deploy routing + fallback-chain control
  - AI Models admin card cleaned of the retired OpenAI provider sentinel — image select is now a plain OpenRouter-routed model picker
affects: [21-13 (final wiring/verification harness), 21.1-affiliate-byok-migration, 26-fixes-and-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Routing-aware factory: getActiveImageProvider branches on getCallRouting(callClass) rather than reading a static platform_settings toggle — same rollback pattern will be reused for planning/transcription call classes in 21-07/21-08/21-09"
    - "Deprecate-in-place: legacy /api/admin/image-provider endpoints and profiles/platform_settings.image_provider columns retained dead with a deprecation comment rather than deleted (Phase 26 cleanup), matching the Phase 12.1->12.3 additive-deprecation precedent"

key-files:
  created: []
  modified:
    - server/services/image-provider.ts
    - server/routes/admin-settings.routes.ts
    - client/src/components/admin/post-creation/ai-models-card.tsx

key-decisions:
  - "getActiveImageProvider's profile param kept (unused in this plan) for Phase 21.1's affiliate BYOK key resolution — not removed even though it no longer drives provider selection"
  - "OpenAIImageProvider class + its helpers retained dead (not deleted) — verify-phase-12.ts still greps for them; Phase 26 cleanup territory"
  - "No new routing-toggle UI card built this plan — GATE-07's 'without a deploy' contract is satisfied by the PATCH /api/admin/ai-gateway-routing endpoint (curl-able) + Supabase dashboard; a polished UI card is Phase 26 polish"
  - "client/src/pages/admin.tsx already had zero ImageProviderSection references at plan start (removed in a prior refactor, commit 7332916, 2026-05-17) — Task 3's admin.tsx acceptance criterion was already satisfied; no edit was made to that file"

patterns-established:
  - "GATE-07 rollback contract: PATCH /api/admin/ai-gateway-routing with { call_class, mode: 'direct' } instantly reverts a call class to its legacy direct-API path, no redeploy"

requirements-completed: [GATE-02, GATE-04, GATE-07]

# Metrics
duration: 8min
completed: 2026-07-27
---

# Phase 21 Plan 06: OpenRouter Image Routing + Admin Gateway Controls Summary

**Flipped the image generation pipeline onto OpenRouter by default via a routing-aware factory, retired the legacy gemini/openai `image_provider` toggle, and shipped admin endpoints for no-deploy routing rollback and fallback-chain configuration.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-27T14:12:22Z
- **Completed:** 2026-07-27T14:20:22Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- `getActiveImageProvider` (server/services/image-provider.ts) now returns `OpenRouterImageProvider` unless `ai_gateway_routing.image` is `"direct"`, in which case it returns the legacy `GeminiImageProvider` — the GATE-07 emergency rollback switch is live for the image call class, with zero edits to any of the 6 image call sites (generate, edit, carousel x2, slide-edit, enhancement)
- `platform_settings.image_provider` is no longer read anywhere in the factory — GATE-04's legacy toggle is retired (columns/rows retained dead)
- Admin can now GET/PATCH per-call-class routing (`/api/admin/ai-gateway-routing`) and fallback model chains (`/api/admin/ai-model-fallbacks`) via authenticated endpoints guarded by the same `requireAdminGuard` pattern as the existing image-provider endpoints
- AI Models admin card no longer offers the OpenAI `gpt-image-2` sentinel — the image select is a plain `updateModel("image_generation", value)` picker like the other three model selects, with static helper text pointing at OpenRouter routing + the admin rollback switch

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewire getActiveImageProvider — routing-aware, image_provider toggle retired** - `635e37a` (feat)
2. **Task 2: Admin endpoints — GET/PATCH ai-gateway-routing + ai-model-fallbacks** - `00b77a7` (feat)
3. **Task 3: Admin UI — remove the retired OpenAI provider sentinel** - `fb1e2e3` (feat)

_No plan-metadata commit yet — will be created alongside this SUMMARY.md commit._

## Files Created/Modified
- `server/services/image-provider.ts` - `resolveImageProviderName`/`getActiveImageProvider` rewritten to branch on `getCallRouting("image")` instead of `getPlatformSetting("image_provider")`; `ImageProviderName` widened to include `"openrouter"`
- `server/routes/admin-settings.routes.ts` - added GET/PATCH `/api/admin/ai-gateway-routing` and GET/PATCH `/api/admin/ai-model-fallbacks`; legacy `/api/admin/image-provider` endpoints marked with a Phase 21 deprecation comment
- `client/src/components/admin/post-creation/ai-models-card.tsx` - removed `OPENAI_SENTINEL`, `ProviderName`, the provider query/mutation, `imageSelectValue`/`handleImageSelect`; image select now calls `updateModel("image_generation", value)` directly; removed now-unused imports (`useQuery`, `useMutation`, `useQueryClient`, `useMemo`, `apiRequest`, `SelectSeparator`)

## Decisions Made
- Kept the `profile` param on `resolveImageProviderName`/`getActiveImageProvider` for signature compatibility and Phase 21.1's future affiliate BYOK key resolution, even though it's unused (`_profile`) in this plan's logic.
- Did not delete `OpenAIImageProvider` or its helper functions (`toOpenAIInputImage`, `extractResponseImage`, `normalizeForOpenAI`, etc.) — they become unreachable from the factory but `scripts/verify-phase-12.ts` still greps for them; deletion deferred to Phase 26 cleanup.
- No new admin UI card built for routing toggles this plan (per plan's explicit scope note) — GATE-07's "without a deploy" requirement is satisfied by the curl-able PATCH endpoint + Supabase dashboard; a polished UI is Phase 26 polish territory.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Stale plan assumption, not a bug — no code change] `client/src/pages/admin.tsx` already had no `ImageProviderSection` render**
- **Found during:** Task 3 (Admin UI cleanup)
- **Issue:** The plan's Task 3 instructed removing the `ImageProviderSection` import and render from `client/src/pages/admin.tsx`. Investigation (`grep -rn "ImageProviderSection"` across `client/src`) showed the component is only referenced by its own source file, `scripts/verify-phase-12.ts`, and planning docs — it was already unrendered anywhere in the client. Git history shows this was removed in a prior refactor (commit `7332916`, 2026-05-17, "ui(admin): consolidate image provider into Image Generation dropdown"), which predates this plan's authoring and left the plan's premise stale.
- **Fix:** No code change needed — the acceptance criterion (`grep -c "ImageProviderSection" client/src/pages/admin.tsx` returns 0) was already satisfied. Verified and left `admin.tsx` untouched.
- **Files modified:** None (verification only)
- **Verification:** `grep -c "ImageProviderSection" client/src/pages/admin.tsx` → `0`
- **Committed in:** N/A (no change required)

---

**Total deviations:** 1 (stale plan assumption, no code impact)
**Impact on plan:** None — the target end-state (no `ImageProviderSection` reference in `admin.tsx`, dead component file retained) was already true. All other Task 3 work (removing `OPENAI_SENTINEL` from `ai-models-card.tsx`) proceeded exactly as planned.

## Issues Encountered
- Parallel execution with three other wave-5 plans (21-07, 21-08, 21-09) in the same working directory caused transient `git status` noise — other agents' in-progress edits to `server/services/gemini.service.ts`, `server/services/caption-quality.service.ts`, `server/routes/transcribe.routes.ts`, and `server/services/carousel-generation.service.ts` appeared and disappeared from `git status --short` between commands (including one apparent-but-transient "working tree clean" read). Each commit in this plan was preceded by a fresh `git status` check and `git add` of only this plan's specific files; no foreign files were ever staged at commit time.

## User Setup Required

None - no external service configuration required. Operator note (per plan's verification section): image generation now attempts OpenRouter by default. Until `OPENROUTER_API_KEY` is provisioned in the deploy environment, flip `ai_gateway_routing.image` to `"direct"` via `PATCH /api/admin/ai-gateway-routing` (or directly in the Supabase `platform_settings` table) to keep production on the legacy Gemini path. BYO-key affiliates ride the platform OpenRouter key this phase (per locked CONTEXT.md decision) — the same `"direct"` flip applies if that's unacceptable before Phase 21.1 lands.

## Next Phase Readiness
- Image call surface (generate, edit, carousel x2, slide-edit, enhancement) is fully routed through OpenRouter with a working, admin-controllable rollback — ready for 21-13's final cross-plan wiring/verification pass (GATE-02/GATE-04/GATE-07 checks in `scripts/verify-phase-21.ts` should flip from FAIL to PASS once 21-13 wires the verification harness itself; the underlying code is already correct as of this plan).
- Admin gateway-routing and fallback-chain endpoints are live and can be exercised now by 21-07/21-08/21-09's planning/transcription call classes, which follow the same `getCallRouting`-branch pattern.
- No blockers for the remaining wave-5 plans (21-07, 21-08, 21-09) — file sets were fully disjoint from this plan's changes.

## Self-Check: PASSED

- FOUND: server/services/image-provider.ts
- FOUND: server/routes/admin-settings.routes.ts
- FOUND: client/src/components/admin/post-creation/ai-models-card.tsx
- FOUND (retained dead file, not deleted): client/src/components/admin/image-provider-section.tsx
- FOUND commit: 635e37a (Task 1)
- FOUND commit: 00b77a7 (Task 2)
- FOUND commit: fb1e2e3 (Task 3)

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*
