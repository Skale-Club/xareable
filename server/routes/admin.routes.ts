/**
 * Admin Routes
 * Handles all admin-only endpoints
 */

import { Router } from "express";
import { createAdminSupabase, createServerSupabase } from "../supabase.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import {
    listAllAuthUsers,
    syncProfilesFromAuthUsers,
    buildUserSummary,
    normalizeAuthEmail,
    extractAuthProviders,
} from "../services/user.service.js";

const router = Router();

/**
 * GET /api/admin/stats - Get platform statistics
 */
router.get("/api/admin/stats", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();
    const [usersRes, postsRes, brandsRes, usageRes, creditsRes] =
        await Promise.all([
            sb.from("profiles").select("id, is_admin, created_at", { count: "exact" }),
            sb.from("posts").select("id, created_at", { count: "exact" }),
            sb.from("brands").select("id", { count: "exact" }),
            sb.from("usage_events").select("user_id, cost_usd_micros"),
            sb
                .from("user_credits")
                .select(
                    "user_id, balance_micros, lifetime_purchased_micros, free_generations_used, free_generations_limit"
                ),
        ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = (usersRes.data || []).filter(
        (u) => new Date(u.created_at) >= today
    ).length;
    const newPostsToday = (postsRes.data || []).filter(
        (p) => new Date(p.created_at) >= today
    ).length;
    const totalCostUsdMicros = (usageRes.data || []).reduce(
        (s, e) => s + (e.cost_usd_micros ?? 0),
        0
    );
    const creditCustomers = (creditsRes.data || []).filter(
        (c) => (c.lifetime_purchased_micros ?? 0) > 0
    ).length;
    const freeUsers = (creditsRes.data || []).filter(
        (c) =>
            (c.free_generations_used ?? 0) < (c.free_generations_limit ?? 0)
    ).length;
    const totalUsageEvents = (usageRes.data || []).length;
    const lowBalanceUsers = (creditsRes.data || []).filter((c) => {
        const freeRemaining =
            (c.free_generations_limit ?? 0) - (c.free_generations_used ?? 0);
        return freeRemaining <= 0 && (c.balance_micros ?? 0) <= 0;
    }).length;

    res.json({
        totalUsers: usersRes.count || 0,
        totalPosts: postsRes.count || 0,
        totalBrands: brandsRes.count || 0,
        newUsersToday,
        newPostsToday,
        totalUsageEvents,
        totalCostUsdMicros,
        activeSubscribers: creditCustomers,
        trialingUsers: freeUsers,
        quotaExhausted: lowBalanceUsers,
    });
});

/**
 * GET /api/admin/users - List all users with details
 */
router.get("/api/admin/users", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    try {
        const authUsers = await listAllAuthUsers(sb);
        await syncProfilesFromAuthUsers(sb, authUsers);

        const [
            { data: profiles },
            { data: brands },
            { data: posts },
            { data: credits },
            { data: usageEvents },
            { data: affiliateSettings },
        ] = await Promise.all([
            sb
                .from("profiles")
                .select("id, is_admin, is_affiliate, referred_by_affiliate_id, created_at"),
            sb.from("brands").select("user_id, company_name"),
            sb.from("posts").select("user_id"),
            sb
                .from("user_credits")
                .select(
                    "user_id, balance_micros, lifetime_purchased_micros, free_generations_used, free_generations_limit"
                ),
            sb.from("usage_events").select("user_id, event_type, cost_usd_micros"),
            sb.from("affiliate_settings").select("user_id, commission_share_percent"),
        ]);

        const profileMap = Object.fromEntries(
            (profiles || []).map((p) => [p.id, p])
        );
        const brandMap = Object.fromEntries(
            (brands || []).map((b) => [b.user_id, b])
        );
        const creditMap = Object.fromEntries(
            (credits || []).map((c) => [c.user_id, c])
        );
        const affiliateSettingsMap = Object.fromEntries(
            (affiliateSettings || []).map((row: any) => [row.user_id, row])
        );

        const postCountMap: Record<string, number> = {};
        for (const p of posts || []) {
            postCountMap[p.user_id] = (postCountMap[p.user_id] || 0) + 1;
        }

        const usageMap: Record<string, {
            generate: number;
            edit: number;
            cost: number;
        }> = {};
        for (const e of usageEvents || []) {
            if (!usageMap[e.user_id])
                usageMap[e.user_id] = { generate: 0, edit: 0, cost: 0 };
            if (e.event_type === "generate") usageMap[e.user_id].generate++;
            if (e.event_type === "edit") usageMap[e.user_id].edit++;
            usageMap[e.user_id].cost += e.cost_usd_micros ?? 0;
        }

        const users = authUsers
            .map((user) => {
                const profile = profileMap[user.id];
                const brand = brandMap[user.id];
                const credit = creditMap[user.id];
                const usage = usageMap[user.id] || { generate: 0, edit: 0, cost: 0 };

                return buildUserSummary(
                    user,
                    profile,
                    brand,
                    credit,
                    postCountMap[user.id] || 0,
                    usage,
                    affiliateSettingsMap[user.id]
                );
            })
            .sort((a, b) => {
                const aTime = Date.parse(a.created_at || "");
                const bTime = Date.parse(b.created_at || "");
                const left = Number.isFinite(aTime) ? aTime : 0;
                const right = Number.isFinite(bTime) ? bTime : 0;
                return right - left;
            });

        res.json({ users });
    } catch (err: any) {
        console.error("Failed to load admin users:", err);
        res.status(500).json({ message: err?.message || "Failed to load users" });
    }
});

/**
 * POST /api/admin/users/sync - Sync auth users into profiles
 */
router.post("/api/admin/users/sync", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    try {
        const authUsers = await listAllAuthUsers(sb);
        const syncResult = await syncProfilesFromAuthUsers(sb, authUsers);
        res.json({
            success: true,
            total_auth_users: authUsers.length,
            synced_profiles: syncResult.syncedProfiles,
        });
    } catch (err: any) {
        console.error("Failed to sync admin users:", err);
        res.status(500).json({ message: err?.message || "Failed to sync users" });
    }
});

/**
 * GET /api/admin/users/:id/posts - Get user's posts
 */
router.get("/api/admin/users/:id/posts", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const sb = createAdminSupabase();

    const isMissingSchemaTable = (error: any, table: string) =>
        typeof error?.message === "string" &&
        error.message.includes(
            `Could not find the table 'public.${table}' in the schema cache`
        );

    const isMissingColumn = (error: any, column: string) => {
        const message = String(error?.message || "").toLowerCase();
        return (
            message.includes("column") &&
            message.includes(column.toLowerCase()) &&
            message.includes("does not exist")
        );
    };

    let postsResult: any = await sb
        .from("posts")
        .select(
            "id, created_at, image_url, thumbnail_url, content_type, ai_prompt_used, caption"
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false });

    if (
        postsResult.error &&
        (isMissingColumn(postsResult.error, "thumbnail_url") ||
            isMissingColumn(postsResult.error, "content_type"))
    ) {
        postsResult = await sb
            .from("posts")
            .select("id, created_at, image_url, ai_prompt_used, caption")
            .eq("user_id", id)
            .order("created_at", { ascending: false });
    }

    const posts = postsResult.data || [];
    const error = postsResult.error;

    if (error) {
        console.error("Error fetching user posts:", error);
        return res.status(500).json({ message: error.message });
    }

    const postIds = (posts || []).map((post: any) => post.id);
    let versionRows: any[] = [];
    let usageRows: any[] = [];

    if (postIds.length > 0) {
        let versionsError: any = null;
        let versions: any[] = [];
        try {
            const result = await sb
                .from("post_versions")
                .select("post_id, image_url, version_number")
                .in("post_id", postIds);
            versions = result.data || [];
            versionsError = result.error;
        } catch (e) {
            versionsError = e;
        }

        let usageError: any = null;
        let usageEvents: any[] = [];
        try {
            const result = await sb
                .from("usage_events")
                .select("post_id, cost_usd_micros")
                .in("post_id", postIds);
            usageEvents = result.data || [];
            usageError = result.error;
        } catch (e) {
            usageError = e;
        }

        if (
            versionsError &&
            !isMissingSchemaTable(versionsError, "post_versions")
        ) {
            console.error("Error fetching post versions:", versionsError);
            return res
                .status(500)
                .json({ message: versionsError.message || String(versionsError) });
        }

        if (usageError && !isMissingSchemaTable(usageError, "usage_events")) {
            console.error("Error fetching usage events:", usageError);
            return res
                .status(500)
                .json({ message: usageError.message || String(usageError) });
        }

        if (
            versionsError &&
            isMissingSchemaTable(versionsError, "post_versions")
        ) {
            console.warn(
                "post_versions table missing from schema cache; returning posts without edit history"
            );
            versionRows = [];
        } else {
            versionRows = versions;
        }

        if (usageError && isMissingSchemaTable(usageError, "usage_events")) {
            console.warn(
                "usage_events table missing from schema cache; returning posts without cost history"
            );
            usageRows = [];
        } else {
            usageRows = usageEvents;
        }
    }

    const versionsByPost = versionRows.reduce(
        (acc: Record<string, any[]>, row: any) => {
            if (!row.post_id) return acc;
            if (!acc[row.post_id]) acc[row.post_id] = [];
            acc[row.post_id].push(row);
            return acc;
        },
        {}
    );

    const costByPost = usageRows.reduce(
        (acc: Record<string, number>, row: any) => {
            if (!row.post_id) return acc;
            acc[row.post_id] = (acc[row.post_id] || 0) + (row.cost_usd_micros || 0);
            return acc;
        },
        {}
    );

    const formattedPosts = posts.map((post: any) => {
        const postVersions = versionsByPost[post.id] || [];
        const isVideoByUrl =
            typeof post.image_url === "string" &&
            /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(post.image_url);

        const latestVersion = postVersions.reduce(
            (latest: any, version: any) => {
                if (
                    !latest ||
                    (version.version_number ?? 0) > (latest.version_number ?? 0)
                ) {
                    return version;
                }
                return latest;
            },
            null
        );

        return {
            id: post.id,
            created_at: post.created_at,
            original_prompt: post.ai_prompt_used || null,
            caption: post.caption || null,
            image_url: latestVersion?.image_url || post.image_url || null,
            thumbnail_url:
                post.content_type === "video" || isVideoByUrl
                    ? post.thumbnail_url || null
                    : latestVersion?.image_url || post.image_url || null,
            content_type:
                post.content_type === "video" || isVideoByUrl ? "video" : "image",
            version_count: postVersions.length,
            total_cost_usd_micros: costByPost[post.id] || 0,
        };
    });

    res.json({ posts: formattedPosts });
});

/**
 * PATCH /api/admin/users/:id/admin - Toggle admin status
 */
router.patch("/api/admin/users/:id/admin", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { is_admin } = req.body;
    if (id === admin.userId)
        return res
            .status(400)
            .json({ message: "Cannot change your own admin status" });

    const sb = createAdminSupabase();
    const { error } = await sb
        .from("profiles")
        .update({ is_admin: !!is_admin })
        .eq("id", id);
    if (error) return res.status(500).json({ message: error.message });
    res.json({ success: true });
});

/**
 * PATCH /api/admin/users/:id/affiliate - Toggle affiliate status
 */
router.patch("/api/admin/users/:id/affiliate", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { is_affiliate } = req.body;
    const sb = createAdminSupabase();
    const { error } = await sb
        .from("profiles")
        .update({ is_affiliate: !!is_affiliate })
        .eq("id", id);
    if (error) return res.status(500).json({ message: error.message });

    if (is_affiliate) {
        const { data: defaultCommissionSetting } = await sb
            .from("platform_settings")
            .select("setting_value")
            .eq("setting_key", "default_affiliate_commission_percent")
            .maybeSingle();
        const defaultCommission =
            Number((defaultCommissionSetting?.setting_value as any)?.amount ?? 50) ||
            50;

        await sb.from("affiliate_settings").upsert(
            {
                user_id: id,
                commission_share_percent: Math.min(Math.max(defaultCommission, 0), 100),
            },
            { onConflict: "user_id" }
        );
    }

    res.json({ success: true });
});

/**
 * PATCH /api/admin/users/:id/affiliate-commission - Update commission share
 */
router.patch("/api/admin/users/:id/affiliate-commission", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const rawPercent = Number(req.body?.commission_share_percent);
    if (!Number.isFinite(rawPercent) || rawPercent < 0 || rawPercent > 100) {
        return res
            .status(400)
            .json({ message: "commission_share_percent must be between 0 and 100" });
    }

    const sb = createAdminSupabase();
    const { data: profile } = await sb
        .from("profiles")
        .select("is_affiliate")
        .eq("id", id)
        .single();

    if (!profile?.is_affiliate) {
        return res.status(400).json({ message: "User is not an affiliate" });
    }

    const { error } = await sb.from("affiliate_settings").upsert(
        {
            user_id: id,
            commission_share_percent: rawPercent,
        },
        { onConflict: "user_id" }
    );

    if (error) {
        return res.status(500).json({ message: error.message });
    }

    res.json({ success: true, commission_share_percent: rawPercent });
});

/**
 * PATCH /api/admin/users/:id/referrer - Assign affiliate referrer
 */
router.patch("/api/admin/users/:id/referrer", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const rawAffiliateUserId = req.body?.affiliate_user_id;
    const affiliateUserId =
        rawAffiliateUserId === null ||
            rawAffiliateUserId === undefined ||
            rawAffiliateUserId === ""
            ? null
            : String(rawAffiliateUserId);

    if (affiliateUserId && affiliateUserId === id) {
        return res.status(400).json({ message: "User cannot refer themselves" });
    }

    const sb = createAdminSupabase();

    if (affiliateUserId) {
        const { data: referrerProfile, error: referrerError } = await sb
            .from("profiles")
            .select("id, is_affiliate")
            .eq("id", affiliateUserId)
            .single();

        if (referrerError) {
            return res.status(400).json({ message: "Affiliate account not found" });
        }

        if (!referrerProfile?.is_affiliate) {
            return res
                .status(400)
                .json({ message: "Selected user is not an affiliate" });
        }
    }

    const { data: updatedProfile, error: updateError } = await sb
        .from("profiles")
        .update({ referred_by_affiliate_id: affiliateUserId })
        .eq("id", id)
        .select("id, referred_by_affiliate_id")
        .single();

    if (updateError) {
        return res.status(500).json({ message: updateError.message });
    }

    res.json({
        success: true,
        referred_by_affiliate_id: updatedProfile?.referred_by_affiliate_id ?? null,
    });
});

/**
 * POST /api/admin/migrate-colors - Run color migration
 */
router.post("/api/admin/migrate-colors", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    try {
        const { error: error1 } = await sb.rpc("exec", {
            sql: "ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;",
        });

        const { data: columns, error: checkError } = await sb
            .from("information_schema.columns")
            .select("is_nullable")
            .eq("table_schema", "public")
            .eq("table_name", "brands")
            .eq("column_name", "color_3")
            .single();

        if (checkError) {
            console.log("Check error (may be expected):", checkError.message);
        }

        res.json({
            success: true,
            message:
                "Migration attempted. If color_4 column was added successfully, the app is ready.",
            color_3_nullable: columns?.is_nullable,
            note: "If color_3 is still NOT NULL, run this SQL in Supabase Dashboard: ALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;",
        });
    } catch (err: any) {
        res.status(500).json({
            message: err.message,
            note: "Please run this SQL manually in Supabase Dashboard SQL Editor:\n\nALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;\nALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;",
        });
    }
});

export default router;
