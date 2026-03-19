ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view stripe webhook events" ON public.stripe_webhook_events;
CREATE POLICY "Admins can view stripe webhook events"
ON public.stripe_webhook_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);
