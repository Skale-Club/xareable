/**
 * User Service
 * Handles user-related utilities and operations
 */

import { createAdminSupabase } from "../supabase.js";

/**
 * Normalize email address for consistent storage/lookup
 */
export function normalizeAuthEmail(
    email: string | null | undefined
): string | null {
    const value = String(email || "").trim().toLowerCase();
    return value || null;
}

/**
 * Extract authentication providers from user metadata
 */
export function extractAuthProviders(user: any): string[] {
    const providers = new Set<string>();

    if (
        typeof user?.app_metadata?.provider === "string" &&
        user.app_metadata.provider.trim()
    ) {
        providers.add(user.app_metadata.provider.trim().toLowerCase());
    }

    if (Array.isArray(user?.app_metadata?.providers)) {
        for (const provider of user.app_metadata.providers) {
            const value = String(provider || "").trim().toLowerCase();
            if (value) providers.add(value);
        }
    }

    if (Array.isArray(user?.identities)) {
        for (const identity of user.identities) {
            const value = String(identity?.provider || "").trim().toLowerCase();
            if (value) providers.add(value);
        }
    }

    return Array.from(providers);
}

/**
 * Get the primary authentication provider
 */
export function getPrimaryAuthProvider(providers: string[]): string {
    if (providers.length === 0) {
        return "unknown";
    }

    const firstNonEmail = providers.find((provider) => provider !== "email");
    return firstNonEmail || providers[0];
}

/**
 * List all auth users from Supabase with pagination
 */
export async function listAllAuthUsers(
    sb: ReturnType<typeof createAdminSupabase>
): Promise<any[]> {
    const users: any[] = [];
    const perPage = 200;
    let page = 1;
    let guard = 0;

    while (guard < 1000) {
        guard += 1;
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
        if (error) {
            throw new Error(error.message);
        }

        const batch = data?.users || [];
        users.push(...batch);

        const nextPage = data?.nextPage;
        if (!nextPage || batch.length === 0) {
            break;
        }
        page = nextPage;
    }

    return users;
}

/**
 * Sync profiles from auth users (creates missing profile rows)
 */
export async function syncProfilesFromAuthUsers(
    sb: ReturnType<typeof createAdminSupabase>,
    authUsers: any[]
): Promise<{ syncedProfiles: number }> {
    if (!authUsers.length) {
        return { syncedProfiles: 0 };
    }

    const rows = authUsers.map((user) => ({
        id: user.id,
    }));

    const CHUNK_SIZE = 500;
    for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
        const chunk = rows.slice(index, index + CHUNK_SIZE);
        const { error } = await sb
            .from("profiles")
            .upsert(chunk, { onConflict: "id" });
        if (error) {
            throw new Error(error.message);
        }
    }

    return { syncedProfiles: rows.length };
}

/**
 * Build a user summary object for admin listings
 */
export function buildUserSummary(
    user: any,
    profile: any,
    brand: any,
    credit: any,
    postCount: number,
    usageStats: {
        generate: number;
        edit: number;
        cost: number;
        charged: number;
        total_tokens: number;
        text_input_tokens: number;
        text_output_tokens: number;
        image_input_tokens: number;
        image_output_tokens: number;
        text_models: string[];
        image_models: string[];
    },
    affiliateSettings?: { commission_share_percent: number | null } | null,
    billingProfile?: {
        subscription_status?: string | null;
        plan?: { display_name?: string | null } | null;
    } | null
) {
    const providers = extractAuthProviders(user);
    const authEmail = normalizeAuthEmail(user.email);

    // Determine plan name from billing subscription or fallback to credits/free
    const subscriptionStatus = String(billingProfile?.subscription_status || "");
    const hasActiveSubscription =
        subscriptionStatus === "active" ||
        subscriptionStatus === "trialing" ||
        subscriptionStatus === "past_due";

    // Priority: billing plan name > credits > free
    let planName = "Free";
    if (hasActiveSubscription && billingProfile?.plan?.display_name) {
        planName = billingProfile.plan.display_name;
    } else if ((credit?.lifetime_purchased_micros ?? 0) > 0) {
        planName = "Credits";
    }

    return {
        id: user.id,
        email: authEmail,
        created_at: user.created_at || profile?.created_at || new Date(0).toISOString(),
        last_sign_in_at: user.last_sign_in_at,
        is_admin: profile?.is_admin || false,
        is_affiliate: profile?.is_affiliate || false,
        auth_provider: getPrimaryAuthProvider(providers),
        auth_providers: providers,
        has_password: providers.includes("email"),
        brand_name: brand?.company_name || null,
        post_count: postCount,
        plan_name: planName,
        is_paid: hasActiveSubscription,
        generate_count: usageStats.generate,
        edit_count: usageStats.edit,
        total_cost_usd_micros: usageStats.cost,
        total_charged_amount_micros: usageStats.charged,
        total_tokens: usageStats.total_tokens,
        text_input_tokens: usageStats.text_input_tokens,
        text_output_tokens: usageStats.text_output_tokens,
        image_input_tokens: usageStats.image_input_tokens,
        image_output_tokens: usageStats.image_output_tokens,
        text_models: usageStats.text_models,
        image_models: usageStats.image_models,
        balance_micros: credit?.balance_micros ?? 0,
        free_generations_remaining: Math.max(
            (credit?.free_generations_limit ?? 0) -
            (credit?.free_generations_used ?? 0),
            0
        ),
        referred_by_affiliate_id: profile?.referred_by_affiliate_id ?? null,
        affiliate_commission_share_percent: (() => {
            const raw = affiliateSettings?.commission_share_percent;
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : null;
        })(),
    };
}
