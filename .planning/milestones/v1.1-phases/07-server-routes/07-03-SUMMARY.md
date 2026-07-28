---
phase: 07-server-routes
plan: 03
subsystem: api
tags: [express, routing, carousel, enhancement, index]

requires:
  - phase: 07-server-routes
    plan: 01
    provides: carousel.routes.ts with POST /api/carousel/generate
  - phase: 07-server-routes
    plan: 02
    provides: enhance.routes.ts with POST /api/enhance

provides:
  - server/routes/index.ts wired with carouselRoutes and enhanceRoutes
  - POST /api/carousel/generate reachable by Express app
  - POST /api/enhance reachable by Express app

affects: [client, dashboard, posts]

tech-stack:
  added: []
  patterns:
    - "Flat router.use() registration — route files define full paths, mounted without prefix"
    - "Named export block extended with new route modules for selective registration"

key-files:
  created: []
  modified:
    - server/routes/index.ts (added carousel + enhance import, router.use, and named export)
    - server/routes/carousel.routes.ts (brought in from main — Phase 7-01 output)
    - server/routes/enhance.routes.ts (brought in from main — Phase 7-02 output)
    - server/services/carousel-generation.service.ts (brought in from main — Phase 6-02 output)
    - server/services/enhancement.service.ts (brought in from main — Phase 6-03 output)
    - shared/schema.ts (brought in from main — Phase 5 output)
    - server/quota.ts (brought in from main — Phase 5/6 output)
    - server/routes/generate.routes.ts (brought in from main — fixed pipelineContentType)
    - client/src/components/post-creator-dialog.tsx (brought in from main — slide_count/idempotency_key alignment)
    - client/src/pages/posts.tsx (brought in from main — slide_count/idempotency_key alignment)

key-decisions:
  - "Checked out all Phase 5/6/7 source files from main into worktree (Rule 3 deviation — worktree predates Phase 5 commit)"
  - "No prefix argument on router.use() for carousel and enhance — route files define full API paths matching existing pattern"

requirements-completed: [CRSL-01, ENHC-01]

duration: 3min
completed: 2026-04-22
---

# Phase 7 Plan 03: Wire Carousel and Enhance Routes into Router Index Summary

**Two surgical additions to server/routes/index.ts — import carouselRoutes and enhanceRoutes, register with router.use(), and add to named exports block; both Phase 7 endpoints now reachable by Express**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-22T18:13:00Z
- **Completed:** 2026-04-22T18:16:00Z
- **Tasks:** 1
- **Files modified:** 1 (index.ts core edit) + 9 (brought in from main)

## Accomplishments

- Added `import carouselRoutes from "./carousel.routes.js"` and `import enhanceRoutes from "./enhance.routes.js"` under a `// v1.1 media creation routes` comment block
- Added `router.use(carouselRoutes)` and `router.use(enhanceRoutes)` in the Core routes group after `router.use(editRoutes)`
- Added `carouselRoutes` and `enhanceRoutes` to the named exports block under Core routes
- Brought in all Phase 5/6/7 dependency files from main branch (carousel/enhance services, schema, quota, frontend pages) to resolve TypeScript errors
- `npm run check` exits 0 — no TypeScript errors

## Task Commits

1. **Task 1: Wire carousel and enhance routes into server/routes/index.ts** - `bfb3333` (feat)

## Files Created/Modified

- `server/routes/index.ts` - Added v1.1 import block, two router.use() calls, two named exports
- `server/routes/carousel.routes.ts` - Phase 7-01 output (brought in from main)
- `server/routes/enhance.routes.ts` - Phase 7-02 output (brought in from main)
- `server/services/carousel-generation.service.ts` - Phase 6-02 output (brought in from main)
- `server/services/enhancement.service.ts` - Phase 6-03 output (brought in from main)
- `shared/schema.ts` - Phase 5 output with carouselRequestSchema/enhanceRequestSchema (from main)
- `server/quota.ts` - Phase 5/6 output with slideCount param (from main)
- `server/routes/generate.routes.ts` - pipelineContentType fix (from main)
- `client/src/components/post-creator-dialog.tsx` - slide_count/idempotency_key alignment (from main)
- `client/src/pages/posts.tsx` - slide_count/idempotency_key alignment (from main)

## Decisions Made

- No prefix argument on `router.use(carouselRoutes)` and `router.use(enhanceRoutes)` — route files define full paths (`/api/carousel/generate`, `/api/enhance`) matching the flat-mount pattern used by all other routes in the file
- Brought all Phase 5/6/7 source files from main since this worktree was initialized from commit `f87ffc0` (pre-Phase-5)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Brought Phase 5/6/7 dependency files from main branch**
- **Found during:** Task 1 (TypeScript check after editing index.ts)
- **Issue:** Worktree predates Phase 5/6/7. `carousel.routes.ts` and `enhance.routes.ts` did not exist in the worktree; shared/schema.ts, quota.ts, generate.routes.ts, and client pages were all pre-Phase-5 versions causing TypeScript errors.
- **Fix:** `git checkout main -- server/routes/carousel.routes.ts server/routes/enhance.routes.ts server/services/* shared/schema.ts server/quota.ts server/routes/generate.routes.ts client/src/components/post-creator-dialog.tsx client/src/pages/posts.tsx`
- **Files modified:** All listed in key-files above
- **Commit:** bfb3333

---

**Total deviations:** 1 auto-fixed (blocking dependency — same pattern as Plan 07-02)
**Impact on plan:** Essential for TypeScript check to pass. No scope creep.

## Known Stubs

None — server/routes/index.ts wires directly to the two route modules. No hardcoded empty values.

## Self-Check: PASSED

- `server/routes/index.ts` modified: YES
- `grep -c "carouselRoutes" server/routes/index.ts` = 3: YES (import + router.use + export)
- `grep -c "enhanceRoutes" server/routes/index.ts` = 3: YES (import + router.use + export)
- `grep -c "router.use(carouselRoutes)" server/routes/index.ts` = 1: YES
- `grep -c "router.use(enhanceRoutes)" server/routes/index.ts` = 1: YES
- `grep -c "router.use(generateRoutes)" server/routes/index.ts` = 1: YES (unchanged)
- `grep -c "router.use(editRoutes)" server/routes/index.ts` = 1: YES (unchanged)
- `npm run check` exits 0: YES
- Commit `bfb3333` exists: YES
