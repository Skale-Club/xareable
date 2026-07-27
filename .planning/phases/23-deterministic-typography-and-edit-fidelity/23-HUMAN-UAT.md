---
status: partial
phase: 23-deterministic-typography-and-edit-fidelity
source: [23-11-PLAN.md Task 3]
started: 2026-07-27T23:07:16Z
updated: 2026-07-27T23:07:16Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Migration application
expected: Apply the Phase 23 Supabase migration (base_image_url/typography_meta/generation_params on posts + post_versions) via the Supabase SQL editor.
result: [pending]

### 2. Alpine/AVX smoke check on production host
expected: Run the AVX smoke check (`node -e "require('@napi-rs/canvas')"` / `scripts/smoke-canvas.ts`) on the real Coolify/Hetzner production container; confirm no `Illegal instruction` crash (ref: open GitHub issue Brooooooklyn/canvas#1117).
result: [pending]

### 3. Golden-image glyph test in the real Docker build
expected: Build the Docker image; run the golden-image test inside the built container; confirm no tofu/missing-glyph boxes for pt-BR/es sample text (á, ç, ñ, ã, õ, í, ú, ê).
result: [pending]

### 4. Live generation — exact text mode
expected: Generate a post with `use_text=true`, `text_mode="exact"`, `aspect_ratio="1200:628"`. Confirm exact aspect ratio, crisp correctly-spelled text, and zero `text_verification` rows in `generation_logs`.
result: [pending]

### 5. Live edit — no ghosting
expected: Edit the post from test 4. Confirm no double-rendered or ghosted text in the result.
result: [pending]

### 6. Text-only fast path + Quick Remake fidelity
expected: Trigger a text-only edit (compositor-only fast path) and a Quick Remake; confirm both reuse persisted generation_params faithfully (aspect ratio, logo position) rather than defaulting/guessing.
result: [pending]

### 7. Legacy post + video regression
expected: Edit a pre-Phase-23 post (base_image_url IS NULL) — confirm it still works via the legacy fallback path. Generate one video post — confirm the GATE-08-frozen video pipeline is unaffected.
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
