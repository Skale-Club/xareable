-- Phase 12: Image Provider Abstraction (PROV-04, PROV-06)
-- Apply manually via Supabase Dashboard > SQL Editor.
-- Do NOT run drizzle-kit push for this migration (Phase 11 convention).

-- 1. Add OpenAI API key column to profiles (nullable, for admin/affiliate use)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS openai_api_key TEXT;

-- 2. Seed default image provider setting (idempotent)
INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('image_provider', 'gemini')
ON CONFLICT (setting_key) DO NOTHING;
