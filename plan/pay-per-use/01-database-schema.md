# Database Schema - Pay-Per-Use System

## Current Build Status (Updated 2026-03-03)

- Done in repo: migration file exists at `supabase/migrations/20260303010000_pay_per_use_billing.sql`
- Done in repo: schema includes `user_credits`, `credit_transactions`, `affiliate_settings`, `platform_settings`, and `usage_events` charge fields
- Done in environment: the migration was applied to the actual database on 2026-03-03
- Done in repo and environment: cleanup migration exists at `supabase/migrations/20260303020000_remove_subscription_legacy.sql` and was applied on 2026-03-03
- Done in environment: legacy `subscription_plans` and `user_subscriptions` tables were removed

## New Tables

### 1. user_credits
**Purpose**: Track credit balance and auto-recharge settings for each user

```sql
CREATE TABLE user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE UNIQUE NOT NULL,

  -- Balance tracking (in micro-dollars: 1 USD = 1,000,000 micros)
  balance_micros BIGINT DEFAULT 0 NOT NULL,
  lifetime_purchased_micros BIGINT DEFAULT 0 NOT NULL,
  lifetime_used_micros BIGINT DEFAULT 0 NOT NULL,

  -- Free generation tracking
  free_generations_used INTEGER DEFAULT 0 NOT NULL,
  free_generations_limit INTEGER DEFAULT 1 NOT NULL,

  -- Auto-recharge settings
  auto_recharge_enabled BOOLEAN DEFAULT false,
  auto_recharge_threshold_micros BIGINT DEFAULT 5000000, -- $5 default
  auto_recharge_amount_micros BIGINT DEFAULT 10000000,  -- $10 default

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_credits_user_id ON user_credits(user_id);
CREATE INDEX idx_user_credits_balance ON user_credits(balance_micros);
```

### 2. credit_transactions
**Purpose**: Immutable ledger of all credit movements (purchases, usage, refunds)

```sql
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,

  -- Transaction type
  type TEXT NOT NULL CHECK (type IN ('purchase', 'usage', 'refund', 'bonus', 'affiliate_commission')),

  -- Amount (negative for usage, positive for purchase)
  amount_micros BIGINT NOT NULL,
  balance_before_micros BIGINT NOT NULL,
  balance_after_micros BIGINT NOT NULL,

  -- Related records
  usage_event_id UUID REFERENCES usage_events ON DELETE SET NULL,
  stripe_payment_intent_id TEXT,
  stripe_payout_id TEXT,  -- For affiliate commissions

  -- Metadata
  description TEXT,
  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(type);
CREATE INDEX idx_credit_transactions_created_at ON credit_transactions(created_at);
```

### 3. affiliate_settings
**Purpose**: Stripe Connect account and commission tracking for affiliates

```sql
CREATE TABLE affiliate_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE UNIQUE NOT NULL,

  -- Stripe Connect
  stripe_connect_account_id TEXT UNIQUE,
  stripe_connect_onboarded BOOLEAN DEFAULT false,

  -- Commission tracking (in micro-dollars)
  total_commission_earned_micros BIGINT DEFAULT 0,
  total_commission_paid_micros BIGINT DEFAULT 0,
  pending_commission_micros BIGINT DEFAULT 0,

  -- Payout settings
  minimum_payout_micros BIGINT DEFAULT 50000000, -- $50 minimum
  auto_payout_enabled BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_affiliate_settings_user_id ON affiliate_settings(user_id);
CREATE INDEX idx_affiliate_settings_stripe ON affiliate_settings(stripe_connect_account_id);
```

### 4. platform_settings
**Purpose**: Admin-configurable markup rates and global settings

```sql
CREATE TABLE platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT UNIQUE NOT NULL,
  setting_value JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial settings
INSERT INTO platform_settings (setting_key, setting_value) VALUES
('markup_regular', '{"multiplier": 3.0, "description": "Regular user markup (3x)"}'),
('markup_affiliate', '{"multiplier": 4.0, "description": "Affiliate customer markup (4x)"}'),
('min_recharge_micros', '{"amount": 10000000, "description": "$10 minimum first purchase"}'),
('min_topup_micros', '{"amount": 10000000, "description": "$10 minimum top-up"}'),
('default_auto_recharge_threshold', '{"amount": 5000000, "description": "$5 threshold"}'),
('default_auto_recharge_amount', '{"amount": 10000000, "description": "$10 recharge"}');
```

## Modified Tables

### 5. profiles (ADD COLUMNS)
**Purpose**: Track affiliate relationships

```sql
ALTER TABLE profiles
ADD COLUMN referred_by_affiliate_id UUID REFERENCES auth.users ON DELETE SET NULL,
ADD COLUMN is_affiliate BOOLEAN DEFAULT false,
ADD COLUMN affiliate_approved_at TIMESTAMPTZ;

CREATE INDEX idx_profiles_referred_by ON profiles(referred_by_affiliate_id);
CREATE INDEX idx_profiles_is_affiliate ON profiles(is_affiliate);
```

### 6. usage_events (ADD COLUMNS)
**Purpose**: Track charged amount and commission per event

```sql
ALTER TABLE usage_events
ADD COLUMN charged_amount_micros BIGINT,  -- Amount charged to user (after markup)
ADD COLUMN affiliate_commission_micros BIGINT DEFAULT 0,  -- Commission for affiliate
ADD COLUMN markup_multiplier NUMERIC(4,2);  -- Markup applied (3.0 or 4.0)

CREATE INDEX idx_usage_events_charged_amount ON usage_events(charged_amount_micros);
```

## RLS Policies

### user_credits
```sql
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credits"
  ON user_credits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own recharge settings"
  ON user_credits FOR UPDATE
  USING (auth.uid() = user_id);
```

### credit_transactions
```sql
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON credit_transactions FOR SELECT
  USING (auth.uid() = user_id);
```

### affiliate_settings
```sql
ALTER TABLE affiliate_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Affiliates can view own settings"
  ON affiliate_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Affiliates can update own settings"
  ON affiliate_settings FOR UPDATE
  USING (auth.uid() = user_id);
```

### platform_settings
```sql
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view platform settings"
  ON platform_settings FOR SELECT
  USING (true);

CREATE POLICY "Only admins can update platform settings"
  ON platform_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );
```

## Triggers

### Update user_credits.updated_at
```sql
CREATE OR REPLACE FUNCTION update_user_credits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_credits_updated_at
  BEFORE UPDATE ON user_credits
  FOR EACH ROW
  EXECUTE FUNCTION update_user_credits_updated_at();
```

### Auto-create user_credits on signup
```sql
CREATE OR REPLACE FUNCTION handle_new_user_credits()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_credits (user_id, free_generations_limit)
  VALUES (NEW.id, 1);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user_credits();
```

## Migration File Locations
- `supabase/migrations/20260303010000_pay_per_use_billing.sql`
- `supabase/migrations/20260303020000_remove_subscription_legacy.sql`
