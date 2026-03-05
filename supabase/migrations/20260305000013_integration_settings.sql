-- Integration settings table used by admin integrations (GHL, Telegram, etc.)
CREATE TABLE IF NOT EXISTS public.integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_type text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  api_key text,
  location_id text,
  custom_field_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS api_key text,
  ADD COLUMN IF NOT EXISTS location_id text,
  ADD COLUMN IF NOT EXISTS custom_field_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

ALTER TABLE public.integration_settings
  DROP CONSTRAINT IF EXISTS integration_settings_integration_type_key;

ALTER TABLE public.integration_settings
  ADD CONSTRAINT integration_settings_integration_type_key UNIQUE (integration_type);

ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view integration settings" ON public.integration_settings;
CREATE POLICY "Admins can view integration settings"
ON public.integration_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

DROP POLICY IF EXISTS "Admins can update integration settings" ON public.integration_settings;
CREATE POLICY "Admins can update integration settings"
ON public.integration_settings
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

DROP POLICY IF EXISTS "Admins can insert integration settings" ON public.integration_settings;
CREATE POLICY "Admins can insert integration settings"
ON public.integration_settings
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);
