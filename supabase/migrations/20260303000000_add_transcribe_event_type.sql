-- Add 'transcribe' to usage_events.event_type check constraint
ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_event_type_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_event_type_check
  CHECK (event_type IN ('generate', 'edit', 'transcribe'));
