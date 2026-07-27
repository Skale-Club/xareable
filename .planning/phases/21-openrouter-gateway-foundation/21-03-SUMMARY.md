---
phase: 21-openrouter-gateway-foundation
plan: 03
subsystem: billing
tags: [openrouter, platform_settings, zod, quota, usage_events, gateway-routing, fallback-chain]

# Dependency graph
requires:
  - phase: 21-01
    provides: "Phase 21 verify harness skeleton (scripts/verify-phase-21.ts) — this plan's checks remain stubbed until 21-13"
provides:
  - "OPENROUTER_API_KEY validated (optional) env var in server/config/index.ts"
  - "server/services/ai-gateway-settings.service.ts — getCallRouting/setCallRouting (GATE-07 rollback), getFallbackChain/setFallbackChain (GATE-04), backed by platform_settings.ai_gateway_routing + ai_model_fallbacks"
  - "event_kind Zod enum extended with model_fallback (generation_logs)"
  - "usageEventSchema.metadata optional field (GATE-05)"
  - "recordUsageEvent(...) additive realCostUsdMicros?/estimatedCostMicros? params — real-cost short-circuit with markup applied via getMarkupMultiplier"
affects: [21-04, 21-05, 21-06, 21-07, 21-08, 21-09, 21-10, 21-11, 21-12, 21-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct-query (no getPlatformSetting) read-modify-write pattern for object-shaped platform_settings JSONB rows — mirrors quota.ts's getPlatformSettingNumber/getMarkupMultiplier, avoids the JSON.stringify round-trip getPlatformSetting forces on objects"
    - "No in-memory caching on gateway routing/fallback reads — admin rollback toggles must take effect immediately, same precedent as getPlatformSetting"
    - "recordUsageEvent priority order: real cost (OpenRouter usage.cost) > token-table estimate > flat operation fallback"

key-files:
  created:
    - server/services/ai-gateway-settings.service.ts
    - supabase/migrations/20260718000000_ai_gateway_settings.sql
    - supabase/migrations/20260718000001_usage_events_metadata.sql
  modified:
    - server/config/index.ts
    - shared/schema.ts
    - server/quota.ts

key-decisions:
  - "getMarkupMultiplier(userId) reused as-is for the real-cost path (Math.round(realCostUsdMicros * multiplier)) rather than reimplementing markup logic — first real caller of this previously-underused helper for computing charged_amount_micros directly"
  - "usage_events.metadata only populated (non-null) when either realCostUsdMicros or estimatedCostMicros is present — legacy/non-gateway rows keep metadata: null, distinguishing gateway-priced events from token/fallback-priced ones at the data layer"

patterns-established:
  - "Pattern: object-shaped platform_settings rows (routing/fallback maps) read via direct .from('platform_settings').select('setting_value').eq('setting_key', ...) — NOT via getPlatformSetting/setPlatformSetting (those serialize to/from string, awkward for objects)"

requirements-completed: [GATE-04, GATE-05]

# Metrics
duration: 18min
completed: 2026-07-27
---

# Phase 21 Plan 03: OpenRouter Gateway Settings + Cost Recording Foundation Summary

**New `ai-gateway-settings.service.ts` module (routing + fallback-chain read/write over `platform_settings`) plus `recordUsageEvent`'s additive real-cost/estimated-cost params backed by a new `usage_events.metadata` column — zero behavior change for any existing call site.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-27T13:48:49Z (approx, per STATE.md session start)
- **Completed:** 2026-07-27T14:06:41Z
- **Tasks:** 3 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `OPENROUTER_API_KEY` added as an optional, validated env var (`server/config/index.ts`) — same optional pattern as `CRON_SECRET`, dev/CI boots without it
- New `server/services/ai-gateway-settings.service.ts` exposing `getCallRouting`/`setCallRouting` (GATE-07 per-call-class openrouter/direct rollback) and `getFallbackChain`/`setFallbackChain` (GATE-04 ordered fallback model chains), backed by two new seeded `platform_settings` rows (`ai_gateway_routing`, `ai_model_fallbacks`)
- `generationLogSchema.event_kind` extended with `model_fallback` for future fallback-chain observability logging
- `usageEventSchema` gained an optional `metadata` field; `usage_events.metadata` JSONB column added additively
- `recordUsageEvent` gained additive `realCostUsdMicros?`/`estimatedCostMicros?` params — when a real cost is present it short-circuits token/fallback pricing and applies `getMarkupMultiplier(userId)` directly; both values are persisted to `usage_events.metadata` when either is present
- All 5 existing `recordUsageEvent` call sites (generate/edit/carousel×2/transcribe/enhance routes) confirmed to still compile unchanged since both new params are optional
- `npm run check` exits 0 after every task

## Task Commits

Each task was committed atomically:

1. **Task 1: OPENROUTER_API_KEY env var + ai-gateway-settings.service.ts + seed migration** - `77f57ba` (feat)
2. **Task 2: event_kind enum + usage_events.metadata schema/migration** - `ab51425` (feat)
3. **Task 3: quota.ts — recordUsageEvent additive realCostUsdMicros/estimatedCostMicros params** - `160942f` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `server/config/index.ts` - Added optional `OPENROUTER_API_KEY: z.string().min(1).optional()` to `envSchema`, right after `CRON_SECRET`
- `server/services/ai-gateway-settings.service.ts` - New module: `getCallRouting`, `setCallRouting`, `getFallbackChain`, `setFallbackChain` over `platform_settings.ai_gateway_routing` / `ai_model_fallbacks`
- `supabase/migrations/20260718000000_ai_gateway_settings.sql` - Seeds `ai_gateway_routing` (all 3 call classes default `openrouter`) and `ai_model_fallbacks` (all empty arrays), idempotent `ON CONFLICT DO NOTHING`
- `shared/schema.ts` - `event_kind` enum gained `model_fallback`; `usageEventSchema` gained optional `metadata: z.record(z.unknown()).nullable().optional()`
- `supabase/migrations/20260718000001_usage_events_metadata.sql` - Additive `usage_events.metadata JSONB DEFAULT '{}'::jsonb` column + comment
- `server/quota.ts` - `recordUsageEvent` signature extended with `realCostUsdMicros?`/`estimatedCostMicros?`; pricing short-circuits to real cost × markup when present; both values written to `metadata` when either is present

## Decisions Made
- Confirmed via full-repo grep that `getMarkupMultiplier` had zero prior `await getMarkupMultiplier(...)` call sites (only its own definition existed) — `deductCredits` computes markup by back-computing the charged/raw ratio locally rather than calling the helper. `recordUsageEvent`'s new call is genuinely the helper's first real caller, matching the plan's stated intent even though the specific "≥2 matches" acceptance-criteria wording (which assumed a pre-existing call in `deductCredits`) was based on an inaccurate premise about the current codebase. No code change was needed — behavior is correct and `npm run check` passes.
- Kept `calculateCostMicros`/`getOperationFallbackCostMicros` completely untouched per plan instruction — only `recordUsageEvent`'s short-circuit branch around them changed.

## Deviations from Plan

### Auto-fixed Issues

None requiring code fixes — see "Issues Encountered" below for a git-coordination note (not a code deviation).

**Acceptance-criteria note (not a fix):** Task 3's acceptance criterion `grep -n "await getMarkupMultiplier(userId)" server/quota.ts` returning "at least 2 matches" does not hold literally (1 match, the new call) because the premise that `deductCredits` already called this helper directly was incorrect for the current codebase (it back-computes the multiplier from `chargedCostMicros / rawCostMicros` instead). All functional acceptance criteria (signature, `metadata: hasGatewayMeta`, `npm run check` exit 0) are satisfied.

## Issues Encountered

**Parallel-execution git coordination (Task 2):** This plan (21-03) ran in parallel with plan 21-02 in the same working directory (no worktree isolation). After I staged `shared/schema.ts` and the new `usage_events` metadata migration for Task 2, the 21-02 agent's `git add`/commit swept up my already-staged files into their own commit (`184d9a4`, later amended to `42a44b2` once they noticed and excluded my files). Content was verified correct at every point (`grep` + `npm run check`) before and after the other agent's amend; once their amend excluded my files, they were still present but unstaged in the working tree, and I committed them cleanly under my own message (`ab51425`). No data was lost; no manual reconstruction was needed — content matched the plan exactly throughout.

## User Setup Required

**External services require manual configuration.** Per this plan's `user_setup` frontmatter:
- Obtain an `OPENROUTER_API_KEY` from the OpenRouter Dashboard → Keys (https://openrouter.ai/keys) and set it as an environment variable. Not required for this plan's own verification (the var is optional and unused until later Phase 21 plans wire actual gateway calls), but ensure the OpenRouter account has billing/credits configured before Plan 21-04 onward starts making live calls.

## Next Phase Readiness
- `ai-gateway-settings.service.ts` is ready for `getCallRouting`/`getFallbackChain` to be imported by the gateway client (21-04+) and for an admin UI to call `setCallRouting`/`setFallbackChain` (later plan).
- `recordUsageEvent`'s new params are ready for 21-09 through 21-12 (generate/edit/carousel/transcribe/enhance route plans) to start passing real OpenRouter `usage.cost` values through.
- `event_kind: "model_fallback"` is ready for the fallback-chain logging call site landing in a later plan (consumer of `getFallbackChain`).
- No blockers for subsequent Phase 21 plans.

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: server/services/ai-gateway-settings.service.ts
- FOUND: supabase/migrations/20260718000000_ai_gateway_settings.sql
- FOUND: supabase/migrations/20260718000001_usage_events_metadata.sql
- FOUND: 77f57ba (Task 1 commit)
- FOUND: ab51425 (Task 2 commit)
- FOUND: 160942f (Task 3 commit)
