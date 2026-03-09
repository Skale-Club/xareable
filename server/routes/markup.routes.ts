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
    field: "amount" | "multiplier" | "cost_per_million" | "sell_per_million",
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
        textInputCostPerMillion: await getPlatformNumericSetting("token_pricing_text_input", "cost_per_million", 0.075),
        textInputSellPerMillion: await getPlatformNumericSetting("token_pricing_text_input", "sell_per_million", 0.225),
        textOutputCostPerMillion: await getPlatformNumericSetting("token_pricing_text_output", "cost_per_million", 0.3),
        textOutputSellPerMillion: await getPlatformNumericSetting("token_pricing_text_output", "sell_per_million", 0.9),
        imageInputCostPerMillion: await getPlatformNumericSetting("token_pricing_image_input", "cost_per_million", 0.075),
        imageInputSellPerMillion: await getPlatformNumericSetting("token_pricing_image_input", "sell_per_million", 0.225),
        imageOutputCostPerMillion: await getPlatformNumericSetting("token_pricing_image_output", "cost_per_million", 0.3),
        imageOutputSellPerMillion: await getPlatformNumericSetting("token_pricing_image_output", "sell_per_million", 0.9),
        defaultAffiliateCommissionPercent: await getPlatformNumericSetting("default_affiliate_commission_percent", "amount", 50),
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
            setting_key: "token_pricing_text_input",
            setting_value: {
                cost_per_million: payload.textInputCostPerMillion,
                sell_per_million: payload.textInputSellPerMillion,
                description: "Text input pricing per 1M tokens",
            },
        },
        {
            setting_key: "token_pricing_text_output",
            setting_value: {
                cost_per_million: payload.textOutputCostPerMillion,
                sell_per_million: payload.textOutputSellPerMillion,
                description: "Text output pricing per 1M tokens",
            },
        },
        {
            setting_key: "token_pricing_image_input",
            setting_value: {
                cost_per_million: payload.imageInputCostPerMillion,
                sell_per_million: payload.imageInputSellPerMillion,
                description: "Image input pricing per 1M tokens",
            },
        },
        {
            setting_key: "token_pricing_image_output",
            setting_value: {
                cost_per_million: payload.imageOutputCostPerMillion,
                sell_per_million: payload.imageOutputSellPerMillion,
                description: "Image output pricing per 1M tokens",
            },
        },
        {
            setting_key: "default_affiliate_commission_percent",
            setting_value: {
                amount: payload.defaultAffiliateCommissionPercent,
                description: "Default affiliate commission share percent over gross profit",
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
