-- Phase 12.1: Per-user image provider preference (gap closure)
-- Admin/affiliate users can pick their own image provider; regular users
-- continue to use the global platform_settings.image_provider default.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS image_provider TEXT
  CHECK (image_provider IS NULL OR image_provider IN ('gemini', 'openai'));
