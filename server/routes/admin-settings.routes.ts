/**
 * Admin Settings Routes (extracted from admin.routes.ts — SEED-004)
 * Covers: image-provider toggle, platform API keys, migrate-colors utility
 */

import { Router } from "express";
import { createAdminSupabase } from "../supabase.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import {
    getPlatformSetting,
    setPlatformSetting,
} from "../services/app-settings.service.js";

const router = Router();

// ── Phase 12 — PROV-05: image provider admin toggle ──────────────────────────

/**
 * GET /api/admin/image-provider
 * Returns the currently active image provider ('gemini' | 'openai').
 */
router.get("/api/admin/image-provider", async (req, res) => {
    const guard = await requireAdminGuard(req, res);
    if (!guard) return;
    const raw = await getPlatformSetting("image_provider");
    const provider = raw === "openai" ? "openai" : "gemini";
    res.json({ provider });
});

/**
 * PATCH /api/admin/image-provider
 * Switches the active image provider. Body: { provider: 'gemini' | 'openai' }
 * Takes effect immediately — no server restart needed (factory reads per request).
 */
router.patch("/api/admin/image-provider", async (req, res) => {
    const guard = await requireAdminGuard(req, res);
    if (!guard) return;
    const { provider } = (req.body as Record<string, unknown>) ?? {};
    if (provider !== "gemini" && provider !== "openai") {
        return res.status(400).json({ message: "provider must be 'gemini' or 'openai'" });
    }
    await setPlatformSetting("image_provider", provider);
    res.json({ provider });
});

// ── Phase 12.2 — Platform API keys ───────────────────────────────────────────

/**
 * GET /api/admin/api-keys
 * Returns presence flags for platform-default API keys (no values exposed).
 */
router.get("/api/admin/api-keys", async (req, res) => {
    const guard = await requireAdminGuard(req, res);
    if (!guard) return;
    const gemini = (await getPlatformSetting("gemini_api_key")) ?? "";
    const openai = (await getPlatformSetting("openai_api_key")) ?? "";
    const preview = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "");
    res.json({
        gemini_configured: gemini.length > 0,
        openai_configured: openai.length > 0,
        gemini_preview: preview(gemini),
        openai_preview: preview(openai),
    });
});

/**
 * PATCH /api/admin/api-keys
 * Updates one or both platform-default API keys.
 * Body: { gemini_api_key?: string, openai_api_key?: string }
 * Empty string CLEARS the key. Takes effect immediately.
 */
router.patch("/api/admin/api-keys", async (req, res) => {
    const guard = await requireAdminGuard(req, res);
    if (!guard) return;
    const body = (req.body as Record<string, unknown>) ?? {};
    const updates: Array<Promise<void>> = [];
    if (typeof body.gemini_api_key === "string") {
        updates.push(setPlatformSetting("gemini_api_key", body.gemini_api_key.trim()));
    }
    if (typeof body.openai_api_key === "string") {
        updates.push(setPlatformSetting("openai_api_key", body.openai_api_key.trim()));
    }
    if (updates.length === 0) {
        return res.status(400).json({ message: "Provide gemini_api_key and/or openai_api_key (string)" });
    }
    await Promise.all(updates);
    res.json({ ok: true });
});

// ── Legacy migration utility ──────────────────────────────────────────────────

/**
 * POST /api/admin/migrate-colors
 * One-time migration: add color_4 column to brands table.
 * Kept here (not deleted) for re-runability in case of deployment rollbacks.
 */
router.post("/api/admin/migrate-colors", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    try {
        const { error: error1 } = await sb.rpc("exec", {
            sql: "ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;",
        });

        if (error1) {
            console.error("migrate-colors RPC error:", error1);
            return res.status(500).json({
                success: false,
                message: error1.message,
                note: "Please run this SQL manually in Supabase Dashboard SQL Editor:\n\nALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;\nALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;",
            });
        }

        const { data: columns, error: checkError } = await sb
            .from("information_schema.columns")
            .select("is_nullable")
            .eq("table_schema", "public")
            .eq("table_name", "brands")
            .eq("column_name", "color_3")
            .single();

        if (checkError) {
            console.log("Check error (may be expected):", checkError.message);
        }

        res.json({
            success: true,
            message: "Migration attempted. If color_4 column was added successfully, the app is ready.",
            color_3_nullable: columns?.is_nullable,
            note: "If color_3 is still NOT NULL, run this SQL in Supabase Dashboard: ALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;",
        });
    } catch (err: any) {
        res.status(500).json({
            message: err.message,
            note: "Please run this SQL manually in Supabase Dashboard SQL Editor:\n\nALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;\nALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;",
        });
    }
});

export default router;
