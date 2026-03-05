/**
 * Markup Routes - admin pricing and markup settings
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase.js";
import {
    markupSettingsSchema,
    updateMarkupSettingsRequestSchema,
} from "../../shared/schema.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";

const router = Router();

async function getPlatformNumericSetting(
    settingKey: string,
    field: "amount" | "multiplier",
    fallback: number,
): Promise<number> {
    const sb = createAdminSupabase();
    const { data } = await sb
        .from("platform_settings")
        .select("setting_value")
        .eq("setting_key", settingKey)
        .single();

    const value = data?.setting_value as Record<string, unknown> | null;
    const raw = value?.[field];

    return typeof raw === "number" ? raw : fallback;
}

async function getMarkupSettingsPayload() {
    const payload = {
        regularMultiplier: await getPlatformNumericSetting("markup_regular", "multiplier", 3),
        affiliateMultiplier: await getPlatformNumericSetting("markup_affiliate", "multiplier", 4),
        minRechargeMicros: await getPlatformNumericSetting("min_recharge_micros", "amount", 10_000_000),
        defaultAutoRechargeThresholdMicros: await getPlatformNumericSetting("default_auto_recharge_threshold", "amount", 5_000_000),
        defaultAutoRechargeAmountMicros: await getPlatformNumericSetting("default_auto_recharge_amount", "amount", 10_000_000),
    };

    return markupSettingsSchema.parse(payload);
}

/**
 * GET /api/admin/markup-settings
 * Returns current platform pricing/markup settings (admin only)
 */
router.get("/api/admin/markup-settings", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    res.json(await getMarkupSettingsPayload());
});

/**
 * PATCH /api/admin/markup-settings
 * Updates platform pricing/markup settings (admin only)
 */
router.patch("/api/admin/markup-settings", async (req: Request, res: Response): Promise<void> => {
    const adminResult = await requireAdminGuard(req, res);
    if (!adminResult) return;

    const parseResult = updateMarkupSettingsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid pricing settings payload" });
        return;
    }

    const sb = createAdminSupabase();
    const payload = parseResult.data;

    const updates = [
        {
            setting_key: "markup_regular",
            setting_value: {
                multiplier: payload.regularMultiplier,
                description: "Regular user pay-per-use markup",
            },
        },
        {
            setting_key: "markup_affiliate",
            setting_value: {
                multiplier: payload.affiliateMultiplier,
                description: "Referred customer pay-per-use markup",
            },
        },
        {
            setting_key: "min_recharge_micros",
            setting_value: {
                amount: payload.minRechargeMicros,
                description: "Minimum manual top-up",
            },
        },
        {
            setting_key: "default_auto_recharge_threshold",
            setting_value: {
                amount: payload.defaultAutoRechargeThresholdMicros,
                description: "Default threshold",
            },
        },
        {
            setting_key: "default_auto_recharge_amount",
            setting_value: {
                amount: payload.defaultAutoRechargeAmountMicros,
                description: "Default top-up amount",
            },
        },
    ];

    const { error } = await sb
        .from("platform_settings")
        .upsert(
            updates.map((item) => ({
                ...item,
                updated_by: adminResult.userId,
                updated_at: new Date().toISOString(),
            })),
            { onConflict: "setting_key" },
        );

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    res.json(await getMarkupSettingsPayload());
});

export default router;
