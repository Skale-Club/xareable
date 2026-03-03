# Backend API - Pay-Per-Use System

## Modified Files

### 1. server/quota.ts
**Rename**: `checkQuota()` → `checkCredits()`

#### New Functions

```typescript
export interface CreditStatus {
  allowed: boolean;
  balance_micros: number;
  estimated_cost_micros: number;
  markup_multiplier: number;
  free_generations_remaining: number;
  auto_recharge_enabled: boolean;
}

// Check if user has sufficient credits
export async function checkCredits(
  userId: string,
  operationType: 'generate' | 'edit' | 'transcribe'
): Promise<CreditStatus>

// Deduct credits after successful operation
export async function deductCredits(
  userId: string,
  usageEventId: string,
  baseCostMicros: number,
  markupMultiplier: number
): Promise<void>

// Get markup multiplier for user (3.0 or 4.0)
export async function getMarkupMultiplier(userId: string): Promise<number>

// Trigger auto-recharge if needed
export async function triggerAutoRecharge(userId: string): Promise<boolean>
```

#### Implementation Details

**checkCredits()**:
1. Fetch `user_credits` record
2. Check if `free_generations_used < free_generations_limit` → allow free
3. If not free, estimate cost (use average from last 10 events of same type)
4. Check if `balance_micros >= estimated_cost`
5. Return `CreditStatus`

**deductCredits()**:
1. Lock `user_credits` row (`SELECT FOR UPDATE`)
2. Calculate charged amount: `base_cost × markup_multiplier`
3. Calculate affiliate commission (if applicable): `base_cost × 1.0`
4. Deduct from balance: `balance_micros -= charged_amount`
5. Insert `credit_transactions` record (type='usage')
6. Update `usage_events` with `charged_amount_micros`, `affiliate_commission_micros`
7. If affiliate exists, update `affiliate_settings.pending_commission_micros`
8. Check if balance < threshold → trigger auto-recharge

**getMarkupMultiplier()**:
1. Fetch user's `referred_by_affiliate_id` from `profiles`
2. If NULL → return 3.0 (regular user)
3. If set → return 4.0 (affiliate customer)
4. Read multipliers from `platform_settings` (admin can change)

---

### 2. server/stripe.ts

#### New Functions

```typescript
// Create Stripe Connect account for affiliate
export async function createStripeConnectAccount(
  userId: string,
  email: string
): Promise<string>

// Get Stripe Connect dashboard login link
export async function createStripeConnectLoginLink(
  accountId: string
): Promise<string>

// Purchase credits via Stripe Checkout
export async function purchaseCredits(
  userId: string,
  amountMicros: number,
  successUrl: string,
  cancelUrl: string
): Promise<{ checkoutUrl: string }>

// Process affiliate commission payout
export async function processAffiliateCommission(
  affiliateId: string,
  commissionMicros: number,
  usageEventId: string
): Promise<void>
```

#### Implementation Details

**createStripeConnectAccount()**:
```typescript
const account = await stripe.accounts.create({
  type: 'express',
  email,
  capabilities: {
    transfers: { requested: true },
  },
  business_type: 'individual',
  metadata: { userId }
});

// Store in affiliate_settings
await supabase
  .from('affiliate_settings')
  .upsert({
    user_id: userId,
    stripe_connect_account_id: account.id
  });

// Return account link for onboarding
const accountLink = await stripe.accountLinks.create({
  account: account.id,
  refresh_url: `${APP_URL}/affiliate?refresh=1`,
  return_url: `${APP_URL}/affiliate?success=1`,
  type: 'account_onboarding'
});

return accountLink.url;
```

**purchaseCredits()**:
```typescript
const session = await stripe.checkout.sessions.create({
  payment_method_types: ['card'],
  line_items: [{
    price_data: {
      currency: 'usd',
      product_data: {
        name: 'Xareable Credits',
        description: `$${(amountMicros / 1_000_000).toFixed(2)} in credits`
      },
      unit_amount: Math.round(amountMicros / 10000) // Convert micros to cents
    },
    quantity: 1
  }],
  mode: 'payment',
  success_url: successUrl,
  cancel_url: cancelUrl,
  metadata: {
    userId,
    creditsMicros: amountMicros.toString(),
    type: 'credit_purchase'
  }
});

return { checkoutUrl: session.url };
```

**processAffiliateCommission()** (called by auto-payout cron):
```typescript
const transfer = await stripe.transfers.create({
  amount: Math.round(commissionMicros / 10000), // Convert to cents
  currency: 'usd',
  destination: stripeConnectAccountId,
  metadata: {
    affiliateId,
    usageEventId
  }
});

// Update affiliate_settings
await supabase
  .from('affiliate_settings')
  .update({
    total_commission_paid_micros: sql`total_commission_paid_micros + ${commissionMicros}`,
    pending_commission_micros: sql`pending_commission_micros - ${commissionMicros}`
  })
  .eq('user_id', affiliateId);

// Record in credit_transactions
await supabase
  .from('credit_transactions')
  .insert({
    user_id: affiliateId,
    type: 'affiliate_commission',
    amount_micros: commissionMicros,
    stripe_payout_id: transfer.id
  });
```

#### Webhook Handler Updates

**Add handler for `payment_intent.succeeded`**:
```typescript
case 'payment_intent.succeeded': {
  const paymentIntent = event.data.object;
  const { userId, creditsMicros } = paymentIntent.metadata;

  // Add credits to user balance
  const { data: credits } = await supabase
    .from('user_credits')
    .select('balance_micros')
    .eq('user_id', userId)
    .single();

  await supabase
    .from('user_credits')
    .update({
      balance_micros: sql`balance_micros + ${creditsMicros}`,
      lifetime_purchased_micros: sql`lifetime_purchased_micros + ${creditsMicros}`
    })
    .eq('user_id', userId);

  // Record transaction
  await supabase
    .from('credit_transactions')
    .insert({
      user_id: userId,
      type: 'purchase',
      amount_micros: creditsMicros,
      balance_before_micros: credits.balance_micros,
      balance_after_micros: credits.balance_micros + creditsMicros,
      stripe_payment_intent_id: paymentIntent.id
    });

  break;
}
```

---

### 3. server/routes.ts

#### Modified Endpoints

**POST /api/generate** (similar changes for /api/edit-post, /api/transcribe):
```typescript
// BEFORE (old quota check)
const quota = await checkQuota(user.id);
if (!quota.allowed) {
  return res.status(402).json({ error: 'quota_exceeded', ... });
}

// AFTER (credit check)
const creditStatus = await checkCredits(user.id, 'generate');
if (!creditStatus.allowed && creditStatus.free_generations_remaining === 0) {
  return res.status(402).json({
    error: 'insufficient_credits',
    message: 'Insufficient credits. Please add credits to continue.',
    balance_micros: creditStatus.balance_micros,
    estimated_cost_micros: creditStatus.estimated_cost_micros
  });
}

// ... Gemini API calls ...

// AFTER successful generation:
if (creditStatus.free_generations_remaining === 0) {
  const markupMultiplier = await getMarkupMultiplier(user.id);
  await deductCredits(user.id, usageEvent.id, costMicros, markupMultiplier);
}
```

#### New Endpoints

**GET /api/credits**
```typescript
app.get('/api/credits', async (req, res) => {
  const { user } = await authenticate(req);

  const { data } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', user.id)
    .single();

  return res.json(data);
});
```

**POST /api/credits/purchase**
```typescript
app.post('/api/credits/purchase', async (req, res) => {
  const { user } = await authenticate(req);
  const { amountMicros } = req.body;

  // Validate minimum
  const minRecharge = await getPlatformSetting('min_recharge_micros');
  if (amountMicros < minRecharge) {
    return res.status(400).json({ error: 'Below minimum' });
  }

  const { checkoutUrl } = await purchaseCredits(
    user.id,
    amountMicros,
    `${APP_URL}/credits?success=1`,
    `${APP_URL}/credits?canceled=1`
  );

  return res.json({ url: checkoutUrl });
});
```

**PATCH /api/credits/auto-recharge**
```typescript
app.patch('/api/credits/auto-recharge', async (req, res) => {
  const { user } = await authenticate(req);
  const { enabled, thresholdMicros, amountMicros } = req.body;

  await supabase
    .from('user_credits')
    .update({
      auto_recharge_enabled: enabled,
      auto_recharge_threshold_micros: thresholdMicros,
      auto_recharge_amount_micros: amountMicros
    })
    .eq('user_id', user.id);

  return res.json({ success: true });
});
```

**GET /api/affiliate/dashboard**
```typescript
app.get('/api/affiliate/dashboard', async (req, res) => {
  const { user } = await authenticate(req);

  const { data: settings } = await supabase
    .from('affiliate_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  const { count: referredCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('referred_by_affiliate_id', user.id);

  return res.json({
    ...settings,
    referred_users_count: referredCount
  });
});
```

**POST /api/affiliate/connect**
```typescript
app.post('/api/affiliate/connect', async (req, res) => {
  const { user } = await authenticate(req);

  const onboardingUrl = await createStripeConnectAccount(
    user.id,
    user.email
  );

  return res.json({ url: onboardingUrl });
});
```

**GET /api/admin/markup-settings**
```typescript
app.get('/api/admin/markup-settings', async (req, res) => {
  await requireAdmin(req);

  const { data } = await supabase
    .from('platform_settings')
    .select('*')
    .in('setting_key', ['markup_regular', 'markup_affiliate']);

  return res.json({ settings: data });
});
```

**PATCH /api/admin/markup-settings**
```typescript
app.patch('/api/admin/markup-settings', async (req, res) => {
  const { user } = await requireAdmin(req);
  const { regularMultiplier, affiliateMultiplier } = req.body;

  await supabase
    .from('platform_settings')
    .update({ setting_value: { multiplier: regularMultiplier }, updated_by: user.id })
    .eq('setting_key', 'markup_regular');

  await supabase
    .from('platform_settings')
    .update({ setting_value: { multiplier: affiliateMultiplier }, updated_by: user.id })
    .eq('setting_key', 'markup_affiliate');

  return res.json({ success: true });
});
```

## Error Handling

### New Error Codes

| Code | HTTP Status | Message | Action |
|------|-------------|---------|--------|
| `insufficient_credits` | 402 | Insufficient credits | Show "Add Credits" modal |
| `below_minimum_purchase` | 400 | Below $10 minimum | Show error in UI |
| `auto_recharge_failed` | 500 | Auto-recharge failed | Notify user via email |
| `affiliate_not_onboarded` | 403 | Complete Stripe onboarding | Redirect to Connect |
