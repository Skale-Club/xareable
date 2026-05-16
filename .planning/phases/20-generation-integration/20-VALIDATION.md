---
phase: 20
slug: generation-integration
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-16
---

# Phase 20 — Validation Strategy

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript static harness (tsx) + npm run check |
| **Config file** | scripts/verify-phase-20.ts (Wave 0 creates this) |
| **Quick run command** | `npm run check` |
| **Full suite command** | `npx tsx scripts/verify-phase-20.ts` |
| **Estimated runtime** | ~5 seconds |

---

## Requirement → Test Map

| Requirement | Automated Check | Wave |
|-------------|-----------------|------|
| GEN-02: use_brand_references in schema | `grep "use_brand_references"` in shared/schema.ts | Wave 0 |
| GEN-02: fetchBrandReferenceImagesAsBase64 helper | `grep "fetchBrandReferenceImagesAsBase64"` in generate.routes.ts | Wave 0 |
| GEN-02: mergedReferenceImages in route | `grep -c "mergedReferenceImages"` ≥ 6 in generate.routes.ts | Wave 0 |
| GEN-02: brand_reference_photos queried | `grep "brand_reference_photos"` in generate.routes.ts | Wave 0 |
| GEN-02: image-only guard (!isVideo) | `grep "!isVideo"` near merge block | Wave 0 |
| GEN-01: useBrandReferences state | `grep "useBrandReferences"` in post-creator-dialog.tsx | Wave 0 |
| GEN-01: hasBrandReferences computed | `grep "hasBrandReferences"` in post-creator-dialog.tsx | Wave 0 |
| GEN-01: checkbox data-testid | `grep "checkbox-use-brand-references"` in post-creator-dialog.tsx | Wave 0 |
| GEN-01: use_brand_references in payload | `grep "use_brand_references"` in post-creator-dialog.tsx | Wave 0 |
| GEN-01: contentType === "image" guard | `grep 'contentType.*image\|image.*contentType'` in post-creator-dialog.tsx | Wave 0 |

## Wave 0 Gaps

- `scripts/verify-phase-20.ts` does not exist yet — created in Task 4

## Notes

- Human verification: generate a post with brand reference photos saved → confirm AI output visually reflects their style. Cannot be automated.
- Regression check: carousel/enhancement routes must remain unchanged (grep absence of `mergedReferenceImages` in carousel.routes.ts and enhance.routes.ts).
