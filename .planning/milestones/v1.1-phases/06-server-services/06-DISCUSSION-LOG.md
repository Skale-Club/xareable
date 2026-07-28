# Phase 6: Server Services - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 06-server-services
**Areas discussed:** Rate limit & parallelism, Failure mode policy, Testing strategy, Module shape
**Discussion mode:** User delegated all four areas to Claude's recommended approach in a single turn ("faça o que for mais recomendado para o projeto, não sei o que responder"). Each area below documents the alternatives that were in scope and the rationale for the chosen option.

---

## Area 1 — Rate limit & parallelism

| Option | Description | Selected |
|--------|-------------|----------|
| Strict sequential, 3000ms delay, 1 retry on 429 (15s backoff) | Safe default. 8 slides × ~13s = ~121s, fits 260s with 53% headroom. Defers 2-concurrent to v2. | ✓ |
| Strict sequential, no delay, no retry | Fastest sequential path; high risk of cascading 429 at slides 3–4 per community reports. | |
| 2-concurrent from launch | Halves latency but amplifies 429 risk; Tier 1 RPM confidence is LOW. | |
| Sequential with multi-retry exponential backoff | Over-engineering for a 260s budget; partial-success contract already covers retry exhaustion. | |

**User's choice:** Delegated — recommended option selected.
**Notes:** Research §Open Questions #1 flags the quota uncertainty. D-01..D-04 locked. 2-concurrent explicitly deferred to v2.

---

## Area 2 — Failure mode policy (three sub-decisions)

### 2a. Pre-screen API itself fails (gemini-2.5-flash network/500/quota)

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-closed (reject upload) | Safety-first. Neutral user message. HTTP 503 at route. | ✓ |
| Fail-open (accept upload, proceed to enhancement) | Better UX under partial outage but violates ENHC-06 intent. | |
| Retry once, then fail-closed | Adds latency without improving safety; pre-screen failures are likely persistent for the duration of an outage. | |

**User's choice:** Delegated — recommended option selected.
**Notes:** Locked as D-05. Typed error `PreScreenUnavailableError` thrown from the service.

### 2b. `thought_signature` absent or multi-turn 400

| Option | Description | Selected |
|--------|-------------|----------|
| Silent single-turn fallback with shared_style injection (log warning) | Degrades gracefully; research-recommended path. Style drift possible but partial-success contract absorbs. | ✓ |
| Mark post with "style_drift_possible" metadata flag | Requires schema change (Phase 5 closed). Out of scope for Phase 6. | |
| Hard-fail slide when signature is absent | Under-utilizes available content; would punish transient API conditions. | |

**User's choice:** Delegated — recommended option selected.
**Notes:** Locked as D-06. Warning log must include slide number and reason for future quota analysis.

### 2c. Master text JSON parse failure

| Option | Description | Selected |
|--------|-------------|----------|
| One retry with reinforced prompt, then hard-fail | Balances transient Gemini output anomalies against structural bugs in our prompt. | ✓ |
| Hard-fail on first malformed JSON | Harsh for transient output issues; would frustrate users. | |
| Multi-retry with exponential backoff | Overkill for the 260s budget; 2+ malformed responses in a row signals a prompt bug, not a transient issue. | |

**User's choice:** Delegated — recommended option selected.
**Notes:** Locked as D-04. Retry prompt explicitly says "Respond ONLY with a valid JSON object … No prose, no markdown fences."

---

## Area 3 — Testing strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Continue Phase 5 live-verifier pattern (`scripts/verify-phase-06.ts`) + `npm run check` per commit | Consistent with Phase 5. Real Gemini calls via admin/test user API key. No new test framework. | ✓ |
| TypeScript-compile-only gate | Weakest coverage; the 7 ROADMAP criteria cannot be asserted statically. Regressions on behavior would ship. | |
| Add Vitest/Jest with mocked fetch for unit tests | Best-in-class for mocked coverage, but no test framework exists in the project. Introducing one is scope creep for two service files. | |

**User's choice:** Delegated — recommended option selected.
**Notes:** Locked as D-09..D-12. Verifier asserts BILL-01 end-to-end, and for CRSL-03 validates the multi-turn request body structure (role=model + base64 match) rather than visual coherence, which requires a human QA step.

---

## Area 4 — Module shape

| Option | Description | Selected |
|--------|-------------|----------|
| Single file per service (helpers as internal functions) | Matches every existing service file in the project. Phase 7 imports 2 symbols, not 4. | ✓ |
| Decompose enhancement into `pre-screen.service.ts` + `enhancement.service.ts` | Over-factored for helpers used in one context. Adds import surface with no testability gain (no unit tests anyway). | |
| Colocate both services in a single `media-generation.service.ts` | Under-factored; blurs the carousel vs enhancement boundary that Phase 7's routing depends on. | |

**User's choice:** Delegated — recommended option selected.
**Notes:** Locked as D-13..D-17. Each service owns its DB writes and uploads to match `generate.routes.ts` → generation service seam.

---

## Claude's Discretion

- Exact error message strings (English only; Phase 9 localizes)
- Internal helper naming conventions
- Exact TypeScript typing of the error class hierarchy
- Whether slide thumbnails reuse existing thumbnail dimensions or a carousel-specific size

## Deferred Ideas

- Controlled 2-concurrent slide parallelism → v2 (post-quota-data)
- Unit test framework (Vitest/Jest) → evaluated, rejected for this phase
- Per-slide regeneration API (CRSL-V2-01) → v2
- Slide-level `enforceExactImageText` (CRSL-V2-04) → v2
- Free-text scenery modifier (ENHC-V2-01) → v2
- Multi-retry exponential backoff on 429 → rejected for v1.1
- Pre-screen model fallback cascade → rejected for v1.1
