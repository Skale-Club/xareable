/**
 * Routes Index - Aggregates all route modules
 * This is the main entry point for registering all API routes
 */

import { Router } from "express";
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

// Re-export for convenience
export { getStyleCatalogPayload } from "./style-catalog.routes.js";

/**
 * Create and configure the main router with all route modules
 */
export function createApiRouter(): Router {
    const router = Router();

    // Register route modules
    router.use(seoRoutes);
    router.use(configRoutes);
    router.use(postsRoutes);
    router.use(styleCatalogRoutes);
    router.use(generateRoutes);
    router.use(translateRoutes);
    router.use(transcribeRoutes);
    router.use(creditsRoutes);
    router.use(affiliatePublicRoutes);
    router.use(affiliateRoutes);
    router.use(markupRoutes);
    router.use(integrationsRoutes);
    router.use(stripeRoutes);

    return router;
}

// Export individual route modules for selective registration
export {
    seoRoutes,
    configRoutes,
    postsRoutes,
    styleCatalogRoutes,
    generateRoutes,
    translateRoutes,
    transcribeRoutes,
    creditsRoutes,
    affiliatePublicRoutes,
    affiliateRoutes,
    markupRoutes,
    integrationsRoutes,
    stripeRoutes,
};
