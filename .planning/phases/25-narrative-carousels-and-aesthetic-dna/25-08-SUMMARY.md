---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 08
subsystem: api
tags: [express, supabase, rls, admin, zod]

# Dependency graph
requires:
  - phase: 25-02
    provides: styleReferencePhotoSchema/createStyleReferencePhotoSchema/STYLE_REFERENCE_SCOPES/MAX_STYLE_REFERENCE_PHOTOS + the style_reference_photos migration (inverted-ACL RLS)
provides:
  - "GET/POST/DELETE /api/admin/style-reference-photos — admin-guarded CRUD for platform-wide style/mood reference boards"
  - "server/routes/style-references.routes.ts registered on the live API router (server/routes/index.ts)"
affects: [25-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admin-guarded route file using requireAdminGuard + createAdminSupabase() for platform-wide (non-owner-scoped) tables — mirrors style-catalog.routes.ts's guard idiom combined with brand-references.routes.ts's CRUD/storage-cleanup shape"

key-files:
  created:
    - server/routes/style-references.routes.ts
  modified:
    - server/routes/index.ts

key-decisions:
  - "No public (non-admin) GET route exposed — generation-time reads go through fetchStyleBoardPhotoUrls in style-reference.service.ts (service-role client), and the creator UI has no need for these images, per the plan's explicit instruction"

patterns-established: []

requirements-completed: [PLAN-07]

# Metrics
duration: 8min
completed: 2026-07-28
---

# Phase 25 Plan 08: Admin CRUD Routes for Style Reference Boards Summary

**Three admin-guarded Express endpoints (`GET`/`POST`/`DELETE /api/admin/style-reference-photos`) backed by `createAdminSupabase()`, with an 8-photo cap, auto-position assignment, and best-effort storage cleanup on delete — registered on the live API router.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `server/routes/style-references.routes.ts` exposes the `style_reference_photos` table over HTTP: `GET` (optional `scope`/`style_id` filters, ordered by `style_id`/`position`), `POST` (Zod-validated, 8-photo cap per `(scope, style_id)`, auto-position via `max(position)+1`), and `DELETE` (DB row deleted first for immediate consistency, storage object best-effort cleaned up, failure only `console.warn`-ed).
- Every route calls `requireAdminGuard` before touching data and uses the service-role `createAdminSupabase()` client — matching the inverted-ACL ownership model (public read / admin write) that 25-02's migration established, as opposed to `brand-references.routes.ts`'s user-scoped, RLS-respecting client.
- The router is mounted in `server/routes/index.ts` immediately after `brandReferencesRoutes`, under an extended comment (`// Brand references (Phase 18) + platform style reference boards (Phase 25)`), and added to the trailing `export { ... }` list.

## Task Commits

Each task was committed atomically:

1. **Task 1: admin CRUD routes for style_reference_photos** - `327b2f1` (feat)
2. **Task 2: register the router** - `cbc82fd` (feat)

**Plan metadata:** (pending — final docs commit)

## Files Created/Modified
- `server/routes/style-references.routes.ts` - admin-guarded CRUD (`GET`/`POST`/`DELETE`) for `style_reference_photos`, `getStorageObjectPathFromPublicUrl` copied verbatim from `brand-references.routes.ts`
- `server/routes/index.ts` - imports and mounts `styleReferencesRoutes`, extends the "Brand references (Phase 18)" comment, adds to the trailing export list

## Decisions Made
- Followed the plan's explicit instruction to omit a public (non-admin) `GET` route: generation-time reads use the service-role client via `fetchStyleBoardPhotoUrls` (owned by sibling plan 25-04's `style-reference.service.ts`), and the creator UI never needs to list these images directly.
- Captured the admin's `userId` (from `requireAdminGuard`'s return value) into the inserted row's `created_by` column on `POST`, matching the migration's `created_by UUID REFERENCES auth.users(id)` column.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>` blocks and acceptance criteria without modification.

## Issues Encountered

None. Ran as one of six parallel executor agents (25-03..25-08) sharing this working directory. Two files touched by sibling parallel plans (`server/services/style-reference.service.ts`, `scripts/test-style-reference-merge.ts` — both from 25-04) appeared as untracked/staged in `git status` at various points during execution; per the parallel-execution protocol, only this plan's own files (`server/routes/style-references.routes.ts`, `server/routes/index.ts`) were ever `git add`-ed or committed. One race was caught and handled: before the Task 2 commit, `shared/schema.ts` appeared already staged (by a different concurrent agent) — it was unstaged via `git reset HEAD -- shared/schema.ts` before committing so this plan's commit contained only its own intended file.

## User Setup Required

None - no external service configuration required. (The two Phase 25-02 migrations, including `style_reference_photos`, still need to be applied to the live Supabase project before this endpoint can serve real data — a standing blocker shared with every other pending Phase 21-25 migration in this environment.)

## Next Phase Readiness

- `POST/GET/DELETE /api/admin/style-reference-photos` are live on the API surface and ready for the admin UI (plan 25-11) to consume.
- `scripts/verify-phase-25.ts --only=svc-style-reference-boards`: the migration/schema/route/registration checks (7 of 9 in this tag) are now green; the remaining 2 (`generate.routes.ts`/`carousel-generation.service.ts` calling `planReferenceImageSlots(`) are correctly still red — that's 25-04+'s job, matching this plan's own `<verification>` note.
- Zero regression: `scripts/verify-phase-18.ts` (brand references, 15/15) fully green; `npm run check` and `npm run build` both clean.
- The migration is not yet applied to any live database — no Supabase access in this execution environment (same standing blocker as every other pending Phase 21-25 migration).

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: 2026-07-28*

## Self-Check: PASSED

All 2 created/modified files found on disk (`server/routes/style-references.routes.ts`, `server/routes/index.ts`); both task commits (`327b2f1`, `cbc82fd`) found in git history.
