-- Phase 25 (PLAN-07) — Admin-Curated Style Reference Boards.
-- Platform-curated style reference boards: an admin attaches a small set of
-- reference photos to a style_catalog "style" or "post_mood" entry, and
-- generation-time code merges them into the reference-image slot budget
-- (server/services/style-reference.service.ts, a future plan's job).
--
-- Ownership model is INVERTED vs brand_reference_photos (which is scoped to
-- the owning user via an equality check on auth.uid()): public SELECT +
-- admin-only write, following the app_settings precedent
-- (20260303000010_app_settings.sql) exactly, per 25-CONTEXT.md's locked
-- decision.
--
-- style_id is a style_catalog JSONB entry id (app_settings.style_catalog,
-- styles[].id / post_moods[].id) — NOT a relational table row — so no
-- foreign key is possible here.

CREATE TABLE IF NOT EXISTS public.style_reference_photos (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scope      TEXT NOT NULL DEFAULT 'style' CHECK (scope IN ('style', 'post_mood')),
  style_id   TEXT NOT NULL,
  photo_url  TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_style_reference_photos_lookup
  ON public.style_reference_photos (scope, style_id, position);

ALTER TABLE public.style_reference_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "style_reference_photos_select" ON public.style_reference_photos;
CREATE POLICY "style_reference_photos_select"
  ON public.style_reference_photos FOR SELECT USING (true);

DROP POLICY IF EXISTS "style_reference_photos_insert" ON public.style_reference_photos;
CREATE POLICY "style_reference_photos_insert"
  ON public.style_reference_photos FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

DROP POLICY IF EXISTS "style_reference_photos_update" ON public.style_reference_photos;
CREATE POLICY "style_reference_photos_update"
  ON public.style_reference_photos FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

DROP POLICY IF EXISTS "style_reference_photos_delete" ON public.style_reference_photos;
CREATE POLICY "style_reference_photos_delete"
  ON public.style_reference_photos FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );
