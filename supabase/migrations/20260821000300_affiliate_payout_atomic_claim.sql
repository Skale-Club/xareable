-- Migration: Atomic claim for affiliate payouts (fixes PAY-02 double-transfer
-- and destroyed-commission bug)
--
-- Why: processAffiliatePayoutIfEligible() in
-- server/services/stripe-connect.service.ts used to read affiliate_settings,
-- validate pending_commission_micros in application code, call
-- stripe.transfers.create() with NO idempotency key, and only afterwards
-- UPDATE affiliate_settings — setting pending_commission_micros straight to
-- 0 instead of decrementing it by the amount actually paid out. Two bugs
-- fell out of that:
--
--   1. Read-check-transfer was not atomic and the Stripe call carried no
--      idempotency key, so two referrals crediting commission around the
--      same time could both pass the application-level eligibility check
--      before either transfer landed, producing two real Stripe transfers
--      against the same pending balance.
--   2. The post-transfer UPDATE unconditionally set
--      pending_commission_micros = 0. Any commission that accrued between
--      the initial read (used to decide payoutMicros) and this write —
--      e.g. a new referral's commission landing mid-request — was silently
--      wiped out instead of being preserved.
--
-- Fix: move the balance decrement into a single atomic
-- UPDATE ... WHERE pending_commission_micros >= p_amount inside a
-- SECURITY DEFINER RPC, claimed BEFORE the Stripe transfer is created (not
-- after). Postgres evaluates the WHERE clause under the row's lock, so of
-- two concurrent claimants only the first to reach the row can match; the
-- second's UPDATE re-evaluates against the already-decremented balance and,
-- if it no longer covers p_amount, affects 0 rows. A 0-row UPDATE means
-- "lost the race" (or the balance changed under us) and the caller must not
-- transfer. Because the claim only ever subtracts p_amount — never resets
-- the column to 0 — any commission that accrues concurrently survives.
--
-- refund_affiliate_payout_claim() is the compensating action for when the
-- Stripe transfer is attempted after a successful claim but throws (network
-- error, Stripe outage, etc.): it reverses the claim so the commission goes
-- back into pending_commission_micros and can be retried on the next sweep.

CREATE OR REPLACE FUNCTION public.claim_affiliate_payout(
  p_affiliate_id uuid,
  p_amount bigint
) RETURNS boolean AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.affiliate_settings
    SET pending_commission_micros = pending_commission_micros - p_amount,
        total_commission_paid_micros = COALESCE(total_commission_paid_micros, 0) + p_amount
  WHERE user_id = p_affiliate_id
    AND pending_commission_micros >= p_amount;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.refund_affiliate_payout_claim(
  p_affiliate_id uuid,
  p_amount bigint
) RETURNS void AS $$
BEGIN
  UPDATE public.affiliate_settings
    SET pending_commission_micros = pending_commission_micros + p_amount,
        total_commission_paid_micros = COALESCE(total_commission_paid_micros, 0) - p_amount
  WHERE user_id = p_affiliate_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
