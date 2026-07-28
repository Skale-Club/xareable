---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 04
subsystem: api
tags: [zod, supabase, pure-function, reference-images, priority-merge, no-network-test]

# Dependency graph
requires:
  - phase: 25-narrative-carousels-and-aesthetic-dna
    provides: "25-02's styleReferencePhotoSchema/STYLE_REFERENCE_SCOPES/MAX_STYLE_REFERENCE_PHOTOS + the style_reference_photos migration; 25-01's verify-phase-25.ts svc-style-reference-boards tag"
provides:
  - "server/services/style-reference.service.ts — REFERENCE_IMAGE_SLOT_LIMIT, planReferenceImageSlots (pure), fetchStyleBoardPhotoUrls, fetchReferenceImagesAsBase64, resolveGenerationReferenceImages"
  - "scripts/test-style-reference-merge.ts — 12-assertion no-network proof of the priority-tier slot arithmetic"
affects: [25-09, 25-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-core/impure-shell split: planReferenceImageSlots is 100% synchronous and network-free; all I/O (createAdminSupabase reads, fetch downloads) lives in separate exported functions that call the pure core"
    - "One-call resolver (resolveGenerationReferenceImages) as the single integration point both generation paths (single-image, carousel) will call, instead of each path re-implementing the merge"

key-files:
  created:
    - server/services/style-reference.service.ts
    - scripts/test-style-reference-merge.ts
  modified: []

key-decisions:
  - "Wrote the full service file (pure function + I/O layer) in a single pass instead of splitting Task 1/Task 2 into two file edits — both tasks' code landed in one commit (207a74e), mirroring the same single-commit-for-multiple-tasks precedent already used by sibling plans 25-01/25-02 in this phase. Verified each task's own acceptance criteria independently before treating the plan as complete."
  - "fetchStyleBoardPhotoUrls fails open (returns []) on both the styleId-falsy short-circuit and any Supabase error/throw — a missing or errored style board must never break a generation, matching the plan's explicit contract."
  - "resolveGenerationReferenceImages de-duplicates brand-style and post-mood board URLs by URL, concatenating brand-style board first (per 25-CONTEXT.md's priority language, brand look is more specific than mood), skipping the fetch entirely when both ids are falsy."

patterns-established:
  - "Priority-tier pure merge with tier-disable flags that let unused-tier slots roll down (not get discarded) unless that tier is the last one, in which case unused slots are simply left unspent."

requirements-completed: [PLAN-07]

# Metrics
duration: ~15min
completed: 2026-07-28
---

# Phase 25 Plan 04: Style Reference Slot-Priority Merge Service Summary

**Extracted the reference-image slot-priority merge (user > brand > style-board, 4-slot cap) out of `generate.routes.ts`'s inline block into a pure, network-free `planReferenceImageSlots` function plus a full I/O layer (`fetchStyleBoardPhotoUrls`, `fetchReferenceImagesAsBase64`, `resolveGenerationReferenceImages`), proven by a 12-assertion no-network test harness.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-28T10:40:00Z (approx.)
- **Completed:** 2026-07-28T10:53:00Z
- **Tasks:** 2 (both landed in a single commit — see Decisions Made)
- **Files modified:** 2 (both new files)

## Accomplishments
- `server/services/style-reference.service.ts` created with `REFERENCE_IMAGE_SLOT_LIMIT` (the same 4-slot cap `generate.routes.ts` has always enforced), `planReferenceImageSlots` (pure, mutates nothing, returns fresh `.slice()` copies, honors `includeBrand`/`includeStyleBoard` tier-disable flags with slot roll-down), `fetchStyleBoardPhotoUrls` (service-role read of the new `style_reference_photos` table, fail-open to `[]`), `fetchReferenceImagesAsBase64` (moved verbatim from `generate.routes.ts:197-216`, byte-equivalent behavior, original left in place for 25-09 to remove), and `resolveGenerationReferenceImages` (the one-call resolver both generation paths will consume — fetches brand-style + post-mood boards, de-dupes by URL, plans slots, hydrates to base64).
- `scripts/test-style-reference-merge.ts` created in `scripts/test-aspect-crop.ts`'s exact harness style (`pass`/`fail`/exit-code convention), with 12 assertions covering all 10 `<behavior>` bullets plus the slot-limit constant and a reference-identity (fresh-copy) check. Imports only from `../server/services/style-reference.service.js` — zero Supabase, zero fetch, zero AI modules.
- `npx tsx scripts/test-style-reference-merge.ts` exits 0, 12/12 passed, zero FAIL lines.
- `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards`: 9/11 green — every check this plan owns (migration shape, schema declaration, service exports, the functional no-network harness) is green; the 2 remaining red checks (`generate.routes.ts`/`carousel-generation.service.ts` calling `planReferenceImageSlots(`) are correctly still red, owned by 25-09/25-12.
- Zero regression: `scripts/verify-phase-21.ts` and `scripts/verify-phase-23.ts` both pass in full (including Phase 23's `[svc-cross-plan]` non-regression sweep). `npm run check` exits 0.

## Task Commits

Both tasks landed in one commit (see Decisions Made for rationale):

1. **Task 1 + Task 2: planReferenceImageSlots (pure) + no-network test + style-board fetch/hydration/resolver** - `207a74e` (test)

## Files Created/Modified
- `server/services/style-reference.service.ts` - `REFERENCE_IMAGE_SLOT_LIMIT`, `planReferenceImageSlots`, `fetchStyleBoardPhotoUrls`, `fetchReferenceImagesAsBase64`, `resolveGenerationReferenceImages`, plus the `ReferenceImageData`/`ReferenceSlotInput`/`ReferenceSlotPlan` types
- `scripts/test-style-reference-merge.ts` - 12-assertion no-network functional test proving the priority-tier merge arithmetic

## Decisions Made
- Wrote both tasks' code in a single file-write pass (the pure function and the I/O layer share one natural file, and Task 2's actions were direct appends to Task 1's output with no intervening verification gate that required a separate commit). Verified Task 1's acceptance criteria (test harness, grep counts) and Task 2's acceptance criteria (grep counts, `verify-phase-25.ts --only=svc-style-reference-boards`, zero regression) independently, both green, before considering the plan complete. This mirrors the exact "single commit for multiple tasks" precedent already established by sibling plans 25-01 and 25-02 in this same phase (see their SUMMARY.md files).
- `fetchStyleBoardPhotoUrls` short-circuits to `[]` immediately when `styleId` is falsy (no Supabase call at all in that case) rather than querying with a null filter — cheaper and matches the plan's literal implementation instruction.
- `resolveGenerationReferenceImages` fetches brand-style and post-mood boards in parallel (`Promise.all`) then concatenates brand-style-first before de-duping by URL, rather than fetching them sequentially — no behavioral difference, just avoids an unnecessary await chain.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1-4 triggers encountered; this is an entirely new, isolated file pair with no existing behavior to break and no architectural decisions required. The only adjustment was task-commit granularity (both tasks in one commit instead of two), which is a process deviation already precedented by sibling plans in this phase, not a Rule 1-4 code deviation.

## Issues Encountered

One self-authored test-writing bug (not a deviation from the plan, a mistake in my own first draft of the no-network test): the "ordering within each tier is preserved" assertion initially used 2 user + 2 brand + 2 style images (6 total), which exceeds the 4-slot budget and would never assert what it claimed to prove. Caught immediately by the test's own first run (`FAIL`), fixed by reducing to 1 user + 2 brand + 1 style (4 total, fits exactly within budget so all three tiers appear in full in the output), re-ran green. No production code was affected — `planReferenceImageSlots`'s implementation was correct throughout; only the test fixture was wrong.

## User Setup Required

None - no external service configuration required. This plan's service reads a table (`style_reference_photos`) created by the sibling plan 25-02's migration; that migration's live-Supabase-application status is tracked under 25-02, not here.

## Next Phase Readiness

- `server/services/style-reference.service.ts` is complete and exports everything both downstream consumers need: 25-09 (single-image `generate.routes.ts` — replace the inline two-tier block with a call to `planReferenceImageSlots`/`resolveGenerationReferenceImages`, then delete the now-dead `fetchBrandReferenceImagesAsBase64` local) and 25-12 (carousel path — wire the same resolver into `carousel-generation.service.ts`).
- `scripts/test-style-reference-merge.ts` is a standing no-network regression guard for the merge arithmetic; any future edit to the priority order or slot cap should keep this green.
- No blockers. This plan's own scope (pure merge + I/O layer + style-board tier) is fully closed; the two remaining red checks in `[svc-style-reference-boards]` are explicitly out of this plan's scope per the plan's own acceptance criteria.

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/services/style-reference.service.ts
- FOUND: scripts/test-style-reference-merge.ts
- FOUND: .planning/phases/25-narrative-carousels-and-aesthetic-dna/25-04-SUMMARY.md
- FOUND: 207a74e (task commit)
