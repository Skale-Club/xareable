-- Migration: Zernio Social Publishing — P1 Foundation
-- Adds: user_zernio_settings (per-user BYOK credential + profile bookkeeping),
--       social_accounts (cache of connected Zernio accounts), post_publications
--       (one row per post × platform-target × attempt), plus RLS for all three.
-- Seeds three platform_settings keys used by admin "global mode": the
-- platform-wide Zernio API key, its enabled flag, and the global webhook
-- signing secret.
--
-- Source of truth: docs/zernio-social-publishing.md ("Data model" section).
-- Additive only — no existing column, table, or policy is altered or dropped.
--
-- Credential hierarchy this schema supports (resolveZernioCredentials):
--   1. user_zernio_settings.api_key set                    -> BYOK mode
--   2. else platform_settings.zernio_global_enabled = true
--      AND platform_settings.zernio_global_api_key set     -> global mode
--   3. else                                                -> social publishing unavailable
--
-- Depends on: public.posts (post_publications.post_id FK),
--             public.platform_settings (existing key/value JSONB store,
--             see 20260303010000_pay_per_use_billing.sql).

-- ============================================================
-- PART 1: user_zernio_settings — one row per user
-- ============================================================

create table if not exists public.user_zernio_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  api_key text,
  zernio_profile_id text,
  global_zernio_profile_id text,
  webhook_secret text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- PART 2: social_accounts — cache of connected Zernio accounts
-- ============================================================

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  zernio_account_id text not null,
  platform text not null,
  username text,
  display_name text,
  avatar_url text,
  connection_mode text not null default 'byok',
  is_active boolean not null default true,
  connected_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, zernio_account_id)
);

-- ============================================================
-- PART 3: post_publications — one row per (post × platform target × attempt)
-- ============================================================

create table if not exists public.post_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  social_account_id uuid references public.social_accounts(id) on delete set null,
  platform text not null,
  mode text not null default 'byok',
  zernio_post_id text,
  status text not null default 'pending',
  platform_post_id text,
  platform_post_url text,
  error_message text,
  scheduled_for timestamptz,
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- PART 4: Indexes
-- ============================================================

create index if not exists idx_post_publications_post_id
  on public.post_publications (post_id);

create index if not exists idx_post_publications_user_id_status
  on public.post_publications (user_id, status);

create index if not exists idx_social_accounts_user_id
  on public.social_accounts (user_id);

-- ============================================================
-- PART 5: Row Level Security
-- ============================================================

alter table public.user_zernio_settings enable row level security;
alter table public.social_accounts enable row level security;
alter table public.post_publications enable row level security;

-- user_zernio_settings: owner-managed end to end (service role bypasses RLS
-- for anything the app does not do on behalf of the signed-in user).
drop policy if exists "Users can view own zernio settings" on public.user_zernio_settings;
create policy "Users can view own zernio settings" on public.user_zernio_settings
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own zernio settings" on public.user_zernio_settings;
create policy "Users can insert own zernio settings" on public.user_zernio_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own zernio settings" on public.user_zernio_settings;
create policy "Users can update own zernio settings" on public.user_zernio_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own zernio settings" on public.user_zernio_settings;
create policy "Users can delete own zernio settings" on public.user_zernio_settings
  for delete using (auth.uid() = user_id);

-- social_accounts: read-only for owners; all writes (sync/connect/disconnect)
-- go through the service-role client.
drop policy if exists "Users can view own social accounts" on public.social_accounts;
create policy "Users can view own social accounts" on public.social_accounts
  for select using (auth.uid() = user_id);

-- post_publications: read-only for owners; all writes (publish/webhook/sweep)
-- go through the service-role client.
drop policy if exists "Users can view own post publications" on public.post_publications;
create policy "Users can view own post publications" on public.post_publications
  for select using (auth.uid() = user_id);

-- ============================================================
-- PART 6: Seed platform_settings keys for admin "global mode"
-- ============================================================

insert into public.platform_settings (setting_key, setting_value)
values
  ('zernio_global_api_key', '""'::jsonb),
  ('zernio_global_enabled', 'false'::jsonb),
  ('zernio_global_webhook_secret', '""'::jsonb)
on conflict (setting_key) do nothing;
