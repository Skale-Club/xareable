# Billing - Environment Variables

## Required variables for billing

Add to local `.env` and deployment environment variables (Vercel, Railway, etc.):

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...          # sk_live_... in production
STRIPE_WEBHOOK_SECRET=whsec_...        # Generated in Stripe Dashboard or Stripe CLI

# App URL (used for post-checkout redirect)
APP_URL=https://your-domain.com        # No trailing slash. localhost:5000 in dev
```

## Existing variables (do not change)

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Where to find Stripe keys

| Key | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard -> Developers -> API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard -> Developers -> Webhooks -> your endpoint -> Signing secret |

## In production (Vercel)

```bash
vercel env add STRIPE_SECRET_KEY
vercel env add STRIPE_WEBHOOK_SECRET
vercel env add APP_URL
```

## Security

- **Never** commit `.env` to git (it is already in `.gitignore`)
- Use `sk_test_` keys in development and `sk_live_` only in production
- `STRIPE_WEBHOOK_SECRET` is unique per endpoint; generate a new one per environment
