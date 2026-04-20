---
phase: 03-data-integrity-business-logic
plan: 02
subsystem: api
tags: [express, supabase, storage, cleanup, media]
requires:
  - phase: 02-supabase-client-correctness
    provides: admin-scoped storage deletion patterns for post media cleanup
provides:
  - expired-post cleanup reads version thumbnails alongside primary media
  - expired storage deletion removes deduplicated version image and thumbnail objects
affects: [post-cleanup, storage, admin-maintenance]
tech-stack:
  added: []
  patterns:
    - expired cleanup must collect both image_url and thumbnail_url for every media-backed row
    - keep cleanup response shapes stable while expanding the storage path set
key-files:
  created:
    - .planning/phases/03-data-integrity-business-logic/03-data-integrity-business-logic-02-SUMMARY.md
  modified:
    - server/routes/posts.routes.ts
key-decisions:
  - "Scoped DATA-02 to the remaining expired-cleanup thumbnail leak and left the direct version-delete branch unchanged."
  - "Kept the existing deduplicated storage path assembly and only expanded the version URL inputs feeding it."
patterns-established:
  - "Expired cleanup queries should fetch every stored URL variant needed for storage deletion in one pass."
  - "Preserve existing cleanup response parsing while fixing orphaned media coverage gaps."
requirements-completed: [DATA-02]
duration: 1min
completed: 2026-04-20
---

# Phase 3 Plan 2: Expired Cleanup Summary

**Expired post cleanup now removes both version images and version thumbnails from `user_assets` without changing the cleanup response contract.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-20T20:52:30Z
- **Completed:** 2026-04-20T20:53:21Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Extended the expired `post_versions` read to include `thumbnail_url` alongside `image_url`.
- Added version thumbnails to the deduplicated storage path list used by the admin cleanup delete call.
- Kept the direct version-delete flow untouched because it already removed thumbnail objects correctly.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend expired version reads to include thumbnail URLs** - `8942bc2` (fix)
2. **Task 2: Add version thumbnails to the expired storage removal list** - `8942bc2` (fix)

**Plan metadata:** Recorded in the final Phase 3 docs commit.

## Files Created/Modified
- `server/routes/posts.routes.ts` - Expands expired cleanup version reads and the deduplicated `user_assets` deletion list to cover thumbnail objects.

## Decisions Made
- Fixed only the expired-cleanup thumbnail leak rather than widening scope into a broader delete-route rewrite.
- Preserved the existing `cleanupExpiredPostsResponseSchema` response shape while completing storage cleanup coverage.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Manual verification still requires an expired post fixture with version thumbnails in a live Supabase storage bucket.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Expired cleanup now has the data it needs to delete both stored file variants for versioned media.
- Manual cleanup verification remains for seeded expired posts with version thumbnails.

## Self-Check: PASSED

---
*Phase: 03-data-integrity-business-logic*
*Completed: 2026-04-20*
