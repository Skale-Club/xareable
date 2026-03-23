/**
 * SEO Routes - Robots.txt, Sitemap, and Web Manifest
 * Handles public SEO-related endpoints
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase.js";
import { DEFAULT_APP_SETTINGS, DEFAULT_LANDING_CONTENT } from "../../shared/config/defaults.js";
import sharp from "sharp";

const router = Router();

async function getLatestAppSettingsRow(
    sb: ReturnType<typeof createAdminSupabase>,
    selectColumns: string,
): Promise<Record<string, any> | null> {
    const { data, error } = await sb
        .from("app_settings")
        .select(selectColumns)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1);

    if (error) {
        throw new Error(error.message);
    }

    return data?.[0] ?? null;
}

/**
 * Get the site origin from request headers
 */
function getSiteOrigin(req: Request): string {
    const forwardedHost = req.get("x-forwarded-host");
    const host = forwardedHost || req.get("host");
    const forwardedProto = req.get("x-forwarded-proto");
    const protocol = (forwardedProto || req.protocol || "https").split(",")[0].trim();

    if (!host) {
        return "https://localhost";
    }

    return `${protocol}://${host}`;
}

/**
 * Get public app settings from database
 */
async function getPublicAppSettings() {
    const sb = createAdminSupabase();
    const data = await getLatestAppSettingsRow(
        sb,
        "app_name, app_tagline, app_description, favicon_url, logo_url, primary_color, meta_title, meta_description, og_image_url, terms_url, privacy_url, updated_at",
    );
    const { data: landingContent } = await sb
        .from("landing_content")
        .select("icon_url")
        .single();

    return {
        ...DEFAULT_APP_SETTINGS,
        ...(data || {}),
        favicon_url: landingContent?.icon_url || data?.favicon_url || DEFAULT_APP_SETTINGS.favicon_url,
    };
}

/**
 * GET /robots.txt
 * Returns robots.txt for search engine crawlers
 */
router.get("/robots.txt", async (req: Request, res: Response) => {
    const origin = getSiteOrigin(req);
    const lines = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /admin",
        "Disallow: /affiliate",
        "Disallow: /credits",
        "Disallow: /dashboard",
        "Disallow: /login",
        "Disallow: /onboarding",
        "Disallow: /posts",
        "Disallow: /settings",
        `Sitemap: ${origin}/sitemap.xml`,
    ];

    res.type("text/plain").send(lines.join("\n"));
});

/**
 * GET /sitemap.xml
 * Returns XML sitemap for search engines
 */
router.get("/sitemap.xml", async (req: Request, res: Response) => {
    const origin = getSiteOrigin(req);
    const settings = await getPublicAppSettings();
    const sb = createAdminSupabase();
    const { data: landingContent } = await sb
        .from("landing_content")
        .select("updated_at")
        .single();

    const publicUrls = [
        {
            loc: `${origin}/`,
            lastmod: landingContent?.updated_at || settings.updated_at,
            changefreq: "weekly",
            priority: "1.0",
        },
        {
            loc: `${origin}/privacy`,
            lastmod: settings.updated_at,
            changefreq: "monthly",
            priority: "0.4",
        },
        {
            loc: `${origin}/terms`,
            lastmod: settings.updated_at,
            changefreq: "monthly",
            priority: "0.4",
        },
    ];

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...publicUrls.map(
            (entry) => [
                "  <url>",
                `    <loc>${entry.loc}</loc>`,
                `    <lastmod>${entry.lastmod}</lastmod>`,
                `    <changefreq>${entry.changefreq}</changefreq>`,
                `    <priority>${entry.priority}</priority>`,
                "  </url>",
            ].join("\n"),
        ),
        "</urlset>",
    ].join("\n");

    res.type("application/xml").send(xml);
});

/**
 * GET /pwa-icon/:size.png
 * Fetches the admin favicon and resizes it to the requested PWA icon size
 */
router.get("/pwa-icon/:size.png", async (req: Request, res: Response) => {
    const sizeParam = req.params.size;
    const size = parseInt(Array.isArray(sizeParam) ? sizeParam[0] : sizeParam, 10);
    if (![192, 512].includes(size)) {
        res.status(400).send("Invalid size");
        return;
    }

    const settings = await getPublicAppSettings();
    const faviconUrl = settings.favicon_url;
    if (!faviconUrl) {
        res.status(404).send("No favicon configured");
        return;
    }

    const response = await fetch(faviconUrl);
    if (!response.ok) {
        res.status(502).send("Failed to fetch favicon");
        return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const resized = await sharp(buffer)
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    res.set("Cache-Control", "public, max-age=86400").type("image/png").send(resized);
});

/**
 * GET /site.webmanifest
 * Returns web app manifest for PWA support
 */
router.get("/site.webmanifest", async (_req: Request, res: Response) => {
    const settings = await getPublicAppSettings();
    const manifest = {
        name: settings.app_name,
        short_name: settings.app_name,
        description:
            settings.app_description ||
            settings.app_tagline ||
            settings.meta_description,
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: settings.primary_color || DEFAULT_APP_SETTINGS.primary_color,
        icons: [
            {
                src: "/pwa-icon/192.png",
                sizes: "192x192",
                type: "image/png",
            },
            {
                src: "/pwa-icon/512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "any maskable",
            },
        ],
    };

    res
        .type("application/manifest+json")
        .send(JSON.stringify(manifest, null, 2));
});

export default router;
