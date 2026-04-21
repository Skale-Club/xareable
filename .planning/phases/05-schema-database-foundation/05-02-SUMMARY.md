---
phase: 05-schema-database-foundation
plan: 02
subsystem: database
tags: [migration, supabase, rls, post_slides, idempotency_key, cleanup_triggers, scenery_seed]

# Dependency graph
requires:
  - phase: 05-01
    provides: canonical Zod shapes — postSchema.content_type 4-value enum, slide_count + idempotency_key nullable fields, scenerySchema, styleCatalogSchema.sceneries attachment
  - phase: v1.0 foundation
    provides: existing migrations — posts_content_type_check (20260305000012), version_cleanup_log + get_pending_storage_cleanup/mark_storage_cleaned RPCs (20260310180000), app_settings singleton (20260303000010)
provides:
  - post_slides table with RLS co-deployed (select/insert/delete via EXISTS join on posts)
  - posts.content_type 4-value CHECK constraint (image | video | carousel | enhancement)
  - posts.slide_count nullable integer column
  - posts.idempotency_key nullable text column with partial unique index
  - BEFORE DELETE trigger on post_slides routing cleanup through version_cleanup_log (D-03)
  - BEFORE DELETE trigger on posts routing enhancement source cleanup through version_cleanup_log (D-04)
  - app_settings.style_catalog.sceneries seeded with 12 presets, idempotency-guarded
affects: [06-server-services, 07-server-routes, 08-admin-scenery-catalog, 09-frontend-creator-dialogs, 10-gallery-surface-updates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RLS co-deployment: create table + enable row level security + three policies in a single migration file — mirror of post_versions blueprint (20260304000002)"
    - "CHECK drop-and-recreate pattern (idempotent widening) — mirror of posts_media_fields (20260305000012)"
    - "Reuse version_cleanup_log for async storage cleanup via BEFORE DELETE triggers — avoids dedicated slide_cleanup_log table (D-03)"
    - "Enhancement source path derivation via regexp_replace on image_url (.webp → -source.webp) so extractPathFromUrl() in storage-cleanup.service.ts works unchanged (D-07)"
    - "Idempotency guard on jsonb_set seed via WHERE clause targeting empty/null sceneries array — re-running never clobbers admin edits (D-13)"

key-files:
  created:
    - supabase/migrations/20260421000000_v1_1_schema_foundation.sql
  modified: []

key-decisions:
  - "Single migration file (not split) — all v1.1 DDL in one commit keeps schema state consistent and avoids the 'migration applied but RLS missing' failure mode from v1.0 Phase 2"
  - "Global partial unique index on idempotency_key (WHERE idempotency_key IS NOT NULL) — allows existing single-image posts to remain NULL while enforcing uniqueness for carousel/enhancement retry keys (D-09)"
  - "Enhancement source path derivation uses regexp_replace with .webp-suffix guard — skips silently on non-matching URLs so legacy rows can't break DELETE"
  - "Scenery seed uses jsonb_set with idempotency guard (sceneries IS NULL OR length=0) — re-running migration on a DB where admin has customized the catalog is a no-op"

requirements-completed: [SCHM-01, SCHM-02, SCHM-03, SCHM-05, SCHM-06]

# Metrics
duration: 2min
completed: 2026-04-21
---

# Phase 5 Plan 02: v1.1 Schema Foundation Migration Summary

**Shipped a single Supabase migration creating post_slides (with RLS co-deployed), extending posts.content_type to 4 values, adding slide_count and idempotency_key columns, wiring two cleanup triggers into the existing version_cleanup_log queue, and seeding 12 scenery presets into app_settings.style_catalog.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-21T14:44:14Z
- **Completed:** 2026-04-21T14:45:54Z
- **Tasks:** 1
- **Files created:** 1 (178 lines)

## Accomplishments

- Single migration file `supabase/migrations/20260421000000_v1_1_schema_foundation.sql` created — sorts lexicographically AFTER the previous latest (`20260321000000_posts_expires_at.sql`).
- `posts.content_type` CHECK constraint dropped and recreated to accept `('image', 'video', 'carousel', 'enhancement')`.
- `posts.slide_count integer` column added (nullable) — carousel writers in Phase 7 will populate it.
- `posts.idempotency_key text` column added (nullable) with a partial unique index `posts_idempotency_key_unique` (WHERE NOT NULL) — supports carousel/enhancement retry lookups from Phase 7.
- `public.post_slides` table created with `ON DELETE CASCADE` to `posts`, UNIQUE composite `(post_id, slide_number)`, and `idx_post_slides_post_id` btree index for cover-image lookups.
- RLS enabled on `post_slides` with three policies (select/insert/delete) using EXISTS-on-posts pattern mirroring `post_versions`.
- `log_post_slide_cleanup_trigger` (BEFORE DELETE on `post_slides`) enqueues `(image_url, thumbnail_url)` into `version_cleanup_log`.
- `log_enhancement_source_cleanup_trigger` (BEFORE DELETE on `posts`) logs enhancement source paths (`*.webp` → `*-source.webp`) into `version_cleanup_log` when `old.content_type = 'enhancement'`.
- 12 scenery presets seeded into `app_settings.style_catalog.sceneries` via `jsonb_set` guarded by `WHERE (style_catalog->'sceneries') IS NULL OR jsonb_array_length(style_catalog->'sceneries') = 0`.
- All 12 scenery IDs match REQUIREMENTS.md ADMN-02 verbatim: `white-studio, marble-light, marble-dark, wooden-table, concrete-urban, outdoor-natural, kitchen-counter, dark-premium, softbox-studio, pastel-flat, seasonal-festive, cafe-ambience`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create v1.1 schema foundation migration (post_slides + RLS + CHECK extension + slide_count + idempotency_key + cleanup triggers + scenery seed)** — `1f07688` (feat)

## Verification Results

- **Automated structural check (plan's `<verify>` block):** all 26 regex patterns matched. Exited 0.
- **Acceptance criteria audit:**
  - `ls supabase/migrations/ | sort | tail -1` returns `20260421000000_v1_1_schema_foundation.sql` — PASS
  - `create table if not exists public.post_slides` present — PASS
  - `enable row level security` applied to `post_slides` — PASS
  - Three `create policy ... on public.post_slides` statements (select/insert/delete) — PASS
  - `content_type in ('image', 'video', 'carousel', 'enhancement')` present — PASS
  - `add column if not exists slide_count integer` (no `not null`) — PASS
  - `add column if not exists idempotency_key text` (no `not null`) — PASS
  - `create unique index if not exists posts_idempotency_key_unique` — PASS
  - `create unique index if not exists post_slides_post_id_slide_number_key` — PASS
  - `log_post_slide_cleanup_trigger` on `before delete on public.post_slides` — PASS
  - `log_enhancement_source_cleanup_trigger` on `before delete on public.posts` with `old.content_type = 'enhancement'` guard — PASS
  - `jsonb_set` targeting `'{sceneries}'` with `jsonb_array_length` idempotency guard — PASS
  - All 12 scenery IDs verbatim — PASS

## Flag for Plan 03

The migration is ready for `supabase db push`. Plan 03 handles:
- Running `supabase db push` against the target database.
- Verifying RLS via user-scoped client returns non-empty results for owned slides and empty for non-owned.
- Confirming the scenery seed lands in `app_settings.style_catalog.sceneries`.
- Confirming `extractPathFromUrl()` in `server/services/storage-cleanup.service.ts` parses both the slide URLs and the derived `-source.webp` enhancement URLs without modification.

## Decisions Made

- **Single migration, not split** — all six DDL sections (CHECK extension, column adds, post_slides + RLS, two cleanup triggers, scenery seed) shipped in one file. Rationale: atomic schema state prevents the "tables deployed, RLS forgotten" failure mode documented from v1.0 Phase 2 (SHARED-02 pitfall).
- **Partial unique index on idempotency_key** — `WHERE idempotency_key IS NOT NULL` lets existing single-image posts remain NULL while still enforcing uniqueness for carousel/enhancement retry keys. Postgres treats NULLs as distinct by default, but the partial predicate is explicit documentation.
- **Enhancement source path derivation by regex** — the trigger uses `regexp_replace(image_url, '\.webp(\?.*)?$', '-source.webp\1')` with a `~* '\.webp(\?.*)?$'` guard. Non-matching URLs are skipped silently, so any legacy enhancement rows (none expected in v1.1, but safety) cannot break DELETE cascades.
- **`on conflict do nothing` on version_cleanup_log inserts** — same defensive posture as the existing `limit_post_versions_trigger` in `20260310180000`. Duplicate enqueues are harmless but noisy, so suppress silently.

## Deviations from Plan

None — plan executed exactly as written. All 26 structural patterns matched on the first write, all acceptance criteria passed, and no auto-fix rules were triggered.

## Issues Encountered

None.

## User Setup Required

None — this plan only creates the migration file. Plan 03 handles database application.

## Next Phase Readiness

- Plan 03 (migration verification + frontend scenery surfacing) is unblocked: migration file is in place at the expected path, structural patterns verified, ready for `supabase db push`.
- Downstream Phase 6 services can assume: `post_slides` exists with RLS, `posts.slide_count` + `posts.idempotency_key` columns exist, `content_type` accepts `'carousel'` and `'enhancement'`.
- Downstream Phase 7 routes can assume: inserting a slide via the user-scoped Supabase client respects RLS (ownership is verified via `posts.user_id = auth.uid()` join).
- Downstream Phase 8 admin scenery catalog has a seeded starting point; `getStyleCatalogPayload()` will surface the 12 presets once Plan 03 applies the migration.

## Self-Check: PASSED

- FOUND: supabase/migrations/20260421000000_v1_1_schema_foundation.sql
- FOUND: .planning/phases/05-schema-database-foundation/05-02-SUMMARY.md
- FOUND commit: 1f07688

---
*Phase: 05-schema-database-foundation*
*Completed: 2026-04-21*
