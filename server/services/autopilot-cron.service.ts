/**
 * Autopilot cron service (Project P002)
 *
 * runAutopilotTick() wakes due content plans, generates a post, and either
 * auto-publishes it (via Zernio) or drops it into the approval queue
 * (scheduled_posts.status = 'pending_approval'), enforcing the per-plan monthly
 * credit budget. Registered from startCronJobs() (cleanup-cron.service.ts) and
 * exposed as an HTTP trigger for the serverless path.
 *
 * TODO(doc): post_time is interpreted in UTC. Proper per-plan timezone handling
 * needs a tz library (date-fns-tz) — tracked as a P002 risk.
 */

import { createAdminSupabase } from "../supabase.js";
import { captureException } from "../lib/observability.js";
import { resolveZernioKey } from "../middleware/auth.middleware.js";
import { zernioService, type ZernioPostTarget } from "../integrations/zernio.js";
import { generatePlanPost } from "./autopilot-generation.service.js";

/** How many due plans a single tick may process (runaway backstop). */
const MAX_PLANS_PER_TICK = 25;
/** Budget window length before spent_this_period resets. */
const BUDGET_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

const WEEKDAYS_BY_PRESET: Record<string, number[]> = {
    daily: [0, 1, 2, 3, 4, 5, 6],
    three_per_week: [1, 3, 5],
    weekly: [1],
};

/**
 * Compute the next run time (ISO) for a plan, starting strictly after `from`.
 * post_time (HH:MM) is interpreted in UTC for v1.
 */
export function computeNextRunAt(
    plan: { frequency_preset: string; custom_days: unknown; post_time: string },
    from: Date,
): string {
    const days =
        plan.frequency_preset === "custom"
            ? (Array.isArray(plan.custom_days) && plan.custom_days.length
                ? (plan.custom_days as number[])
                : [1])
            : WEEKDAYS_BY_PRESET[plan.frequency_preset] || [1];
    const daySet = new Set(days.map((d) => Number(d)));

    const [hh, mm] = String(plan.post_time || "09:00").split(":").map((n) => parseInt(n, 10));
    const hour = Number.isFinite(hh) ? hh : 9;
    const minute = Number.isFinite(mm) ? mm : 0;

    for (let offset = 0; offset <= 14; offset++) {
        const candidate = new Date(from);
        candidate.setUTCDate(candidate.getUTCDate() + offset);
        candidate.setUTCHours(hour, minute, 0, 0);
        if (daySet.has(candidate.getUTCDay()) && candidate.getTime() > from.getTime()) {
            return candidate.toISOString();
        }
    }
    // Fallback: 1 day out (should not happen given the 14-day scan).
    return new Date(from.getTime() + 86_400_000).toISOString();
}

/**
 * Publish an already-generated post to Zernio (upload media + create post now).
 * Shared by the cron auto-approve path and the approval-queue approve endpoint.
 */
export async function publishViaZernio(
    key: string,
    params: { caption: string; mediaUrls: string[]; targets: ZernioPostTarget[] },
): Promise<{ zernioPostId: string | null; error: string | null }> {
    const mediaIds: string[] = [];
    for (const url of params.mediaUrls) {
        const up = await zernioService.uploadMedia(key, url);
        if (up.error || !up.mediaId) return { zernioPostId: null, error: up.error || "media upload failed" };
        mediaIds.push(up.mediaId);
    }
    const zres = await zernioService.createPost(key, {
        content: params.caption,
        platforms: params.targets,
        mediaIds: mediaIds.length ? mediaIds : undefined,
        publishNow: true,
    });
    if (zres.error) return { zernioPostId: null, error: zres.error };
    return { zernioPostId: zres.post?.id ?? null, error: null };
}

interface PlanRow {
    id: string;
    user_id: string;
    status: string;
    brief: string | null;
    themes: string[];
    theme_cursor: number;
    target_accounts: string[];
    auto_approve: boolean;
    frequency_preset: string;
    custom_days: number[];
    post_time: string;
    timezone: string;
    monthly_budget_micros: number;
    spent_this_period_micros: number;
    period_started_at: string;
    next_run_at: string | null;
}

/** Resolve a plan's target connections into Zernio publish targets + the key. */
async function resolveTargets(userId: string, connectionIds: string[]) {
    const sb = createAdminSupabase();
    const { data: profile } = await sb
        .from("profiles")
        .select("publishing_mode, zernio_api_key")
        .eq("id", userId)
        .maybeSingle();
    const resolution = await resolveZernioKey(profile);

    const { data: conns } = await sb
        .from("social_connections")
        .select("platform, zernio_account_id, status")
        .in("id", connectionIds.length ? connectionIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("user_id", userId);
    const targets: ZernioPostTarget[] = (conns || [])
        .filter((c) => c.status === "active")
        .map((c) => ({ platform: c.platform as ZernioPostTarget["platform"], accountId: c.zernio_account_id }));

    return { resolution, targets };
}

/** Generate + enqueue one post for a plan. Returns the charged amount. */
async function runPlanOnce(plan: PlanRow): Promise<{ chargedMicros: number; ok: boolean; reason?: string }> {
    const sb = createAdminSupabase();
    const theme = plan.themes.length ? plan.themes[plan.theme_cursor % plan.themes.length] : null;

    const gen = await generatePlanPost({ userId: plan.user_id, brief: plan.brief, theme });
    if (!gen.ok) {
        return { chargedMicros: 0, ok: false, reason: gen.reason };
    }

    const { resolution, targets } = await resolveTargets(plan.user_id, plan.target_accounts);
    const canPublish = plan.auto_approve && resolution.ok && targets.length > 0;

    let status = "pending_approval";
    let zernioPostId: string | null = null;
    let errorMessage: string | null = null;

    if (canPublish && resolution.ok) {
        const pub = await publishViaZernio(resolution.key, {
            caption: gen.caption,
            mediaUrls: [gen.imageUrl],
            targets,
        });
        if (pub.error) {
            status = "failed";
            errorMessage = pub.error;
        } else {
            status = "publishing"; // webhook (P007) finalises to published/failed
            zernioPostId = pub.zernioPostId;
        }
    }

    await sb.from("scheduled_posts").insert({
        user_id: plan.user_id,
        content_plan_id: plan.id,
        post_id: gen.postId,
        zernio_post_id: zernioPostId,
        caption: gen.caption,
        media_urls: [gen.imageUrl],
        target_accounts: targets.map((t) => ({ platform: t.platform, zernio_account_id: t.accountId })),
        scheduled_for: new Date().toISOString(),
        timezone: plan.timezone,
        status,
        error_message: errorMessage,
    });

    return { chargedMicros: gen.chargedMicros, ok: true };
}

/**
 * Process all due, active content plans (one post each), enforcing per-plan
 * monthly budgets. Safe to call from node-cron or the HTTP trigger.
 */
export async function runAutopilotTick(): Promise<{ processed: number; published: number; queued: number; skipped: number }> {
    const sb = createAdminSupabase();
    const now = new Date();
    const nowIso = now.toISOString();

    const { data: plans, error } = await sb
        .from("content_plans")
        .select("*")
        .eq("status", "active")
        .limit(200);
    if (error) throw error;

    const due = (plans || [])
        .filter((p: PlanRow) => !p.next_run_at || p.next_run_at <= nowIso)
        .slice(0, MAX_PLANS_PER_TICK);

    let published = 0, queued = 0, skipped = 0;

    for (const plan of due as PlanRow[]) {
        try {
            // Reset the budget window if a month has elapsed.
            let spent = plan.spent_this_period_micros;
            let periodStartedAt = plan.period_started_at;
            if (new Date(plan.period_started_at).getTime() < now.getTime() - BUDGET_PERIOD_MS) {
                spent = 0;
                periodStartedAt = nowIso;
            }

            // Budget guard: no budget or over budget → pause and skip.
            if (plan.monthly_budget_micros <= 0 || spent >= plan.monthly_budget_micros) {
                await sb.from("content_plans").update({ status: "budget_exhausted", spent_this_period_micros: spent, period_started_at: periodStartedAt, updated_at: nowIso }).eq("id", plan.id);
                skipped++;
                continue;
            }

            const result = await runPlanOnce(plan);

            if (!result.ok) {
                // Generation blocked (credits/config) → pause so it stops burning attempts.
                await sb.from("content_plans").update({
                    status: result.reason === "insufficient_credits" ? "budget_exhausted" : "paused",
                    period_started_at: periodStartedAt,
                    updated_at: nowIso,
                }).eq("id", plan.id);
                skipped++;
                continue;
            }

            const newSpent = spent + result.chargedMicros;
            const nextCursor = plan.themes.length ? (plan.theme_cursor + 1) % plan.themes.length : 0;
            await sb.from("content_plans").update({
                spent_this_period_micros: newSpent,
                period_started_at: periodStartedAt,
                theme_cursor: nextCursor,
                last_run_at: nowIso,
                next_run_at: computeNextRunAt(plan, now),
                // Pre-emptively mark exhausted if this run crossed the budget.
                status: newSpent >= plan.monthly_budget_micros ? "budget_exhausted" : "active",
                updated_at: nowIso,
            }).eq("id", plan.id);

            if (plan.auto_approve) published++; else queued++;
        } catch (err) {
            captureException(err, { job: "autopilot_tick", plan_id: plan.id });
            skipped++;
        }
    }

    return { processed: due.length, published, queued, skipped };
}
