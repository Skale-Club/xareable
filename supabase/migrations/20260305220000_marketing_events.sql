-- Marketing events log + GA4/Facebook Dataset integration defaults

CREATE TABLE IF NOT EXISTS public.marketing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text,
  event_name text NOT NULL,
  event_source text NOT NULL DEFAULT 'app',
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  email text,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ga4_status text NOT NULL DEFAULT 'queued',
  ga4_response jsonb,
  facebook_status text NOT NULL DEFAULT 'queued',
  facebook_response jsonb,
  processed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.marketing_events
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS event_source text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ga4_status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS ga4_response jsonb,
  ADD COLUMN IF NOT EXISTS facebook_status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS facebook_response jsonb,
  ADD COLUMN IF NOT EXISTS processed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

ALTER TABLE public.marketing_events
  ALTER COLUMN event_name SET NOT NULL;

ALTER TABLE public.marketing_events
  ALTER COLUMN ga4_status SET NOT NULL,
  ALTER COLUMN facebook_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_events_ga4_status_check'
  ) THEN
    ALTER TABLE public.marketing_events
      ADD CONSTRAINT marketing_events_ga4_status_check
      CHECK (ga4_status IN ('queued', 'sent', 'failed', 'skipped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_events_facebook_status_check'
  ) THEN
    ALTER TABLE public.marketing_events
      ADD CONSTRAINT marketing_events_facebook_status_check
      CHECK (facebook_status IN ('queued', 'sent', 'failed', 'skipped'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_events_event_key_unique
  ON public.marketing_events (event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_events_created_at
  ON public.marketing_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_events_user_id
  ON public.marketing_events (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_events_ga4_status
  ON public.marketing_events (ga4_status);

CREATE INDEX IF NOT EXISTS idx_marketing_events_facebook_status
  ON public.marketing_events (facebook_status);

ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view marketing events" ON public.marketing_events;
CREATE POLICY "Admins can view marketing events"
ON public.marketing_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

DROP POLICY IF EXISTS "Admins can insert marketing events" ON public.marketing_events;
CREATE POLICY "Admins can insert marketing events"
ON public.marketing_events
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

DROP POLICY IF EXISTS "Admins can update marketing events" ON public.marketing_events;
CREATE POLICY "Admins can update marketing events"
ON public.marketing_events
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

INSERT INTO public.integration_settings (integration_type, enabled, custom_field_mappings)
VALUES ('ga4', false, '{}'::jsonb)
ON CONFLICT (integration_type) DO NOTHING;

INSERT INTO public.integration_settings (integration_type, enabled, custom_field_mappings)
VALUES ('facebook_dataset', false, '{}'::jsonb)
ON CONFLICT (integration_type) DO NOTHING;

UPDATE public.integration_settings AS dataset
SET
  enabled = COALESCE(dataset.enabled, legacy.enabled),
  api_key = COALESCE(dataset.api_key, legacy.api_key),
  location_id = COALESCE(dataset.location_id, legacy.location_id),
  custom_field_mappings = COALESCE(legacy.custom_field_mappings, '{}'::jsonb) || COALESCE(dataset.custom_field_mappings, '{}'::jsonb),
  last_sync_at = COALESCE(dataset.last_sync_at, legacy.last_sync_at),
  updated_at = timezone('utc'::text, now())
FROM public.integration_settings AS legacy
WHERE dataset.integration_type = 'facebook_dataset'
  AND legacy.integration_type = 'facebook';

DELETE FROM public.integration_settings
WHERE integration_type = 'facebook';
