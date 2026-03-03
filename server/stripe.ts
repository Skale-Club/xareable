import Stripe from "stripe";
import { createAdminSupabase } from "./supabase";

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

// Export a getter instead of a direct instance
export const stripe = {
  get customers() { return getStripe().customers; },
  get checkout() { return getStripe().checkout; },
  get billingPortal() { return getStripe().billingPortal; },
  get subscriptions() { return getStripe().subscriptions; },
  get webhooks() { return getStripe().webhooks; },
};

// Returns the Stripe customer ID for a user, creating one if needed
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const sb = createAdminSupabase();

  const { data: sub } = await sb
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single();

  if (sub?.stripe_customer_id) {
    return sub.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });

  await sb
    .from("user_subscriptions")
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  return customer.id;
}

// Creates a Stripe Checkout session for subscribing to a plan
export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  userId: string,
): Promise<string> {
  const appUrl = process.env.APP_URL || "http://localhost:5000";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    success_url: `${appUrl}/billing?success=1`,
    cancel_url: `${appUrl}/billing?canceled=1`,
    metadata: { userId },
  });

  return session.url!;
}

// Creates a Stripe Billing Portal session so the user can manage their subscription
export async function createBillingPortalSession(
  customerId: string,
): Promise<string> {
  const appUrl = process.env.APP_URL || "http://localhost:5000";

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/billing`,
  });

  return session.url;
}

// Processes Stripe webhook events and keeps user_subscriptions in sync
export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
  const sb = createAdminSupabase();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const item = subscription.items.data[0];
      const priceId = item?.price.id;

      // In Stripe API 2026-02-25.clover, period dates are on the SubscriptionItem
      const periodStart = item?.current_period_start;
      const periodEnd = item?.current_period_end;

      // Find plan by stripe_price_id
      const { data: plan } = await sb
        .from("subscription_plans")
        .select("id")
        .eq("stripe_price_id", priceId)
        .single();

      await sb
        .from("user_subscriptions")
        .update({
          plan_id: plan?.id ?? null,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          current_period_start: periodStart
            ? new Date(periodStart * 1000).toISOString()
            : null,
          current_period_end: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_customer_id", customerId);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      // Revert to free_trial plan
      const { data: freePlan } = await sb
        .from("subscription_plans")
        .select("id")
        .eq("name", "free_trial")
        .single();

      await sb
        .from("user_subscriptions")
        .update({
          plan_id: freePlan?.id ?? null,
          stripe_subscription_id: null,
          status: "trialing",
          current_period_start: null,
          current_period_end: null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_customer_id", customerId);
      break;
    }

    default:
      break;
  }
}
