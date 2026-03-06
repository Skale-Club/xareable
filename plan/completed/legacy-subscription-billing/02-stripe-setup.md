# Billing - Stripe Setup

## 1. STRIPE_SECRET_KEY

**Path:** Dashboard -> Developers -> API keys

1. Go to https://dashboard.stripe.com
2. Left menu -> **Developers** -> **API keys**
3. In **Standard keys**, click **Reveal test key** (development) or **Reveal live key** (production)
4. Copy the key `sk_test_...` or `sk_live_...`

---

## 2. Create product and get stripe_price_id

**Path:** Dashboard -> Product catalog -> + Add product

1. Left menu -> **Product catalog**
2. Click **+ Add product**
3. Name: `Social Autopilot Pro`
4. In pricing section:
   - Type: **Recurring**
   - Period: **Monthly**
   - Amount: example `99.00` USD
5. Save -> on product page, in **Pricing**, copy the **Price ID** (`price_xxx`)
6. Update the database with that Price ID:

```sql
UPDATE subscription_plans
SET stripe_price_id = 'price_YOUR_ID_HERE',
    price_cents = 9900
WHERE name = 'pro';
```

---

## 3. STRIPE_WEBHOOK_SECRET

### In development (Stripe CLI - recommended)

```bash
# Install Stripe CLI
npm install -g stripe

# Authenticate
stripe login

# Listen and forward to local server
stripe listen --forward-to localhost:5000/api/stripe/webhook
```

Terminal output will show:
```
Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx
```

Copy this value into `.env`.

### In production (Stripe Dashboard)

**Path:** Dashboard -> Developers -> Webhooks -> + Add endpoint

1. Endpoint URL: `https://your-domain.com/api/stripe/webhook`
2. Select events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Save -> on endpoint page, click **Reveal** under **Signing secret** -> copy `whsec_...`

Before enabling production, configure the **Billing Portal**:
- Dashboard -> **Settings** -> **Billing** -> **Customer Portal** -> enable and save

---

## 4. Configure .env

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_URL=http://localhost:5000
```

> Use `sk_test_` in development. Use `sk_live_` keys only in production.

---

## 5. Stripe test cards

| Number | Result |
|---|---|
| `4242 4242 4242 4242` | Payment approved |
| `4000 0000 0000 9995` | Card declined |

Expiry: any future date. CVC: any 3 digits.

---

## Checklist

- [ ] Stripe account created
- [ ] `STRIPE_SECRET_KEY` copied to `.env`
- [ ] "Social Autopilot Pro" product created with monthly recurring price
- [ ] `stripe_price_id` updated in DB (`UPDATE subscription_plans...`)
- [ ] Stripe CLI installed (`npm install -g stripe`)
- [ ] `STRIPE_WEBHOOK_SECRET` copied to `.env` from `stripe listen`
- [ ] SQL migration executed in Supabase (`supabase/migrations/20260302000000_stripe_billing.sql`)
