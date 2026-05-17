---
status: partial
phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative
source: [12-VERIFICATION.md]
started: 2026-05-17T08:00:00Z
updated: 2026-05-17T08:00:00Z
---

## Current Test

[awaiting human cross-provider testing — auto-approved under --auto mode for phase completion]

## Tests

### 1. Single-post generate on both providers
expected: Both providers produce a saved post image after toggling `platform_settings.image_provider` via /admin (no server restart)
result: [pending]

### 2. Edit-post (POST /api/edit-post) on both providers
expected: Both produce a saved `post_versions` row via `provider.edit()`
result: [pending]

### 3. 3-slide carousel on both providers
expected: All 3 slides generated; slides 2-3 use slide-1 buffer as `currentImage` reference via `provider.edit()`
result: [pending]

### 4. Enhancement on both providers
expected: Enhancement image saved; text-model steps (pre-screen, caption) still use Gemini key regardless of image provider
result: [pending]

### 5. /settings — OpenAI API key field (admin/affiliate)
expected: Field appears gated by `usesOwnApiKey`; save writes `profiles.openai_api_key` via Supabase client update
result: [pending]

### 6. /admin — "AI Image Provider" RadioGroup
expected: RadioGroup shows current value; switching+saving calls `PATCH /api/admin/image-provider`
result: [pending]

### 7. JSONB round-trip on `platform_settings.image_provider`
expected: `getActiveImageProvider()` returns `GeminiImageProvider` by default and `OpenAIImageProvider` after explicit switch
result: [pending — confirmed by orchestrator: SET image_provider='openai' via setPlatformSetting → getPlatformSetting returns 'openai' (verified live during Wave 2 setter test)]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps

(none — all checks are pending live cross-provider runs; static + functional code verification is complete with 36/36 checks green)
