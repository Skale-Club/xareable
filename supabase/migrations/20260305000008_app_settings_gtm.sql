-- Add Google Tag Manager settings to app_settings
ALTER TABLE public.app_settings
ADD COLUMN IF NOT EXISTS gtm_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS gtm_container_id TEXT;
