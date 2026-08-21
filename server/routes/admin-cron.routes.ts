/**
 * Admin Cron Observability Routes
 *
 * Mirrors the requireAdminGuard style used by admin-social.routes.ts. Read
 * surface over `public.cron_runs` (server/services/cron-runs.service.ts) —
 * see that file's header for the incident this closes. Read-only: there is
 * no admin write path here, cron_runs rows are written exclusively by the
 * job trigger paths themselves (node-cron + the /api/internal/* HTTP
 * triggers).
 */

import { Router } from "express";
import { z } from "zod";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import {
    CRON_JOB_NAMES,
    getRecentCronRuns,
    getLatestRunPerJob,
    type CronJobName,
    type CronRunRow,
} from "../services/cron-runs.service.js";

const router = Router();

const DEFAULT_RUNS_LIMIT = 50;
const MAX_RUNS_LIMIT = 200;

const runsQuerySchema = z.object({
    job: z.enum(CRON_JOB_NAMES).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_RUNS_LIMIT).optional(),
});

/**
 * Expected cadence per job, used to derive the `stale` flag in
 * GET /api/admin/cron/health. Mirrors CLAUDE.md "Deployment & Cron":
 *   - autopost_sweep: every 5 min
 *   - social_publication_status_sweep: every 15 min
 *   - trash_sweep / purge_sweep: every 6h
 *   - overage_batch: weekly (cadence is itself admin-configurable via
 *     billing_settings.overage_billing_cadence_days — see
 *     resolveOverageCronExpression() in cleanup-cron.service.ts — so this is
 *     a generous upper bound, not the live cron expression).
 *
 * Staleness threshold is a multiple of the cadence (not the cadence itself)
 * so a single slow/late tick doesn't false-positive; it only fires once a
 * job has plausibly missed at least one full cycle.
 */
const EXPECTED_CADENCE_MS: Record<CronJobName, number> = {
    autopost_sweep: 5 * 60 * 1000,
    social_publication_status_sweep: 15 * 60 * 1000,
    trash_sweep: 6 * 60 * 60 * 1000,
    purge_sweep: 6 * 60 * 60 * 1000,
    overage_batch: 7 * 24 * 60 * 60 * 1000,
};

/** How many missed cycles before a job is flagged stale. */
const STALE_CYCLE_MULTIPLIER = 2;

interface CronJobHealth {
    job_name: CronJobName;
    has_run: boolean;
    status: CronRunRow["status"] | null;
    started_at: string | null;
    duration_ms: number | null;
    result: unknown;
    error_message: string | null;
    stale: boolean;
}

/**
 * GET /api/admin/cron/runs?job=&limit=
 * Recent runs, newest first (by started_at). `job` filters to one job name;
 * `limit` defaults to 50, capped at 200.
 */
router.get("/api/admin/cron/runs", async (req, res) => {
    const guard = await requireAdminGuard(req, res);
    if (!guard) return;

    const parsed = runsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid query", errors: parsed.error.errors });
        return;
    }
    const { job, limit } = parsed.data;

    try {
        const runs = await getRecentCronRuns(limit ?? DEFAULT_RUNS_LIMIT, job);
        res.json({ runs });
    } catch (err) {
        console.error("[admin-cron] getRecentCronRuns failed:", err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to load cron runs" });
    }
});

/**
 * GET /api/admin/cron/health
 * One entry per known job name (CRON_JOB_NAMES) — including jobs that have
 * NEVER run, reported explicitly via `has_run: false` rather than omitted.
 * A job silently missing from this response is the exact failure mode this
 * feature exists to catch, so every known job name always gets an entry.
 */
router.get("/api/admin/cron/health", async (req, res) => {
    const guard = await requireAdminGuard(req, res);
    if (!guard) return;

    try {
        const latest = await getLatestRunPerJob();
        const now = Date.now();

        const jobs: CronJobHealth[] = CRON_JOB_NAMES.map((jobName) => {
            const run = latest[jobName];
            if (!run) {
                return {
                    job_name: jobName,
                    has_run: false,
                    status: null,
                    started_at: null,
                    duration_ms: null,
                    result: null,
                    error_message: null,
                    // Never having run at all is itself the strongest possible
                    // staleness signal — always flagged.
                    stale: true,
                };
            }

            const ageMs = now - new Date(run.started_at).getTime();
            const stale = ageMs > EXPECTED_CADENCE_MS[jobName] * STALE_CYCLE_MULTIPLIER;

            return {
                job_name: jobName,
                has_run: true,
                status: run.status,
                started_at: run.started_at,
                duration_ms: run.duration_ms,
                result: run.result,
                error_message: run.error_message,
                stale,
            };
        });

        res.json({ jobs });
    } catch (err) {
        console.error("[admin-cron] getLatestRunPerJob failed:", err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to load cron health" });
    }
});

export default router;
