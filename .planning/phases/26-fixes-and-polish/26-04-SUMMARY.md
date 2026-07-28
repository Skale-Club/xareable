---
phase: 26-fixes-and-polish
plan: 04
subsystem: api
tags: [idempotency, crypto.randomUUID, react, typescript, fetchSSE, quick-remake]

# Dependency graph
requires:
  - phase: 26-01
    provides: scripts/verify-phase-26.ts's [svc-idempotency] tag group (fixtures + check definitions this plan's client-side sub-check satisfies)
provides:
  - "All four client-initiated generate/edit call sites now generate and send a fresh idempotency_key per submit"
  - "buildQuickRemakeRequest's widened EditPostRequest & { idempotency_key: string } return type, ready for plan 26-06 to collapse back to plain EditPostRequest once the server schema gains the field"
affects: [26-06 (server-side generate/edit idempotency contract, wave 3), 26-08 (post-viewer-dialog.tsx, confirmed untouched by this plan)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One idempotency_key generated via crypto.randomUUID() per user-initiated submit, declared inline in the handler (not component state, not useMemo) — mirrors the existing carousel/enhancement client pattern verbatim"
    - "Type-level intersection (EditPostRequest & { idempotency_key: string }) used to widen a shared-schema-typed return value ahead of the server schema change, so the file type-checks both before and after the dependent plan lands"

key-files:
  created: []
  modified:
    - client/src/components/post-creator-dialog.tsx
    - client/src/components/post-edit-dialog.tsx
    - client/src/lib/quick-remake.ts
    - client/src/pages/posts.tsx

key-decisions:
  - "post-viewer-dialog.tsx left completely untouched — buildQuickRemakeRequest's return value covers its quick-remake path with zero edits, avoiding a conflict with plan 26-08 which owns that file"
  - "The isCarouselSlide branch in post-edit-dialog.tsx's handleGenerateEdit and buildCarouselSlideQuickRemakeRequest in quick-remake.ts were deliberately left without an idempotency_key — POST /api/carousel/slide/edit has no idempotency contract and gains none per 26-CONTEXT.md"
  - "The two pre-existing idempotency_key: null optimistic-post literals in post-creator-dialog.tsx (line ~572) and posts.tsx (lines ~559, ~658) were left unchanged — they are local Post-shaped cache objects, not request bodies"

patterns-established: []

requirements-completed: [POL-06]

# Metrics
duration: ~25min
completed: 2026-07-28
---

# Phase 26 Plan 04: Client-Side Idempotency Keys Summary

**All four client `/api/generate`/`/api/edit-post` call sites (handleGenerate, handleGenerateEdit, buildQuickRemakeRequest, gallery quick-remake) now generate and send a fresh `crypto.randomUUID()` per submit, landing ahead of the server-side contract (plan 26-06) so no commit boundary ever has the client fail to satisfy the server.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `post-creator-dialog.tsx`'s `handleGenerate` sends `idempotency_key` on `POST /api/generate`, matching the already-working carousel/enhancement idiom exactly.
- `post-edit-dialog.tsx`'s `handleGenerateEdit` sends `idempotency_key` on the `/api/edit-post` branch only — the carousel-slide-edit branch (`POST /api/carousel/slide/edit`) is provably untouched.
- `quick-remake.ts`'s `buildQuickRemakeRequest` now emits `idempotency_key: crypto.randomUUID()` and its return type is widened to `EditPostRequest & { idempotency_key: string }`, covering `post-viewer-dialog.tsx`'s quick-remake path with zero edits to that file.
- `posts.tsx`'s gallery quick-remake handler sends the same fresh key on its `apiRequest("POST", "/api/edit-post", ...)` call.

## Task Commits

Each task was committed atomically:

1. **Task 1: idempotency_key on the two SSE dialog call sites** - `05fadab` (feat)
2. **Task 2: idempotency_key on the two quick-remake call sites** - `fdfcb59` (feat)

**Plan metadata:** (this commit) `docs(26-04): complete client-side-idempotency-keys plan`

## Files Created/Modified
- `client/src/components/post-creator-dialog.tsx` - `handleGenerate` declares `const idempotencyKey = crypto.randomUUID();` and adds `idempotency_key: idempotencyKey` as the last field of the `/api/generate` request body
- `client/src/components/post-edit-dialog.tsx` - `handleGenerateEdit` declares the same per-submit key and adds it only to the non-carousel `/api/edit-post` body branch
- `client/src/lib/quick-remake.ts` - `buildQuickRemakeRequest` return type widened via intersection; return literal gains `idempotency_key: crypto.randomUUID()`; `buildCarouselSlideQuickRemakeRequest` untouched
- `client/src/pages/posts.tsx` - gallery quick-remake's `apiRequest` body gains `idempotency_key: crypto.randomUUID()`; the two unrelated `idempotency_key: null` optimistic-post literals left untouched

## Decisions Made
- None beyond what's captured in `key-decisions` above — plan executed as specified, including the orchestrator's pre-execution grep-count corrections (post-creator-dialog.tsx → 5 occurrences, quick-remake.ts → 2 occurrences).

## Deviations from Plan

None - plan executed exactly as written (using the corrected acceptance-criteria counts supplied in the execution context).

## Issues Encountered

The plan's own overall `<verification>` step 2 states "9 occurrences" of `idempotency_key` across `client/src` — that count predates the orchestrator's grep-count correction applied to this plan's per-task acceptance criteria (post-creator-dialog.tsx 4→5, quick-remake.ts 1→2). The actual, correct total after this plan is **11** (5 + 1 + 3 + 2 + 0 across the five files), and every individual task-level acceptance criterion — which was explicitly corrected and is the authoritative spec — passes exactly as specified. This is a stale informational count in the plan's aggregate verification section, not a defect in the implementation.

`npx tsx scripts/verify-phase-26.ts --only=svc-idempotency` exits 1 (7 FAIL) as expected — its client-side sub-checks (`OUT-OF-SCOPE GUARD` and `all four client call sites ... generate and send an idempotency_key`) both PASS; every remaining failure names a server-side artifact (`shared/schema.ts`, `generate.routes.ts`, `edit.routes.ts`, the `post_versions` migration) explicitly owned by plan 26-06.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Client sends are in place and harmless today (the server schemas currently strip unknown fields via Zod's default behavior, so `npm run check`/`npm run build` are clean and runtime behavior is unchanged). Plan 26-06 (wave 3) can now add the server-side `idempotency_key` fields/pre-flight-dedup/migration without ever hitting a window where the client fails to satisfy the server contract. `client/src/components/post-viewer-dialog.tsx` remains untouched and available for plan 26-08.

---
*Phase: 26-fixes-and-polish*
*Completed: 2026-07-28*

## Self-Check: PASSED

All created/modified files found on disk; both task commits (`05fadab`, `fdfcb59`) confirmed present in `git log --oneline --all`.
