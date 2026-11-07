# Xareable

<!-- journal-protocol:v1 -->
## Journal (mandatory)

This app's history (what it does, how each part was built, decisions and releases) lives in its Notion Journal. It replaces the old GSD/PAUL planning flow; `.planning/` and `.paul/`, if present, are a read-only legacy archive.

- Journal hub: https://app.notion.com/p/411b7a68612181549d94de34285c8e2f
- Journal Entries data source: collection://8975533a-34ff-4439-a7e3-de89bdb2ed68
- Latest view: view://411b7a68-6121-8187-bee5-000c6b2dd08f
- Entry prefix: XAR
- Rules (they win on any conflict): https://app.notion.com/p/411b7a68612181b3ac36f4ce2b2c3850 (skill: `app-journal`)

**Start of session:** fetch the hub and read Identity and Current State; list the latest 20 entries with Notion query-data-sources in `view` mode on the Latest view above (`page_size` 20; view mode has no plan quota) and read only titles and summaries; use `rows` mode with a filter only to narrow down (it has a plan quota); if a read fails, say so and continue from the code, never guess journal content; open only the entries you need; never read the whole database. Cross-check with the code: the code is the fact.

**End of every task that changed code, behavior, infrastructure or a decision:**
1. Create ONE entry in the data source above (one per logical unit of work, not per commit): `Title` = `YYYY-MM-DD — <imperative summary>`, `date:Date:start` (YYYY-MM-DD, with `date:Date:is_datetime` = 0), `Type`, `Area` (JSON array of existing options), `Status`, `Summary` (max 280 characters), `Agent`, `Model`, `Repo / Branch`, `Commits / PR`, `Tests` (what ran, or "Not run"), and `Decision ID` / `Decision Status` when a choice was made.
2. Body headings: Context · What changed · How it was built · Decisions and why · Tests and evidence · Not done / risks · Next.
3. If the app changed, rewrite the affected part of the hub's Current State. Read back what you wrote; never report a write you did not see.
4. Notion unavailable: append the full entry to `docs/journal/PENDING-NOTION.md` and tell the owner.

Journal records are in English. No secrets.
<!-- /journal-protocol -->

AI-powered social media content creation SaaS platform.

## Commands

```bash
npm run dev        # Start development server (tsx server/index.ts)
npm run build      # Build for production (tsx script/build.ts)
npm run start      # Run production build
npm run check      # TypeScript type check (CI verify gate)
npm run db:push    # Push Drizzle schema changes
```

`npm run check` type-checks `api/`, `client/src/`, `shared/`, `server/`, **and**
`scripts/` + `script/`. Keep `scripts/**/*` in the tsconfig `include`: it was
absent until 2026-08-06, and the gap let a silent no-op ship in
`scripts/migrate-storage-to-r2.ts` (a sync helper compared `.backend` on a
pending Promise, so every row returned null and the migration reported
"Rewrote 0 rows" with exit code 0). The `verify-phase-*.ts` harnesses that
phases rely on to prove their work live there too.

## Architecture

- **Frontend**: React 18 + Vite + TailwindCSS v3 + shadcn/ui (Radix primitives)
- **Routing**: `wouter` (client-side)
- **State/Data**: TanStack Query v5
- **Backend**: Express 5 API server + `tsx` runner
- **Database/Auth**: Supabase (PostgreSQL with RLS, Auth)
- **Object storage**: Cloudflare R2 via `server/lib/r2.ts`, served from `cdn.xareable.com`.
  Falls back to the legacy Supabase bucket `user_assets` when the `R2_*` env block
  is unset. See [docs/r2-migration.md](docs/r2-migration.md).
- **AI**: Google Gemini REST API (text: `gemini-2.5-flash`, image: `gemini-3.1-flash-image-preview`)
- **Validation**: Zod schemas in `shared/schema.ts`
- **Scheduled jobs**: `node-cron` for long-running deploys + HTTP-trigger endpoints for serverless deploys (see "Deployment & Cron" below)

## Deployment & Cron

> **Current production: Coolify on Hetzner — `https://xareable.com`** (migrated off
> Vercel 2026-05-30; runbook: `../skaleclub-apps/apps/xareable.md`). The app runs as
> a long-running container (`Dockerfile` → `node dist/index.cjs` on port 8888, the
> `server/index.ts` entry), so **in-process `node-cron` is the live, sole cron
> trigger** — the GitHub Actions HTTP-trigger workflow is disabled
> (`.github/workflows/cron.yml.disabled`). `api/handler.ts` + `vercel.json` remain
> in the repo only as the rollback target during the post-cutover window. The
> dual-path design below still documents the codebase's capabilities.

The codebase has two production entry points and supports two cron-trigger paths simultaneously.

### Entry points

| Entry | When it runs | Cron behavior |
|---|---|---|
| `server/index.ts` | **Coolify/Hetzner container (current production)**; `npm run dev` (local); `npm run start` (any long-running Node host) | Long-running process; `httpServer.listen` callback calls `startCronJobs()` → `node-cron` self-schedules |
| `api/handler.ts` | **Vercel serverless** (former production, kept as rollback) | Per-request invocation; `server/index.ts` is NOT executed → `startCronJobs()` NEVER runs internally |

### Cron trigger paths

Five scheduled jobs (defined in `server/services/cleanup-cron.service.ts` + `server/stripe.ts`):

1. **Trash sweep** — every 6h, soft-delete posts past `expires_at` (sets `trashed_at`)
2. **Purge sweep** — every 6h offset, permanently delete posts in trash > `TRASH_RETENTION_DAYS`
3. **Overage billing batch** — weekly, Stripe-invoice accrued overage from `user_billing_profiles.pending_overage_micros`
4. **Social publication status sweep** — every 15 min, refresh `post_publications` stuck in pending/scheduled (safety net behind Zernio webhooks; see [docs/zernio-social-publishing.md](docs/zernio-social-publishing.md))
5. **Autopost (Autopilot) sweep** — every 5 min. Runs as **two concurrently-executing lanes with separate in-process locks**: a *fast lane* (materialize due slots → publish due approved items → janitor) and a *generation lane* (generate queued items). They are split because generation is a strictly-sequential, minutes-long AI call chain; under the old single lock a long generation batch blocked every subsequent tick, so an already-approved, already-due item could wait ~an hour to publish. See [docs/autopost-scheduling.md](docs/autopost-scheduling.md)

Every run of all five jobs is recorded to `cron_runs` (`server/services/cron-runs.service.ts`), readable via `GET /api/admin/cron/health`. Recording never throws and never alters a job's behavior. This exists because the social publishing system was once found running completely idle in production with no signal beyond a `console.log` nobody was tailing — a skipped lane or a wedged job now leaves a durable row instead of looking identical to "nothing to do".

Both paths invoke the SAME functions:

**Path A — HTTP triggers (Vercel today)**: `.github/workflows/cron.yml` schedule fires `curl -X POST` against five authenticated endpoints. Required because Vercel serverless functions don't host long-running processes.
- `POST /api/internal/cleanup/trash` → invokes `runTrashSweep()`
- `POST /api/internal/cleanup/purge` → invokes `runPurgeSweep()`
- `POST /api/internal/billing/run-overage-batch` → invokes `runOverageBillingBatch()`
- `POST /api/internal/social/sync-publications` → invokes `runPublicationStatusSweep()`
- `POST /api/internal/autopost/sweep` → invokes `runAutoPostSweep()`
- All require `Authorization: Bearer ${CRON_SECRET}` (validated via `crypto.timingSafeEqual` in `server/middleware/cron-auth.middleware.ts`)

**Path B — Internal `node-cron` (Hetzner future)**: `startCronJobs()` registers `cron.schedule(...)` for all five jobs at `httpServer.listen` time. Active when `npm run start` is the entry — i.e., on Hetzner / VPS / Railway / Render / any long-running host. The autopost sweep additionally self-guards with its own in-process lock (`autoPostSweepRunning` in `autopost.service.ts`), shared automatically by both trigger paths within one process.

When migrating Vercel → Hetzner: keep both paths active OR disable GitHub Actions workflow (rename `.github/workflows/cron.yml` → `.disabled`). Cross-process double-trigger is possible if both run; the in-process `overageBatchRunning` lock prevents same-process double-charge but NOT cross-host. Single-trigger per deploy is recommended.

See [docs/production-cron.md](docs/production-cron.md) for the full setup runbook (Vercel + Hetzner).

### Required env vars (cron-related)

```
CRON_SECRET            - 32+ char random string (openssl rand -hex 32). Required for HTTP triggers.
                         Vercel project env (Production scope) + GitHub repo Actions secret (same value).
```

GitHub repo secrets:
```
PROD_BASE_URL          - https://your-deployed-domain.com
CRON_SECRET            - same value as Vercel CRON_SECRET
```

## Project Structure

```
client/src/
  lib/
    supabase.ts            - Supabase client singleton (fetches config from /api/config)
    auth.tsx               - Auth context (session, profile, brand state)
    queryClient.ts         - TanStack Query client with auth headers
  pages/
    auth.tsx               - Login/Register (Supabase Auth)
    settings.tsx           - User settings
    onboarding.tsx         - Brand setup wizard
    posts.tsx              - Post history grid
    trash.tsx              - Soft-deleted posts with restore + force-delete (Phase 11)
    autopilot.tsx           - Autopilot tracks, approval queue, and history (auto-post scheduling)
  components/
    app-sidebar.tsx        - Navigation sidebar
    post-creator-dialog.tsx - Unified creator (image, video, carousel, enhancement)
    post-viewer-dialog.tsx  - Post viewer with carousel slide nav
    social-publish-dialog.tsx - Publish a post to Instagram/Facebook via Zernio
    zernio-global-card.tsx  - Admin card for the platform-wide Zernio key
    error-boundary.tsx     - App-root render-error recovery UI (Phase 13)

server/
  index.ts               - Long-running entry (npm run dev, npm run start on Hetzner) — calls startCronJobs()
  routes/                - Modular Express route files (one per domain)
  middleware/
    auth.middleware.ts   - JWT/Supabase auth (authenticateUser, requireAuth, requireAdminGuard)
    admin.middleware.ts  - Admin-only middleware
    cron-auth.middleware.ts - requireCronSecret for HTTP cron triggers (Phase 14)
    rate-limit.middleware.ts - aiRateLimit factory for paid AI endpoints (Phase 13)
  lib/
    secret-crypto.ts       - AES-256-GCM encrypt/decrypt for secret DB columns (envelope: enc:v1:...)
  services/
    cron-runs.service.ts     - recordCronRun/runAndRecord/purgeOldCronRuns — cron_runs observability
    cleanup-cron.service.ts  - runTrashSweep, runPurgeSweep, startCronJobs (Phase 11+12)
    zernio-credentials.service.ts - Zernio credential hierarchy (user BYOK key → global platform key)
    social-publish.service.ts     - Zernio publish payloads, status refresh, webhook apply, 15-min sweep
    autopost.service.ts           - computeNextSlotAt, runAutoPostSweep (5-min sweep), publishAutoPostItem
    autopost-generation.service.ts - generateAutoPost — /api/generate's happy path, composed for unattended cron use
    + carousel-generation, enhancement, gemini, image-generation, image-optimization,
      caption-quality, text-rendering, etc.
  supabase.ts            - createServerSupabase + createAdminSupabase factories
  stripe.ts              - Stripe checkout, subscriptions, runOverageBillingBatch
  config/index.ts        - Zod-validated env (incl. CRON_SECRET)

api/
  handler.ts             - Vercel serverless entry (does NOT call startCronJobs)

shared/
  schema.ts              - Zod schemas + TypeScript types (single source of truth)

scripts/
  verify-cron-jobs.ts    - Runtime cron verification harness (Phase 15)
  verify-phase-{N}.ts    - Per-phase static verification scripts

.github/
  workflows/
    cron.yml             - Production cron triggers (Vercel deploy) — Phase 14

deploy/
  hetzner/               - Optional VPS deployment scripts (PM2, nginx) for future migration
```

## Environment Variables

```
SUPABASE_URL              - Supabase project URL
SUPABASE_ANON_KEY         - Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY - Service role key (admin operations only)
GEMINI_API_KEY            - Centralized platform Gemini API key (server-side)
STRIPE_SECRET_KEY         - Stripe API key (sk_test_* for test, sk_live_* for production)
STRIPE_WEBHOOK_SECRET     - Stripe webhook signing secret
CRON_SECRET               - 32+ char random string for HTTP cron auth (Phase 14). openssl rand -hex 32.
R2_ACCOUNT_ID             - Cloudflare account ID
R2_ACCESS_KEY_ID          - R2 API token access key (Object Read & Write)
R2_SECRET_ACCESS_KEY      - R2 API token secret
R2_BUCKET                 - Bucket name (xareable-assets)
R2_PUBLIC_BASE_URL        - Public origin, no trailing slash (https://cdn.xareable.com)
APP_URL                   - Canonical public origin. SECURITY-LOAD-BEARING: getCanonicalOrigin()
                            builds the Zernio webhook registration URL (registered together with
                            its HMAC signing secret) and the OAuth redirect from it. Unset, both
                            fall back to trusting the request's Host header.
CREDENTIALS_ENCRYPTION_KEY - Optional. 64 hex chars (openssl rand -hex 32). Enables AES-256-GCM
                            encryption at rest for user_zernio_settings.api_key / .webhook_secret
                            via server/lib/secret-crypto.ts. Unset = plaintext storage (warns once).
                            ROTATING IT MAKES EXISTING ENCRYPTED ROWS UNDECRYPTABLE.
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Returns Supabase URL + anon key to client |
| POST | `/api/generate` | Generate social media post (Gemini text + image) |
| POST | `/api/edit-post` | Edit existing post image (creates new version) |
| POST | `/api/transcribe` | Transcribe audio via Gemini (voice input) |
| GET | `/api/landing/content` | Get landing page copy |
| GET | `/api/admin/stats` | Admin: platform stats |
| GET | `/api/admin/users` | Admin: list all users |
| PATCH | `/api/admin/users/:id/admin` | Admin: toggle user admin status |
| PATCH | `/api/admin/landing/content` | Admin: update landing page copy |
| GET | `/api/autopost/tracks` | Autopilot: list own tracks |
| POST | `/api/autopost/tracks` | Autopilot: create a track |
| PATCH | `/api/autopost/tracks/:id` | Autopilot: update a track |
| DELETE | `/api/autopost/tracks/:id` | Autopilot: delete a track (cascades its items) |
| GET | `/api/autopost/items` | Autopilot: list own items (filter by `status`) |
| POST | `/api/autopost/items/:id/approve` | Autopilot: approve a generated item (publishes inline if already due) |
| POST | `/api/autopost/items/:id/reject` | Autopilot: reject a generated item |
| POST | `/api/autopost/items/:id/retry` | Autopilot: retry a failed item |
| GET | `/api/admin/cron/health` | Admin: latest run per scheduled job + staleness flag (includes never-run jobs) |
| GET | `/api/admin/cron/runs` | Admin: recent scheduled-job runs (filter by `job`, `limit`) |

## Database Tables (Supabase)

- `profiles` — auto-created on signup via trigger; stores `api_key`, `is_admin`
- `brands` — company info, colors (1-4), mood, logo_url; one per user
- `posts` — generated content; image_url, caption, ai_prompt_used, status
- `post_versions` — edit history; version_number, image_url, edit_prompt
- `landing_content` — editable landing page copy (single row)
- `user_zernio_settings` — per-user Zernio BYOK key, Zernio profile ids, webhook secret
- `social_accounts` — cache of Zernio-connected Instagram/Facebook accounts
- `post_publications` — one row per post × platform target publish attempt (status, URLs, mode byok/global)
- `auto_post_tracks` — user-configured Autopilot track (theme prompt, cadence, approval mode, target accounts). `posting_times` + `weekly_day` are **LOCAL wall-clock values in the row's `timezone`** (IANA id), not UTC — see the DST note below
- `auto_post_items` — one row per scheduled Autopilot publish slot (generate → approve → publish state machine)
- `cron_runs` — one row per scheduled-job run (job, trigger, status, duration, result/error). RLS enabled with zero policies (service-role only)

**Timezone / DST**: Autopilot schedules are stored as local wall-clock times plus
an IANA `timezone`, and `computeNextSlotAt` resolves each occurrence in that zone
(handling spring-forward gaps and fall-back ambiguity). Do **not** reintroduce
client-side local↔UTC conversion: storing a single converted UTC time is only
correct until the next DST transition, which is exactly the one-hour drift bug
fixed on 2026-08-21. `scripts/test-autopost-timezone.ts` guards this.

**Secret-bearing tables have RLS enabled with ZERO policies** (service-role only):
`platform_secure_settings`, `user_zernio_settings`, `cron_runs`. Never add an
owner-`SELECT` policy to them — `user_zernio_settings` had one, and it exposed the
BYOK key *and* the webhook signing secret (enough to forge signed webhooks) to any
authenticated session through the public anon key.

**Social publishing (Zernio)**: posts publish to Instagram/Facebook through the
Zernio unified API — see [docs/zernio-social-publishing.md](docs/zernio-social-publishing.md)
for the credential hierarchy (per-user BYOK key first, admin-enabled global
platform key as fallback), endpoint map, webhook flow, and cron sweep.

**Autopilot (auto-post scheduling)**: users configure tracks that generate and
(optionally, per `approval_mode`) auto-publish posts on a cadence, via the
same generation pipeline `/api/generate` uses and the same Zernio publish path
above — see [docs/autopost-scheduling.md](docs/autopost-scheduling.md) for the
data model, state machine, cadence/timezone semantics, and cron sweep design.

Run `supabase-setup.sql` in Supabase SQL Editor to initialize tables + RLS policies.

## Auth Flow

1. User signs up/in → Supabase Auth (email/password)
2. Profile auto-created via DB trigger
3. No API key → redirect to `/settings`
4. No brand → redirect to `/onboarding`
5. Main app with sidebar navigation

## AI Generation Pipeline

**POST /api/generate:**
1. Verify JWT, fetch user's Gemini API key + brand from Supabase
2. Phase 1: Gemini text model (`gemini-2.5-flash`) → generates `headline`, `subtext`, `image_prompt`, `caption` as JSON
3. Phase 2: Gemini image model (`gemini-3.1-flash-image-preview`) → generates PNG from image_prompt
4. Upload image to R2 (key `{userId}/generated/{uuid}.png` — unchanged by the migration)
5. Insert post record, return public URL + content to frontend

**POST /api/edit-post:**
1. Fetch latest version image (or original)
2. Send image + edit prompt to Gemini image model
3. Upload new image, insert `post_versions` record with incremented version_number

## Key Patterns

- All auth tokens passed via `Authorization: Bearer <token>` header
- `createServerSupabase(token)` — user-scoped client (respects RLS)
- `createAdminSupabase()` — service role client (bypasses RLS, admin only)
- `requireAdmin()` helper checks `profiles.is_admin` before admin endpoints
- Zod `safeParse` used on all request bodies before processing
- Path aliases: `@` → `client/src/`, `@shared` → `shared/`
