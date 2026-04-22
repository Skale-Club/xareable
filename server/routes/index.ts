/**
 * Routes Index - Aggregates all route modules
 * This is the main entry point for registering all API routes
 */

import { Router } from "express";

// Import all route modules
import seoRoutes from "./seo.routes.js";
import configRoutes from "./config.routes.js";
import postsRoutes from "./posts.routes.js";
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
import billingRoutes from "./billing.routes.js";

// New route modules
import adminRoutes from "./admin.routes.js";
import landingRoutes from "./landing.routes.js";
import settingsRoutes from "./settings.routes.js";
import editRoutes from "./edit.routes.js";

// v1.1 media creation routes
import carouselRoutes from "./carousel.routes.js";
import enhanceRoutes from "./enhance.routes.js";

// Re-export for convenience
export { getStyleCatalogPayload } from "./style-catalog.routes.js";

/**
 * Create and configure the main router with all route modules
 */
export function createApiRouter(): Router {
    const router = Router();

    // Core routes
    router.use(seoRoutes);
    router.use(configRoutes);
    router.use(postsRoutes);
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

    // Affiliate system
    router.use(affiliatePublicRoutes);
    router.use(affiliateRoutes);

    // Admin routes
    router.use(adminRoutes);
    router.use(landingRoutes);
    router.use(settingsRoutes);

    // Integrations
    router.use(markupRoutes);
    router.use(integrationsRoutes);

    return router;
}

// Export individual route modules for selective registration
export {
    // Core routes
    seoRoutes,
    configRoutes,
    postsRoutes,
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
};
