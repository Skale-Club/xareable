-- Phase 25 (CRSL2-02) — Narrative Carousels & Aesthetic DNA.
-- Additive ONLY, mirroring the Phase 23 posts/post_versions migration
-- (20260728000000_posts_base_image_typography_generation_params.sql). Every
-- column is nullable with no default and no backfill: slides created before
-- this migration keep base_image_url IS NULL forever and are handled by the
-- LEGACY branch in carousel.routes.ts's slide-edit path.
--
-- base_image_url    : the raw AI slide image AFTER the deterministic
--                      aspect-ratio crop but BEFORE typography and logo
--                      compositing.
-- typography_meta   : {compositor_version, layout_archetype_id, text_blocks[],
--                      text_color, fonts[], scrim|null, safe_zone, canvas} —
--                      see shared/schema.ts typographyMetaSchema.
--
-- Both post_slides AND post_slide_versions gain the same two columns so every
-- slide edit persists its own re-composited base + meta, exactly like
-- postVersionSchema does for single-image posts.

ALTER TABLE public.post_slides
  ADD COLUMN IF NOT EXISTS base_image_url text,
  ADD COLUMN IF NOT EXISTS typography_meta jsonb;

ALTER TABLE public.post_slide_versions
  ADD COLUMN IF NOT EXISTS base_image_url text,
  ADD COLUMN IF NOT EXISTS typography_meta jsonb;
