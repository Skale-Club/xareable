---
status: partial
phase: 26-fixes-and-polish
source: [26-10-PLAN.md Task 3]
started: 2026-07-28T18:05:32Z
updated: 2026-07-28T18:05:32Z
---

## Current Test

[awaiting human testing]

## Tests

### 0. Migration application (prerequisite)
expected: Apply `supabase/migrations/20260730000000_post_versions_idempotency_key.sql` and `supabase/migrations/20260730000001_posts_feedback.sql` to the live Supabase project.
result: [pending]

### 1. Live idempotency on generate (POL-06)
expected: Two identical `/api/generate` requests with the same idempotency_key — second returns `{"idempotent":true,...}` with no SSE stream, exactly 1 posts row + 1 usage_events row exist.
result: [pending]

### 2. Live idempotency on edit (POL-06)
expected: Same on `/api/edit-post` — exactly 1 post_versions row, version_number unchanged on the duplicate. (A true concurrent race still surfaces as a generic 500 by design — not a regression.)
result: [pending]

### 3. Adaptive JPEG (no-alpha) logo overlay (POL-03)
expected: A no-alpha JPEG logo gets a soft plate, never a raw opaque box; cleanest corner auto-selected when logo_position is unset; an explicit logo_position (e.g. bottom-right) is never overridden.
result: [pending]

### 4. WebP quality + text-edge visual check (POL-02)
expected: Crisp glyph edges at quality 85; the drawBlocks per-block font fix is visible (headline plainly larger than CTA in a multi-block layout).
result: [pending]

### 5. Feedback round trip (POL-09)
expected: up → down → null on one post's feedback field; the active vote state survives dialog reopen.
result: [pending]

### 6. Admin Quality dashboard (POL-09)
expected: Feedback tally matches raw SQL count; the 7/90-day window toggle changes the numbers; a non-admin GET /api/admin/quality returns 403.
result: [pending]

### 7. No-regression sweep + POL-08 handoff
expected: Video, carousel, enhancement, single-image, and legacy-edit flows all succeed unchanged. POL-08's cost-reconciliation runbook is confirmed scheduled/Pending (non-blocking, not run).
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
