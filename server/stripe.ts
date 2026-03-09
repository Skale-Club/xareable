import Stripe from "stripe";
import { createAdminSupabase } from "./supabase.js";
import { trackMarketingEvent } from "./integrations/marketing.js";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }

    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-02-25.clover",
    });
  }

  return _stripe;
}

export const stripe = {
  get accounts() {
    return getStripe().accounts;
  },
  get accountLinks() {
    return getStripe().accountLinks;
  },
  get checkout() {
    return getStripe().checkout;
  },
  get customers() {
    return getStripe().customers;
  },
  get billingPortal() {
    return getStripe().billingPortal;
  },
  get subscriptions() {
    return getStripe().subscriptions;
  },
  get invoiceItems() {
    return getStripe().invoiceItems;
  },
  get invoices() {
    return getStripe().invoices;
  },
  get paymentIntents() {
    return getStripe().paymentIntents;
  },
  get transfers() {
    return getStripe().transfers;
  },
  get webhooks() {
    return getStripe().webhooks;
  },
};

function getAppUrl(): string {
  return process.env.APP_URL || "http://localhost:5000";
}

type BillingModel = "credits_topup" | "subscription_overage";

function toIsoOrNull(unixSeconds?: number | null): string | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) {
    return null;
  }
  return new Date(unixSeconds * 1000).toISOString();
}

async function getBillingSetting(
  key: string,
): Promise<Record<string, unknown> | null> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("billing_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();

  if (data?.setting_value && typeof data.setting_value === "object") {
    return data.setting_value as Record<string, unknown>;
  }

  return null;
}

export async function getBillingModel(): Promise<BillingModel> {
  const setting = await getBillingSetting("billing_model");
  const raw = String(setting?.value || "").trim();
  return raw === "credits_topup" ? "credits_topup" : "subscription_overage";
}

async function getDefaultPlanKey(): Promise<string> {
  const setting = await getBillingSetting("default_plan_key");
  const key = String(setting?.value || "").trim();
  return key || "core";
}

export async function getOverageBillingCadenceDays(): Promise<number> {
  const setting = await getBillingSetting("overage_billing_cadence_days");
  const value = Number(setting?.value);
  if (!Number.isFinite(value) || value < 1) {
    return 7;
  }
  return Math.floor(value);
}

export async function getOverageMinimumInvoiceMicros(): Promise<number> {
  const setting = await getBillingSetting("overage_min_invoice_micros");
  const value = Number(setting?.value);
  if (!Number.isFinite(value) || value < 0) {
    return 1_000_000;
  }
  return Math.floor(value);
}

async function getAuthUserEmail(userId: string): Promise<string | null> {
  const sb = createAdminSupabase();
  const { data, error } = await sb.auth.admin.getUserById(userId);
  if (error) {
    return null;
  }

  const email = String(data?.user?.email || "").trim().toLowerCase();
  return email || null;
}

async function ensureCreditCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const sb = createAdminSupabase();
  const { data: credits } = await sb
    .from("user_credits")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (credits?.stripe_customer_id) {
    return credits.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { userId },
  });

  await sb
    .from("user_credits")
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: customer.id,
      },
      { onConflict: "user_id" },
    );

  return customer.id;
}

async function ensureBillingCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const sb = createAdminSupabase();
  const { data: profile } = await sb
    .from("user_billing_profiles")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { userId },
  });

  await sb
    .from("user_billing_profiles")
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: customer.id,
      },
      { onConflict: "user_id" },
    );

  return customer.id;
}

async function getPlanByKey(planKey: string) {
  const sb = createAdminSupabase();
  const { data: plan } = await sb
    .from("billing_plans")
    .select("*")
    .eq("plan_key", planKey)
    .eq("active", true)
    .maybeSingle();

  return plan;
}

async function getPlanById(planId: string | null | undefined) {
  if (!planId) return null;
  const sb = createAdminSupabase();
  const { data: plan } = await sb
    .from("billing_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  return plan;
}

async function storeDefaultPaymentMethod(
  userId: string,
  paymentIntentId: string | null | undefined,
) {
  if (!paymentIntentId) {
    return;
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const paymentMethodId =
    typeof intent.payment_method === "string"
      ? intent.payment_method
      : intent.payment_method?.id;

  if (!paymentMethodId) {
    return;
  }

  const sb = createAdminSupabase();
  await sb
    .from("user_credits")
    .update({
      stripe_default_payment_method_id: paymentMethodId,
    })
    .eq("user_id", userId);
}

async function applyCreditPurchase(
  userId: string,
  creditsMicros: number,
  paymentIntentId: string,
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const sb = createAdminSupabase();

  const { data: existing } = await sb
    .from("credit_transactions")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (existing) {
    return;
  }

  const { data: credits } = await sb
    .from("user_credits")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const balanceBefore = credits?.balance_micros ?? 0;
  const balanceAfter = balanceBefore + creditsMicros;
  const lifetimePurchasedBefore = credits?.lifetime_purchased_micros ?? 0;

  if (credits) {
    await sb
      .from("user_credits")
      .update({
        balance_micros: balanceAfter,
        lifetime_purchased_micros: lifetimePurchasedBefore + creditsMicros,
      })
      .eq("user_id", userId);
  } else {
    await sb
      .from("user_credits")
      .insert({
        user_id: userId,
        balance_micros: balanceAfter,
        lifetime_purchased_micros: creditsMicros,
      });
  }

  await sb
    .from("credit_transactions")
    .insert({
      user_id: userId,
      type: "purchase",
      amount_micros: creditsMicros,
      balance_before_micros: balanceBefore,
      balance_after_micros: balanceAfter,
      stripe_payment_intent_id: paymentIntentId,
      description,
      metadata,
    });
}

export async function createCreditCheckoutSession(
  userId: string,
  email: string,
  amountMicros: number,
): Promise<string> {
  const customerId = await ensureCreditCustomer(userId, email);
  const unitAmount = Math.max(Math.round(amountMicros / 10_000), 50);
  const dollars = (amountMicros / 1_000_000).toFixed(2);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "Credits",
            description: `$${dollars} credit top-up`,
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        userId,
        creditsMicros: String(amountMicros),
        type: "credit_purchase",
      },
    },
    success_url: `${getAppUrl()}/billing?success=1`,
    cancel_url: `${getAppUrl()}/billing?canceled=1`,
    metadata: {
      userId,
      creditsMicros: String(amountMicros),
      type: "credit_purchase",
    },
  });

  return session.url!;
}

export async function createSubscriptionCheckoutSession(
  userId: string,
  email: string,
  requestedPlanKey?: string | null,
): Promise<string> {
  const planKey = (requestedPlanKey || "").trim() || await getDefaultPlanKey();
  const plan = await getPlanByKey(planKey);

  if (!plan) {
    throw new Error(`Billing plan '${planKey}' is not configured or inactive`);
  }
  if (!plan.stripe_price_id) {
    throw new Error(`Billing plan '${planKey}' is missing stripe_price_id`);
  }

  const customerId = await ensureBillingCustomer(userId, email);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: String(plan.stripe_price_id),
        quantity: 1,
      },
    ],
    metadata: {
      type: "plan_subscription",
      userId,
      planKey,
    },
    subscription_data: {
      metadata: {
        type: "plan_subscription",
        userId,
        planKey,
      },
    },
    success_url: `${getAppUrl()}/billing?success=1`,
    cancel_url: `${getAppUrl()}/billing?canceled=1`,
  });

  return session.url!;
}

export async function createBillingPortalSession(userId: string): Promise<string> {
  const sb = createAdminSupabase();
  const { data: profile } = await sb
    .from("user_billing_profiles")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile?.stripe_customer_id) {
    throw new Error("No Stripe customer found for this account");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${getAppUrl()}/billing`,
  });

  return session.url;
}

async function grantIncludedCreditsForCurrentPlan(
  userId: string,
  stripeInvoiceId: string,
): Promise<void> {
  const sb = createAdminSupabase();
  const { data: billingProfile } = await sb
    .from("user_billing_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const plan = await getPlanById(billingProfile?.billing_plan_id);
  if (!plan) {
    return;
  }

  const grantAmount = plan.included_credits_micros ?? 0;
  const includedAfter = grantAmount;

  await sb
    .from("user_billing_profiles")
    .update({
      included_credits_remaining_micros: includedAfter,
    })
    .eq("user_id", userId);

  await sb
    .from("billing_ledger")
    .insert({
      user_id: userId,
      entry_type: "included_credit_grant",
      amount_micros: grantAmount,
      balance_included_after_micros: includedAfter,
      pending_overage_after_micros: billingProfile?.pending_overage_micros ?? 0,
      stripe_invoice_id: stripeInvoiceId,
      metadata: {
        plan_key: plan.plan_key,
        reason: "subscription_cycle",
      },
    });
}

async function syncStripeSubscription(
  subscription: Stripe.Subscription,
): Promise<void> {
  const metadata = subscription.metadata || {};
  const userId = String(metadata.userId || "").trim();
  const planKeyFromMeta = String(metadata.planKey || "").trim();
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  if (!userId || !customerId) {
    return;
  }

  const sb = createAdminSupabase();
  let plan = planKeyFromMeta ? await getPlanByKey(planKeyFromMeta) : null;

  if (!plan) {
    const firstItemPriceId = subscription.items.data[0]?.price?.id;
    if (firstItemPriceId) {
      const { data } = await sb
        .from("billing_plans")
        .select("*")
        .eq("stripe_price_id", firstItemPriceId)
        .maybeSingle();
      plan = data || null;
    }
  }

  await sb
    .from("user_billing_profiles")
    .upsert(
      {
        user_id: userId,
        billing_plan_id: plan?.id ?? null,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        subscription_status: subscription.status,
        current_period_start: toIsoOrNull(
          (subscription as any).current_period_start ?? subscription.start_date,
        ),
        current_period_end: toIsoOrNull((subscription as any).current_period_end ?? null),
      },
      { onConflict: "user_id" },
    );
}

export async function runOverageBillingBatch(): Promise<{
  processed: number;
  charged: number;
  skipped: number;
}> {
  const sb = createAdminSupabase();
  const cadenceDays = await getOverageBillingCadenceDays();
  const minInvoiceMicros = await getOverageMinimumInvoiceMicros();

  const { data: rows } = await sb
    .from("user_billing_profiles")
    .select("user_id, stripe_customer_id, subscription_status, pending_overage_micros, overage_last_billed_at")
    .gt("pending_overage_micros", 0)
    .limit(500);

  let processed = 0;
  let charged = 0;
  let skipped = 0;
  const now = Date.now();

  for (const row of rows || []) {
    processed += 1;
    const status = String(row.subscription_status || "");
    const isActive = status === "active" || status === "trialing" || status === "past_due";
    const pendingMicros = Number(row.pending_overage_micros || 0);
    const lastBilledTs = row.overage_last_billed_at
      ? new Date(row.overage_last_billed_at).getTime()
      : 0;

    const cadenceMs = cadenceDays * 24 * 60 * 60 * 1000;
    const cadenceDue = !lastBilledTs || now - lastBilledTs >= cadenceMs;

    if (!isActive || !row.stripe_customer_id || pendingMicros < minInvoiceMicros || !cadenceDue) {
      skipped += 1;
      continue;
    }

    try {
      const amountCents = Math.max(Math.round(pendingMicros / 10_000), 1);
      await stripe.invoiceItems.create({
        customer: row.stripe_customer_id,
        currency: "usd",
        amount: amountCents,
        description: `Usage overage (${(pendingMicros / 1_000_000).toFixed(2)} USD)`,
        metadata: {
          type: "overage_batch",
          userId: row.user_id,
          pendingOverageMicros: String(pendingMicros),
        },
      });

      const invoice = await stripe.invoices.create({
        customer: row.stripe_customer_id,
        collection_method: "charge_automatically",
        metadata: {
          type: "overage_batch",
          userId: row.user_id,
        },
      });

      const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
      const paid = finalized.status === "paid" ? finalized : await stripe.invoices.pay(finalized.id);

      if (paid.status === "paid") {
        await sb
          .from("user_billing_profiles")
          .update({
            pending_overage_micros: 0,
            overage_last_billed_at: new Date().toISOString(),
          })
          .eq("user_id", row.user_id);

        await sb
          .from("billing_ledger")
          .insert([
            {
              user_id: row.user_id,
              entry_type: "overage_invoice",
              amount_micros: pendingMicros,
              pending_overage_after_micros: pendingMicros,
              stripe_invoice_id: paid.id,
              metadata: { auto_batch: true },
            },
            {
              user_id: row.user_id,
              entry_type: "overage_payment",
              amount_micros: -pendingMicros,
              pending_overage_after_micros: 0,
              stripe_invoice_id: paid.id,
              metadata: { auto_batch: true },
            },
          ]);
        charged += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      console.error("Overage batch charge failed for user:", row.user_id, error);
      skipped += 1;
    }
  }

  return { processed, charged, skipped };
}

export async function chargeAutoRecharge(userId: string): Promise<boolean> {
  const sb = createAdminSupabase();
  const { data: credits } = await sb
    .from("user_credits")
    .select("auto_recharge_amount_micros, stripe_customer_id, stripe_default_payment_method_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!credits?.stripe_customer_id || !credits?.stripe_default_payment_method_id) {
    return false;
  }

  const creditsMicros = credits.auto_recharge_amount_micros ?? 0;
  if (creditsMicros <= 0) {
    return false;
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.max(Math.round(creditsMicros / 10_000), 50),
    currency: "usd",
    customer: credits.stripe_customer_id,
    payment_method: credits.stripe_default_payment_method_id,
    confirm: true,
    off_session: true,
    metadata: {
      userId,
      creditsMicros: String(creditsMicros),
      type: "auto_recharge",
    },
  });

  if (paymentIntent.status !== "succeeded") {
    return false;
  }

  await applyCreditPurchase(
    userId,
    creditsMicros,
    paymentIntent.id,
    "Automatic credit recharge",
    { auto_recharge: true },
  );

  return true;
}

export async function createStripeConnectAccount(
  userId: string,
  email: string,
): Promise<string> {
  const sb = createAdminSupabase();
  const { data: existing } = await sb
    .from("affiliate_settings")
    .select("stripe_connect_account_id")
    .eq("user_id", userId)
    .maybeSingle();

  let accountId = existing?.stripe_connect_account_id ?? null;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: email || undefined,
      capabilities: {
        transfers: { requested: true },
      },
      business_type: "individual",
      metadata: { userId },
    });

    accountId = account.id;

    await sb
      .from("affiliate_settings")
      .upsert(
        {
          user_id: userId,
          stripe_connect_account_id: accountId,
          stripe_connect_onboarded: false,
        },
        { onConflict: "user_id" },
      );
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${getAppUrl()}/affiliate?refresh=1`,
    return_url: `${getAppUrl()}/affiliate?success=1`,
    type: "account_onboarding",
  });

  return accountLink.url;
}

export async function createStripeConnectLoginLink(
  userId: string,
): Promise<string> {
  const sb = createAdminSupabase();
  const { data: settings } = await sb
    .from("affiliate_settings")
    .select("stripe_connect_account_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!settings?.stripe_connect_account_id) {
    throw new Error("Affiliate Stripe Connect account not found");
  }

  const loginLink = await stripe.accounts.createLoginLink(settings.stripe_connect_account_id);
  return loginLink.url;
}

export async function syncAffiliateStripeStatus(userId: string): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return;
  }

  const sb = createAdminSupabase();
  const { data: settings } = await sb
    .from("affiliate_settings")
    .select("stripe_connect_account_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!settings?.stripe_connect_account_id) {
    return;
  }

  const account = await stripe.accounts.retrieve(settings.stripe_connect_account_id);
  const onboarded = Boolean(account.details_submitted && account.payouts_enabled);

  await sb
    .from("affiliate_settings")
    .update({
      stripe_connect_onboarded: onboarded,
    })
    .eq("user_id", userId);
}

export async function processAffiliatePayoutIfEligible(
  affiliateId: string,
): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return false;
  }

  await syncAffiliateStripeStatus(affiliateId);

  const sb = createAdminSupabase();
  const { data: settings } = await sb
    .from("affiliate_settings")
    .select("*")
    .eq("user_id", affiliateId)
    .maybeSingle();

  if (!settings?.stripe_connect_account_id || !settings?.stripe_connect_onboarded) {
    return false;
  }

  if (!settings.auto_payout_enabled) {
    return false;
  }

  const payoutMicros = settings.pending_commission_micros ?? 0;
  if (payoutMicros <= 0 || payoutMicros < (settings.minimum_payout_micros ?? 0)) {
    return false;
  }

  const transfer = await stripe.transfers.create({
    amount: Math.max(Math.round(payoutMicros / 10_000), 1),
    currency: "usd",
    destination: settings.stripe_connect_account_id,
    metadata: {
      affiliateId,
      type: "affiliate_payout",
    },
  });

  await sb
    .from("affiliate_settings")
    .update({
      pending_commission_micros: 0,
      total_commission_paid_micros:
        (settings.total_commission_paid_micros ?? 0) + payoutMicros,
    })
    .eq("user_id", affiliateId);

  await sb
    .from("credit_transactions")
    .insert({
      user_id: affiliateId,
      type: "affiliate_commission",
      amount_micros: -payoutMicros,
      balance_before_micros: settings.pending_commission_micros ?? 0,
      balance_after_micros: 0,
      stripe_payout_id: transfer.id,
      description: "Affiliate payout transfer",
      metadata: {
        payout: true,
      },
    });

  return true;
}

export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        const metadata = session.metadata || {};
        const userId = String(metadata.userId || "").trim();
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        if (userId && subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await syncStripeSubscription(subscription);
        }
        break;
      }

      if (session.payment_status !== "paid") {
        break;
      }

      const metadata = session.metadata || {};
      if (metadata.type !== "credit_purchase" || !metadata.userId || !metadata.creditsMicros) {
        break;
      }

      const userId = metadata.userId;
      const creditsMicros = Number(metadata.creditsMicros);

      if (!Number.isFinite(creditsMicros) || creditsMicros <= 0) {
        break;
      }

      await applyCreditPurchase(
        userId,
        creditsMicros,
        String(session.payment_intent),
        "Stripe credit purchase",
        {
          stripe_checkout_session_id: session.id,
        },
      );
      await storeDefaultPaymentMethod(userId, String(session.payment_intent));

      // Track Purchase event for Facebook Conversions API
      const userEmail = await getAuthUserEmail(userId);

      const purchaseValue = creditsMicros / 1_000_000; // Convert micros to dollars
      void trackMarketingEvent({
        event_name: "Purchase",
        event_key: `purchase:${session.payment_intent || session.id}`,
        event_source: "stripe",
        user_id: userId,
        email: userEmail,
        event_payload: {
          type: "credit_purchase",
          credits_micros: creditsMicros,
          stripe_session_id: session.id,
        },
        value: purchaseValue,
        currency: "USD",
      }).catch((err) => {
        console.error("Failed to track Purchase event:", err);
      });
      break;
    }

    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const metadata = intent.metadata || {};
      if ((metadata.type !== "auto_recharge" && metadata.type !== "credit_purchase") || !metadata.userId || !metadata.creditsMicros) {
        break;
      }

      if (metadata.type === "auto_recharge") {
        const creditsMicros = Number(metadata.creditsMicros);
        if (Number.isFinite(creditsMicros) && creditsMicros > 0) {
          await applyCreditPurchase(
            metadata.userId,
            creditsMicros,
            intent.id,
            "Automatic credit recharge",
            { auto_recharge: true },
          );

          // Track Purchase event for auto-recharge
          const userEmail = await getAuthUserEmail(metadata.userId);

          const purchaseValue = creditsMicros / 1_000_000;
          void trackMarketingEvent({
            event_name: "Purchase",
            event_key: `purchase:${intent.id}`,
            event_source: "stripe",
            user_id: metadata.userId,
            email: userEmail,
            event_payload: {
              type: "auto_recharge",
              credits_micros: creditsMicros,
              stripe_payment_intent_id: intent.id,
            },
            value: purchaseValue,
            currency: "USD",
          }).catch((err) => {
            console.error("Failed to track Purchase event (auto-recharge):", err);
          });
        }
      }

      await storeDefaultPaymentMethod(metadata.userId, intent.id);
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const subscription = event.data.object as Stripe.Subscription;
      await syncStripeSubscription(subscription);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id;
      if (!customerId) {
        break;
      }

      const sb = createAdminSupabase();
      await sb
        .from("user_billing_profiles")
        .update({
          subscription_status: "canceled",
          current_period_end: toIsoOrNull((subscription as any).current_period_end ?? null),
        })
        .eq("stripe_customer_id", customerId);
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const billingReason = String(invoice.billing_reason || "");
      if (billingReason !== "subscription_cycle" && billingReason !== "subscription_create") {
        break;
      }

      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (!customerId || !invoice.id) {
        break;
      }

      const sb = createAdminSupabase();
      const { data: profile } = await sb
        .from("user_billing_profiles")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (!profile?.user_id) {
        break;
      }

      await grantIncludedCreditsForCurrentPlan(profile.user_id, invoice.id);
      break;
    }

    default:
      break;
  }
}
