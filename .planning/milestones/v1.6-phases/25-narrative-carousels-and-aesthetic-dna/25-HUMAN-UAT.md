---
status: partial
phase: 25-narrative-carousels-and-aesthetic-dna
source: [25-14-PLAN.md Task 3]
started: 2026-07-28T12:56:26Z
updated: 2026-07-28T12:56:26Z
---

## Current Test

[awaiting human testing]

## Tests

### 0. Migration application (prerequisite)
expected: Apply `supabase/migrations/20260729000000_post_slides_base_image_typography.sql` and `supabase/migrations/20260729000001_style_reference_photos.sql` to the live Supabase project.
result: [pending]

### 1. Narrative + on-slide text (CRSL2-01/02, SC1)
expected: A 5-slide carousel shows one shared `layout_archetype_id` across all slides, real per-slide `generation_params` persisted, and correct fonts/colors/layout consistency.
result: [pending]

### 2. Visual composition variation (SC2)
expected: Slides are visibly distinct in framing; no `[carousel] composition variation warning:` log line appears.
result: [pending]

### 3. Text-style treatment + logo (CRSL2-04, SC3)
expected: Bold-promo vs elegant-serif text style selections produce visibly different typography treatment; logo overlay applies per slide.
result: [pending]

### 4. Slide edit — no double render (CRSL2-02)
expected: Editing a slide shows exactly one crisp text set (no ghosting); a text-only edit shows "Recomposing slide text..." with no image-provider call.
result: [pending]

### 5. LEGACY slide edit
expected: Editing a pre-Phase-25 carousel (base_image_url IS NULL) succeeds unchanged via the legacy fallback path; base_image_url stays NULL.
result: [pending]

### 6. Aesthetic DNA in the payload (PLAN-05/06, SC4)
expected: For style id `professional`, the exact string "editorial corporate photography, 50mm prime lens, shallow depth of field, clean commercial finish" appears verbatim in the prompt; a "Apply a 60-30-10 color balance:" sentence names color_4; an "Avoid: " negative-prompt block is present.
result: [pending]

### 7. Style reference board attachment (PLAN-07, SC5)
expected: Log lines show `[Reference Images] User <id>: ...` and `[carousel] reference images: ...` confirming board images were attached; a non-admin request to the admin board-management API returns 403.
result: [pending]

### 8. No-regression sweep
expected: Video generation, enhancement, single-image generation, and pre-Phase-25 edit flows are all unaffected.
result: [pending]

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0
blocked: 0

## Gaps
