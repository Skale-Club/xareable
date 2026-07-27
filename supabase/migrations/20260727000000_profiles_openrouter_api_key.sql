-- Phase 21.1: Affiliate OpenRouter BYOK column (additive — GATE-06)
-- Old api_key / openai_api_key columns are RETAINED: api_key is still LIVE for
-- the GATE-08-frozen direct-Google video path (affiliates keep a video-only
-- Gemini key field in Settings); openai_api_key is retained dead. Nothing is
-- ever dropped, so no affiliate is locked out mid-migration (ROADMAP 21.1 SC1).
-- No data is copied from api_key/openai_api_key — a different provider and a
-- different account; each affiliate must paste their own OpenRouter key in
-- Settings.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS openrouter_api_key TEXT;
