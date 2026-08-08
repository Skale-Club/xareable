/**
 * Routes Index - Aggregates all route modules
 * This is the main entry point for registering all API routes
 */

import { Router } from "express";
import helmet from "helmet";
import cors from "cors";

// Import all route modules
import healthRoutes from "./health.routes.js";
import seoRoutes from "./seo.routes.js";
import configRoutes from "./config.routes.js";
import postsRoutes from "./posts.routes.js";
import trashRoutes from "./trash.routes.js";
import styleCatalogRoutes from "./style-catalog.routes.js";
import generateRoutes from "./generate.routes.js";
import affiliateRoutes from "./affiliate.routes.js";
import affiliatePublicRoutes from "./affiliate-public.routes.js";
import markupRoutes from "./markup.routes.js";
import creditsRoutes from "./credits.routes.js";
import translateRoutes from "./translate.routes.js";
import transcribeRoutes from "./transcribe.routes.js";
import stripeRoutes from "./stripe.routes.js";
import integrationsRoutes from "./integrations.routes.js";
import brandReferencesRoutes from "./brand-references.routes.js";
import styleReferencesRoutes from "./style-references.routes.js";
import uploadsRoutes from "./uploads.routes.js";
import billingRoutes from "./billing.routes.js";
import internalCronRouter from "./internal-cron.routes.js";
import socialRoutes from "./social.routes.js";
import adminSocialRoutes from "./admin-social.routes.js";
import autopostRoutes from "./autopost.routes.js";

// New route modules
import adminRoutes from "./admin.routes.js";
import adminGenerationsRoutes from "./admin-generations.routes.js";
import adminQualityRoutes from "./admin-quality.routes.js";
import adminSettingsRoutes from "./admin-settings.routes.js";
import landingRoutes from "./landing.routes.js";
import settingsRoutes from "./settings.routes.js";
import editRoutes from "./edit.routes.js";

// v1.1 media creation routes
import carouselRoutes from "./carousel.routes.js";
import enhanceRoutes from "./enhance.routes.js";

// Re-export for convenience
export { getStyleCatalogPayload } from "./style-catalog.routes.js";

/**
 * Resolve the CORS allow-list. Honours ALLOWED_ORIGINS (comma-separated) and
 * always includes the production domains + local dev. Requests without an
 * Origin header (curl, server-to-server, health checks) are unaffected.
 */
function resolveCorsOrigins(): string[] {
    const raw = process.env.ALLOWED_ORIGINS?.trim();
    if (raw) {
        const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length > 0) return list;
    }
    const origins = [
        "http://localhost:5000",
        "http://localhost:5173",
        "https://xareable.com",
        "https://www.xareable.com",
    ];
    const appUrl = process.env.APP_URL?.trim();
    if (appUrl) origins.push(appUrl.replace(/\/$/, ""));
    return origins;
}

/**
 * Create and configure the main router with all route modules
 */
export function createApiRouter(): Router {
    const router = Router();

    // --- Security middleware ---
    // Applied here (not in each entry file) so BOTH entry points that build
    // this router — server/index.ts and api/handler.ts — are covered.
    router.use(
        helmet({
            // CSP is disabled: the SPA loads images from Supabase Storage,
            // Stripe.js, GA/GTM, etc. A meaningful policy needs its own pass;
            // meanwhile the high-value headers (nosniff, frameguard,
            // referrer-policy, HSTS) ship now.
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false,
            // Storage/CDN assets are fetched cross-origin by the SPA.
            crossOriginResourcePolicy: false,
        }),
    );
    router.use(cors({ origin: resolveCorsOrigins(), credentials: false }));

    // Core routes
    router.use(healthRoutes);
    router.use(seoRoutes);
    router.use(configRoutes);
    router.use(postsRoutes);
    router.use(trashRoutes);
    router.use(styleCatalogRoutes);
    router.use(generateRoutes);
    router.use(editRoutes);
    router.use(carouselRoutes);
    router.use(enhanceRoutes);

    // Translation and transcription
    router.use(translateRoutes);
    router.use(transcribeRoutes);

    // Billing and credits
    router.use(creditsRoutes);
    router.use(billingRoutes);
    router.use(stripeRoutes);

    // Internal cron HTTP triggers (Phase 14)
    router.use(internalCronRouter);

    // Affiliate system
    router.use(affiliatePublicRoutes);
    router.use(affiliateRoutes);

    // Admin routes (split by domain — SEED-004)
    router.use(adminRoutes);
    router.use(adminGenerationsRoutes);
    router.use(adminQualityRoutes);
    router.use(adminSettingsRoutes);
    router.use(landingRoutes);
    router.use(settingsRoutes);

    // Integrations
    router.use(markupRoutes);
    router.use(integrationsRoutes);
    router.use(socialRoutes);
    router.use(adminSocialRoutes);
    router.use(autopostRoutes);

    // Brand references (Phase 18) + platform style reference boards (Phase 25)
    router.use(brandReferencesRoutes);
    router.use(styleReferencesRoutes);

    // Presigned / proxied browser uploads (R2 migration)
    router.use(uploadsRoutes);

    return router;
}

// Export individual route modules for selective registration
export {
    // Core routes
    seoRoutes,
    configRoutes,
    postsRoutes,
    trashRoutes,
    styleCatalogRoutes,
    generateRoutes,
    editRoutes,
    carouselRoutes,
    enhanceRoutes,
    // Translation and transcription
    translateRoutes,
    transcribeRoutes,
    // Billing and credits
    creditsRoutes,
    billingRoutes,
    // Internal cron triggers
    internalCronRouter,
    stripeRoutes,
    // Affiliate system
    affiliatePublicRoutes,
    affiliateRoutes,
    // Admin routes
    adminRoutes,
    landingRoutes,
    settingsRoutes,
    // Integrations
    markupRoutes,
    integrationsRoutes,
    socialRoutes,
    adminSocialRoutes,
    autopostRoutes,
    brandReferencesRoutes,
    styleReferencesRoutes,
    uploadsRoutes,
};
