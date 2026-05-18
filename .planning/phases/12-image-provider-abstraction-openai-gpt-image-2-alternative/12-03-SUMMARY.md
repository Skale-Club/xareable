---
phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative
plan: "03"
subsystem: api
tags: [openai, gemini, image-provider, platform-settings, auth-middleware, schema, typescript, migration]

requires:
  - phase: 12-01
    provides: "ImageProvider interface + GeminiImageProvider adapter in image-provider.ts"

provides:
  - "SQL migration adding profiles.openai_api_key column + platform_settings.image_provider='gemini' default"
  - "getPlatformSetting(key) and setPlatformSetting(key, value) exported from app-settings.service.ts"
  - "getOpenAIApiKey(profile) exported from auth.middleware.ts — mirrors getGeminiApiKey pattern"
  - "getActiveImageProvider() factory exported from image-provider.ts — reads image_provider setting"
  - "getActiveImageProviderName() read-only accessor for admin UI / verify script"
  - "OpenAIImageProvider stub in image-provider.ts — replaced by 12-02 full implementation at merge"
  - "profileSchema.openai_api_key field typed as z.string().nullable().optional()"
  - "scripts/verify-phase-12.ts Wave-2 baseline verifier (PROV-01..04 + PROV-06)"

affects:
  - 12-04-route-wiring
  - 12-05-admin-ui

tech-stack:
  added: []
  patterns:
    - "getPlatformSetting/setPlatformSetting — generic helpers over platform_settings table with upsert+onConflict"
    - "getOpenAIApiKey mirrors getGeminiApiKey — ownKey check for admin/affiliate, env fallback for regular users"
    - "getActiveImageProvider factory — reads per-request (no cache) for immediate admin toggle effect"
    - "Zod schema .nullable().optional() pattern for new optional DB columns (pre-migration tolerance)"

key-files:
  created:
    - supabase/migrations/20260517_image_provider_settings.sql
    - scripts/verify-phase-12.ts
  modified:
    - shared/schema.ts
    - server/services/app-settings.service.ts
    - server/middleware/auth.middleware.ts
    - server/services/image-provider.ts

key-decisions:
  - "OpenAIImageProvider stub added in this plan to unblock TypeScript compilation of the factory — 12-02 replaces with full Responses API implementation at merge"
  - "getPlatformSetting/setPlatformSetting formalized as exported helpers (previously all callers used inline Supabase calls)"
  - "getActiveImageProvider reads per-request (no TTL caching) so admin toggle takes immediate effect"
  - "verify-phase-12.ts created in Wave 2 (not Wave 4) per Nyquist continuity — 12-04 can re-run it to catch regressions before Wave 4 starts"

metrics:
  duration: "~8 min"
  tasks: 4
  files: 6
  completed: 2026-05-17
---

# Phase 12 Plan 03: Provider Factory + Key Resolution + Verify Script Summary

**SQL migration, profileSchema extension, getPlatformSetting/setPlatformSetting helpers, getOpenAIApiKey resolver, getActiveImageProvider factory, and Wave-2 baseline verifier — all PROV-04/PROV-06 requirements satisfied with TypeScript clean**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-05-17
- **Tasks:** 4
- **Files modified:** 6 (1 new migration, 1 new verify script, 4 modified TS files)

## Accomplishments

- Created `supabase/migrations/20260517_image_provider_settings.sql` — idempotent migration adding `profiles.openai_api_key TEXT` column and seeding `platform_settings.image_provider='gemini'` default row
- Added `openai_api_key: z.string().nullable().optional()` to `profileSchema` — `Profile` TypeScript type now carries the field, eliminating need for `as any` casts in Plan 12-04 route callers
- Added `getPlatformSetting(key)` and `setPlatformSetting(key, value)` to `app-settings.service.ts` — first formal generic helpers over the `platform_settings` table; `setPlatformSetting` uses upsert+onConflict to avoid Pitfall 5 (silent no-op .update on missing row)
- Added `getOpenAIApiKey(profile)` to `auth.middleware.ts` — exact mirror of `getGeminiApiKey`: admin/affiliate users supply `profile.openai_api_key`, regular users fall through to `process.env.OPENAI_API_KEY`
- Extended `image-provider.ts` with `OpenAIImageProvider` stub (unblocks TypeScript compilation; 12-02 replaces with full Responses API implementation at merge) and `getActiveImageProvider()` / `getActiveImageProviderName()` factory functions
- Created `scripts/verify-phase-12.ts` — Wave-2 baseline verifier covering PROV-01..04 + PROV-06; 14/20 checks pass in this worktree; 6 PROV-02/03 checks will go green after 12-02 merges

## Task Commits

Each task was committed atomically (--no-verify, parallel execution mode):

1. **Task 1: SQL migration** - `7462c75` (feat)
2. **Task 2: profileSchema openai_api_key** - `902f71d` (feat)
3. **Task 3: getPlatformSetting + getOpenAIApiKey + getActiveImageProvider** - `37e6fa7` (feat)
4. **Task 4: scripts/verify-phase-12.ts** - `c3d96f3` (feat)

## Files Created/Modified

- `supabase/migrations/20260517_image_provider_settings.sql` — ALTER TABLE + INSERT ON CONFLICT DO NOTHING (apply manually per Phase 11 convention)
- `shared/schema.ts` — `openai_api_key` field added to `profileSchema`
- `server/services/app-settings.service.ts` — `getPlatformSetting`, `setPlatformSetting` appended
- `server/middleware/auth.middleware.ts` — `getOpenAIApiKey` appended after `getGeminiApiKey`
- `server/services/image-provider.ts` — `OpenAIImageProvider` stub + `getActiveImageProvider` factory + `getActiveImageProviderName` appended
- `scripts/verify-phase-12.ts` — Wave-2 baseline verifier (PROV-01..04 + PROV-06)

## Decisions Made

- **OpenAIImageProvider stub:** Added a throw-stub for TypeScript compilation; 12-02 will replace with full Responses API implementation during merge reconciliation. This is the parallel execution pattern described in the orchestration notes.
- **getPlatformSetting/setPlatformSetting as new helpers:** Research (Pattern 5) confirmed these don't exist yet; creating them here formalizes the pattern and avoids repeated inline Supabase calls in 12-04/12-05.
- **No caching in factory:** `getActiveImageProvider()` reads `platform_settings` per-call — admin expects immediate effect after toggling; TTL cache would require restart or explicit invalidation.
- **verify-phase-12.ts in Wave 2:** Per Nyquist continuity principle — having the verifier before Wave 3 allows Plan 12-04 to re-run it and catch any regressions in PROV-01..04/PROV-06 introduced by route wiring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added OpenAIImageProvider stub to image-provider.ts**
- **Found during:** Task 3
- **Issue:** The factory function `getActiveImageProvider()` references `OpenAIImageProvider` by name, but 12-02 (parallel plan) hasn't merged yet — TypeScript compilation would fail
- **Fix:** Added a minimal stub class with `throw new Error("not yet implemented")` in both methods; 12-02 replaces this with the full Responses API implementation at merge
- **Files modified:** `server/services/image-provider.ts`
- **Commit:** `37e6fa7`

### Parallel Execution Gap (Expected)

`scripts/verify-phase-12.ts` exits 1 in this worktree (14/20 checks pass; 6 PROV-02/03 fail). This is expected and correct:
- PROV-02 (`responses.create`, `image_generation` tool, `OPENAI_RESPONSES_MODEL`) — requires 12-02 merge
- PROV-03 (`toOpenAIInputImage` converter, `test-openai-converter.ts`) — requires 12-02 merge
- After orchestrator merges 12-01 + 12-02 + 12-03, all 20 checks will pass

## User Setup Required (Manual Steps)

> **IMPORTANT:** Before testing with `image_provider='openai'`, the migration must be applied manually:
>
> 1. Go to **Supabase Dashboard > SQL Editor**
> 2. Open `supabase/migrations/20260517_image_provider_settings.sql`
> 3. Paste and run the SQL
> 4. Verify: `SELECT openai_api_key FROM profiles LIMIT 1` should return without error
> 5. Verify: `SELECT setting_value FROM platform_settings WHERE setting_key = 'image_provider'` should return `gemini`
>
> Also add `OPENAI_API_KEY=<your-key>` to your `.env` file for regular-user OpenAI generation.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `OpenAIImageProvider.generate()` throws | `server/services/image-provider.ts` | Placeholder until 12-02 merges with full Responses API implementation |
| `OpenAIImageProvider.edit()` throws | `server/services/image-provider.ts` | Same — 12-02 replaces |

These stubs are intentional and safe: the factory only returns `OpenAIImageProvider` when `platform_settings.image_provider = 'openai'`, which requires a manual DB change. Default behavior (Gemini) is completely unchanged.

## Next Phase Readiness

- Plan 12-04 can call `await getActiveImageProvider()` and `await getOpenAIApiKey(req.profile)` with no `as any` casts
- Plan 12-04 should re-run `npx tsx scripts/verify-phase-12.ts` after its wiring — must stay green
- Plan 12-05 extends `verify-phase-12.ts` with PROV-05 (admin UI) + PROV-07 (wire-through) checks

## Self-Check: PASSED

Files verified to exist:
- `supabase/migrations/20260517_image_provider_settings.sql` — FOUND
- `shared/schema.ts` with `openai_api_key` field — FOUND
- `server/services/app-settings.service.ts` with `getPlatformSetting` — FOUND
- `server/middleware/auth.middleware.ts` with `getOpenAIApiKey` — FOUND
- `server/services/image-provider.ts` with `getActiveImageProvider` — FOUND
- `scripts/verify-phase-12.ts` — FOUND

Commits verified:
- `7462c75`, `902f71d`, `37e6fa7`, `c3d96f3` — all present in git log

---
*Phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative*
*Completed: 2026-05-17*
