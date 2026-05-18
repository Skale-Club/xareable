-- Phase 12.2: Move platform-default API keys from server env to platform_settings
-- so admins can manage Gemini + OpenAI keys from the admin panel without
-- redeploying. Regular users (non-admin, non-affiliate) consume these keys.
-- Admin/affiliate users continue to use their own profiles.api_key / openai_api_key.

INSERT INTO platform_settings (setting_key, setting_value)
VALUES
  ('gemini_api_key', '""'::jsonb),
  ('openai_api_key', '""'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
