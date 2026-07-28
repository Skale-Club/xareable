# Phase 26 — Deferred / Out-of-Scope Items

Items discovered during plan execution that are out of scope for the discovering plan. Logged per the executor's SCOPE BOUNDARY rule — not fixed here.

## Found during 26-04 execution

**REQUIREMENTS.md: POL-06 (and POL-02/03/08/09) were marked `Complete` prematurely by commit `79c2ed4` ("docs(26-01): complete wave-0-validation-floor plan")**, before any of the actual feature work landed. At the time of that commit, plan 26-01 had only installed `scripts/verify-phase-26.ts` (the phase-gate harness) and fixtures — no requirement's real implementation existed yet, and the harness itself was "honestly red" (9 PASS / 31 FAIL) per its own SUMMARY.

Specifically for **POL-06**: this plan (26-04) only closes the CLIENT half of the idempotency contract (all four call sites now send `idempotency_key`). The SERVER half — `shared/schema.ts` schema fields, `generate.routes.ts`/`edit.routes.ts` pre-flight dedup, and the `post_versions.idempotency_key` migration — is plan 26-06's job (wave 3, not yet landed as of this commit). `scripts/verify-phase-26.ts --only=svc-idempotency` still exits 1 with 7 real failures, all naming server-side artifacts.

**Not fixed here** — reverting the checkbox/table row to `Pending` would touch a shared doc concurrently being edited by 3 other parallel executors (26-02/26-03/26-05) and is not this plan's file-ownership scope. Flagging for whichever plan/session next passes through `REQUIREMENTS.md` (likely 26-06 for POL-06, or the phase-close verification pass) to correct once each requirement's actual server-side work lands.

## Resolved during 26-06 execution

**POL-06's REQUIREMENTS.md row reconciled.** Both halves of POL-06 (client idempotency_key generation from 26-04, server-side pre-flight dedup + schema + migration from this plan) are now implemented and green on `scripts/verify-phase-26.ts --only=svc-idempotency` (9/9). Per 26-CONTEXT.md/26-06-PLAN.md's own verification step 5, the live proof ("two identical requests with one key produce one row and one usage event") is plan 26-10's operator-sign-off checkpoint, not this plan's. Reverted `REQUIREMENTS.md` line 63 (`[x]` → `[ ]`) and the POL-06 traceability table row (`Complete` → `Pending`, with a note on what has and hasn't landed) so the doc doesn't claim a live-unverified requirement is done. `requirements mark-complete` was deliberately NOT run for POL-06 in this plan's own state update, to avoid re-introducing the same premature-completion bug this entry itself is correcting (same precedent as 26-05's POL-08 handling).

**Not fixed here (still out of this plan's scope):** POL-03 and POL-09 remain marked `Complete` in `REQUIREMENTS.md` despite `scripts/verify-phase-26.ts` showing `[svc-logo-contrast]` (POL-03, owned by 26-07) and `[svc-quality-dashboard]` (POL-09, owned by 26-08/26-09) still red (12 real FAIL lines total, zero uncaught exceptions). This plan's file-ownership scope is POL-06 only — flagging again for whichever plan/session next passes through `REQUIREMENTS.md` (26-07 for POL-03, 26-08/26-09 or a later plan for POL-09, or the phase-close verification pass) to correct.
