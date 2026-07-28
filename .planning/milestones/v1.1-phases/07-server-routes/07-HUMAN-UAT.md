---
status: partial
phase: 07-server-routes
source: [07-VERIFICATION.md]
started: 2026-04-22T00:00:00.000Z
updated: 2026-04-22T00:00:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end carousel SSE streaming
expected: POST /api/carousel/generate with valid prompt, slide_count 3–8, aspect_ratio 1:1 or 4:5 produces per-slide SSE progress events (one per slide) followed by a final `complete` event with `{ type, post, status, saved_slide_count, image_urls, caption }`
result: [pending]

### 2. Carousel idempotency
expected: Sending the same request twice with an identical `idempotency_key` returns JSON 200 `{ idempotent: true, post }` on the second call — no new generation, no new usage_events row, no credit deduction
result: [pending]

### 3. End-to-end enhancement SSE
expected: POST /api/enhance with valid image (≤5 MB JPEG/PNG/WEBP) and a valid scenery preset ID streams pre_screen_start → pre_screen_passed → normalize_start → normalize_complete → enhance_start → complete events; result stored at `user_assets/{userId}/enhancement/{postId}.webp`
result: [pending]

### 4. Pre-screen rejection
expected: Submitting a face photo triggers `sse.sendError({ error: "pre_screen_rejected" })` with HTTP 422 — no credits charged, no usage_events row inserted
result: [pending]

### 5. Partial-success billing accuracy
expected: A carousel job where ≥50% of slides succeed saves as `status = "draft"` and deducts credits only for the successful slides (not the originally requested count)
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
