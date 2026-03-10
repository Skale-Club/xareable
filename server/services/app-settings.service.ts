/**
 * App Settings Service
 * Handles application settings retrieval and validation
 */

import { createAdminSupabase } from "../supabase.js";

/**
 * Default application settings
 */
export const DEFAULT_APP_SETTINGS = {
    app_name: "",
    app_tagline: null as string | null,
    app_description: null as string | null,
    favicon_url: null as string | null,
    logo_url: null as string | null,
    primary_color: "#8b5cf6",
    secondary_color: "#ec4899",
    success_color: "#10b981",
    error_color: "#ef4444",
    meta_title: null as string | null,
    meta_description: null as string | null,
    og_image_url: null as string | null,
    terms_url: null as string | null,
    privacy_url: null as string | null,
    gtm_enabled: false,
    gtm_container_id: null as string | null,
    updated_at: new Date().toISOString(),
};

/**
 * Default landing page content
 */
export const DEFAULT_LANDING_CONTENT = {
    background_variant: "solid" as const,
    hero_headline: "Create and Post Stunning Social Posts in Seconds",
    hero_subtext:
        "Generate brand-consistent social media images and captions with AI. Just type your message, pick a style, and let the AI do the rest.",
    hero_cta_text: "Start Creating for Free",
    hero_secondary_cta_text: "See How It Works",
    hero_image_url: null as string | null,
    features_title: "Everything You Need to Automate Content",
    features_subtitle:
        "From brand setup to publish-ready graphics, every feature is designed to save you time and keep your content on-brand.",
    how_it_works_title: "How It Works",
    how_it_works_subtitle:
        "Three simple steps from idea to publish-ready social media content.",
    testimonials_title: "Loved by Marketers",
    testimonials_subtitle:
        "See what our users are saying about their experience.",
    cta_title: "Ready to Automate Your Content?",
    cta_subtitle:
        "Join thousands of marketers who create branded social media content in seconds, not hours.",
    cta_button_text: "Get Started Free",
    cta_image_url: null as string | null,
    logo_url: null as string | null,
    alt_logo_url: null as string | null,
    icon_url: null as string | null,
};

/**
 * GTM container ID validation regex
 */
const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;

/**
 * Normalize GTM container ID
 */
export function normalizeGtmContainerId(
    value: string | null | undefined
): string | null {
    const trimmed = value?.trim() || "";
    if (!trimmed) {
        return null;
    }
    return trimmed.toUpperCase();
}

/**
 * Validate GTM container ID format
 */
export function isValidGtmContainerId(
    value: string | null | undefined
): boolean {
    if (!value) {
        return false;
    }
    return GTM_CONTAINER_ID_REGEX.test(value.trim());
}

/**
 * Check if error is a singleton conflict error
 */
export function isAppSettingsSingletonConflict(error: any): boolean {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? "").toLowerCase();
    const details = String(error?.details ?? "").toLowerCase();
    const hint = String(error?.hint ?? "").toLowerCase();

    return (
        code === "23505" ||
        message.includes("duplicate key") ||
        message.includes("app_settings_singleton_idx") ||
        details.includes("app_settings_singleton_idx") ||
        hint.includes("app_settings_singleton_idx")
    );
}

/**
 * Get the latest app settings row from the database
 */
export async function getLatestAppSettingsRow(
    selectColumns = "*"
): Promise<Record<string, any> | null> {
    const sb = createAdminSupabase();
    const { data, error } = await sb
        .from("app_settings")
        .select(selectColumns)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1);

    if (error) {
        throw new Error(error.message);
    }

    return data?.[0] || null;
}

/**
 * Get public app settings (safe for frontend consumption)
 */
export async function getPublicAppSettings() {
    const data = await getLatestAppSettingsRow(
        "app_name, app_tagline, app_description, favicon_url, logo_url, primary_color, secondary_color, success_color, error_color, meta_title, meta_description, og_image_url, terms_url, privacy_url, updated_at"
    );

    const sb = createAdminSupabase();
    const { data: landingContent } = await sb
        .from("landing_content")
        .select("icon_url")
        .single();

    return {
        ...DEFAULT_APP_SETTINGS,
        ...(data || {}),
        favicon_url:
            landingContent?.icon_url ||
            data?.favicon_url ||
            DEFAULT_APP_SETTINGS.favicon_url,
    };
}

/**
 * Get site origin from request
 */
export function getSiteOrigin(req: any): string {
    const forwardedHost = req.get("x-forwarded-host");
    const host = forwardedHost || req.get("host");
    const forwardedProto = req.get("x-forwarded-proto");
    const protocol = (forwardedProto || req.protocol || "https")
        .split(",")[0]
        .trim();

    if (!host) {
        return "https://localhost";
    }

    return `${protocol}://${host}`;
}

/**
 * Get request IP address
 */
export function getRequestIp(req: any): string | null {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || null;
}
