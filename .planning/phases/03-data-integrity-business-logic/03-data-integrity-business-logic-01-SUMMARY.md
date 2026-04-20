---
phase: 03-data-integrity-business-logic
plan: 01
subsystem: api
tags: [express, supabase, gemini, video, edit]
requires:
  - phase: 02-supabase-client-correctness
    provides: stable edit-route storage behavior and shared auth helpers for follow-up business-logic fixes
provides:
  - persisted video aspect-ratio recovery from post prompt context during edits
  - one shared Gemini key selection path for the edit route
affects: [edit-flow, video-generation, billing]
tech-stack:
  added: []
  patterns:
    - recover missing edit-only derived values from persisted ai_prompt_used text
    - reuse shared Gemini key helpers and map operation-specific copy only at the route boundary
key-files:
  created:
    - .planning/phases/03-data-integrity-business-logic/03-data-integrity-business-logic-01-SUMMARY.md
  modified:
    - server/routes/edit.routes.ts
key-decisions:
  - "Recovered video edit ratios by scanning posts.ai_prompt_used for 9:16 or 16:9 and defaulting only to 9:16 when no persisted ratio exists."
  - "Kept edit-specific missing-key copy at the route boundary while routing Gemini key selection through the shared auth helper path."
patterns-established:
  - "Use persisted prompt context to recover edit metadata when schema work is out of scope."
  - "Centralize own-key Gemini decisions through auth middleware helpers before edit billing logic runs."
requirements-completed: [DATA-01, DATA-05]
duration: 1min
completed: 2026-04-20
---

# Phase 3 Plan 1: Edit Ratio And Key Path Summary

**Video edits now reuse persisted `9:16` or `16:9` intent and the edit route resolves Gemini API keys through one shared decision path.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-20T20:52:30Z
- **Completed:** 2026-04-20T20:53:21Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Replaced the broken `post.aspect_ratio` read with tolerant `ai_prompt_used` parsing and a `9:16` fallback.
- Normalized the recovered video ratio to the current Veo contract before calling `generateVideo`.
- Collapsed edit-route Gemini key selection onto `usesOwnApiKey()` plus `getGeminiApiKey()` with one edit-specific own-key error message.

## Task Commits

Each task was committed atomically:

1. **Task 1: Recover and normalize the persisted video aspect ratio** - `c97f20b` (fix)
2. **Task 2: Collapse edit Gemini key selection to one shared helper path** - `c97f20b` (fix)

**Plan metadata:** Recorded in the final Phase 3 docs commit.

## Files Created/Modified
- `server/routes/edit.routes.ts` - Adds persisted aspect-ratio recovery for video edits and reuses the shared Gemini key helper path with one route-level edit message.

## Decisions Made
- Recovered aspect ratio from persisted prompt text instead of widening scope into schema storage changes.
- Preserved the route's edit-specific missing-key copy while delegating the actual key decision to shared middleware helpers.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Manual verification still requires authenticated edit requests plus existing video posts whose `ai_prompt_used` contains both portrait and landscape ratios.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The edit route no longer depends on a nonexistent `posts.aspect_ratio` column and now follows one Gemini key-selection path.
- Manual route checks remain for portrait and landscape video edits plus missing-key edit responses in a live environment.

## Self-Check: PASSED

---
*Phase: 03-data-integrity-business-logic*
*Completed: 2026-04-20*
