/**
 * Admin Middleware
 * Provides middleware for admin-only routes
 */

import { Request, Response, NextFunction } from "express";
import { requireAdminGuard } from "./auth.middleware.js";

/**
 * Extended Request interface with admin data
 */
export interface AdminRequest extends Request {
    adminUserId?: string;
}

/**
 * Express middleware that requires admin privileges
 * Use this as route middleware for admin-only endpoints
 * 
 * @example
 * router.get("/api/admin/endpoint", adminOnly, (req, res) => {
 *   // req.adminUserId is available here
 * });
 */
export async function adminOnly(
    req: AdminRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const admin = await requireAdminGuard(req, res);

    if (!admin) {
        // requireAdminGuard already sent the response
        return;
    }

    // Attach admin user ID to request for use in route handlers
    req.adminUserId = admin.userId;
    next();
}

/**
 * Higher-order function to wrap an async route handler with admin check
 * Useful for inline admin route protection
 * 
 * @example
 * router.get("/api/admin/data", withAdmin(async (req, res) => {
 *   // This only runs if user is admin
 *   res.json({ data: "secret" });
 * }));
 */
export function withAdmin(
    handler: (req: AdminRequest, res: Response) => Promise<void>
) {
    return async (req: AdminRequest, res: Response): Promise<void> => {
        const admin = await requireAdminGuard(req, res);

        if (!admin) {
            return;
        }

        req.adminUserId = admin.userId;
        await handler(req, res);
    };
}
