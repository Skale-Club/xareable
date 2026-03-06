# Billing - Stripe Webhooks

## Endpoint

```
POST /api/stripe/webhook
```

## Signature Validation

`server/index.ts` already captures `req.rawBody` for all requests. The webhook uses this buffer to validate the Stripe HMAC signature:

```typescript
stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
```

**Important:** never use `req.body` (already parsed JSON) for validation. Signature validation is performed on the raw body.

## Events and Actions

| Stripe Event | Database Action |
|---|---|
| `customer.subscription.created` | Updates `user_subscriptions`: `plan_id`, `stripe_subscription_id`, `status`, `current_period_start/end` |
| `customer.subscription.updated` | Same update path (captures plan changes, renewals, scheduled cancellations) |
| `customer.subscription.deleted` | Reverts `user_subscriptions` to `free_trial`: `plan_id = free_trial_id`, `stripe_subscription_id = null`, `status = 'trialing'`, periods = null |

## Matching Customer -> User

Stripe Customer is created in `getOrCreateStripeCustomer()` with `userId` in metadata. Webhook lookup uses `stripe_customer_id` directly in `user_subscriptions`.

## Idempotency

Stripe can resend events. UPDATE operations are idempotent (overwrite with same values), so reprocessing is safe.

## Local testing

```bash
stripe listen --forward-to localhost:5000/api/stripe/webhook
# In another terminal, simulate event:
stripe trigger customer.subscription.created
```

## Logs

All unhandled events are silently ignored (`default: break`). For debugging, add `console.log("Unhandled event:", event.type)` in the switch.
