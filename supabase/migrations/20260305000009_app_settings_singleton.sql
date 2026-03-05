-- Harden app_settings as a singleton table and clean duplicates

-- Ensure GTM columns exist in case previous migration was skipped
ALTER TABLE public.app_settings
ADD COLUMN IF NOT EXISTS gtm_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS gtm_container_id TEXT;

-- Keep only the latest row when duplicates exist
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.app_settings
)
DELETE FROM public.app_settings s
USING ranked r
WHERE s.id = r.id
  AND r.rn > 1;

-- Guarantee one settings row exists
INSERT INTO public.app_settings (app_name, app_tagline, meta_title, meta_description)
SELECT
  'Xareable',
  'AI-Powered Social Media Content Creation',
  'Xareable - AI Social Media Content Creator',
  'Create stunning social media images and captions with AI, tailored to your brand identity.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings
);

-- Enforce singleton invariant
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_singleton_idx
ON public.app_settings ((true));
