/**
 * Stripe Connect / Affiliate Service
 *
 * Extracted from server/stripe.ts (SEED-004 fat-file refactor).
 * Handles Stripe Connect account creation, login links, status sync,
 * and affiliate payout processing.
 */

import { stripe } from "../stripe.js";
import { createAdminSupabase } from "../supabase.js";
import { captureException } from "../lib/observability.js";

// ---------------------------------------------------------------------------
// Shared helpers (duplicated from stripe.ts — small pure helpers)
// ---------------------------------------------------------------------------

function getAppUrl(): string {
  return process.env.APP_URL || "http://localhost:5000";
}

function toIsoOrNull(unixSeconds?: number | null): string | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) {
    return null;
  }
  return new Date(unixSeconds * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Stripe Connect / Affiliate functions
// ---------------------------------------------------------------------------

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

  // Atomic CAS claim BEFORE creating the Stripe transfer (fixes PAY-02): two
  // referrals crediting commission concurrently could otherwise both pass
  // the eligibility check above and both reach stripe.transfers.create(),
  // paying out the same pending balance twice. claim_affiliate_payout()
  // atomically decrements pending_commission_micros by payoutMicros only if
  // the balance still covers it — see
  // supabase/migrations/20260821000300_affiliate_payout_atomic_claim.sql.
  // A false result means we lost the race (or the balance changed under us)
  // and must not transfer.
  const { data: claimed } = await sb.rpc("claim_affiliate_payout", {
    p_affiliate_id: affiliateId,
    p_amount: payoutMicros,
  });

  if (claimed !== true) {
    return false;
  }

  // Deterministic idempotency key scoped to this claimed amount + account:
  // a retried request for the same claim dedupes at Stripe instead of
  // creating a second transfer.
  const idempotencyKey = `affiliate_payout_${affiliateId}_${payoutMicros}_${settings.stripe_connect_account_id}`;

  let transfer;
  try {
    transfer = await stripe.transfers.create(
      {
        amount: Math.max(Math.round(payoutMicros / 10_000), 1),
        currency: "usd",
        destination: settings.stripe_connect_account_id,
        metadata: {
          affiliateId,
          type: "affiliate_payout",
        },
      },
      { idempotencyKey },
    );
  } catch (error) {
    // Transfer failed after the claim: give the commission back so it isn't
    // lost, and let the next eligible sweep retry it.
    captureException(error, { stage: "affiliate_payout_transfer", affiliateId });
    await sb.rpc("refund_affiliate_payout_claim", {
      p_affiliate_id: affiliateId,
      p_amount: payoutMicros,
    });
    return false;
  }

  await sb
    .from("credit_transactions")
    .insert({
      user_id: affiliateId,
      type: "affiliate_commission",
      amount_micros: -payoutMicros,
      balance_before_micros: payoutMicros,
      balance_after_micros: 0,
      stripe_payout_id: transfer.id,
      description: "Affiliate payout transfer",
      metadata: {
        payout: true,
      },
    });

  return true;
}
