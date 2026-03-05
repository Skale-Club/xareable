/**
 * Config Routes - Public configuration endpoints
 * Handles app configuration and settings retrieval
 */

import { Router, Response } from "express";
import { createAdminSupabase } from "../supabase";
import { DEFAULT_APP_SETTINGS } from "../../shared/config/defaults";
import { config } from "../config";

const router = Router();

/**
 * GET /api/config
 * Returns public Supabase configuration for client-side initialization
 */
router.get("/api/config", (_, res: Response) => {
    res.json({
        supabaseUrl: config.SUPABASE_URL,
        supabaseAnonKey: config.SUPABASE_ANON_KEY,
    });
});

/**
 * GET /api/settings
 * Returns public app settings
 */
router.get("/api/settings", async (_, res: Response) => {
    try {
        const sb = createAdminSupabase();
        const { data, error } = await sb.from("app_settings").select("*").single();

        if (error || !data) {
            return res.json(DEFAULT_APP_SETTINGS);
        }

        res.json(data);
    } catch (error) {
        res.json(DEFAULT_APP_SETTINGS);
    }
});

export default router;
