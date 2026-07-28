---
status: partial
phase: 22-art-director-planning-upgrade
source: [22-06-PLAN.md Task 3]
started: 2026-07-27T19:22:16Z
updated: 2026-07-27T19:22:16Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC1 live ablation (PLAN-01)
expected: `OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-planning-ablation.ts --image=./path/to/reference.jpg` prints `ABLATION PROVEN` with an overlap ratio < 0.95.
result: [pending]

### 2. SC2 live structured output (PLAN-02/03)
expected: Generate one real single-image post in staging; confirm no `generation_logs` row with `event_kind='planning_schema_failure'` and `usage_events.metadata` carries real gateway cost.
result: [pending]

### 3. SC2 schema-failure hard-fail (PLAN-02)
expected: Force a schema failure per the runbook's documented technique; expect the SSE error text, a `generation_logs` row, and NO new `posts`/`usage_events` rows (user not charged).
result: [pending]

### 4. GATE-07 rollback parity
expected: PATCH `ai-gateway-routing` to direct for `planning`, generate with a reference image, confirm success, then flip back to openrouter.
result: [pending]

### 5. SC3 carousel token budget (PLAN-03)
expected: Generate an 8-slide carousel; confirm all 8 slides present, no truncation.
result: [pending]

### 6. GATE-08 video regression
expected: Generate one video; confirm the direct Google path and `ai_models.text_generation` (not `planning`) was used — video pipeline unaffected by this phase.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
