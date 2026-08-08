# Autopilot — Auto-Post Scheduling System

Users create **tracks** ("trilhas") of automatic post creation. A cron sweep
generates posts for due slots ahead of time (with a lead window so
manual-mode owners can review before anything goes live) and publishes
approved items at their slot time via the existing Zernio `publishPost` path
(see [docs/zernio-social-publishing.md](zernio-social-publishing.md)).

## Concept

Each **track** (`auto_post_tracks`) has:

- a **system prompt** — the creative-direction theme fed into the same
  generation pipeline `/api/generate` uses (e.g. "posts de promoção", "posts
  de avisos");
- a **cadence**: `daily` (N posts/day at chosen UTC times) or `weekly` (a
  chosen UTC weekday + times);
- an **approval mode**: `auto` (generated posts publish unattended) or
  `manual` (the owner must approve each generated post before it publishes);
- **target social accounts** — a set of the user's existing `social_accounts`
  rows (Zernio integration) to publish to;
- `is_active` / `paused_reason` / `consecutive_failures` — health state the
  sweep manages (see "Failure handling" below).

Each **item** (`auto_post_items`) is one materialized publish slot for a
track, carrying it through generation, (optional) approval, and publishing.

## Data model

`supabase/migrations/20260808120000_auto_post_scheduling.sql` (additive only):

```sql
auto_post_tracks
  id uuid PK
  user_id uuid → auth.users ON DELETE CASCADE
  name text
  system_prompt text
  cadence text                -- 'daily' | 'weekly'
  posting_times jsonb         -- 1..4 "HH:MM" strings, UTC
  weekly_day smallint         -- 0=Sun..6=Sat (UTC), required when cadence='weekly'
  approval_mode text          -- 'auto' | 'manual', default 'manual'
  account_ids jsonb           -- uuid[] of social_accounts (ownership verified server-side, not FK'd)
  generation_params jsonb     -- {aspect_ratio?, use_text?, use_logo?, content_language?, post_mood?}
  is_active boolean default true
  paused_reason text
  consecutive_failures int default 0
  next_slot_at timestamptz    -- next PUBLISH slot, UTC, server-computed (computeNextSlotAt)
  last_generated_at timestamptz
  created_at / updated_at

auto_post_items
  id uuid PK
  track_id uuid → auto_post_tracks ON DELETE CASCADE
  user_id uuid → auth.users ON DELETE CASCADE
  post_id uuid → posts ON DELETE SET NULL   -- generated post stays in the library regardless
  status text                 -- see "State machine" below
  scheduled_for timestamptz   -- the publish slot
  error_message text
  approved_at / rejected_at / published_at timestamptz
  created_at / updated_at
  UNIQUE (track_id, scheduled_for)   -- slot idempotency guard, cross-process safe
```

Indexes: `auto_post_items(user_id, status)`, `auto_post_items(status,
scheduled_for)`, `auto_post_tracks(is_active, next_slot_at)`.

RLS: both tables enable RLS with an **owner SELECT-only** policy
(`auth.uid() = user_id`). There are no insert/update/delete policies — every
write goes through the service-role client, in validated routes
(`server/routes/autopost.routes.ts`) or the sweep
(`server/services/autopost.service.ts`). This mirrors the Zernio social
publishing schema exactly: `next_slot_at`, `consecutive_failures`, and
`paused_reason` are server-managed scheduling/health state that a
client-writable policy would let a user tamper with (jump their own queue,
mask an auto-pause, fake a status transition to skip generation/approval).

## State machine

```
queued → generating → awaiting_approval → approved → publishing → published
              ↘ failed (retry → queued)       ↘ (reject) → rejected      ↘ failed
awaiting_approval → rejected
```

- `auto`-mode tracks skip approval: a successful generation lands the item
  directly on `approved` (`approved_at` stays `null` — it is only set when a
  human actually clicks Approve).
- Reject is allowed from `awaiting_approval` **and** `approved` (any time
  before it actually starts publishing).
- The generated `posts` row is never deleted when an item is rejected, fails,
  or its track/item row is later deleted — it stays in the user's library
  either way (`post_id` is `ON DELETE SET NULL`, not `CASCADE`).

## Cadence & timezone semantics

`posting_times` and `weekly_day` are stored in **UTC**. `computeNextSlotAt(track,
after)` (`server/services/autopost.service.ts`, pure, unit-testable) returns
the earliest occurrence **strictly after** `after`:

- **daily**: the earliest `posting_times` entry later today (UTC), else the
  earliest entry tomorrow.
- **weekly**: the earliest `posting_times` entry on this UTC week's occurrence
  of `weekly_day`, else the earliest entry a full week later.

Invalid configuration (no parseable `posting_times`, or a `weekly` track
missing/with an out-of-range `weekly_day`) returns `null` — the track is then
effectively idle (the sweep never materializes a slot for a `null`
`next_slot_at`) until it's fixed via `PATCH`.

The client is responsible for local ⇄ UTC conversion in the track form,
including the weekday shift that happens when a local time crosses midnight
in UTC — see the client page's own local helpers.

## Sweep design

`runAutoPostSweep()` (`server/services/autopost.service.ts`), scheduled every
5 minutes (`SWEEP_CRON = "*/5 * * * *"`), runs four phases, each independently
error-isolated so one user's failure never aborts the sweep for anyone else.
**Invocation order is materialize → publish → generate → janitor** — publish
runs BEFORE generate (materialize still runs first; see phase 3 below for why):

1. **Materialize due slots** — active tracks with `next_slot_at` within the
   widest possible lead (12h, the manual-mode lead) are fetched
   (`TRACK_BATCH_LIMIT = 10` per tick, oldest slot first). For each track,
   `next_slot_at` is first **fast-forwarded** through any slots older than
   `MATERIALIZE_GRACE_MS` (1h) via `computeNextSlotAt`, WITHOUT materializing
   an item for each skipped slot (bounded to `MAX_MATERIALIZE_FASTFORWARD_ITERATIONS`
   = 100 iterations, then bails and reports via `captureException`) — this is
   what makes downtime catch-up bounded: after an outage, a track posts at
   most once (its next slot inside the grace window), not once per missed
   slot. The (possibly fast-forwarded) slot is then re-checked against the
   track's OWN lead (`auto` mode = 0, `manual` mode = 12h); only when it's due
   is an `auto_post_items` row inserted. A duplicate insert (Postgres `23505`
   on the `(track_id, scheduled_for)` unique constraint) is skipped silently —
   another process already materialized that exact slot. Every write to a
   track's `next_slot_at` in this phase is a compare-and-set guarded on the
   value read at the top of that loop iteration, so a concurrent `PATCH` (the
   owner editing `posting_times` mid-sweep) always wins over the sweep's own
   advance. `next_slot_at` is advanced **before** generation ever runs, so a
   crash between materializing and generating never re-materializes the same
   slot.
2. **Publish due approved items** — `publishAutoPostItem(itemId)` (exported,
   also used by the manual `approve` route for immediate-slot approvals)
   claims `approved → publishing`, **re-reads the track and its `account_ids`
   fresh** (never trusts anything cached from generation time), fails the item
   outright if the track has since been deactivated, resolves Zernio
   credentials, and calls the existing `publishPost()`. The sweep calls this
   for every `approved` item whose `scheduled_for` has passed
   (`PUBLISH_BATCH_LIMIT = 20` per tick). This phase runs **before** generate:
   generation is a minutes-long, strictly-sequential AI call chain, and an
   already-`approved` item publishing behind a full batch of those would push
   publish latency well past the 5-minute tick interval. Everything from the
   `publishing` claim onward runs inside one try/catch, so ANY unexpected
   throw in this phase (not just a `publishPost` failure) still fails the item
   instead of leaving it stuck in `publishing` forever.
3. **Generate queued items** — up to `TRACK_BATCH_LIMIT` `queued` items are
   claimed one at a time via an optimistic guarded update
   (`status='generating' where status='queued'`; 0 rows updated = another
   process already claimed it, skip) and generated **sequentially** — these
   are minutes-long AI call chains, deliberately not parallelized. Two guards
   run before the paid generation pipeline: a deactivated track fails the item
   immediately instead of generating for it, and an item that already has a
   `post_id` (from an earlier attempt — most commonly a retry after a publish
   failure) skips regeneration entirely and moves straight to the
   post-generation status, since re-running generation would both burn a
   second paid generation and collide with the posts insert's
   idempotency_key. Otherwise, success moves the item to `approved` (auto
   mode) or `awaiting_approval` (manual mode) and resets the track's
   `consecutive_failures`; the guarded success update is itself checked (0
   rows = a concurrent process's janitor beat it to `failed`), in which case
   `post_id` is still persisted unconditionally so the item stays retryable
   instead of orphaning a paid generation. Failure marks the item `failed`
   with the error message and increments `consecutive_failures`; see "Failure
   handling" below.
4. **Janitor** — any item stuck in `generating` OR `publishing` for more than
   `GENERATING_STALE_MS` (30 min) — a crashed process, an uncaught rejection —
   is marked `failed` with a "timed out" message so it can be retried.

## Generation pipeline

`generateAutoPost()` (`server/services/autopost-generation.service.ts`)
composes the exact same building blocks `POST /api/generate`'s happy path
uses (key gate → credits → text plan → visual-critic re-roll loop →
crop/typography/logo/optimize/upload → caption quality → `posts` insert →
usage/deduct) — it is not a copy of the route, it is the route's pipeline
re-composed for a context with no HTTP request, no SSE stream, and no
interactive user to fall back in front of.

**Deliberate divergence**: `/api/generate` falls back to a local template
when the text-planning call fails, so an interactive user still gets
*something*. Autopilot generation has no one reviewing the output in real
time, so a text-generation failure here **throws** instead — the item is
marked `failed` rather than ever publishing (or queuing for approval) templated
filler copy.

Billing follows the same invariant as the interactive route: `checkCredits()`
gates the attempt before any paid call runs, and `recordUsageEvent()` /
`deductCredits()` run **only** after the `posts` row is successfully
inserted — a failed generation is never charged.

## Both cron trigger paths

Same dual-path design as every other scheduled job in this codebase (see
CLAUDE.md "Deployment & Cron"):

- **node-cron** (`startCronJobs()` in `server/services/cleanup-cron.service.ts`)
  — active whenever `server/index.ts` runs as a long-running process
  (Coolify/Hetzner production, `npm run dev`, `npm run start`).
- **HTTP trigger** — `POST /api/internal/autopost/sweep`
  (`server/routes/internal-cron.routes.ts`), guarded by `requireCronSecret`,
  for serverless hosts that can't run `node-cron` (the historical Vercel
  path, kept as rollback target).

Both call `runAutoPostSweep()` directly, so there is no logic divergence
between paths. `runAutoPostSweep()` owns its own in-process
`autoPostSweepRunning` lock (mirrors `overageBatchRunning` in
`cleanup-cron.service.ts`) so overlapping ticks within one process are
skipped outright; **cross-process** double-firing (both trigger paths active
simultaneously) is handled at the DB layer instead — the
`(track_id, scheduled_for)` unique constraint and every optimistic guarded
status update mean a losing race just produces a skipped claim, never a
duplicate post, charge, or publish.

## Failure handling & auto-pause

- A generation failure fails the item (`error_message` set) and increments
  the track's `consecutive_failures`.
- At `MAX_CONSECUTIVE_FAILURES` (3) consecutive failures, the track
  auto-pauses: `is_active = false`, `paused_reason` set to a message
  including the last error. The owner sees this in the Autopilot page and can
  fix the underlying issue (credits, brand config, social connection) and
  reactivate.
- Reactivating a track (`PATCH .../tracks/:id { is_active: true }` on a
  currently-paused track) clears `paused_reason` and resets
  `consecutive_failures` to 0, and recomputes `next_slot_at` from now — a
  reactivated track never tries to "catch up" on slots it missed while
  paused.
- A publish failure (missing accounts, no Zernio credentials, a Zernio API
  error) fails the item with a clear, actionable message but does **not**
  affect the track's `consecutive_failures` counter — that counter tracks
  *generation* health specifically, since a publish failure is more often an
  account/credential issue than a track-configuration issue.
- A track being **inactive** — whether the owner turned it off or it just
  auto-paused — is re-checked at BOTH the generate and publish phases (not
  just at materialize), since an item can sit `queued` or `approved` across
  the moment a track deactivates. Either phase fails the item outright
  ("Track is paused — reactivate it to generate/publish this slot") instead
  of spending a paid generation call or publishing on a paused track.
- Failed items can be retried from the UI (`POST .../items/:id/retry`), which
  clears `error_message`. If the item never produced a post (`post_id` is
  still null), it returns to `queued` for the next sweep tick to generate. If
  it already has a `post_id` (the most common case: it failed at publish, not
  generation), retry skips regeneration entirely and moves it straight to
  `approved` — clicking Retry on an already-generated post is itself the
  explicit decision to (re-)publish it, so this applies regardless of the
  track's `approval_mode`.
- Creating or updating a track with `approval_mode: 'auto'` and zero
  `account_ids` (the EFFECTIVE, merged config on `PATCH`) is rejected with a
  400 — an auto track with nothing to publish to would otherwise generate
  (and charge for) a post every slot forever without ever tripping
  `MAX_CONSECUTIVE_FAILURES`, since generation itself would keep succeeding.

## API surface

All under `/api/autopost/*`, all `authenticateUser`-gated. See
`server/routes/autopost.routes.ts` for the full validation contract
(Zod schemas in `shared/schema.ts`). Every `:id` route param is checked
against a UUID shape before it ever reaches a query — a malformed id 404s
with the same "not found" envelope the route already uses, instead of
surfacing as an unhandled 500 from Postgres's uuid-cast validation.
`generation_params.post_mood`, when present on create/`PATCH`, is validated
against the live style catalog's `post_moods` ids (`getStyleCatalogPayload()`)
— an id that doesn't match any current mood is rejected with a 400, since it
would otherwise silently drop that mood's art direction in generation.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/autopost/tracks` | List the caller's own tracks |
| POST | `/api/autopost/tracks` | Create a track; server computes `next_slot_at`; `account_ids` verified to belong to the caller and be active |
| PATCH | `/api/autopost/tracks/:id` | Partial update; recomputes `next_slot_at` when the schedule changes or the track is reactivated; reactivating clears `paused_reason`/`consecutive_failures` |
| DELETE | `/api/autopost/tracks/:id` | Deletes the track (cascades its items); generated posts remain in the library |
| GET | `/api/autopost/items?status=&limit=` | Own items, newest first, with an embedded post preview and track name |
| POST | `/api/autopost/items/:id/approve` | `awaiting_approval → approved`; publishes inline if the slot's time has already arrived |
| POST | `/api/autopost/items/:id/reject` | `awaiting_approval\|approved → rejected` |
| POST | `/api/autopost/items/:id/retry` | `failed → queued` (no `post_id` yet) or `failed → approved` (already has a `post_id` — skip regeneration), clears `error_message` |
| POST | `/api/internal/autopost/sweep` | Internal, `requireCronSecret` — the HTTP trigger path for `runAutoPostSweep()` |

## Deferred (documented, intentionally out of scope for v1)

- Video/carousel/enhancement autopilot tracks — v1 is image-only.
- Per-item manual edits before approval (approve/reject only; editing would
  reuse the existing post-edit pipeline as a follow-up).
- A dedicated "catch up on missed slots while paused" mode — reactivating
  always resumes from *now* forward.
- Track-level notification preferences (email/push when an item needs
  approval) — the approval queue is pull-only in v1.
