# Phase 26 — Deferred / Out-of-Scope Items

Items discovered during plan execution that are out of scope for the discovering plan. Logged per the executor's SCOPE BOUNDARY rule — not fixed here.

## Found during 26-04 execution

**REQUIREMENTS.md: POL-06 (and POL-02/03/08/09) were marked `Complete` prematurely by commit `79c2ed4` ("docs(26-01): complete wave-0-validation-floor plan")**, before any of the actual feature work landed. At the time of that commit, plan 26-01 had only installed `scripts/verify-phase-26.ts` (the phase-gate harness) and fixtures — no requirement's real implementation existed yet, and the harness itself was "honestly red" (9 PASS / 31 FAIL) per its own SUMMARY.

Specifically for **POL-06**: this plan (26-04) only closes the CLIENT half of the idempotency contract (all four call sites now send `idempotency_key`). The SERVER half — `shared/schema.ts` schema fields, `generate.routes.ts`/`edit.routes.ts` pre-flight dedup, and the `post_versions.idempotency_key` migration — is plan 26-06's job (wave 3, not yet landed as of this commit). `scripts/verify-phase-26.ts --only=svc-idempotency` still exits 1 with 7 real failures, all naming server-side artifacts.

**Not fixed here** — reverting the checkbox/table row to `Pending` would touch a shared doc concurrently being edited by 3 other parallel executors (26-02/26-03/26-05) and is not this plan's file-ownership scope. Flagging for whichever plan/session next passes through `REQUIREMENTS.md` (likely 26-06 for POL-06, or the phase-close verification pass) to correct once each requirement's actual server-side work lands.
