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
    totalTokens: number;
    totalTextInputTokens: number;
    totalTextOutputTokens: number;
    totalImageInputTokens: number;
    totalImageOutputTokens: number;
    totalTextInputCostUsdMicros: number;
    totalTextOutputCostUsdMicros: number;
    totalImageInputCostUsdMicros: number;
    totalImageOutputCostUsdMicros: number;
    unattributedCostUsdMicros: number;
    tokenRates: {
        textInput: TokenPricingRate;
        textOutput: TokenPricingRate;
        imageInput: TokenPricingRate;
        imageOutput: TokenPricingRate;
    };
    textModels: TokenModelUsage[];
    imageModels: TokenModelUsage[];
    activeSubscribers: number;
    trialingUsers: number;
    quotaExhausted: number;
}

export interface TokenPricingRate {
    costPerMillion: number;
    sellPerMillion: number;
}

export interface TokenModelUsage {
    model: string;
    tokens: number;
    events: number;
}

export interface PostUsageEvent {
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
    text_models: string[];
    image_models: string[];
    usage_events: PostUsageEvent[];
    version_count: number;
    status?: 'completed' | 'failed';
    error_message?: string | null;
}

export interface AdminUser {
    id: string;
    email: string | null;
    created_at: string;
    last_sign_in_at: string | null;
    is_admin: boolean;
    is_affiliate: boolean;
    auth_provider: string;
    auth_providers: string[];
    has_password: boolean;
    brand_name: string | null;
    post_count: number;
    plan_name: string | null;
    is_paid: boolean;
    generate_count: number;
    edit_count: number;
    total_cost_usd_micros: number;
    total_charged_amount_micros: number;
    total_tokens: number;
    text_input_tokens: number;
    text_output_tokens: number;
    image_input_tokens: number;
    image_output_tokens: number;
    text_models: string[];
    image_models: string[];
    balance_micros: number;
    free_generations_remaining: number;
    referred_by_affiliate_id: string | null;
    affiliate_commission_share_percent: number | null;
}

export type StatusFilter = "all" | "active" | "trialing" | "exhausted" | "affiliate";
export type SortField = "joined" | "usage" | "cost";
export type SortDir = "asc" | "desc";
