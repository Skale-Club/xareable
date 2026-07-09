-- Content Autopilot (Project P002) — data layer
-- Adds content_plans (per-user automated content plans) and extends
-- scheduled_posts with a content_plan_id link + a 'pending_approval' status
-- for the approval queue. Depends on 20260709000000_social_publishing_zernio.sql.

-- ============================================================
-- PART 1: content_plans (per-user, RLS mirrors brand_reference_photos)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.content_plans (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL DEFAULT 'Untitled plan',
  status                    TEXT NOT NULL DEFAULT 'paused'
                              CHECK (status IN ('active', 'paused', 'budget_exhausted')),
  -- Direction: a free-text brief + a rotating list of themes.
  brief                     TEXT,
  themes                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  theme_cursor              INTEGER NOT NULL DEFAULT 0,
  content_type              TEXT NOT NULL DEFAULT 'image'
                              CHECK (content_type IN ('image')),  -- v1: image only
  target_accounts           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- social_connection ids
  -- Frequency: presets + custom (days-of-week + time + timezone).
  frequency_preset          TEXT NOT NULL DEFAULT 'weekly'
                              CHECK (frequency_preset IN ('daily', 'three_per_week', 'weekly', 'custom')),
  custom_days               JSONB NOT NULL DEFAULT '[]'::jsonb,   -- e.g. [1,3,5] (0=Sun..6=Sat)
  post_time                 TEXT NOT NULL DEFAULT '09:00',        -- HH:MM local to timezone
  timezone                  TEXT NOT NULL DEFAULT 'UTC',
  auto_approve              BOOLEAN NOT NULL DEFAULT false,       -- default OFF (approval queue)
  -- Spend guardrail: a monthly credit budget in micros. 0 = not set (plan never runs).
  monthly_budget_micros     BIGINT NOT NULL DEFAULT 0,
  spent_this_period_micros  BIGINT NOT NULL DEFAULT 0,
  period_started_at         TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  next_run_at               TIMESTAMP WITH TIME ZONE,
  last_run_at               TIMESTAMP WITH TIME ZONE,
  created_at                TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at                TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_plans_user_id ON public.content_plans (user_id);
-- Cron selects due, active plans; index the hot path.
CREATE INDEX IF NOT EXISTS idx_content_plans_due
  ON public.content_plans (next_run_at) WHERE status = 'active';

ALTER TABLE public.content_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own content plans" ON public.content_plans;
CREATE POLICY "Users can view own content plans"
  ON public.content_plans FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own content plans" ON public.content_plans;
CREATE POLICY "Users can insert own content plans"
  ON public.content_plans FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own content plans" ON public.content_plans;
CREATE POLICY "Users can update own content plans"
  ON public.content_plans FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own content plans" ON public.content_plans;
CREATE POLICY "Users can delete own content plans"
  ON public.content_plans FOR DELETE USING (user_id = auth.uid());

-- ============================================================
-- PART 2: scheduled_posts — link to a plan + approval-queue status
-- ============================================================

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS content_plan_id UUID REFERENCES public.content_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_content_plan_id
  ON public.scheduled_posts (content_plan_id);

-- Extend the status CHECK to include 'pending_approval' (autopilot approval queue).
ALTER TABLE public.scheduled_posts
  DROP CONSTRAINT IF EXISTS scheduled_posts_status_check;
ALTER TABLE public.scheduled_posts
  ADD CONSTRAINT scheduled_posts_status_check
  CHECK (status IN ('draft', 'pending_approval', 'scheduled', 'publishing', 'published', 'failed', 'canceled'));
