# Billing - Quota System

## `checkQuota` Logic (`server/quota.ts`)

1. Fetch `user_subscriptions` JOIN `subscription_plans` for the user
2. If not found -> assume `free_trial` with limit 3
3. If `monthly_limit = NULL` -> `allowed: true` (unlimited plan)
4. Determine `periodStart`:
   - If `current_period_start` exists -> use Stripe billing period
   - If not (free trial) -> count all-time events
5. Count `usage_events` since `periodStart`
6. Return `{ allowed: used < limit, used, limit, plan }`

## Where quota is checked

| Endpoint | Check position |
|---|---|
| `POST /api/generate` | After validating JWT, API key, and brand |
| `POST /api/edit-post` | After validating JWT, post ownership, API key, and brand |

## Response when quota is exceeded

```json
HTTP 402 Payment Required
{
  "error": "quota_exceeded",
  "message": "You reached your plan generation limit. Upgrade to continue.",
  "used": 3,
  "limit": 3,
  "plan": "free_trial"
}
```

Frontend should handle status 402 and show a toast/dialog that routes to `/billing`.

## Event logging (`recordUsageEvent`)

Called **after** a successful operation:
- `POST /api/generate` -> right before `return res.json(...)`
- `POST /api/edit-post` -> right before `return res.json(...)`

Parameters: `userId`, `postId | null`, `'generate' | 'edit'`

## Future extensibility

- Add `credits` column to `usage_events` for weighted operations
- Add `usage_overage` table for extra billing control
- Add 80% / 100% usage alert emails (Resend/SendGrid)
