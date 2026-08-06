# Supabase Storage → Cloudflare R2

Runbook for moving user assets off the Supabase `user_assets` bucket onto R2,
served from `cdn.xareable.com`.

**Why:** Supabase bills egress at ~$0.09/GB (250 GB included on Pro). R2 bills
none. At a few TB of monthly egress that is the difference between ~$160/mo and
$0/mo in transfer, plus the assets land on Cloudflare's edge instead of a single
Supabase region.

---

## How the code is wired

Everything goes through [`server/lib/r2.ts`](../server/lib/r2.ts). Two invariants
make this migration cheap and reversible:

1. **Object keys are unchanged.** `user_assets/{userId}/generated/{uuid}.png`
   becomes R2 key `{userId}/generated/{uuid}.png`. The bucket name was never part
   of the key, so the backfill is a straight copy and the DB update is a pure
   origin swap.

2. **Reads are dual-mode.** `parseAssetUrl()` recognises both the legacy Supabase
   public URL and the R2 origin. Rows that still carry an old URL keep resolving
   *and keep being deletable* while the backfill runs, and after a rollback.

If the `R2_*` env block is not fully set, the storage layer falls back to
Supabase Storage. Partial config counts as "off" on purpose — a half-set bucket
would write objects nobody can read back.

### Browser uploads changed shape

Supabase Storage let the browser upload directly because RLS scoped writes to
`{userId}/…` using the caller's JWT. **R2 has no RLS.** So the server became the
policy layer: [`POST /api/uploads/sign`](../server/routes/uploads.routes.ts)
takes an upload *kind* and returns a presigned PUT. The client never supplies a
path — that removes path traversal and cross-tenant writes by construction.

Size **and content type** are enforced cryptographically: `content-length`,
`content-type` and `cache-control` are all part of the SigV4 signature, so the
PUT must match the server's decision exactly or R2 rejects it. A signed URL
cannot be replayed to push a larger object, nor to change the stored MIME type.

That last part needs an explicit opt-in and is easy to get wrong: by default
`getSignedUrl` signs only `host` and `content-length`. Without
`signableHeaders: new Set(["content-type", "cache-control"])` in
`presignPut()`, a client could request a signature for `image/png` and then PUT
`text/html`, hosting arbitrary markup on the CDN origin. If you ever touch that
call, keep the set.

`/sign` picks the transport. With R2 configured it returns `mode: "presign"`
and the bytes go straight to Cloudflare. Without R2 it returns `mode: "proxy"`
and the client posts base64 to `/api/uploads/direct`, which writes through the
storage layer to the Supabase bucket. The proxy path costs container memory and
is slower, but it is what keeps browser uploads alive on a dev box with no R2
credentials — and on the rollback path. Without it, unsetting `R2_*` would
break logo, reference-photo and scenery uploads outright.

| Kind | Key | Cache | Who |
|---|---|---|---|
| `brand-logo` | `{userId}/logo.{ext}` | 5 min | any user |
| `brand-reference` | `{userId}/references/{uuid}.{ext}` | 1 yr immutable | any user |
| `scenery-preview` | `{userId}/sceneries/{sceneryId}-{ts}.{ext}` | 1 yr immutable | admin only |

Brand logos keep a **stable key overwritten in place** (same as before), so the
cache must stay short or a new logo would sit invisible behind the CDN for a
year. Everything else is content-addressed and cached immutably.

### Behaviour change: SVG

SVG is **not accepted** on the presigned upload path. Those bytes are never
inspected server-side, and an SVG served from our own CDN origin is a
stored-XSS / phishing vector. Admin SVG uploads still work through the landing
endpoints, which run the sanitiser in `server/lib/upload-validation.ts`.
Previously the browser could push an SVG logo straight into the bucket with no
validation at all.

---

## Step 1 — Cloudflare dashboard (manual)

1. **R2 → Create bucket**
   - Name: `xareable-assets`
   - Location: **EU** (the app container runs in Hetzner Germany, so writes stay
     regional)

2. **Bucket → Settings → Public access → Custom domain → Connect domain**
   - `cdn.xareable.com`
   - `xareable.com` must already be a zone on this Cloudflare account; the DNS
     record is created for you.
   - Do **not** use the `r2.dev` URL. Cloudflare rate-limits it and documents it
     as unsuitable for production.

3. **R2 → Manage API Tokens → Create API Token**
   - Permission: **Object Read & Write**
   - Scope it to the `xareable-assets` bucket only
   - Copy the Access Key ID and Secret Access Key — the secret is shown once

4. **Bucket → Settings → CORS policy**, so browsers can PUT to presigned URLs:

```json
[
  {
    "AllowedOrigins": ["https://xareable.com", "https://www.xareable.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "cache-control"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add `http://localhost:5000` and `http://localhost:5173` if you want presigned
uploads to work from a dev box.

## Step 2 — Credentials

Two ways in, and they follow the Phase 12.3 precedent set by the Gemini keys:
env wins, database fills in, resolved per field.

**Preferred — /admin, no deploy.** Sign in as admin, go to **Settings → Object
Storage (Cloudflare R2)**, paste the five values, save. It takes effect
immediately: the resolver cache is invalidated on write, so there is no restart
and no redeploy. Rotating a leaked key later is the same three clicks.

The card shows, per field, whether the live value came from `env` or
`database`. If a field you just typed still reports `env`, the host is
overriding it and your edit is not what production uses.

**Alternative — environment.** Set the block in Coolify and locally in `.env`
(see `.env.example`). Env always beats the database, which is what keeps local
dev and the migration script reproducible:

```
R2_ACCOUNT_ID=<Cloudflare account id>
R2_ACCESS_KEY_ID=<from step 1.3>
R2_SECRET_ACCESS_KEY=<from step 1.3>
R2_BUCKET=xareable-assets
R2_PUBLIC_BASE_URL=https://cdn.xareable.com
```

Either way, a **partial** configuration counts as off — storage silently stays
on Supabase rather than writing objects nobody can read back.

## Step 3 — Backfill

Nothing is written without `--execute`. Run the phases **in order** — COPY must
fully succeed before REWRITE, or the app will serve URLs for objects that do not
exist yet.

Size the job first. `--inspect` is read-only and needs no R2 credentials, so it
works before the bucket exists:

```bash
npm run migrate:r2 -- --inspect
```

As of the migration this reported **645 objects / 28 MB**, dominated by
thumbnails, with only 15 DB rows carrying a legacy URL. The bulk of the bucket
is unreferenced files left behind by deleted posts. At this size it is not worth
filtering — copy everything.

```bash
npm run migrate:r2
```

Dry run of both phases: reports object count, total size, and how many DB rows
would change. Then:

```bash
npm run migrate:r2 -- --copy --execute
```

Walks every prefix in the bucket and mirrors each object into R2 under the same
key. Idempotent — an object already in R2 at a matching size is skipped, so an
interrupted run just resumes. It refuses to report success if any object failed;
re-run the same command until it reports 0 failures.

```bash
npm run migrate:r2 -- --rewrite --execute
```

Swaps the origin on every asset URL across `posts`, `post_versions`,
`post_slides`, `post_slide_versions`, `brands`, `brand_reference_photos`,
`landing_content`, `app_settings`, and the scenery catalog JSON inside
`platform_settings`. Also idempotent — rows already pointing at R2 are not
matched.

```bash
npm run migrate:r2 -- --verify
```

Counts rows still holding a legacy URL. Should print zero.

## Step 4 — Cutover

Deploy with the `R2_*` vars set. New uploads land in R2 immediately; the
dual-mode reader keeps any not-yet-rewritten rows working.

Leave the Supabase bucket in place for a couple of weeks. Once `--verify`
reports zero and nothing has regressed, delete it — that is when the egress bill
actually stops.

## Rollback

Unset the `R2_*` vars and redeploy. Server-side uploads go back to Supabase
Storage, browser uploads switch to the proxy transport, and old Supabase URLs
still resolve — the bucket was never deleted.

The one asymmetry: rows already rewritten to `cdn.xareable.com` keep pointing at
R2. That is fine while the R2 bucket exists (it is public and served
independently of the app), but those specific assets cannot be *deleted* by
cleanup jobs while R2 is switched off — `deleteAssetsByUrl` logs and skips them.
So roll back on config, not by deleting the R2 bucket.

## Cost expectations

| | Storage | Egress |
|---|---|---|
| R2 | $0.015/GB-mo | $0 |
| Supabase | $0.021/GB-mo after 100 GB | $0.09/GB after 250 GB |

Class B (read) operations on R2 are $0.36/million with 10M/month free, which for
image serving is noise next to what egress used to cost. Free tier is 10 GB
storage, so at current scale the bill is $0.
