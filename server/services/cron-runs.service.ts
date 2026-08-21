/**
 * Cron run observability — recording + querying `public.cron_runs`.
 *
 * WHY THIS EXISTS: Xareable's social publishing system was recently found
 * running completely idle in production — the crons fired on schedule but
 * every sweep processed zero rows because nothing was configured. Nobody
 * noticed, because the ONLY record a sweep leaves is a `console.log` line.
 * There was no way to answer "did the autopost sweep run in the last hour,
 * and what did it do?" without shelling into the container and grepping
 * logs. This file — paired with the `cron_runs` table (migration
 * 20260821000003_cron_run_observability.sql) and the admin read surface in
 * server/routes/admin-cron.routes.ts — closes that gap.
 *
 * Wired into BOTH trigger paths described in CLAUDE.md ("Deployment & Cron"):
 *   - node-cron, from server/services/cleanup-cron.service.ts:startCronJobs()
 *   - HTTP triggers, from server/routes/internal-cron.routes.ts
 * Both call the exact same `recordCronRun` / `runAndRecord` helpers below, so
 * there is one recording code path regardless of which trigger fired a job.
 *
 * CRITICAL INVARIANT: this is telemetry, not business logic. A failure to
 * WRITE a cron_runs row must never affect the job it's describing — it must
 * never throw out of `recordCronRun`, and it must never turn a successful
 * job into a failed one (or vice versa) from the caller's point of view.
 * `recordCronRun` therefore wraps everything in try/catch and only
 * `console.error`s on failure. See its doc comment for the one deliberate
 * exception to "never throws" (`runAndRecord`'s re-throw of the ORIGINAL
 * job error, which has nothing to do with recording failing).
 */

import { createAdminSupabase } from "../supabase.js";

/** The five scheduled jobs (CLAUDE.md "Deployment & Cron"). A union (not a
 * bare `string`) so every call site is typo-checked at compile time — the
 * exact failure mode ("nothing was configured and nobody noticed") this
 * feature exists to catch would otherwise extend to job NAMES themselves. */
export const CRON_JOB_NAMES = [
  "trash_sweep",
  "purge_sweep",
  "overage_batch",
  "social_publication_status_sweep",
  "autopost_sweep",
] as const;

export type CronJobName = (typeof CRON_JOB_NAMES)[number];

/** Mirrors the two trigger paths documented in CLAUDE.md. */
export type CronRunTrigger = "node-cron" | "http";

export type CronRunStatus = "ok" | "error" | "skipped";

/** Local row shape for `public.cron_runs` — defined here (not in
 * shared/schema.ts, which is out of scope for this change) because this
 * service is the sole reader/writer of the table. */
export interface CronRunRow {
  id: string;
  job_name: CronJobName;
  trigger: CronRunTrigger;
  status: CronRunStatus;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: unknown;
  error_message: string | null;
  created_at: string;
}

export interface CronRunEntry {
  job_name: CronJobName;
  trigger: CronRunTrigger;
  status: CronRunStatus;
  started_at: Date | string;
  finished_at: Date | string;
  duration_ms: number;
  result?: unknown;
  error_message?: string | null;
}

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_RECENT_LIMIT = 50;

function toIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

/**
 * Insert one cron_runs row. NEVER THROWS — recording failures must not be
 * able to break a billing batch, a publish sweep, or any other job. Every
 * failure mode (client construction, the insert itself) is caught and
 * downgraded to a `console.error`.
 */
export async function recordCronRun(entry: CronRunEntry): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    const { error } = await supabase.from("cron_runs").insert({
      job_name: entry.job_name,
      trigger: entry.trigger,
      status: entry.status,
      started_at: toIso(entry.started_at),
      finished_at: toIso(entry.finished_at),
      duration_ms: entry.duration_ms,
      result: entry.result ?? null,
      error_message: entry.error_message ?? null,
    });
    if (error) {
      console.error(`[cron-runs] Failed to record run for ${entry.job_name}:`, error.message);
    }
  } catch (err) {
    console.error(
      `[cron-runs] recordCronRun threw for ${entry.job_name}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Convenience wrapper: times `fn`, records an 'ok' row with its resolved
 * value as `result` (or an 'error' row with the message on rejection), and
 * ALWAYS RE-THROWS the original error on failure.
 *
 * Design choice, documented per the task: re-throw, always. `recordCronRun`
 * itself never throws (see above), so awaiting it before re-throwing never
 * swallows or replaces the original error — every existing call site's
 * try/catch (its console.error/captureException calls, its skip-tracking
 * locks, its HTTP error envelope) keeps firing exactly as it did before this
 * wrapper was introduced. Recording is purely additive at every call site.
 */
export async function runAndRecord<T>(
  jobName: CronJobName,
  trigger: CronRunTrigger,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await fn();
    const finishedAt = new Date();
    await recordCronRun({
      job_name: jobName,
      trigger,
      status: "ok",
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      result: result as unknown,
    });
    return result;
  } catch (err) {
    const finishedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);
    await recordCronRun({
      job_name: jobName,
      trigger,
      status: "error",
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      error_message: message,
    });
    throw err;
  }
}

/**
 * Most recent runs, newest first. Used by GET /api/admin/cron/runs.
 * Unlike recordCronRun, this genuinely throws on a DB error — it's a read
 * for an admin surface, not telemetry sitting in front of a real job, so
 * there's no "must not break the caller" constraint to uphold.
 */
export async function getRecentCronRuns(
  limit = DEFAULT_RECENT_LIMIT,
  jobName?: CronJobName,
): Promise<CronRunRow[]> {
  const supabase = createAdminSupabase();
  let query = supabase
    .from("cron_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (jobName) {
    query = query.eq("job_name", jobName);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CronRunRow[];
}

/**
 * Latest run for EVERY known job name, including jobs that have never run
 * (mapped to `null` rather than omitted — GET /api/admin/cron/health relies
 * on this to report "never run" explicitly instead of silently dropping the
 * job from its response, which is the exact failure mode this feature exists
 * to catch). One query per job name (only 5), each hitting the
 * (job_name, started_at desc) index — simpler and just as cheap as a
 * DISTINCT ON, which supabase-js has no query-builder support for.
 */
export async function getLatestRunPerJob(): Promise<Record<CronJobName, CronRunRow | null>> {
  const supabase = createAdminSupabase();

  const entries = await Promise.all(
    CRON_JOB_NAMES.map(async (jobName): Promise<[CronJobName, CronRunRow | null]> => {
      const { data, error } = await supabase
        .from("cron_runs")
        .select("*")
        .eq("job_name", jobName)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return [jobName, (data as CronRunRow | null) ?? null];
    }),
  );

  return Object.fromEntries(entries) as Record<CronJobName, CronRunRow | null>;
}

/**
 * Retention: deletes cron_runs rows older than `olderThanDays` (default 30).
 * The table grows unboundedly otherwise — the autopost sweep's two lanes
 * alone tick every 5 minutes, ~576 rows/day from that job alone. Folded into
 * the existing 6-hourly purge sweep cron callback (see
 * cleanup-cron.service.ts) rather than adding a sixth cron schedule.
 *
 * NEVER THROWS, same rationale as recordCronRun — retention housekeeping
 * must not be able to fail the purge sweep it's riding along with. Returns
 * the number of rows deleted, or 0 on any failure.
 */
export async function purgeOldCronRuns(
  olderThanDays = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  try {
    const supabase = createAdminSupabase();
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("cron_runs")
      .delete()
      .lt("started_at", cutoff)
      .select("id");

    if (error) {
      console.error("[cron-runs] purgeOldCronRuns failed:", error.message);
      return 0;
    }
    return data?.length ?? 0;
  } catch (err) {
    console.error(
      "[cron-runs] purgeOldCronRuns threw:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}
