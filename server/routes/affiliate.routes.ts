/**
 * Affiliate Routes - affiliate dashboard and Stripe Connect endpoints
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase";
import {
    affiliateDashboardResponseSchema,
    affiliateCommissionHistoryResponseSchema,
    claimAffiliateReferralRequestSchema,
    claimAffiliateReferralResponseSchema,
} from "../../shared/schema";
import {
    authenticateUser,
    AuthenticatedRequest,
} from "../middleware/auth.middleware";
import {
    createStripeConnectAccount,
    createStripeConnectLoginLink,
    syncAffiliateStripeStatus,
} from "../stripe";
import {
    clearAffiliateRefCookie,
    generateAffiliateCode,
    getAffiliateRefFromCookie,
} from "./affiliate-public.routes";

const router = Router();
const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getOrCreateReferralCode(userId: string): Promise<string | null> {
    const sb = createAdminSupabase();

    const { data: existingLink } = await sb
        .from("affiliate_links")
        .select("code")
        .eq("affiliate_user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (existingLink?.code) {
        return existingLink.code;
    }

    for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateAffiliateCode();
        const { data, error } = await sb
            .from("affiliate_links")
            .insert({
                affiliate_user_id: userId,
                code,
                destination_url: "/login?tab=signup",
                is_active: true,
            })
            .select("code")
            .single();

        if (!error && data?.code) {
            return data.code;
        }

        const duplicateCode = typeof error?.message === "string" &&
            error.message.toLowerCase().includes("duplicate");

        if (!duplicateCode) {
            console.warn("Failed to create affiliate link:", error);
            break;
        }
    }

    return null;
}

/**
 * GET /api/affiliate/dashboard
 * Returns affiliate dashboard data and payout status
 */
router.get("/api/affiliate/dashboard", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user } = authResult;
    const sb = createAdminSupabase();

    const { data: profile } = await sb
        .from("profiles")
        .select("is_affiliate")
        .eq("id", user.id)
        .single();

    if (profile?.is_affiliate) {
        try {
            await syncAffiliateStripeStatus(user.id);
        } catch {
            // Best effort sync; keep dashboard available even if Stripe is unavailable.
        }
    }

    const { data: settings } = await sb
        .from("affiliate_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

    const { count: referredUsersCount } = await sb
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("referred_by_affiliate_id", user.id);

    const { count: totalClicks } = await sb
        .from("affiliate_clicks")
        .select("*", { count: "exact", head: true })
        .eq("affiliate_user_id", user.id);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: clicksLast30Days } = await sb
        .from("affiliate_clicks")
        .select("*", { count: "exact", head: true })
        .eq("affiliate_user_id", user.id)
        .gte("clicked_at", thirtyDaysAgo);

    let referralCode: string | null = null;
    if (profile?.is_affiliate) {
        referralCode = await getOrCreateReferralCode(user.id);
    }

    const payload = affiliateDashboardResponseSchema.parse({
        is_affiliate: profile?.is_affiliate === true,
        referral_code: referralCode,
        total_clicks: totalClicks ?? 0,
        clicks_last_30_days: clicksLast30Days ?? 0,
        stripe_connect_account_id: settings?.stripe_connect_account_id ?? null,
        stripe_connect_onboarded: settings?.stripe_connect_onboarded ?? false,
        total_commission_earned_micros: settings?.total_commission_earned_micros ?? 0,
        total_commission_paid_micros: settings?.total_commission_paid_micros ?? 0,
        pending_commission_micros: settings?.pending_commission_micros ?? 0,
        minimum_payout_micros: settings?.minimum_payout_micros ?? 50_000_000,
        auto_payout_enabled: settings?.auto_payout_enabled ?? true,
        referred_users_count: referredUsersCount ?? 0,
    });

    res.json(payload);
});

/**
 * GET /api/affiliate/commissions
 * Returns recent affiliate commission ledger entries (accrual + payout)
 */
router.get("/api/affiliate/commissions", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user } = authResult;
    const sb = createAdminSupabase();

    const { data: profile } = await sb
        .from("profiles")
        .select("is_affiliate")
        .eq("id", user.id)
        .single();

    if (!profile?.is_affiliate) {
        res.status(403).json({ message: "Affiliate access required" });
        return;
    }

    const { data, error } = await sb
        .from("credit_transactions")
        .select("id, created_at, amount_micros, description, stripe_payout_id, metadata")
        .eq("user_id", user.id)
        .eq("type", "affiliate_commission")
        .order("created_at", { ascending: false })
        .limit(50);

    if (error) {
        res.status(500).json({ message: error.message || "Failed to load affiliate commissions" });
        return;
    }

    type LedgerRow = {
        id: string;
        created_at: string;
        amount_micros: number;
        description: string | null;
        stripe_payout_id: string | null;
        metadata: unknown;
    };

    const rows = (data || []) as LedgerRow[];

    const transactions = rows.map((row) => {
        const metadataObj =
            row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : null;
        const sourceUserIdValue = metadataObj?.source_user_id;
        const sourceUserId = typeof sourceUserIdValue === "string" && UUID_REGEX.test(sourceUserIdValue)
            ? sourceUserIdValue
            : null;
        const kind = row.amount_micros < 0 || !!row.stripe_payout_id ? "payout" : "accrual";

        return {
            id: row.id,
            created_at: row.created_at,
            amount_micros: row.amount_micros,
            description: row.description,
            stripe_payout_id: row.stripe_payout_id,
            source_user_id: sourceUserId,
            kind,
        };
    });

    res.json(
        affiliateCommissionHistoryResponseSchema.parse({
            transactions,
        })
    );
});

/**
 * POST /api/affiliate/connect
 * Creates or resumes Stripe Connect onboarding for affiliate users
 */
router.post("/api/affiliate/connect", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;

    const { data: profile } = await supabase
        .from("profiles")
        .select("is_affiliate")
        .eq("id", user.id)
        .single();

    if (!profile?.is_affiliate) {
        res.status(403).json({ message: "Affiliate access required" });
        return;
    }

    try {
        const url = await createStripeConnectAccount(user.id, user.email || "");
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ message: error.message || "Failed to create Stripe Connect onboarding link" });
    }
});

/**
 * GET /api/affiliate/connect/login
 * Creates a Stripe Express dashboard login link for affiliates
 */
router.get("/api/affiliate/connect/login", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user } = authResult;

    try {
        const url = await createStripeConnectLoginLink(user.id);
        res.json({ url });
    } catch (error: any) {
        res.status(400).json({ message: error.message || "Affiliate Stripe dashboard unavailable" });
    }
});

/**
 * POST /api/affiliate/claim
 * Claims an affiliate referrer for the current user exactly once
 */
router.post("/api/affiliate/claim", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const parseResult = claimAffiliateReferralRequestSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid referral payload" });
        return;
    }

    const { user } = authResult;
    const bodyRef = parseResult.data.ref ?? null;
    const cookieRef = getAffiliateRefFromCookie(req);
    const ref = bodyRef || cookieRef;
    const sb = createAdminSupabase();

    if (!ref || !UUID_REGEX.test(ref)) {
        res.json(
            claimAffiliateReferralResponseSchema.parse({
                claimed: false,
                reason: "no_ref",
                referred_by_affiliate_id: null,
            })
        );
        return;
    }

    if (ref === user.id) {
        clearAffiliateRefCookie(res);
        res.json(
            claimAffiliateReferralResponseSchema.parse({
                claimed: false,
                reason: "self_referral",
                referred_by_affiliate_id: null,
            })
        );
        return;
    }

    const { data: currentProfile } = await sb
        .from("profiles")
        .select("referred_by_affiliate_id")
        .eq("id", user.id)
        .single();

    if (currentProfile?.referred_by_affiliate_id) {
        clearAffiliateRefCookie(res);
        res.json(
            claimAffiliateReferralResponseSchema.parse({
                claimed: false,
                reason: "already_referred",
                referred_by_affiliate_id: currentProfile.referred_by_affiliate_id,
            })
        );
        return;
    }

    const { data: referrerProfile } = await sb
        .from("profiles")
        .select("id, is_affiliate")
        .eq("id", ref)
        .maybeSingle();

    if (!referrerProfile?.id || !referrerProfile.is_affiliate) {
        clearAffiliateRefCookie(res);
        res.json(
            claimAffiliateReferralResponseSchema.parse({
                claimed: false,
                reason: "invalid_referrer",
                referred_by_affiliate_id: null,
            })
        );
        return;
    }

    const { data: updatedProfile, error: updateError } = await sb
        .from("profiles")
        .update({ referred_by_affiliate_id: ref })
        .eq("id", user.id)
        .is("referred_by_affiliate_id", null)
        .select("referred_by_affiliate_id")
        .single();

    if (updateError || !updatedProfile) {
        clearAffiliateRefCookie(res);
        const { data: latestProfile } = await sb
            .from("profiles")
            .select("referred_by_affiliate_id")
            .eq("id", user.id)
            .single();

        res.json(
            claimAffiliateReferralResponseSchema.parse({
                claimed: false,
                reason: "already_referred",
                referred_by_affiliate_id: latestProfile?.referred_by_affiliate_id ?? null,
            })
        );
        return;
    }

    clearAffiliateRefCookie(res);
    res.json(
        claimAffiliateReferralResponseSchema.parse({
            claimed: true,
            reason: "claimed",
            referred_by_affiliate_id: updatedProfile.referred_by_affiliate_id,
        })
    );
});

export default router;
