import { createAdminSupabase } from "./supabase";

export interface QuotaStatus {
  allowed: boolean;
  used: number;
  limit: number | null; // null = unlimited
  plan: string;
}

export interface UsageTokenData {
  text_input_tokens?:  number; // gemini-2.5-flash prompt tokens (text phase)
  text_output_tokens?: number; // gemini-2.5-flash output tokens (text phase)
  image_input_tokens?:  number; // gemini-2.5-flash-image prompt tokens (image phase)
  image_output_tokens?: number; // gemini-2.5-flash-image output tokens (image phase)
}

// Gemini pricing in micro-dollars per token (1 USD = 1_000_000 micro-dollars)
// Source: https://ai.google.dev/pricing
// gemini-2.5-flash (text model)
const TEXT_INPUT_PRICE_PER_TOKEN  = 0.075;  // $0.075 / 1M tokens → 0.075 µUSD/token
const TEXT_OUTPUT_PRICE_PER_TOKEN = 0.300;  // $0.300 / 1M tokens → 0.300 µUSD/token
// gemini-3.1-flash-image-preview (image model) — priced as image tokens
const IMAGE_INPUT_PRICE_PER_TOKEN  = 0.075; // image input tokens (same tier as flash input)
const IMAGE_OUTPUT_PRICE_PER_TOKEN = 0.300; // image output tokens (same tier as flash output)
// Fallback flat cost when the model does not return token metadata
const IMAGE_FALLBACK_COST_MICROS  = 39_000; // ~$0.039 per generated image

function calculateCostMicros(tokens: UsageTokenData, eventType: "generate" | "edit" | "transcribe"): number {
  const textCost =
    (tokens.text_input_tokens  ?? 0) * TEXT_INPUT_PRICE_PER_TOKEN +
    (tokens.text_output_tokens ?? 0) * TEXT_OUTPUT_PRICE_PER_TOKEN;

  // Transcribe only uses the text model — no image cost
  if (eventType === "transcribe") {
    return Math.round(textCost);
  }

  // Image model cost: use token counts when available, otherwise flat fallback
  const imageCost =
    tokens.image_input_tokens != null
      ? (tokens.image_input_tokens  ?? 0) * IMAGE_INPUT_PRICE_PER_TOKEN +
        (tokens.image_output_tokens ?? 0) * IMAGE_OUTPUT_PRICE_PER_TOKEN
      : IMAGE_FALLBACK_COST_MICROS;

  return Math.round(textCost + imageCost);
}

// Verifies whether a user is allowed to generate/edit based on their current plan
export async function checkQuota(userId: string): Promise<QuotaStatus> {
  const sb = createAdminSupabase();

  const { data: sub } = await sb
    .from("user_subscriptions")
    .select("status, current_period_start, subscription_plans(name, monthly_limit)")
    .eq("user_id", userId)
    .single();

  const planName: string = (sub?.subscription_plans as any)?.name ?? "free_trial";
  const monthlyLimit: number | null = (sub?.subscription_plans as any)?.monthly_limit ?? 3;

  // Unlimited plan
  if (monthlyLimit === null) {
    return { allowed: true, used: 0, limit: null, plan: planName };
  }

  // Determine the start of the current billing period
  let periodStart: string;
  if (sub?.current_period_start) {
    periodStart = sub.current_period_start;
  } else {
    // Free trial: count from the 1st of the current month
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    periodStart = start.toISOString();
  }

  const { count } = await sb
    .from("usage_events")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", periodStart);

  const used = count ?? 0;

  return {
    allowed: used < monthlyLimit,
    used,
    limit: monthlyLimit,
    plan: planName,
  };
}

// Records a usage event with token counts and estimated cost after a successful generation, edit, or transcription
export async function recordUsageEvent(
  userId: string,
  postId: string | null,
  eventType: "generate" | "edit" | "transcribe",
  tokens?: UsageTokenData,
): Promise<void> {
  const sb = createAdminSupabase();

  const cost_usd_micros = tokens ? calculateCostMicros(tokens, eventType) : null;

  await sb.from("usage_events").insert({
    user_id: userId,
    post_id: postId ?? null,
    event_type: eventType,
    text_input_tokens:   tokens?.text_input_tokens  ?? null,
    text_output_tokens:  tokens?.text_output_tokens ?? null,
    image_input_tokens:  tokens?.image_input_tokens  ?? null,
    image_output_tokens: tokens?.image_output_tokens ?? null,
    cost_usd_micros,
  });
}
