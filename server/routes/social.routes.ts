/**
 * Social Publishing Routes (Project P001 — Zernio engine)
 *
 * Per-user OAuth connections + immediate/scheduled publishing to Facebook /
 * Instagram via Zernio. All publishing is gated by the super-admin-controlled
 * profiles.publishing_mode (resolved by resolveZernioKey). The Zernio key is
 * only ever used server-side; the browser only talks to these endpoints.
 *
 * Endpoints:
 *   GET    /api/social/connections        list the user's connected accounts
 *   POST   /api/social/connect            begin hosted OAuth (returns a redirect URL)
 *   GET    /api/social/callback           Zernio OAuth redirect target (public) → syncs accounts
 *   DELETE /api/social/connections/:id    disconnect an account
 *   POST   /api/social/publish            publish now to selected connections
 *   POST   /api/social/schedule           schedule for later (scheduled_for + timezone)
 *   GET    /api/social/scheduled          list scheduled/published posts (calendar range)
 *   PATCH  /api/social/scheduled/:id      edit caption / reschedule
 *   DELETE /api/social/scheduled/:id      cancel a scheduled post
 *   POST   /api/webhooks/zernio           Zernio webhook (public, signature-verified)
 *
 * NOTE: docs.zernio.com is blocked by the environment egress policy, so the exact
 * OAuth callback params and webhook signature scheme are marked TODO(doc) and must
 * be confirmed against the live docs / a sandbox before production use.
 */

import { Router, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
    authenticateUser,
    AuthenticatedRequest,
    resolveZernioKey,
} from "../middleware/auth.middleware.js";
import { createAdminSupabase } from "../supabase.js";
import { getSiteOrigin, getPlatformSetting } from "../services/app-settings.service.js";
import {
    zernioService,
    type ZernioPlatform,
    type ZernioPostTarget,
} from "../integrations/zernio.js";
import {
    SOCIAL_PLATFORMS,
    socialConnectRequestSchema,
    socialPublishRequestSchema,
} from "../../shared/schema.js";

const router = Router();

// ── OAuth state signing ──────────────────────────────────────────────────────
// The OAuth callback is a browser redirect from Zernio and carries no Bearer
// token, so the user identity + pending Zernio profile are threaded through a
// signed `state` param (HMAC over the server-only service-role key).
const STATE_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-secret";

interface OAuthState {
    userId: string;
    platform: ZernioPlatform;
    zernioProfileId: string;
}

function signState(payload: OAuthState): string {
    const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", STATE_SECRET).update(json).digest("base64url");
    return `${json}.${sig}`;
}

function verifyState(state: string | undefined): OAuthState | null {
    if (!state) return null;
    const [json, sig] = state.split(".");
    if (!json || !sig) return null;
    const expected = createHmac("sha256", STATE_SECRET).update(json).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        return JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as OAuthState;
    } catch {
        return null;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface PublishingProfile {
    id: string;
    publishing_mode: string | null;
    zernio_api_key: string | null;
    is_admin: boolean;
}

/** Load the profile fields needed to resolve the Zernio key (service role). */
async function loadPublishingProfile(userId: string): Promise<PublishingProfile | null> {
    const sb = createAdminSupabase();
    const { data } = await sb
        .from("profiles")
        .select("id, publishing_mode, zernio_api_key, is_admin")
        .eq("id", userId)
        .maybeSingle();
    return (data as PublishingProfile) || null;
}

/**
 * Resolve the user's Zernio key or send the appropriate error response.
 * Returns the key on success, or null after having written the response.
 */
async function resolveKeyOrRespond(userId: string, res: Response): Promise<string | null> {
    const profile = await loadPublishingProfile(userId);
    const resolution = await resolveZernioKey(profile);
    if (!resolution.ok) {
        res.status(resolution.statusCode).json({ message: resolution.error, mode: resolution.mode });
        return null;
    }
    return resolution.key;
}

/** Find an existing Zernio profile id for this user, if any connection exists. */
async function findExistingZernioProfileId(userId: string): Promise<string | null> {
    const sb = createAdminSupabase();
    const { data } = await sb
        .from("social_connections")
        .select("zernio_profile_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
    return data?.zernio_profile_id || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/social/connections
// ─────────────────────────────────────────────────────────────────────────────
router.get("/api/social/connections", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) {
        res.status(auth.statusCode).json({ message: auth.message });
        return;
    }
    const { user, supabase } = auth;

    const { data, error } = await supabase
        .from("social_connections")
        .select("id, platform, account_name, account_avatar_url, status, connected_at, last_synced_at")
        .eq("user_id", user.id)
        .order("connected_at", { ascending: false });

    if (error) {
        res.status(500).json({ message: "Failed to fetch connections" });
        return;
    }
    res.json({ connections: data || [], publishing_mode: (auth.profile as any)?.publishing_mode ?? "disabled" });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/social/connect  { platform }  → { url }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/api/social/connect", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) {
        res.status(auth.statusCode).json({ message: auth.message });
        return;
    }
    const parsed = socialConnectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "platform must be one of: " + SOCIAL_PLATFORMS.join(", ") });
        return;
    }
    const platform = parsed.data.platform as ZernioPlatform;

    const key = await resolveKeyOrRespond(auth.user.id, res);
    if (!key) return;

    // Reuse the user's existing Zernio profile, or create one (one profile per user).
    let zernioProfileId = await findExistingZernioProfileId(auth.user.id);
    if (!zernioProfileId) {
        const created = await zernioService.createProfile(key, `xareable:${auth.user.id}`);
        if (created.error || !created.profileId) {
            res.status(502).json({ message: created.error || "Failed to create Zernio profile" });
            return;
        }
        zernioProfileId = created.profileId;
    }

    const state = signState({ userId: auth.user.id, platform, zernioProfileId });
    const redirectUrl = `${getSiteOrigin(req)}/api/social/callback?state=${encodeURIComponent(state)}`;

    const connect = await zernioService.getConnectUrl(key, platform, zernioProfileId, redirectUrl);
    if (connect.error || !connect.url) {
        res.status(502).json({ message: connect.error || "Failed to start OAuth" });
        return;
    }
    res.json({ url: connect.url });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/social/callback  (public — browser redirect from Zernio)
// Verifies the signed state, syncs the user's connected accounts, then redirects
// the browser back into the app.
// TODO(doc): confirm which query params Zernio appends on success/error.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/api/social/callback", async (req: Request, res: Response): Promise<void> => {
    const state = verifyState(typeof req.query.state === "string" ? req.query.state : undefined);
    const appOrigin = getSiteOrigin(req);

    if (!state) {
        res.redirect(`${appOrigin}/settings?connect_error=invalid_state`);
        return;
    }

    // Load the user's key (service-role path — the callback has no Bearer token).
    const profile = await loadPublishingProfile(state.userId);
    const resolution = await resolveZernioKey(profile);
    if (!resolution.ok) {
        res.redirect(`${appOrigin}/settings?connect_error=not_enabled`);
        return;
    }

    const { accounts, error } = await zernioService.listAccounts(resolution.key, state.zernioProfileId);
    if (error) {
        res.redirect(`${appOrigin}/settings?connect_error=sync_failed`);
        return;
    }

    // Upsert the connected accounts for the requested platform (service role).
    const sb = createAdminSupabase();
    const nowIso = new Date().toISOString();
    const rows = accounts
        .filter((a) => String(a.platform) === state.platform)
        .map((a) => ({
            user_id: state.userId,
            zernio_profile_id: state.zernioProfileId,
            zernio_account_id: a.id,
            platform: state.platform,
            account_name: a.name ?? null,
            account_avatar_url: a.avatarUrl ?? null,
            status: "active",
            last_synced_at: nowIso,
        }));

    if (rows.length > 0) {
        const { error: upsertError } = await sb
            .from("social_connections")
            .upsert(rows, { onConflict: "user_id,zernio_account_id" });
        if (upsertError) {
            res.redirect(`${appOrigin}/settings?connect_error=save_failed`);
            return;
        }
    }

    res.redirect(`${appOrigin}/settings?connected=${state.platform}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/social/connections/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/api/social/connections/:id", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) {
        res.status(auth.statusCode).json({ message: auth.message });
        return;
    }
    const { user, supabase } = auth;
    const { id } = req.params;

    const { data: conn } = await supabase
        .from("social_connections")
        .select("id, user_id")
        .eq("id", id)
        .maybeSingle();
    if (!conn || conn.user_id !== user.id) {
        res.status(404).json({ message: "Connection not found" });
        return;
    }

    const { error } = await createAdminSupabase()
        .from("social_connections")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
    if (error) {
        res.status(500).json({ message: "Failed to disconnect" });
        return;
    }
    // TODO(doc): optionally revoke the account on Zernio's side.
    res.json({ success: true, id });
});

// ── publish / schedule shared core ───────────────────────────────────────────
async function createSocialPost(
    req: Request,
    res: Response,
    mode: "publish" | "schedule",
): Promise<void> {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) {
        res.status(auth.statusCode).json({ message: auth.message });
        return;
    }
    const { user, supabase } = auth;

    const parsed = socialPublishRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid request", issues: parsed.error.issues });
        return;
    }
    const body = parsed.data;

    if (mode === "schedule" && !body.scheduled_for) {
        res.status(400).json({ message: "scheduled_for is required to schedule" });
        return;
    }

    const key = await resolveKeyOrRespond(user.id, res);
    if (!key) return;

    // Resolve the targeted connections (must belong to the user).
    const { data: conns } = await supabase
        .from("social_connections")
        .select("id, platform, zernio_account_id, status")
        .in("id", body.connection_ids)
        .eq("user_id", user.id);
    const activeConns = (conns || []).filter((c) => c.status === "active");
    if (activeConns.length === 0) {
        res.status(400).json({ message: "No valid connected accounts selected" });
        return;
    }

    // Upload media (best-effort URL ingestion — TODO(doc): confirm URL vs bytes).
    const mediaIds: string[] = [];
    for (const url of body.media_urls) {
        const up = await zernioService.uploadMedia(key, url);
        if (up.error || !up.mediaId) {
            res.status(502).json({ message: up.error || "Media upload failed" });
            return;
        }
        mediaIds.push(up.mediaId);
    }

    const targets: ZernioPostTarget[] = activeConns.map((c) => ({
        platform: c.platform as ZernioPlatform,
        accountId: c.zernio_account_id,
    }));

    const zres = await zernioService.createPost(key, {
        content: body.caption ?? "",
        platforms: targets,
        mediaIds: mediaIds.length ? mediaIds : undefined,
        scheduledFor: mode === "schedule" ? body.scheduled_for : undefined,
        timezone: mode === "schedule" ? body.timezone : undefined,
        publishNow: mode === "publish",
    });

    // Persist the local mirror row (status is finalised by the webhook — P007).
    const status = zres.error ? "failed" : mode === "schedule" ? "scheduled" : "publishing";
    const insertRow = {
        user_id: user.id,
        post_id: body.post_id ?? null,
        zernio_post_id: zres.post?.id ?? null,
        caption: body.caption ?? null,
        media_urls: body.media_urls,
        target_accounts: activeConns.map((c) => ({ platform: c.platform, zernio_account_id: c.zernio_account_id })),
        scheduled_for: mode === "schedule" ? body.scheduled_for : null,
        timezone: body.timezone ?? null,
        status,
        error_message: zres.error ?? null,
    };

    const { data: saved, error: saveError } = await createAdminSupabase()
        .from("scheduled_posts")
        .insert(insertRow)
        .select("*")
        .single();

    if (saveError) {
        res.status(500).json({ message: "Post sent but failed to record locally" });
        return;
    }

    if (zres.error) {
        res.status(502).json({ message: zres.error, scheduled_post: saved });
        return;
    }
    res.json({ success: true, scheduled_post: saved });
}

router.post("/api/social/publish", (req, res) => createSocialPost(req, res, "publish"));
router.post("/api/social/schedule", (req, res) => createSocialPost(req, res, "schedule"));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/social/scheduled?from=&to=
// ─────────────────────────────────────────────────────────────────────────────
router.get("/api/social/scheduled", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) {
        res.status(auth.statusCode).json({ message: auth.message });
        return;
    }
    const { user, supabase } = auth;

    let query = supabase
        .from("scheduled_posts")
        .select("*")
        .eq("user_id", user.id)
        .order("scheduled_for", { ascending: true, nullsFirst: false });

    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    if (from) query = query.gte("scheduled_for", from);
    if (to) query = query.lte("scheduled_for", to);

    const { data, error } = await query;
    if (error) {
        res.status(500).json({ message: "Failed to fetch scheduled posts" });
        return;
    }
    res.json({ scheduled_posts: data || [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/social/scheduled/:id   { caption?, scheduled_for?, timezone? }
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/api/social/scheduled/:id", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) {
        res.status(auth.statusCode).json({ message: auth.message });
        return;
    }
    const { user, supabase } = auth;
    const { id } = req.params;

    const { data: row } = await supabase
        .from("scheduled_posts")
        .select("id, user_id, status")
        .eq("id", id)
        .maybeSingle();
    if (!row || row.user_id !== user.id) {
        res.status(404).json({ message: "Scheduled post not found" });
        return;
    }
    if (!["draft", "scheduled", "pending_approval"].includes(row.status)) {
        res.status(400).json({ message: `Cannot edit a post in status '${row.status}'` });
        return;
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof req.body.caption === "string") patch.caption = req.body.caption;
    if (typeof req.body.scheduled_for === "string") patch.scheduled_for = req.body.scheduled_for;
    if (typeof req.body.timezone === "string") patch.timezone = req.body.timezone;

    // TODO(doc): if a zernio_post_id exists, mirror the reschedule/edit to Zernio.
    const { data: updated, error } = await createAdminSupabase()
        .from("scheduled_posts")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("*")
        .single();
    if (error) {
        res.status(500).json({ message: "Failed to update scheduled post" });
        return;
    }
    res.json({ success: true, scheduled_post: updated });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/social/scheduled/:id   (cancel)
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/api/social/scheduled/:id", async (req: Request, res: Response): Promise<void> => {
    const auth = await authenticateUser(req as AuthenticatedRequest);
    if (!auth.success) {
        res.status(auth.statusCode).json({ message: auth.message });
        return;
    }
    const { user, supabase } = auth;
    const { id } = req.params;

    const { data: row } = await supabase
        .from("scheduled_posts")
        .select("id, user_id, zernio_post_id, status")
        .eq("id", id)
        .maybeSingle();
    if (!row || row.user_id !== user.id) {
        res.status(404).json({ message: "Scheduled post not found" });
        return;
    }

    // Best-effort: cancel on Zernio if it hasn't published yet.
    if (row.zernio_post_id && row.status !== "published") {
        const key = await resolveKeyOrRespond(user.id, res);
        if (!key) return;
        await zernioService.deletePost(key, row.zernio_post_id);
    }

    const { error } = await createAdminSupabase()
        .from("scheduled_posts")
        .update({ status: "canceled", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);
    if (error) {
        res.status(500).json({ message: "Failed to cancel scheduled post" });
        return;
    }
    res.json({ success: true, id });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/zernio   (public — signature-verified)
// Zernio calls this on post.published / post.failed to finalise local status.
// TODO(doc): confirm the exact signature header + scheme. Until confirmed, if a
// zernio_webhook_secret is configured we HMAC-verify the raw body; otherwise we
// process but log a warning (never trust unverified events in production).
// ─────────────────────────────────────────────────────────────────────────────
router.post("/api/webhooks/zernio", async (req: Request, res: Response): Promise<void> => {
    const secret = await getPlatformSetting("zernio_webhook_secret");
    const rawBody = (req as any).rawBody instanceof Buffer ? ((req as any).rawBody as Buffer) : null;

    if (secret) {
        const provided = String(req.headers["x-zernio-signature"] || req.headers["x-signature"] || "");
        const expected = createHmac("sha256", secret).update(rawBody ?? Buffer.from(JSON.stringify(req.body))).digest("hex");
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            res.status(401).json({ error: "invalid_signature" });
            return;
        }
    } else {
        console.warn("[ZernioWebhook] zernio_webhook_secret not set — event NOT verified");
    }

    const event = String(req.body?.event || req.body?.type || "");
    const zernioPostId = String(req.body?.postId || req.body?.post?.id || req.body?.data?.postId || "");
    if (!zernioPostId) {
        res.status(200).json({ ok: true, ignored: "no_post_id" });
        return;
    }

    const sb = createAdminSupabase();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (event.includes("published")) {
        patch.status = "published";
        patch.published_at = new Date().toISOString();
    } else if (event.includes("failed")) {
        patch.status = "failed";
        patch.error_message = String(req.body?.error || req.body?.reason || "Publish failed");
    } else {
        res.status(200).json({ ok: true, ignored: event });
        return;
    }

    await sb.from("scheduled_posts").update(patch).eq("zernio_post_id", zernioPostId);
    res.status(200).json({ ok: true });
});

export default router;
