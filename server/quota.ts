import { createAdminSupabase } from "./supabase.js";
import {
  chargeAutoRecharge,
  getBillingModel,
  processAffiliatePayoutIfEligible,
} from "./stripe.js";

export interface CreditStatus {
  allowed: boolean;
  balance_micros: number;
  estimated_cost_micros: number;
  markup_multiplier: number;
  free_generations_remaining: number;
  auto_recharge_enabled: boolean;
  denial_reason?: "inactive_subscription" | "usage_budget_reached" | "upgrade_required" | null;
  usage_budget_micros?: number | null;
  usage_budget_remaining_micros?: number | null;
  additional_usage_this_month_micros?: number;
  usage_alert_reached?: boolean;
  usage_budget_reached?: boolean;
}

export interface UsageTokenData {
  text_input_tokens?: number;
  text_output_tokens?: number;
  image_input_tokens?: number;
  image_output_tokens?: number;
}

export interface UsageModelData {
  text_model?: string | null;
  image_model?: string | null;
}

export interface RecordedUsageEvent {
  id: string;
  cost_usd_micros: number;
  charged_amount_micros: number;
}

const settingsCache = new Map<string, { value: number; expiresAt: number }>();
const SETTINGS_CACHE_TTL_MS = 60 * 1000;
type PlatformSettingField =
  | "amount"
  | "multiplier"
  | "cost_per_million"
  | "sell_per_million"
  | "cost_micros"
  | "sell_micros";

interface TokenPricingRate {
  costPerMillion: number;
  sellPerMillion: number;
}

interface UsagePricingMicros {
  rawCostMicros: number;
  chargedCostMicros: number;
}

async function usesOwnApiKey(userId: string): Promise<boolean> {
  const sb = createAdminSupabase();
  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin, is_affiliate")
    .eq("id", userId)
    .maybeSingle();

  return profile?.is_admin === true || profile?.is_affiliate === true;
}

async function getPlatformSettingNumber(
  settingKey: string,
  field: PlatformSettingField,
  fallback: number,
): Promise<number> {
  const cacheKey = `${settingKey}:${field}`;
  const cached = settingsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const sb = createAdminSupabase();
  const { data } = await sb
    .from("platform_settings")
    .select("setting_value")
    .eq("setting_key", settingKey)
    .maybeSingle();

  const value = data?.setting_value as Record<string, unknown> | null;
  const raw = value?.[field];

  const result = typeof raw === "number" ? raw : fallback;
  settingsCache.set(cacheKey, { value: result, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  return result;
}

async function getOperationFallbackCostMicros(
  eventType: "generate" | "edit" | "transcribe",
  isVideo: boolean = false
): Promise<UsagePricingMicros> {
  if (eventType === "transcribe") {
    const [rawCostMicros, chargedCostMicros] = await Promise.all([
      getPlatformSettingNumber("transcribe_fallback_pricing", "cost_micros", 1_500),
      getPlatformSettingNumber("transcribe_fallback_pricing", "sell_micros", 4_500),
    ]);
    return { rawCostMicros, chargedCostMicros };
  }

  if (isVideo) {
    const [rawCostMicros, chargedCostMicros] = await Promise.all([
      getPlatformSettingNumber("video_fallback_pricing", "cost_micros", 1_200_000), // $1.20
      getPlatformSettingNumber("video_fallback_pricing", "sell_micros", 3_600_000), // $3.60
    ]);
    return { rawCostMicros, chargedCostMicros };
  }

  const [rawCostMicros, chargedCostMicros] = await Promise.all([
    getPlatformSettingNumber("image_fallback_pricing", "cost_micros", 39_000),
    getPlatformSettingNumber("image_fallback_pricing", "sell_micros", 117_000),
  ]);
  return { rawCostMicros, chargedCostMicros };
}

async function getTokenPricingRate(
  settingKey: string,
  defaultCostPerMillion: number,
  defaultSellPerMillion: number,
): Promise<TokenPricingRate> {
  const [costPerMillion, sellPerMillion] = await Promise.all([
    getPlatformSettingNumber(settingKey, "cost_per_million", defaultCostPerMillion),
    getPlatformSettingNumber(settingKey, "sell_per_million", defaultSellPerMillion),
  ]);

  return {
    costPerMillion: Math.max(costPerMillion, 0),
    sellPerMillion: Math.max(sellPerMillion, 0),
  };
}

async function calculateCostMicros(
  tokens: UsageTokenData,
  eventType: "generate" | "edit" | "transcribe",
  isVideo: boolean = false
): Promise<UsagePricingMicros> {
  const [textIn, textOut, imgIn, imgOut] = await Promise.all([
    getTokenPricingRate("token_pricing_text_input", 0.075, 0.225),
    getTokenPricingRate("token_pricing_text_output", 0.3, 0.9),
    getTokenPricingRate("token_pricing_image_input", 0.075, 0.225),
    getTokenPricingRate("token_pricing_image_output", 0.3, 0.9),
  ]);

  const textRawCost =
    (tokens.text_input_tokens ?? 0) * textIn.costPerMillion +
    (tokens.text_output_tokens ?? 0) * textOut.costPerMillion;
  const textChargedCost =
    (tokens.text_input_tokens ?? 0) * textIn.sellPerMillion +
    (tokens.text_output_tokens ?? 0) * textOut.sellPerMillion;

  if (eventType === "transcribe") {
    return {
      rawCostMicros: Math.round(textRawCost),
      chargedCostMicros: Math.round(textChargedCost),
    };
  }

  const fallbackImageCost = await getOperationFallbackCostMicros(eventType, isVideo);
  if (tokens.image_input_tokens == null || tokens.image_output_tokens == null) {
    return {
      rawCostMicros: Math.round(textRawCost + fallbackImageCost.rawCostMicros),
      chargedCostMicros: Math.round(textChargedCost + fallbackImageCost.chargedCostMicros),
    };
  }

  const imageRawCost =
    (tokens.image_input_tokens ?? 0) * imgIn.costPerMillion +
    (tokens.image_output_tokens ?? 0) * imgOut.costPerMillion;
  const imageChargedCost =
    (tokens.image_input_tokens ?? 0) * imgIn.sellPerMillion +
    (tokens.image_output_tokens ?? 0) * imgOut.sellPerMillion;

  return {
    rawCostMicros: Math.round(textRawCost + imageRawCost),
    chargedCostMicros: Math.round(textChargedCost + imageChargedCost),
  };
}
async function ensureUserCredits(userId: string) {
  const sb = createAdminSupabase();
  const { data: existing } = await sb
    .from("user_credits")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (existing) {
    return existing;
  }

  const { data: created, error } = await sb
    .from("user_credits")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error || !created) {
    throw new Error(error?.message || "Failed to initialize credits");
  }

  return created;
}

async function ensureUserBillingProfile(userId: string) {
  const sb = createAdminSupabase();
  const { data: existing } = await sb
    .from("user_billing_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created, error } = await sb
    .from("user_billing_profiles")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error || !created) {
    throw new Error(error?.message || "Failed to initialize billing profile");
  }

  return created;
}

function getCurrentUtcMonthRange(): { startIso: string; endIso: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function getMonthlyAdditionalUsageMicros(
  userId: string,
  startIso: string,
  endIso: string,
): Promise<number> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("billing_ledger")
    .select("entry_type, amount_micros, metadata")
    .eq("user_id", userId)
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  let total = 0;
  for (const row of data || []) {
    if (row.entry_type === "overage_accrual") {
      total += Math.max(Number(row.amount_micros || 0), 0);
      continue;
    }

    if (row.entry_type !== "manual_adjustment") {
      continue;
    }

    const metadata = row.metadata as Record<string, unknown> | null;
    const kind = String(metadata?.kind || "");
    if (kind === "credit_pack_usage") {
      total += Math.max(Number(row.amount_micros || 0), 0);
    }
  }

  return total;
}

async function estimateBaseCostMicros(
  userId: string,
  eventType: "generate" | "edit" | "transcribe",
  isVideo: boolean = false
): Promise<number> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("usage_events")
    .select("cost_usd_micros, charged_amount_micros")
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .order("created_at", { ascending: false })
    .limit(10);

  const samples = (data || [])
    .map((row) => {
      const charged = row.charged_amount_micros;
      if (typeof charged === "number" && charged > 0) {
        return charged;
      }
      return row.cost_usd_micros;
    })
    .filter((value): value is number => typeof value === "number" && value > 0);

  if (samples.length === 0) {
    const fallback = await getOperationFallbackCostMicros(eventType, isVideo);
    return fallback.chargedCostMicros;
  }

  const total = samples.reduce((sum, value) => sum + value, 0);
  return Math.round(total / samples.length);
}

export async function getMarkupMultiplier(userId: string): Promise<number> {
  // Check if user is referred by an affiliate - they get higher markup
  const sb = createAdminSupabase();
  const { data: profile } = await sb
    .from("profiles")
    .select("referred_by_affiliate_id")
    .eq("id", userId)
    .maybeSingle();

  const settingKey = profile?.referred_by_affiliate_id
    ? "markup_affiliate"
    : "markup_regular";

  const { data } = await sb
    .from("platform_settings")
    .select("setting_value")
    .eq("setting_key", settingKey)
    .maybeSingle();

  const multiplier = Number(data?.setting_value?.multiplier ?? 3);
  return Math.max(multiplier, 1); // Minimum multiplier of 1
}

export async function checkCredits(
  userId: string,
  operationType: "generate" | "edit" | "transcribe",
  isVideo: boolean = false
): Promise<CreditStatus> {
  const billingModel = await getBillingModel();

  if (await usesOwnApiKey(userId)) {
    const credits = await ensureUserCredits(userId);
    return {
      allowed: true,
      balance_micros: credits.balance_micros ?? 0,
      estimated_cost_micros: 0,
      markup_multiplier: 1,
      free_generations_remaining: 0,
      auto_recharge_enabled: false,
      denial_reason: null,
      usage_budget_micros: null,
      usage_budget_remaining_micros: null,
      additional_usage_this_month_micros: 0,
      usage_alert_reached: false,
      usage_budget_reached: false,
    };
  }

  const estimatedBaseCostMicros = await estimateBaseCostMicros(userId, operationType, isVideo);
  const estimatedCostMicros = Math.max(Math.round(estimatedBaseCostMicros), 0);

  if (billingModel === "subscription_overage") {
    const [billingProfile, credits] = await Promise.all([
      ensureUserBillingProfile(userId),
      ensureUserCredits(userId),
    ]);

    // Check free generations first (works regardless of subscription status)
    const freeGenerationsRemaining = Math.max(
      (credits.free_generations_limit ?? 0) - (credits.free_generations_used ?? 0),
      0,
    );
    if (freeGenerationsRemaining > 0) {
      return {
        allowed: true,
        balance_micros: credits.balance_micros ?? 0,
        estimated_cost_micros: 0,
        markup_multiplier: 1,
        free_generations_remaining: freeGenerationsRemaining,
        auto_recharge_enabled: false,
        denial_reason: null,
        usage_budget_micros: null,
        usage_budget_remaining_micros: null,
        additional_usage_this_month_micros: 0,
        usage_alert_reached: false,
        usage_budget_reached: false,
      };
    }

    const status = String(billingProfile.subscription_status || "");
    const hasActiveSubscription =
      status === "active" || status === "trialing" || status === "past_due";
    const includedRemaining = billingProfile.included_credits_remaining_micros ?? 0;
    const creditPackBalance = credits.balance_micros ?? 0;
    const availableCredits = includedRemaining + creditPackBalance;
    const estimatedAdditionalMicros = Math.max(estimatedCostMicros - availableCredits, 0);

    const { startIso, endIso } = getCurrentUtcMonthRange();
    const additionalUsageThisMonthMicros = await getMonthlyAdditionalUsageMicros(userId, startIso, endIso);
    const usageAlertMicros = Math.max(Number(billingProfile.usage_alert_micros ?? 0), 0);
    const usageBudgetMicros = billingProfile.usage_budget_enabled
      ? Math.max(Number(billingProfile.usage_budget_micros ?? 0), 0)
      : 0;
    const usageAlertReached = usageAlertMicros > 0 && additionalUsageThisMonthMicros >= usageAlertMicros;
    const usageBudgetReachedNow = usageBudgetMicros > 0 && additionalUsageThisMonthMicros >= usageBudgetMicros;
    const usageBudgetWouldExceed =
      usageBudgetMicros > 0 &&
      additionalUsageThisMonthMicros + estimatedAdditionalMicros > usageBudgetMicros;
    const usageBudgetRemainingMicros =
      usageBudgetMicros > 0
        ? Math.max(usageBudgetMicros - additionalUsageThisMonthMicros, 0)
        : null;
    const budgetBlocked = usageBudgetReachedNow || usageBudgetWouldExceed;
    const denialReason = !hasActiveSubscription
      ? "upgrade_required"
      : budgetBlocked
        ? "usage_budget_reached"
        : null;

    return {
      allowed: hasActiveSubscription && !budgetBlocked,
      balance_micros: availableCredits,
      estimated_cost_micros: estimatedCostMicros,
      markup_multiplier: 1,
      free_generations_remaining: 0,
      auto_recharge_enabled: false,
      denial_reason: denialReason,
      usage_budget_micros: usageBudgetMicros > 0 ? usageBudgetMicros : null,
      usage_budget_remaining_micros: usageBudgetRemainingMicros,
      additional_usage_this_month_micros: additionalUsageThisMonthMicros,
      usage_alert_reached: usageAlertReached,
      usage_budget_reached: usageBudgetReachedNow,
    };
  }

  const credits = await ensureUserCredits(userId);
  const freeGenerationsRemaining = Math.max(
    (credits.free_generations_limit ?? 0) - (credits.free_generations_used ?? 0),
    0,
  );

  if (freeGenerationsRemaining > 0) {
    return {
      allowed: true,
      balance_micros: credits.balance_micros ?? 0,
      estimated_cost_micros: 0,
      markup_multiplier: 1,
      free_generations_remaining: freeGenerationsRemaining,
      auto_recharge_enabled: credits.auto_recharge_enabled ?? false,
      denial_reason: null,
      usage_budget_micros: null,
      usage_budget_remaining_micros: null,
      additional_usage_this_month_micros: 0,
      usage_alert_reached: false,
      usage_budget_reached: false,
    };
  }

  return {
    allowed: (credits.balance_micros ?? 0) >= estimatedCostMicros,
    balance_micros: credits.balance_micros ?? 0,
    estimated_cost_micros: estimatedCostMicros,
    markup_multiplier: 1,
    free_generations_remaining: 0,
    auto_recharge_enabled: credits.auto_recharge_enabled ?? false,
    denial_reason: null,
    usage_budget_micros: null,
    usage_budget_remaining_micros: null,
    additional_usage_this_month_micros: 0,
    usage_alert_reached: false,
    usage_budget_reached: false,
  };
}

export async function triggerAutoRecharge(userId: string): Promise<boolean> {
  if ((await getBillingModel()) !== "credits_topup") {
    return false;
  }

  const credits = await ensureUserCredits(userId);

  if (!credits.auto_recharge_enabled) {
    return false;
  }

  if ((credits.balance_micros ?? 0) >= (credits.auto_recharge_threshold_micros ?? 0)) {
    return false;
  }

  try {
    return await chargeAutoRecharge(userId);
  } catch {
    return false;
  }
}

export async function deductCredits(
  userId: string,
  usageEventId: string,
  rawCostMicros: number,
  chargedCostMicros: number,
): Promise<void> {
  const sb = createAdminSupabase();
  const billingModel = await getBillingModel();
  const is_admin_or_affiliate = await usesOwnApiKey(userId);

  let affiliateId: string | null = null;
  if (!is_admin_or_affiliate) {
    const { data: profile } = await sb
      .from("profiles")
      .select("referred_by_affiliate_id")
      .eq("id", userId)
      .maybeSingle();
    affiliateId = profile?.referred_by_affiliate_id ?? null;
  }

  // Calculate markup multiplier from charged vs raw cost
  const markupMultiplier = rawCostMicros > 0
    ? Math.round((chargedCostMicros / rawCostMicros) * 100) / 100
    : 1;

  // RPC parameter names must match the SQL function signature exactly
  // SQL expects: p_base_cost_micros, p_markup_multiplier (NOT p_raw_cost_micros, p_charged_cost_micros)
  const { error } = await sb.rpc("process_usage_deduction_tx", {
    p_user_id: userId,
    p_usage_event_id: usageEventId,
    p_base_cost_micros: rawCostMicros,           // FIXED: was p_raw_cost_micros
    p_markup_multiplier: markupMultiplier,        // FIXED: was p_charged_cost_micros
    p_billing_model: billingModel,
    p_is_admin_or_affiliate: is_admin_or_affiliate,
    p_affiliate_id: affiliateId
  });

  if (error) {
    console.error("RPC Error in deductCredits:", error);
    throw new Error(`Failed to deduct credits: ${error.message}`);
  }

  if (billingModel === "credits_topup") {
    await triggerAutoRecharge(userId);
  }

  if (affiliateId && chargedCostMicros > rawCostMicros && !is_admin_or_affiliate) {
    await processAffiliatePayoutIfEligible(affiliateId);
  }
}

export async function getCreditsState(
  userId: string,
  operationType: "generate" | "edit" | "transcribe" = "generate",
) {
  const credits = await ensureUserCredits(userId);
  const status = await checkCredits(userId, operationType);

  return { credits, status };
}

export async function recordUsageEvent(
  userId: string,
  postId: string | null,
  eventType: "generate" | "edit" | "transcribe",
  tokens?: UsageTokenData,
  models?: UsageModelData,
): Promise<RecordedUsageEvent> {
  const sb = createAdminSupabase();
  const isVideo = models?.image_model === "veo-3.1-generate-preview";

  const pricing = tokens
    ? await calculateCostMicros(tokens, eventType, isVideo)
    : await getOperationFallbackCostMicros(eventType, isVideo);

  const { data, error } = await sb
    .from("usage_events")
    .insert({
      user_id: userId,
      post_id: postId ?? null,
      event_type: eventType,
      text_input_tokens: tokens?.text_input_tokens ?? null,
      text_output_tokens: tokens?.text_output_tokens ?? null,
      image_input_tokens: tokens?.image_input_tokens ?? null,
      image_output_tokens: tokens?.image_output_tokens ?? null,
      text_model: models?.text_model ?? null,
      image_model: models?.image_model ?? null,
      cost_usd_micros: pricing.rawCostMicros,
      charged_amount_micros: pricing.chargedCostMicros,
    })
    .select("id, cost_usd_micros, charged_amount_micros")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to record usage event");
  }

  return {
    id: data.id,
    cost_usd_micros: data.cost_usd_micros ?? pricing.rawCostMicros,
    charged_amount_micros: data.charged_amount_micros ?? pricing.chargedCostMicros,
  };
}

export async function getMinimumRechargeMicros(): Promise<number> {
  return getPlatformSettingNumber("min_recharge_micros", "amount", 10_000_000);
}
