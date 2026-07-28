---
status: partial
phase: 24-visual-critic-and-re-roll
source: [24-07-PLAN.md Task 3]
started: 2026-07-28T04:13:11Z
updated: 2026-07-28T04:13:11Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live critic call
expected: `OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-critic-live.ts --image=./<png>` exits 0 with 5/5 assertions against a real vision-capable model.
result: [pending]

### 2. Real cancellation
expected: Same command with `--abort-probe` — the in-flight call genuinely REJECTS (real fetch/SDK abortion, not cooperative-only).
result: [pending]

### 3. Happy path generation
expected: One live generation produces a `generation_logs` row with `outcome='pass'` and `usage_events.metadata.reroll_attempt_count=0`.
result: [pending]

### 4. Forced re-roll
expected: `usage_events.cost_usd_micros` reflects only the accepted attempt's cost; the extra re-roll cost appears only in `metadata.reroll_cost_usd_micros` (CRIT-03).
result: [pending]

### 5. Hard-fail path
expected: An unwanted-text hard-fail across all 3 attempts produces no `posts` row, no `usage_events` row, and exactly one `hard_fail_all_attempts` generation_logs row.
result: [pending]

### 6. Safety-timer cancellation under load
expected: With `GENERATION_SAFETY_TIMEOUT_MS=5000`, a forced-slow request is genuinely aborted — client receives 504 (not a later generic 500), no duplicate error log row.
result: [pending]

### 7. Compliance rate query
expected: After >=10 live generations, `select outcome, count(*) from generation_logs where event_kind='visual_critic' group by outcome;` returns a sensible distribution.
result: [pending]

### 8. No-regression sweep
expected: One video, one carousel, one enhancement all succeed with zero `visual_critic` rows; admin fallback-chain PATCH for `critic` returns 200; admin routing PATCH for `critic` still returns 400 (GATE-07 scope fence).
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
