-- Migration: Atomic claim for auto-recharge (fixes PAY-01 double-charge)
--
-- Why: triggerAutoRecharge() in server/quota.ts used to read user_credits,
-- check auto_recharge_enabled / balance_micros < threshold in application
-- code, and only then call chargeAutoRecharge() to create a Stripe
-- PaymentIntent. That read-check-charge sequence was not atomic: two
-- concurrent low-balance generations for the same user could both pass the
-- application-level check before either charge landed, producing two
-- PaymentIntents (and, since chargeAutoRecharge() also had no Stripe
-- idempotency key, two real card charges for one top-up).
--
-- Fix: move the check into a single atomic UPDATE ... RETURNING inside a
-- SECURITY DEFINER RPC. Postgres evaluates the UPDATE's WHERE clause under
-- the row's lock, so of two concurrent callers only the first to reach the
-- row can match end-to-end; by the time the second caller's UPDATE
-- re-evaluates the WHERE clause, last_auto_recharge_at has already been
-- stamped `now()` by the first, so the "cooldown" arm of the WHERE clause
-- fails for the second caller and it matches 0 rows. A 0-row UPDATE returns
-- NULL from RETURNING, which the RPC surfaces as its own NULL return value
-- meaning "not eligible right now" (whether that's because the user simply
-- doesn't qualify, or because a concurrent caller just won the claim).
--
-- The 10-minute cooldown embedded in the WHERE clause also serves as the
-- retry backoff after a failed charge: server/quota.ts intentionally claims
-- first and charges second, so a Stripe failure still leaves
-- last_auto_recharge_at stamped and the user can't be re-attempted (and
-- re-charged) for another 10 minutes.

ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS last_auto_recharge_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_auto_recharge(p_user_id uuid)
RETURNS timestamptz AS $$
DECLARE
  v_claimed timestamptz;
BEGIN
  UPDATE public.user_credits
    SET last_auto_recharge_at = now()
  WHERE user_id = p_user_id
    AND auto_recharge_enabled = true
    AND balance_micros < auto_recharge_threshold_micros
    AND (last_auto_recharge_at IS NULL OR last_auto_recharge_at < now() - interval '10 minutes')
  RETURNING last_auto_recharge_at INTO v_claimed;

  RETURN v_claimed; -- NULL if no row matched (ineligible, or lost the race to a concurrent claimant)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
