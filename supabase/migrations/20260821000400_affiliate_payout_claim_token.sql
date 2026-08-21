-- Migration: give claim_affiliate_payout a per-claim token (fixes PAY-02 follow-up)
--
-- Why: 20260821000300_affiliate_payout_atomic_claim.sql made the payout claim
-- atomic, but the Stripe idempotency key the caller derived from it was
--
--   affiliate_payout_<affiliateId>_<payoutMicros>_<connectAccountId>
--
-- which is unique per (affiliate, AMOUNT, account) — NOT per claim. Stripe
-- retains idempotency keys for 24h, so if the same affiliate legitimately
-- reaches payout twice inside that window for the exact same micros amount,
-- Stripe treats the second transfer as a replay of the first and returns the
-- ORIGINAL transfer without moving any money — while claim_affiliate_payout()
-- has already decremented pending_commission_micros for it.
--
-- The failure mode is silent and biased against the affiliate: balance debited,
-- commission counted as paid, no money actually sent, and the code sees a
-- successful `transfer` object so nothing errors. That is strictly worse than
-- the duplicate transfer the key was added to prevent.
--
-- Compare claim_auto_recharge() (20260821000200), which got this right by
-- returning the claim's timestamp for the caller to key on.
--
-- Fix: return the POST-claim total_commission_paid_micros instead of a bare
-- boolean. That column only ever grows, and every successful claim adds a
-- strictly positive p_amount to it, so the returned value is unique per claim
-- for a given affiliate — a better token than a timestamp, which two claims in
-- the same clock tick could theoretically share. NULL still means "claim
-- failed" (ineligible, or lost the race), preserving the caller's contract.
--
-- The return type changes, so this is a DROP + CREATE rather than a
-- CREATE OR REPLACE (Postgres refuses to replace a function with a different
-- return type).

DROP FUNCTION IF EXISTS public.claim_affiliate_payout(uuid, bigint);

CREATE OR REPLACE FUNCTION public.claim_affiliate_payout(
  p_affiliate_id uuid,
  p_amount bigint
) RETURNS bigint AS $$
DECLARE
  v_claim_token bigint;
BEGIN
  UPDATE public.affiliate_settings
    SET pending_commission_micros = pending_commission_micros - p_amount,
        total_commission_paid_micros = COALESCE(total_commission_paid_micros, 0) + p_amount
  WHERE user_id = p_affiliate_id
    AND pending_commission_micros >= p_amount
  RETURNING total_commission_paid_micros INTO v_claim_token;

  -- NULL when no row matched: ineligible, or a concurrent claimant already
  -- took the balance. The caller MUST NOT transfer on NULL.
  RETURN v_claim_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.claim_affiliate_payout(uuid, bigint) IS
'Atomically debits pending_commission_micros by p_amount (only if it covers the amount) and returns the resulting total_commission_paid_micros as a per-claim token for the Stripe idempotency key. Returns NULL when the claim fails. See PAY-02.';
