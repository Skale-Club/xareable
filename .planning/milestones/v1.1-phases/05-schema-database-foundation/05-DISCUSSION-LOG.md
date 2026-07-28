# Phase 5: Schema & Database Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 05-schema-database-foundation
**Areas discussed:** post_slides lifecycle & cleanup, Storage path layout, idempotency_key scope & nullability, Scenery seed strategy

**Interaction mode:** User selected "do the recommended" in response to the gray-area selection prompt, treated as auto-accept of the recommended option for every area. Each decision below was selected by Claude using the recommended default; rationale preserved for audit.

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| post_slides lifecycle & cleanup | ON DELETE CASCADE coupling with posts, unique (post_id, slide_number), and how slide file cleanup triggers fire | ✓ |
| Storage path layout | Where slide images + thumbnails live (nested per-post vs flat generated/) and where enhancement source-vs-result live | ✓ |
| idempotency_key scope & nullability | Global unique vs per-user unique, required only on new routes vs all inserts, retention window, UUID format | ✓ |
| Scenery seed strategy | How the 12 scenery presets land in the existing app_settings.style_catalog JSON | ✓ |

**User's choice:** "do the recommended" — all four areas auto-resolved with recommended defaults.

---

## post_slides lifecycle & cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `version_cleanup_log` via trigger on `post_slides` DELETE | Leverage existing async cleanup queue; `processStorageCleanup()` already drains it | ✓ |
| New `slide_cleanup_log` table | Isolate cleanup semantics per media type; more tables, no semantic benefit | |
| App-side cleanup in route handlers only | Delete from storage before DB delete in route code; couples deletion to happy-path code and fails if the process dies mid-delete | |

**Rationale:** The existing `version_cleanup_log` shape `(image_url, thumbnail_url)` is a perfect fit for per-slide rows and for the enhancement source file. Reusing it avoids a duplicate cleanup service code path and keeps the drain logic unchanged. `ON DELETE CASCADE` from `posts` handles both user-triggered deletes and the `delete_expired_posts()` cron — no app-side deletion ordering to coordinate.

**Locked decisions (see CONTEXT.md):** D-01, D-02, D-03, D-04, D-05

---

## Storage path layout

| Option | Description | Selected |
|--------|-------------|----------|
| Nested per-post: `user_assets/{userId}/carousel/{postId}/slide-N.webp` + colocated thumbs | Research-recommended; enables bulk folder removal; keeps `generated/` dedicated to single-image posts | ✓ |
| Flat under `generated/`: `user_assets/{userId}/generated/{uuid}.webp` | Mixes carousel slides with single posts; no semantic grouping; harder cleanup | |
| Separate thumbnail folder: `user_assets/{userId}/thumbnails/{uuid}-thumb.webp` | Matches existing generated-post thumb layout; splits carousel assets across two folders | |

**Rationale:** Bulk cleanup via folder listing is cheaper than N individual deletes, and nested paths make storage inspection trivial. Enhancement paths are already spec'd exactly in ENHC-07 so no choice to make there.

**Locked decisions:** D-06, D-07, D-08

---

## idempotency_key scope & nullability

| Option | Description | Selected |
|--------|-------------|----------|
| Global `UNIQUE`, nullable, UUID v4 | Simple index, simple retry lookup (`WHERE user_id = ? AND idempotency_key = ?`), legacy posts stay NULL | ✓ |
| Per-user `UNIQUE (user_id, idempotency_key)` | Slightly more defensive against leaked keys; composite index more complex; no real win with UUID v4 | |
| Global `UNIQUE`, required | Forces all inserts to provide a key; breaks legacy single-image post insert path | |

**Rationale:** Client-generated UUID v4 is collision-free at the scales involved. A global `UNIQUE` with `NULL` legacy values keeps the index small and the retry query cheap. Format enforcement lives in Zod at the app boundary so the DB stays simple.

**Locked decisions:** D-09, D-10, D-11, D-12

---

## Scenery seed strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Inline SQL in migration + `jsonb_set` with idempotency guard | Self-contained migration; re-running is safe; matches ADMN-02 "seeded via migration" requirement | ✓ |
| TS constant + admin UI manual seed | Requires manual post-deploy step; violates ADMN-02 | |
| Separate seed script run outside migrations | Extra operational step; not repeatable on fresh environments | |

**Rationale:** ADMN-02 explicitly requires seeding via migration. `jsonb_set` into the existing singleton `app_settings.style_catalog` row is idempotent when guarded by `WHERE style_catalog->'sceneries' IS NULL OR jsonb_array_length(...) = 0` — admin edits to the sceneries array are preserved on re-run.

**Locked decisions:** D-13, D-14, D-15, D-16

---

## Claude's Discretion

- Exact Zod error messages and `.describe()` annotations on new schemas.
- Ordering of new exports within `shared/schema.ts` (preserve existing section structure).
- SQL formatting details (match existing migration style verbatim).
- Trigger naming beyond the `<event>_<table>_trigger` convention.

## Deferred Ideas

- Individual slide regeneration (v2) — would require `shared_style` persisted per carousel.
- User-uploaded custom sceneries (v2) — would require a per-user scenery table.
- Free-text scenery modifier on enhancement (v2) — would add a `modifier` field to `enhanceRequestSchema`.
- Dedicated `storage_cleanup_log` separate from `version_cleanup_log` — rejected; reuse is sufficient for v1.1.
- Per-user composite `UNIQUE (user_id, idempotency_key)` — rejected; UUID v4 makes global UNIQUE sufficient.
