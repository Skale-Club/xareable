-- Persist Gemini model identifiers used for token accounting and admin audits.

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS text_model text,
  ADD COLUMN IF NOT EXISTS image_model text;

CREATE INDEX IF NOT EXISTS idx_usage_events_text_model
  ON public.usage_events(text_model);

CREATE INDEX IF NOT EXISTS idx_usage_events_image_model
  ON public.usage_events(image_model);
