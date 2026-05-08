-- Phase 16 (v1.3) — extend generation_logs with structured observability fields.
-- Additive only: every new column is NULLABLE (existing rows untouched).
-- Original migration: 20260306000000_generation_logs.sql (do NOT modify).

-- 1. Allow new error_type values for OBS-01..03 failure paths.
ALTER TABLE public.generation_logs
  DROP CONSTRAINT IF EXISTS generation_logs_error_type_check;

ALTER TABLE public.generation_logs
  ADD CONSTRAINT generation_logs_error_type_check
    CHECK (error_type IN (
      'text_generation',
      'image_generation',
      'upload',
      'database',
      'unknown',
      'subject_fidelity',           -- new (OBS-03)
      'text_verification',          -- new (OBS-01 — set when outcome is a failure variant)
      'caption_quality'             -- new (OBS-02 — set when outcome is a failure variant)
    ));

-- 2. First-class structured columns (NULLABLE — existing rows have no values).
ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_kind TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.generation_logs.post_id IS 'Affected post (Phase 16 OBS-01..03). NULL for legacy rows or events with no post yet.';
COMMENT ON COLUMN public.generation_logs.event_kind IS 'One of: text_verification | caption_quality | subject_fidelity. NULL for legacy error rows.';
COMMENT ON COLUMN public.generation_logs.outcome IS 'Per-event outcome union (e.g. pass | repair_succeeded | fallback_used). String — type-safety enforced server-side in observability.service.ts.';
COMMENT ON COLUMN public.generation_logs.metadata IS 'Per-event extra fields (expected_text_hash, detected_text, final_caption_length, reference_image_count, failure_reason, ...).';

-- 3. Indexes for typical observability queries.
CREATE INDEX IF NOT EXISTS idx_generation_logs_post_id
  ON public.generation_logs (post_id) WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_logs_event_kind_outcome
  ON public.generation_logs (event_kind, outcome) WHERE event_kind IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_logs_created_event
  ON public.generation_logs (created_at DESC, event_kind) WHERE event_kind IS NOT NULL;

-- 4. RLS unchanged — admin-only read + service-role insert from the original migration still apply.
