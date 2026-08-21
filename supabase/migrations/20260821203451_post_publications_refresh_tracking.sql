-- Migration: post_publications refresh tracking
-- Adds: refresh_attempts + last_refresh_at bookkeeping columns to
--       post_publications, plus a partial index supporting the cron sweep's
--       new two-query selection (see server/services/social-publish.service.ts
--       runPublicationStatusSweep / TASK 1+2 of the P4-refresh-sweep fix).
--
-- Why: runPublicationStatusSweep previously selected rows with
--   status in (pending, scheduled) AND created_at > now-7d AND updated_at < now-60s
-- which anchors relevance on row CREATION rather than on the time that
-- actually matters (scheduled_for for scheduled rows). It also had no
-- ORDER BY (arbitrary starvation) and no cap on how many times a row can be
-- re-selected, so a row whose credentials can never resolve (e.g. the user
-- disconnected/rotated their Zernio key) sits in the sweep forever, touching
-- `updated_at` on every failed/skipped attempt... except the pre-fix code
-- path did NOT touch updated_at on a skip, so such rows matched the
-- `updated_at < now-60s` filter on every single 15-min tick — permanent
-- sweep occupancy, never a terminal state.
--
-- Fix (application-level, this migration only adds the columns + index):
--   refresh_attempts   - incremented on EVERY refresh attempt for a row,
--                         including attempts skipped/failed for missing or
--                         mode-mismatched credentials. Rows at or over
--                         MAX_REFRESH_ATTEMPTS (=20, see social-publish.service.ts)
--                         are excluded from the sweep's selection queries and
--                         transitioned to status='failed' with an explanatory
--                         error_message.
--   last_refresh_at    - timestamp of the most recent refresh attempt
--                         (successful, failed, or skipped). Informational /
--                         debugging aid; updated_at remains the sweep's
--                         staleness signal.
--
-- Source of truth: docs/zernio-social-publishing.md ("Cron" section) and the
-- P4-refresh-sweep task list. Additive only — no existing column, table, or
-- policy is altered or dropped. Defensive: IF NOT EXISTS everywhere, backfill
-- defaults are safe because production currently has ZERO rows in
-- post_publications (this table went live in 20260808000000_zernio_social_publishing.sql
-- and has had no traffic yet).
--
-- Depends on: public.post_publications (20260808000000_zernio_social_publishing.sql).

-- ============================================================
-- PART 1: refresh_attempts + last_refresh_at columns
-- ============================================================

alter table public.post_publications
  add column if not exists refresh_attempts integer not null default 0;

alter table public.post_publications
  add column if not exists last_refresh_at timestamptz;

-- ============================================================
-- PART 2: Partial index supporting the sweep's selection queries
-- ============================================================
-- The sweep runs two queries (status='pending' and status='scheduled'
-- respectively), each filtering on status + updated_at + refresh_attempts,
-- the 'scheduled' query additionally filtering/ordering on scheduled_for,
-- and both ordering the merged result by updated_at ascending (oldest-
-- touched first) so no row starves forever behind ones that can never
-- resolve. A partial index scoped to the two in-flight statuses keeps it
-- small and keeps write overhead off rows already in a terminal state
-- (published/failed).

create index if not exists idx_post_publications_sweep_pending_scheduled
  on public.post_publications (status, updated_at, scheduled_for, refresh_attempts)
  where status in ('pending', 'scheduled');
