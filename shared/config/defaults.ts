/**
 * Centralized configuration defaults
 * Single source of truth for all default values
 */

export const DEFAULT_APP_SETTINGS = {
    app_name: "",
    app_tagline: null as string | null,
    app_description: null as string | null,
    favicon_url: null as string | null,
    logo_url: null as string | null,
    primary_color: "#8b5cf6",
    meta_title: null as string | null,
    meta_description: null as string | null,
    og_image_url: null as string | null,
    terms_url: null as string | null,
    privacy_url: null as string | null,
    gtm_enabled: false,
    gtm_container_id: null as string | null,
    updated_at: new Date().toISOString(),
} as const;

export const DEFAULT_LANDING_CONTENT = {
    hero_headline: "Create and Post Stunning Social Posts in Seconds",
    hero_subtext: "Generate brand-consistent social media images and captions with AI. Just type your message, pick a style, and let the AI do the rest.",
    hero_cta_text: "Start Creating for Free",
    hero_secondary_cta_text: "See How It Works",
    hero_image_url: null as string | null,
    features_title: "Everything You Need to Automate Content",
    features_subtitle: "From brand setup to publish-ready graphics, every feature is designed to save you time and keep your content on-brand.",
    how_it_works_title: "How It Works",
    how_it_works_subtitle: "Three simple steps from idea to publish-ready social media content.",
    testimonials_title: "Loved by Marketers",
    testimonials_subtitle: "See what our users are saying about their experience.",
    cta_title: "Ready to Automate Your Content?",
    cta_subtitle: "Join thousands of marketers who create branded social media content in seconds, not hours.",
    cta_button_text: "Get Started Free",
    cta_image_url: null as string | null,
    logo_url: null as string | null,
    alt_logo_url: null as string | null,
    icon_url: null as string | null,
} as const;

export const DEFAULT_MARKUP_SETTINGS = {
    regularMultiplier: 3,
    affiliateMultiplier: 4,
    minRechargeMicros: 10_000_000, // $10
    defaultAutoRechargeThresholdMicros: 5_000_000, // $5
    defaultAutoRechargeAmountMicros: 10_000_000, // $10
} as const;

// Logo position descriptions for AI prompts
export const LOGO_POSITION_DESCRIPTIONS: Record<string, string> = {
    "top-left": "top-left corner",
    "top-center": "top center",
    "top-right": "top-right corner",
    "middle-left": "middle-left side",
    "middle-center": "center of the image",
    "middle-right": "middle-right side",
    "bottom-left": "bottom-left corner",
    "bottom-center": "bottom center",
    "bottom-right": "bottom-right corner",
};

// Language names for AI prompts
export const LANGUAGE_NAMES: Record<string, string> = {
    en: "English",
    pt: "Brazilian Portuguese (pt-BR)",
    es: "Spanish (es)",
};

// Post format configurations
export const POST_FORMATS = [
    { value: "1:1", label: "Square", subtitle: "Instagram Post" },
    { value: "4:5", label: "Portrait", subtitle: "Instagram Feed" },
    { value: "9:16", label: "Story", subtitle: "Instagram/TikTok" },
    { value: "16:9", label: "Landscape", subtitle: "YouTube/LinkedIn" },
    { value: "2:3", label: "Pinterest", subtitle: "Pin Post" },
    { value: "1200:628", label: "Facebook", subtitle: "Link Preview" },
] as const;

// Logo position options
export const LOGO_POSITIONS = [
    { value: "top-left", label: "Top Left" },
    { value: "top-center", label: "Top Center" },
    { value: "top-right", label: "Top Right" },
    { value: "middle-left", label: "Middle Left" },
    { value: "middle-center", label: "Center" },
    { value: "middle-right", label: "Middle Right" },
    { value: "bottom-left", label: "Bottom Left" },
    { value: "bottom-center", label: "Bottom Center" },
    { value: "bottom-right", label: "Bottom Right" },
] as const;
