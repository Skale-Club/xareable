/**
 * Admin Routes
 * Handles all admin-only endpoints
 */

import { Router } from "express";
import { createAdminSupabase, createServerSupabase } from "../supabase.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";
import {
    listAllAuthUsers,
    syncProfilesFromAuthUsers,
    buildUserSummary,
    normalizeAuthEmail,
    extractAuthProviders,
} from "../services/user.service.js";

const router = Router();

function toSafeNumber(value: unknown): number {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
}

function normalizeModelName(value: unknown): string {
    const model = String(value || "").trim();
    return model || "unknown";
}

interface TokenPricingRate {
    costPerMillion: number;
    sellPerMillion: number;
}

interface TokenPricingSnapshot {
    textInput: TokenPricingRate;
    textOutput: TokenPricingRate;
    imageInput: TokenPricingRate;
    imageOutput: TokenPricingRate;
}

interface TokenCostBreakdown {
    textInputCostUsdMicros: number;
    textOutputCostUsdMicros: number;
    imageInputCostUsdMicros: number;
    imageOutputCostUsdMicros: number;
    tokenCostUsdMicros: number;
}

interface AnalyticsRange {
    start: Date;
    end: Date;
    windowDays: number;
    isCustom: boolean;
    from: string;
    to: string;
}

function parseAnalyticsWindowDays(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 14;
    if (parsed <= 7) return 7;
    if (parsed <= 14) return 14;
    if (parsed <= 30) return 30;
    if (parsed <= 90) return 90;
    return 180;
}

function parseDateParam(value: unknown): Date | null {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date;
}

function parseAnalyticsRange(query: Record<string, unknown>): AnalyticsRange {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startParam = parseDateParam(query.from);
    const endParam = parseDateParam(query.to);

    if (startParam && endParam && startParam <= endParam) {
        const end = new Date(endParam);
        end.setHours(23, 59, 59, 999);
        const diffMs = endParam.getTime() - startParam.getTime();
        const rawDays = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
        const windowDays = Math.max(1, Math.min(rawDays, 366));
        return {
            start: startParam,
            end,
            windowDays,
            isCustom: true,
            from: toDayKey(startParam) || "",
            to: toDayKey(endParam) || "",
        };
    }

    const windowDays = parseAnalyticsWindowDays(query.days);
    const start = new Date(today);
    start.setDate(today.getDate() - (windowDays - 1));
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return {
        start,
        end,
        windowDays,
        isCustom: false,
        from: toDayKey(start) || "",
        to: toDayKey(today) || "",
    };
}

function coercePositiveNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}

async function getTokenPricingRate(
    sb: ReturnType<typeof createAdminSupabase>,
    settingKey: string,
    defaultCostPerMillion: number,
    defaultSellPerMillion: number
): Promise<TokenPricingRate> {
    const { data } = await sb
        .from("platform_settings")
        .select("setting_value")
        .eq("setting_key", settingKey)
        .maybeSingle();

    const settingValue = data?.setting_value as Record<string, unknown> | null;

    return {
        costPerMillion: coercePositiveNumber(
            settingValue?.cost_per_million,
            defaultCostPerMillion
        ),
        sellPerMillion: coercePositiveNumber(
            settingValue?.sell_per_million,
            defaultSellPerMillion
        ),
    };
}

async function getTokenPricingSnapshot(
    sb: ReturnType<typeof createAdminSupabase>
): Promise<TokenPricingSnapshot> {
    const [textInput, textOutput, imageInput, imageOutput] = await Promise.all([
        getTokenPricingRate(sb, "token_pricing_text_input", 0.075, 0.225),
        getTokenPricingRate(sb, "token_pricing_text_output", 0.3, 0.9),
        getTokenPricingRate(sb, "token_pricing_image_input", 0.075, 0.225),
        getTokenPricingRate(sb, "token_pricing_image_output", 0.3, 0.9),
    ]);

    return { textInput, textOutput, imageInput, imageOutput };
}

function calculateTokenCostBreakdown(
    tokens: {
        textInputTokens: number;
        textOutputTokens: number;
        imageInputTokens: number;
        imageOutputTokens: number;
    },
    pricing: TokenPricingSnapshot
): TokenCostBreakdown {
    const textInputCostUsdMicros = Math.round(
        tokens.textInputTokens * pricing.textInput.costPerMillion
    );
    const textOutputCostUsdMicros = Math.round(
        tokens.textOutputTokens * pricing.textOutput.costPerMillion
    );
    const imageInputCostUsdMicros = Math.round(
        tokens.imageInputTokens * pricing.imageInput.costPerMillion
    );
    const imageOutputCostUsdMicros = Math.round(
        tokens.imageOutputTokens * pricing.imageOutput.costPerMillion
    );
    const tokenCostUsdMicros =
        textInputCostUsdMicros +
        textOutputCostUsdMicros +
        imageInputCostUsdMicros +
        imageOutputCostUsdMicros;

    return {
        textInputCostUsdMicros,
        textOutputCostUsdMicros,
        imageInputCostUsdMicros,
        imageOutputCostUsdMicros,
        tokenCostUsdMicros,
    };
}

function mapModelUsage(
    modelMap: Map<string, { tokens: number; events: number }>
) {
    return Array.from(modelMap.entries())
        .map(([model, aggregate]) => ({
            model,
            tokens: aggregate.tokens,
            events: aggregate.events,
        }))
        .sort((a, b) => {
            if (b.tokens !== a.tokens) {
                return b.tokens - a.tokens;
            }
            return a.model.localeCompare(b.model);
        });
}

function toDayKey(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

function buildDailySeries(startDate: Date, windowDays: number) {
    const daily = new Map<string, {
        date: string;
        newUsers: number;
        newPosts: number;
        usageEvents: number;
        costUsdMicros: number;
        chargedAmountMicros: number;
        profitMicros: number;
        tokens: number;
    }>();

    for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + (windowDays - 1 - offset));
        const key = toDayKey(date);
        if (!key) continue;
        daily.set(key, {
            date: key,
            newUsers: 0,
            newPosts: 0,
            usageEvents: 0,
            costUsdMicros: 0,
            chargedAmountMicros: 0,
            profitMicros: 0,
            tokens: 0,
        });
    }

    return daily;
}

/**
 * GET /api/admin/stats - Get platform statistics
 */
router.get("/api/admin/stats", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();
    const analyticsRange = parseAnalyticsRange(req.query as Record<string, unknown>);
    const [usersRes, postsRes, brandsRes, usageRes, creditsRes, tokenPricing] =
        await Promise.all([
            sb.from("profiles").select("id, is_admin, is_affiliate, created_at", { count: "exact" }),
            sb.from("posts").select("id, user_id, created_at", { count: "exact" }),
            sb.from("brands").select("id, user_id", { count: "exact" }),
            sb
                .from("usage_events")
                .select(
                    "user_id, created_at, cost_usd_micros, charged_amount_micros, text_input_tokens, text_output_tokens, image_input_tokens, image_output_tokens, text_model, image_model"
                ),
            sb
                .from("user_credits")
                .select(
                    "user_id, balance_micros, lifetime_purchased_micros, free_generations_used, free_generations_limit"
                ),
            getTokenPricingSnapshot(sb),
        ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = (usersRes.data || []).filter(
        (u) => new Date(u.created_at) >= today
    ).length;
    const newPostsToday = (postsRes.data || []).filter(
        (p) => new Date(p.created_at) >= today
    ).length;
    const usageRows = usageRes.data || [];
    const specialUsageUserIds = new Set(
        (usersRes.data || [])
            .filter((user) => user.is_admin === true || user.is_affiliate === true)
            .map((user) => user.id)
    );
    const platformUsageRows = usageRows.filter(
        (event) => !specialUsageUserIds.has(String(event.user_id || ""))
    );
    const analyticsUsageRows = platformUsageRows.filter((event) => {
        const createdAt = new Date(event.created_at);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= analyticsRange.start && createdAt <= analyticsRange.end;
    });
    const analyticsUsers = (usersRes.data || []).filter((user) => {
        const createdAt = new Date(user.created_at);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= analyticsRange.start && createdAt <= analyticsRange.end;
    });
    const analyticsPosts = (postsRes.data || []).filter((post) => {
        const createdAt = new Date(post.created_at);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= analyticsRange.start && createdAt <= analyticsRange.end;
    });
    const totalCostUsdMicros = platformUsageRows.reduce(
        (s, e) => s + toSafeNumber(e.cost_usd_micros),
        0
    );
    const totalChargedAmountMicros = platformUsageRows.reduce(
        (s, e) => s + toSafeNumber(e.charged_amount_micros),
        0
    );
    const totalTextInputTokens = platformUsageRows.reduce(
        (s, e) => s + toSafeNumber(e.text_input_tokens),
        0
    );
    const totalTextOutputTokens = platformUsageRows.reduce(
        (s, e) => s + toSafeNumber(e.text_output_tokens),
        0
    );
    const totalImageInputTokens = platformUsageRows.reduce(
        (s, e) => s + toSafeNumber(e.image_input_tokens),
        0
    );
    const totalImageOutputTokens = platformUsageRows.reduce(
        (s, e) => s + toSafeNumber(e.image_output_tokens),
        0
    );
    const totalTokens =
        totalTextInputTokens +
        totalTextOutputTokens +
        totalImageInputTokens +
        totalImageOutputTokens;
    const tokenCostBreakdown = calculateTokenCostBreakdown(
        {
            textInputTokens: totalTextInputTokens,
            textOutputTokens: totalTextOutputTokens,
            imageInputTokens: totalImageInputTokens,
            imageOutputTokens: totalImageOutputTokens,
        },
        tokenPricing
    );
    const unattributedCostUsdMicros = Math.max(
        totalCostUsdMicros - tokenCostBreakdown.tokenCostUsdMicros,
        0
    );
    const grossProfitMicros = totalChargedAmountMicros - totalCostUsdMicros;

    const textModelMap = new Map<string, { tokens: number; events: number }>();
    const imageModelMap = new Map<string, { tokens: number; events: number }>();
    const dailySeries = buildDailySeries(analyticsRange.start, analyticsRange.windowDays);
    let analyticsCostUsdMicros = 0;
    let analyticsChargedAmountMicros = 0;
    let analyticsTextInputTokens = 0;
    let analyticsTextOutputTokens = 0;
    let analyticsImageInputTokens = 0;
    let analyticsImageOutputTokens = 0;
    for (const event of analyticsUsageRows) {
        const textTokens =
            toSafeNumber(event.text_input_tokens) +
            toSafeNumber(event.text_output_tokens);
        const imageTokens =
            toSafeNumber(event.image_input_tokens) +
            toSafeNumber(event.image_output_tokens);
        const eventTokens = textTokens + imageTokens;
        const eventCost = toSafeNumber(event.cost_usd_micros);
        const eventCharged = toSafeNumber(event.charged_amount_micros);
        analyticsCostUsdMicros += eventCost;
        analyticsChargedAmountMicros += eventCharged;
        analyticsTextInputTokens += toSafeNumber(event.text_input_tokens);
        analyticsTextOutputTokens += toSafeNumber(event.text_output_tokens);
        analyticsImageInputTokens += toSafeNumber(event.image_input_tokens);
        analyticsImageOutputTokens += toSafeNumber(event.image_output_tokens);

        if (textTokens > 0) {
            const model = normalizeModelName(event.text_model);
            const current = textModelMap.get(model) || { tokens: 0, events: 0 };
            current.tokens += textTokens;
            current.events += 1;
            textModelMap.set(model, current);
        }

        if (imageTokens > 0) {
            const model = normalizeModelName(event.image_model);
            const current = imageModelMap.get(model) || { tokens: 0, events: 0 };
            current.tokens += imageTokens;
            current.events += 1;
            imageModelMap.set(model, current);
        }

        const dayKey = toDayKey(event.created_at);
        if (dayKey && dailySeries.has(dayKey)) {
            const day = dailySeries.get(dayKey)!;
            day.usageEvents += 1;
            day.costUsdMicros += eventCost;
            day.chargedAmountMicros += eventCharged;
            day.profitMicros += eventCharged - eventCost;
            day.tokens += eventTokens;
        }
    }

    const adminUserIds = new Set(
        (usersRes.data || [])
            .filter((u) => u.is_admin === true)
            .map((u) => u.id)
    );
    for (const user of analyticsUsers) {
        const dayKey = toDayKey(user.created_at);
        if (dayKey && dailySeries.has(dayKey)) {
            dailySeries.get(dayKey)!.newUsers += 1;
        }
    }
    for (const post of analyticsPosts) {
        const dayKey = toDayKey(post.created_at);
        if (dayKey && dailySeries.has(dayKey)) {
            dailySeries.get(dayKey)!.newPosts += 1;
        }
    }

    const postingUsers = new Set(
        (postsRes.data || [])
            .map((post) => post.user_id)
            .filter((userId): userId is string => typeof userId === "string" && userId.length > 0)
    ).size;
    const analyticsPostingUsers = new Set(
        analyticsPosts
            .map((post) => post.user_id)
            .filter((userId): userId is string => typeof userId === "string" && userId.length > 0)
    ).size;
    const creditCustomers = (creditsRes.data || []).filter(
        (c) => (c.lifetime_purchased_micros ?? 0) > 0
    ).length;
    const freeUsers = (creditsRes.data || []).filter(
        (c) =>
            !adminUserIds.has(c.user_id) &&
            (c.free_generations_used ?? 0) < (c.free_generations_limit ?? 0)
    ).length;
    const totalUsageEvents = platformUsageRows.length;
    const lowBalanceUsers = (creditsRes.data || []).filter((c) => {
        if (adminUserIds.has(c.user_id)) return false;
        const freeRemaining =
            (c.free_generations_limit ?? 0) - (c.free_generations_used ?? 0);
        return freeRemaining <= 0 && (c.balance_micros ?? 0) <= 0;
    }).length;
    const totalUsers = usersRes.count || 0;
    const totalPosts = postsRes.count || 0;
    const totalBrands = brandsRes.count || 0;
    const activeSubscribers = creditCustomers;
    const brandSetupRate = totalUsers > 0 ? (totalBrands / totalUsers) * 100 : 0;
    const postingRate = totalUsers > 0 ? (postingUsers / totalUsers) * 100 : 0;
    const paidRate = totalUsers > 0 ? (activeSubscribers / totalUsers) * 100 : 0;
    const averagePostsPerUser = totalUsers > 0 ? totalPosts / totalUsers : 0;
    const averageRevenuePerEventMicros =
        totalUsageEvents > 0 ? totalChargedAmountMicros / totalUsageEvents : 0;
    const averageCostPerEventMicros =
        totalUsageEvents > 0 ? totalCostUsdMicros / totalUsageEvents : 0;
    const analyticsTotalTokens =
        analyticsTextInputTokens +
        analyticsTextOutputTokens +
        analyticsImageInputTokens +
        analyticsImageOutputTokens;
    const analyticsTokenCostBreakdown = calculateTokenCostBreakdown(
        {
            textInputTokens: analyticsTextInputTokens,
            textOutputTokens: analyticsTextOutputTokens,
            imageInputTokens: analyticsImageInputTokens,
            imageOutputTokens: analyticsImageOutputTokens,
        },
        tokenPricing
    );
    const analyticsUnattributedCostUsdMicros = Math.max(
        analyticsCostUsdMicros - analyticsTokenCostBreakdown.tokenCostUsdMicros,
        0
    );
    const analyticsGrossProfitMicros =
        analyticsChargedAmountMicros - analyticsCostUsdMicros;
    const analyticsAverageRevenuePerEventMicros =
        analyticsUsageRows.length > 0
            ? analyticsChargedAmountMicros / analyticsUsageRows.length
            : 0;
    const analyticsAverageCostPerEventMicros =
        analyticsUsageRows.length > 0
            ? analyticsCostUsdMicros / analyticsUsageRows.length
            : 0;

    res.json({
        totalUsers,
        totalPosts,
        totalBrands,
        newUsersToday,
        newPostsToday,
        totalUsageEvents,
        totalCostUsdMicros,
        totalChargedAmountMicros,
        grossProfitMicros,
        totalTokens,
        totalTextInputTokens,
        totalTextOutputTokens,
        totalImageInputTokens,
        totalImageOutputTokens,
        totalTextInputCostUsdMicros: tokenCostBreakdown.textInputCostUsdMicros,
        totalTextOutputCostUsdMicros: tokenCostBreakdown.textOutputCostUsdMicros,
        totalImageInputCostUsdMicros: tokenCostBreakdown.imageInputCostUsdMicros,
        totalImageOutputCostUsdMicros: tokenCostBreakdown.imageOutputCostUsdMicros,
        unattributedCostUsdMicros,
        tokenRates: tokenPricing,
        textModels: mapModelUsage(textModelMap),
        imageModels: mapModelUsage(imageModelMap),
        activeSubscribers,
        trialingUsers: freeUsers,
        quotaExhausted: lowBalanceUsers,
        postingUsers,
        brandSetupRate,
        postingRate,
        paidRate,
        averagePostsPerUser,
        averageRevenuePerEventMicros,
        averageCostPerEventMicros,
        analytics: {
            windowDays: analyticsRange.windowDays,
            from: analyticsRange.from,
            to: analyticsRange.to,
            isCustom: analyticsRange.isCustom,
            users: analyticsUsers.length,
            posts: analyticsPosts.length,
            usageEvents: analyticsUsageRows.length,
            postingUsers: analyticsPostingUsers,
            costUsdMicros: analyticsCostUsdMicros,
            chargedAmountMicros: analyticsChargedAmountMicros,
            grossProfitMicros: analyticsGrossProfitMicros,
            totalTokens: analyticsTotalTokens,
            textInputTokens: analyticsTextInputTokens,
            textOutputTokens: analyticsTextOutputTokens,
            imageInputTokens: analyticsImageInputTokens,
            imageOutputTokens: analyticsImageOutputTokens,
            textInputCostUsdMicros: analyticsTokenCostBreakdown.textInputCostUsdMicros,
            textOutputCostUsdMicros: analyticsTokenCostBreakdown.textOutputCostUsdMicros,
            imageInputCostUsdMicros: analyticsTokenCostBreakdown.imageInputCostUsdMicros,
            imageOutputCostUsdMicros: analyticsTokenCostBreakdown.imageOutputCostUsdMicros,
            unattributedCostUsdMicros: analyticsUnattributedCostUsdMicros,
            averageRevenuePerEventMicros: analyticsAverageRevenuePerEventMicros,
            averageCostPerEventMicros: analyticsAverageCostPerEventMicros,
            textModels: mapModelUsage(textModelMap),
            imageModels: mapModelUsage(imageModelMap),
            daily: Array.from(dailySeries.values()),
        },
    });
});

/**
 * GET /api/admin/users - List all users with details
 */
router.get("/api/admin/users", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    try {
        const authUsers = await listAllAuthUsers(sb);
        await syncProfilesFromAuthUsers(sb, authUsers);

        const [
            { data: profiles },
            { data: brands },
            { data: posts },
            { data: credits },
            { data: usageEvents },
            { data: affiliateSettings },
            { data: billingProfiles },
        ] = await Promise.all([
            sb
                .from("profiles")
                .select("id, is_admin, is_affiliate, referred_by_affiliate_id, created_at"),
            sb.from("brands").select("user_id, company_name"),
            sb.from("posts").select("user_id"),
            sb
                .from("user_credits")
                .select(
                    "user_id, balance_micros, lifetime_purchased_micros, free_generations_used, free_generations_limit"
                ),
            sb
                .from("usage_events")
                .select(
                    "user_id, event_type, cost_usd_micros, charged_amount_micros, text_input_tokens, text_output_tokens, image_input_tokens, image_output_tokens, text_model, image_model"
                ),
            sb.from("affiliate_settings").select("user_id, commission_share_percent"),
            sb
                .from("user_billing_profiles")
                .select("user_id, subscription_status, billing_plans(display_name)"),
        ]);

        const profileMap = Object.fromEntries(
            (profiles || []).map((p) => [p.id, p])
        );
        const brandMap = Object.fromEntries(
            (brands || []).map((b) => [b.user_id, b])
        );
        const creditMap = Object.fromEntries(
            (credits || []).map((c) => [c.user_id, c])
        );
        const affiliateSettingsMap = Object.fromEntries(
            (affiliateSettings || []).map((row: any) => [row.user_id, row])
        );
        const billingProfileMap = Object.fromEntries(
            (billingProfiles || []).map((bp: any) => [bp.user_id, bp])
        );

        const postCountMap: Record<string, number> = {};
        for (const p of posts || []) {
            postCountMap[p.user_id] = (postCountMap[p.user_id] || 0) + 1;
        }

        const usageMap: Record<
            string,
            {
                generate: number;
                edit: number;
                cost: number;
                charged: number;
                text_input_tokens: number;
                text_output_tokens: number;
                image_input_tokens: number;
                image_output_tokens: number;
                text_models: Set<string>;
                image_models: Set<string>;
            }
        > = {};
        for (const e of usageEvents || []) {
            if (!usageMap[e.user_id]) {
                usageMap[e.user_id] = {
                    generate: 0,
                    edit: 0,
                    cost: 0,
                    charged: 0,
                    text_input_tokens: 0,
                    text_output_tokens: 0,
                    image_input_tokens: 0,
                    image_output_tokens: 0,
                    text_models: new Set<string>(),
                    image_models: new Set<string>(),
                };
            }
            if (e.event_type === "generate") usageMap[e.user_id].generate++;
            if (e.event_type === "edit") usageMap[e.user_id].edit++;
            usageMap[e.user_id].cost += toSafeNumber(e.cost_usd_micros);
            usageMap[e.user_id].charged += toSafeNumber(e.charged_amount_micros);

            const textInputTokens = toSafeNumber(e.text_input_tokens);
            const textOutputTokens = toSafeNumber(e.text_output_tokens);
            const imageInputTokens = toSafeNumber(e.image_input_tokens);
            const imageOutputTokens = toSafeNumber(e.image_output_tokens);
            usageMap[e.user_id].text_input_tokens += textInputTokens;
            usageMap[e.user_id].text_output_tokens += textOutputTokens;
            usageMap[e.user_id].image_input_tokens += imageInputTokens;
            usageMap[e.user_id].image_output_tokens += imageOutputTokens;

            if (textInputTokens + textOutputTokens > 0) {
                usageMap[e.user_id].text_models.add(normalizeModelName(e.text_model));
            }
            if (imageInputTokens + imageOutputTokens > 0) {
                usageMap[e.user_id].image_models.add(normalizeModelName(e.image_model));
            }
        }

        const users = authUsers
            .map((user) => {
                const profile = profileMap[user.id];
                const brand = brandMap[user.id];
                const credit = creditMap[user.id];
                const usage = usageMap[user.id] || {
                    generate: 0,
                    edit: 0,
                    cost: 0,
                    charged: 0,
                    text_input_tokens: 0,
                    text_output_tokens: 0,
                    image_input_tokens: 0,
                    image_output_tokens: 0,
                    text_models: new Set<string>(),
                    image_models: new Set<string>(),
                };
                const totalTokens =
                    usage.text_input_tokens +
                    usage.text_output_tokens +
                    usage.image_input_tokens +
                    usage.image_output_tokens;

                return buildUserSummary(
                    user,
                    profile,
                    brand,
                    credit,
                    postCountMap[user.id] || 0,
                    {
                        generate: usage.generate,
                        edit: usage.edit,
                        cost: usage.cost,
                        charged: usage.charged,
                        total_tokens: totalTokens,
                        text_input_tokens: usage.text_input_tokens,
                        text_output_tokens: usage.text_output_tokens,
                        image_input_tokens: usage.image_input_tokens,
                        image_output_tokens: usage.image_output_tokens,
                        text_models: Array.from(usage.text_models).sort(),
                        image_models: Array.from(usage.image_models).sort(),
                    },
                    affiliateSettingsMap[user.id],
                    billingProfileMap[user.id]
                );
            })
            .sort((a, b) => {
                const aTime = Date.parse(a.created_at || "");
                const bTime = Date.parse(b.created_at || "");
                const left = Number.isFinite(aTime) ? aTime : 0;
                const right = Number.isFinite(bTime) ? bTime : 0;
                return right - left;
            });

        res.json({ users });
    } catch (err: any) {
        console.error("Failed to load admin users:", err);
        res.status(500).json({ message: err?.message || "Failed to load users" });
    }
});

/**
 * POST /api/admin/users/sync - Sync auth users into profiles
 */
router.post("/api/admin/users/sync", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    try {
        const authUsers = await listAllAuthUsers(sb);
        const syncResult = await syncProfilesFromAuthUsers(sb, authUsers);
        res.json({
            success: true,
            total_auth_users: authUsers.length,
            synced_profiles: syncResult.syncedProfiles,
        });
    } catch (err: any) {
        console.error("Failed to sync admin users:", err);
        res.status(500).json({ message: err?.message || "Failed to sync users" });
    }
});

/**
 * GET /api/admin/users/:id/posts - Get user's posts
 */
router.get("/api/admin/users/:id/posts", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const sb = createAdminSupabase();
    const tokenPricing = await getTokenPricingSnapshot(sb);

    const isMissingSchemaTable = (error: any, table: string) =>
        typeof error?.message === "string" &&
        error.message.includes(
            `Could not find the table 'public.${table}' in the schema cache`
        );

    const isMissingColumn = (error: any, column: string) => {
        const message = String(error?.message || "").toLowerCase();
        return (
            message.includes("column") &&
            message.includes(column.toLowerCase()) &&
            message.includes("does not exist")
        );
    };

    let postsResult: any = await sb
        .from("posts")
        .select(
            "id, created_at, image_url, thumbnail_url, content_type, ai_prompt_used, caption"
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false });

    if (
        postsResult.error &&
        (isMissingColumn(postsResult.error, "thumbnail_url") ||
            isMissingColumn(postsResult.error, "content_type"))
    ) {
        postsResult = await sb
            .from("posts")
            .select("id, created_at, image_url, ai_prompt_used, caption")
            .eq("user_id", id)
            .order("created_at", { ascending: false });
    }

    const posts = postsResult.data || [];
    const error = postsResult.error;

    if (error) {
        console.error("Error fetching user posts:", error);
        return res.status(500).json({ message: error.message });
    }

    const postIds = (posts || []).map((post: any) => post.id);
    let versionRows: any[] = [];
    let usageRows: any[] = [];

    if (postIds.length > 0) {
        let versionsError: any = null;
        let versions: any[] = [];
        try {
            const withThumbnails = await sb
                .from("post_versions")
                .select("post_id, image_url, thumbnail_url, version_number")
                .in("post_id", postIds);
            versions = withThumbnails.data || [];
            versionsError = withThumbnails.error;

            if (versionsError && isMissingColumn(versionsError, "thumbnail_url")) {
                const fallback = await sb
                    .from("post_versions")
                    .select("post_id, image_url, version_number")
                    .in("post_id", postIds);
                versions = fallback.data || [];
                versionsError = fallback.error;
            }
        } catch (e) {
            versionsError = e;
        }

        let usageError: any = null;
        let usageEvents: any[] = [];
        try {
            const result = await sb
                .from("usage_events")
                .select(
                    "id, post_id, event_type, created_at, cost_usd_micros, charged_amount_micros, text_input_tokens, text_output_tokens, image_input_tokens, image_output_tokens, text_model, image_model"
                )
                .in("post_id", postIds);
            usageEvents = result.data || [];
            usageError = result.error;
        } catch (e) {
            usageError = e;
        }

        if (
            versionsError &&
            !isMissingSchemaTable(versionsError, "post_versions")
        ) {
            console.error("Error fetching post versions:", versionsError);
            return res
                .status(500)
                .json({ message: versionsError.message || String(versionsError) });
        }

        if (usageError && !isMissingSchemaTable(usageError, "usage_events")) {
            console.error("Error fetching usage events:", usageError);
            return res
                .status(500)
                .json({ message: usageError.message || String(usageError) });
        }

        if (
            versionsError &&
            isMissingSchemaTable(versionsError, "post_versions")
        ) {
            console.warn(
                "post_versions table missing from schema cache; returning posts without edit history"
            );
            versionRows = [];
        } else {
            versionRows = versions;
        }

        if (usageError && isMissingSchemaTable(usageError, "usage_events")) {
            console.warn(
                "usage_events table missing from schema cache; returning posts without cost history"
            );
            usageRows = [];
        } else {
            usageRows = usageEvents;
        }
    }

    const versionsByPost = versionRows.reduce(
        (acc: Record<string, any[]>, row: any) => {
            if (!row.post_id) return acc;
            if (!acc[row.post_id]) acc[row.post_id] = [];
            acc[row.post_id].push(row);
            return acc;
        },
        {}
    );

    const postUsageAggregate: Record<
        string,
        {
            total_cost_usd_micros: number;
            total_charged_amount_micros: number;
            total_tokens: number;
            text_input_tokens: number;
            text_output_tokens: number;
            image_input_tokens: number;
            image_output_tokens: number;
            text_input_cost_usd_micros: number;
            text_output_cost_usd_micros: number;
            image_input_cost_usd_micros: number;
            image_output_cost_usd_micros: number;
            unattributed_cost_usd_micros: number;
            text_models: Set<string>;
            image_models: Set<string>;
            usage_events: Array<{
                id: string;
                event_type: string;
                created_at: string;
                total_cost_usd_micros: number;
                charged_amount_micros: number;
                total_tokens: number;
                text_input_tokens: number;
                text_output_tokens: number;
                image_input_tokens: number;
                image_output_tokens: number;
                text_input_cost_usd_micros: number;
                text_output_cost_usd_micros: number;
                image_input_cost_usd_micros: number;
                image_output_cost_usd_micros: number;
                unattributed_cost_usd_micros: number;
                text_model: string | null;
                image_model: string | null;
            }>;
        }
    > = {};

    for (const row of usageRows) {
        const postId = row.post_id;
        if (!postId) {
            continue;
        }

        if (!postUsageAggregate[postId]) {
            postUsageAggregate[postId] = {
                total_cost_usd_micros: 0,
                total_charged_amount_micros: 0,
                total_tokens: 0,
                text_input_tokens: 0,
                text_output_tokens: 0,
                image_input_tokens: 0,
                image_output_tokens: 0,
                text_input_cost_usd_micros: 0,
                text_output_cost_usd_micros: 0,
                image_input_cost_usd_micros: 0,
                image_output_cost_usd_micros: 0,
                unattributed_cost_usd_micros: 0,
                text_models: new Set<string>(),
                image_models: new Set<string>(),
                usage_events: [],
            };
        }

        const aggregate = postUsageAggregate[postId];
        const textInputTokens = toSafeNumber(row.text_input_tokens);
        const textOutputTokens = toSafeNumber(row.text_output_tokens);
        const imageInputTokens = toSafeNumber(row.image_input_tokens);
        const imageOutputTokens = toSafeNumber(row.image_output_tokens);
        const totalTokens =
            textInputTokens +
            textOutputTokens +
            imageInputTokens +
            imageOutputTokens;
        const totalCostUsdMicros = toSafeNumber(row.cost_usd_micros);
        const chargedAmountMicros = toSafeNumber(row.charged_amount_micros);

        const eventTokenCostBreakdown = calculateTokenCostBreakdown(
            {
                textInputTokens,
                textOutputTokens,
                imageInputTokens,
                imageOutputTokens,
            },
            tokenPricing
        );
        const unattributedCostUsdMicros = Math.max(
            totalCostUsdMicros - eventTokenCostBreakdown.tokenCostUsdMicros,
            0
        );

        aggregate.total_cost_usd_micros += totalCostUsdMicros;
        aggregate.total_charged_amount_micros += chargedAmountMicros;
        aggregate.total_tokens += totalTokens;
        aggregate.text_input_tokens += textInputTokens;
        aggregate.text_output_tokens += textOutputTokens;
        aggregate.image_input_tokens += imageInputTokens;
        aggregate.image_output_tokens += imageOutputTokens;
        aggregate.text_input_cost_usd_micros +=
            eventTokenCostBreakdown.textInputCostUsdMicros;
        aggregate.text_output_cost_usd_micros +=
            eventTokenCostBreakdown.textOutputCostUsdMicros;
        aggregate.image_input_cost_usd_micros +=
            eventTokenCostBreakdown.imageInputCostUsdMicros;
        aggregate.image_output_cost_usd_micros +=
            eventTokenCostBreakdown.imageOutputCostUsdMicros;
        aggregate.unattributed_cost_usd_micros += unattributedCostUsdMicros;

        let textModel: string | null = null;
        let imageModel: string | null = null;
        if (textInputTokens + textOutputTokens > 0) {
            textModel = normalizeModelName(row.text_model);
            aggregate.text_models.add(textModel);
        }
        if (imageInputTokens + imageOutputTokens > 0) {
            imageModel = normalizeModelName(row.image_model);
            aggregate.image_models.add(imageModel);
        }

        aggregate.usage_events.push({
            id: String(row.id || ""),
            event_type: String(row.event_type || ""),
            created_at: String(row.created_at || ""),
            total_cost_usd_micros: totalCostUsdMicros,
            charged_amount_micros: chargedAmountMicros,
            total_tokens: totalTokens,
            text_input_tokens: textInputTokens,
            text_output_tokens: textOutputTokens,
            image_input_tokens: imageInputTokens,
            image_output_tokens: imageOutputTokens,
            text_input_cost_usd_micros:
                eventTokenCostBreakdown.textInputCostUsdMicros,
            text_output_cost_usd_micros:
                eventTokenCostBreakdown.textOutputCostUsdMicros,
            image_input_cost_usd_micros:
                eventTokenCostBreakdown.imageInputCostUsdMicros,
            image_output_cost_usd_micros:
                eventTokenCostBreakdown.imageOutputCostUsdMicros,
            unattributed_cost_usd_micros: unattributedCostUsdMicros,
            text_model: textModel,
            image_model: imageModel,
        });
    }

    const formattedPosts = posts.map((post: any) => {
        const postVersions = versionsByPost[post.id] || [];
        const postUsage = postUsageAggregate[post.id] || {
            total_cost_usd_micros: 0,
            total_charged_amount_micros: 0,
            total_tokens: 0,
            text_input_tokens: 0,
            text_output_tokens: 0,
            image_input_tokens: 0,
            image_output_tokens: 0,
            text_input_cost_usd_micros: 0,
            text_output_cost_usd_micros: 0,
            image_input_cost_usd_micros: 0,
            image_output_cost_usd_micros: 0,
            unattributed_cost_usd_micros: 0,
            text_models: new Set<string>(),
            image_models: new Set<string>(),
            usage_events: [] as any[],
        };
        const isVideoByUrl =
            typeof post.image_url === "string" &&
            /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(post.image_url);

        const latestVersion = postVersions.reduce(
            (latest: any, version: any) => {
                if (
                    !latest ||
                    (version.version_number ?? 0) > (latest.version_number ?? 0)
                ) {
                    return version;
                }
                return latest;
            },
            null
        );

        return {
            id: post.id,
            created_at: post.created_at,
            original_prompt: post.ai_prompt_used || null,
            caption: post.caption || null,
            image_url: latestVersion?.image_url || post.image_url || null,
            thumbnail_url:
                post.content_type === "video" || isVideoByUrl
                    ? post.thumbnail_url || null
                    : latestVersion?.thumbnail_url ||
                    post.thumbnail_url ||
                    latestVersion?.image_url ||
                    post.image_url ||
                    null,
            content_type:
                post.content_type === "video" || isVideoByUrl ? "video" : "image",
            version_count: postVersions.length,
            total_cost_usd_micros: postUsage.total_cost_usd_micros,
            total_charged_amount_micros: postUsage.total_charged_amount_micros,
            total_tokens: postUsage.total_tokens,
            text_input_tokens: postUsage.text_input_tokens,
            text_output_tokens: postUsage.text_output_tokens,
            image_input_tokens: postUsage.image_input_tokens,
            image_output_tokens: postUsage.image_output_tokens,
            text_input_cost_usd_micros: postUsage.text_input_cost_usd_micros,
            text_output_cost_usd_micros: postUsage.text_output_cost_usd_micros,
            image_input_cost_usd_micros: postUsage.image_input_cost_usd_micros,
            image_output_cost_usd_micros: postUsage.image_output_cost_usd_micros,
            unattributed_cost_usd_micros: postUsage.unattributed_cost_usd_micros,
            text_models: Array.from(postUsage.text_models).sort(),
            image_models: Array.from(postUsage.image_models).sort(),
            usage_events: postUsage.usage_events.sort((a, b) => {
                const left = Date.parse(a.created_at || "");
                const right = Date.parse(b.created_at || "");
                const leftSafe = Number.isFinite(left) ? left : 0;
                const rightSafe = Number.isFinite(right) ? right : 0;
                return leftSafe - rightSafe;
            }),
        };
    });

    // Fetch generation logs (failed generations)
    const { data: logsData, error: logsError } = await sb
        .from("generation_logs")
        .select("id, created_at, error_message, request_params, error_type")
        .eq("user_id", id)
        .order("created_at", { ascending: false });

    if (logsError && !isMissingSchemaTable(logsError, "generation_logs")) {
        console.error("Error fetching generation logs:", logsError);
    }

    const failedLogs = (logsData || []).map((log: any) => {
        let contentType = "image";
        let prompt = null;

        if (log.request_params) {
            if (log.request_params.content_type) {
                contentType = log.request_params.content_type;
            }
            if (log.request_params.copy_text) {
                prompt = log.request_params.copy_text;
            } else if (log.request_params.reference_text) {
                prompt = log.request_params.reference_text;
            }
        }

        return {
            id: log.id,
            created_at: log.created_at,
            original_prompt: prompt,
            caption: null,
            image_url: null,
            thumbnail_url: null,
            content_type: contentType,
            version_count: 0,
            total_cost_usd_micros: 0,
            total_charged_amount_micros: 0,
            total_tokens: 0,
            text_input_tokens: 0,
            text_output_tokens: 0,
            image_input_tokens: 0,
            image_output_tokens: 0,
            text_input_cost_usd_micros: 0,
            text_output_cost_usd_micros: 0,
            image_input_cost_usd_micros: 0,
            image_output_cost_usd_micros: 0,
            unattributed_cost_usd_micros: 0,
            text_models: [],
            image_models: [],
            usage_events: [],
            status: 'failed',
            error_message: log.error_message,
        };
    });

    const combinedPosts = [...formattedPosts.map((p: any) => ({ ...p, status: 'completed' })), ...failedLogs]
        .sort((a, b) => {
            const aTime = Date.parse(a.created_at || "");
            const bTime = Date.parse(b.created_at || "");
            return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
        });

    res.json({ posts: combinedPosts });
});

/**
* GET /api/admin/generations - List all generation attempts (success and failures)
* Query params:
*   - page: number (default 1)
*   - limit: number (default 20, max 100)
*   - status: 'all' | 'completed' | 'failed' (default 'all')
*   - content_type: 'all' | 'image' | 'video' (default 'all')
*   - search: string (searches user email and prompt)
*/
router.get("/api/admin/generations", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    const isMissingSchemaTable = (error: any, table: string) =>
        typeof error?.message === "string" &&
        error.message.includes(
            `Could not find the table 'public.${table}' in the schema cache`
        );

    const isMissingColumn = (error: any, column: string) => {
        const message = String(error?.message || "").toLowerCase();
        return (
            message.includes("column") &&
            message.includes(column.toLowerCase()) &&
            message.includes("does not exist")
        );
    };

    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const statusFilter = (req.query.status as string) || 'all';
    const contentTypeFilter = (req.query.content_type as string) || 'all';
    const searchQuery = ((req.query.search as string) || '').toLowerCase().trim();

    try {
        // Build base queries with higher limit to allow for filtering
        const fetchLimit = 500;

        // Get generation logs (failed)
        const logsResult = await sb
            .from("generation_logs")
            .select("id, user_id, created_at, error_message, request_params, error_type, status")
            .order("created_at", { ascending: false })
            .limit(fetchLimit);

        if (logsResult.error && !isMissingSchemaTable(logsResult.error, "generation_logs")) {
            console.error("Failed to load generation logs:", logsResult.error);
            return res.status(500).json({ message: logsResult.error.message || "Failed to load generations" });
        }

        // Get successful posts
        let postsResult: any = await sb
            .from("posts")
            .select(`
                id,
                user_id,
                created_at,
                image_url,
                thumbnail_url,
                content_type,
                ai_prompt_used,
                caption
            `)
            .order("created_at", { ascending: false })
            .limit(fetchLimit);

        // Backward compatibility for older schema snapshots/migrations
        if (
            postsResult.error &&
            (isMissingColumn(postsResult.error, "thumbnail_url") ||
                isMissingColumn(postsResult.error, "content_type"))
        ) {
            postsResult = await sb
                .from("posts")
                .select(`
                    id,
                    user_id,
                    created_at,
                    image_url,
                    ai_prompt_used,
                    caption
                `)
                .order("created_at", { ascending: false })
                .limit(fetchLimit);
        }

        if (postsResult.error) {
            console.error("Failed to load successful posts for generations:", postsResult.error);
            return res.status(500).json({ message: postsResult.error.message || "Failed to load generations" });
        }

        // Get successful edits (post versions)
        let versionsResult: any = await sb
            .from("post_versions")
            .select(`
                id,
                post_id,
                version_number,
                image_url,
                thumbnail_url,
                edit_prompt,
                created_at
            `)
            .order("created_at", { ascending: false })
            .limit(fetchLimit);

        if (versionsResult.error && isMissingColumn(versionsResult.error, "thumbnail_url")) {
            versionsResult = await sb
                .from("post_versions")
                .select(`
                    id,
                    post_id,
                    version_number,
                    image_url,
                    edit_prompt,
                    created_at
                `)
                .order("created_at", { ascending: false })
                .limit(fetchLimit);
        }

        if (versionsResult.error && !isMissingSchemaTable(versionsResult.error, "post_versions")) {
            console.error("Failed to load post versions for generations:", versionsResult.error);
            return res.status(500).json({ message: versionsResult.error.message || "Failed to load generations" });
        }

        const postMetaById: Record<
            string,
            { user_id: string; content_type?: string | null; ai_prompt_used?: string | null }
        > = Object.fromEntries(
            (postsResult.data || []).map((post: any) => [
                post.id,
                {
                    user_id: post.user_id,
                    content_type: post.content_type,
                    ai_prompt_used: post.ai_prompt_used,
                },
            ])
        );

        const versionPostIds: string[] = Array.from(
            new Set(
                (versionsResult.data || [])
                    .map((v: any) => (typeof v.post_id === "string" ? v.post_id : null))
                    .filter((id: string | null): id is string => Boolean(id))
            )
        );
        const missingVersionPostIds = versionPostIds.filter((postId) => !postMetaById[postId]);

        if (missingVersionPostIds.length > 0) {
            const { data: versionPosts, error: versionPostsError } = await sb
                .from("posts")
                .select("id, user_id, content_type, ai_prompt_used")
                .in("id", missingVersionPostIds);

            if (versionPostsError) {
                console.error("Failed to load parent posts for post versions:", versionPostsError);
                return res
                    .status(500)
                    .json({ message: versionPostsError.message || "Failed to load generations" });
            }

            for (const post of versionPosts || []) {
                postMetaById[post.id] = {
                    user_id: post.user_id,
                    content_type: post.content_type,
                    ai_prompt_used: post.ai_prompt_used,
                };
            }
        }

        // Fetch token usage for successful generations/edits
        const usagePostIds = Array.from(
            new Set(
                [
                    ...(postsResult.data || []).map((post: any) => post.id),
                    ...versionPostIds,
                ].filter(Boolean)
            )
        );

        type UsageEventRow = {
            post_id: string | null;
            event_type: string | null;
            created_at: string | null;
            text_input_tokens: number | null;
            text_output_tokens: number | null;
            image_input_tokens: number | null;
            image_output_tokens: number | null;
        };

        const usageByPostId: Record<string, UsageEventRow[]> = {};
        if (usagePostIds.length > 0) {
            const { data: usageRows, error: usageError } = await sb
                .from("usage_events")
                .select(
                    "post_id, event_type, created_at, text_input_tokens, text_output_tokens, image_input_tokens, image_output_tokens"
                )
                .in("post_id", usagePostIds);

            if (usageError && !isMissingSchemaTable(usageError, "usage_events")) {
                console.error("Failed to load usage events for generations:", usageError);
                return res.status(500).json({ message: usageError.message || "Failed to load generations" });
            }

            for (const row of (usageRows || []) as UsageEventRow[]) {
                if (!row.post_id) continue;
                if (!usageByPostId[row.post_id]) {
                    usageByPostId[row.post_id] = [];
                }
                usageByPostId[row.post_id].push(row);
            }
        }

        const getRowTokensTotal = (row: UsageEventRow | null | undefined): number | null => {
            if (!row) return null;
            
            const total = (
                toSafeNumber(row.text_input_tokens) +
                toSafeNumber(row.text_output_tokens) +
                toSafeNumber(row.image_input_tokens) +
                toSafeNumber(row.image_output_tokens)
            );
            
            return total > 0 ? total : null;
        };

        const pickClosestUsageEvent = (
            events: UsageEventRow[],
            targetCreatedAt: string | null | undefined,
            preferredType: "generate" | "edit"
        ): UsageEventRow | null => {
            if (!events.length) return null;
            const typedEvents = events.filter((event) => event.event_type === preferredType);
            const source = typedEvents.length > 0 ? typedEvents : events;
            if (!targetCreatedAt) return source[0] || null;

            const targetMs = Date.parse(targetCreatedAt);
            if (!Number.isFinite(targetMs)) return source[0] || null;

            let best: UsageEventRow | null = null;
            let bestDiff = Number.POSITIVE_INFINITY;
            for (const event of source) {
                const eventMs = Date.parse(event.created_at || "");
                if (!Number.isFinite(eventMs)) continue;
                const diff = Math.abs(eventMs - targetMs);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    best = event;
                }
            }
            return best || source[0] || null;
        };

        // Fetch emails for logs
        const userIds = Array.from(
            new Set(
                [
                    ...(logsResult.data || []).map((l: any) => l.user_id),
                    ...(postsResult.data || []).map((p: any) => p.user_id),
                    ...Object.values(postMetaById).map((p: any) => p?.user_id),
                ].filter(Boolean)
            )
        );
        let profilesMap: Record<string, string> = {};

        if (userIds.length > 0) {
            const { data: profiles } = await sb
                .from("profiles")
                .select("id, email")
                .in("id", userIds);

            profilesMap = Object.fromEntries((profiles || []).map(p => [p.id, p.email]));
        }

        const extractLogMeta = (log: any) => {
            let contentType = "image";
            let prompt = null as string | null;

            if (log.request_params) {
                if (log.request_params.content_type) contentType = log.request_params.content_type;
                if (log.request_params.copy_text) prompt = log.request_params.copy_text;
                else if (log.request_params.reference_text) prompt = log.request_params.reference_text;
            }

            return { contentType, prompt };
        };

        // Deduplicate near-identical failed log rows (e.g. specific error + fallback unknown)
        const dedupedLogsMap = new Map<string, any>();
        for (const log of logsResult.data || []) {
            const { contentType, prompt } = extractLogMeta(log);
            const createdSecond = typeof log.created_at === "string" ? log.created_at.slice(0, 19) : "";
            const dedupeKey = [
                log.user_id || "",
                createdSecond,
                contentType || "",
                String(log.error_message || "").trim(),
                String(prompt || "").trim(),
            ].join("|");

            const existing = dedupedLogsMap.get(dedupeKey);
            if (!existing) {
                dedupedLogsMap.set(dedupeKey, log);
                continue;
            }

            const existingIsUnknown = String(existing.error_type || "") === "unknown";
            const currentIsSpecific = String(log.error_type || "") !== "unknown";
            if (existingIsUnknown && currentIsSpecific) {
                dedupedLogsMap.set(dedupeKey, log);
            }
        }

        const formattedLogs = Array.from(dedupedLogsMap.values()).map((log: any) => {
            const { contentType, prompt } = extractLogMeta(log);

            return {
                id: log.id,
                user_id: log.user_id,
                user_email: profilesMap[log.user_id] || "Unknown User",
                created_at: log.created_at,
                original_prompt: prompt,
                content_type: contentType,
                status: 'failed' as const,
                error_message: log.error_message,
                image_url: null as string | null,
                thumbnail_url: null as string | null,
                tokens_total: null as number | null,
            };
        });

        const formattedPosts = (postsResult.data || []).map((post: any) => {
            const isVideoByUrl = typeof post.image_url === "string" && /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(post.image_url);
            const usageEvent = pickClosestUsageEvent(
                usageByPostId[post.id] || [],
                post.created_at,
                "generate"
            );
            return {
                id: post.id,
                user_id: post.user_id,
                user_email: profilesMap[post.user_id] || "Unknown User",
                created_at: post.created_at,
                original_prompt: post.ai_prompt_used,
                content_type: post.content_type === "video" || isVideoByUrl ? "video" : "image",
                status: 'completed' as const,
                error_message: null as string | null,
                image_url: post.image_url,
                thumbnail_url: post.content_type === "video" || isVideoByUrl ? post.thumbnail_url : (post.thumbnail_url || post.image_url),
                tokens_total: getRowTokensTotal(usageEvent),
            };
        });

        const formattedVersions = (versionsResult.data || []).map((version: any) => {
            const parentPost = postMetaById[version.post_id];
            const isVideoByUrl =
                typeof version.image_url === "string" &&
                /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(version.image_url);
            const isVideo = parentPost?.content_type === "video" || isVideoByUrl;
            const usageEvent = pickClosestUsageEvent(
                usageByPostId[version.post_id] || [],
                version.created_at,
                "edit"
            );

            return {
                id: version.id,
                user_id: parentPost?.user_id || null,
                user_email: parentPost?.user_id
                    ? profilesMap[parentPost.user_id] || "Unknown User"
                    : "Unknown User",
                created_at: version.created_at,
                original_prompt: version.edit_prompt || parentPost?.ai_prompt_used || null,
                content_type: isVideo ? "video" : "image",
                status: "completed" as const,
                error_message: null as string | null,
                image_url: version.image_url || null,
                thumbnail_url: isVideo
                    ? (version.thumbnail_url || null)
                    : (version.thumbnail_url || version.image_url || null),
                tokens_total: getRowTokensTotal(usageEvent),
            };
        });

        // Combine and sort all generations
        let allGenerations = [...formattedLogs, ...formattedPosts, ...formattedVersions]
            .sort((a, b) => {
                const aTime = Date.parse(a.created_at || "");
                const bTime = Date.parse(b.created_at || "");
                return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
            });

        // Apply filters
        if (statusFilter !== 'all') {
            allGenerations = allGenerations.filter(g => g.status === statusFilter);
        }

        if (contentTypeFilter !== 'all') {
            allGenerations = allGenerations.filter(g => g.content_type === contentTypeFilter);
        }

        if (searchQuery) {
            allGenerations = allGenerations.filter(g =>
                g.user_email.toLowerCase().includes(searchQuery) ||
                (g.original_prompt && g.original_prompt.toLowerCase().includes(searchQuery)) ||
                (g.error_message && g.error_message.toLowerCase().includes(searchQuery))
            );
        }

        // Calculate pagination
        const total = allGenerations.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const paginatedGenerations = allGenerations.slice(offset, offset + limit);

        res.json({
            generations: paginatedGenerations,
            pagination: {
                page,
                limit,
                total,
                totalPages,
                hasMore: page < totalPages
            }
        });
    } catch (err: any) {
        console.error("Failed to load generations:", err);
        res.status(500).json({ message: err?.message || "Failed to load generations" });
    }
});

/**
 * PATCH /api/admin/users/:id/admin - Toggle admin status
 */
router.patch("/api/admin/users/:id/admin", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { is_admin } = req.body;
    if (id === admin.userId)
        return res
            .status(400)
            .json({ message: "Cannot change your own admin status" });

    const sb = createAdminSupabase();
    const { error } = await sb
        .from("profiles")
        .update({ is_admin: !!is_admin })
        .eq("id", id);
    if (error) return res.status(500).json({ message: error.message });
    res.json({ success: true });
});

/**
 * PATCH /api/admin/users/:id/affiliate - Toggle affiliate status
 */
router.patch("/api/admin/users/:id/affiliate", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { is_affiliate } = req.body;
    const sb = createAdminSupabase();

    // Check if user is an admin - admins cannot be affiliates (conflict of interest)
    const { data: targetProfile } = await sb
        .from("profiles")
        .select("is_admin")
        .eq("id", id)
        .single();

    if (targetProfile?.is_admin && is_affiliate) {
        return res.status(400).json({
            message: "Cannot set affiliate status for admin users. Admins cannot be affiliates due to conflict of interest."
        });
    }

    const { error } = await sb
        .from("profiles")
        .update({ is_affiliate: !!is_affiliate })
        .eq("id", id);
    if (error) return res.status(500).json({ message: error.message });

    if (is_affiliate) {
        const { data: defaultCommissionSetting } = await sb
            .from("platform_settings")
            .select("setting_value")
            .eq("setting_key", "default_affiliate_commission_percent")
            .maybeSingle();
        const defaultCommission =
            Number((defaultCommissionSetting?.setting_value as any)?.amount ?? 50) ||
            50;

        await sb.from("affiliate_settings").upsert(
            {
                user_id: id,
                commission_share_percent: Math.min(Math.max(defaultCommission, 0), 100),
            },
            { onConflict: "user_id" }
        );
    }

    res.json({ success: true });
});

/**
 * PATCH /api/admin/users/:id/affiliate-commission - Update commission share
 */
router.patch("/api/admin/users/:id/affiliate-commission", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const rawPercent = Number(req.body?.commission_share_percent);
    if (!Number.isFinite(rawPercent) || rawPercent < 0 || rawPercent > 100) {
        return res
            .status(400)
            .json({ message: "commission_share_percent must be between 0 and 100" });
    }

    const sb = createAdminSupabase();
    const { data: profile } = await sb
        .from("profiles")
        .select("is_affiliate")
        .eq("id", id)
        .single();

    if (!profile?.is_affiliate) {
        return res.status(400).json({ message: "User is not an affiliate" });
    }

    const { error } = await sb.from("affiliate_settings").upsert(
        {
            user_id: id,
            commission_share_percent: rawPercent,
        },
        { onConflict: "user_id" }
    );

    if (error) {
        return res.status(500).json({ message: error.message });
    }

    res.json({ success: true, commission_share_percent: rawPercent });
});

/**
 * PATCH /api/admin/users/:id/referrer - Assign affiliate referrer
 */
router.patch("/api/admin/users/:id/referrer", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const { id } = req.params;
    const rawAffiliateUserId = req.body?.affiliate_user_id;
    const affiliateUserId =
        rawAffiliateUserId === null ||
            rawAffiliateUserId === undefined ||
            rawAffiliateUserId === ""
            ? null
            : String(rawAffiliateUserId);

    if (affiliateUserId && affiliateUserId === id) {
        return res.status(400).json({ message: "User cannot refer themselves" });
    }

    const sb = createAdminSupabase();

    if (affiliateUserId) {
        const { data: referrerProfile, error: referrerError } = await sb
            .from("profiles")
            .select("id, is_affiliate")
            .eq("id", affiliateUserId)
            .single();

        if (referrerError) {
            return res.status(400).json({ message: "Affiliate account not found" });
        }

        if (!referrerProfile?.is_affiliate) {
            return res
                .status(400)
                .json({ message: "Selected user is not an affiliate" });
        }
    }

    const { data: updatedProfile, error: updateError } = await sb
        .from("profiles")
        .update({ referred_by_affiliate_id: affiliateUserId })
        .eq("id", id)
        .select("id, referred_by_affiliate_id")
        .single();

    if (updateError) {
        return res.status(500).json({ message: updateError.message });
    }

    res.json({
        success: true,
        referred_by_affiliate_id: updatedProfile?.referred_by_affiliate_id ?? null,
    });
});

/**
 * POST /api/admin/migrate-colors - Run color migration
 */
router.post("/api/admin/migrate-colors", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    try {
        const { error: error1 } = await sb.rpc("exec", {
            sql: "ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;",
        });

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
            message:
                "Migration attempted. If color_4 column was added successfully, the app is ready.",
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
