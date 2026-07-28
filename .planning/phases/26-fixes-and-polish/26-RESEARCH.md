# Phase 26: Fixes & Polish - Research

**Researched:** 2026-07-28
**Domain:** Image post-processing (sharp/@napi-rs/canvas), idempotency/DB race safety, admin observability dashboards
**Confidence:** HIGH (all findings verified by reading the actual source files and by running live probes against the installed `sharp` binary in this repo — no speculative claims)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**WebP Quality & Text-Edge Check (POL-02)**
- `DEFAULT_IMAGE_QUALITY` bumped from 80 to 85 (main image; thumbnail quality stays a separate, lower setting as today).
- Automated text-edge artifact check follows Phase 23's golden-image pattern: render text via the compositor, encode to WebP at the new quality setting, measure edge-sharpness retention in a region straddling a text edge (reusing the existing region-contrast-analysis sampling approach), and fail if it degrades below a threshold. No new image-analysis library — built on `sharp`'s existing stats/extract capabilities, same as Phase 23's contrast analysis.

**Adaptive Logo Overlay (POL-03)**
- Reuse/adapt `analyzeRegionContrast` (Phase 23) to sample the logo's target region and decide whether a backing plate/shadow is needed when contrast is insufficient.
- Fix the specific JPEG (no-alpha) logo bug: instead of compositing a raw rectangular non-transparent image (producing a visible opaque box), apply a soft-edged plate/shadow treatment behind it so no hard box artifact appears.
- If the user has explicitly chosen a `logo_position`, that choice is RESPECTED — only the plate/shadow treatment at that position is contrast-adaptive. Automatic corner selection by region-contrast analysis applies only as the fallback algorithm when no `logo_position` was explicitly set by the user — it never silently overrides an explicit user choice.

**Idempotent Generate/Edit APIs (POL-06)**
- Mirrors the EXISTING carousel/enhance idempotency contract exactly: `idempotency_key: z.string().uuid()` in the request body, a pre-flight `SELECT` by `(idempotency_key, user_id)` before any generation work starts, a DB unique index for concurrent-request race safety, and returning the existing post (200 JSON) on a detected duplicate rather than creating a new one or double-charging.
- `generate.routes.ts` reuses the same `posts.idempotency_key` column already used by carousel/enhance (new post created, same table).
- `edit.routes.ts` gets its OWN new `post_versions.idempotency_key` column (additive migration) — since an edit creates a new `post_versions` row, not a new `posts` row, the dedup check and unique index apply to that table instead.

**Feedback + Admin Quality Dashboard (POL-09)**
- New additive `posts.feedback` column (`z.enum(["up","down"]).nullable()`) — one vote per post, overwritable (changing your mind re-submits the same field), no separate feedback-event table.
- New "Quality" tab in the admin panel (alongside the existing `GenerationsTab`/`DashboardTab` pattern) showing: feedback tally (thumbs up/down counts) + critic outcome rates (`generation_logs.event_kind='visual_critic'`, from Phase 24) + fallback rates (`event_kind='model_fallback'`, from Phase 21) together on one dashboard. Backed by a new admin route/query, since the existing `admin-generations.routes.ts` route explicitly does not select `event_kind`/`outcome`/`metadata` today.
- User-facing thumbs-up/down UI lives in `post-viewer-dialog.tsx` (where users already view their generated posts) — not a new page.

**POL-08 (Cost Reconciliation) — Explicitly Deferred, Non-Gating**
- Per ROADMAP's explicit callout: this requires one full billing period of real gateway traffic after the OpenRouter migration and CANNOT gate milestone close. This phase's job is to set up/schedule the audit (e.g., a documented runbook + any lightweight query/report scaffolding), not to actually run and close it — the reconciliation itself completes later, after the milestone ships.

### Claude's Discretion
- Exact WebP quality threshold formula for the automated edge-sharpness regression check.
- Exact contrast threshold / plate treatment algorithm for adaptive logo overlay.
- Exact `post_versions.idempotency_key` migration shape and dedup query.
- Exact admin Quality-tab layout/query shape.
- Exact POL-08 scheduling mechanism (could be a documented runbook, a scheduled reminder, or a lightweight scaffold query — not a fully-run audit).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (POL-08 itself is explicitly a deferred/scheduled-not-run item per the ROADMAP's own design, not a discussion-surfaced deferral.)

### Additional context from CONTEXT.md's `<specifics>` (in-scope bug, not a new requirement)
`typography-compositor.service.ts`'s `drawBlocks()` never sets `ctx.font` itself — it relies on whatever font `ctx` was left in by the LAST block iterated inside `layoutBlocks()`'s measurement loop, so in a multi-block layout (headline+support+cta) all blocks render with one block's font/size instead of each block's own. This predates Phase 25 (present since Phase 23) and was explicitly left unfixed there to preserve "byte-identical to Phase 23" test guarantees. Phase 26 is the natural place to close this — **confirmed real by direct code reading below** — and the fix WILL change output bytes for any multi-block layout, intentionally.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POL-02 | WebP output quality raised to 85+ with a text-edge quality check on composited images | `DEFAULT_IMAGE_QUALITY` constant location confirmed (single call site, zero explicit-quality overrides anywhere in the codebase — see "Standard Stack" and "Code Examples"); sharp-native edge-sharpness proxy (Laplacian convolve + region stats) verified to work in this repo's installed sharp version |
| POL-03 | Logo overlay gets contrast treatment — adaptive plate/shadow, corner chosen by region contrast analysis, JPEG (no-alpha) logos handled without opaque-box artifacts | `applyLogoOverlay` full current implementation read; `analyzeRegionContrast` reuse path identified; `sharp().metadata().hasAlpha` JPEG-detection mechanism verified live; SVG-plate + blur composite technique verified live with this repo's sharp build |
| POL-06 | `/api/generate` and `/api/edit-post` accept idempotency keys (same contract as carousel/enhance) | Full existing carousel/enhance idempotency implementation read end-to-end (schema, route pre-flight, DB unique index migration, service-layer insert + race behavior); exact insertion points in `generate.routes.ts`/`edit.routes.ts` identified; client call sites needing a generated key identified |
| POL-08 | Post-migration cost reconciliation: `generation_logs`/usage events audited against the OpenRouter dashboard for one billing period (post-ship audit — cannot gate milestone close) | Existing cost/usage data model read (`usage_events.cost_usd_micros`/`charged_amount_micros`, `recordUsageEvent`); confirmed no existing reconciliation scaffold; project's own runbook convention (`docs/production-cron.md`) identified as the pattern to replicate |
| POL-09 | Users can thumbs-up/down any generated post; feedback + critic/fallback rates surfaced in an admin quality dashboard | `generation_logs` schema's `event_kind`/`outcome`/`metadata` fields read; confirmed `admin-generations.routes.ts` does not select them (comment in `observability.service.ts` explicitly defers this to Phase 26); admin tab/nav/route registration pattern read end-to-end; `post-viewer-dialog.tsx` insertion point identified |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Validation:** Zod `safeParse` used on all request bodies before processing — new `idempotency_key`/`feedback` fields must go through `shared/schema.ts` Zod schemas, never ad-hoc validated.
- **Auth pattern:** `createServerSupabase(token)` for user-scoped (RLS-respecting) reads/writes; `createAdminSupabase()` for service-role (RLS-bypassing) admin operations. The existing idempotency pre-flight SELECTs in carousel/enhance use the ADMIN client (bypasses RLS, scoped manually via `.eq("user_id", ...)`) — replicate this, don't rely on RLS alone for the dedup check.
- **Path aliases:** `@` → `client/src/`, `@shared` → `shared/`.
- **Database schema changes:** `shared/schema.ts` is the single source of truth for Zod schemas/types. Actual DB migrations in this repo live as hand-written SQL files in `supabase/migrations/*.sql` (additive-only convention — `ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE ... IS NOT NULL`), not via `drizzle-kit push` for Supabase-side tables (the `npm run db:push` command exists but this project's actual migration history is 100% raw SQL files applied to Supabase — no migration in `supabase/migrations/` was found generated by drizzle-kit).
- **No new heavy dependencies:** ffmpeg is explicitly out of scope (video frozen this milestone). CONTEXT.md doubles this down for Phase 26 specifically: no new image-analysis or image-manipulation library for POL-02/POL-03 — everything must be built on the already-installed `sharp` (0.34.5) and `@napi-rs/canvas` (1.0.2, Phase 23).
- **AI keys via headers only** (POL-07, already shipped) — not relevant to this phase's new work but must not be violated by any new admin route added.
- **Coolify/Hetzner production runtime:** long-running Node process, `node-cron` is the live scheduler (`server/services/cleanup-cron.service.ts`). Relevant to POL-08's "scheduling" — see the POL-08 section below for why a literal new cron job is likely NOT the right shape for this specific requirement.

## Summary

Phase 26 is a pure "close the gaps" phase touching five independent, already-well-understood corners of an existing, mature pipeline (Phases 21-25 are all complete). None of the five requirements need a new library, a new architecture, or new research into an unfamiliar domain — every piece of work is a targeted change to a file this research has now read in full: `image-optimization.service.ts` (80 lines of quality constant + a purely-positional `applyLogoOverlay`), `typography-compositor.service.ts` (a confirmed real font-state bug in `drawBlocks`), the existing carousel/enhance idempotency contract (three files, one migration, fully mapped end-to-end including a real, honestly-documented gap in true-race handling), `generation_logs`'s already-populated `event_kind` observability data (just needs a new admin query), and the admin tab/nav scaffolding pattern (`GenerationsTab` is a literal template).

The highest-value finding is that **every risky "how do I even test this deterministically" question has a concrete, verified answer built entirely on `sharp`'s existing API** (already installed, already used, zero new dependency): `sharp().metadata().hasAlpha` reliably distinguishes JPEG-without-alpha from PNG-with-alpha logos (verified live in this repo); `sharp(svgBuffer).blur(n)` composited under the logo produces a soft plate with zero new library; and a Laplacian `convolve()` kernel + `.stats()` gives a deterministic, testable "edge energy" proxy for the WebP text-edge regression check, following the exact same "sharp region stats" idiom Phase 23 already established for contrast analysis. The idempotency work is the most mechanical: literally copy carousel/enhance's schema field, pre-flight SELECT, and unique-index migration pattern into two files, with one real wrinkle — `post_versions` has no `user_id` column, so the edit-side dedup check must scope by `(idempotency_key, post_id)` instead of `(idempotency_key, user_id)`.

**Primary recommendation:** treat this phase as five narrow, independent, minimal-diff changes against files already fully read — no exploratory spikes needed. The one item requiring a judgment call from the planner is POL-08, which cannot be "solved" this phase by design (it needs 30+ days of real production billing data) — the right shape is a documented runbook (matching this repo's own `docs/production-cron.md` convention) plus, optionally, a small reporting/query scaffold script that an operator runs manually once the billing period has elapsed. It is NOT a new `node-cron` job, because the comparison side (the OpenRouter dashboard) has no API integration in this codebase and building one is out of scope.

## Standard Stack

No new libraries. This phase is 100% additive work on top of the existing stack.

### Core (already installed, reused)
| Library | Version (verified) | Purpose | Why Standard (for this phase) |
|---------|---------|---------|--------------|
| `sharp` | 0.34.5 installed (checked via `require('./package.json')`); 0.35.3 is npm's current latest — no upgrade needed or in scope | WebP encode, region stats/extract, SVG-buffer rendering, blur, convolve, alpha detection | Already the sole image-processing library in `image-optimization.service.ts`/`typography-compositor.service.ts`/`image-crop.service.ts`. Every capability POL-02/POL-03 need (`.metadata().hasAlpha`, `.convolve()`, `.blur()`, SVG buffer input, `.extract().stats()`) was live-verified against THIS repo's installed binary during this research (see Code Examples). |
| `@napi-rs/canvas` | 1.0.2 (Phase 23) | Deterministic text rendering (`compositeTypography`) | Unrelated to POL-02/03's image-optimization work, but directly load-bearing for the `drawBlocks()` font-state bugfix (also in this phase's scope). |
| `zod` | (existing, per `shared/schema.ts`) | Request body validation | New `idempotency_key`/`feedback` fields are additive fields on existing `z.object(...)` schemas — no new Zod feature needed (`.uuid()`, `.enum()` already used extensively). |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Supabase JS client (existing) | (existing) | `posts.feedback` column read/write, new admin Quality query, idempotency pre-flight SELECT | Same `createAdminSupabase()`/`createServerSupabase(token)` pattern as every other route in this codebase. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sharp `convolve()` Laplacian kernel for edge-sharpness proxy | A dedicated image-diff/SSIM library (e.g., `pixelmatch`, `image-ssim`) | Rejected per CONTEXT.md: "No new image-analysis library." The convolve-based proxy is deterministic, sharp-native, and sufficient for a regression gate (detect "got meaningfully worse," not perceptual-quality scoring). |
| sharp SVG-buffer + blur for the logo plate/shadow | A dedicated shadow/glow compositing library, or CSS-in-canvas via `@napi-rs/canvas` | Rejected: sharp already does this in 2 lines (verified below) with zero new dependency; canvas would require re-loading the logo into a second raster pipeline for no benefit. |
| A real DB `feedback_events` table (append-only vote history) | Single `posts.feedback` nullable enum column | CONTEXT.md explicitly locks the simpler single-column, overwritable-vote design — no event history needed for v1.6. |

**Installation:** None required — nothing new to `npm install`.

**Version verification:**
```bash
node -e "console.log(require('./package.json').dependencies.sharp)"   # ^0.34.5 (this repo)
npm view sharp version                                                 # 0.35.3 (npm registry, current as of this research)
```
Both sharp versions expose the exact APIs this phase needs (`hasAlpha` metadata, `.convolve()`, `.blur()`, SVG buffer input) — confirmed by executing real probe scripts against the installed binary (not from training-data assumption). No version bump needed or recommended.

## Architecture Patterns

### POL-02: WebP quality bump + text-edge regression check

**Current state** (`server/services/image-optimization.service.ts:30`):
```typescript
const DEFAULT_IMAGE_QUALITY = 80;
```
This is the ONLY place quality is set. Every call site (`generate.routes.ts:718,807`, `edit.routes.ts:735`, `carousel.routes.ts:1227`, `carousel-generation.service.ts:500`) calls `processImageWithThumbnail(buffer)` with **zero explicit quality overrides** — confirmed by grepping every call site in the repo. Bumping `DEFAULT_IMAGE_QUALITY` from `80` to `85` is a genuine one-line, minimal-diff change that propagates everywhere automatically. `DEFAULT_THUMBNAIL_OPTIONS.quality = 70` (line 27) is a SEPARATE constant — untouched, per CONTEXT.md ("thumbnail quality stays a separate, lower setting as today").

**Text-edge regression check — recommended pattern** (new, Wave-0-installed script, e.g. `scripts/verify-webp-text-edge-quality.ts` or a new tag inside a new `scripts/verify-phase-26.ts`):
1. Reuse `tests/fixtures/typography/` fixtures (`high-contrast-1024.png`, `strings.json`'s `pt_br`/`long_wrap` blocks) — already committed, already used by `scripts/verify-golden-image.ts`.
2. Call `compositeTypography(...)` to get a lossless PNG with real rendered text at a KNOWN region (the function returns `meta.safe_zone`/archetype region — the text pixel bounds are derivable, or simpler: sample the WHOLE archetype region, since that's where 100% of the edges of interest are).
3. Encode that PNG to WebP twice: once at the OLD quality (80, as a control) and once at the NEW quality (85). (Optionally also test a deliberately-bad low quality, e.g. 40, as a "must fail" sanity control — mirrors `scripts/verify-golden-image.ts`'s tofu/blank ASCII-control pattern of proving the detector itself isn't vacuous.)
4. For each WebP buffer, decode back to raw pixels and run the edge-energy proxy (see Code Examples below) over the archetype text region; compare against the same proxy run on the ORIGINAL LOSSLESS PNG (ground truth).
5. Assert: `edgeEnergyRatio = webpEdgeEnergy / pngEdgeEnergy` stays above a threshold (e.g. `>= 0.6`, Claude's discretion per CONTEXT.md) at quality 85, AND that quality 85's ratio is `>=` quality 80's ratio (proving the bump is a real improvement, not a regression) — this is the "fail if it degrades below a threshold" check CONTEXT.md specifies.

This deliberately mirrors Phase 23's `analyzeRegionContrast` idiom (`sharp(...).extract(region).stats()`) rather than inventing a new analysis style — same source hierarchy, same "no new library" constraint, same test-fixture reuse.

### POL-03: Adaptive logo overlay

**Current state** (`server/services/image-optimization.service.ts:153-218`, `applyLogoOverlay`): purely positional. Resizes the logo to 14% of base width, computes a 3x3-grid anchor from `LogoPosition` (e.g. `"bottom-right"`), and composites with `blend: "over"`. **No contrast analysis. No alpha-channel check.** If the logo PNG/JPEG has no alpha channel (a JPEG export, or a PNG with an opaque white/solid background), the raw rectangular bounding box is what gets composited — this is the literal "opaque-box artifact" CONTEXT.md describes, confirmed by reading the function: there is nothing in the current code that treats non-alpha logos differently.

**Recommended rewrite shape** (keeping the exact same function signature/call sites — both call sites, `generate.routes.ts:781` and `edit.routes.ts:721`, pass `(finalImageBuffer, logoBuffer, position)` and expect a `Buffer` back, so the signature should NOT change):

1. **Alpha detection** (verified live against this repo's sharp binary):
   ```typescript
   const logoMeta = await sharp(logoBuffer).metadata();
   const logoHasAlpha = logoMeta.hasAlpha === true; // false for JPEG, true for RGBA PNG
   ```
2. **Region contrast** — reuse (import, don't reimplement) `analyzeRegionContrast` from `typography-compositor.service.ts` (already exported), sampling the exact rectangle where the logo will land (same `{left, top, width, height}` shape it already accepts).
3. **Decision:** if `!logoHasAlpha || contrast.scrimNeeded` (busy/low-contrast background), render a soft plate BEHIND the logo instead of compositing the logo directly onto the base:
   - Build an SVG rounded-rect buffer sized to the logo's bounding box + a small margin (e.g. 8-12% of logo width), semi-transparent fill (reuse `contrast.scrimColor`/`contrast.scrimAlpha` from `analyzeRegionContrast` for palette consistency with the typography scrim), `.blur(n)` it for a soft/feathered edge (verified working below), composite that plate onto the base FIRST, then composite the (possibly still-opaque-background) logo on top of the plate.
   - If the logo IS alpha-transparent AND contrast is fine, skip the plate entirely — behavior stays byte-identical to today for the common "good PNG logo, good background" case (important for not regressing the majority path).
4. **Corner selection when `logo_position` is NOT explicitly set by the user:** per CONTEXT.md, automatic region-contrast-driven corner selection is the FALLBACK ONLY. Concretely: `generate.routes.ts`/`edit.routes.ts` both already pass `logo_position || "bottom-right"` — this silently defaults to bottom-right today. The fix is to distinguish "position was truly unset" (compute contrast for all 4 corners, pick the best) from "position was explicitly `bottom-right`" (respect it, apply plate treatment only). This requires the ROUTE to stop collapsing `undefined` into `"bottom-right"` before calling `applyLogoOverlay` — pass `logo_position` through as possibly-`undefined` and let the (rewritten) `applyLogoOverlay` (or a new wrapper function) do the fallback-selection itself.

**JPEG-no-alpha detection — verified live in this repo:**
```
rgba (PNG) metadata: { channels: 4, hasAlpha: true,  format: 'png'  }
jpeg        metadata: { channels: 3, hasAlpha: false, format: 'jpeg' }
```
`sharp().metadata().hasAlpha` is a direct boolean — no need to inspect raw channel data manually. HIGH confidence: executed against the actual installed sharp 0.34.5 binary in this environment, not asserted from training data.

**Soft plate/shadow — verified live in this repo (zero new library):**
```typescript
const svg = Buffer.from(
  `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="${color}" fill-opacity="${alpha}"/></svg>`
);
const plate = await sharp(svg).png().toBuffer();          // renders SVG -> PNG buffer (verified)
const softPlate = await sharp(plate).blur(8).toBuffer();  // feathered edge (verified, sigma=8 arbitrary)
// composite softPlate onto base BEFORE the logo, at the logo's target top/left minus margin
```
Both steps executed successfully against this repo's sharp install during this research (see Sources — inline verification, not a doc claim).

### POL-06: Idempotent generate/edit APIs

The EXISTING contract (carousel + enhance, both fully read end-to-end) is:

1. **Schema** (`shared/schema.ts:1407` carousel, `:1424` enhance): `idempotency_key: z.string().uuid()` — REQUIRED (not `.optional()`), top-level in the request body schema.
2. **DB migration** (`supabase/migrations/20260421000000_v1_1_schema_foundation.sql:29-38`):
   ```sql
   alter table public.posts add column if not exists idempotency_key text;
   create unique index if not exists posts_idempotency_key_unique
     on public.posts (idempotency_key) where idempotency_key is not null;
   ```
   Note this is a GLOBAL unique index (not scoped per-user) with a partial `WHERE ... IS NOT NULL` clause — standard Postgres pattern for "unique when present, nullable for legacy/other-content-type rows."
3. **Route pre-flight** (`carousel.routes.ts:340-354`, `enhance.routes.ts:204-219`) — identical shape in both:
   ```typescript
   const adminSb = createAdminSupabase();
   const { data: existingPost } = await adminSb
     .from("posts").select("*")
     .eq("idempotency_key", parsed.idempotency_key)
     .eq("user_id", user.id)
     .maybeSingle();
   if (existingPost) {
     return res.status(200).json({ idempotent: true, post: existingPost });
   }
   ```
   Both are placed AFTER body validation (Zod parse), AFTER key/brand resolution, and BEFORE the credit-check gate — this ordering matters: a duplicate resubmit must never re-run the credit gate. In `enhance.routes.ts` it also runs after the 5 MB image-size guard (route-specific, not relevant to generate/edit).
4. **Service-layer insert** (`carousel-generation.service.ts:855-873`, `enhancement.service.ts:720-736`): the service passes `idempotency_key: params.idempotencyKey` straight into the `posts` insert. **Important, honestly-documented gap**: on a TRUE concurrent race (two requests in flight simultaneously, both pass the pre-flight SELECT before either inserts), the SECOND insert fails on the unique-index constraint violation and the code does NOT gracefully convert this into a 200-with-existing-post response — it just throws a generic `Error`, caught by the route's outer catch, surfaced as a 500 (`carousel-generation.service.ts:868-873` explicitly calls this out in a comment: "Covers the idempotency race too: a concurrent duplicate loses on the unique index here"). **This is the exact behavior CONTEXT.md's "Mirrors the EXISTING... contract exactly" instructs replicating** — the common case (accidental double-submit/retry after completion) is handled gracefully; the rare true-race case fails loudly rather than silently. Flagged in Open Questions below in case the planner wants to explicitly decide whether to improve this or truly mirror it as-is.

**Exact insertion points for `generate.routes.ts`:**
- Schema: add `idempotency_key: z.string().uuid()` to `generateRequestSchema` (`shared/schema.ts:1355-1383`).
- Route: insert the pre-flight SELECT block after body validation (`generate.routes.ts:319-353`, right after destructuring `parseResult.data`) and BEFORE the credit-check block (`:393-432`) — matches carousel's relative ordering (validate -> idempotency -> credit gate).
- Insert: `generate.routes.ts:894-928`'s `posts.insert({...})` call gains `idempotency_key`. No service-layer indirection exists here (unlike carousel/enhance) — `generate.routes.ts` does its own DB insert directly, so the race-failure behavior (uncaught insert error -> outer catch -> 500) will naturally match the carousel/enhance pattern with ZERO extra code, since the outer try/catch already exists.

**Exact insertion points for `edit.routes.ts`:**
- Schema: add `idempotency_key: z.string().uuid()` to `editPostRequestSchema` (`shared/schema.ts:1432-1459`) — TOP-LEVEL (sibling to `post_id`/`edit_prompt`), NOT inside `edit_context` (which is a free-form remake-context bag, not the request's own identity key).
- **Critical schema wrinkle**: `post_versions` has NO `user_id` column (confirmed by reading `supabase/migrations/20260304000002_add_post_versions_table.sql` — ownership is enforced entirely via an RLS policy that joins to `posts.user_id`). The dedup pre-flight for edit therefore CANNOT copy carousel/enhance's `(idempotency_key, user_id)` scoping verbatim. Use `(idempotency_key, post_id)` instead — `post_id` is already validated to belong to the requesting user earlier in the SAME route (`edit.routes.ts:268-278`'s `post` fetch already does `.eq("id", post_id).eq("user_id", user.id)`), so scoping the idempotency SELECT by `post_id` is equally safe and simpler.
- Route: insert the pre-flight SELECT on `post_versions` after the brand fetch (`edit.routes.ts:337-346`) and BEFORE the credit-check gate (`:348-382`) — same "before credit gate" principle as carousel/enhance.
- New migration: `ALTER TABLE public.post_versions ADD COLUMN IF NOT EXISTS idempotency_key text;` + `CREATE UNIQUE INDEX IF NOT EXISTS post_versions_idempotency_key_unique ON public.post_versions (idempotency_key) WHERE idempotency_key IS NOT NULL;` (mirrors the posts-table migration exactly, different table).
- Insert: `edit.routes.ts:780-792`'s `post_versions.insert({...})` call gains `idempotency_key`.

**Client-side gap (must also be fixed, or the server-side work is inert):** confirmed by grep — `/api/generate`'s request body (`post-creator-dialog.tsx:486-509`, `handleGenerate`) currently sends NO `idempotency_key` field at all. `/api/edit-post` has THREE call sites needing the same treatment: `post-edit-dialog.tsx:326` (manual edit), `post-viewer-dialog.tsx:328` (quick remake), `posts.tsx:501` (a third call site — gallery-level action). All three need a `crypto.randomUUID()` generated once per submit and threaded into the request body, exactly like carousel (`post-creator-dialog.tsx:624,634`) and enhance (`:760,768`) already do.

**Explicitly OUT of scope:** `POST /api/carousel/slide/edit` (`editSlideRequestSchema`, `shared/schema.ts:1466-1474`) has NO idempotency key today and POL-06 does not name it — confirmed by reading the schema and the route. Do not add idempotency there; it would be scope creep beyond POL-06's named endpoints.

### POL-09: Admin Quality dashboard + feedback

**Data already exists** — `generation_logs.event_kind` (`shared/schema.ts:1531-1538`) already has `"model_fallback"` (Phase 21, logged by `ai-gateway.service.ts:52-75`'s `logModelFallback`) and `"visual_critic"` (Phase 24, logged by `observability.service.ts:180-205`'s `logVisualCritic`), both with populated `outcome`/`metadata` columns. `admin-generations.routes.ts` (330 lines, fully read) explicitly does NOT select `event_kind`/`outcome`/`metadata` anywhere in its query (`:58-62` only selects `id, user_id, created_at, error_message, request_params, error_type, status`) — confirmed by grep across the whole file. A NEW route/query is required; do not try to extend the existing generations list endpoint (it's already a complex dedup/pagination/multi-table-merge endpoint — bolting aggregate queries onto it would be a bad shape).

**Recommended new file:** `server/routes/admin-quality.routes.ts` (new, following the exact `admin-generations.routes.ts` structural precedent: `requireAdminGuard(req, res)` guard, `createAdminSupabase()` client, one `GET` endpoint). Suggested queries:
```sql
-- Feedback tally
SELECT feedback, COUNT(*) FROM posts WHERE feedback IS NOT NULL GROUP BY feedback;
-- Critic outcome rates
SELECT outcome, COUNT(*) FROM generation_logs WHERE event_kind = 'visual_critic' GROUP BY outcome;
-- Model fallback rate
SELECT metadata->>'call_class' AS call_class, COUNT(*) FROM generation_logs WHERE event_kind = 'model_fallback' GROUP BY 1;
```
(The compliance-rate query for critic outcomes is even given verbatim in `observability.service.ts:177-178`'s own doc comment — reuse it exactly.) Supabase JS client can express simple `COUNT`/`GROUP BY` via `.select("outcome", {count: "exact"})` per-outcome-value queries, or a single `.select("event_kind, outcome, metadata").eq(...)` fetch + in-process aggregation (simpler given expected row volume, matches this codebase's existing style — `admin-generations.routes.ts` already does client/server-side aggregation, not raw SQL RPC calls).

**Migration:** `ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS feedback text;` + a `CHECK (feedback IN ('up','down') OR feedback IS NULL)` constraint (or rely purely on the Zod `z.enum(["up","down"]).nullable()` for validation, matching this repo's general looseness about DB-level CHECK constraints on enum-shaped text columns — `content_type`/`error_type` DO have CHECK constraints in older migrations, so adding one here is more consistent with precedent than not).

**Feedback-submission endpoint:** new `PATCH /api/posts/:id/feedback` (or `POST`) in `server/routes/posts.routes.ts`, following the exact `POST /api/posts/:id/remake-caption` pattern (`posts.routes.ts:306-345`: `authenticateUser`, fetch+verify post ownership via `.eq("id", postId).eq("user_id", user.id)`, then `.update({ feedback })`).

**Admin UI wiring (3 files, all read in full):**
1. `client/src/components/admin/generations-tab.tsx` is the literal template — same `useQuery` + `adminFetch` pattern, same Card/Table shadcn/ui components already imported project-wide.
2. `client/src/pages/admin.tsx`: add `case "quality": return <QualityTab />;` to the switch (`:47-73`) + import.
3. `client/src/components/app-sidebar.tsx`: add `{ title: "Quality", url: "/admin/quality", icon: ThumbsUp (or similar), page: "quality" }` to `adminNavItems` (`:32-42`). `client/src/App.tsx` already routes `/admin/:page` generically into `AdminPage initialTab={adminTab}` (confirmed, no per-page route registration needed).
4. `server/routes/index.ts`: register the new route file (`router.use(adminQualityRoutes);` alongside `adminGenerationsRoutes` at `:121`) and export it from the `export {...}` block.

**Thumbs-up/down UI insertion point:** `client/src/components/post-viewer-dialog.tsx`, in the left-column action-button stack, after the "Edit Image/Video" button (`:685-702`) and before the expiration-timer block (`:703-740`) — this is where Download/Quick-Remake/Edit already live as a vertical `w-full` button stack; two small icon buttons (thumbs-up/down) fit naturally here as a pair, calling a new `apiRequest("PATCH", \`/api/posts/${post.id}/feedback\`, { feedback: "up" | "down" })` (the file already imports `apiRequest` from `@/lib/queryClient` at `:28`).

### POL-08: Cost reconciliation setup (non-gating)

**Existing cost data** (verified by reading `server/quota.ts` and `shared/schema.ts:1486-1507`): `usage_events.cost_usd_micros`/`charged_amount_micros` already capture real per-request OpenRouter cost (Phase 21, GATE-05) via `recordUsageEvent(...)`. `generation_logs` additionally has per-attempt critic/re-roll cost breakdowns (Phase 24). **No existing reconciliation script, runbook, or scheduled task was found anywhere in the repo** (`scripts/` has no `reconcil*` file; `docs/` has no cost-audit doc).

**Recommendation:** this requirement is explicitly designed to NOT be completable this phase (needs 30+ days of live traffic against a dashboard this codebase has no API integration with). The right-sized deliverable, matching this project's own established convention (`docs/production-cron.md` — a dated, authoritative, "lives forever in the repo" runbook referencing exact function/file names):
1. A new `docs/cost-reconciliation-runbook.md` documenting: (a) the exact SQL/Supabase query to sum `usage_events.cost_usd_micros` grouped by day/model over a date range, (b) where to find the equivalent OpenRouter dashboard export, (c) what "material discrepancy" means operationally (a numeric threshold, e.g. >5%), (d) who runs it and when (one full billing period after the OpenRouter migration ships — i.e., NOT this phase).
2. Optionally, a small scaffold script (`scripts/reconcile-openrouter-costs.ts`) that runs the query and prints a formatted summary table for an operator to eyeball against the OpenRouter dashboard by hand — explicitly NOT wired into `node-cron` or CI, since there's nothing to compare against programmatically without a new OpenRouter API integration (out of scope).
This is NOT a `node-cron` job (the existing `cleanup-cron.service.ts` pattern is for jobs the SERVER can execute unattended against its own DB — this task requires a human to cross-reference an external dashboard, so automatic scheduling doesn't apply the same way).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Detecting whether a logo image has an alpha channel | Manual pixel/byte inspection of the raw buffer, or parsing PNG/JPEG headers by hand | `sharp(buf).metadata().hasAlpha` | Already a direct boolean on sharp's metadata; verified working in this repo for both PNG (true) and JPEG (false). Zero new code needed beyond one property read. |
| Soft shadow/plate rendering behind the logo | A new canvas-based shadow renderer, or a new npm dependency (e.g. a "drop-shadow" image library) | `sharp(svgBuffer).blur(n)` composited before the logo | Verified working end-to-end in this repo: SVG rounded-rect -> PNG buffer -> blur -> composite, all native sharp calls already imported everywhere in this codebase. |
| Edge-sharpness / "did WebP compression smear my text" detection | A new SSIM/perceptual-diff library | `sharp().convolve()` with a Laplacian kernel + `.stats()` on the extracted region | Verified working in this repo; mirrors the EXACT idiom `analyzeRegionContrast` (Phase 23, already shipped) uses for contrast — this project has an established "sharp region stats" pattern for exactly this class of problem. |
| Idempotency/duplicate-request protection | A new in-memory cache, a new Redis-backed dedup layer, or a bespoke request-hash scheme | The EXACT existing `(unique DB index) + (pre-flight SELECT) + (return-existing-row-as-200)` pattern already shipped twice (carousel, enhance) | This is a locked CONTEXT.md decision — "Mirrors the EXISTING carousel/enhance idempotency contract exactly." Any deviation (e.g. a smarter distributed lock) would be over-engineering relative to the existing, working, twice-proven pattern. |
| Admin dashboard aggregate queries | A new reporting/BI tool or raw SQL RPC layer | In-process aggregation over a `.select(...)` fetch, matching `admin-generations.routes.ts`'s existing style | Consistent with the codebase's established convention — this project does NOT use Postgres RPC functions or a query builder beyond the Supabase JS client for admin aggregates today. |

**Key insight:** every "hard-looking" problem in this phase (alpha detection, soft shadows, edge-sharpness regression) already has a native `sharp` capability that this research directly executed and confirmed against the actual installed binary — there is no case in this phase where reaching for a new dependency is justified.

## Common Pitfalls

### Pitfall 1: Assuming the `drawBlocks()` font bug fix is risk-free to existing tests
**What goes wrong:** Fixing `drawBlocks()` to set `ctx.font` per-block will change the PNG byte output of every multi-block composited image (any post with 2+ `text_blocks`, which is the common case: highlight+support+cta).
**Why it happens:** `layoutBlocks()` sets `ctx.font` once per block during its measurement loop (`typography-compositor.service.ts:461`), and `drawBlocks()` never re-sets it (`:527-569` — confirmed by reading the full function, no `ctx.font =` assignment anywhere inside it) before calling `ctx.fillText(...)` per line. After `layoutBlocks()` returns, `ctx.font` is left at whatever the LAST block in the array set it to — so ALL blocks render with that one block's size/weight.
**How to avoid:** add `ctx.font = \`${layout.size_px}px ${layout.alias}\`;` at the top of `drawBlocks()`'s `layouts.forEach((layout, i) => {...})` loop, before drawing that layout's lines.
**Verification this is safe:** confirmed by reading `scripts/verify-golden-image.ts` and `scripts/test-typography-treatment.ts` in full — NEITHER does a byte-for-byte comparison against a stored/committed golden PNG. `verify-golden-image.ts`'s checks are: PNG validity, dimensions, "differs from input," and "wrapped to >=3 lines" — none of these will be violated by the fix. `test-typography-treatment.ts`'s byte-identity assertions compare two LIVE calls to `compositeTypography` against each other (e.g., "omitting `treatment` == passing `IDENTITY_TYPOGRAPHY_TREATMENT` explicitly") — both sides of each such comparison go through the SAME (fixed) code path, so they stay equal to each other after the fix. **No existing test will break; the fix is safe to land.** `scripts/verify-phase-23.ts:544`'s `identicalToInput` check only applies to the zero-text-blocks pass-through path, untouched by this fix.

### Pitfall 2: Silently collapsing `logo_position: undefined` before it reaches the adaptive-selection logic
**What goes wrong:** Both `generate.routes.ts:784-786` and `edit.routes.ts:717-720` currently write `logo_position || "bottom-right"` (or `?? "bottom-right"`) BEFORE calling `applyLogoOverlay` — by the time the overlay function runs, it can no longer tell "user explicitly chose bottom-right" from "user chose nothing." CONTEXT.md requires this distinction ("never silently overrides an explicit user choice").
**Why it happens:** The current code was written before adaptive corner-selection was a concept — collapsing to a sane default early was reasonable at the time.
**How to avoid:** stop collapsing at the route layer; pass `logo_position` through as possibly-`undefined` into the (rewritten) logo-overlay call, and do the "undefined -> auto-select best corner via contrast" vs. "defined -> respect it" branch INSIDE the overlay logic itself.
**Warning signs:** if a fixture test passes `logo_position: undefined` and asserts the corner is NEVER `"bottom-right"` when another corner has better contrast, and that test fails only because the route pre-filled `"bottom-right"` before the function ever saw `undefined` — that's this exact pitfall.

### Pitfall 3: Copying the `(idempotency_key, user_id)` dedup scoping verbatim onto `post_versions`
**What goes wrong:** `post_versions` has no `user_id` column (confirmed via migration `20260304000002_add_post_versions_table.sql` — ownership is via RLS join to `posts`), so `.eq("user_id", user.id)` on a `post_versions` query will error (unknown column) or (if using the admin client, which bypasses RLS AND doesn't validate columns until the query is built) simply throw a Postgres "column does not exist" error at runtime.
**Why it happens:** natural copy-paste from the carousel/enhance pattern, which both operate on `posts` (which DOES have `user_id`).
**How to avoid:** scope the edit-side idempotency SELECT by `(idempotency_key, post_id)` instead — `post_id` is already ownership-verified earlier in `edit.routes.ts` (`:268-278`).

### Pitfall 4: Believing the existing idempotency contract handles true concurrent races gracefully
**What goes wrong:** assuming "duplicate key returns existing post as 200" covers ALL duplicate scenarios, including two simultaneous in-flight requests with the same key.
**Why it happens:** the pre-flight SELECT looks like it should catch this, but a true race means BOTH requests pass the pre-flight check (neither sees the other's not-yet-committed row) and only the DB unique index catches it — at INSERT time, not SELECT time — and the losing request's insert just throws, surfaced as a generic 500, NOT a graceful 200.
**How to avoid:** this is the ACTUAL, already-shipped, twice-proven behavior of carousel/enhance (confirmed by reading `carousel-generation.service.ts:868-873`'s own comment acknowledging this). CONTEXT.md's instruction to mirror the pattern "exactly" means Phase 26 should replicate this same behavior, not silently improve on it. Flagged as an Open Question below in case the planner wants to make an explicit call on whether to leave this as-is (recommended, for consistency) or add graceful race-loser handling (a genuine scope expansion, not asked for).

### Pitfall 5: Missing client-side `idempotency_key` generation (server-only fix is inert)
**What goes wrong:** landing the full server-side idempotency contract but forgetting the client never sends the key, so the DB column/unique-index/pre-flight-check exist but are never exercised (every request's `idempotency_key` is either missing — Zod rejects it, since it's `z.string().uuid()` non-optional — or the whole feature silently does nothing if made optional).
**Why it happens:** POL-06 reads as a backend requirement, but the existing carousel/enhance contract REQUIRES the key (non-optional Zod field) and generates it client-side (`crypto.randomUUID()`).
**How to avoid:** the schema change to `generateRequestSchema`/`editPostRequestSchema` making `idempotency_key` non-optional will BREAK every client call site that doesn't send it (Zod `safeParse` will fail with a 400). All 4 client call sites (`post-creator-dialog.tsx`'s `handleGenerate`, `post-edit-dialog.tsx:326`, `post-viewer-dialog.tsx:328`, `posts.tsx:501`) must be updated in the SAME phase, not left as a follow-up.

## Code Examples

### Verified: sharp alpha-channel detection (POL-03)
```typescript
// Executed live against this repo's installed sharp 0.34.5 during this research.
const meta = await sharp(logoBuffer).metadata();
const hasAlpha = meta.hasAlpha === true;
// RGBA PNG  -> { channels: 4, hasAlpha: true,  format: 'png'  }
// JPEG      -> { channels: 3, hasAlpha: false, format: 'jpeg' }
```

### Verified: soft plate/shadow via SVG + blur (POL-03)
```typescript
// Executed live against this repo's installed sharp 0.34.5 during this research.
const plateSvg = Buffer.from(
  `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="${scrimColor}" fill-opacity="${scrimAlpha}"/></svg>`
);
const plate = await sharp(plateSvg).png().toBuffer();
const softPlate = await sharp(plate).blur(8).toBuffer(); // sigma tunable
// then: base.composite([{ input: softPlate, top, left }, { input: preparedLogo, top: logoTop, left: logoLeft }])
```

### Verified: Laplacian edge-energy proxy for the WebP text-edge check (POL-02)
```typescript
// Executed live against this repo's installed sharp 0.34.5 during this research.
const edgeStats = await sharp(regionBuffer)
  .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
  .greyscale()
  .stats();
const edgeEnergy = edgeStats.channels[0].stdev; // higher stdev = more edge energy retained
```

### Existing pattern: idempotency pre-flight SELECT (source: `server/routes/carousel.routes.ts:340-354`)
```typescript
const adminSb = createAdminSupabase();
const { data: existingPost } = await adminSb
    .from("posts")
    .select("*")
    .eq("idempotency_key", parsed.idempotency_key)
    .eq("user_id", user.id)
    .maybeSingle();
if (existingPost) {
    return res.status(200).json({ idempotent: true, post: existingPost });
}
```

### Existing pattern: additive migration shape (source: `supabase/migrations/20260728000000_posts_base_image_typography_generation_params.sql`, full file, 30 lines — the template for this phase's new migration)
```sql
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS base_image_url text,
  ADD COLUMN IF NOT EXISTS typography_meta jsonb,
  ADD COLUMN IF NOT EXISTS generation_params jsonb;
```

### Existing pattern: `generation_logs` compliance-rate query (source: `server/services/observability.service.ts:177-178`, doc comment)
```sql
SELECT outcome, COUNT(*) FROM generation_logs WHERE event_kind = 'visual_critic' GROUP BY outcome;
```

## State of the Art

Not applicable in the "library changed since training" sense — this phase touches zero external APIs/libraries whose behavior could have drifted. The one "state of the art" consideration is internal: this is the FIRST phase in the v1.6 milestone to close out `generate.routes.ts`/`edit.routes.ts`'s idempotency gap, which every OTHER generation-adjacent route (carousel, enhance) already closed in earlier phases — so this phase is "catching up" the last two routes to match an already-established internal standard, not adopting a new external one.

## Open Questions

1. **Should the true-concurrent-race case (both requests pass pre-flight, one loses on the unique-index insert) be gracefully handled as a 200 in `generate.routes.ts`/`edit.routes.ts`, or should the existing carousel/enhance "throws a generic 500" behavior be replicated as-is?**
   - What we know: CONTEXT.md says "Mirrors the EXISTING carousel/enhance idempotency contract exactly" — the existing contract's own code comment (`carousel-generation.service.ts:868-873`) acknowledges the race "loses on the unique index" and is handled by just letting the insert fail.
   - What's unclear: whether "exactly" was written with awareness of this specific gap, or whether the planner should treat this as a bug to fix WHILE mirroring the rest.
   - Recommendation: replicate exactly (safest, matches locked decision text literally, keeps behavior consistent across all 4 idempotent endpoints). If the planner wants to improve it, that's a deliberate scope addition beyond what CONTEXT.md asked for and should be called out explicitly in the plan, not done silently.

2. **Exact numeric threshold for the WebP text-edge-sharpness regression check (edgeEnergyRatio cutoff) and for the logo-overlay contrast decision.**
   - What we know: CONTEXT.md explicitly leaves both as "Claude's Discretion." The Laplacian-convolve proxy and `analyzeRegionContrast` reuse are both verified-working mechanisms; only the pass/fail numeric threshold is undetermined.
   - What's unclear: there's no perceptual-quality ground truth in this repo to calibrate against (no existing before/after example of "too much artifacting").
   - Recommendation: set thresholds empirically during implementation by encoding the actual test fixtures at a RANGE of qualities (e.g., 40/60/80/85/95) and picking a cutoff that clearly separates "typography still crisp" from "visibly degraded" by eye once — then hard-code that ratio, matching how `BUSY_STDEV_THRESHOLD = 55` etc. were evidently chosen in Phase 23 (unexplained "tuned" constants, not derived from a formula).

3. **Whether POL-08's scaffold script (if built) should query `usage_events` directly or `generation_logs`'s cost-adjacent metadata, or both.**
   - What we know: `usage_events.cost_usd_micros`/`charged_amount_micros` is the authoritative BILLED cost; `generation_logs`'s `visual_critic`/`model_fallback` rows carry supplementary cost metadata (re-roll cost, fallback reason) but are not the billing source of truth.
   - What's unclear: what "audited against the OpenRouter dashboard" should sum — likely `usage_events` alone (that's what was actually charged), with `generation_logs` used only to EXPLAIN discrepancies (e.g., "this week's total looks high because of N re-rolls").
   - Recommendation: scaffold the query against `usage_events` as the primary sum, and document (in the runbook) that `generation_logs` is the place to look when investigating an unexplained delta.

## Environment Availability

Skipped — this phase has no new external dependencies (no new libraries, no new services, no new CLI tools). Every capability used (`sharp`, `@napi-rs/canvas`, Supabase client, Zod) is already installed and already verified working in this environment during the course of this research (see Standard Stack / Code Examples — these are not assumed, they were executed).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None formal (no jest/vitest/mocha). This project's convention: bespoke, no-network, assertion-printing TypeScript scripts run directly via `tsx` — `scripts/verify-phase-N.ts` (multi-tag phase gates, one per milestone phase, e.g. `verify-phase-23.ts`, `verify-phase-24.ts`, `verify-phase-25.ts`) and `scripts/test-*.ts` (focused pure-logic fixture scripts, e.g. `test-typography-treatment.ts`, `test-critic-reroll-logic.ts`). |
| Config file | None — see Wave 0 (a new `scripts/verify-phase-26.ts` must be created, following the exact structural precedent of `verify-phase-25.ts`: tagged checks, a `--only=<tag>` CLI filter, a `--only=self-test` meta-check, honest RED output naming the not-yet-written artifact). |
| Quick run command | `npx tsx scripts/verify-phase-26.ts --only=self-test` (once created) or a targeted new script, e.g. `npx tsx scripts/test-logo-overlay-contrast.ts` |
| Full suite command | `npx tsx scripts/verify-phase-26.ts` (once created); zero-regression sweep also requires re-running `verify-phase-21.ts`/`-21.1.ts`/`-22.ts`/`-23.ts`/`-24.ts`/`-25.ts` and `verify-golden-image.ts`, matching every prior phase's own "spawnSync sweep of all prior gates" convention (see `verify-phase-25.ts`'s `[svc-cross-plan]` tag for the exact pattern to replicate). |

CI (`.github/workflows/build-deploy.yml`'s `verify` job) currently runs exactly `npm run check` (tsc) then `npx tsx scripts/verify-golden-image.ts` then gitleaks — it does NOT run any `verify-phase-N.ts` script. Those are execution-time (per-plan, per-phase) gates run manually/by the executing agent, not CI-wired. The drawBlocks font fix and any WebP-quality change should be re-verified against `verify-golden-image.ts` (which DOES run in CI) since that script's checks (PNG validity, dimensions, "differs from input," word-wrap line count) must still pass — confirmed none of them assert on exact byte content that either fix would break.

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POL-02 | `DEFAULT_IMAGE_QUALITY === 85` | unit (static/functional) | `npx tsx scripts/verify-phase-26.ts --only=svc-webp-quality` | ❌ Wave 0 |
| POL-02 | WebP text-edge regression check fails on a deliberately bad quality, passes at 85 | functional (fixture-based) | `npx tsx scripts/verify-phase-26.ts --only=svc-webp-edge-check` | ❌ Wave 0 |
| POL-03 | JPEG (no-alpha) logo never produces a raw opaque box; plate/shadow applied | functional (fixture-based, using a real no-alpha JPEG fixture + a real alpha PNG fixture) | `npx tsx scripts/verify-phase-26.ts --only=svc-logo-contrast` | ❌ Wave 0 |
| POL-03 | Explicit `logo_position` is respected (never auto-overridden); auto-selection only when unset | functional | `npx tsx scripts/verify-phase-26.ts --only=svc-logo-contrast` | ❌ Wave 0 |
| POL-06 | Duplicate `idempotency_key` on `/api/generate`/`/api/edit-post` returns existing post/version as 200, no duplicate row, no double charge | functional (requires live Supabase — likely a manual/live runbook step, matching Phase 24's precedent of a `checkpoint:human-verify` blocking task for anything needing real DB/network) | Static: `npx tsx scripts/verify-phase-26.ts --only=svc-idempotency` (schema/route-shape checks); Live: manual runbook step (2 identical requests, same key) | ❌ Wave 0 |
| POL-09 | Admin Quality dashboard shows feedback tally + critic/fallback rates | functional (static route/query shape) + manual UI check | `npx tsx scripts/verify-phase-26.ts --only=svc-quality-dashboard` | ❌ Wave 0 |
| POL-09 | User can thumbs-up/down a post; overwritable | manual/live (UI interaction) | manual runbook step | ❌ Wave 0 |
| POL-08 | Reconciliation runbook exists and documents the audit procedure | static (file-existence + content check) | `npx tsx scripts/verify-phase-26.ts --only=svc-cost-reconciliation-runbook` | ❌ Wave 0 |
| (bugfix) | `drawBlocks()` sets `ctx.font` per-block; multi-block layout renders each block at its own size | functional (fixture-based, reusing `tests/fixtures/typography/strings.json`'s `pt_br` 3-block fixture) | `npx tsx scripts/verify-phase-26.ts --only=svc-drawblocks-font-fix` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the specific new tag(s) that plan's task added, e.g. `npx tsx scripts/verify-phase-26.ts --only=svc-logo-contrast`.
- **Per wave merge:** full `npx tsx scripts/verify-phase-26.ts` + `npx tsx scripts/verify-golden-image.ts` + `npm run check`.
- **Phase gate:** full suite green, PLUS the zero-regression spawnSync sweep of `verify-phase-21.ts`/`-21.1.ts`/`-22.ts`/`-23.ts`/`-24.ts`/`-25.ts` (matching every prior phase's own closing-plan convention) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `scripts/verify-phase-26.ts` — the new 6-ish-tag phase gate (one tag per POL-02/03/06/08/09 + one for the drawBlocks bugfix), following `verify-phase-25.ts`'s exact structural precedent (tag filter, self-test, honest RED naming missing artifacts).
- [ ] A no-alpha JPEG logo fixture + an alpha-transparent PNG logo fixture under `tests/fixtures/` (needed for POL-03's functional tests — none currently exist; `tests/fixtures/typography/` only has full-image PNGs, no logo-shaped fixtures).
- [ ] Decide whether POL-06's live idempotency proof (real duplicate-request-returns-200-not-duplicate) is a `checkpoint:human-verify` blocking task (matching Phases 22/23/24/25's own precedent for anything needing live Supabase + real network) or can be proven with a mocked/local-Supabase harness — no local Postgres/Supabase emulator was found in this repo, so live verification likely requires the same "blocking, needs real Coolify/Supabase" pattern every recent phase has hit.

