# Pay-Per-Use Billing System Implementation Plan

## Context

The current system uses subscription-based billing (Free Trial: 3/month, Pro: unlimited at $99/month). The business needs to pivot to a **pay-per-use model** where:

1. **Users pay only for what they use** based on actual Gemini API costs
2. **Markup is configurable per user type** (3x for regular users, 4x for affiliate customers)
3. **First generation is free** (no credit card required)
4. **Affiliate commission system** via Stripe Connect (1x markup difference goes to affiliate)
5. **Credit balance system** with auto-recharge and manual top-ups

### Why This Change?

- **More accessible**: Users can try without commitment ($0 entry barrier)
- **Better unit economics**: Charge based on actual costs with predictable markup
- **Scalable affiliate program**: Automated commission via Stripe Connect
- **Flexible pricing**: Admin controls markup rates dynamically

---

## High-Level Architecture

```
User Action (Generate/Edit/Transcribe)
  ↓
Check credit balance (sufficient funds?)
  ↓
Call Gemini API (capture token usage)
  ↓
Calculate cost:
  - Base cost (Gemini pricing)
  - Apply markup (3x or 4x based on user/affiliate)
  - 1x → Google
  - 2x → Platform revenue
  - 1x → Affiliate (if applicable, via Stripe Connect)
  ↓
Deduct from user balance
  ↓
Record transaction in ledger
  ↓
If balance < threshold: trigger auto-recharge (if enabled)
```

---

## Database Changes

### 1. New Table: `user_credits`

Tracks credit balance for each user.

```sql
CREATE TABLE user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE UNIQUE NOT NULL,

  -- Balance tracking (in micro-dollars)
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

### 2. New Table: `credit_transactions`

Immutable ledger of all credit movements.

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

### 3. New Table: `affiliate_settings`

Stores affiliate Stripe Connect account and commission settings.

```sql
CREATE TABLE affiliate_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE UNIQUE NOT NULL,

  -- Stripe Connect
  stripe_connect_account_id TEXT UNIQUE,
  stripe_connect_onboarded BOOLEAN DEFAULT false,

  -- Commission tracking
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

### 4. New Table: `platform_settings`

Admin-configurable markup rates and pricing.

```sql
CREATE TABLE platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT UNIQUE NOT NULL,
  setting_value JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial markup settings
INSERT INTO platform_settings (setting_key, setting_value) VALUES
('markup_regular', '{"multiplier": 3.0, "description": "Regular user markup"}'),
('markup_affiliate', '{"multiplier": 4.0, "description": "Affiliate customer markup"}'),
('min_recharge_micros', '{"amount": 10000000, "description": "$10 minimum"}'),
('default_auto_recharge_threshold', '{"amount": 5000000, "description": "$5 threshold"}'),
('default_auto_recharge_amount', '{"amount": 10000000, "description": "$10 recharge"}');
```

### 5. Modify Existing: `profiles`

Add affiliate relationship tracking.

```sql
ALTER TABLE profiles
ADD COLUMN referred_by_affiliate_id UUID REFERENCES auth.users ON DELETE SET NULL,
ADD COLUMN is_affiliate BOOLEAN DEFAULT false,
ADD COLUMN affiliate_approved_at TIMESTAMPTZ;

CREATE INDEX idx_profiles_referred_by ON profiles(referred_by_affiliate_id);
CREATE INDEX idx_profiles_is_affiliate ON profiles(is_affiliate);
```

### 6. Modify Existing: `usage_events`

Add charged amount and affiliate commission.

```sql
ALTER TABLE usage_events
ADD COLUMN charged_amount_micros BIGINT,  -- Amount charged to user (after markup)
ADD COLUMN affiliate_commission_micros BIGINT DEFAULT 0,  -- Commission earned by affiliate
ADD COLUMN markup_multiplier NUMERIC(4,2);  -- Markup applied (3.0 or 4.0)

CREATE INDEX idx_usage_events_charged_amount ON usage_events(charged_amount_micros);
```

---

## Backend Implementation

### Critical Files to Modify

#### 1. **server/quota.ts**
**Changes:**
- Rename `checkQuota()` → `checkCredits()`
- Check `user_credits.balance_micros` instead of event count
- Apply markup based on user type (regular vs affiliate customer)
- Return estimated cost for next operation

```typescript
export interface CreditStatus {
  allowed: boolean;
  balance_micros: number;
  estimated_cost_micros: number; // For next operation
  markup_multiplier: number; // 3.0 or 4.0
  free_generations_remaining: number;
  auto_recharge_enabled: boolean;
}

export async function checkCredits(
  userId: string,
  operationType: 'generate' | 'edit' | 'transcribe'
): Promise<CreditStatus>

export async function deductCredits(
  userId: string,
  usageEventId: string,
  baseCostMicros: number,
  markupMultiplier: number
): Promise<void>

export async function getMarkupMultiplier(userId: string): Promise<number>
```

#### 2. **server/stripe.ts**
**Add:**
- `createStripeConnectAccount(userId)` - For affiliates
- `createStripeConnectLoginLink(accountId)` - Affiliate dashboard
- `purchaseCredits(userId, amountMicros)` - Buy credits via Stripe
- `processAffiliateCommission(userId, commissionMicros)` - Payout affiliates
- Webhook handler for `payment_intent.succeeded` (credit purchase)

```typescript
export async function createStripeConnectAccount(
  userId: string,
  email: string
): Promise<string>

export async function purchaseCredits(
  userId: string,
  amountMicros: number,
  successUrl: string,
  cancelUrl: string
): Promise<{ checkoutUrl: string }>

export async function processAffiliateCommission(
  affiliateId: string,
  commissionMicros: number,
  usageEventId: string
): Promise<void>
```

#### 3. **server/routes.ts**
**Modify:**
- `/api/generate` - Replace `checkQuota()` with `checkCredits()`, deduct after success
- `/api/edit-post` - Same as above
- `/api/transcribe` - Same as above

**Add:**
- `GET /api/credits` - Get current balance and settings
- `POST /api/credits/purchase` - Buy credits via Stripe
- `PATCH /api/credits/auto-recharge` - Update auto-recharge settings
- `GET /api/affiliate/dashboard` - Affiliate earnings and stats
- `POST /api/affiliate/connect` - Create Stripe Connect account
- `GET /api/affiliate/connect/login` - Get Stripe Connect dashboard link
- `GET /api/admin/markup-settings` - Get current markup rates
- `PATCH /api/admin/markup-settings` - Update markup rates (admin only)

---

## Frontend Implementation

### New Pages

#### 1. **client/src/pages/credits.tsx**
Replace `billing.tsx` with credits management:
- Current balance display (in USD, not micros)
- Recent transactions table
- Purchase credits button (opens Stripe Checkout)
- Auto-recharge toggle and settings
- Free generations used/remaining

#### 2. **client/src/pages/affiliate-dashboard.tsx**
For users with `is_affiliate = true`:
- Total commission earned
- Pending commission
- Referred users count
- Stripe Connect account status
- "Connect Stripe" or "View Payouts" button
- Commission history table

#### 3. **client/src/pages/admin-pricing.tsx**
Admin-only page to configure:
- Regular user markup (slider: 1.0x - 10.0x)
- Affiliate customer markup (slider: 1.0x - 10.0x)
- Minimum recharge amount
- Default auto-recharge settings
- Live preview of pricing (e.g., "If Gemini costs $0.01, user pays $0.03")

### Modified Components

#### **client/src/components/app-sidebar.tsx**
Replace generation counter with credit balance:
```tsx
<div className="sidebar-footer">
  <div className="flex items-center justify-between">
    <span className="text-sm">Saldo:</span>
    <span className="font-semibold">${(balanceMicros / 1_000_000).toFixed(2)}</span>
  </div>
  <Progress value={balancePercent} />
  <Button size="sm" onClick={openPurchaseModal}>Adicionar créditos</Button>
</div>
```

#### **client/src/components/post-creator-dialog.tsx**
Before generating, show estimated cost:
```tsx
<div className="estimated-cost">
  <Info className="w-4 h-4" />
  <span>Custo estimado: ${estimatedCost}</span>
</div>
```

---

## API Endpoints Summary

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/credits` | Get balance + settings | User |
| POST | `/api/credits/purchase` | Buy credits (Stripe) | User |
| PATCH | `/api/credits/auto-recharge` | Update auto-recharge | User |
| GET | `/api/credits/transactions` | Transaction history | User |
| GET | `/api/affiliate/dashboard` | Affiliate stats | Affiliate |
| POST | `/api/affiliate/connect` | Create Stripe Connect | Affiliate |
| GET | `/api/affiliate/connect/login` | Stripe Connect login | Affiliate |
| GET | `/api/admin/markup-settings` | Get markup rates | Admin |
| PATCH | `/api/admin/markup-settings` | Update markup rates | Admin |

---

## Migration Plan

### Step 1: Database Migration
File: `supabase/migrations/20260304000000_pay_per_use_billing.sql`

1. Create new tables (user_credits, credit_transactions, affiliate_settings, platform_settings)
2. Modify existing tables (profiles, usage_events)
3. Seed platform_settings with default markup
4. Migrate existing users to user_credits (1 free generation each)

### Step 2: Backend Core
1. Update `server/quota.ts` (credit checking/deduction)
2. Update `server/stripe.ts` (Connect, credit purchase)
3. Add new endpoints to `server/routes.ts`

### Step 3: Frontend Core
1. Create `credits.tsx` page
2. Update sidebar to show balance
3. Add purchase credits flow

### Step 4: Affiliate System
1. Create `affiliate-dashboard.tsx`
2. Implement Stripe Connect onboarding
3. Add commission payout logic

### Step 5: Admin Controls
1. Create `admin-pricing.tsx`
2. Add markup configuration UI
3. Test markup changes propagate correctly

---

## Verification & Testing

### End-to-End Test Flow

1. **New User Signup**
   - Check `user_credits` record created with `free_generations_limit = 1`
   - Verify balance is $0.00

2. **Free Generation**
   - Generate 1 post without paying
   - Verify `free_generations_used = 1`
   - Verify no credit deduction
   - Try generating again → should be blocked until credits purchased

3. **Purchase Credits**
   - Buy $10 via Stripe
   - Verify `user_credits.balance_micros = 10,000,000`
   - Verify `credit_transactions` record created (type='purchase')

4. **Paid Generation**
   - Generate post (assume Gemini costs $0.015)
   - Verify charged amount = $0.015 × 3 = $0.045
   - Verify balance deducted: $10.00 - $0.045 = $9.955
   - Verify `credit_transactions` record (type='usage')
   - Verify `usage_events.charged_amount_micros = 45000`

5. **Affiliate Flow**
   - Admin marks user as affiliate (`is_affiliate = true`)
   - Affiliate creates Stripe Connect account
   - Affiliate refers new user (set `referred_by_affiliate_id`)
   - Referred user generates post (markup 4x)
   - Verify affiliate earns 1x commission
   - Verify commission recorded in `affiliate_settings`

6. **Auto-Recharge**
   - Set auto-recharge: threshold $5, amount $10
   - Use credits until balance < $5
   - Verify Stripe charge created automatically
   - Verify balance topped up to $10

7. **Admin Markup Change**
   - Admin changes regular markup from 3x to 3.5x
   - Generate post
   - Verify new markup applied (charged_amount = base_cost × 3.5)

---

## Rollback Strategy

If issues arise:

1. **Keep existing subscription system** as fallback
2. **Feature flag**: `PAY_PER_USE_ENABLED` in platform_settings
3. **Gradual rollout**: Enable for new users first, migrate existing later
4. **Data preservation**: Don't delete subscription_plans/user_subscriptions tables

---

## Success Metrics

- 95%+ of new users complete 1 free generation
- 20%+ conversion from free → paid (first $10 purchase)
- Affiliate commission payouts processed within 24h
- Zero balance calculation errors (ledger always balances)
- Admin can change markup and see instant effect

---

## Implementation Time Estimate

- **Database + Core Backend**: 2-3 days
- **Frontend (Credits Page)**: 1-2 days
- **Affiliate System**: 2-3 days
- **Admin Controls**: 1 day
- **Testing + QA**: 2 days

**Total**: ~8-11 days for full implementation
