-- Migration: Billing optimizations and ACID transactions
-- 1. Idempotency constraints to prevent duplicate webhook processing
CREATE UNIQUE INDEX IF NOT EXISTS unique_stripe_payment_intent ON credit_transactions(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL AND type = 'purchase';

-- 2. Transactional RPC for applying credit purchases (ACID)
CREATE OR REPLACE FUNCTION apply_credit_purchase_tx(
  p_user_id uuid,
  p_credits_micros bigint,
  p_payment_intent_id text,
  p_description text,
  p_metadata jsonb
) RETURNS void AS $$
DECLARE
  v_balance_before bigint;
  v_balance_after bigint;
  v_lifetime_purchased bigint;
BEGIN
  -- Check if already applied (idempotency)
  IF EXISTS (SELECT 1 FROM credit_transactions WHERE stripe_payment_intent_id = p_payment_intent_id) THEN
    RETURN;
  END IF;

  -- Lock the row for update to prevent concurrent updates (Race condition fix)
  SELECT balance_micros, lifetime_purchased_micros INTO v_balance_before, v_lifetime_purchased
  FROM user_credits WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    v_balance_before := 0;
    v_lifetime_purchased := 0;
    
    INSERT INTO user_credits (user_id, balance_micros, lifetime_purchased_micros)
    VALUES (p_user_id, p_credits_micros, p_credits_micros);
    
    v_balance_after := p_credits_micros;
  ELSE
    v_balance_after := v_balance_before + p_credits_micros;
    
    UPDATE user_credits 
    SET balance_micros = v_balance_after,
        lifetime_purchased_micros = v_lifetime_purchased + p_credits_micros
    WHERE user_id = p_user_id;
  END IF;

  INSERT INTO credit_transactions (
    user_id, type, amount_micros, balance_before_micros, balance_after_micros, stripe_payment_intent_id, description, metadata
  ) VALUES (
    p_user_id, 'purchase', p_credits_micros, v_balance_before, v_balance_after, p_payment_intent_id, p_description, p_metadata
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Transactional RPC for deducting credits (ACID)
CREATE OR REPLACE FUNCTION process_usage_deduction_tx(
  p_user_id uuid,
  p_usage_event_id uuid,
  p_base_cost_micros bigint,
  p_markup_multiplier numeric,
  p_billing_model text,
  p_is_admin_or_affiliate boolean,
  p_affiliate_id uuid
) RETURNS void AS $$
DECLARE
  v_charged_amount bigint;
  v_affiliate_commission bigint;
  v_profile RECORD;
  v_credits RECORD;
  v_included_before bigint;
  v_pending_before bigint;
  v_included_used bigint;
  v_overage bigint;
  v_included_after bigint;
  v_pending_after bigint;
  v_balance_before bigint;
  v_balance_after bigint;
  v_free_limit int;
  v_free_used int;
  v_free_remaining int;
  v_affiliate_settings RECORD;
BEGIN
  IF p_is_admin_or_affiliate THEN
    UPDATE usage_events SET charged_amount_micros = 0, affiliate_commission_micros = 0, markup_multiplier = 0 WHERE id = p_usage_event_id;
    RETURN;
  END IF;

  v_charged_amount := GREATEST(ROUND(GREATEST(p_base_cost_micros, 0) * p_markup_multiplier), 0);
  
  IF p_affiliate_id IS NOT NULL THEN
    v_affiliate_commission := GREATEST(p_base_cost_micros, 0);
  ELSE
    v_affiliate_commission := 0;
  END IF;

  IF p_billing_model = 'subscription_overage' THEN
    SELECT * INTO v_profile FROM user_billing_profiles WHERE user_id = p_user_id FOR UPDATE;
    
    IF v_profile.subscription_status NOT IN ('active', 'trialing', 'past_due') THEN
      RAISE EXCEPTION 'Active subscription required';
    END IF;

    v_included_before := COALESCE(v_profile.included_credits_remaining_micros, 0);
    v_pending_before := COALESCE(v_profile.pending_overage_micros, 0);
    v_included_used := LEAST(v_included_before, v_charged_amount);
    v_overage := GREATEST(v_charged_amount - v_included_used, 0);
    v_included_after := v_included_before - v_included_used;
    v_pending_after := v_pending_before + v_overage;

    UPDATE user_billing_profiles 
    SET included_credits_remaining_micros = v_included_after,
        pending_overage_micros = v_pending_after
    WHERE user_id = p_user_id;

    IF v_included_used > 0 THEN
      INSERT INTO billing_ledger (
        user_id, entry_type, amount_micros, balance_included_after_micros, pending_overage_after_micros, usage_event_id, metadata
      ) VALUES (
        p_user_id, 'included_credit_usage', -v_included_used, v_included_after, v_pending_before, p_usage_event_id, 
        jsonb_build_object('base_cost_micros', GREATEST(p_base_cost_micros, 0), 'markup_multiplier', p_markup_multiplier)
      );
    END IF;

    IF v_overage > 0 THEN
      INSERT INTO billing_ledger (
        user_id, entry_type, amount_micros, balance_included_after_micros, pending_overage_after_micros, usage_event_id, metadata
      ) VALUES (
        p_user_id, 'overage_accrual', v_overage, v_included_after, v_pending_after, p_usage_event_id, 
        jsonb_build_object('base_cost_micros', GREATEST(p_base_cost_micros, 0), 'markup_multiplier', p_markup_multiplier)
      );
    END IF;

    UPDATE usage_events SET charged_amount_micros = v_charged_amount, affiliate_commission_micros = v_affiliate_commission, markup_multiplier = p_markup_multiplier WHERE id = p_usage_event_id;
  ELSE
    -- credits_topup
    SELECT * INTO v_credits FROM user_credits WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'User credits not found';
    END IF;

    v_free_limit := COALESCE(v_credits.free_generations_limit, 0);
    v_free_used := COALESCE(v_credits.free_generations_used, 0);
    v_free_remaining := GREATEST(v_free_limit - v_free_used, 0);

    IF v_free_remaining > 0 THEN
      UPDATE user_credits SET free_generations_used = v_free_used + 1 WHERE user_id = p_user_id;
      UPDATE usage_events SET charged_amount_micros = 0, affiliate_commission_micros = 0, markup_multiplier = p_markup_multiplier WHERE id = p_usage_event_id;
      RETURN;
    END IF;

    v_balance_before := COALESCE(v_credits.balance_micros, 0);
    IF v_balance_before < v_charged_amount THEN
      RAISE EXCEPTION 'Insufficient credits';
    END IF;

    v_balance_after := v_balance_before - v_charged_amount;

    UPDATE user_credits 
    SET balance_micros = v_balance_after,
        lifetime_used_micros = COALESCE(v_credits.lifetime_used_micros, 0) + v_charged_amount
    WHERE user_id = p_user_id;

    INSERT INTO credit_transactions (
      user_id, type, amount_micros, balance_before_micros, balance_after_micros, usage_event_id, description, metadata
    ) VALUES (
      p_user_id, 'usage', -v_charged_amount, v_balance_before, v_balance_after, p_usage_event_id, 'Usage charge',
      jsonb_build_object('base_cost_micros', GREATEST(p_base_cost_micros, 0), 'markup_multiplier', p_markup_multiplier, 'affiliate_commission_micros', v_affiliate_commission)
    );

    UPDATE usage_events SET charged_amount_micros = v_charged_amount, affiliate_commission_micros = v_affiliate_commission, markup_multiplier = p_markup_multiplier WHERE id = p_usage_event_id;
  END IF;

  -- Affiliate logic
  IF p_affiliate_id IS NOT NULL AND v_affiliate_commission > 0 THEN
    SELECT * INTO v_affiliate_settings FROM affiliate_settings WHERE user_id = p_affiliate_id FOR UPDATE;
    IF FOUND THEN
      UPDATE affiliate_settings 
      SET total_commission_earned_micros = COALESCE(total_commission_earned_micros, 0) + v_affiliate_commission,
          pending_commission_micros = COALESCE(pending_commission_micros, 0) + v_affiliate_commission
      WHERE user_id = p_affiliate_id;
    ELSE
      INSERT INTO affiliate_settings (user_id, total_commission_earned_micros, pending_commission_micros)
      VALUES (p_affiliate_id, v_affiliate_commission, v_affiliate_commission);
    END IF;

    INSERT INTO credit_transactions (
      user_id, type, amount_micros, balance_before_micros, balance_after_micros, usage_event_id, description, metadata
    ) VALUES (
      p_affiliate_id, 'affiliate_commission', v_affiliate_commission, 0, 0, p_usage_event_id, 'Affiliate commission accrued',
      jsonb_build_object('source_user_id', p_user_id)
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
