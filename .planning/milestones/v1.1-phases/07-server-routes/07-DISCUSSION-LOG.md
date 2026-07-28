# Phase 7: Server Routes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 07-server-routes
**Areas discussed:** Idempotency hit response, Partial-success signaling, Rejection & full-failure error UX

---

## Idempotency hit response

| Option | Description | Selected |
|--------|-------------|----------|
| JSON 200 with existing post | Pre-SSE check; returns existing post directly without opening SSE stream | ✓ |
| SSE replaying complete event | Opens SSE stream, replays cached complete event — client handles one path | |
| SSE error 'already submitted' | Error event on SSE — client needs to distinguish from generation errors | |

**User's choice:** Recommended (JSON 200 pre-SSE)
**Notes:** Auto-selected recommended. Pessimistic idempotency check (pre-flight SELECT before any service call) to avoid expensive Gemini calls on duplicates.

---

## Partial-success signaling

| Option | Description | Selected |
|--------|-------------|----------|
| Single complete event with status field | `{ status: "completed" | "draft", saved_slide_count }` — client branches on status | ✓ |
| Distinct event types | Separate `complete` vs `partial_complete` event types | |

**User's choice:** Recommended (single complete event with status field)
**Notes:** Auto-selected recommended. Status field (`completed` | `draft`) directly reflects service result. No new SSE event type needed.

---

## Rejection & full-failure error UX

| Option | Description | Selected |
|--------|-------------|----------|
| Typed error codes | `error: "carousel_full_failure" | "pre_screen_rejected" | ...` — client renders distinct copy | ✓ |
| Generic SSE error | Single `sse.sendError({ message })` — client shows the English string | |

**User's choice:** Recommended (typed error codes)
**Notes:** Auto-selected recommended. Mirrors existing generate.routes.ts pattern (`"insufficient_credits"`, `"upgrade_required"`). New codes: `carousel_full_failure`, `pre_screen_rejected`, `pre_screen_unavailable`, `carousel_aborted`, `enhancement_aborted`.

---

## Claude's Discretion

- Progress percentage breakpoints for SSE sendProgress calls
- Internal helper naming
- logGenerationError usage pattern
- Error message strings (English only; i18n is Phase 9)

## Deferred Ideas

None.
