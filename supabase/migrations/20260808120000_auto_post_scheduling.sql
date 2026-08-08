-- Migration: Auto-Post Scheduling ("Autopilot") — P1 Foundation
-- Adds: auto_post_tracks (user-configured cadence/theme/target-accounts for
--       automatic post creation) and auto_post_items (one row per scheduled
--       publish slot, tracking the generate -> approve -> publish state
--       machine), plus RLS for both.
--
-- Source of truth: docs/autopost-scheduling.md ("Data model", "State
-- machine" sections). Additive only — no existing column, table, or policy
-- is altered or dropped.
--
-- State machine (auto_post_items.status):
--   queued -> generating -> awaiting_approval -> approved -> publishing -> published
--                 \-> failed (retry -> queued)        \-(reject)-> rejected     \-> failed
--   awaiting_approval -> rejected
-- 'auto' approval_mode tracks skip approval: a successful generation lands
-- directly on 'approved' (approved_at stays null in that case — it is only
-- set when a human actually clicked Approve).
--
-- Depends on: auth.users, public.posts (auto_post_items.post_id FK).
-- account_ids on auto_post_tracks is a jsonb array of public.social_accounts
-- ids WITHOUT a DB-level FK/array constraint — same rationale as
-- post_publications.social_account_id being a nullable FK rather than a
-- required one in 20260808000000_zernio_social_publishing.sql: the set of
-- target accounts changes independently of the track's lifecycle, and
-- ownership + active-status of every id is verified server-side on every
-- write (server/routes/autopost.routes.ts), not by a DB constraint.

-- ============================================================
-- PART 1: auto_post_tracks — one row per user-configured autopost track
-- ============================================================

create table if not exists public.auto_post_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  system_prompt text not null,
  cadence text not null check (cadence in ('daily','weekly')),
  posting_times jsonb not null default '["12:00"]'::jsonb,  -- 1..4 "HH:MM" strings, UTC
  weekly_day smallint,                                       -- 0=Sun..6=Sat (UTC), required when cadence='weekly'
  approval_mode text not null default 'manual' check (approval_mode in ('auto','manual')),
  account_ids jsonb not null default '[]'::jsonb,            -- uuid[] of social_accounts (ownership verified server-side)
  generation_params jsonb not null default '{}'::jsonb,      -- {aspect_ratio?, use_text?, use_logo?, content_language?, post_mood?}
  is_active boolean not null default true,
  paused_reason text,
  consecutive_failures int not null default 0,
  next_slot_at timestamptz,                                  -- next PUBLISH slot, UTC, server-computed (computeNextSlotAt)
  last_generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- PART 2: auto_post_items — one row per scheduled publish slot
-- ============================================================

create table if not exists public.auto_post_items (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.auto_post_tracks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,  -- generated post stays in the user's library even after the item/track is gone
  status text not null default 'queued' check (status in
    ('queued','generating','awaiting_approval','approved','publishing','published','rejected','failed')),
  scheduled_for timestamptz not null,                        -- the publish slot
  error_message text,
  approved_at timestamptz,
  rejected_at timestamptz,
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (track_id, scheduled_for)                           -- slot idempotency guard (cross-process safe: a duplicate materialize insert 23505s and is skipped)
);

-- ============================================================
-- PART 3: Indexes
-- ============================================================

create index if not exists idx_auto_post_items_user_id_status
  on public.auto_post_items (user_id, status);

create index if not exists idx_auto_post_items_status_scheduled_for
  on public.auto_post_items (status, scheduled_for);

create index if not exists idx_auto_post_tracks_is_active_next_slot_at
  on public.auto_post_tracks (is_active, next_slot_at);

-- ============================================================
-- PART 4: Row Level Security
-- ============================================================

alter table public.auto_post_tracks enable row level security;
alter table public.auto_post_items enable row level security;

-- auto_post_tracks: owner SELECT-only. All writes (create/update/delete from
-- server/routes/autopost.routes.ts, and the sweep's next_slot_at /
-- consecutive_failures / is_active / paused_reason updates from
-- server/services/autopost.service.ts) go through the service-role client.
-- Mirrors the Zernio social publishing pattern
-- (20260808000000_zernio_social_publishing.sql, user_zernio_settings):
-- next_slot_at, consecutive_failures, and paused_reason are server-managed
-- scheduling/health state — a client-writable next_slot_at would let a user
-- jump their own queue, and a client-writable consecutive_failures/
-- paused_reason would let them mask (or fake) an auto-pause. No
-- insert/update/delete policies are defined on purpose.
drop policy if exists "Users can view own auto post tracks" on public.auto_post_tracks;
create policy "Users can view own auto post tracks" on public.auto_post_tracks
  for select using (auth.uid() = user_id);

-- auto_post_items: owner SELECT-only. All writes (materialize / claim /
-- approve / reject / retry / publish status transitions) go through the
-- service-role client. Every transition is an optimistic guarded update
-- (`update ... where status = <expected>`) enforced in application code —
-- a client-writable policy would let a user skip straight to 'published'
-- or 'approved' without ever generating or being charged for the post. No
-- insert/update/delete policies are defined on purpose.
drop policy if exists "Users can view own auto post items" on public.auto_post_items;
create policy "Users can view own auto post items" on public.auto_post_items
  for select using (auth.uid() = user_id);
