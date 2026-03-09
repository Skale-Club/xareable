-- Billing token-pricing, affiliate profit share, and statement foundations

-- 1) Usage event financial fields
alter table public.usage_events
  add column if not exists gross_profit_micros bigint,
  add column if not exists platform_net_micros bigint;

-- 2) Per-affiliate commission share over gross profit
alter table public.affiliate_settings
  add column if not exists commission_share_percent numeric(5,2) not null default 50;

alter table public.affiliate_settings
  drop constraint if exists affiliate_settings_commission_share_percent_check;

alter table public.affiliate_settings
  add constraint affiliate_settings_commission_share_percent_check
  check (commission_share_percent >= 0 and commission_share_percent <= 100);

-- 3) Token pricing + fallback pricing settings
insert into public.platform_settings (setting_key, setting_value)
values
  (
    'token_pricing_text_input',
    '{"cost_per_million":0.075,"sell_per_million":0.225,"description":"Text input pricing per 1M tokens"}'::jsonb
  ),
  (
    'token_pricing_text_output',
    '{"cost_per_million":0.300,"sell_per_million":0.900,"description":"Text output pricing per 1M tokens"}'::jsonb
  ),
  (
    'token_pricing_image_input',
    '{"cost_per_million":0.075,"sell_per_million":0.225,"description":"Image input pricing per 1M tokens"}'::jsonb
  ),
  (
    'token_pricing_image_output',
    '{"cost_per_million":0.300,"sell_per_million":0.900,"description":"Image output pricing per 1M tokens"}'::jsonb
  ),
  (
    'image_fallback_pricing',
    '{"cost_micros":39000,"sell_micros":117000,"description":"Fallback pricing for image events without token metadata"}'::jsonb
  ),
  (
    'transcribe_fallback_pricing',
    '{"cost_micros":1500,"sell_micros":4500,"description":"Fallback pricing for transcription events without token metadata"}'::jsonb
  ),
  (
    'default_affiliate_commission_percent',
    '{"amount":50,"description":"Default affiliate commission share percent over gross profit"}'::jsonb
  )
on conflict (setting_key) do nothing;

-- 4) Stripe webhook deduplication log
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb,
  received_at timestamp with time zone not null default timezone('utc'::text, now()),
  processed_at timestamp with time zone
);

create index if not exists idx_stripe_webhook_events_processed_at
  on public.stripe_webhook_events(processed_at);

-- 5) Replace deduction RPC with explicit raw/sell amounts and profit-share commission logic
DROP FUNCTION IF EXISTS public.process_usage_deduction_tx(uuid, uuid, bigint, numeric, text, boolean, uuid);

CREATE OR REPLACE FUNCTION public.process_usage_deduction_tx(
  p_user_id uuid,
  p_usage_event_id uuid,
  p_raw_cost_micros bigint,
  p_charged_cost_micros bigint,
  p_billing_model text,
  p_is_admin_or_affiliate boolean,
  p_affiliate_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_raw_cost bigint := GREATEST(COALESCE(p_raw_cost_micros, 0), 0);
  v_charged_amount bigint := GREATEST(COALESCE(p_charged_cost_micros, 0), 0);
  v_gross_profit bigint := 0;
  v_platform_net bigint := 0;
  v_affiliate_commission bigint := 0;
  v_affiliate_share_percent numeric := 0;
  v_default_affiliate_share_percent numeric := 50;
  v_markup_multiplier numeric := 0;

  v_profile record;
  v_credits record;

  v_included_before bigint := 0;
  v_credit_pack_before bigint := 0;
  v_pending_before bigint := 0;

  v_included_used bigint := 0;
  v_remaining_after_included bigint := 0;
  v_credit_pack_used bigint := 0;
  v_overage bigint := 0;

  v_included_after bigint := 0;
  v_pending_after bigint := 0;
  v_credit_pack_after bigint := 0;

  v_balance_before bigint := 0;
  v_balance_after bigint := 0;
  v_free_limit int := 0;
  v_free_used int := 0;
  v_free_remaining int := 0;
BEGIN
  IF p_is_admin_or_affiliate THEN
    UPDATE usage_events
      SET charged_amount_micros = 0,
          affiliate_commission_micros = 0,
          gross_profit_micros = 0,
          platform_net_micros = 0,
          markup_multiplier = 0
    WHERE id = p_usage_event_id;
    RETURN;
  END IF;

  IF v_raw_cost > 0 THEN
    v_markup_multiplier := v_charged_amount::numeric / v_raw_cost::numeric;
  ELSIF v_charged_amount > 0 THEN
    v_markup_multiplier := 1;
  ELSE
    v_markup_multiplier := 0;
  END IF;

  v_gross_profit := GREATEST(v_charged_amount - v_raw_cost, 0);

  IF p_affiliate_id IS NOT NULL AND v_gross_profit > 0 THEN
    SELECT (setting_value->>'amount')::numeric
      INTO v_default_affiliate_share_percent
    FROM platform_settings
    WHERE setting_key = 'default_affiliate_commission_percent'
    LIMIT 1;

    v_default_affiliate_share_percent := COALESCE(v_default_affiliate_share_percent, 50);

    SELECT commission_share_percent
      INTO v_affiliate_share_percent
    FROM affiliate_settings
    WHERE user_id = p_affiliate_id
    FOR UPDATE;

    v_affiliate_share_percent := COALESCE(v_affiliate_share_percent, v_default_affiliate_share_percent);
    v_affiliate_share_percent := LEAST(GREATEST(v_affiliate_share_percent, 0), 100);

    v_affiliate_commission := ROUND(v_gross_profit::numeric * (v_affiliate_share_percent / 100.0));
  END IF;

  v_platform_net := GREATEST(v_gross_profit - v_affiliate_commission, 0);

  IF p_billing_model = 'subscription_overage' THEN
    SELECT * INTO v_profile
    FROM user_billing_profiles
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Billing profile not found';
    END IF;

    IF v_profile.subscription_status NOT IN ('active', 'trialing', 'past_due') THEN
      RAISE EXCEPTION 'Active subscription required';
    END IF;

    SELECT * INTO v_credits
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO user_credits (
        user_id,
        balance_micros,
        lifetime_purchased_micros,
        lifetime_used_micros
      )
      VALUES (
        p_user_id,
        0,
        0,
        0
      )
      RETURNING * INTO v_credits;
    END IF;

    v_included_before := COALESCE(v_profile.included_credits_remaining_micros, 0);
    v_credit_pack_before := COALESCE(v_credits.balance_micros, 0);
    v_pending_before := COALESCE(v_profile.pending_overage_micros, 0);

    v_included_used := LEAST(v_included_before, v_charged_amount);
    v_remaining_after_included := GREATEST(v_charged_amount - v_included_used, 0);
    v_credit_pack_used := LEAST(v_credit_pack_before, v_remaining_after_included);
    v_overage := GREATEST(v_remaining_after_included - v_credit_pack_used, 0);

    v_included_after := v_included_before - v_included_used;
    v_credit_pack_after := v_credit_pack_before - v_credit_pack_used;
    v_pending_after := v_pending_before + v_overage;

    UPDATE user_billing_profiles
      SET included_credits_remaining_micros = v_included_after,
          pending_overage_micros = v_pending_after
    WHERE user_id = p_user_id;

    IF v_credit_pack_used > 0 THEN
      UPDATE user_credits
        SET balance_micros = v_credit_pack_after,
            lifetime_used_micros = COALESCE(v_credits.lifetime_used_micros, 0) + v_credit_pack_used
      WHERE user_id = p_user_id;

      INSERT INTO credit_transactions (
        user_id,
        type,
        amount_micros,
        balance_before_micros,
        balance_after_micros,
        usage_event_id,
        description,
        metadata
      ) VALUES (
        p_user_id,
        'usage',
        -v_credit_pack_used,
        v_credit_pack_before,
        v_credit_pack_after,
        p_usage_event_id,
        'Credit pack usage',
        jsonb_build_object(
          'kind', 'credit_pack_usage',
          'billing_model', 'subscription_overage',
          'raw_cost_micros', v_raw_cost,
          'charged_cost_micros', v_charged_amount,
          'gross_profit_micros', v_gross_profit,
          'affiliate_commission_micros', v_affiliate_commission
        )
      );
    END IF;

    IF v_included_used > 0 THEN
      INSERT INTO billing_ledger (
        user_id,
        entry_type,
        amount_micros,
        balance_included_after_micros,
        pending_overage_after_micros,
        usage_event_id,
        metadata
      ) VALUES (
        p_user_id,
        'included_credit_usage',
        -v_included_used,
        v_included_after,
        v_pending_before,
        p_usage_event_id,
        jsonb_build_object(
          'raw_cost_micros', v_raw_cost,
          'charged_cost_micros', v_charged_amount,
          'gross_profit_micros', v_gross_profit,
          'affiliate_commission_micros', v_affiliate_commission
        )
      );
    END IF;

    IF v_credit_pack_used > 0 THEN
      INSERT INTO billing_ledger (
        user_id,
        entry_type,
        amount_micros,
        balance_included_after_micros,
        pending_overage_after_micros,
        usage_event_id,
        metadata
      ) VALUES (
        p_user_id,
        'manual_adjustment',
        v_credit_pack_used,
        v_included_after,
        v_pending_before,
        p_usage_event_id,
        jsonb_build_object(
          'kind', 'credit_pack_usage',
          'credit_pack_balance_after_micros', v_credit_pack_after,
          'raw_cost_micros', v_raw_cost,
          'charged_cost_micros', v_charged_amount,
          'gross_profit_micros', v_gross_profit,
          'affiliate_commission_micros', v_affiliate_commission
        )
      );
    END IF;

    IF v_overage > 0 THEN
      INSERT INTO billing_ledger (
        user_id,
        entry_type,
        amount_micros,
        balance_included_after_micros,
        pending_overage_after_micros,
        usage_event_id,
        metadata
      ) VALUES (
        p_user_id,
        'overage_accrual',
        v_overage,
        v_included_after,
        v_pending_after,
        p_usage_event_id,
        jsonb_build_object(
          'raw_cost_micros', v_raw_cost,
          'charged_cost_micros', v_charged_amount,
          'gross_profit_micros', v_gross_profit,
          'affiliate_commission_micros', v_affiliate_commission
        )
      );
    END IF;

  ELSE
    SELECT * INTO v_credits
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User credits not found';
    END IF;

    v_free_limit := COALESCE(v_credits.free_generations_limit, 0);
    v_free_used := COALESCE(v_credits.free_generations_used, 0);
    v_free_remaining := GREATEST(v_free_limit - v_free_used, 0);

    IF v_free_remaining > 0 THEN
      UPDATE user_credits
        SET free_generations_used = v_free_used + 1
      WHERE user_id = p_user_id;

      UPDATE usage_events
        SET charged_amount_micros = 0,
            affiliate_commission_micros = 0,
            gross_profit_micros = 0,
            platform_net_micros = 0,
            markup_multiplier = 0
      WHERE id = p_usage_event_id;

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
      user_id,
      type,
      amount_micros,
      balance_before_micros,
      balance_after_micros,
      usage_event_id,
      description,
      metadata
    ) VALUES (
      p_user_id,
      'usage',
      -v_charged_amount,
      v_balance_before,
      v_balance_after,
      p_usage_event_id,
      'Usage charge',
      jsonb_build_object(
        'raw_cost_micros', v_raw_cost,
        'charged_cost_micros', v_charged_amount,
        'gross_profit_micros', v_gross_profit,
        'affiliate_commission_micros', v_affiliate_commission
      )
    );
  END IF;

  UPDATE usage_events
    SET charged_amount_micros = v_charged_amount,
        affiliate_commission_micros = v_affiliate_commission,
        gross_profit_micros = v_gross_profit,
        platform_net_micros = v_platform_net,
        markup_multiplier = v_markup_multiplier
  WHERE id = p_usage_event_id;

  IF p_affiliate_id IS NOT NULL AND v_affiliate_commission > 0 THEN
    UPDATE affiliate_settings
      SET total_commission_earned_micros = COALESCE(total_commission_earned_micros, 0) + v_affiliate_commission,
          pending_commission_micros = COALESCE(pending_commission_micros, 0) + v_affiliate_commission,
          commission_share_percent = CASE
            WHEN commission_share_percent IS NULL THEN v_affiliate_share_percent
            ELSE commission_share_percent
          END
    WHERE user_id = p_affiliate_id;

    IF NOT FOUND THEN
      INSERT INTO affiliate_settings (
        user_id,
        total_commission_earned_micros,
        pending_commission_micros,
        commission_share_percent
      ) VALUES (
        p_affiliate_id,
        v_affiliate_commission,
        v_affiliate_commission,
        COALESCE(NULLIF(v_affiliate_share_percent, 0), v_default_affiliate_share_percent)
      );
    END IF;

    INSERT INTO credit_transactions (
      user_id,
      type,
      amount_micros,
      balance_before_micros,
      balance_after_micros,
      usage_event_id,
      description,
      metadata
    ) VALUES (
      p_affiliate_id,
      'affiliate_commission',
      v_affiliate_commission,
      0,
      0,
      p_usage_event_id,
      'Affiliate commission accrued',
      jsonb_build_object(
        'source_user_id', p_user_id,
        'commission_share_percent', v_affiliate_share_percent,
        'gross_profit_micros', v_gross_profit,
        'platform_net_micros', v_platform_net
      )
    );
  END IF;
END;
$$;
