/**
 * Admin-specific TypeScript types
 * Extracted from admin.tsx for better maintainability
 */

export interface AdminStats {
    totalUsers: number;
    totalPosts: number;
    totalBrands: number;
    newUsersToday: number;
    newPostsToday: number;
    totalUsageEvents: number;
    totalCostUsdMicros: number;
    activeSubscribers: number;
    trialingUsers: number;
    quotaExhausted: number;
}

export interface UserPost {
    id: string;
    image_url: string | null;
    thumbnail_url: string | null;
    content_type: "image" | "video";
    original_prompt: string | null;
    caption: string | null;
    created_at: string;
    total_cost_usd_micros: number;
    version_count: number;
}

export interface AdminUser {
    id: string;
    email: string;
    created_at: string;
    last_sign_in_at: string | null;
    is_admin: boolean;
    is_affiliate: boolean;
    brand_name: string | null;
    post_count: number;
    plan_name: string | null;
    generate_count: number;
    edit_count: number;
    total_cost_usd_micros: number;
    balance_micros: number;
    free_generations_remaining: number;
    referred_by_affiliate_id: string | null;
}

export type StatusFilter = "all" | "active" | "trialing" | "exhausted" | "affiliate";
export type SortField = "joined" | "usage" | "cost";
export type SortDir = "asc" | "desc";
