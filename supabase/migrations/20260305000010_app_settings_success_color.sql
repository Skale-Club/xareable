-- Add configurable success color for UI states (integrations, success toasts, etc.)
ALTER TABLE public.app_settings
ADD COLUMN IF NOT EXISTS success_color TEXT DEFAULT '#10b981';

-- Backfill existing rows that may have NULL/empty values
UPDATE public.app_settings
SET success_color = '#10b981'
WHERE success_color IS NULL OR BTRIM(success_color) = '';
