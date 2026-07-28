# Phase 8: Admin — Scenery Catalog - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 08-admin-scenery-catalog
**Areas discussed:** Item layout, is_active toggle, preview_image_url field

---

## Item Layout Inside the Card

| Option | Description | Selected |
|--------|-------------|----------|
| Accordion (TextStylesCard pattern) | Each row expands to show/edit fields; scannable list | ✓ |
| Flat rows (PostMoodsCard pattern) | Simple inline rows; insufficient for long prompt_snippet | |
| Preview thumbnail inline | Show preview_image_url as <img> in row | |

**User's choice:** Recommended default (accordion pattern)
**Notes:** Auto-selected — user said "do it"

---

## `is_active` Toggle

| Option | Description | Selected |
|--------|-------------|----------|
| Include toggle | Admins can disable without deleting | ✓ |
| Omit in v1.1 | Manage by delete only | |

**User's choice:** Recommended default (include toggle)
**Notes:** Auto-selected — user said "do it"

---

## `preview_image_url` Field

| Option | Description | Selected |
|--------|-------------|----------|
| URL text input | Plain string input, nullable | ✓ |
| Skip for v1.1 | Defer entirely | |
| Binary upload | Use image-upload-field.tsx | |

**User's choice:** Recommended default (URL text input, nullable)
**Notes:** Auto-selected — user said "do it". Binary upload deferred to v2.

---

## Claude's Discretion

- Exact field ordering in add/edit Dialog
- Placeholder text and label copy
- Character count hint on prompt_snippet
- Icon choice for card header

## Deferred Ideas

- Binary image upload for scenery preview thumbnails — v2
- Per-scenery usage analytics — future analytics phase
