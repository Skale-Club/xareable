import type { Request } from "express";
import { createAdminSupabase } from "./supabase";

const NOINDEX_PATH_PREFIXES = [
  "/admin",
  "/affiliate",
  "/credits",
  "/dashboard",
  "/login",
  "/onboarding",
  "/posts",
  "/settings",
];

type IndexSeoSettings = {
  app_name: string;
  app_description: string | null;
  favicon_url: string | null;
  logo_url: string | null;
  primary_color: string;
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
};

const DEFAULT_INDEX_SEO_SETTINGS: IndexSeoSettings = {
  app_name: "",
  app_description: null,
  favicon_url: null,
  logo_url: null,
  primary_color: "#8b5cf6",
  meta_title: null,
  meta_description: null,
  og_image_url: null,
};

function buildPageTitle(pageTitle: string, appName: string) {
  const normalizedPageTitle = pageTitle.trim();
  const normalizedAppName = appName.trim();

  if (normalizedPageTitle && normalizedAppName) {
    return `${normalizedPageTitle} | ${normalizedAppName}`;
  }

  return normalizedPageTitle || normalizedAppName;
}

function toAbsoluteUrl(value: string | null | undefined, origin: string) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsonForHtml(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function getSiteOrigin(req: Request) {
  const forwardedHost = req.get("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = (forwardedProto || req.protocol || "https").split(",")[0].trim();

  if (!host) {
    return "https://localhost";
  }

  return `${protocol}://${host}`;
}

function getPageTitle(pathname: string, settings: IndexSeoSettings) {
  const appName = settings.app_name.trim();

  if (pathname === "/") {
    return settings.meta_title || appName;
  }

  if (pathname.startsWith("/privacy")) {
    return buildPageTitle("Privacy Policy", appName);
  }

  if (pathname.startsWith("/terms")) {
    return buildPageTitle("Terms of Service", appName);
  }

  if (pathname.startsWith("/login")) {
    return buildPageTitle("Sign In", appName);
  }

  if (pathname.startsWith("/settings")) {
    return buildPageTitle("Settings", appName);
  }

  if (pathname.startsWith("/credits")) {
    return buildPageTitle("Credits", appName);
  }

  if (pathname.startsWith("/affiliate")) {
    return buildPageTitle("Affiliate", appName);
  }

  if (pathname.startsWith("/admin")) {
    return buildPageTitle("Admin", appName);
  }

  if (pathname.startsWith("/onboarding")) {
    return buildPageTitle("Onboarding", appName);
  }

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/posts")) {
    return buildPageTitle("Dashboard", appName);
  }

  return buildPageTitle("Page Not Found", appName);
}

function getPageDescription(pathname: string, settings: IndexSeoSettings) {
  if (pathname === "/") {
    return settings.meta_description || settings.app_description || "";
  }

  if (pathname.startsWith("/privacy")) {
    return "Read how we collect, use, store, and protect information when you use this service.";
  }

  if (pathname.startsWith("/terms")) {
    return "Review the terms that govern access to and use of this service.";
  }

  return settings.app_description || settings.meta_description || "";
}

async function getIndexSeoSettings(): Promise<IndexSeoSettings> {
  const sb = createAdminSupabase();

  if (!sb) {
    return DEFAULT_INDEX_SEO_SETTINGS;
  }

  const [{ data: settings }, { data: landingContent }] = await Promise.all([
    sb
      .from("app_settings")
      .select("app_name, app_description, favicon_url, logo_url, primary_color, meta_title, meta_description, og_image_url")
      .single(),
    sb.from("landing_content").select("icon_url").single(),
  ]);

  return {
    ...DEFAULT_INDEX_SEO_SETTINGS,
    ...(settings || {}),
    favicon_url:
      landingContent?.icon_url ||
      settings?.favicon_url ||
      DEFAULT_INDEX_SEO_SETTINGS.favicon_url,
  };
}

export function shouldNoIndex(pathname: string) {
  return NOINDEX_PATH_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function renderIndexHtml(template: string, req: Request) {
  const pathname = req.path || "/";
  const origin = getSiteOrigin(req);
  const settings = await getIndexSeoSettings();
  const title = getPageTitle(pathname, settings);
  const description = getPageDescription(pathname, settings);
  const canonicalUrl = new URL(pathname, origin).toString();
  const faviconUrl =
    toAbsoluteUrl(settings.favicon_url, origin) ||
    toAbsoluteUrl("/favicon.png", origin) ||
    "";
  const imageUrl =
    toAbsoluteUrl(settings.og_image_url, origin) ||
    toAbsoluteUrl(settings.logo_url, origin) ||
    faviconUrl;
  const robots = shouldNoIndex(pathname)
    ? "noindex, nofollow, noarchive"
    : "index, follow, max-image-preview:large";
  const twitterCard = imageUrl ? "summary_large_image" : "summary";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    ...(settings.app_name ? { name: settings.app_name } : {}),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    ...(description ? { description } : {}),
    ...(imageUrl ? { image: imageUrl } : {}),
    url: origin,
  };

  const replacements: Array<[string, string]> = [
    ["__SEO_TITLE__", escapeHtml(title)],
    ["__SEO_DESCRIPTION__", escapeHtml(description)],
    ["__SEO_ROBOTS__", escapeHtml(robots)],
    ["__SEO_APP_NAME__", escapeHtml(settings.app_name)],
    ["__SEO_THEME_COLOR__", escapeHtml(settings.primary_color || "#8b5cf6")],
    ["__SEO_OG_TITLE__", escapeHtml(title)],
    ["__SEO_OG_DESCRIPTION__", escapeHtml(description)],
    ["__SEO_OG_URL__", escapeHtml(canonicalUrl)],
    ["__SEO_OG_IMAGE__", escapeHtml(imageUrl)],
    ["__SEO_TWITTER_CARD__", escapeHtml(twitterCard)],
    ["__SEO_TWITTER_TITLE__", escapeHtml(title)],
    ["__SEO_TWITTER_DESCRIPTION__", escapeHtml(description)],
    ["__SEO_TWITTER_IMAGE__", escapeHtml(imageUrl)],
    ["__SEO_FAVICON__", escapeHtml(faviconUrl)],
    ["__SEO_STRUCTURED_DATA__", escapeJsonForHtml(structuredData)],
  ];

  let html = template;

  for (const [token, value] of replacements) {
    html = html.replaceAll(token, value);
  }

  return html;
}
