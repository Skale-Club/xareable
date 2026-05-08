/**
 * Cron HTTP trigger auth middleware (CRON-01, Phase 14)
 *
 * Validates `Authorization: Bearer ${CRON_SECRET}` via crypto.timingSafeEqual.
 * Used by /api/internal/cleanup/* and /api/internal/billing/run-overage-batch
 * so that GitHub Actions (path A) — and any future scheduler — can fire the
 * destructive cleanup + billing functions without exposing them to authenticated
 * end-users (admins included; admins MUST NOT be able to manually fire a billing
 * batch via the public app surface — only the cron secret unlocks these routes).
 *
 * Failure modes (chosen to distinguish "config not done" from "auth not given"):
 *   - CRON_SECRET env unset       → 503 cron_not_configured
 *   - Missing or malformed bearer → 401 unauthorized
 *   - Bearer present but wrong    → 401 unauthorized
 *
 * Why constant-time compare: prevents response-time side-channel attacks on the
 * secret. timingSafeEqual throws on mismatched lengths, so we length-guard first.
 */

import { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

export function requireCronSecret(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
        console.warn(
            `[CronAuth] reject reason=secret_unset path=${req.path}`,
        );
        res.status(503).json({ error: "cron_not_configured" });
        return;
    }

    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith(BEARER_PREFIX)) {
        console.warn(
            `[CronAuth] reject reason=missing path=${req.path} ip=${req.ip}`,
        );
        res.status(401).json({ error: "unauthorized" });
        return;
    }

    const received = auth.slice(BEARER_PREFIX.length);
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        console.warn(
            `[CronAuth] reject reason=wrong path=${req.path} ip=${req.ip}`,
        );
        res.status(401).json({ error: "unauthorized" });
        return;
    }

    next();
}
