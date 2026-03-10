/**
 * Affiliate Routes - affiliate dashboard and Stripe Connect endpoints
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase.js";
import {
    affiliateDashboardResponseSchema,
    affiliateReferredAccountsResponseSchema,
    affiliateCommissionHistoryResponseSchema,
    claimAffiliateReferralRequestSchema,
    claimAffiliateReferralResponseSchema,
    updateAffiliateReferralCodeRequestSchema,
    updateAffiliateReferralCodeResponseSchema,
} from "../../shared/schema.js";
import {
    authenticateUser,
    AuthenticatedRequest,
} from "../middleware/auth.middleware.js";
import {
    createStripeConnectAccount,
    createStripeConnectLoginLink,
    syncAffiliateStripeStatus,
} from "../stripe.js";
import {
    clearAffiliateRefCookie,
    generateAffiliateCode,
    getAffiliateRefFromCookie,
} from "./affiliate-public.routes.js";

const router = Router();
const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERRAL_CODE_REGEX = /^[a-z0-9][a-z0-9_-]{4,63}$/i;
const MAX_REFERRAL_CODE_LENGTH = 64;
const REFERRAL_DESTINATION_URL = "/login?tab=signup";

function isDuplicateKeyError(error: unknown): boolean {
    const err = error as { code?: string; message?: string } | null;
    if (!err) return false;

    if (err.code === "23505") {
        return true;
    }

    return typeof err.message === "string" && err.message.toLowerCase().includes("duplicate");
}

function slugifyReferralCodeBase(companyName: string | null | undefined): string {
    const ascii = String(companyName || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "");

    let base = ascii
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");

    if (!base) {
        base = "affiliate";
    }

    if (!/^[a-z0-9]/.test(base)) {
        base = `a-${base}`;
    }

    if (base.length < 5) {
        base = `${base}-ref`;
    }

    if (base.length > MAX_REFERRAL_CODE_LENGTH) {
        base = base.slice(0, MAX_REFERRAL_CODE_LENGTH).replace(/[-_]+$/g, "");
    }

    if (base.length < 5) {
        base = `${base}${"0".repeat(5 - base.length)}`;
    }

    if (!REFERRAL_CODE_REGEX.test(base)) {
        return "affiliate";
    }

    return base;
}

function buildReferralCodeCandidate(baseCode: string, attempt: number): string {
    if (attempt === 0) {
        return baseCode;
    }

    const suffix = `-${attempt + 1}`;
    const maxBaseLength = Math.max(1, MAX_REFERRAL_CODE_LENGTH - suffix.length);
    const trimmedBase = baseCode.slice(0, maxBaseLength).replace(/[-_]+$/g, "");
    return `${trimmedBase}${suffix}`;
}

async function createAffiliateLinkWithPreferredCode(userId: string, preferredBaseCode: string): Promise<string | null> {
    const sb = createAdminSupabase();

    for (let attempt = 0; attempt < 25; attempt++) {
        const code = buildReferralCodeCandidate(preferredBaseCode, attempt);
        if (!REFERRAL_CODE_REGEX.test(code)) {
            continue;
        }

        const { data, error } = await sb
            .from("affiliate_links")
            .insert({
                affiliate_user_id: userId,
                code,
                destination_url: REFERRAL_DESTINATION_URL,
                is_active: true,
            })
            .select("code")
            .single();

        if (!error && data?.code) {
            return data.code;
        }

        if (!isDuplicateKeyError(error)) {
            console.warn("Failed to create affiliate link with preferred code:", error);
            break;
        }
    }

    for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateAffiliateCode();
        const { data, error } = await sb
            .from("affiliate_links")
            .insert({
                affiliate_user_id: userId,
                code,
                destination_url: REFERRAL_DESTINATION_URL,
                is_active: true,
            })
            .select("code")
            .single();

        if (!error && data?.code) {
            return data.code;
        }

        if (!isDuplicateKeyError(error)) {
            console.warn("Failed to create affiliate link fallback:", error);
            break;
        }
    }

    return null;
}

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

    const { data: brand } = await sb
        .from("brands")
        .select("company_name")
        .eq("user_id", userId)
        .maybeSingle();

    const preferredBaseCode = slugifyReferralCodeBase(brand?.company_name ?? null);
    return createAffiliateLinkWithPreferredCode(userId, preferredBaseCode);
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
        commission_share_percent: Number(settings?.commission_share_percent ?? 50),
        minimum_payout_micros: settings?.minimum_payout_micros ?? 50_000_000,
        auto_payout_enabled: settings?.auto_payout_enabled ?? true,
        referred_users_count: referredUsersCount ?? 0,
    });

    res.json(payload);
});

/**
 * GET /api/affiliate/referred-users
 * Returns accounts currently linked to the affiliate
 */
router.get("/api/affiliate/referred-users", async (req: Request, res: Response): Promise<void> => {
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

    const { data: referredProfiles, error: profilesError } = await sb
        .from("profiles")
        .select("id, email, created_at")
        .eq("referred_by_affiliate_id", user.id)
        .order("created_at", { ascending: false });

    if (profilesError) {
        res.status(500).json({ message: profilesError.message || "Failed to load referred accounts" });
        return;
    }

    const referredRows = referredProfiles || [];
    const referredUserIds = referredRows.map((item) => item.id);

    const brandByUserId = new Map<string, { company_name: string | null; company_type: string | null }>();
    if (referredUserIds.length > 0) {
        const { data: brands, error: brandsError } = await sb
            .from("brands")
            .select("user_id, company_name, company_type")
            .in("user_id", referredUserIds);

        if (brandsError) {
            res.status(500).json({ message: brandsError.message || "Failed to load referred account brands" });
            return;
        }

        for (const brand of brands || []) {
            brandByUserId.set(brand.user_id, {
                company_name: brand.company_name ?? null,
                company_type: brand.company_type ?? null,
            });
        }
    }

    const accounts = referredRows.map((item) => {
        const brand = brandByUserId.get(item.id);
        return {
            id: item.id,
            email: item.email ?? null,
            company_name: brand?.company_name ?? null,
            company_type: brand?.company_type ?? null,
            created_at: item.created_at,
        };
    });

    res.json(
        affiliateReferredAccountsResponseSchema.parse({
            accounts,
            total_count: accounts.length,
        })
    );
});

/**
 * PATCH /api/affiliate/referral-code
 * Updates the active referral code for affiliate users
 */
router.patch("/api/affiliate/referral-code", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const parseResult = updateAffiliateReferralCodeRequestSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid referral code payload" });
        return;
    }

    const referralCode = parseResult.data.referral_code.trim().toLowerCase();
    if (!REFERRAL_CODE_REGEX.test(referralCode)) {
        res.status(400).json({ message: "Invalid referral code format" });
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

    const { data: activeLink } = await sb
        .from("affiliate_links")
        .select("id, code")
        .eq("affiliate_user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (activeLink?.code?.toLowerCase() === referralCode) {
        res.json(
            updateAffiliateReferralCodeResponseSchema.parse({
                referral_code: referralCode,
            })
        );
        return;
    }

    if (activeLink?.id) {
        await sb
            .from("affiliate_links")
            .update({ is_active: false })
            .eq("affiliate_user_id", user.id)
            .eq("is_active", true)
            .neq("id", activeLink.id);

        const { data: updatedLink, error: updateError } = await sb
            .from("affiliate_links")
            .update({
                code: referralCode,
                is_active: true,
            })
            .eq("id", activeLink.id)
            .eq("affiliate_user_id", user.id)
            .select("code")
            .single();

        if (updateError || !updatedLink?.code) {
            if (isDuplicateKeyError(updateError)) {
                res.status(409).json({ message: "Referral code is already in use" });
                return;
            }

            res.status(500).json({ message: updateError?.message || "Failed to update referral code" });
            return;
        }

        res.json(
            updateAffiliateReferralCodeResponseSchema.parse({
                referral_code: updatedLink.code.toLowerCase(),
            })
        );
        return;
    }

    const { data: insertedLink, error: insertError } = await sb
        .from("affiliate_links")
        .insert({
            affiliate_user_id: user.id,
            code: referralCode,
            destination_url: REFERRAL_DESTINATION_URL,
            is_active: true,
        })
        .select("code")
        .single();

    if (insertError || !insertedLink?.code) {
        if (isDuplicateKeyError(insertError)) {
            res.status(409).json({ message: "Referral code is already in use" });
            return;
        }

        res.status(500).json({ message: insertError?.message || "Failed to create referral code" });
        return;
    }

    res.json(
        updateAffiliateReferralCodeResponseSchema.parse({
            referral_code: insertedLink.code.toLowerCase(),
        })
    );
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
