-- Social Publishing (Zernio) — data layer (Project P001/P002)
-- Adds the per-user OAuth connection store, the scheduled-post store, and the
-- two new profiles columns that drive the feature:
--   * publishing_mode  — super-admin-controlled feature gate (disabled|byok|platform)
--   * zernio_api_key    — per-user BYOK Zernio key (client's own, like openai_api_key)
--
-- SECURITY: profiles RLS (20260310100000) lets a user UPDATE any column of their
-- own row, and the client writes profiles directly (settings.tsx). publishing_mode
-- MUST therefore be protected by a trigger so a user cannot self-grant 'platform'
-- (which would spend Xareable's platform Zernio key). zernio_api_key stays
-- user-writable on purpose (it is the client's own key).

-- ============================================================
-- PART 1: profiles columns
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS publishing_mode TEXT NOT NULL DEFAULT 'disabled'
    CHECK (publishing_mode IN ('disabled', 'byok', 'platform'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS zernio_api_key TEXT;

COMMENT ON COLUMN public.profiles.publishing_mode IS
  'Super-admin controlled Social Publishing gate. disabled=off (default), byok=client uses own Zernio key, platform=Xareable platform key. Enforced by enforce_publishing_mode_admin_only trigger, NOT by RLS.';
COMMENT ON COLUMN public.profiles.zernio_api_key IS
  'Per-user BYOK Zernio API key (the client''s own key). User-writable, like openai_api_key.';

-- ============================================================
-- PART 2: publishing_mode admin-only guard (trigger)
-- Mirrors enforce_admin_affiliate_exclusion (20260310220000).
-- Allows the change only from the service role (auth.uid() IS NULL — the server
-- admin path uses the service-role key) or from an admin user. Any other caller
-- (a regular user editing their own profile row) has publishing_mode reverted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_publishing_mode_admin_only()
RETURNS TRIGGER AS $$
DECLARE
  is_privileged BOOLEAN;
BEGIN
  -- Service-role / server-side writes have no end-user JWT (auth.uid() IS NULL).
  -- Admin users are allowed to change it directly as well.
  is_privileged := (
    auth.uid() IS NULL
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

  IF NOT is_privileged THEN
    IF TG_OP = 'INSERT' THEN
      NEW.publishing_mode := 'disabled';
    ELSIF TG_OP = 'UPDATE' AND NEW.publishing_mode IS DISTINCT FROM OLD.publishing_mode THEN
      NEW.publishing_mode := OLD.publishing_mode;
      RAISE NOTICE 'publishing_mode is admin-controlled; change ignored.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_publishing_mode_admin_only_trigger ON public.profiles;
CREATE TRIGGER enforce_publishing_mode_admin_only_trigger
  BEFORE INSERT OR UPDATE OF publishing_mode ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_publishing_mode_admin_only();

-- ============================================================
-- PART 3: social_connections (per-user OAuth connections)
-- RLS pattern mirrors brand_reference_photos (20260516000000).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.social_connections (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  zernio_profile_id  TEXT NOT NULL,
  zernio_account_id  TEXT NOT NULL,
  platform           TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_name       TEXT,
  account_avatar_url TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  connected_at       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  last_synced_at     TIMESTAMP WITH TIME ZONE,
  UNIQUE (user_id, zernio_account_id)
);

CREATE INDEX IF NOT EXISTS idx_social_connections_user_id
  ON public.social_connections (user_id);

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own connections" ON public.social_connections;
CREATE POLICY "Users can view own connections"
  ON public.social_connections FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own connections" ON public.social_connections;
CREATE POLICY "Users can insert own connections"
  ON public.social_connections FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own connections" ON public.social_connections;
CREATE POLICY "Users can update own connections"
  ON public.social_connections FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own connections" ON public.social_connections;
CREATE POLICY "Users can delete own connections"
  ON public.social_connections FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- PART 4: scheduled_posts (per-user scheduled/published posts)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id         UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  zernio_post_id  TEXT,
  caption         TEXT,
  media_urls      JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_for   TIMESTAMP WITH TIME ZONE,
  timezone        TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'canceled')),
  error_message   TEXT,
  published_at    TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_id
  ON public.scheduled_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_for
  ON public.scheduled_posts (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status
  ON public.scheduled_posts (status);

ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own scheduled posts" ON public.scheduled_posts;
CREATE POLICY "Users can view own scheduled posts"
  ON public.scheduled_posts FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own scheduled posts" ON public.scheduled_posts;
CREATE POLICY "Users can insert own scheduled posts"
  ON public.scheduled_posts FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own scheduled posts" ON public.scheduled_posts;
CREATE POLICY "Users can update own scheduled posts"
  ON public.scheduled_posts FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own scheduled posts" ON public.scheduled_posts;
CREATE POLICY "Users can delete own scheduled posts"
  ON public.scheduled_posts FOR DELETE
  USING (user_id = auth.uid());
