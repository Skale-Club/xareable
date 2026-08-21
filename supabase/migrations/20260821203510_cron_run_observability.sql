-- Migration: cron_runs — operational observability for the five scheduled jobs.
--
-- Incident context: Xareable's social publishing system was recently found
-- running completely idle in production — the crons fired on schedule (both
-- the node-cron path on Hetzner and the HTTP-trigger path on Vercel), but
-- every sweep processed zero rows because nothing was configured. Nobody
-- noticed for a stretch, because the ONLY record a sweep leaves behind is a
-- `console.log` line inside a container that nobody was tailing. There was no
-- way to answer "did the autopost sweep run in the last hour, and what did it
-- do?" without shelling into the container and grepping logs.
--
-- This table gives every run of every scheduled job (trash_sweep,
-- purge_sweep, overage_batch, social_publication_status_sweep,
-- autopost_sweep — see CLAUDE.md "Deployment & Cron") a durable row: which
-- trigger path fired it (node-cron vs http), whether it succeeded, how long
-- it took, and its own result payload (counts) or error message. An admin
-- endpoint (GET /api/admin/cron/health) reads this to answer "is anything
-- silently stuck?" without touching the container.
--
-- RLS: enabled with ZERO policies, exactly like platform_secure_settings
-- (20260808000000) and the lockdown pattern applied to platform_settings /
-- generation_logs (20260808010000) and user_zernio_settings (20260821203501).
-- This is purely operational/internal data — job run counts and error
-- strings — never something a client (or a stolen anon-key session) has any
-- legitimate reason to read. Only the service-role client (which bypasses
-- RLS; see server/services/cron-runs.service.ts) reads or writes it.
--
-- Retention: this table grows unboundedly otherwise — the autopost sweep
-- alone ticks every 5 minutes (2 lanes recorded per tick in the current
-- wiring = ~576 rows/day from that job alone). purgeOldCronRuns() in
-- cron-runs.service.ts is folded into the existing 6-hourly purge sweep cron
-- callback (no sixth cron schedule added) and deletes rows older than 30
-- days by default.
--
-- Idempotent: safe to re-run.

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  trigger text not null,
  status text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  constraint cron_runs_trigger_check check (trigger in ('node-cron', 'http')),
  constraint cron_runs_status_check check (status in ('ok', 'error', 'skipped'))
);

-- "Latest run per job" is the primary read pattern (GET /api/admin/cron/health
-- fires one query per job name ordered by started_at desc limit 1), and
-- GET /api/admin/cron/runs?job=... filters + orders the same way.
create index if not exists cron_runs_job_name_started_at_idx
  on public.cron_runs (job_name, started_at desc);

alter table public.cron_runs enable row level security;
-- No policies on purpose: deny-all for anon/authenticated; service role only.
