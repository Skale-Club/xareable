---
phase: 06-server-services
plan: 01
subsystem: billing

tags: [typescript, supabase, quota, checkCredits, verifier, tsx]

# Dependency graph
requires:
  - phase: 05-schema-database-foundation
    provides: "post_slides table, content_type CHECK extension, idempotency_key partial-unique index, platform_settings.style_catalog scenery seed"
provides:
  - "checkCredits slideCount multiplier (BILL-01) — additive 4th positional param, clamped at Math.max(slideCount ?? 1, 1), single multiplication site against estimatedBaseCostMicros"
  - "scripts/verify-phase-06.ts live verifier scaffold with self-minting throwaway Supabase user, BILL-01 end-to-end assertion, and 9 SKIP placeholders for Wave 2"
affects: [06-02-carousel-generation-service, 06-03-enhancement-service, 07-server-routes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase-level live verifier pattern extended — verify-phase-06.ts mirrors verify-phase-05.ts shape (admin.createUser mint + signInWithPassword + deleteUser in finally) and adds 9 SKIP placeholders so downstream waves can grow the file without re-plumbing the setup/teardown"
    - "Verifier pre-seeds minted user state (exhaust free_generations_used = free_generations_limit) before calling checkCredits, because the pay-per-use migration sets free_generations_limit default = 1 and the free-generations early return zeroes estimated_cost_micros — making the multiplier untestable without this setup"

key-files:
  created:
    - "scripts/verify-phase-06.ts"
  modified:
    - "server/quota.ts"

key-decisions:
  - "Extension was strictly additive — 4th positional parameter, union unchanged, existing 5 call sites recompile without change (D-18, D-20)"
  - "Multiplier applied at exactly one site (line 368 in quota.ts) — the unified estimatedCostMicros computation. Early returns (own-api-key, free-generations, both billing models) keep estimated_cost_micros = 0 by design (D-19)"
  - "Verifier exhausts the minted user's free generation before asserting the multiplier — free_generations_limit default = 1 would otherwise trip the early return and zero the baseline, making the multiplier assertion vacuous"

patterns-established:
  - "Additive-only checkCredits extension — new billing semantics arrive as optional parameters with clamped defaults, never by widening the operationType union. Phase 7 will pass slideCount: N for carousel routes and undefined (→1×) for enhancement and single-image routes. D-20 locks the union at 'generate' | 'edit' | 'transcribe' through v1.1."
  - "Verifier scaffold grows per wave — Wave 1 lays down mint/teardown + BILL-01 + 9 SKIP stubs; Wave 2 plans (06-02, 06-03) replace SKIP console.logs with real assertions. Pattern explicitly avoids rewriting the file each wave."

requirements-completed: [BILL-01]

# Metrics
duration: ~20min
completed: 2026-04-21
---

# Phase 6 Plan 1: checkCredits slideCount Multiplier & Phase 6 Verifier Scaffold Summary

**Additive `slideCount?: number` parameter on `checkCredits` clamped via `Math.max(slideCount ?? 1, 1)` applied at the single `estimatedCostMicros` site, plus a self-minting Phase 6 live verifier that proves the multiplier end-to-end (single=117000 µ$, 5×=585000 µ$) and scaffolds 9 SKIP placeholders for Wave 2.**

## Performance

- **Duration:** ~20 minutes
- **Started:** 2026-04-21 (Phase 6 execution start)
- **Completed:** 2026-04-21
- **Tasks:** 3 (2 code + 1 verification gate)
- **Files modified:** 2 (`server/quota.ts`, `scripts/verify-phase-06.ts`)

## Accomplishments

- `checkCredits` now accepts an optional 4th positional `slideCount?: number`. Internally a single `slideMultiplier = Math.max(slideCount ?? 1, 1)` is computed once and applied to `estimatedBaseCostMicros` at exactly one site. Own-api-key and free-generations early returns continue to return `estimated_cost_micros: 0` by design.
- All 5 pre-existing call sites (`generate.routes.ts:282`, `edit.routes.ts:164`, `transcribe.routes.ts:47`, `credits.routes.ts:91`, `quota.ts:553` getCreditsState) compile unchanged.
- `scripts/verify-phase-06.ts` self-mints a non-admin throwaway Supabase user, exhausts its default free generation, asserts 5 multiplier sub-claims (`undefined`===1×, `0` clamps, `-3` clamps, `5`===5×, `8`===8×), and tears down the user in `finally`. Unhandled-error path also attempts teardown to prevent leaks.
- 9 SKIP placeholders (CRSL-02, CRSL-03, CRSL-06, CRSL-09, CRSL-10, ENHC-03, ENHC-04, ENHC-05, ENHC-06) installed so Wave 2 plans (06-02, 06-03) can fill them in without re-plumbing setup/teardown.

## Task Commits

1. **Task 1: Extend `checkCredits` signature with optional `slideCount` multiplier** — `2e758ab` (feat) — `server/quota.ts`
2. **Task 2: Scaffold `scripts/verify-phase-06.ts` with BILL-01 assertions and Wave 2 SKIP stubs** — `376634e` (feat) — `scripts/verify-phase-06.ts`
3. **Task 3: Verification gate** — no code change; re-ran `npm run check` (green) and `npx tsx scripts/verify-phase-06.ts` (PASS 1/1 with 9 SKIP, exit 0) before proceeding to SUMMARY.

## Files Created/Modified

- `server/quota.ts` — MODIFIED. Added JSDoc + `slideCount?: number` parameter. Added `const slideMultiplier = Math.max(slideCount ?? 1, 1);` immediately after `getBillingModel()`. Replaced `Math.max(Math.round(estimatedBaseCostMicros), 0)` with `Math.max(Math.round(estimatedBaseCostMicros * slideMultiplier), 0)` at the single `estimatedCostMicros` computation. Net diff: +10 / -2 lines.
- `scripts/verify-phase-06.ts` — CREATED (243 lines). Mirrors `verify-phase-05.ts` structure with `mintTestUserIfNeeded`/`teardownTestUserIfMinted`/`record` helpers relabelled `phase06`. BILL-01 block imports `checkCredits` directly, exhausts minted user's free generation, runs 5 sub-assertions. Unhandled-error branch also attempts teardown.

### Exact diff lines in `server/quota.ts`

```
- export async function checkCredits(
-   userId: string,
-   operationType: "generate" | "edit" | "transcribe",
-   isVideo: boolean = false
- ): Promise<CreditStatus> {
-   const billingModel = await getBillingModel();
+ /**
+  * Check whether `userId` has credits to cover `operationType`.
+  * @param slideCount - Optional multiplier for carousel jobs. `undefined` or absent
+  *   resolves to 1× (single-image cost). Clamped to `Math.max(slideCount ?? 1, 1)`
+  *   per BILL-01 / D-19. Phase 7 routes pass N for carousel, undefined for enhancement.
+  */
+ export async function checkCredits(
+   userId: string,
+   operationType: "generate" | "edit" | "transcribe",
+   isVideo: boolean = false,
+   slideCount?: number,
+ ): Promise<CreditStatus> {
+   const billingModel = await getBillingModel();
+   const slideMultiplier = Math.max(slideCount ?? 1, 1);
```

And one line down in the cost computation:

```
- const estimatedCostMicros = Math.max(Math.round(estimatedBaseCostMicros), 0);
+ const estimatedCostMicros = Math.max(Math.round(estimatedBaseCostMicros * slideMultiplier), 0);
```

### Preserved call sites (unchanged)

| Site | Call |
|------|------|
| `server/routes/generate.routes.ts:282` | `await checkCredits(user.id, "generate", isVideo)` |
| `server/routes/edit.routes.ts:164` | `await checkCredits(user.id, "edit")` |
| `server/routes/transcribe.routes.ts:47` | `await checkCredits(user.id, "transcribe")` |
| `server/routes/credits.routes.ts:91` | `await checkCredits(user.id, normalizedOperation)` |
| `server/quota.ts:553` (getCreditsState) | `await checkCredits(userId, operationType)` |

All five compile unchanged (optional `slideCount` resolves to `undefined` → multiplier 1).

### Minted-user cleanup behavior observed

Each run produced one new user, used it for the assertions, and deleted it:

- Run 1: minted `d7ea38f3-3440-4ed7-820c-22b3f6571659` → deleted in `finally` (FAIL diagnosis run)
- Run 2: minted `0387a3b0-fc30-4477-a5cd-ca8dd0273cef` → deleted in `finally` (PASS)
- Run 3: minted `528e3bc6-b952-45a7-9d03-e8e3831d5738` → deleted in `finally` (final gate PASS)

No `phase06-verify-*@verify.local` users accumulating in Supabase Auth.

## Decisions Made

- **D-18/D-20 enforcement (planner-locked):** Extension stays strictly additive. The `operationType` union is unchanged. Phase 7 will tag carousels by passing `slideCount: N`, not by adding `"carousel"` to the union.
- **D-19 clamp site (planner-locked):** Single `slideMultiplier = Math.max(slideCount ?? 1, 1)` at top-of-function (after `getBillingModel()`). No secondary computation anywhere else — grep `Math.max(slideCount` returns exactly one match (the JSDoc match is a comment).
- **D-09/D-11 verifier pattern (planner-locked):** Phase 6 mirrors the Phase 5 live-verifier shape verbatim — same self-mint/self-clean contract, same `record()` helper, same `CheckResult` type. Wave 2 plans will extend this same file.
- **Verifier pre-seed (executor inference within D-11 intent):** Because the pay-per-use migration (`20260303010000_pay_per_use_billing.sql`) sets `user_credits.free_generations_limit` default = 1 and the profile trigger auto-creates that row on signup, a freshly minted user's first `checkCredits` call hits the free-generations early return and returns `estimated_cost_micros = 0`. That zeroes the BILL-01 baseline and makes the multiplier untestable. The executor resolved this by updating the minted user's `free_generations_used = free_generations_limit` via the admin client BEFORE the assertion calls. This is a setup-only modification; no user_credits rows persist after teardown (user delete cascades).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 – Blocking] Verifier baseline was 0 µ$ because pay-per-use migration defaults `free_generations_limit = 1`**
- **Found during:** Task 2 first run (verifier executed against freshly minted user)
- **Issue:** The plan's Task 2 action step 3 noted "a freshly minted user has no usage_events history, so estimateBaseCostMicros falls back to image_fallback_pricing.sell_micros (default 117_000)" — which is true, BUT the free-generations early return fires **before** `estimateBaseCostMicros` is even called, because `user_credits.free_generations_limit` defaults to 1 (per `20260303010000_pay_per_use_billing.sql` line 12). `freeGenerationsRemaining = 1 > 0` → return with `estimated_cost_micros: 0`. Plan's comment footnote missed this. The first verifier run produced `FAIL — BILL-01 (slideCount multiplier) — baseline cost is 0 µ$ …`.
- **Fix:** Added a setup step in the verifier's BILL-01 block that reads the minted user's `user_credits` row via the admin client and updates `free_generations_used = free_generations_limit` before the assertion calls. If no row exists (defensive), the verifier inserts one with both fields equal so the early return does not fire. This is a read-only-ish setup on a row the minted user owns and cascades away on teardown — no cross-user impact.
- **Files modified:** `scripts/verify-phase-06.ts` (the initial-write fix, not a follow-up commit — this was caught before the first commit of the file)
- **Verification:** Second run produced `PASS — BILL-01 (slideCount multiplier) — single=117000 µ$, 5×=585000 µ$ — all five assertions passed`. Third run (final gate) reproduced the PASS. Minted users in all runs were deleted in `finally`.
- **Committed in:** `376634e` (Task 2 commit — fix was applied before the first commit of `verify-phase-06.ts`, so no separate "fix" commit exists)

**2. [Deviation from plan wording] Per-task atomic commits instead of plan's "single commit" instruction in Task 3**
- **Found during:** Task 3 (verification gate)
- **Issue:** Plan Task 3 step 4 instructed "Commit both files in a single commit." The executor protocol (execute-plan.md, task_commit_protocol section) mandates atomic per-task commits. These are in direct conflict.
- **Fix:** Followed the executor protocol — two commits (`2e758ab` for quota.ts, `376634e` for verifier). Both files reached the tree with full provenance and per-task scoping, which is strictly more traceable than one joint commit.
- **Files modified:** n/a (commit-graph only)
- **Verification:** `git log --oneline -3` shows both commits with `feat(06-01):` prefix.
- **Committed in:** n/a (this is about commit granularity, not code)

---

**Total deviations:** 2 — 1 Rule-3 (Blocking) auto-fix, 1 plan-vs-protocol reconciliation
**Impact on plan:** Both were necessary. The Rule-3 fix is essential: without it the plan's own AC-5 is unverifiable. The commit-granularity deviation aligns plan output with executor protocol without changing any code or behavior. No scope creep.

## Issues Encountered

- First verifier run failed BILL-01 with `baseline cost is 0 µ$`. Diagnosis: traced through `checkCredits` branch-by-branch → found free-generations early return fires at line 373 (subscription_overage model) or 442 (credits_topup model) when `freeGenerationsRemaining > 0`, and confirmed via grep that `free_generations_limit` defaults to 1 in the pay-per-use migration. Resolution above in Deviations §1.

## User Setup Required

None — no external service configuration required. The verifier uses existing `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` from `.env` (same set Phase 5 used) and self-mints its own test user.

## Next Phase Readiness

- **06-02 (carousel-generation.service.ts)** and **06-03 (enhancement.service.ts)** can start immediately in parallel. Both depend on 06-01 only for the `checkCredits` signature change (which they consume transitively through Phase 7 routes, not directly), and for the verifier scaffold they will extend.
- Wave 2 plans fill in the 9 SKIP console.logs with real assertions — the setup/teardown plumbing is done.
- No blockers. `npm run check` green. `npx tsx scripts/verify-phase-06.ts` exits 0.

## Self-Check: PASSED

- `server/quota.ts` modified — FOUND (git log shows `2e758ab` with +10/-2 to server/quota.ts)
- `scripts/verify-phase-06.ts` created — FOUND (git log shows `376634e` creating the file, 243 lines)
- Commit `2e758ab` exists — FOUND (`git log --oneline` visible above)
- Commit `376634e` exists — FOUND (`git log --oneline` visible above)
- `npm run check` green — VERIFIED at final gate (exit 0)
- `npx tsx scripts/verify-phase-06.ts` exits 0 with BILL-01 PASS and 9 SKIP lines — VERIFIED at final gate
- Exactly 9 SKIP placeholders in verify-phase-06.ts — VERIFIED (`grep -c "SKIP — " scripts/verify-phase-06.ts` → 9)

---
*Phase: 06-server-services*
*Completed: 2026-04-21*
