-- Phase 23 (TYPO-05, POL-05) — Deterministic Typography & Edit Fidelity.
-- Additive ONLY. Every column is nullable with no default and no backfill:
-- posts created before this migration keep base_image_url IS NULL forever and
-- are handled by edit.routes.ts's LEGACY branch (23-CONTEXT.md locks "no
-- backfill migration, no lockout").
--
-- base_image_url    : the raw AI image AFTER the deterministic aspect-ratio crop
--                     but BEFORE typography and logo compositing.
-- typography_meta   : {compositor_version, layout_archetype_id, text_blocks[],
--                      fonts[], scrim|null, safe_zone} — see shared/schema.ts
--                      typographyMetaSchema.
-- generation_params : {aspect_ratio, image_resolution, video_resolution,
--                      video_duration, use_text, text_mode, use_logo,
--                      logo_position, post_mood, content_language,
--                      content_type, text_style_ids[]} — see
--                      shared/schema.ts generationParamsSchema.
--
-- generation_params is deliberately NOT added to post_versions: edits/remakes
-- read the ORIGINAL post's params (23-RESEARCH.md Pattern 4). typography_meta
-- IS per-version because every edit re-runs the compositor.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS base_image_url text,
  ADD COLUMN IF NOT EXISTS typography_meta jsonb,
  ADD COLUMN IF NOT EXISTS generation_params jsonb;

ALTER TABLE public.post_versions
  ADD COLUMN IF NOT EXISTS base_image_url text,
  ADD COLUMN IF NOT EXISTS typography_meta jsonb;
