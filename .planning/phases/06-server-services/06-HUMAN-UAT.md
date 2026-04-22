---
status: partial
phase: 06-server-services
source: [06-VERIFICATION.md]
started: 2026-04-22T00:00:00Z
updated: 2026-04-22T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live CRSL-02 — 1 text call + N sequential image calls
expected: Set `TEST_GEMINI_API_KEY` in `.env` and re-run `npx tsx scripts/verify-phase-06.ts`. Verifier intercepts fetch and asserts exactly 1 POST to gemini-2.5-flash:generateContent and exactly 3 POSTs to gemini-3.1-flash-image-preview with ≥2900ms gaps.
result: [pending]

### 2. Live CRSL-03 — thoughtSignature echo + slide-1 inlineData in slides 2..N
expected: With `TEST_GEMINI_API_KEY` set, verifier parses intercepted image-call bodies and asserts slides 2..N contain a `role:'model'` turn with slide-1 base64 inlineData (and `thoughtSignature` when slide 1 returned one).
result: [pending]

### 3. Live CRSL-06 — abort mid-run
expected: With `TEST_GEMINI_API_KEY` set, AbortController fires at ~8s mid-generation; verifier accepts either `CarouselAbortedError` (savedSlideCount ≥ 1) with posts.status='draft', OR `CarouselFullFailureError` (abort before slide 1).
result: [pending]

### 4. Live CRSL-09 — ensureCaptionQuality runtime spy
expected: Structural grep PASS is already recorded (exactly 1 call site, outside the slide loop). Optional live complement with `TEST_GEMINI_API_KEY` would count runtime invocations.
result: [pending]

### 5. Live ENHC-03 — EXIF strip verified via download-and-inspect
expected: With `TEST_GEMINI_API_KEY` set, verifier uploads a test JPEG with EXIF Orientation=6 + GPS tags, downloads both `{postId}.webp` and `{postId}-source.webp` from Supabase Storage, runs `sharp().metadata()` and asserts `orientation=undefined|1` AND `exif=undefined`.
result: [pending]

### 6. Live ENHC-04 — verbatim preservation rules in intercepted image-model prompt
expected: With `TEST_GEMINI_API_KEY` set, verifier intercepts image-model fetch, parses request body, and asserts 3 verbatim substrings are present plus resolved `scenery.prompt_snippet`.
result: [pending]

### 7. Live ENHC-05 — square input buffer (width===height) in intercepted image-model body
expected: With `TEST_GEMINI_API_KEY` set, verifier decodes the `inlineData.data` from the intercepted image-model request and asserts `sharp(decoded).metadata()` returns width===height.
result: [pending]

### 8. Live ENHC-06 — 4 pre-screen sub-cases (fail-closed 503, high-reject, low-accept, no-retry)
expected: With `TEST_GEMINI_API_KEY` set, 4 stubbed sub-cases run: (A) 503 → `PreScreenUnavailableError` + 0 image calls; (B) high-confidence face_or_person → `PreScreenRejectedError` with locked English copy + 0 image calls; (C) low-confidence face_or_person → accept path, stubbed 1×1 WebP flows through storage + DB insert; (D) exactly 1 pre-screen call per invocation.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
