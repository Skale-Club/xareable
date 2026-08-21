# Zernio Social Publishing — Integration Plan & Runbook

Integrated posting system: posts created inside Xareable publish directly to the
user's **Instagram** and **Facebook** accounts via the [Zernio](https://zernio.com)
unified social API. Xareable never touches Meta's Graph API directly.

> Source of truth for the Zernio API: the official OpenAPI spec bundled in
> `zernio-dev/zernio-python` (`openapi.yaml`, v1.0.4). Base URL
> `https://zernio.com/api` (endpoints under `/v1/...`), auth via
> `Authorization: Bearer <api_key>`.

## The business rule (locked)

Zernio bills **per connected social account**, so account ownership of the
Zernio relationship matters:

1. **BYOK mode (launch mode, required)** — each Xareable user registers **their
   own Zernio API key** in Settings. Their Instagram/Facebook connections live
   in *their* Zernio workspace and they pay Zernio directly. Xareable stores the
   key and calls Zernio on their behalf.
2. **Global mode (built now, enabled later)** — an admin can register **one
   platform-wide Zernio API key** (`platform_settings`) and flip
   `zernio_global_enabled`. Users without their own key then publish through the
   platform key. Inside the global workspace each Xareable user maps to a
   dedicated **Zernio Profile** (Zernio's container for social accounts) named
   `xareable-<userId>`, isolating each customer's connected accounts.

**Credential resolution hierarchy** (`resolveZernioCredentials(userId)`):

```
1. user_zernio_settings.api_key set        → { mode: 'byok', key, profileId: zernio_profile_id }
2. else platform_settings.zernio_global_enabled === true
   AND zernio_global_api_key set           → { mode: 'global', key: globalKey,
                                               profileId: ensureGlobalProfile(userId) }
3. else                                    → null (social publishing not available)
```

Every publication row records which `mode` produced it. Flipping global mode on
later requires **zero schema changes** — only the admin toggle.

## Zernio API surface used

| Purpose | Endpoint | Notes |
|---|---|---|
| Validate API key | `GET /v1/auth/verify` | Used by "save & test key" and admin global-key save |
| Profiles | `GET/POST /v1/profiles` | BYOK: reuse default profile or create `Xareable`. Global: one profile per user, idempotent create (name-unique, 409 carries `existingProfileId`) |
| Connect account | `GET /v1/connect/{platform}?profileId&redirect_url` | Returns `authUrl`; Zernio hosts the Meta OAuth + Facebook page selection UI, then redirects back to `redirect_url?connected={platform}&profileId&accountId&username` |
| List accounts | `GET /v1/accounts` | Synced into `social_accounts` cache |
| Disconnect | `DELETE /v1/accounts/{accountId}` | |
| Publish | `POST /v1/posts` | `content`, `mediaItems[{type,url}]` (public HTTPS URLs — our R2 CDN URLs work as-is), `platforms[{platform, accountId, platformSpecificData}]`, `publishNow` or `scheduledFor`, `metadata` (echoed back in webhooks — we set `{ source, xareable_post_id, xareable_user_id }`) |
| Post status | `GET /v1/posts/{postId}` | On-demand refresh of pending publications |
| Retry | `POST /v1/posts/{postId}/retry` | Surface as "retry" on failed publications |
| Webhooks | `POST /v1/webhooks/settings` | Auto-registered on key save. Events: `post.published`, `post.failed`, `post.partial`, `post.platform.published`, `post.platform.failed`. HMAC-SHA256 signature in `X-Zernio-Signature` |

Key platform facts baked into the publish service:

- **Instagram** (`InstagramPlatformData`): feed aspect ratio 0.8–1.91, carousel
  up to 10 items, Reels/Stories via `contentType`, `firstComment`,
  `isAiGenerated: true` — **we always set it** (Xareable media is AI-generated;
  Meta requires the self-disclosure label).
- **Facebook** (`FacebookPlatformData`): feed up to 10 images, Stories/Reels,
  page selection handled by Zernio's hosted connect UI.
- Idempotency: `x-request-id` UUID header per create call; Zernio also rejects
  identical content to the same account within 24 h with **409** — surfaced as a
  friendly "already published" error.
- Anti-abuse caps (Zernio side): Instagram/Facebook 100 posts/day/account,
  25 posts/hour/account. Rate limit headers `X-RateLimit-*`.
- Media: images > 8 MB auto-compressed by Zernio; no re-upload needed (public
  R2 URLs are passed directly).

## Data model (one additive migration)

`supabase/migrations/20260808000000_zernio_social_publishing.sql`

```sql
user_zernio_settings          -- one row per user
  user_id uuid PK → auth.users ON DELETE CASCADE
  api_key text                -- BYOK key (null in global mode). House pattern:
                              -- plaintext at rest like profiles.api_key/openrouter_api_key,
                              -- RLS-scoped to owner; never exposed by admin endpoints.
  zernio_profile_id text      -- Zernio profile used in BYOK mode
  global_zernio_profile_id text -- per-user profile inside the GLOBAL workspace
  webhook_secret text         -- random per-user secret for HMAC verification
  created_at / updated_at

social_accounts               -- cache of connected Zernio accounts
  id uuid PK default gen_random_uuid()
  user_id uuid → auth.users ON DELETE CASCADE
  zernio_account_id text      -- Zernio SocialAccount _id
  platform text               -- 'instagram' | 'facebook' | ...
  username / display_name / avatar_url text
  connection_mode text        -- 'byok' | 'global'
  is_active boolean default true
  connected_at / updated_at
  UNIQUE (user_id, zernio_account_id)

post_publications             -- one row per (post × platform target × attempt)
  id uuid PK default gen_random_uuid()
  user_id uuid → auth.users ON DELETE CASCADE
  post_id uuid → posts ON DELETE CASCADE
  social_account_id uuid → social_accounts ON DELETE SET NULL
  platform text
  mode text                   -- 'byok' | 'global' (audit: who paid for this publish)
  zernio_post_id text         -- Zernio post _id (shared across platform targets)
  status text default 'pending' -- pending|scheduled|published|failed
  platform_post_id / platform_post_url text
  error_message text
  scheduled_for / published_at timestamptz
  created_at / updated_at

platform_secure_settings      -- service-role-ONLY key/value store (NEW)
  setting_key text PK
  setting_value jsonb
  updated_at timestamptz
  -- RLS enabled with ZERO policies: platform_settings has a public-read
  -- policy (anon key reaches it via PostgREST), so platform SECRETS must
  -- not live there. Seeds: zernio_global_api_key, zernio_global_webhook_secret.
  -- Pre-existing audit item: gemini_api_key/openai_api_key still live in the
  -- public-readable platform_settings and should migrate here in a follow-up.

platform_settings seed (non-secret flag only):
  zernio_global_enabled 'false'
```

RLS: owners `SELECT` their rows (`auth.uid() = user_id`) on all three
user tables; ALL writes go through the service-role client — including
`user_zernio_settings`, deliberately: `global_zernio_profile_id` and
`webhook_secret` are server-managed security state, and a client-writable
`global_zernio_profile_id` would let a user point their account sync at
another tenant's Zernio profile in global mode. No column is ever dropped
(additive-only, house rule).

**Tenant isolation invariant (global mode)**: `resolveZernioCredentials`
provisions the per-user Zernio profile EAGERLY, so `zernioProfileId` is never
null in global mode; `listZernioAccounts` filters strictly by profile
(accounts without a resolvable profileId are excluded); the accounts route
refuses to sync when the profile is missing; and `publishPost` requires the
selected accounts' `connection_mode` to match the resolved credential mode.

## Server design

```
server/lib/zernio.ts                       -- thin REST client (fetch, 30s timeout,
                                              ZernioApiError{status,code,message},
                                              x-request-id on create)
server/services/zernio-credentials.service.ts
                                           -- resolveZernioCredentials(userId),
                                              ensureZernioProfile (BYOK + global),
                                              webhook auto-registration
server/services/social-publish.service.ts  -- buildZernioPostPayload(post, slides,
                                              accounts, opts) + publishPost() +
                                              refreshPublicationStatus() +
                                              runPublicationStatusSweep()
server/routes/social.routes.ts             -- user-facing API (requireAuth)
server/routes/admin-social.routes.ts       -- admin global-key management
```

### User-facing endpoints (`/api/social/*`, all `requireAuth` except webhook)

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/social/status` | `{ configured, mode, accounts_count }` |
| PUT | `/api/social/zernio-key` | Validate via `/v1/auth/verify` (400 on invalid), ensure BYOK profile, auto-register webhook, upsert row |
| DELETE | `/api/social/zernio-key` | Clear key (cache rows kept, marked inactive) |
| GET | `/api/social/accounts` | Live-sync from Zernio into `social_accounts`, return cache |
| POST | `/api/social/connect` | `{platform}` → Zernio connect URL (redirect back to `/settings?social_connected={platform}`) |
| DELETE | `/api/social/accounts/:id` | Disconnect on Zernio + deactivate cache row |
| POST | `/api/social/publish` | `{post_id, account_ids[], caption?, scheduled_for?, instagram_options?}` → one Zernio `POST /v1/posts` across all targets, insert `post_publications` rows |
| GET | `/api/social/publications?post_id=` | Rows + lazy refresh of stale pending ones |
| POST | `/api/social/publications/:id/retry` | Zernio retry for failed rows |
| POST | `/api/social/webhooks/zernio/:settingsKey` | Public. `:settingsKey` = `user_zernio_settings.user_id` or `global`; verify `X-Zernio-Signature` (HMAC-SHA256, `crypto.timingSafeEqual`), update matching `post_publications` by `zernio_post_id` + platform `accountId` |

Media mapping in `buildZernioPostPayload`:

- `content_type = 'image' | 'enhancement'` → single `mediaItems[{type:'image', url: post.image_url}]`
- `content_type = 'carousel'` → `post_slides` ordered → up to 10 `image` items (>10 → 400 with explicit message)
- `content_type = 'video'` → `mediaItems[{type:'video', url: post.image_url}]` (video posts store media in `image_url`)
- caption: request override → `posts.caption` → '' (Zernio allows empty content with media)
- Instagram target always gets `platformSpecificData: { isAiGenerated: true, ...user options }`

### Admin endpoints

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/admin/social/zernio` | `{ enabled, key_masked, verified }` (key never returned in full) |
| PATCH | `/api/admin/social/zernio` | Set/clear global key (verify first), toggle `zernio_global_enabled`, register global webhook |

### Cron (both trigger paths, house pattern)

`runPublicationStatusSweep()` — every 15 min, refresh `post_publications` stuck
in `pending`/`scheduled` via `GET /v1/posts/{id}`, grouped per user credential.
Registered in `startCronJobs()` **and** exposed as
`POST /api/internal/social/sync-publications` behind `requireCronSecret`.
Webhooks are the primary status path; the sweep is the safety net.

Row selection is deliberately **anchored on the time that matters**, not on
`created_at` (updated 2026-08-21 — the original `created_at > now-7d` filter
dropped a post scheduled 10 days out from the sweep *precisely when its publish
time arrived*, so a missed webhook left it `scheduled` forever). Two queries
are merged and deduped:

| Status | Selected when |
|---|---|
| `pending` | `created_at` within 7 days, `updated_at` older than 60s |
| `scheduled` | `scheduled_for` has arrived (5-min look-ahead) and is within 7 days, `updated_at` older than 60s |

Three further guards keep the sweep from degenerating:

- **Ordering** — merged rows are sorted `updated_at` ascending (least-recently-
  touched first), so no row starves behind ones that can never resolve.
- **Attempt cap** — `refresh_attempts` is bumped on *every* attempt, including
  ones skipped for missing credentials. At `MAX_REFRESH_ATTEMPTS` (20, ≈5h of
  trying) the row is failed with an explanatory message instead of being polled
  forever. Webhook-driven updates pass `countsAsRefreshAttempt: false` so push
  never consumes poll budget.
- **Mode check** — a row's recorded `mode` is compared against the user's
  currently-resolved credentials. After a BYOK↔global switch the old row belongs
  to a Zernio workspace the user is no longer connected to, so the call is
  skipped rather than pointlessly retried until the cap terminates it.

## Client design

- **Settings → new "Social" tab**: Zernio key input (save = validate), status
  badge, connected accounts list (avatar, platform icon, username, disconnect),
  "Connect Instagram" / "Connect Facebook" buttons (full-page redirect to
  `authUrl`), `?social_connected=` query param handling (sync + toast + URL cleanup).
  When global mode serves the user (no own key needed), the key input collapses
  into an informational card.
- **`client/src/components/social-publish-dialog.tsx`**: opened from the post
  viewer dialog and posts grid. Account multi-select (IG/FB), caption textarea
  pre-filled from `post.caption`, "Publish now" vs schedule (datetime-local),
  per-platform result list with links; carousel/video constraints messaged inline.
- **Post viewer**: "Publish" button opening the dialog; publication history
  (status badges, live-post links, retry) lives inside the dialog. Status
  chips on the posts *grid* cards are deferred (see "Deferred").
- **Admin page**: "Zernio (Global)" card — masked key input, enable toggle.
- **i18n**: every new string added to `client/src/lib/translations/pt.ts`
  (flat English-key → pt map, house pattern).

## Execution model

> **fable orchestrates · opus validates · sonnet executes**

| Phase | Owner | Scope (file ownership is disjoint) |
|---|---|---|
| P0 Plan | fable | This document |
| P1 Foundation | sonnet | Migration SQL, `shared/schema.ts` additions, `server/lib/zernio.ts`, `zernio-credentials.service.ts` |
| P2 Server | sonnet | `social-publish.service.ts`, `social.routes.ts`, `admin-social.routes.ts`, webhook, cron additions, route registration |
| P3 Client | sonnet | Settings Social tab, publish dialog, status chips, admin card, pt translations |
| P4 Validation | opus | Adversarial review (correctness, security, RLS, HMAC, error paths) + `npm run check` + `npm run build`; fable applies fixes |
| P5 Ship | fable | Apply migration to Supabase, commit, push |

## Security notes

- **User BYOK secrets are service-role only.** `user_zernio_settings` has RLS
  enabled with **zero policies** (`20260821000002_lockdown_user_zernio_settings.sql`).
  It previously carried an owner-`SELECT` policy, which let any authenticated
  session — or a stolen JWT, or XSS — read both `api_key` and, more seriously,
  `webhook_secret` in plaintext through the public anon key. That secret is the
  *only* thing authenticating inbound webhooks, so reading it was enough to
  **forge signed webhook events** and falsify publication statuses. No client
  code ever read this table (verified); every access goes through
  `createAdminSupabase()` in `zernio-credentials.service.ts`.
- **Encryption at rest.** `api_key` / `webhook_secret` are AES-256-GCM encrypted
  via `server/lib/secret-crypto.ts` at the persistence boundary —
  `getUserZernioSettingsRow` (the single read funnel) decrypts,
  `saveUserZernioKey` encrypts, so no other caller changes. Envelope format is
  `enc:v1:<iv>:<authTag>:<ciphertext>`; any non-envelope value passes through
  untouched, which is what keeps legacy plaintext rows working and lets the
  system degrade safely if the key is unset.
- The admin global key lives in `platform_secure_settings` (RLS enabled, zero
  policies — service-role only) and is **always masked** on read endpoints.
  Never `platform_settings`, which carries a public-read policy.
- Webhook endpoint is unauthenticated by nature → HMAC-SHA256 verification with
  per-user secrets (`crypto.timingSafeEqual`). Every failure path — unknown
  `settingsKey`, secret-lookup error, missing signature, HMAC mismatch —
  returns an **identical `401`**; the earlier 404-vs-401 split let an
  unauthenticated caller enumerate which user ids had Zernio configured.
  200-with-noop on events that don't match any publication (Zernio disables
  webhooks after 10 delivery failures — never fail on unknown events).
- Publish route validates post ownership (`posts.user_id = auth user`) before
  building any payload; account ids are validated against the caller's
  `social_accounts` rows, including a `connection_mode` match.
- **Webhook + OAuth URLs come from a canonical origin, not the `Host` header.**
  `getCanonicalOrigin(req)` prefers `config.APP_URL` and only falls back to the
  request-derived `getSiteOrigin(req)` (with a warning). The webhook URL is
  registered *together with its signing secret*, so a misconfigured proxy or an
  alternate hostname would otherwise hand both to the wrong origin.

### Env vars

| Var | Required? | Purpose |
|---|---|---|
| `APP_URL` | **Strongly recommended in prod** | Canonical origin for webhook registration + OAuth redirect. Unset ⇒ falls back to trusting the `Host` header. |
| `CREDENTIALS_ENCRYPTION_KEY` | Optional | 64 hex chars (`openssl rand -hex 32`). Enables encryption at rest for BYOK secrets. Unset ⇒ plaintext storage with a one-time warning. **Rotating it makes existing encrypted rows undecryptable.** |

## Deferred (documented, intentionally out of scope now)

- Scheduling via Zernio queues (`queuedFromProfile`) — we pass explicit
  `scheduledFor` only.
- Other Zernio platforms (LinkedIn, TikTok, X, …) — schema already
  platform-agnostic (`platform text`).
- Post analytics ingestion (`/v1/analytics/*`).
- Auto-publish on generation ("create & post" one-click) — trivial follow-up
  once this lands.
- Global-mode billing pass-through (charging users for platform-key usage).
- Publication status chips on the posts grid cards (status is visible in the
  publish dialog's history section today).
- Migrating the pre-existing `gemini_api_key`/`openai_api_key` rows out of the
  public-readable `platform_settings` into `platform_secure_settings`.
