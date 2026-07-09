/**
 * Content Autopilot Routes (Project P002)
 *
 *   GET    /api/autopilot/plans            list the user's content plans
 *   POST   /api/autopilot/plans            create a plan
 *   PATCH  /api/autopilot/plans/:id        edit / pause / resume a plan
 *   DELETE /api/autopilot/plans/:id        delete a plan
 *   GET    /api/autopilot/queue            list posts awaiting approval
 *   POST   /api/autopilot/queue/:id/approve  approve → publish via Zernio
 *   POST   /api/autopilot/queue/:id/reject   reject → cancel
 *   POST   /api/internal/autopilot/tick    cron-secret HTTP trigger
 *
 * Gated by publishing_mode (same super-admin gate as P001). Cron generation +
 * budget logic lives in autopilot-cron.service.ts.
 */

import { Router, Request, Response } from "express";
import { authenticateUser, AuthenticatedRequest, resolveZernioKey } from "../middleware/auth.middleware.js";
import { requireCronSecret } from "../middleware/cron-auth.middleware.js";
import { createAdminSupabase } from "../supabase.js";
import { createContentPlanSchema, updateContentPlanSchema } from "../../shared/schema.js";
import { computeNextRunAt, publishViaZernio, runAutopilotTick } from "../services/autopilot-cron.service.js";
import type { ZernioPostTarget } from "../integrations/zernio.js";

const router = Router();

function publishingEnabled(profile: any): boolean {
    return (profile?.publishing_mode ?? "disabled") !== "disabled";
}

// ── Plans ────────────────────────────────────────────────────────────────────

router.get("/api/autopilot/plans", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) { res.status(auth.statusCode).json({ message: auth.message }); return; }

    const { data, error } = await auth.supabase
        .from("content_plans")
        .select("*")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false });
    if (error) { res.status(500).json({ message: "Failed to fetch plans" }); return; }
    res.json({ plans: data || [] });
});

router.post("/api/autopilot/plans", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) { res.status(auth.statusCode).json({ message: auth.message }); return; }
    if (!publishingEnabled(auth.profile)) {
        res.status(403).json({ message: "Social publishing is not enabled for this account." });
        return;
    }

    const parsed = createContentPlanSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: "Invalid plan", issues: parsed.error.issues }); return; }
    const plan = parsed.data;

    // The targeted connections must belong to the user.
    const { data: conns } = await auth.supabase
        .from("social_connections")
        .select("id")
        .in("id", plan.target_accounts)
        .eq("user_id", auth.user.id);
    if (!conns || conns.length !== plan.target_accounts.length) {
        res.status(400).json({ message: "One or more selected accounts are invalid" });
        return;
    }

    const now = new Date();
    const { data: created, error } = await createAdminSupabase()
        .from("content_plans")
        .insert({
            user_id: auth.user.id,
            name: plan.name,
            brief: plan.brief ?? null,
            themes: plan.themes,
            target_accounts: plan.target_accounts,
            frequency_preset: plan.frequency_preset,
            custom_days: plan.custom_days,
            post_time: plan.post_time,
            timezone: plan.timezone,
            auto_approve: plan.auto_approve,
            monthly_budget_micros: plan.monthly_budget_micros,
            status: "active",
            next_run_at: computeNextRunAt(plan, now),
        })
        .select("*")
        .single();
    if (error) { res.status(500).json({ message: error.message }); return; }
    res.json({ plan: created });
});

router.patch("/api/autopilot/plans/:id", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) { res.status(auth.statusCode).json({ message: auth.message }); return; }
    const { id } = req.params;

    const { data: existing } = await auth.supabase
        .from("content_plans").select("*").eq("id", id).maybeSingle();
    if (!existing || existing.user_id !== auth.user.id) {
        res.status(404).json({ message: "Plan not found" }); return;
    }

    const parsed = updateContentPlanSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: "Invalid update", issues: parsed.error.issues }); return; }

    const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
    // Recompute the schedule when frequency/time changes or the plan is (re)activated.
    const freq = parsed.data.frequency_preset ?? existing.frequency_preset;
    const scheduleChanged =
        parsed.data.frequency_preset !== undefined ||
        parsed.data.custom_days !== undefined ||
        parsed.data.post_time !== undefined ||
        parsed.data.status === "active";
    if (scheduleChanged) {
        patch.next_run_at = computeNextRunAt(
            {
                frequency_preset: freq,
                custom_days: parsed.data.custom_days ?? existing.custom_days,
                post_time: parsed.data.post_time ?? existing.post_time,
            },
            new Date(),
        );
    }

    const { data: updated, error } = await createAdminSupabase()
        .from("content_plans").update(patch).eq("id", id).eq("user_id", auth.user.id).select("*").single();
    if (error) { res.status(500).json({ message: error.message }); return; }
    res.json({ plan: updated });
});

router.delete("/api/autopilot/plans/:id", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) { res.status(auth.statusCode).json({ message: auth.message }); return; }
    const { id } = req.params;

    const { data: existing } = await auth.supabase
        .from("content_plans").select("id, user_id").eq("id", id).maybeSingle();
    if (!existing || existing.user_id !== auth.user.id) { res.status(404).json({ message: "Plan not found" }); return; }

    const { error } = await createAdminSupabase().from("content_plans").delete().eq("id", id).eq("user_id", auth.user.id);
    if (error) { res.status(500).json({ message: error.message }); return; }
    res.json({ success: true, id });
});

// ── Approval queue ───────────────────────────────────────────────────────────

router.get("/api/autopilot/queue", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) { res.status(auth.statusCode).json({ message: auth.message }); return; }

    const { data, error } = await auth.supabase
        .from("scheduled_posts")
        .select("*")
        .eq("user_id", auth.user.id)
        .eq("status", "pending_approval")
        .order("created_at", { ascending: false });
    if (error) { res.status(500).json({ message: "Failed to fetch queue" }); return; }
    res.json({ queue: data || [] });
});

router.post("/api/autopilot/queue/:id/approve", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) { res.status(auth.statusCode).json({ message: auth.message }); return; }
    const { id } = req.params;

    const { data: row } = await auth.supabase
        .from("scheduled_posts").select("*").eq("id", id).maybeSingle();
    if (!row || row.user_id !== auth.user.id) { res.status(404).json({ message: "Queued post not found" }); return; }
    if (row.status !== "pending_approval") { res.status(400).json({ message: `Cannot approve a post in status '${row.status}'` }); return; }

    const resolution = await resolveZernioKey(auth.profile as any);
    if (!resolution.ok) { res.status(resolution.statusCode).json({ message: resolution.error }); return; }

    const targets: ZernioPostTarget[] = (Array.isArray(row.target_accounts) ? row.target_accounts : [])
        .map((t: any) => ({ platform: t.platform, accountId: t.zernio_account_id }));
    if (targets.length === 0) { res.status(400).json({ message: "This post has no target accounts" }); return; }

    const pub = await publishViaZernio(resolution.key, {
        caption: row.caption ?? "",
        mediaUrls: Array.isArray(row.media_urls) ? row.media_urls : [],
        targets,
    });

    const patch = pub.error
        ? { status: "failed", error_message: pub.error, updated_at: new Date().toISOString() }
        : { status: "publishing", zernio_post_id: pub.zernioPostId, updated_at: new Date().toISOString() };
    const { data: updated } = await createAdminSupabase()
        .from("scheduled_posts").update(patch).eq("id", id).eq("user_id", auth.user.id).select("*").single();

    if (pub.error) { res.status(502).json({ message: pub.error, scheduled_post: updated }); return; }
    res.json({ success: true, scheduled_post: updated });
});

router.post("/api/autopilot/queue/:id/reject", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) { res.status(auth.statusCode).json({ message: auth.message }); return; }
    const { id } = req.params;

    const { data: row } = await auth.supabase
        .from("scheduled_posts").select("id, user_id, status").eq("id", id).maybeSingle();
    if (!row || row.user_id !== auth.user.id) { res.status(404).json({ message: "Queued post not found" }); return; }

    const { error } = await createAdminSupabase()
        .from("scheduled_posts").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", auth.user.id);
    if (error) { res.status(500).json({ message: error.message }); return; }
    res.json({ success: true, id });
});

// ── Internal cron trigger (serverless path) ──────────────────────────────────

router.post("/api/internal/autopilot/tick", requireCronSecret, async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await runAutopilotTick();
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : "tick failed" });
    }
});

export default router;
