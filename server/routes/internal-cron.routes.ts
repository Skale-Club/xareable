/**
 * Internal cron HTTP triggers (CRON-02, Phase 14; social sync added by the
 * Zernio social publishing integration, P2)
 *
 * Four POST endpoints, each protected by requireCronSecret. They are the
 * Vercel-deploy trigger path for the cleanup + billing + social-sync cron
 * functions defined in server/services/cleanup-cron.service.ts (runTrashSweep,
 * runPurgeSweep), server/stripe.ts (runOverageBillingBatch), and
 * server/services/social-publish.service.ts (runPublicationStatusSweep).
 *
 * Why a single file: cohesion. All four endpoints share the same auth, response
 * envelope, error handling, and logging prefix [Cron][http]. Splitting them into
 * cleanup vs billing vs social routers would force more imports of requireCronSecret
 * and more "trigger:'http'" envelopes for no benefit.
 *
 * The path `/api/internal/billing/run-overage-batch` was previously defined in
 * server/routes/billing.routes.ts:649 with `requireAdminGuard`. That handler is
 * removed in the same plan (CRON-02 explicitly covers the move). The new router
 * owns the path with `requireCronSecret` instead — admins MUST NOT be able to
 * manually fire a billing batch via the public app surface.
 *
 * Response envelope on success: {ok:true, trigger:"http", duration_ms, result}.
 * Errors: 401 (auth — handled in middleware), 503 (env unset — middleware), 500 (handler exception).
 *
 * The corresponding node-cron path (Hetzner) lives untouched in cleanup-cron.service.ts.
 */

import { Router, type Response } from "express";
import { requireCronSecret } from "../middleware/cron-auth.middleware.js";
import {
    runTrashSweep,
    runPurgeSweep,
} from "../services/cleanup-cron.service.js";
import { runOverageBillingBatch } from "../stripe.js";
import { runPublicationStatusSweep } from "../services/social-publish.service.js";

const router = Router();

router.post(
    "/api/internal/cleanup/trash",
    requireCronSecret,
    async (_req, res: Response) => {
        const start = Date.now();
        try {
            const swept = await runTrashSweep();
            const duration_ms = Date.now() - start;
            console.log(
                `[Cron][http] trash sweep ok swept=${swept} duration_ms=${duration_ms}`,
            );
            res.status(200).json({
                ok: true,
                trigger: "http",
                duration_ms,
                result: { swept },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "unknown";
            console.error(`[Cron][http] trash sweep failed:`, err);
            res.status(500).json({
                ok: false,
                error: "internal_error",
                message,
            });
        }
    },
);

router.post(
    "/api/internal/cleanup/purge",
    requireCronSecret,
    async (_req, res: Response) => {
        const start = Date.now();
        try {
            const purged = await runPurgeSweep();
            const duration_ms = Date.now() - start;
            console.log(
                `[Cron][http] purge sweep ok purged=${purged} duration_ms=${duration_ms}`,
            );
            res.status(200).json({
                ok: true,
                trigger: "http",
                duration_ms,
                result: { purged },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "unknown";
            console.error(`[Cron][http] purge sweep failed:`, err);
            res.status(500).json({
                ok: false,
                error: "internal_error",
                message,
            });
        }
    },
);

router.post(
    "/api/internal/billing/run-overage-batch",
    requireCronSecret,
    async (_req, res: Response) => {
        const start = Date.now();
        try {
            const result = await runOverageBillingBatch();
            const duration_ms = Date.now() - start;
            console.log(
                `[Cron][http] overage batch ok processed=${result.processed} charged=${result.charged} skipped=${result.skipped} duration_ms=${duration_ms}`,
            );
            res.status(200).json({
                ok: true,
                trigger: "http",
                duration_ms,
                result,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "unknown";
            console.error(`[Cron][http] overage batch failed:`, err);
            res.status(500).json({
                ok: false,
                error: "internal_error",
                message,
            });
        }
    },
);

router.post(
    "/api/internal/social/sync-publications",
    requireCronSecret,
    async (_req, res: Response) => {
        const start = Date.now();
        try {
            const refreshed = await runPublicationStatusSweep();
            const duration_ms = Date.now() - start;
            console.log(
                `[Cron][http] social publication sync ok refreshed=${refreshed} duration_ms=${duration_ms}`,
            );
            res.status(200).json({
                ok: true,
                trigger: "http",
                duration_ms,
                result: { refreshed },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "unknown";
            console.error(`[Cron][http] social publication sync failed:`, err);
            res.status(500).json({
                ok: false,
                error: "internal_error",
                message,
            });
        }
    },
);

export default router;
