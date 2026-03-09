/**
 * Billing Routes - subscription + overage model
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase.js";
import {
  authenticateUser,
  AuthenticatedRequest,
  requireAdminGuard,
} from "../middleware/auth.middleware.js";
import {
  adminBillingSettingsSchema,
  billingLedgerResponseSchema,
  billingMeResponseSchema,
  billingOverviewResponseSchema,
  billingResourceUsageResponseSchema,
  billingStatementResponseSchema,
  billingSpendingControlsSchema,
  purchaseCreditsRequestSchema,
  subscribeRequestSchema,
  subscribeResponseSchema,
  billingPortalResponseSchema,
  updateAdminBillingSettingsRequestSchema,
  updateBillingSpendingControlsRequestSchema,
  updateBillingPlanRequestSchema,
} from "../../shared/schema.js";
import {
  createCreditCheckoutSession,
  createBillingPortalSession,
  createSubscriptionCheckoutSession,
  getBillingModel,
  getOverageBillingCadenceDays,
  getOverageMinimumInvoiceMicros,
  runOverageBillingBatch,
} from "../stripe.js";
import { getMinimumRechargeMicros } from "../quota.js";

const router = Router();
const CREDIT_PACK_OPTIONS_MICROS = [10_000_000, 25_000_000, 50_000_000, 100_000_000, 250_000_000];

function getCurrentUtcMonthRange(): { startIso: string; endIso: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function toMicros(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(Math.floor(numeric), 0);
}

function metadataKind(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }
  return String((metadata as Record<string, unknown>).kind || "").trim().toLowerCase();
}

function computeNextOverageBillingAt(lastBilledAt: string | null | undefined, cadenceDays: number): string {
  const base = lastBilledAt ? new Date(lastBilledAt) : new Date();
  const next = new Date(base.getTime() + cadenceDays * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

async function getBillingSettingValue(
  key: string,
  fallback: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("billing_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();

  if (data?.setting_value && typeof data.setting_value === "object") {
    return data.setting_value as Record<string, unknown>;
  }

  return fallback;
}

async function ensureBillingProfile(sb: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { data: existing } = await sb
    .from("user_billing_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created, error: createError } = await sb
    .from("user_billing_profiles")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (createError || !created) {
    throw new Error(createError?.message || "Failed to create billing profile");
  }

  return created;
}

async function ensureProfilePlan(
  sb: ReturnType<typeof createAdminSupabase>,
  userId: string,
): Promise<{ profile: any; plan: any | null }> {
  let profile = await ensureBillingProfile(sb, userId);

  if (!profile.billing_plan_id) {
    const defaultPlan = await getBillingSettingValue("default_plan_key", { value: "core" });
    const defaultPlanKey = String(defaultPlan.value || "core");
    const { data: planByKey } = await sb
      .from("billing_plans")
      .select("id")
      .eq("plan_key", defaultPlanKey)
      .eq("active", true)
      .maybeSingle();

    if (planByKey?.id) {
      const { data: updatedProfile } = await sb
        .from("user_billing_profiles")
        .update({ billing_plan_id: planByKey.id })
        .eq("user_id", userId)
        .select("*")
        .single();
      profile = updatedProfile || profile;
    }
  }

  let plan = null;
  if (profile.billing_plan_id) {
    const { data } = await sb
      .from("billing_plans")
      .select("*")
      .eq("id", profile.billing_plan_id)
      .maybeSingle();
    plan = data || null;
  }

  return { profile, plan };
}

async function getBillingOverview(
  sb: ReturnType<typeof createAdminSupabase>,
  userId: string,
  profile: any,
  plan: any | null,
) {
  const { startIso, endIso } = getCurrentUtcMonthRange();
  const [{ data: ledgerRows }, { data: creditsRow }, { data: bonusRows }] = await Promise.all([
    sb
      .from("billing_ledger")
      .select("entry_type, amount_micros, metadata")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    sb
      .from("user_credits")
      .select("balance_micros")
      .eq("user_id", userId)
      .maybeSingle(),
    sb
      .from("credit_transactions")
      .select("amount_micros, metadata")
      .eq("user_id", userId)
      .eq("type", "bonus")
      .limit(500),
  ]);

  let includedUsedThisMonthMicros = 0;
  let overageAccruedThisMonthMicros = 0;
  let creditPackUsedThisMonthMicros = 0;

  for (const row of ledgerRows || []) {
    if (row.entry_type === "included_credit_usage") {
      includedUsedThisMonthMicros += Math.abs(Math.min(Number(row.amount_micros || 0), 0));
      continue;
    }

    if (row.entry_type === "overage_accrual") {
      overageAccruedThisMonthMicros += Math.max(Number(row.amount_micros || 0), 0);
      continue;
    }

    if (row.entry_type === "manual_adjustment" && metadataKind(row.metadata) === "credit_pack_usage") {
      creditPackUsedThisMonthMicros += Math.max(Number(row.amount_micros || 0), 0);
    }
  }

  let promotionalCreditsMicros = 0;
  let giftedCreditsMicros = 0;
  for (const row of bonusRows || []) {
    const amountMicros = Math.max(Number(row.amount_micros || 0), 0);
    if (amountMicros <= 0) {
      continue;
    }

    const kind = metadataKind(row.metadata);
    if (kind === "gift" || kind === "gifted_credit") {
      giftedCreditsMicros += amountMicros;
    } else {
      promotionalCreditsMicros += amountMicros;
    }
  }

  const includedRemainingMicros = toMicros(profile.included_credits_remaining_micros);
  const includedTotalMicros = Math.max(toMicros(plan?.included_credits_micros), includedRemainingMicros);
  const creditPackBalanceMicros = toMicros(creditsRow?.balance_micros);
  const additionalUsageThisMonthMicros = overageAccruedThisMonthMicros + creditPackUsedThisMonthMicros;
  const usageAlertMicros = toMicros(profile.usage_alert_micros);
  const usageBudgetEnabled = Boolean(profile.usage_budget_enabled);
  const usageBudgetMicros = usageBudgetEnabled ? toMicros(profile.usage_budget_micros) : 0;
  const alertReached = usageAlertMicros > 0 && additionalUsageThisMonthMicros >= usageAlertMicros;
  const budgetReached = usageBudgetMicros > 0 && additionalUsageThisMonthMicros >= usageBudgetMicros;
  const budgetRemainingMicros = usageBudgetMicros > 0
    ? Math.max(usageBudgetMicros - additionalUsageThisMonthMicros, 0)
    : null;

  return billingOverviewResponseSchema.parse({
    total_available_credits_micros: includedRemainingMicros + creditPackBalanceMicros,
    included_total_micros: includedTotalMicros,
    included_remaining_micros: includedRemainingMicros,
    included_used_this_month_micros: includedUsedThisMonthMicros,
    additional_usage_this_month_micros: additionalUsageThisMonthMicros,
    overage_accrued_this_month_micros: overageAccruedThisMonthMicros,
    credit_pack_used_this_month_micros: creditPackUsedThisMonthMicros,
    credit_pack_balance_micros: creditPackBalanceMicros,
    promotional_credits_micros: promotionalCreditsMicros,
    gifted_credits_micros: giftedCreditsMicros,
    month_start: startIso,
    month_end: endIso,
    cycle_resets_at: profile.current_period_end ?? null,
    controls: {
      usage_alert_micros: usageAlertMicros > 0 ? usageAlertMicros : null,
      usage_budget_micros: usageBudgetMicros > 0 ? usageBudgetMicros : null,
      usage_budget_enabled: usageBudgetEnabled,
      alert_reached: alertReached,
      budget_reached: budgetReached,
      budget_remaining_micros: budgetRemainingMicros,
    },
    credit_pack_options_micros: CREDIT_PACK_OPTIONS_MICROS,
  });
}

router.get("/api/billing/me", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const { user } = authResult;
  const sb = createAdminSupabase();

  try {
    const [{ profile, plan }, cadenceDays, minInvoiceMicros, billingModel] = await Promise.all([
      ensureProfilePlan(sb, user.id),
      getOverageBillingCadenceDays(),
      getOverageMinimumInvoiceMicros(),
      getBillingModel(),
    ]);

    const payload = billingMeResponseSchema.parse({
      profile,
      plan,
      next_overage_billing_at: computeNextOverageBillingAt(profile.overage_last_billed_at, cadenceDays),
      overage_billing_cadence_days: cadenceDays,
      overage_min_invoice_micros: minInvoiceMicros,
      billing_model: billingModel,
    });

    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to load billing profile" });
  }
});

router.get("/api/billing/ledger", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const { user } = authResult;
  const sb = createAdminSupabase();
  const { data, error } = await sb
    .from("billing_ledger")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    res.status(500).json({ message: error.message || "Failed to load billing ledger" });
    return;
  }

  res.json(billingLedgerResponseSchema.parse({ entries: data || [] }));
});

router.get("/api/billing/overview", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const sb = createAdminSupabase();
  try {
    const { profile, plan } = await ensureProfilePlan(sb, authResult.user.id);
    const overview = await getBillingOverview(sb, authResult.user.id, profile, plan);
    res.json(overview);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to load billing overview" });
  }
});

router.patch("/api/billing/controls", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const parseResult = updateBillingSpendingControlsRequestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    res.status(400).json({ message: "Invalid spending controls payload" });
    return;
  }

  const payload = parseResult.data;
  const sb = createAdminSupabase();
  await ensureBillingProfile(sb, authResult.user.id);
  const { error } = await sb
    .from("user_billing_profiles")
    .update({
      usage_alert_micros: payload.usage_alert_micros,
      usage_budget_micros: payload.usage_budget_micros,
      usage_budget_enabled: payload.usage_budget_enabled,
    })
    .eq("user_id", authResult.user.id);

  if (error) {
    res.status(500).json({ message: error.message || "Failed to update spending controls" });
    return;
  }

  try {
    const { profile, plan } = await ensureProfilePlan(sb, authResult.user.id);
    const overview = await getBillingOverview(sb, authResult.user.id, profile, plan);
    res.json(billingSpendingControlsSchema.parse(overview.controls));
  } catch (overviewError: any) {
    res.status(500).json({ message: overviewError.message || "Failed to refresh spending controls" });
  }
});

router.get("/api/billing/resource-usage", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const sb = createAdminSupabase();
  const { startIso, endIso } = getCurrentUtcMonthRange();
  const { data, error } = await sb
    .from("usage_events")
    .select("event_type, charged_amount_micros, cost_usd_micros")
    .eq("user_id", authResult.user.id)
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  if (error) {
    res.status(500).json({ message: error.message || "Failed to load resource usage" });
    return;
  }

  const usageMap: Record<"generate" | "edit" | "transcribe", {
    usage_count: number;
    usage_total_micros: number;
    cost_accrued_micros: number;
  }> = {
    generate: { usage_count: 0, usage_total_micros: 0, cost_accrued_micros: 0 },
    edit: { usage_count: 0, usage_total_micros: 0, cost_accrued_micros: 0 },
    transcribe: { usage_count: 0, usage_total_micros: 0, cost_accrued_micros: 0 },
  };

  for (const row of data || []) {
    const eventType = row.event_type as "generate" | "edit" | "transcribe" | null;
    if (eventType !== "generate" && eventType !== "edit" && eventType !== "transcribe") {
      continue;
    }
    const chargedMicros = toMicros(row.charged_amount_micros);
    const fallbackMicros = toMicros(row.cost_usd_micros);
    const lineMicros = chargedMicros > 0 ? chargedMicros : fallbackMicros;
    usageMap[eventType].usage_count += 1;
    usageMap[eventType].usage_total_micros += lineMicros;
    usageMap[eventType].cost_accrued_micros += lineMicros;
  }

  const labels: Record<"generate" | "edit" | "transcribe", string> = {
    generate: "AI Generation",
    edit: "AI Editing",
    transcribe: "AI Transcription",
  };

  const items = (["generate", "edit", "transcribe"] as const).map((key) => ({
    resource_key: key,
    label: labels[key],
    usage_count: usageMap[key].usage_count,
    usage_total_micros: usageMap[key].usage_total_micros,
    unit_price_label: "Variable",
    cost_accrued_micros: usageMap[key].cost_accrued_micros,
  }));
  const totalCostAccruedMicros = items.reduce((sum, item) => sum + item.cost_accrued_micros, 0);

  res.json(billingResourceUsageResponseSchema.parse({
    items,
    total_cost_accrued_micros: totalCostAccruedMicros,
    month_start: startIso,
    month_end: endIso,
  }));
});

router.get("/api/billing/statement", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const sb = createAdminSupabase();
  const { data: events, error: eventsError } = await sb
    .from("usage_events")
    .select("id, post_id, event_type, text_input_tokens, text_output_tokens, image_input_tokens, image_output_tokens, cost_usd_micros, charged_amount_micros, affiliate_commission_micros, created_at")
    .eq("user_id", authResult.user.id)
    .order("created_at", { ascending: false });

  if (eventsError) {
    res.status(500).json({ message: eventsError.message || "Failed to load billing statement" });
    return;
  }

  const usageEventIds = (events || []).map((row) => row.id);
  const postIds = Array.from(new Set((events || []).map((row) => row.post_id).filter((id): id is string => typeof id === "string")));

  const [postsResult, ledgerResult] = await Promise.all([
    postIds.length > 0
      ? sb.from("posts").select("id, content_type").in("id", postIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    usageEventIds.length > 0
      ? sb
          .from("billing_ledger")
          .select("usage_event_id, entry_type, amount_micros, metadata")
          .in("usage_event_id", usageEventIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  if (postsResult.error) {
    res.status(500).json({ message: postsResult.error.message || "Failed to load statement post metadata" });
    return;
  }

  if (ledgerResult.error) {
    res.status(500).json({ message: ledgerResult.error.message || "Failed to load statement ledger rows" });
    return;
  }

  const posts = postsResult.data || [];
  const ledgerRows = ledgerResult.data || [];

  const postContentTypeById = new Map<string, "image" | "video">();
  for (const post of posts) {
    const contentType = post.content_type === "video" ? "video" : "image";
    postContentTypeById.set(post.id, contentType);
  }

  const ledgerByUsageEvent = new Map<string, Array<{ entry_type: string; amount_micros: number; metadata: unknown }>>();
  for (const row of ledgerRows) {
    const usageEventId = String(row.usage_event_id || "");
    if (!usageEventId) {
      continue;
    }
    const list = ledgerByUsageEvent.get(usageEventId) || [];
    list.push({
      entry_type: String(row.entry_type || ""),
      amount_micros: Number(row.amount_micros || 0),
      metadata: row.metadata,
    });
    ledgerByUsageEvent.set(usageEventId, list);
  }

  const items = (events || []).map((event) => {
    const inputTokens = toMicros(event.text_input_tokens) + toMicros(event.image_input_tokens);
    const outputTokens = toMicros(event.text_output_tokens) + toMicros(event.image_output_tokens);
    const totalTokens = inputTokens + outputTokens;

    const rawCostMicros = toMicros(event.cost_usd_micros);
    const chargedCostMicros = toMicros(event.charged_amount_micros);
    const grossProfitMicros = Math.max(chargedCostMicros - rawCostMicros, 0);
    const affiliateCommissionMicros = toMicros(event.affiliate_commission_micros);
    const platformNetMicros = Math.max(grossProfitMicros - affiliateCommissionMicros, 0);

    let includedUsageMicros = 0;
    let creditPackUsageMicros = 0;
    let overageUsageMicros = 0;

    for (const ledger of ledgerByUsageEvent.get(event.id) || []) {
      if (ledger.entry_type === "included_credit_usage") {
        includedUsageMicros += Math.abs(Math.min(ledger.amount_micros, 0));
        continue;
      }

      if (ledger.entry_type === "overage_accrual") {
        overageUsageMicros += Math.max(ledger.amount_micros, 0);
        continue;
      }

      if (ledger.entry_type === "manual_adjustment" && metadataKind(ledger.metadata) === "credit_pack_usage") {
        creditPackUsageMicros += Math.max(ledger.amount_micros, 0);
      }
    }

    return {
      usage_event_id: event.id,
      created_at: event.created_at,
      event_type: event.event_type as "generate" | "edit" | "transcribe",
      post_id: event.post_id,
      content_type: event.post_id ? postContentTypeById.get(event.post_id) || null : null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      raw_cost_micros: rawCostMicros,
      charged_cost_micros: chargedCostMicros,
      gross_profit_micros: grossProfitMicros,
      affiliate_commission_micros: affiliateCommissionMicros,
      platform_net_micros: platformNetMicros,
      included_usage_micros: includedUsageMicros,
      credit_pack_usage_micros: creditPackUsageMicros,
      overage_usage_micros: overageUsageMicros,
    };
  });

  const totals = items.reduce(
    (acc, item) => {
      acc.raw_cost_micros += item.raw_cost_micros;
      acc.charged_cost_micros += item.charged_cost_micros;
      acc.gross_profit_micros += item.gross_profit_micros;
      acc.affiliate_commission_micros += item.affiliate_commission_micros;
      acc.platform_net_micros += item.platform_net_micros;
      return acc;
    },
    {
      raw_cost_micros: 0,
      charged_cost_micros: 0,
      gross_profit_micros: 0,
      affiliate_commission_micros: 0,
      platform_net_micros: 0,
    },
  );

  res.json(billingStatementResponseSchema.parse({ items, totals }));
});

router.post("/api/billing/credit-packs/purchase", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const parseResult = purchaseCreditsRequestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    res.status(400).json({ message: "Invalid amountMicros" });
    return;
  }

  const minRechargeMicros = await getMinimumRechargeMicros();
  if (parseResult.data.amountMicros < minRechargeMicros) {
    res.status(400).json({
      error: "below_minimum_purchase",
      message: `Minimum recharge is ${minRechargeMicros}`,
    });
    return;
  }

  try {
    const url = await createCreditCheckoutSession(
      authResult.user.id,
      authResult.user.email || "",
      parseResult.data.amountMicros,
    );
    res.json(subscribeResponseSchema.parse({ url }));
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to create credit pack checkout session" });
  }
});

router.post("/api/billing/subscribe", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const parseResult = subscribeRequestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    res.status(400).json({ message: "Invalid subscribe payload" });
    return;
  }

  try {
    const url = await createSubscriptionCheckoutSession(
      authResult.user.id,
      authResult.user.email || "",
      parseResult.data.planKey,
    );
    res.json(subscribeResponseSchema.parse({ url }));
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to create subscription checkout session" });
  }
});

router.post("/api/billing/portal", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  try {
    const url = await createBillingPortalSession(authResult.user.id);
    res.json(billingPortalResponseSchema.parse({ url }));
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Billing portal unavailable" });
  }
});

router.post("/api/internal/billing/run-overage-batch", async (req: Request, res: Response): Promise<void> => {
  const adminResult = await requireAdminGuard(req, res);
  if (!adminResult) return;

  try {
    const result = await runOverageBillingBatch();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to run overage batch" });
  }
});

router.get("/api/admin/billing/plans", async (req: Request, res: Response): Promise<void> => {
  const adminResult = await requireAdminGuard(req, res);
  if (!adminResult) return;

  const sb = createAdminSupabase();
  const { data, error } = await sb
    .from("billing_plans")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    res.status(500).json({ message: error.message || "Failed to load billing plans" });
    return;
  }

  res.json({ plans: data || [] });
});

router.patch("/api/admin/billing/plans/:planKey", async (req: Request, res: Response): Promise<void> => {
  const adminResult = await requireAdminGuard(req, res);
  if (!adminResult) return;

  const planKey = String(req.params.planKey || "").trim();
  if (!planKey) {
    res.status(400).json({ message: "planKey is required" });
    return;
  }

  const parseResult = updateBillingPlanRequestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    res.status(400).json({ message: "Invalid billing plan payload" });
    return;
  }

  const sb = createAdminSupabase();
  const { data, error } = await sb
    .from("billing_plans")
    .update(parseResult.data)
    .eq("plan_key", planKey)
    .select("*")
    .maybeSingle();

  if (error) {
    res.status(500).json({ message: error.message || "Failed to update billing plan" });
    return;
  }

  if (!data) {
    res.status(404).json({ message: "Billing plan not found" });
    return;
  }

  res.json(data);
});

router.get("/api/admin/billing/settings", async (req: Request, res: Response): Promise<void> => {
  const adminResult = await requireAdminGuard(req, res);
  if (!adminResult) return;

  const [billingModel, defaultPlan, cadence, minInvoice] = await Promise.all([
    getBillingSettingValue("billing_model", { value: "subscription_overage" }),
    getBillingSettingValue("default_plan_key", { value: "core" }),
    getBillingSettingValue("overage_billing_cadence_days", { value: 7 }),
    getBillingSettingValue("overage_min_invoice_micros", { value: 1_000_000 }),
  ]);

  res.json(adminBillingSettingsSchema.parse({
    billing_model: String(billingModel.value || "subscription_overage") === "credits_topup"
      ? "credits_topup"
      : "subscription_overage",
    default_plan_key: String(defaultPlan.value || "core"),
    overage_billing_cadence_days: Number(cadence.value || 7),
    overage_min_invoice_micros: Number(minInvoice.value || 1_000_000),
  }));
});

router.patch("/api/admin/billing/settings", async (req: Request, res: Response): Promise<void> => {
  const adminResult = await requireAdminGuard(req, res);
  if (!adminResult) return;

  const parseResult = updateAdminBillingSettingsRequestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    res.status(400).json({ message: "Invalid billing settings payload" });
    return;
  }

  const sb = createAdminSupabase();
  const payload = parseResult.data;
  const updates = [
    { setting_key: "billing_model", setting_value: { value: payload.billing_model } },
    { setting_key: "default_plan_key", setting_value: { value: payload.default_plan_key } },
    {
      setting_key: "overage_billing_cadence_days",
      setting_value: { value: payload.overage_billing_cadence_days },
    },
    {
      setting_key: "overage_min_invoice_micros",
      setting_value: { value: payload.overage_min_invoice_micros },
    },
  ];

  const { error } = await sb
    .from("billing_settings")
    .upsert(
      updates.map((item) => ({
        ...item,
        updated_by: adminResult.userId,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "setting_key" },
    );

  if (error) {
    res.status(500).json({ message: error.message || "Failed to update billing settings" });
    return;
  }

  res.json(payload);
});

export default router;
