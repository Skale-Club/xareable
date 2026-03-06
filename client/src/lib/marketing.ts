/**
 * Client-side marketing utilities for Facebook Conversions API
 * 
 * This module provides helpers for:
 * - Capturing Facebook Click ID (fbc) from URL parameters
 * - Capturing Facebook Browser ID (fbp) from cookies
 * - Sending ViewContent events for post views
 */

/**
 * Get Facebook Click ID (fbc) from URL fbclid parameter or cookie
 * The fbc parameter is set when a user clicks on a Facebook ad
 */
export function getFacebookClickId(): string | null {
    // Check URL for fbclid parameter first
    const urlParams = new URLSearchParams(window.location.search);
    const fbclid = urlParams.get("fbclid");
    if (fbclid) {
        // Store in cookie for 90 days (Facebook recommendation)
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 90);
        document.cookie = `_fbc=${fbclid}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`;
        return `fb.1.${Date.now()}.${fbclid}`;
    }

    // Check cookie for existing fbc
    const fbcCookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith("_fbc="))
        ?.split("=")[1];

    if (fbcCookie) {
        return `fb.1.${Date.now()}.${fbcCookie}`;
    }

    return null;
}

/**
 * Get Facebook Browser ID (fbp) from cookie or generate new one
 * The fbp cookie identifies a browser across sessions
 */
export function getFacebookBrowserId(): string | null {
    // Check for existing fbp cookie
    const fbpCookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith("_fbp="))
        ?.split("=")[1];

    if (fbpCookie) {
        return fbpCookie;
    }

    // Generate new fbp if not present
    // Format: fb.{version}.{timestamp}.{random}
    const random = Math.random().toString(36).substring(2, 10);
    const fbp = `fb.1.${Date.now()}.${random}`;

    // Store in cookie for 2 years
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 2);
    document.cookie = `_fbp=${fbp}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`;

    return fbp;
}

/**
 * Get all Facebook tracking parameters for server-side events
 */
export function getFacebookTrackingParams(): {
    fbc: string | null;
    fbp: string | null;
} {
    return {
        fbc: getFacebookClickId(),
        fbp: getFacebookBrowserId(),
    };
}

/**
 * Track a ViewContent event for post viewing
 * This should be called when a user views a post in detail
 */
export async function trackViewContentEvent(params: {
    post_id: string;
    content_type?: string;
    content_name?: string;
}): Promise<void> {
    const { fbc, fbp } = getFacebookTrackingParams();

    try {
        const sb = (await import("./supabase")).supabase();
        const { data: { session } } = await sb.auth.getSession();

        // Only track if user is authenticated
        if (!session) return;

        await fetch("/api/marketing/view-content", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                post_id: params.post_id,
                content_type: params.content_type,
                content_name: params.content_name,
                fbc,
                fbp,
            }),
        });
    } catch (error) {
        // Silently fail - tracking should not interrupt user experience
        console.debug("ViewContent tracking failed:", error);
    }
}

/**
 * Track a Lead event (e.g., when user completes onboarding)
 */
export async function trackLeadEvent(params: {
    content_name?: string;
    content_category?: string;
    phone?: string;
    full_name?: string;
    company_name?: string;
    company_type?: string;
    answers?: Record<string, string>;
}): Promise<void> {
    const { fbc, fbp } = getFacebookTrackingParams();

    try {
        const sb = (await import("./supabase")).supabase();
        const { data: { session } } = await sb.auth.getSession();

        if (!session) return;

        await fetch("/api/marketing/lead", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                content_name: params.content_name,
                content_category: params.content_category,
                phone: params.phone,
                full_name: params.full_name,
                company_name: params.company_name,
                company_type: params.company_type,
                answers: params.answers,
                fbc,
                fbp,
            }),
        });
    } catch (error) {
        console.debug("Lead tracking failed:", error);
    }
}

/**
 * Track an InitiateCheckout event (e.g., when user opens credit purchase dialog)
 */
export async function trackInitiateCheckoutEvent(params: {
    value?: number;
    currency?: string;
    content_name?: string;
}): Promise<void> {
    const { fbc, fbp } = getFacebookTrackingParams();

    try {
        const sb = (await import("./supabase")).supabase();
        const { data: { session } } = await sb.auth.getSession();

        if (!session) return;

        await fetch("/api/marketing/initiate-checkout", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                value: params.value,
                currency: params.currency || "USD",
                content_name: params.content_name,
                fbc,
                fbp,
            }),
        });
    } catch (error) {
        console.debug("InitiateCheckout tracking failed:", error);
    }
}
