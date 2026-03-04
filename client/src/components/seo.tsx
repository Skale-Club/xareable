import { useEffect } from "react";
import { useAppSettings } from "@/lib/app-settings";

type StructuredData = Record<string, unknown> | Array<Record<string, unknown>>;

interface SeoProps {
  title?: string;
  description?: string;
  path?: string;
  image?: string | null;
  favicon?: string | null;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: StructuredData;
}

const STRUCTURED_DATA_ID = "seo-structured-data";
const SEO_PLACEHOLDER_PATTERN = /^_{1,2}SEO_[A-Z0-9_]+_{0,2}$/;

function sanitizeSeoText(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  return SEO_PLACEHOLDER_PATTERN.test(normalized) ? "" : normalized;
}

function upsertMetaByName(name: string, content: string) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertMetaByProperty(property: string, content: string) {
  let tag = document.querySelector(`meta[property="${property}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("property", property);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let tag = document.querySelector(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.setAttribute("rel", rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute("href", href);
}

function getMetaContentByName(name: string) {
  const tag = document.querySelector(`meta[name="${name}"]`);
  return tag?.getAttribute("content") || "";
}

function getMetaContentByProperty(property: string) {
  const tag = document.querySelector(`meta[property="${property}"]`);
  return tag?.getAttribute("content") || "";
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

function updateStructuredData(jsonLd?: StructuredData) {
  const existing = document.getElementById(STRUCTURED_DATA_ID);

  if (!jsonLd) {
    existing?.remove();
    return;
  }

  const script = existing ?? document.createElement("script");
  script.id = STRUCTURED_DATA_ID;
  script.setAttribute("type", "application/ld+json");
  script.textContent = JSON.stringify(jsonLd);

  if (!existing) {
    document.head.appendChild(script);
  }
}

export function buildPageTitle(pageTitle: string, appName: string) {
  const normalizedPageTitle = pageTitle.trim();
  const normalizedAppName = appName.trim();

  if (normalizedPageTitle && normalizedAppName) {
    return `${normalizedPageTitle} | ${normalizedAppName}`;
  }

  return normalizedPageTitle || normalizedAppName;
}

export function Seo({
  title,
  description,
  path,
  image,
  favicon,
  type = "website",
  noindex = false,
  jsonLd,
}: SeoProps) {
  const { settings } = useAppSettings();

  useEffect(() => {
    const currentTitle = sanitizeSeoText(document.title);
    const currentDescription = sanitizeSeoText(
      getMetaContentByName("description") ||
      getMetaContentByProperty("og:description"),
    );
    const appName = sanitizeSeoText(
      settings?.app_name ||
      getMetaContentByName("application-name"),
    );
    const finalTitle = sanitizeSeoText(title) ||
      sanitizeSeoText(settings?.meta_title) ||
      appName ||
      currentTitle;
    const finalDescription = sanitizeSeoText(description) ||
      sanitizeSeoText(settings?.meta_description) ||
      sanitizeSeoText(settings?.app_description) ||
      currentDescription;
    const origin = window.location.origin;
    const canonicalUrl = new URL(path || window.location.pathname, origin).toString();
    const imageUrl =
      toAbsoluteUrl(image, origin) ||
      toAbsoluteUrl(settings?.og_image_url, origin) ||
      toAbsoluteUrl(settings?.logo_url, origin) ||
      toAbsoluteUrl("/favicon.png", origin);
    const faviconUrl =
      toAbsoluteUrl(favicon, origin) ||
      toAbsoluteUrl(settings?.favicon_url, origin) ||
      toAbsoluteUrl("/favicon.png", origin);
    const robots = noindex
      ? "noindex, nofollow, noarchive"
      : "index, follow, max-image-preview:large";
    const twitterCard = imageUrl ? "summary_large_image" : "summary";

    document.title = finalTitle;

    upsertMetaByName("description", finalDescription);
    upsertMetaByName("robots", robots);
    upsertMetaByName("googlebot", robots);
    upsertMetaByName("application-name", appName);
    upsertMetaByName("apple-mobile-web-app-title", appName);

    if (settings?.primary_color) {
      upsertMetaByName("theme-color", settings.primary_color);
    }

    upsertLink("canonical", canonicalUrl);

    // Update favicon dynamically
    if (faviconUrl) {
      upsertLink("icon", faviconUrl);
      upsertLink("apple-touch-icon", faviconUrl);
    }

    upsertMetaByProperty("og:title", finalTitle);
    upsertMetaByProperty("og:description", finalDescription);
    upsertMetaByProperty("og:type", type);
    upsertMetaByProperty("og:url", canonicalUrl);
    upsertMetaByProperty("og:site_name", appName);
    upsertMetaByProperty("og:locale", "en_US");

    if (imageUrl) {
      upsertMetaByProperty("og:image", imageUrl);
    }

    upsertMetaByName("twitter:card", twitterCard);
    upsertMetaByName("twitter:title", finalTitle);
    upsertMetaByName("twitter:description", finalDescription);

    if (imageUrl) {
      upsertMetaByName("twitter:image", imageUrl);
    }

    updateStructuredData(jsonLd);
  }, [
    description,
    image,
    favicon,
    jsonLd,
    noindex,
    path,
    settings,
    title,
    type,
  ]);

  return null;
}
