/**
 * Admin Quality Routes (Phase 26 — POL-09)
 * GET /api/admin/quality — surfaces user feedback (posts.feedback, Phase
 * 26-08) alongside the visual-critic (generation_logs.event_kind =
 * 'visual_critic', Phase 24) and model-fallback (event_kind =
 * 'model_fallback', Phase 21) signals that have been logged all along but
 * were never queried by any admin surface.
 *
 * Strictly read-only. No new logging is added here — this route only
 * SELECTs and aggregates in process, mirroring admin-generations.routes.ts's
 * structure and its missing-table/missing-column tolerance.
 */

import { Router } from "express";
import { createAdminSupabase } from "../supabase.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";

const router = Router();

// Local copy of admin-generations.routes.ts's tolerance helpers — this
// module keeps its own copy rather than importing across route files.
function isMissingSchemaTable(error: any, table: string): boolean {
    return (
        typeof error?.message === "string" &&
        error.message.includes(`Could not find the table 'public.${table}' in the schema cache`)
    );
}

function isMissingColumn(error: any, column: string): boolean {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("column") && message.includes(column.toLowerCase()) && message.includes("does not exist");
}

/** True when `error` represents a missing table/column this endpoint can gracefully degrade from (zeros) rather than a real failure. */
function isTolerableSchemaError(error: any, table: string, columns: string[]): boolean {
    if (!error) return false;
    if (isMissingSchemaTable(error, table)) return true;
    return columns.some((column) => isMissingColumn(error, column));
}

function toSafeNumber(value: unknown): number {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
}

interface FeedbackTally {
    up: number;
    down: number;
    rated: number;
    total_posts: number;
}

interface CriticAggregate {
    total: number;
    by_outcome: Record<string, number>;
    text_free_compliance_rate: number | null;
    reroll_events: number;
    total_reroll_cost_usd_micros: number;
}

interface FallbackAggregate {
    total: number;
    by_call_class: Record<string, number>;
}

interface AdminQualityResponse {
    window_days: number;
    feedback: FeedbackTally;
    critic: CriticAggregate;
    fallback: FallbackAggregate;
}

/**
 * GET /api/admin/quality
 * Query params:
 *   - days: number (default 30, clamped 1..365) — the shared window every
 *     panel below reads from.
 */
router.get("/api/admin/quality", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    const rawDays = Number(req.query.days);
    const windowDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(365, Math.max(1, Math.trunc(rawDays))) : 30;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const fetchLimit = 5000;

    try {
        // ── 1. Feedback tally (posts.feedback, Phase 26-08) ──────────────
        const feedbackRowsResult = await sb
            .from("posts")
            .select("feedback")
            .gte("created_at", since)
            .not("feedback", "is", null)
            .limit(fetchLimit);

        if (feedbackRowsResult.error && !isTolerableSchemaError(feedbackRowsResult.error, "posts", ["feedback", "created_at"])) {
            console.error("Failed to load post feedback for quality dashboard:", feedbackRowsResult.error);
            return res.status(500).json({ message: feedbackRowsResult.error.message || "Failed to load quality data" });
        }
        const feedbackRows: Array<{ feedback: string | null }> = feedbackRowsResult.error ? [] : feedbackRowsResult.data || [];

        const totalPostsResult = await sb
            .from("posts")
            .select("id", { count: "exact", head: true })
            .gte("created_at", since);

        if (totalPostsResult.error && !isTolerableSchemaError(totalPostsResult.error, "posts", ["created_at"])) {
            console.error("Failed to count posts for quality dashboard:", totalPostsResult.error);
            return res.status(500).json({ message: totalPostsResult.error.message || "Failed to load quality data" });
        }
        const totalPosts = totalPostsResult.error ? 0 : totalPostsResult.count ?? 0;

        let up = 0;
        let down = 0;
        for (const row of feedbackRows) {
            if (row.feedback === "up") up++;
            else if (row.feedback === "down") down++;
        }
        const feedback: FeedbackTally = { up, down, rated: up + down, total_posts: totalPosts };

        // ── 2. Visual critic outcomes (generation_logs, Phase 24) ────────
        const criticRowsResult = await sb
            .from("generation_logs")
            .select("outcome, attempt_count, metadata")
            .eq("event_kind", "visual_critic")
            .gte("created_at", since)
            .limit(fetchLimit);

        if (criticRowsResult.error && !isTolerableSchemaError(criticRowsResult.error, "generation_logs", ["event_kind", "outcome", "metadata"])) {
            console.error("Failed to load visual critic logs for quality dashboard:", criticRowsResult.error);
            return res.status(500).json({ message: criticRowsResult.error.message || "Failed to load quality data" });
        }
        const criticRows: Array<{ outcome: string | null; attempt_count: number | null; metadata: Record<string, unknown> | null }> =
            criticRowsResult.error ? [] : criticRowsResult.data || [];

        let criticTotal = 0;
        let textFreeCompliantCount = 0;
        let rerollEvents = 0;
        let totalRerollCostUsdMicros = 0;
        const byOutcome: Record<string, number> = {};
        for (const row of criticRows) {
            criticTotal++;
            const outcome = typeof row.outcome === "string" && row.outcome.length > 0 ? row.outcome : "(unknown)";
            byOutcome[outcome] = (byOutcome[outcome] || 0) + 1;
            const metadata = row.metadata || {};
            if (metadata.text_free_compliant === true) textFreeCompliantCount++;
            const rowRerollAttempts = toSafeNumber(metadata.reroll_attempt_count);
            if (rowRerollAttempts > 0) rerollEvents++;
            totalRerollCostUsdMicros += toSafeNumber(metadata.reroll_cost_usd_micros);
        }
        const critic: CriticAggregate = {
            total: criticTotal,
            by_outcome: byOutcome,
            text_free_compliance_rate: criticTotal > 0 ? textFreeCompliantCount / criticTotal : null,
            reroll_events: rerollEvents,
            total_reroll_cost_usd_micros: totalRerollCostUsdMicros,
        };

        // ── 3. Model fallback rates (generation_logs, Phase 21) ──────────
        const fallbackRowsResult = await sb
            .from("generation_logs")
            .select("metadata")
            .eq("event_kind", "model_fallback")
            .gte("created_at", since)
            .limit(fetchLimit);

        if (fallbackRowsResult.error && !isTolerableSchemaError(fallbackRowsResult.error, "generation_logs", ["event_kind", "metadata"])) {
            console.error("Failed to load model fallback logs for quality dashboard:", fallbackRowsResult.error);
            return res.status(500).json({ message: fallbackRowsResult.error.message || "Failed to load quality data" });
        }
        const fallbackRows: Array<{ metadata: Record<string, unknown> | null }> = fallbackRowsResult.error ? [] : fallbackRowsResult.data || [];

        let fallbackTotal = 0;
        const byCallClass: Record<string, number> = {};
        for (const row of fallbackRows) {
            fallbackTotal++;
            const metadata = row.metadata || {};
            const callClass = typeof metadata.call_class === "string" && metadata.call_class.length > 0 ? metadata.call_class : "(unknown)";
            byCallClass[callClass] = (byCallClass[callClass] || 0) + 1;
        }
        const fallback: FallbackAggregate = { total: fallbackTotal, by_call_class: byCallClass };

        const response: AdminQualityResponse = { window_days: windowDays, feedback, critic, fallback };
        res.json(response);
    } catch (err: any) {
        console.error("Failed to load admin quality dashboard:", err);
        res.status(500).json({ message: err?.message || "Failed to load quality data" });
    }
});

export default router;
