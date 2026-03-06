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
    success_url: `${getAppUrl()}/credits?success=1`,
    cancel_url: `${getAppUrl()}/credits?canceled=1`,
    metadata: {
      userId,
      creditsMicros: String(amountMicros),
      type: "credit_purchase",
    },
  });

  return session.url!;
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
      const sb = createAdminSupabase();
      const { data: userProfile } = await sb
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .maybeSingle();

      const purchaseValue = creditsMicros / 1_000_000; // Convert micros to dollars
      void trackMarketingEvent({
        event_name: "Purchase",
        event_key: `purchase:${session.payment_intent || session.id}`,
        event_source: "stripe",
        user_id: userId,
        email: userProfile?.email || null,
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
          const sb = createAdminSupabase();
          const { data: userProfile } = await sb
            .from("profiles")
            .select("email")
            .eq("id", metadata.userId)
            .maybeSingle();

          const purchaseValue = creditsMicros / 1_000_000;
          void trackMarketingEvent({
            event_name: "Purchase",
            event_key: `purchase:${intent.id}`,
            event_source: "stripe",
            user_id: metadata.userId,
            email: userProfile?.email || null,
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

    default:
      break;
  }
}
