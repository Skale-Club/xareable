# Billing - API Endpoints

## New Endpoints

### `GET /api/billing/plans`

Lists active plans ordered by price.

**Auth:** No authentication required

**Response:**
```json
{
  "plans": [
    {
      "id": "uuid",
      "name": "free_trial",
      "display_name": "Free Trial",
      "stripe_price_id": null,
      "monthly_limit": 3,
      "price_cents": 0,
      "is_active": true,
      "created_at": "..."
    },
    {
      "id": "uuid",
      "name": "pro",
      "display_name": "Pro",
      "stripe_price_id": "price_xxx",
      "monthly_limit": null,
      "price_cents": 9900,
      "is_active": true,
      "created_at": "..."
    }
  ]
}
```

---

### `GET /api/billing/subscription`

Returns current user subscription + current period usage.

**Auth:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "plan": { /* SubscriptionPlan */ },
  "subscription": {
    "id": "uuid",
    "user_id": "uuid",
    "plan_id": "uuid",
    "stripe_customer_id": "cus_xxx",
    "stripe_subscription_id": "sub_xxx",
    "status": "active",
    "current_period_start": "2026-03-01T00:00:00Z",
    "current_period_end": "2026-04-01T00:00:00Z",
    "created_at": "...",
    "updated_at": "..."
  },
  "used": 1,
  "limit": null
}
```

---

### `POST /api/billing/checkout`

Creates a Stripe Checkout session and returns redirect URL.

**Auth:** `Authorization: Bearer <token>`

**Request:**
```json
{ "priceId": "price_xxx" }
```

**Response:**
```json
{ "url": "https://checkout.stripe.com/pay/..." }
```

Frontend should redirect to this URL. After payment, Stripe redirects to `APP_URL/billing?success=1`.

---

### `POST /api/billing/portal`

Creates a Stripe Billing Portal session (manage/cancel subscription).

**Auth:** `Authorization: Bearer <token>`

**Request:** empty body or `{}`

**Response:**
```json
{ "url": "https://billing.stripe.com/session/..." }
```

---

### `POST /api/stripe/webhook`

Receives Stripe events. Validates signature with `req.rawBody`.

**Auth:** Stripe-Signature header (HMAC validation)

**Handled events:**
- `customer.subscription.created` -> updates `user_subscriptions`
- `customer.subscription.updated` -> updates status, period, plan
- `customer.subscription.deleted` -> reverts to `free_trial`

**Response:** `{ "received": true }` or 4xx/5xx error

---

## Modified Endpoints

### `POST /api/generate` and `POST /api/edit-post`

Quota validation added before processing.

**New possible error:**
```
HTTP 402 Payment Required
{
  "error": "quota_exceeded",
  "message": "...",
  "used": 3,
  "limit": 3,
  "plan": "free_trial"
}
```
