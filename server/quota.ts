import { createAdminSupabase } from "./supabase.js";
import { chargeAutoRecharge, processAffiliatePayoutIfEligible } from "./stripe.js";

export interface CreditStatus {
  allowed: boolean;
  balance_micros: number;
  estimated_cost_micros: number;
  markup_multiplier: number;
  free_generations_remaining: number;
  auto_recharge_enabled: boolean;
}

export interface UsageTokenData {
  text_input_tokens?: number;
  text_output_tokens?: number;
  image_input_tokens?: number;
  image_output_tokens?: number;
}

export interface RecordedUsageEvent {
  id: string;
  cost_usd_micros: number;
}

const TEXT_INPUT_PRICE_PER_TOKEN = 0.075;
const TEXT_OUTPUT_PRICE_PER_TOKEN = 0.3;
const IMAGE_INPUT_PRICE_PER_TOKEN = 0.075;
const IMAGE_OUTPUT_PRICE_PER_TOKEN = 0.3;
const IMAGE_FALLBACK_COST_MICROS = 39_000;
const TRANSCRIBE_FALLBACK_COST_MICROS = 1_500;

async function usesOwnApiKey(userId: string): Promise<boolean> {
  const sb = createAdminSupabase();
  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin, is_affiliate")
    .eq("id", userId)
    .maybeSingle();

  return profile?.is_admin === true || profile?.is_affiliate === true;
}

function getOperationFallbackCostMicros(
  eventType: "generate" | "edit" | "transcribe",
): number {
  if (eventType === "transcribe") {
    return TRANSCRIBE_FALLBACK_COST_MICROS;
  }

  return IMAGE_FALLBACK_COST_MICROS;
}

function calculateCostMicros(
  tokens: UsageTokenData,
  eventType: "generate" | "edit" | "transcribe",
): number {
  const textCost =
    (tokens.text_input_tokens ?? 0) * TEXT_INPUT_PRICE_PER_TOKEN +
    (tokens.text_output_tokens ?? 0) * TEXT_OUTPUT_PRICE_PER_TOKEN;

  if (eventType === "transcribe") {
    return Math.round(textCost);
  }

  const imageCost =
    tokens.image_input_tokens != null
      ? (tokens.image_input_tokens ?? 0) * IMAGE_INPUT_PRICE_PER_TOKEN +
        (tokens.image_output_tokens ?? 0) * IMAGE_OUTPUT_PRICE_PER_TOKEN
      : IMAGE_FALLBACK_COST_MICROS;

  return Math.round(textCost + imageCost);
}

async function getPlatformSettingNumber(
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

async function estimateBaseCostMicros(
  userId: string,
  eventType: "generate" | "edit" | "transcribe",
): Promise<number> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("usage_events")
    .select("cost_usd_micros")
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .not("cost_usd_micros", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);

  const samples = (data || [])
    .map((row) => row.cost_usd_micros)
    .filter((value): value is number => typeof value === "number" && value > 0);

  if (samples.length === 0) {
    return getOperationFallbackCostMicros(eventType);
  }

  const total = samples.reduce((sum, value) => sum + value, 0);
  return Math.round(total / samples.length);
}

export async function getMarkupMultiplier(userId: string): Promise<number> {
  const sb = createAdminSupabase();
  const { data: profile } = await sb
    .from("profiles")
    .select("referred_by_affiliate_id")
    .eq("id", userId)
    .single();

  if (profile?.referred_by_affiliate_id) {
    return getPlatformSettingNumber("markup_affiliate", "multiplier", 4);
  }

  return getPlatformSettingNumber("markup_regular", "multiplier", 3);
}

export async function checkCredits(
  userId: string,
  operationType: "generate" | "edit" | "transcribe",
): Promise<CreditStatus> {
  const credits = await ensureUserCredits(userId);

  if (await usesOwnApiKey(userId)) {
    return {
      allowed: true,
      balance_micros: credits.balance_micros ?? 0,
      estimated_cost_micros: 0,
      markup_multiplier: 1,
      free_generations_remaining: 0,
      auto_recharge_enabled: false,
    };
  }

  const freeGenerationsRemaining = Math.max(
    (credits.free_generations_limit ?? 0) - (credits.free_generations_used ?? 0),
    0,
  );
  const markupMultiplier = await getMarkupMultiplier(userId);
  const estimatedBaseCostMicros = await estimateBaseCostMicros(userId, operationType);
  const estimatedCostMicros = Math.max(
    Math.round(estimatedBaseCostMicros * markupMultiplier),
    0,
  );

  if (freeGenerationsRemaining > 0) {
    return {
      allowed: true,
      balance_micros: credits.balance_micros ?? 0,
      estimated_cost_micros: 0,
      markup_multiplier: markupMultiplier,
      free_generations_remaining: freeGenerationsRemaining,
      auto_recharge_enabled: credits.auto_recharge_enabled ?? false,
    };
  }

  return {
    allowed: (credits.balance_micros ?? 0) >= estimatedCostMicros,
    balance_micros: credits.balance_micros ?? 0,
    estimated_cost_micros: estimatedCostMicros,
    markup_multiplier: markupMultiplier,
    free_generations_remaining: 0,
    auto_recharge_enabled: credits.auto_recharge_enabled ?? false,
  };
}

export async function triggerAutoRecharge(userId: string): Promise<boolean> {
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
  baseCostMicros: number,
  markupMultiplier: number,
): Promise<void> {
  const sb = createAdminSupabase();
  const credits = await ensureUserCredits(userId);
  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin, is_affiliate, referred_by_affiliate_id")
    .eq("id", userId)
    .single();

  if (profile?.is_admin === true || profile?.is_affiliate === true) {
    await sb
      .from("usage_events")
      .update({
        charged_amount_micros: 0,
        affiliate_commission_micros: 0,
        markup_multiplier: 0,
      })
      .eq("id", usageEventId);

    return;
  }

  const balanceBefore = credits.balance_micros ?? 0;
  const freeGenerationsRemaining = Math.max(
    (credits.free_generations_limit ?? 0) - (credits.free_generations_used ?? 0),
    0,
  );

  if (freeGenerationsRemaining > 0) {
    await sb
      .from("user_credits")
      .update({
        free_generations_used: (credits.free_generations_used ?? 0) + 1,
      })
      .eq("user_id", userId);

    await sb
      .from("usage_events")
      .update({
        charged_amount_micros: 0,
        affiliate_commission_micros: 0,
        markup_multiplier: markupMultiplier,
      })
      .eq("id", usageEventId);

    return;
  }

  const chargedAmountMicros = Math.max(
    Math.round(Math.max(baseCostMicros, 0) * markupMultiplier),
    0,
  );

  if (balanceBefore < chargedAmountMicros) {
    throw new Error("Insufficient credits");
  }

  const balanceAfter = balanceBefore - chargedAmountMicros;
  const affiliateId = profile?.referred_by_affiliate_id ?? null;
  const affiliateCommissionMicros = affiliateId ? Math.max(baseCostMicros, 0) : 0;

  await sb
    .from("user_credits")
    .update({
      balance_micros: balanceAfter,
      lifetime_used_micros: (credits.lifetime_used_micros ?? 0) + chargedAmountMicros,
    })
    .eq("user_id", userId);

  await sb
    .from("credit_transactions")
    .insert({
      user_id: userId,
      type: "usage",
      amount_micros: -chargedAmountMicros,
      balance_before_micros: balanceBefore,
      balance_after_micros: balanceAfter,
      usage_event_id: usageEventId,
      description: "Usage charge",
      metadata: {
        base_cost_micros: Math.max(baseCostMicros, 0),
        markup_multiplier: markupMultiplier,
        affiliate_commission_micros: affiliateCommissionMicros,
      },
    });

  await sb
    .from("usage_events")
    .update({
      charged_amount_micros: chargedAmountMicros,
      affiliate_commission_micros: affiliateCommissionMicros,
      markup_multiplier: markupMultiplier,
    })
    .eq("id", usageEventId);

  if (affiliateId && affiliateCommissionMicros > 0) {
    const { data: existingAffiliate } = await sb
      .from("affiliate_settings")
      .select("*")
      .eq("user_id", affiliateId)
      .maybeSingle();

    if (existingAffiliate) {
      await sb
        .from("affiliate_settings")
        .update({
          total_commission_earned_micros:
            (existingAffiliate.total_commission_earned_micros ?? 0) + affiliateCommissionMicros,
          pending_commission_micros:
            (existingAffiliate.pending_commission_micros ?? 0) + affiliateCommissionMicros,
        })
        .eq("user_id", affiliateId);
    } else {
      await sb
        .from("affiliate_settings")
        .insert({
          user_id: affiliateId,
          total_commission_earned_micros: affiliateCommissionMicros,
          pending_commission_micros: affiliateCommissionMicros,
        });
    }

    await sb
      .from("credit_transactions")
      .insert({
        user_id: affiliateId,
        type: "affiliate_commission",
        amount_micros: affiliateCommissionMicros,
        balance_before_micros: 0,
        balance_after_micros: 0,
        usage_event_id: usageEventId,
        description: "Affiliate commission accrued",
        metadata: {
          source_user_id: userId,
        },
      });

    await processAffiliatePayoutIfEligible(affiliateId);
  }

  await triggerAutoRecharge(userId);
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
): Promise<RecordedUsageEvent> {
  const sb = createAdminSupabase();
  const cost_usd_micros = tokens
    ? calculateCostMicros(tokens, eventType)
    : getOperationFallbackCostMicros(eventType);

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
      cost_usd_micros,
    })
    .select("id, cost_usd_micros")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to record usage event");
  }

  return {
    id: data.id,
    cost_usd_micros: data.cost_usd_micros ?? cost_usd_micros,
  };
}

export async function getMinimumRechargeMicros(): Promise<number> {
  return getPlatformSettingNumber("min_recharge_micros", "amount", 10_000_000);
}
