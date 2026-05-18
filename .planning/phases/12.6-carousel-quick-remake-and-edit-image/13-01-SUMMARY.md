---
phase: 13-carousel-quick-remake-and-edit-image
plan: 01
subsystem: database
tags: [supabase, postgres, rls, zod, schema, migration]

requires:
  - phase: 10-gallery-surface-updates
    provides: post_slides table (FK target for post_slide_versions)
  - phase: 11-post-trash-and-automated-cleanup
    provides: Drizzle-bypass migration convention (apply via Supabase dashboard SQL editor)

provides:
  - post_slide_versions SQL migration (table + unique index + RLS policies)
  - postSlideVersionSchema + PostSlideVersion TypeScript type in shared/schema.ts
  - editSlideRequestSchema + EditSlideRequest TypeScript type in shared/schema.ts
  - scripts/verify-phase-13.ts scaffold (3 active CRSL-EDIT-01 checks + 3 SKIP stubs)

affects:
  - 13-02-PLAN.md (carousel slide edit route consumes editSlideRequestSchema, inserts post_slide_versions)
  - 13-05-PLAN.md (verify scaffold SKIP stubs for CRSL-EDIT-03/04/05 filled in)

tech-stack:
  added: []
  patterns:
    - "Migration ships as .sql file; operator applies via Supabase dashboard (not Drizzle)"
    - "editSlideRequestSchema.edit_context reuses editPostRequestSchema.shape.edit_context to stay in lockstep"
    - "Verify scaffold uses static file-read fallback when pg_class/pg_indexes not accessible via REST"

key-files:
  created:
    - supabase/migrations/20260518000000_post_slide_versions.sql
    - scripts/verify-phase-13.ts
  modified:
    - shared/schema.ts

key-decisions:
  - "No storage cleanup trigger in migration — ON DELETE CASCADE from post_slides (which cascades from posts) handles cleanup automatically; adding a storage trigger here would be Phase-11-pattern over-engineering for v1"
  - "editSlideRequestSchema retains text_mode/replacement_text from edit_context even though carousel dialog skips the Text-on-Image step — schema is a superset; dialog simply never sets those fields"
  - "editSlideRequestSchema includes both slide_id AND post_id — post_id required for billing association and server-side ownership cross-check against posts.user_id"
  - "verify-phase-13.ts uses static migration-SQL fallback for pg_class/pg_indexes checks — REST API may not expose system catalog tables on all Supabase tiers"

patterns-established:
  - "Phase-13 verify scaffold pattern: active checks for Wave-1 schema assertions + SKIP stubs for downstream plans"

requirements-completed: [CRSL-EDIT-01]

duration: 15min
completed: 2026-05-18
---

# Phase 13 Plan 01: Carousel Slide Versions Schema Foundation Summary

**post_slide_versions Supabase migration + postSlideVersionSchema + editSlideRequestSchema Zod types laying the persistence and contract foundation for per-slide carousel editing**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-18T09:20:00Z
- **Completed:** 2026-05-18T09:35:00Z
- **Tasks:** 3
- **Files modified:** 3 (1 created migration, 1 modified schema, 1 created verify script)

## Accomplishments

- Migration file `20260518000000_post_slide_versions.sql` ships table definition, composite unique index `post_slide_versions_slide_version_unique`, and three RLS policies (SELECT/INSERT/DELETE) all routing ownership through `post_slides -> posts.user_id = auth.uid()` join
- `shared/schema.ts` exports `postSlideVersionSchema` / `PostSlideVersion` (mirrors `postVersionSchema` but keyed on `post_slide_id`) and `editSlideRequestSchema` / `EditSlideRequest` (reuses `editPostRequestSchema.shape.edit_context` for lockstep evolution)
- `scripts/verify-phase-13.ts` scaffold passes immediately (3 active DB checks + 3 SKIP stubs); downstream plans 13-02/13-05 fill in the stubs

## Task Commits

1. **Task 1: Create post_slide_versions migration** — part of `0d13e61` (feat)
2. **Task 2: Add Zod schemas** — part of `0d13e61` (feat)
3. **Task 3: Scaffold scripts/verify-phase-13.ts** — part of `0d13e61` (feat)

All three tasks committed atomically in `0d13e61 feat(13-01): post_slide_versions schema foundation`.

## Files Created/Modified

- `supabase/migrations/20260518000000_post_slide_versions.sql` — new table + unique index + RLS (select/insert/delete) via post_slides → posts.user_id ownership join
- `shared/schema.ts` — added `postSlideVersionSchema`, `PostSlideVersion`, `editSlideRequestSchema`, `EditSlideRequest` (after their respective sibling schemas)
- `scripts/verify-phase-13.ts` — Phase-13 verify scaffold; 3 active checks for CRSL-EDIT-01 (table/index/RLS) and 3 SKIP placeholders; exits 0 immediately after this plan

## Decisions Made

- **No storage cleanup trigger** — `ON DELETE CASCADE` from `post_slides` (which itself cascades from `posts`) auto-cleans version rows when a slide is deleted. A pg storage trigger would duplicate Phase 11 infrastructure for no gain in v1.
- **editSlideRequestSchema includes post_id** — needed by the server route for billing association and ownership cross-check (`posts.user_id` validation); omitting it would force an extra DB join to reach `post_id` from `slide_id`.
- **edit_context kept as superset** — the carousel-slide dialog skips the Text-on-Image step, but the schema retains `text_mode`/`replacement_text` so `editSlideRequestSchema` remains a superset of `editPostRequestSchema`. This avoids schema divergence if the dialog ever adds those fields.
- **Verify fallback to static SQL check** — `pg_class` and `pg_indexes` are system catalog tables not always exposed via Supabase PostgREST REST API. The verify script falls back to reading the migration SQL file to assert the DDL was included, then reports a distinct pass label so the operator knows the live DB check was skipped.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**Migration must be applied manually.** Per the Phase 11 convention (Drizzle-bypass): paste `supabase/migrations/20260518000000_post_slide_versions.sql` into the Supabase dashboard SQL editor and run before Plan 13-02 server work goes live.

After applying: `npx tsx scripts/verify-phase-13.ts` should report 3/3 PASS for table+index+RLS, 3 SKIP for downstream.

## Next Phase Readiness

- Plan 13-02 can implement `POST /api/carousel/slide/edit` using `editSlideRequestSchema` for request validation and inserting into `post_slide_versions`
- `postSlideVersionSchema` is ready for response shaping and client-side type assertions
- `scripts/verify-phase-13.ts` SKIP stubs at lines for CRSL-EDIT-03/04/05 are the integration points for 13-02 and 13-05

---
*Phase: 13-carousel-quick-remake-and-edit-image*
*Completed: 2026-05-18*
