---
phase: 07-server-routes
plan: 01
subsystem: api
tags: [express, sse, gemini, carousel, idempotency, credits, billing]

# Dependency graph
requires:
  - phase: 06-server-services
    provides: generateCarousel() service with onProgress, CarouselFullFailureError/AbortedError/TextPlanError/InvalidAspectError typed errors, CarouselGenerationResult
  - phase: 05-schema-database-foundation
    provides: carouselRequestSchema, CarouselRequest type, SUPPORTED_LANGUAGES, LOGO_POSITIONS
provides:
  - POST /api/carousel/generate route handler with full SSE pipeline (auth, validation, idempotency, credit gate, generation, billing, sendComplete)
affects:
  - 07-02 (enhance routes — mirrors this structure)
  - 07-03 (route registration in index.ts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pre-SSE JSON gating (auth → profile → Gemini key → brand → Zod validate → idempotency → credit check) before initSSE
    - onProgress callback mapping CarouselProgressEvent types to SSE progress percentages
    - AbortController + 260s safety timer pattern for Vercel function lifetime management
    - Deterministic single-path billing: recordUsageEvent ONCE + deductCredits ONCE after service resolves
    - CarouselAbortedError partial-success rehydration from DB when service throws before returning result

key-files:
  created:
    - server/routes/carousel.routes.ts
  modified: []

key-decisions:
  - "Wrote complete SSE pipeline in one pass (Tasks 1+2 combined) since the 501 stub intermediate was unnecessary for TypeScript verification — file compiles in its final form."
  - "Merged main branch into worktree before implementation because worktree was on Phase 4 branch missing Phase 5/6 schema and service code (carouselRequestSchema, carousel-generation.service.ts)."
  - "Used adminSb (createAdminSupabase) for idempotency pre-flight SELECT per D-02 — bypasses RLS while scoping via explicit user_id WHERE clause."
  - "onProgress complete event emits progress tick at 95% (not sendComplete) — billing runs synchronously after generateCarousel() resolves, then sendComplete fires once."
  - "CarouselAbortedError with savedSlideCount>=1: rehydrate post+slides from DB using adminSb (service persisted them before throwing) then apply normal billing path."

patterns-established:
  - "Pattern 1: Carousel route pre-SSE order — auth → profile (is_admin/is_affiliate/is_business/api_key) → getGeminiApiKey → brand → carouselRequestSchema.safeParse → idempotency adminSb SELECT → checkCredits(slide_count)"
  - "Pattern 2: onProgress switch — map each CarouselProgressEvent type to sendProgress with computed percentage (10 + slideNumber * floor(80/slideCount))"
  - "Pattern 3: Billing after try/catch — clearTimeout(safetyTimer) outside catch, then recordUsageEvent + deductCredits, then sendComplete"

requirements-completed: [CRSL-01, CRSL-05, CRSL-07, CRSL-08, BILL-02, BILL-03, BILL-04]

# Metrics
duration: 4min
completed: 2026-04-22
---

# Phase 07 Plan 01: Carousel Routes Summary

**POST /api/carousel/generate with SSE progress streaming, idempotency gate, per-slide credit deduction, and CarouselAbortedError partial-success billing via DB rehydration**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-22T01:40:03Z
- **Completed:** 2026-04-22T01:43:44Z
- **Tasks:** 2 (implemented as 1 combined pass)
- **Files modified:** 1

## Accomplishments

- Full `POST /api/carousel/generate` route handler with pre-SSE JSON gating and SSE pipeline
- Idempotency pre-flight using admin Supabase client (scoped via user_id), returns JSON 200 on hit without opening SSE
- Credit gate calling `checkCredits(userId, "generate", false, slide_count)` with 4-arg signature for per-slide billing (BILL-01)
- onProgress mapping for all 5 CarouselProgressEvent types with per-slide percentage computation
- All 4 typed error classes handled: CarouselFullFailureError (sendError, no billing), CarouselAbortedError (partial/full failure split), CarouselTextPlanError, CarouselInvalidAspectError
- Single billing path: `recordUsageEvent` once + `deductCredits` once (skipped if ownApiKey), then `sendComplete` with D-03 payload shape

## Task Commits

Both tasks were implemented in a single pass:

1. **Task 1: Scaffold carousel.routes.ts + Task 2: Wire SSE pipeline** - `ee23508` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `server/routes/carousel.routes.ts` — Full `POST /api/carousel/generate` handler (474 lines): auth, validation, idempotency, credit gate, SSE pipeline, error handling, billing

## Decisions Made

- Merged `main` into worktree branch first — worktree was on Phase 4 branch, missing `carouselRequestSchema` from Phase 5 schema and `carousel-generation.service.ts` from Phase 6. The merge was a fast-forward (no conflicts).
- Wrote both Task 1 and Task 2 in a single file creation pass rather than adding a 501 stub — the TypeScript compiler validates the complete pipeline equally well, and there was no reason to create an intermediate broken state.
- Used `adminSb` (admin Supabase client) for the idempotency pre-flight SELECT per D-02 — scoped manually with `.eq("user_id", user.id)` to maintain row ownership semantics without depending on RLS.
- CarouselAbortedError partial-success path rehydrates the post+slides from the DB (service persisted them before throwing) and reconstructs a `CarouselGenerationResult`-shaped object with zero token counts, billing at the flat fallback rate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Merged main branch into worktree before implementing**
- **Found during:** Task 1 (attempting `npm run check`)
- **Issue:** Worktree branch `worktree-agent-a3497d04` was forked from Phase 4 state. `carouselRequestSchema` did not exist in `shared/schema.ts` and `carousel-generation.service.ts` did not exist in `server/services/`. TypeScript could not resolve either import.
- **Fix:** Ran `git merge main` in the worktree — fast-forward, no conflicts. All Phase 5/6 code merged cleanly.
- **Files modified:** 43 files (all Phase 5/6 artifacts from main branch)
- **Verification:** `npm run check` passes with exit 0 after merge
- **Committed in:** Part of the git merge (no additional commit needed — merge was FF)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking)
**Impact on plan:** Required to unblock Task 1. Zero scope creep. All plan code written as specified.

## Issues Encountered

- Worktree branch was not up-to-date with main — required merge before TypeScript check could pass. Fast-forward merge resolved this cleanly.

## User Setup Required

None — no external service configuration required. Route is not yet registered in `server/routes/index.ts` (Plan 07-03 handles wiring).

## Next Phase Readiness

- `server/routes/carousel.routes.ts` is complete and TypeScript-clean
- Router export (`export default router`) is ready for registration in Plan 07-03
- `POST /api/carousel/generate` handles all error paths, billing, and SSE lifecycle
- Plan 07-02 (enhance routes) can mirror this file's structure

---
*Phase: 07-server-routes*
*Completed: 2026-04-22*
