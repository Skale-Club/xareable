-- Add configurable error color for destructive states (toasts, badges, alerts)
ALTER TABLE public.app_settings
ADD COLUMN IF NOT EXISTS error_color TEXT DEFAULT '#ef4444';

-- Backfill existing rows that may have NULL/empty values
UPDATE public.app_settings
SET error_color = '#ef4444'
WHERE error_color IS NULL OR BTRIM(error_color) = '';
