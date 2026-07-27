-- Phase 21: OpenRouter Gateway Foundation (GATE-05)
-- Additive metadata column storing the pre-call estimate alongside the
-- post-call real OpenRouter cost. Mirrors generation_logs' Phase 16 pattern
-- (20260508000000_generation_logs_observability.sql).

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.usage_events.metadata IS 'Phase 21 GATE-05: { estimated_cost_usd_micros, real_cost_usd_micros } — pre-call estimate + OpenRouter post-call actual, present only when the gateway path was used. NULL/{} for legacy rows and flat-fallback (video) charges.';
