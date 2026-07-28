---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 02
subsystem: database
tags: [zod, supabase, postgres, rls, schema-contract]

# Dependency graph
requires:
  - phase: 23-deterministic-typography-and-edit-fidelity
    provides: typographyMetaSchema, posts.base_image_url/typography_meta pattern (reused verbatim for carousel slides)
provides:
  - artDirectionSchema (photography_type/lighting/composition/texture/negative_prompts) + EMPTY_ART_DIRECTION default, added to brandStyleSchema and postMoodSchema
  - styleReferencePhotoSchema/createStyleReferencePhotoSchema/STYLE_REFERENCE_SCOPES/MAX_STYLE_REFERENCE_PHOTOS for admin-curated style reference boards
  - postSlideSchema/postSlideVersionSchema gain base_image_url/typography_meta (nullable, mirrors posts/post_versions)
  - two additive SQL migrations: post_slides/post_slide_versions typography columns, and the new style_reference_photos table with inverted-ACL RLS
affects: [25-03, 25-04, 25-05, 25-06, 25-07, 25-08, 25-09, 25-10, 25-11, 25-12, 25-13, 25-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-with-defaults Zod fields backfill every stored JSONB blob with no migration (same mechanism as aiModelsSchema.planning/critic)"
    - "Inverted-ACL RLS (public SELECT USING (true) + admin-only write via profiles.is_admin EXISTS subquery) copied verbatim from app_settings for platform-wide, non-user-owned tables"

key-files:
  created:
    - supabase/migrations/20260729000000_post_slides_base_image_typography.sql
    - supabase/migrations/20260729000001_style_reference_photos.sql
  modified:
    - shared/schema.ts
    - client/src/components/admin/post-creation/brand-styles-card.tsx
    - client/src/components/admin/post-creation/post-moods-card.tsx

key-decisions:
  - "art_direction default lives as a standalone EMPTY_ART_DIRECTION constant (not inlined) so both the schema .default() and the two admin-UI new-item literals (Rule-3 fix) share one source of truth"
  - "style_reference_photos.style_id is a plain TEXT column (no FK) because it references a style_catalog JSONB entry id, not a relational row"

patterns-established: []

requirements-completed: [PLAN-05, PLAN-07, CRSL2-01, CRSL2-02]

# Metrics
duration: 8min
completed: 2026-07-28
---

# Phase 25 Plan 02: Data Contracts Foundation Summary

**Additive Zod schemas (artDirectionSchema, styleReferencePhotoSchema, carousel-slide typography fields) plus two additive SQL migrations, landing every Phase 25 data contract before any downstream plan needs to invent its own types.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 3
- **Files modified:** 5 (1 created new content in schema.ts, 2 new migration files, 2 Rule-3 auto-fixes)

## Accomplishments
- `brandStyleSchema`/`postMoodSchema` gained a dense `art_direction` field (photography_type, lighting, composition, texture, negative_prompts) with a fully-additive default (`EMPTY_ART_DIRECTION`) — every pre-Phase-25 stored `style_catalog` blob still parses with zero migration.
- New platform-wide `styleReferencePhotoSchema`/`createStyleReferencePhotoSchema` contract (+ `STYLE_REFERENCE_SCOPES`, `MAX_STYLE_REFERENCE_PHOTOS`) for admin-curated style reference boards (PLAN-07).
- `postSlideSchema`/`postSlideVersionSchema` gained `base_image_url`/`typography_meta` (nullable, default null), reusing Phase 23's `typographyMetaSchema` verbatim — legacy carousel slides parse as NULL forever.
- Two additive SQL migrations: `post_slides`/`post_slide_versions` typography columns, and the new `style_reference_photos` table with genuinely inverted-ACL RLS (public read / admin-only write), copied from the `app_settings` precedent.

## Task Commits

Each task was committed atomically:

1. **Task 1: artDirectionSchema + styleReferencePhotoSchema in shared/schema.ts** - `a610593` (feat)
2. **Task 2: carousel slide typography fields in shared/schema.ts** - `5984ecf` (feat)
3. **Task 3: two additive SQL migrations** - `b6154ce` (feat)

**Plan metadata:** (pending — final docs commit)

_Note: tasks were tagged `tdd="true"` in the plan, but the actual test harness (`scripts/verify-phase-25.ts`) is owned by the sibling parallel plan 25-01 and was not guaranteed to exist at task-execution time (confirmed: it did not exist until 25-01 landed mid-session). Each task was instead verified directly against its own literal `acceptance_criteria` (inline `npx tsx -e` parse checks + `grep -c` counts + `npm run check`) before committing, which served as the equivalent RED→GREEN gate without a separate throwaway test-file commit._

## Files Created/Modified
- `shared/schema.ts` - `artDirectionSchema`/`EMPTY_ART_DIRECTION`, `art_direction` field on `brandStyleSchema`/`postMoodSchema`, `styleReferencePhotoSchema`/`createStyleReferencePhotoSchema`/`STYLE_REFERENCE_SCOPES`/`MAX_STYLE_REFERENCE_PHOTOS`, `base_image_url`/`typography_meta` on `postSlideSchema`/`postSlideVersionSchema`
- `supabase/migrations/20260729000000_post_slides_base_image_typography.sql` - additive `base_image_url`/`typography_meta` columns on `post_slides` + `post_slide_versions`
- `supabase/migrations/20260729000001_style_reference_photos.sql` - new `style_reference_photos` table, index, RLS (public SELECT, admin-only INSERT/UPDATE/DELETE)
- `client/src/components/admin/post-creation/brand-styles-card.tsx` - Rule-3 fix: `addStyle()`'s literal now includes `art_direction: EMPTY_ART_DIRECTION`
- `client/src/components/admin/post-creation/post-moods-card.tsx` - Rule-3 fix: `addMood()`'s literal now includes `art_direction: EMPTY_ART_DIRECTION`

## Decisions Made
- Reused `EMPTY_ART_DIRECTION` as a shared constant rather than repeating the empty-object literal three times (schema default + two admin-UI call sites), keeping the "empty" shape defined once.
- Kept `style_reference_photos.style_id` as a bare `TEXT` column with no foreign key, since it addresses a JSONB catalog entry id inside `app_settings.style_catalog`, not a relational table row — documented in the migration's header comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `art_direction` now-required field broke two admin-UI literal constructors**
- **Found during:** Task 1 (adding `art_direction` to `brandStyleSchema`/`postMoodSchema`)
- **Issue:** `npm run check` failed — `brand-styles-card.tsx`'s `addStyle()` and `post-moods-card.tsx`'s `addMood()` each construct a new catalog-entry object literal typed against `StyleCatalog`'s `styles`/`post_moods` arrays; neither literal included the newly-required `art_direction` field.
- **Fix:** Added `art_direction: EMPTY_ART_DIRECTION` to both literals, importing `EMPTY_ART_DIRECTION` from `@shared/schema` in both files.
- **Files modified:** `client/src/components/admin/post-creation/brand-styles-card.tsx`, `client/src/components/admin/post-creation/post-moods-card.tsx`
- **Verification:** `npm run check` exits 0 after the fix.
- **Committed in:** `a610593` (Task 1 commit)

**2. [Rule 1 - Bug] Migration header comment accidentally contained the forbidden `user_id = auth.uid()` literal**
- **Found during:** Task 3 (writing `20260729000001_style_reference_photos.sql`)
- **Issue:** The plan's acceptance criteria requires `grep -c "user_id = auth.uid()"` on the migration file to return 0 (proving the RLS is genuinely inverted, not copy-pasted from `brand_reference_photos`' owner-only pattern). The explanatory header comment described the *contrasting* pattern and happened to contain that exact substring, tripping the check even though no actual policy used it.
- **Fix:** Reworded the comment to describe the same contrast without the literal substring (`auth.uid()` still mentioned, but not as `user_id = auth.uid()`).
- **Files modified:** `supabase/migrations/20260729000001_style_reference_photos.sql`
- **Verification:** `grep -c "user_id = auth.uid()" ...` now returns 0; all other Task 3 acceptance criteria unaffected.
- **Committed in:** `b6154ce` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule-3 blocking, 1 Rule-1 bug)
**Impact on plan:** Both fixes necessary for `npm run check`/acceptance-criteria correctness. No scope creep — no new files beyond the plan's declared `files_modified` plus the two client-side call sites the schema change directly broke.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required

None - no external service configuration required. The two new migrations must still be applied to the live Supabase project before any later Phase 25 plan can exercise them against real data — same "not yet applied" state as every other pending Phase 23/24 migration in this environment (no Supabase SQL editor access available here).

## Next Phase Readiness

- Every Phase 25 data contract now exists and is additive: `artDirectionSchema`, `styleReferencePhotoSchema`, and the carousel-slide typography fields. Plans 25-03 through 25-14 can import real types instead of inventing parallel shapes.
- `scripts/verify-phase-25.ts --only=svc-aesthetic-dna-catalog` (installed concurrently by sibling plan 25-01): the 3 schema-shape checks are green; the `DEFAULT_STYLE_CATALOG` dense-content checks correctly stay red (25-05's job).
- `scripts/verify-phase-25.ts --only=svc-style-reference-boards`: the 5 migration/schema checks are green; the route/service/merge-priority checks correctly stay red (25-04+'s job).
- Zero regression: `scripts/verify-phase-23.ts` (86/86-equivalent full suite) and `scripts/verify-phase-24.ts` (55/55-equivalent full suite) both pass in full after this plan's changes.
- The two new migrations are not yet applied to any live database — no Supabase access in this execution environment (same standing blocker as Phases 21.1/22/23/24).

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: 2026-07-28*

## Self-Check: PASSED

All 5 created/modified files found on disk; all 3 task commits (`a610593`, `5984ecf`, `b6154ce`) found in git history.
