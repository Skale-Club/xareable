# External Integrations

**Analysis Date:** 2026-04-06

## AI / ML Services

**Google Gemini (primary AI):**
- SDK: `@google/generative-ai` ^0.24.1 (also called via raw REST at `https://generativelanguage.googleapis.com/v1beta`)
- Text generation: `gemini-2.5-flash` model (configured via style catalog)
- Image generation: `gemini-3.1-flash-image-preview` (or catalog override)
- Video generation: `veo-3.1-generate-preview` — via `server/services/video-generation.service.ts`
- Auth: per-user `GEMINI_API_KEY` stored in `profiles.api_key` (Supabase), or platform key from `GEMINI_API_KEY` env var
- Services: `server/services/gemini.service.ts`, `server/services/image-generation.service.ts`, `server/services/video-generation.service.ts`
- Usage tracked in `usage_events` table; cost charged in micros

## Authentication

**Supabase Auth:**
- Provider: Supabase (email/password); SDK `@supabase/supabase-js` ^2.98.0
- Client singleton initialized from `/api/config` response: `client/src/lib/supabase.ts`
- Server-side user-scoped client: `createServerSupabase(token)` in `server/supabase.ts` (respects RLS)
- Server-side admin client: `createAdminSupabase()` in `server/supabase.ts` (bypasses RLS, service role)
- JWT passed as `Authorization: Bearer <token>` on all API requests
- Auth context (session, profile, brand): `client/src/lib/auth.tsx`
- Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

## Storage

**Supabase Storage:**
- Bucket: `user_assets`
- Paths: `{userId}/{postId}.webp` (images), `{userId}/thumbnails/{postId}.webp`, `{userId}/{postId}.mp4` (videos)
- Upload helper: `server/storage.ts` → `uploadFile()`
- Logo uploads: `{userId}/logo.*` path convention
- All storage operations use the admin Supabase client

## Database

**Supabase PostgreSQL:**
- Accessed via Supabase JS client (not direct pg connection for app queries)
- Direct `pg` + Drizzle ORM used for schema migrations only (`DATABASE_URL` env var)
- Tables: `profiles`, `brands`, `posts`, `post_versions`, `landing_content`, `generation_logs`, `usage_events`, `credits_ledger`
- RLS policies enforced on all user-facing tables
- Schema source: `shared/schema.ts`
- Migrations: `./migrations/` (drizzle-kit)

## Payments

**Stripe:**
- SDK: `stripe` ^20.4.0
- Server module: `server/stripe.ts`
- Routes: `server/routes/stripe.routes.ts`, `server/routes/billing.routes.ts`
- Features: subscription checkout, credit pack checkout, billing portal, overage billing batch
- Webhook endpoint: `POST /api/stripe/webhook` — verifies `stripe-signature` header
- Env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Credit pack options (micros): 10M, 25M, 50M, 100M, 250M

## Marketing & Analytics Integrations

**Google Analytics 4 (GA4):**
- Via Measurement Protocol (server-side): `https://www.google-analytics.com/mp/collect`
- Configured per-installation in `app_settings` Supabase table
- Config fields: `measurement_id`, `api_secret`
- Events: `CompleteRegistration`, `Lead`, `ViewContent`, `InitiateCheckout`, `Purchase`
- Implementation: `server/integrations/marketing.ts`

**Facebook Conversions API:**
- Server-side event tracking via Facebook's Conversions API
- User data hashed with SHA256 before transmission
- Supports event deduplication
- Events: `PageView`, `Lead`, `CompleteRegistration`, `Purchase`, `ViewContent`, `InitiateCheckout`, `Subscribe`
- Config fields: `pixel_id`, `access_token`, optional `test_event_code`
- Implementation: `server/integrations/facebook.ts`

**GoHighLevel (GHL) CRM:**
- REST API base: `https://services.leadconnectorhq.com` (API version `2021-07-28`)
- Features: contact sync (create/update), custom field mapping
- Config fields: `api_key`, `location_id`
- Retry logic: max 2 retries with 1s base delay
- Implementation: `server/integrations/ghl.ts`

**Telegram Notifications:**
- Bot API base: `https://api.telegram.org`
- Supports sending messages to multiple chat IDs
- Message limit: 4096 chars (auto-split on newlines)
- Config fields: `bot_token`, `chat_ids`
- Implementation: `server/integrations/telegram.ts`

## Observability & Analytics (Frontend)

**Vercel Analytics:**
- Package: `@vercel/analytics` ^1.6.1
- Bundled as separate `analytics-vendor` chunk in Vite build
- Passive page-view tracking

## Deployment Infrastructure

**Hetzner VPS (primary production):**
- PM2 process manager; config at `deploy/hetzner/ecosystem.config.cjs`
- App runs on port 5000, served via `npm start`
- Logs: `/var/log/xareable/app/`

**Vercel (alternative/CDN):**
- `.vercel/` directory present
- `APP_URL` env var set to `https://xareable.com`

## Webhooks

**Incoming:**
- `POST /api/stripe/webhook` — Stripe payment events (subscription updates, invoice paid, etc.)

**Outgoing:**
- GHL: contact sync on user registration/lead events
- Facebook CAPI: server-side purchase/lead events
- GA4: Measurement Protocol hits
- Telegram: notification messages to configured chat IDs

## Environment Variables Required

```
SUPABASE_URL                  # Supabase project URL
SUPABASE_ANON_KEY             # Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY     # Service role key (admin operations)
DATABASE_URL                  # Direct PostgreSQL URL (migrations only)
STRIPE_SECRET_KEY             # Stripe API key (sk_test_... or sk_live_...)
STRIPE_WEBHOOK_SECRET         # Stripe webhook signing secret
GEMINI_API_KEY                # Platform-level Gemini API key (fallback)
APP_URL                       # Public app URL
PORT                          # Server port (default 5000)
NODE_ENV                      # development | production
```

---

*Integration audit: 2026-04-06*
