# Phase 5: Schema & Database Foundation - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the shared TypeScript types and database surface that every downstream v1.1 phase depends on:

1. Extend `shared/schema.ts` with Zod schemas: `postSlideSchema`, `carouselRequestSchema`, `enhanceRequestSchema`, `scenerySchema`, and extend `postSchema.content_type` to `["image", "video", "carousel", "enhancement"]`.
2. Ship a single Supabase migration that (a) creates the `post_slides` table with RLS co-deployed, (b) extends the `posts.content_type` CHECK constraint, (c) adds `posts.slide_count` (nullable int), (d) adds `posts.idempotency_key` (unique, nullable text), (e) wires storage cleanup so per-slide files + enhancement source files are removed on post deletion, and (f) merges 12 scenery presets into the existing `app_settings.style_catalog` JSON.
3. Export `scenerySchema` and extend `styleCatalogSchema` so the existing `getStyleCatalogPayload()` endpoint surfaces sceneries to the frontend cache path (no new endpoint).

Out of scope for this phase: any service, route, admin UI, or frontend code. Phase 5 succeeds when `npm run check` is green and `supabase db push` applies cleanly with RLS verified on the user-scoped client.

</domain>

<decisions>
## Implementation Decisions

### post_slides lifecycle & cleanup

- **D-01:** `post_slides` uses `ON DELETE CASCADE` from `posts` — slides disappear when the parent post is deleted or expires. Mirrors the `post_versions` pattern in `supabase/migrations/20260304000002_add_post_versions_table.sql`.
- **D-02:** Uniqueness constraint: `UNIQUE (post_id, slide_number)` — identical pattern to `post_versions_post_id_version_number_key`.
- **D-03:** Reuse the existing `version_cleanup_log` table for async storage deletion — do NOT create a `slide_cleanup_log`. Add a `BEFORE DELETE` trigger on `post_slides` that inserts `(image_url, thumbnail_url)` into `version_cleanup_log`; the existing `processStorageCleanup()` in `server/services/storage-cleanup.service.ts` already handles the drain.
- **D-04:** For `enhancement` posts, add a `BEFORE DELETE` trigger on `posts` that, when `content_type = 'enhancement'`, logs the source file path (derived by convention from `posts.image_url`) into `version_cleanup_log`. Keeps cleanup unified through the same async queue.
- **D-05:** Indexes on `post_slides`: primary key on `id`, unique composite on `(post_id, slide_number)`, and a `post_id` btree index for cover-image lookups. No other indexes in this phase.

### Storage path layout

- **D-06:** Carousel slide files are nested per post: `user_assets/{userId}/carousel/{postId}/slide-{N}.webp` and colocated thumbnails `user_assets/{userId}/carousel/{postId}/slide-{N}-thumb.webp`. This keeps the existing `generated/` prefix dedicated to single-image posts and enables bulk folder removal at cleanup time.
- **D-07:** Enhancement files follow `ENHC-07` exactly: result at `user_assets/{userId}/enhancement/{postId}.webp`, original source at `user_assets/{userId}/enhancement/{postId}-source.webp`. Both live in the same prefix so folder listing before delete is cheap.
- **D-08:** `post_slides.image_url` and `post_slides.thumbnail_url` store the public URL (same convention as `posts.image_url`), so `extractPathFromUrl()` in `storage-cleanup.service.ts` works unchanged.

### idempotency_key scope & nullability

- **D-09:** `posts.idempotency_key` is a nullable `text` column with a global `UNIQUE` constraint. Existing single-image posts remain `NULL`; carousel and enhancement routes (Phase 7) are the only writers that set it.
- **D-10:** Format: client-generated UUID v4, validated in Zod at the request boundary. The DB enforces uniqueness only; no CHECK on length or format (keeps the migration minimal).
- **D-11:** Retention: indefinite. Keys live as long as the row lives; the existing 30-day post expiration sweep removes them naturally. No separate purge job.
- **D-12:** Lookup pattern for retry: `SELECT id FROM posts WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`. The UNIQUE index covers the retry lookup; no dedicated composite index needed in this phase.

### Scenery seed strategy

- **D-13:** Seeds land inside the existing `app_settings.style_catalog` JSON via a single migration. Use `jsonb_set(style_catalog, '{sceneries}', $preset_json::jsonb, true)` with a guard: `WHERE (style_catalog->'sceneries') IS NULL OR jsonb_array_length(style_catalog->'sceneries') = 0` so re-running the migration never clobbers admin edits.
- **D-14:** 12 presets seeded per `ADMN-02`: `white-studio, marble-light, marble-dark, wooden-table, concrete-urban, outdoor-natural, kitchen-counter, dark-premium, softbox-studio, pastel-flat, seasonal-festive, cafe-ambience`. Each preset: `{ id, label, prompt_snippet, preview_image_url: null, is_active: true }`.
- **D-15:** `scenerySchema` is exported from `shared/schema.ts` and added to `styleCatalogSchema` as `sceneries: z.array(scenerySchema).optional()` — mirrors how `text_styles`, `post_formats`, etc. are attached. The existing `getStyleCatalogPayload()` endpoint automatically surfaces sceneries through the same cache path (`ADMN-03`).
- **D-16:** Scenery prompt snippets are authored in English only in this phase. Admin UI for editing ships in Phase 8.

### Zod schema shapes (locked in this phase)

- **D-17:** `postSchema.content_type` changes from `z.enum(["image", "video"])` to `z.enum(["image", "video", "carousel", "enhancement"])`. All downstream `.enum(["image", "video"])` literals (including `postGalleryItemSchema`, `generateResponseSchema`, `billingStatementItemSchema`) update in lockstep in the same commit — a TypeScript `never` exhaustiveness guard on gallery rendering is Phase 10's job, not this phase.
- **D-18:** `postSchema` gains `slide_count: z.number().int().positive().nullable()` and `idempotency_key: z.string().uuid().nullable()`.
- **D-19:** `postSlideSchema` fields: `id` (uuid), `post_id` (uuid), `slide_number` (int, positive), `image_url` (string), `thumbnail_url` (string, nullable), `created_at` (string).
- **D-20:** `carouselRequestSchema` fields: `prompt` (min 1), `slide_count` (int, 3–8), `aspect_ratio` (enum `["1:1", "4:5"]`), `idempotency_key` (uuid), `content_language` (enum SUPPORTED_LANGUAGES), plus shared brand fields consumed by the generator (mood, style ids) matching the `generateRequestSchema` conventions. Service/route implementation details (reference images, text blocks) are Phase 6/7 decisions.
- **D-21:** `enhanceRequestSchema` fields: `scenery_id` (string), `idempotency_key` (uuid), `image` (mimeType + base64 data object, ≤5 MB enforced at route layer — Phase 7). No free-text scenery modifier (deferred to v2 per `ENHC-V2-01`).
- **D-22:** `scenerySchema` fields: `id` (string, min 1), `label` (string, min 1), `prompt_snippet` (string, min 1), `preview_image_url` (string, nullable), `is_active` (boolean, default true).

### Claude's Discretion

- Exact Zod error messages / `.describe()` annotations.
- Whether `postSlideSchema` lives before or after `postSchema` in the file (preserve existing section ordering).
- SQL formatting conventions (lowercase DDL matches the existing migration style in `20260304000002_add_post_versions_table.sql`).
- Comment style in the migration (follow existing convention: `-- Migration: <title>` + section dividers).

### Folded Todos

None — no pending todos matched Phase 5 scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements (authoritative scope)
- `.planning/ROADMAP.md` §"Phase 5: Schema & Database Foundation" — phase goal + 6 success criteria
- `.planning/REQUIREMENTS.md` §"Schema & Storage (SCHM)" — SCHM-01..06
- `.planning/REQUIREMENTS.md` §"Creator UI (CRTR)" CRTR-04 — client-generated UUID idempotency_key is a Phase 9 consumer of this phase's column
- `.planning/REQUIREMENTS.md` §"Billing & Credits (BILL)" BILL-04 — retry via idempotency_key must not double-charge (Phase 7 consumer)

### Research (supporting analysis)
- `.planning/research/SUMMARY.md` §"Phase 1: Schema and Database Foundation" (numbering = old; this is Phase 5 in v1.1) — rationale for dedicated `post_slides` table, CHECK vs ENUM, RLS co-deployment rule
- `.planning/research/ARCHITECTURE.md` — dedicated `post_slides` table decision rationale
- `.planning/research/PITFALLS.md` — SHARED-02 (RLS co-deployment), CAROUSEL-08 (storage cleanup correctness), CAROUSEL-09 (CHECK-not-ENUM)

### Existing code to mirror (patterns this phase extends)
- `shared/schema.ts` §"postSchema" (lines 364–376) — extend `content_type` enum here
- `shared/schema.ts` §"styleCatalogSchema" (lines 167–175) — attach `sceneries` here
- `shared/schema.ts` §"DEFAULT_STYLE_CATALOG" (lines 178–359) — reference shape for seed ordering
- `supabase/migrations/20260304000002_add_post_versions_table.sql` — the blueprint for `post_slides` (DDL + RLS co-deployed + unique composite index)
- `supabase/migrations/20260305000012_posts_media_fields.sql` — the blueprint for the CHECK-constraint drop-and-recreate pattern
- `supabase/migrations/20260310180000_version_limit_and_storage_cleanup.sql` — the `version_cleanup_log` pattern this phase reuses
- `supabase/migrations/20260321000000_posts_expires_at.sql` — reference for `posts` ALTER + index + function pattern
- `server/services/storage-cleanup.service.ts` — consumer of `version_cleanup_log`; `extractPathFromUrl()` convention must keep working

### Project guidance
- `CLAUDE.md` — architecture conventions, Zod single-source-of-truth rule, `shared/schema.ts` as single source of truth
- `.planning/PROJECT.md` — v1.1 constraints (English-only strings, admin vs user Supabase clients, storage layout)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`version_cleanup_log` table + RPCs (`get_pending_storage_cleanup`, `mark_storage_cleaned`)** — existing async cleanup queue. Reused for `post_slides` deletion and enhancement source cleanup; no new table required.
- **`extractPathFromUrl()` in `server/services/storage-cleanup.service.ts`** — extracts storage path from public URL. Works unchanged for new `carousel/{postId}/` and `enhancement/` prefixes since both live under `user_assets/`.
- **`styleCatalogSchema` attachment pattern** — `text_styles`, `post_formats`, `video_formats`, `ai_models` are all attached as `.optional()` arrays. `sceneries` follows the same shape.
- **`getStyleCatalogPayload()` endpoint + cache** — already wired for the frontend. Adding `sceneries` to the schema automatically surfaces it (ADMN-03 requirement).

### Established Patterns
- **RLS co-deployment:** Every new table must `ENABLE ROW LEVEL SECURITY` + create policies in the same SQL file. Failure mode: user-scoped client silently returns empty arrays (documented in v1.0 Phase 2).
- **CHECK-constraint extension:** `ALTER TABLE … DROP CONSTRAINT IF EXISTS x_check; ALTER TABLE … ADD CONSTRAINT x_check CHECK (col IN (…))`. Idempotent, no downtime — established in `20260305000012_posts_media_fields.sql`.
- **Singleton `app_settings` row updates:** Use `jsonb_set` with an idempotency guard (`WHERE path IS NULL OR path = 'old-value'`) so re-running the migration is safe.
- **Trigger naming:** `<event>_<table>_trigger` (see `limit_post_versions_trigger`). Follow the same convention for any new triggers.
- **Lowercase SQL DDL:** The project uses lowercase `create table`, `alter table`. Match it.

### Integration Points
- **`posts` table** — gains `slide_count` (nullable int), `idempotency_key` (unique, nullable text). Existing `content_type` CHECK constraint is dropped and recreated with the 2 new values.
- **`app_settings.style_catalog` (singleton row)** — `sceneries` key merged in via `jsonb_set`.
- **`version_cleanup_log`** — unchanged schema; gains two new producers (trigger on `post_slides` DELETE, trigger on `posts` DELETE for enhancement content_type).
- **`shared/schema.ts` module** — four new exports (`postSlideSchema`, `carouselRequestSchema`, `enhanceRequestSchema`, `scenerySchema`), one extended export (`styleCatalogSchema`), one extended enum (`postSchema.content_type` and downstream mirrors).

</code_context>

<specifics>
## Specific Ideas

- All 12 scenery preset IDs are already listed in `REQUIREMENTS.md` ADMN-02. Use those exact IDs verbatim in the seed — they are contract surface for Phase 8 admin UI.
- `preview_image_url` starts as `null` for all seeded sceneries; admin uploads come in Phase 8. Frontend must treat `null` gracefully (Phase 9).
- Partial-success carousel save (`status = "draft"`) does not need a new enum value on `posts.status` — the existing `status` column is `text` and already accepts arbitrary values.
- Admin Supabase client is required for the migration's `jsonb_set` update since `app_settings` RLS restricts writes to admins.

</specifics>

<deferred>
## Deferred Ideas

- **Individual slide regeneration v2 (`CRSL-V2-01`)** — would require persisting `shared_style` on the `posts` row. Deferred from this schema phase; add in the v2 milestone.
- **User-uploaded custom sceneries (`ENHC-V2-04`)** — would require a per-user scenery table. Deferred; v1.1 is admin-curated only.
- **Free-text scenery modifier (`ENHC-V2-01`)** — would add a `modifier` field on `enhanceRequestSchema`. Deferred; preset-only in v1.1.
- **Dedicated `storage_cleanup_log` separate from `version_cleanup_log`** — evaluated but rejected; the existing log shape `(image_url, thumbnail_url)` covers slides and enhancement source files without modification. Revisit only if cleanup semantics diverge in v2.
- **Per-user composite `UNIQUE (user_id, idempotency_key)`** — evaluated but rejected; client-generated UUID v4 is effectively collision-free and a simpler global unique index keeps the retry lookup path cheap.

### Reviewed Todos (not folded)

None.

</deferred>

---

*Phase: 05-schema-database-foundation*
*Context gathered: 2026-04-21*
