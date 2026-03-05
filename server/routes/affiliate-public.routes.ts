/**
 * Public Affiliate Routes - referral redirect and click tracking
 */

import { Router, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { createAdminSupabase } from "../supabase.js";

const router = Router();

const AFFILIATE_COOKIE_NAME = "aff_ref";
const AFFILIATE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const CODE_REGEX = /^[a-z0-9][a-z0-9_-]{4,63}$/i;

function getCookie(req: Request, name: string): string | null {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;

    const pairs = cookieHeader.split(";");
    for (const pair of pairs) {
        const [rawKey, ...rest] = pair.trim().split("=");
        if (rawKey === name) {
            return decodeURIComponent(rest.join("="));
        }
    }
    return null;
}

function buildAffiliateCookie(value: string): string {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${AFFILIATE_COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${AFFILIATE_COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function normalizeDestination(destination: string | null | undefined): string {
    if (!destination) return "/login?tab=signup";
    const trimmed = destination.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/login?tab=signup";
    return trimmed;
}

function appendRefToDestination(destination: string, affiliateUserId: string): string {
    const url = new URL(destination, "http://localhost");
    if (!url.searchParams.has("ref")) {
        url.searchParams.set("ref", affiliateUserId);
    }
    return `${url.pathname}${url.search}${url.hash}`;
}

function getClientIp(req: Request): string | null {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
        return forwardedFor.split(",")[0].trim();
    }

    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.length > 0) {
        return realIp.trim();
    }

    return req.socket.remoteAddress || null;
}

function hashIp(ip: string | null): string | null {
    if (!ip) return null;
    const salt = process.env.AFFILIATE_IP_HASH_SALT || "affiliate-ip-salt";
    return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * GET /r/:code
 * Registers referral click and redirects to destination
 */
router.get("/r/:code", async (req: Request, res: Response) => {
    const rawCode = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    const code = (rawCode || "").trim().toLowerCase();

    if (!CODE_REGEX.test(code)) {
        res.redirect(302, "/");
        return;
    }

    const sb = createAdminSupabase();
    const { data: link } = await sb
        .from("affiliate_links")
        .select("id, affiliate_user_id, code, destination_url, is_active")
        .eq("code", code)
        .maybeSingle();

    if (!link || !link.is_active) {
        res.redirect(302, "/");
        return;
    }

    const { data: referrerProfile } = await sb
        .from("profiles")
        .select("id, is_affiliate")
        .eq("id", link.affiliate_user_id)
        .maybeSingle();

    if (!referrerProfile?.id || !referrerProfile.is_affiliate) {
        res.redirect(302, "/");
        return;
    }

    const destination = appendRefToDestination(
        normalizeDestination(link.destination_url),
        link.affiliate_user_id,
    );

    // Best effort click tracking; redirect should still happen on failures.
    try {
        await sb
            .from("affiliate_clicks")
            .insert({
                link_id: link.id,
                affiliate_user_id: link.affiliate_user_id,
                code: link.code,
                destination_url: destination,
                ip_hash: hashIp(getClientIp(req)),
                user_agent: req.get("user-agent") || null,
                referrer: req.get("referer") || null,
            });
    } catch (error) {
        console.warn("Failed to track affiliate click:", error);
    }

    res.setHeader("Set-Cookie", buildAffiliateCookie(link.affiliate_user_id));
    res.redirect(302, destination);
});

/**
 * Utility used by authenticated claim endpoint to resolve cookie ref.
 */
export function getAffiliateRefFromCookie(req: Request): string | null {
    const raw = getCookie(req, AFFILIATE_COOKIE_NAME);
    if (!raw) return null;
    return raw;
}

/**
 * Utility used by claim endpoint to clear referral cookie once consumed.
 */
export function clearAffiliateRefCookie(res: Response): void {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.append(
        "Set-Cookie",
        `${AFFILIATE_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`
    );
}

/**
 * Utility used by dashboard endpoint to create unique codes.
 */
export function generateAffiliateCode(): string {
    const charset = "abcdefghjkmnpqrstuvwxyz23456789";
    const bytes = randomBytes(8);
    let suffix = "";
    for (let i = 0; i < bytes.length; i++) {
        suffix += charset[bytes[i] % charset.length];
    }
    return `aff_${suffix}`;
}

export default router;
