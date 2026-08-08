/**
 * Social Publishing Routes (Zernio) — user-facing `/api/social/*` surface.
 *
 * All endpoints require auth (mirrors the inline `authenticateUser` house
 * style used by posts.routes.ts) EXCEPT the Zernio webhook, which is public
 * by nature and instead verifies an HMAC-SHA256 signature.
 *
 * See docs/zernio-social-publishing.md ("User-facing endpoints") for the
 * full contract.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import {
    saveZernioKeyRequestSchema,
    socialConnectRequestSchema,
    socialPublishRequestSchema,
    socialStatusResponseSchema,
    type PostPublication,
} from "../../shared/schema.js";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { AppError } from "../utils/errors.js";
import { createAdminSupabase } from "../supabase.js";
import { getSiteOrigin, getPlatformSetting } from "../services/app-settings.service.js";
import {
    ZernioApiError,
    listZernioAccounts,
    getZernioConnectUrl,
    deleteZernioAccount,
    retryZernioPost,
    type ZernioAccount,
} from "../lib/zernio.js";
import {
    resolveZernioCredentials,
    saveUserZernioKey,
    clearUserZernioKey,
    ensureByokZernioProfile,
    ensureGlobalZernioProfile,
    getUserZernioSettingsRow,
    INVALID_ZERNIO_KEY_ERROR,
    PLATFORM_KEY_ZERNIO_WEBHOOK_SECRET,
} from "../services/zernio-credentials.service.js";
import { publishPost, mapZernioError, refreshPublications, applyWebhookEvent } from "../services/social-publish.service.js";

const router = Router();

/** Mirrors zernio-credentials.service.ts's private `unquote` — that one isn't exported, so redefined locally. */
function unquoteSetting(raw: string | null): string | null {
    if (raw == null) return null;
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        return raw.slice(1, -1);
    }
    return raw;
}

// ─────────────────────────────────────────────────────────────────
// GET /api/social/status
// ─────────────────────────────────────────────────────────────────
router.get("/api/social/status", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;

    const credentials = await resolveZernioCredentials(user.id);
    if (!credentials) {
        res.json(socialStatusResponseSchema.parse({ configured: false, mode: null, accounts_count: 0 }));
        return;
    }

    const sb = createAdminSupabase();
    const { count, error } = await sb
        .from("social_accounts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_active", true)
        .eq("connection_mode", credentials.mode);

    if (error) {
        res.status(500).json({ message: "Failed to load social status" });
        return;
    }

    res.json(
        socialStatusResponseSchema.parse({
            configured: true,
            mode: credentials.mode,
            accounts_count: count || 0,
        }),
    );
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/social/zernio-key
// ─────────────────────────────────────────────────────────────────
router.put("/api/social/zernio-key", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;

    const parsed = saveZernioKeyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
        return;
    }

    try {
        const { zernioProfileId } = await saveUserZernioKey(user.id, parsed.data.api_key, getSiteOrigin(req));
        res.json({ success: true, zernio_profile_id: zernioProfileId });
    } catch (err) {
        if (err instanceof Error && err.message === INVALID_ZERNIO_KEY_ERROR) {
            res.status(400).json({ message: "Invalid Zernio API key" });
            return;
        }
        console.error(`[social] saveUserZernioKey failed for user=${user.id}:`, err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to save Zernio API key" });
    }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/social/zernio-key
// ─────────────────────────────────────────────────────────────────
router.delete("/api/social/zernio-key", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;

    try {
        await clearUserZernioKey(user.id);
        res.json({ success: true });
    } catch (err) {
        console.error(`[social] clearUserZernioKey failed for user=${user.id}:`, err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to clear Zernio API key" });
    }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/social/accounts
// ─────────────────────────────────────────────────────────────────
router.get("/api/social/accounts", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;

    const credentials = await resolveZernioCredentials(user.id);
    if (!credentials) {
        res.status(200).json({ configured: false, accounts: [] });
        return;
    }

    const sb = createAdminSupabase();

    try {
        const { accounts: liveAccounts } = await listZernioAccounts(
            credentials.apiKey,
            credentials.zernioProfileId ?? undefined,
        );

        const now = new Date().toISOString();
        for (const account of liveAccounts as ZernioAccount[]) {
            const { error: upsertError } = await sb.from("social_accounts").upsert(
                {
                    user_id: user.id,
                    zernio_account_id: account._id,
                    platform: account.platform,
                    username: account.username ?? null,
                    display_name: account.displayName ?? null,
                    avatar_url: account.avatarUrl ?? account.profilePicture ?? null,
                    connection_mode: credentials.mode,
                    is_active: account.isActive !== false,
                    updated_at: now,
                },
                { onConflict: "user_id,zernio_account_id" },
            );
            if (upsertError) {
                console.error(
                    `[social] failed to cache account ${account._id} for user=${user.id}:`,
                    upsertError.message,
                );
            }
        }

        // Mark cached rows of the SAME mode no longer present on Zernio as inactive.
        const liveIds = new Set(liveAccounts.map((a) => a._id));
        const { data: cachedRows } = await sb
            .from("social_accounts")
            .select("id, zernio_account_id")
            .eq("user_id", user.id)
            .eq("connection_mode", credentials.mode)
            .eq("is_active", true);

        const staleIds = (cachedRows || [])
            .filter((row: any) => !liveIds.has(row.zernio_account_id))
            .map((row: any) => row.id);

        if (staleIds.length > 0) {
            await sb.from("social_accounts").update({ is_active: false, updated_at: now }).in("id", staleIds);
        }
    } catch (err) {
        console.error(
            `[social] listZernioAccounts sync failed for user=${user.id}:`,
            err instanceof Error ? err.message : err,
        );
        // Non-fatal — fall back to whatever is already cached below.
    }

    const { data: cached, error: cacheError } = await sb
        .from("social_accounts")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .eq("connection_mode", credentials.mode)
        .order("connected_at", { ascending: true });

    if (cacheError) {
        res.status(500).json({ message: "Failed to load connected accounts" });
        return;
    }

    res.json({ configured: true, mode: credentials.mode, accounts: cached || [] });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/social/connect
// ─────────────────────────────────────────────────────────────────
router.post("/api/social/connect", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;

    const parsed = socialConnectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
        return;
    }
    const { platform } = parsed.data;

    const credentials = await resolveZernioCredentials(user.id);
    if (!credentials) {
        res.status(400).json({
            message: "Connect a Zernio API key in Settings → Social before connecting accounts.",
        });
        return;
    }

    try {
        let profileId = credentials.zernioProfileId;
        if (!profileId) {
            if (credentials.mode === "byok") {
                profileId = await ensureByokZernioProfile(credentials.apiKey);
                const sb = createAdminSupabase();
                const { error } = await sb.from("user_zernio_settings").upsert(
                    { user_id: user.id, zernio_profile_id: profileId, updated_at: new Date().toISOString() },
                    { onConflict: "user_id" },
                );
                if (error) throw new Error(`persist byok profile id: ${error.message}`);
            } else {
                profileId = await ensureGlobalZernioProfile(user.id, credentials.apiKey);
            }
        }

        const redirectUrl = `${getSiteOrigin(req)}/settings?social_connected=${platform}`;
        const { authUrl } = await getZernioConnectUrl(credentials.apiKey, platform, profileId, redirectUrl);
        res.json({ auth_url: authUrl });
    } catch (err) {
        if (err instanceof ZernioApiError) {
            const mapped = mapZernioError(err);
            res.status(mapped.statusCode).json({ message: mapped.message });
            return;
        }
        console.error(
            `[social] connect failed for user=${user.id} platform=${platform}:`,
            err instanceof Error ? err.message : err,
        );
        res.status(500).json({ message: "Failed to start social connect" });
    }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/social/accounts/:id
// ─────────────────────────────────────────────────────────────────
router.delete("/api/social/accounts/:id", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;
    const { id } = req.params;

    const sb = createAdminSupabase();
    const { data: account, error: fetchError } = await sb
        .from("social_accounts")
        .select("id, user_id, zernio_account_id, connection_mode")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();

    if (fetchError) {
        res.status(500).json({ message: "Failed to load account" });
        return;
    }
    if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
    }

    const credentials = await resolveZernioCredentials(user.id);
    if (credentials) {
        try {
            await deleteZernioAccount(credentials.apiKey, account.zernio_account_id);
        } catch (err) {
            if (!(err instanceof ZernioApiError && err.status === 404)) {
                console.error(
                    `[social] deleteZernioAccount failed for account=${id}:`,
                    err instanceof Error ? err.message : err,
                );
            }
        }
    }

    const { error: updateError } = await sb
        .from("social_accounts")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);

    if (updateError) {
        res.status(500).json({ message: "Failed to disconnect account" });
        return;
    }

    res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/social/publish
// ─────────────────────────────────────────────────────────────────
router.post("/api/social/publish", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;

    const parsed = socialPublishRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
        return;
    }

    const credentials = await resolveZernioCredentials(user.id);
    if (!credentials) {
        res.status(400).json({
            message: "Connect a Zernio API key in Settings → Social before publishing.",
        });
        return;
    }

    try {
        const publications = await publishPost(user.id, parsed.data, credentials);
        res.json({ publications });
    } catch (err) {
        if (err instanceof ZernioApiError) {
            const mapped = mapZernioError(err);
            res.status(mapped.statusCode).json({ message: mapped.message });
            return;
        }
        if (err instanceof AppError) {
            res.status(err.statusCode).json({
                message: err.message,
                ...(err.details ? { details: err.details } : {}),
            });
            return;
        }
        console.error(`[social] publish failed for user=${user.id}:`, err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to publish post" });
    }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/social/publications?post_id=
// ─────────────────────────────────────────────────────────────────
router.get("/api/social/publications", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;

    const postIdParsed = z.string().uuid().safeParse(req.query.post_id);
    if (!postIdParsed.success) {
        res.status(400).json({ message: "post_id must be a valid UUID" });
        return;
    }
    const postId = postIdParsed.data;

    const sb = createAdminSupabase();
    const { data: rows, error } = await sb
        .from("post_publications")
        .select("*")
        .eq("user_id", user.id)
        .eq("post_id", postId)
        .order("created_at", { ascending: false });

    if (error) {
        res.status(500).json({ message: "Failed to load publications" });
        return;
    }

    const staleCutoffMs = Date.now() - 30_000;
    const stale = (rows || []).filter(
        (r: any) =>
            (r.status === "pending" || r.status === "scheduled") && Date.parse(r.updated_at) < staleCutoffMs,
    );

    if (stale.length > 0) {
        await refreshPublications(stale as PostPublication[]);
        const { data: refreshed, error: refreshError } = await sb
            .from("post_publications")
            .select("*")
            .eq("user_id", user.id)
            .eq("post_id", postId)
            .order("created_at", { ascending: false });
        if (!refreshError && refreshed) {
            res.json({ publications: refreshed });
            return;
        }
    }

    res.json({ publications: rows || [] });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/social/publications/:id/retry
// ─────────────────────────────────────────────────────────────────
router.post("/api/social/publications/:id/retry", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;
    const { id } = req.params;

    const sb = createAdminSupabase();
    const { data: row, error: fetchError } = await sb
        .from("post_publications")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();

    if (fetchError) {
        res.status(500).json({ message: "Failed to load publication" });
        return;
    }
    if (!row) {
        res.status(404).json({ message: "Publication not found" });
        return;
    }
    if (row.status !== "failed" || !row.zernio_post_id) {
        res.status(400).json({ message: "Only failed publications with a Zernio post can be retried" });
        return;
    }

    const credentials = await resolveZernioCredentials(user.id);
    if (!credentials) {
        res.status(400).json({ message: "Connect a Zernio API key in Settings → Social before retrying." });
        return;
    }

    try {
        await retryZernioPost(credentials.apiKey, row.zernio_post_id);

        const { error: updateError } = await sb
            .from("post_publications")
            .update({ status: "pending", error_message: null, updated_at: new Date().toISOString() })
            .eq("id", id)
            .eq("user_id", user.id);

        if (updateError) {
            res.status(500).json({ message: "Failed to update publication status" });
            return;
        }
        res.json({ success: true });
    } catch (err) {
        if (err instanceof ZernioApiError) {
            const mapped = mapZernioError(err);
            res.status(mapped.statusCode).json({ message: mapped.message });
            return;
        }
        console.error(`[social] retry failed for publication=${id}:`, err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to retry publication" });
    }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/social/webhooks/zernio/:settingsKey  (PUBLIC — no requireAuth)
//
// Raw-body mechanism reused verbatim from server/routes/stripe.routes.ts:
// server/index.ts + api/handler.ts mount a single global
// `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })`
// ahead of the router, so every request — this one included — already has
// `(req as any).rawBody` populated as a Buffer of the exact bytes Zernio
// sent, independent of req.body's parsed (and therefore re-serialization-
// unsafe) JSON. No dedicated `express.raw()` mount is needed for this path;
// Stripe's webhook route relies on that exact same global capture and this
// route does the same.
// ─────────────────────────────────────────────────────────────────
router.post("/api/social/webhooks/zernio/:settingsKey", async (req: Request, res: Response): Promise<void> => {
    // req.params values are typed `string | string[]` by @types/express's generic
    // ParamsDictionary — a single named segment is always a plain string at runtime.
    const rawSettingsKey = req.params.settingsKey;
    const settingsKey = Array.isArray(rawSettingsKey) ? rawSettingsKey[0] : rawSettingsKey;

    let secret: string | null = null;
    let userId: string | null = null;

    try {
        if (settingsKey === "global") {
            const raw = await getPlatformSetting(PLATFORM_KEY_ZERNIO_WEBHOOK_SECRET);
            secret = unquoteSetting(raw)?.trim() || null;
        } else {
            const row = await getUserZernioSettingsRow(settingsKey);
            if (row?.webhook_secret) {
                secret = row.webhook_secret;
                userId = settingsKey;
            }
        }
    } catch (err) {
        console.error(`[social] webhook secret lookup failed for settingsKey=${settingsKey}:`, err instanceof Error ? err.message : err);
        res.status(404).json({ message: "Unknown webhook" });
        return;
    }

    if (!secret) {
        res.status(404).json({ message: "Unknown webhook" });
        return;
    }

    const rawBody = (req as any).rawBody;
    if (!Buffer.isBuffer(rawBody)) {
        res.status(400).json({ message: "Invalid webhook: raw body not available as Buffer" });
        return;
    }

    const signatureHeader = req.headers["x-zernio-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!signature) {
        res.status(401).json({ message: "Missing signature" });
        return;
    }

    const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

    let signatureValid = false;
    try {
        const providedBuf = Buffer.from(provided, "hex");
        const expectedBuf = Buffer.from(expected, "hex");
        signatureValid = providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
    } catch {
        signatureValid = false;
    }

    if (!signatureValid) {
        res.status(401).json({ message: "Invalid signature" });
        return;
    }

    // Verified — apply the event and ALWAYS 200 (Zernio disables a webhook
    // after 10 consecutive delivery failures; applyWebhookEvent itself never throws).
    await applyWebhookEvent(userId, req.body);
    res.status(200).json({ received: true });
});

export default router;
