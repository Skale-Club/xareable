-- Phase 21: OpenRouter Gateway Foundation (GATE-04, GATE-07)
-- Seed default routing + fallback-chain settings (idempotent, additive).
-- Apply manually via Supabase Dashboard > SQL Editor (Phase 11 convention —
-- do NOT run drizzle-kit push for this migration).

INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('ai_gateway_routing', '{"planning":"openrouter","image":"openrouter","transcription":"openrouter"}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('ai_model_fallbacks', '{"text":[],"image":[],"transcription":[]}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
