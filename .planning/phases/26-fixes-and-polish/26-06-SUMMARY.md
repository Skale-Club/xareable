---
phase: 26-fixes-and-polish
plan: 06
subsystem: api
tags: [idempotency, zod, supabase, postgres, migration, race-condition]

# Dependency graph
requires:
  - phase: 26-04
    provides: all four client-initiated generate/edit call sites already send a fresh idempotency_key per submit (client half of POL-06)
  - phase: 26-01
    provides: scripts/verify-phase-26.ts's [svc-idempotency] tag group (fixtures + check definitions this plan satisfies)
provides:
  - "generateRequestSchema and editPostRequestSchema (top-level) require idempotency_key: z.string().uuid(), mirroring carousel/enhance"
  - "postVersionSchema gains a nullable idempotency_key column type; post_versions gets its own additive DB column + partial unique index"
  - "generate.routes.ts and edit.routes.ts both run a pre-flight dedup SELECT before checkCredits(), returning { idempotent: true, ... } as plain JSON on a duplicate submit"
affects: [26-10 (live operator-sign-off checkpoint proving one row/one usage event for a duplicate submit)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-side idempotency pre-flight: admin-client SELECT scoped by (idempotency_key, ownership-column) BEFORE any billing gate, returning 200 JSON pre-SSE on a hit — now applied uniformly across all 4 generation-adjacent routes (carousel, enhance, generate, edit)"
    - "post_versions dedup scoped by (idempotency_key, post_id) instead of (idempotency_key, user_id) because the table has no user_id column — ownership is proven transitively by the earlier post-ownership fetch"

key-files:
  created:
    - supabase/migrations/20260730000000_post_versions_idempotency_key.sql
  modified:
    - shared/schema.ts
    - server/routes/generate.routes.ts
    - server/routes/edit.routes.ts
    - client/src/lib/quick-remake.ts
    - .planning/REQUIREMENTS.md
    - .planning/phases/26-fixes-and-polish/deferred-items.md

key-decisions:
  - "editSlideRequestSchema deliberately gains NO idempotency_key — POST /api/carousel/slide/edit has no idempotency contract and none was added, per 26-CONTEXT.md's explicit scope boundary. A comment guards against a future 'fix'."
  - "The pre-existing true-race gap (a genuinely concurrent duplicate surfaces as a generic 500, not a graceful 200) was replicated verbatim on both new routes, not improved — matching carousel/enhance's documented behavior exactly, per 26-CONTEXT.md's locked decision."
  - "REQUIREMENTS.md's POL-06 row (checkbox + traceability table) reverted from a premature 'Complete' (set by 26-01 before either half of the feature existed) back to Pending — both halves of the code are now done, but the live proof is 26-10's operator-sign-off checkpoint, not this plan's. requirements mark-complete was deliberately NOT run for POL-06 in this plan's state update to avoid re-introducing that same bug."

patterns-established: []

requirements-completed: []

# Metrics
duration: ~35min
completed: 2026-07-28
---

# Phase 26 Plan 06: Server-Side Idempotent Generate/Edit APIs Summary

**`/api/generate` and `/api/edit-post` now run an admin-client pre-flight dedup SELECT before the credit gate — scoped by `(idempotency_key, user_id)` on `posts` for generate, and `(idempotency_key, post_id)` on the new `post_versions.idempotency_key` column for edit (since `post_versions` has no `user_id` column) — closing the server half of POL-06 that 26-04's client-side keys were waiting on.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2
- **Files modified:** 6 (4 code/schema/migration files owned by this plan's `files_modified`, plus 2 planning-doc reconciliation files)

## Accomplishments
- `shared/schema.ts`: `generateRequestSchema` and `editPostRequestSchema` (top-level, sibling of `post_id`/`edit_prompt`) both require `idempotency_key: z.string().uuid()`, byte-for-byte mirroring `carouselRequestSchema`/`enhanceRequestSchema`'s existing field. `postVersionSchema` gains a nullable `idempotency_key`. `editSlideRequestSchema` is explicitly annotated as excluded.
- New additive migration `supabase/migrations/20260730000000_post_versions_idempotency_key.sql` adds `post_versions.idempotency_key` (nullable `text`) + a partial unique index (`WHERE idempotency_key IS NOT NULL`) — mirrors the existing `posts.idempotency_key` migration shape exactly, on the correct table.
- `generate.routes.ts`: pre-flight `SELECT * FROM posts WHERE idempotency_key = ? AND user_id = ?` runs after the `pipelineContentType` derivation and before the video-key gate + credit gate (verified: `.eq("idempotency_key"` occurs before `checkCredits(` in source order). A hit returns `{ idempotent: true, post }` as plain JSON, before the SSE stream initializes. `idempotency_key` is persisted on the `posts` insert.
- `edit.routes.ts`: pre-flight `SELECT * FROM post_versions WHERE idempotency_key = ? AND post_id = ?` runs after the brand-fetch block and before the credit gate (same before-`checkCredits(` ordering proof). Deliberately scoped by `post_id`, not `user_id` — `post_versions` has no such column, and `post_id` was already ownership-verified by the earlier `.eq("id", post_id).eq("user_id", user.id)` post fetch. A hit returns `{ idempotent: true, version }`. `idempotency_key` is persisted on the `post_versions` insert.
- `client/src/lib/quick-remake.ts`: collapsed the `EditPostRequest & { idempotency_key: string }` intersection type 26-04 left in place (now that the field lives on the real schema) back to plain `EditPostRequest`.
- Reconciled `REQUIREMENTS.md`'s POL-06 row from a premature `Complete` (set before either half of the feature existed) back to `Pending`, with a note on exactly what has landed and what remains (26-10's live operator sign-off).

## Task Commits

Each task was committed atomically:

1. **Task 1: Zod contract + additive post_versions migration** - `b05e8f5` (feat)
2. **Task 2: generate.routes.ts + edit.routes.ts pre-flight dedup and insert wiring** - `1b91f65` (feat)

**Plan metadata:** (this commit) `docs(26-06): complete server-idempotency-generate-edit plan`

## Files Created/Modified
- `shared/schema.ts` - `generateRequestSchema`/`editPostRequestSchema` gain required `idempotency_key`; `postVersionSchema` gains nullable `idempotency_key`; `editSlideRequestSchema` gains an explanatory exclusion comment only
- `supabase/migrations/20260730000000_post_versions_idempotency_key.sql` - additive column + partial unique index on `post_versions`
- `server/routes/generate.routes.ts` - pre-flight dedup SELECT (before credit gate, before SSE) + `idempotency_key` on the posts insert
- `server/routes/edit.routes.ts` - pre-flight dedup SELECT scoped by `(idempotency_key, post_id)` (before credit gate) + `idempotency_key` on the post_versions insert
- `client/src/lib/quick-remake.ts` - collapsed the now-redundant intersection return type back to plain `EditPostRequest`
- `.planning/REQUIREMENTS.md` - POL-06 checkbox + traceability table row reverted to `Pending` (was prematurely marked `Complete` by 26-01)
- `.planning/phases/26-fixes-and-polish/deferred-items.md` - logged the POL-06 reconciliation and re-flagged POL-03/POL-09's still-outstanding premature-`Complete` markings (out of this plan's scope)

## Decisions Made
- See `key-decisions` in frontmatter. All three were explicit 26-CONTEXT.md/26-06-PLAN.md locks (edit-side scoping key, true-race non-fix, and — via the execution-context instructions given to this run — the REQUIREMENTS.md reconciliation), not judgment calls made independently.

## Deviations from Plan

**1. [Comment wording, not a Rule 1-4 deviation] Reworded the edit-route pre-flight's explanatory comment to avoid a literal `.eq("user_id"` substring.**
- **Found during:** Task 2, self-verification against `scripts/verify-phase-26.ts`'s exact check logic before running it
- **Issue:** The plan's suggested comment text explained the ownership proof by quoting the earlier fetch's code literally (`.eq("id", post_id).eq("user_id", user.id)`). `scripts/verify-phase-26.ts`'s `[svc-idempotency]` check for `edit.routes.ts` inspects a 600-char window around `.eq("idempotency_key"` and asserts it does NOT contain the literal substring `.eq("user_id"` — my own explanatory comment, sitting inside that window, would have falsely tripped that guard (a comment mentioning the pattern, not actual query code).
- **Fix:** Reworded the comment to describe the same fact in prose ("ownership-verified... scoped by id and owner") without reproducing the literal `.eq("user_id"` code snippet. No behavior change — the actual query still correctly omits `.eq("user_id", ...)`.
- **Files modified:** `server/routes/edit.routes.ts`
- **Verification:** `npx tsx scripts/verify-phase-26.ts --only=svc-idempotency` — 9/9 green, including the specific check that would have failed.
- **Committed in:** `1b91f65` (Task 2 commit)

---

**Total deviations:** 1 (cosmetic — a comment wording fix to avoid a harness self-collision, same class as prior phases' documented "self-referential scanner" false positives; zero behavior change).
**Impact on plan:** None on functionality. No scope creep.

## Issues Encountered

The overall `<verification>` section's step 4 (`grep -ci "drop\|not null\|default " supabase/migrations/20260730000000_post_versions_idempotency_key.sql` should return 0) actually returns 1, because the migration's own required partial-index clause (`WHERE idempotency_key IS NOT NULL` — mandated by this same task's own acceptance criteria) contains the substring "is not null". This is a known false-positive class: the EXACT mirrored posts-table migration (`20260421000000_v1_1_schema_foundation.sql`, the file this plan's migration is explicitly told to copy) trips the same naive grep 18 times over, for the same reason plus its own unrelated DROP statements. Confirmed via direct comparison — not a defect introduced by this plan. The migration's own two authoritative per-task acceptance criteria (`add column if not exists idempotency_key` count = 1, `where idempotency_key is not null` count = 1) both pass exactly as specified, and `scripts/verify-phase-26.ts --only=svc-idempotency`'s own migration check (which uses the correct `/where idempotency_key is not null/i` positive-match, not a drop/not-null/default negative-match) passes.

## User Setup Required

None - no external service configuration required. The new migration (`supabase/migrations/20260730000000_post_versions_idempotency_key.sql`) needs to be applied to the Supabase project before this code path is exercised in production, following the same deploy process as every other migration in this repo (no new process — flagging only because it's a schema change, not because it needs manual dashboard steps).

## Next Phase Readiness

Both halves of POL-06 are now code-complete and verified statically: `scripts/verify-phase-26.ts --only=svc-idempotency` is 9/9 green (client checks from 26-04, server checks from this plan), `npm run check`/`npm run build` are clean, and zero regression was confirmed across `verify-phase-21.ts`, `verify-phase-21.1.ts`, `verify-phase-22.ts`, `verify-phase-23.ts` (incl. its own `[svc-cross-plan]` sweep), `verify-phase-24.ts`, `verify-phase-25.ts` (incl. its own `[svc-cross-plan]` sweep), and `verify-phase-12.6.ts`. What remains before POL-06 can be marked `Complete` in `REQUIREMENTS.md` is the live proof described in this plan's own `<verification>` step 5 — submitting two identical requests with the same key against a real database and confirming exactly one row and one usage event — which is plan 26-10's operator-sign-off checkpoint, not a static check this environment can run. The migration itself also needs to actually be applied to the Supabase project (not yet run in this session, same as every other pending migration in the repo) before that live proof is possible.

---
*Phase: 26-fixes-and-polish*
*Completed: 2026-07-28*

## Self-Check: PASSED

All created/modified files found on disk (`shared/schema.ts`, the new migration, `server/routes/generate.routes.ts`, `server/routes/edit.routes.ts`, `client/src/lib/quick-remake.ts`, `.planning/REQUIREMENTS.md`, `.planning/phases/26-fixes-and-polish/deferred-items.md`, this summary); both task commits (`b05e8f5`, `1b91f65`) confirmed present in `git log --oneline --all`.
