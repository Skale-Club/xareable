-- Migration: Add posts.trashed_at for soft-delete trash lifecycle (Phase 11)
-- Adds: posts.trashed_at TIMESTAMPTZ NULL + partial index on trashed_at IS NOT NULL.
-- Depends on: 20260421000000_v1_1_schema_foundation.sql (posts table schema baseline)
--
-- Behavior:
--   * NULL trashed_at = post is live (visible in gallery).
--   * Non-NULL trashed_at = post is in trash (visible only in /trash view).
--   * Cron purge sweep deletes rows where trashed_at <= now() - 30 days.
-- No RLS change: existing user_id = auth.uid() policy already covers trashed rows.

alter table public.posts
  add column if not exists trashed_at timestamptz;

create index if not exists idx_posts_trashed_at
  on public.posts (trashed_at)
  where trashed_at is not null;
