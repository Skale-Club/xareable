/**
 * Config Routes - Public configuration endpoints
 * Handles app configuration and settings retrieval
 */

import { Router, Response } from "express";
import { createAdminSupabase } from "../supabase.js";
import { DEFAULT_APP_SETTINGS } from "../../shared/config/defaults.js";
import { config } from "../config/index.js";

const router = Router();

async function getLatestAppSettingsRow(sb: ReturnType<typeof createAdminSupabase>) {
    const { data, error } = await sb
        .from("app_settings")
        .select("*")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1);

    if (error) {
        throw new Error(error.message);
    }

    return data?.[0] ?? null;
}

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
        const data = await getLatestAppSettingsRow(sb);

        if (!data) {
            return res.json(DEFAULT_APP_SETTINGS);
        }

        res.json(data);
    } catch (error: any) {
        res.status(500).json({ message: error?.message || "Failed to load app settings." });
    }
});

export default router;
