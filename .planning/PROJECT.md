# My Social Autopilot

## What This Is

AI-powered social media content creation SaaS platform. Users connect their brand identity (colors, logo, mood), describe what they want to post, and the platform uses Google Gemini to generate a complete post — single image, multi-slide carousel, or professionally enhanced product photo — ready to publish. Target audience is small businesses and creators who want consistent, on-brand social media presence without a design team.

## Core Value

Users can generate on-brand visual content (single posts, multi-slide carousels, and professionally enhanced product photos) in seconds from a prompt or a reference image — and recover any post they accidentally delete within a 30-day trash window.

## Current State

**Last shipped:** v1.3 Generation Quality Observability (2026-05-08)

**Active milestone:** v1.4 GHL Signup Sync (started 2026-05-08)

## Current Milestone: v1.4 GHL Signup Sync

**Goal:** Auto-sync every Xareable user signup to the connected GoHighLevel CRM as a contact tagged `xareable`, so the operator can run marketing campaigns (WhatsApp follow-ups, email sequences, segmentation) on new users from inside GHL workflows. Repurposes the existing GHL admin config (which currently has no signal source) by wiring it into the existing `trackMarketingEvent` `event_type='signup'` path. Graduates SEED-003 (Option C — repurpose as marketing-event sink).

**Why now:** SEED-003 review during v1.3 revealed the GHL admin in production today is functional but inert (no lead-source exists in the product). Owner confirmed they want to use GHL as the CRM for ALL Xareable users, not as a generic lead capture. Tagging on signup is the entire ask — downstream campaigns / segmentation / automation happen inside GHL itself.

**Target features:**
- On user signup, push contact to GHL with `email`, `firstName`/`lastName` (parsed from auth metadata if available), and tag `xareable` — via existing `getOrCreateGHLContact()` wrapper in `server/integrations/ghl.ts`
- Admin opt-in checkbox "Sync new signups to GHL" in the GHL card (defaults OFF — must be explicitly enabled before any sync happens)
- Best-effort push: GHL errors are swallowed; signup flow NEVER blocked, NEVER fails because of GHL. Failures recorded in `marketing_events.delivery_status.ghl` for ops visibility

**Explicitly out of scope (deferred to later milestones):**
- Other sync event types (first_generation, subscription_started, etc.) — just signup; downstream events handled inside GHL
- Bidirectional sync (GHL → Xareable) — never; this is push-only
- Custom field mappings beyond email/name/signup_date/tags — keep mapping minimal
- Backfill of existing users to GHL — out of scope; if needed, a one-shot script later
- GHL webhook receivers — not relevant for this scope
- Live E2E billing/ads validation harness — tracked in [SEED-002](seeds/SEED-002-live-e2e-billing-ads-validation.md)
- Fat file refactor — tracked in [SEED-004](seeds/SEED-004-fat-file-refactor.md)
- Manual human UAT for prior phases — owner-time-bounded

**System surface today (post v1.3):**
- All v1.1/v1.2 capabilities (media creation, trash, cron architecture, rate limiting, Error Boundary)
- Generation pipeline now emits structured logs to `generation_logs` for every `enforceExactImageText` and `ensureCaptionQuality` invocation — outcome union (pass/repair_triggered/repair_succeeded/repair_failed for text; pass/retry/repair/fallback for caption), `post_id`, `attempt_count`, `duration_ms`, JSONB metadata
- `logSubjectFidelityFailure` scaffold ready for any future detection signal (no call site yet — OBS-03 scaffolding-only)
- Dead caption helpers cleaned from `posts.routes.ts`; canonical `caption-quality.service.ts` is now the only source
- New error_type values available: `text_verification`, `caption_quality`, `subject_fidelity`

**System surface today (post v1.2):**
- All v1.1 media creation surfaces (image, carousel, enhancement) plus 30-day post trash window
- Per-user rate limiting (HTTP 429) on 5 paid AI endpoints with admin bypass
- SSE safety timer leak-free (`finally` cleanup); React Error Boundary on app root prevents blank-SPA crashes
- Production cron architecture wired for serverless (Vercel) AND long-running (Hetzner) deploys: HTTP-triggered endpoints with `CRON_SECRET` Bearer auth + GitHub Actions schedule; internal `node-cron` preserved for future Hetzner migration
- Cron verification harness (`scripts/verify-cron-jobs.ts`) — runtime validation of trash sweep, purge sweep, and overage batch against isolated test user
- Dependency hygiene: 5 dead session/auth packages removed; `@octokit/rest` relocated to devDeps

**System surface today:**
- Single-image post generator (Gemini text + image, brand-colored)
- Multi-slide Instagram carousel generator (3–8 slides, shared visual style, partial-success contract)
- Product-photo enhancement (admin-curated scenery catalog, EXIF strip, fail-closed pre-screen)
- Gallery with carousel/enhancement/draft tile rendering and slide viewer
- Posts trash with 30-day soft-delete window + 30-day purge, automated by server-side cron
- Stripe billing in two switchable models (`credits_topup` / `subscription_overage`) with weekly overage batch (also cron-scheduled)
- Admin surfaces: user management, scenery catalog CRUD, integrations (GHL/GA4/Facebook/Telegram), pricing controls

## Requirements

### Validated (v1.0 / v1.1)

- ✓ User can sign up and log in via email/password (Supabase Auth) — v1.0
- ✓ User can configure their Gemini API key in settings — v1.0 (later replaced by centralized platform key)
- ✓ User can complete brand onboarding (company name, colors, logo, mood) — v1.0
- ✓ User can generate a post from a text prompt (Gemini text + image pipeline) — v1.0
- ✓ User can view post history with generated images — v1.0
- ✓ User can edit an existing post (image regeneration with edit prompt) — v1.0
- ✓ User can transcribe voice input as post prompt — v1.0
- ✓ Admin can view platform stats and manage users — v1.0
- ✓ Server auth and security primitives reject malformed input correctly — v1.0 / Phase 1
- ✓ All Supabase client usage respects RLS policies (user-scoped vs admin) — v1.0 / Phase 2
- ✓ Post version management and admin queries are reliable at scale — v1.0 / Phase 3
- ✓ Client routing, auth state, error surfaces, and cache freshness are correct — v1.0 / Phase 4
- ✓ User can generate a multi-slide Instagram carousel from a single prompt — v1.1 (CRSL-01..10)
- ✓ User can enhance a raw product photo using admin-curated scenery presets — v1.1 (ENHC-01..08)
- ✓ Backend supports multi-slide posts and an `enhancement` content type end to end — v1.1 (SCHM-01..06)
- ✓ Billing correctly charges carousel × slide-count and enhancement as single-image cost — v1.1 (BILL-01..04)
- ✓ Creator UI and gallery surface carousels and enhancements consistently — v1.1 (CRTR-01..06, GLRY-01..05)
- ✓ Admin can manage scenery catalog with thumbnail upload, AlertDialog delete confirmation, inline activation toggle — v1.1 (ADMN-01..03)
- ✓ Five user-reported UX gaps in creator dialog closed (responsive thumbnails, hover preview, denser scenery grid, enhancement caption generation, localStorage draft auto-save) — v1.1 / Phase 09.1 (F1..F5)
- ✓ Posts trashed after 30-day expiration and auto-purged after 30 more days; user can restore or force-delete from `/trash` — v1.1 / Phase 11 (TRSH-01..06)
- ✓ Billing overage batch runs on cadence-driven cron schedule (`overage_billing_cadence_days`) with concurrency lock — v1.1 / Phase 12

### Validated (v1.2 — added 2026-05-08)

- ✓ AI endpoints reject excess requests with 429 instead of running unbounded (HARD-01) — v1.2 / Phase 13
- ✓ SSE safety timer always cleared even when error path throws (HARD-02) — v1.2 / Phase 13
- ✓ App-wide render error shows recovery UI instead of blank SPA (HARD-03) — v1.2 / Phase 13
- ✓ Unused server middleware packages removed; @octokit/rest moved to devDependencies (HARD-04) — v1.2 / Phase 13
- ✓ HTTP-triggered cron endpoints with CRON_SECRET auth (CRON-01, CRON-02) — v1.2 / Phase 14
- ✓ GitHub Actions workflow firing 6h cleanup + weekly overage on Vercel deploy (CRON-03) — v1.2 / Phase 14
- ✓ Architecture documentation explaining dual-trigger model (CRON-04) — v1.2 / Phase 14 (`docs/production-cron.md`, `Deployment & Cron` in CLAUDE.md, `Scheduled Operations` in ARCHITECTURE.md)
- ✓ Trash sweep, purge sweep, and overage batch verified against seeded test data (VRFY-01) — v1.2 / Phase 15

### Validated (v1.3 — added 2026-05-08)

- ✓ Exact-text verification outcomes (pass + repair triggers) logged from `text-rendering.service.ts` to `generation_logs` (OBS-01) — v1.3 / Phase 16
- ✓ Caption retry / repair / fallback outcomes logged from `caption-quality.service.ts` to `generation_logs` (OBS-02) — v1.3 / Phase 16
- ✓ Subject-fidelity logging scaffold (`logSubjectFidelityFailure` exported, no call site — ready when detection signal arrives) (OBS-03) — v1.3 / Phase 16
- ✓ Dead caption helper functions removed from `server/routes/posts.routes.ts`; `extractPromptField` preserved (OBS-04) — v1.3 / Phase 16

### Active (v1.4)

- [ ] On user signup, push contact to GHL with `email`, `firstName/lastName` (when available), tag `xareable` (GHL-01)
- [ ] Admin opt-in checkbox "Sync new signups to GHL" persisted in `integration_settings.ghl.sync_on_signup` (GHL-02)
- [ ] GHL push is best-effort: errors swallowed, signup never blocked; failures recorded in `marketing_events.delivery_status.ghl` (GHL-03)

### Out of Scope

- Mobile app — web-first, mobile deferred
- Real-time collaboration — single-user content creation
- Direct social media publishing — generation only, no OAuth to Instagram / Meta platforms
- Video generation in carousels — image-only carousels (re-evaluate in v2)
- Text overlays or logo composition on enhancements — clean product shot, not branded post
- User-uploaded custom sceneries — scenery catalog is admin-curated (re-evaluate in v2)
- Panoramic / spanning backgrounds across slides — anti-feature, fragile vs Instagram crop
- General-purpose photo editor (crop, rotate, filter) — enhancement is AI scenery, not editor

## Context

Brownfield project with existing codebase. Full-stack TypeScript monorepo: React 18 + Vite (frontend), Express 5 (backend), Supabase (PostgreSQL + RLS + Auth + Storage), Google Gemini REST API. Milestone v1.0 (Bug Fixes & System Hardening, 2026-04-20) closed 22 audit findings across security, auth, Supabase client correctness, data integrity, and frontend reliability. v1.1 added two new media creation surfaces (carousel, enhancement), a 30-day trash lifecycle for posts, and a cron-scheduled billing overage batch — all reusing v1.0's hardened patterns (SSE-streamed generation, shared auth middleware, admin-scoped Supabase operations, TanStack Query cache discipline, node-cron scheduler).

**Codebase scale (post v1.1):** ~28K insertions / ~7K deletions across 173 files since v1.1 start. Five known monoliths >1000 LOC remain (post-creator-dialog, admin.routes, integrations-tab, translations, stripe.ts) — tracked in [SEED-004](seeds/SEED-004-fat-file-refactor.md).

**Known accumulated tech debt entering v1.2:**
- 6 phases (5–9.1) have human UAT marked `human_needed` in their VERIFICATION.md but no `/gsd:verify-work` run
- Phase 11 (trash + cron) and Phase 12 (overage cron) have no human UAT — both run destructive operations in production
- Live E2E validation never run for Stripe (subscription/Connect/auto-recharge), GA4, or Facebook CAPI — tracked in [SEED-002](seeds/SEED-002-live-e2e-billing-ads-validation.md)

## Constraints

- **Tech Stack**: TypeScript, React, Express 5, Supabase, Gemini, node-cron — add new libraries only when strictly required
- **Language**: All planning docs, commit messages, code comments, and user-facing strings authored in English (PT/ES translations follow via dynamic translation system + static i18n keys)
- **Supabase**: RLS policies must be respected; admin operations use the service role client only
- **Auth**: All protected endpoints require `Authorization: Bearer <token>`; reuse shared auth middleware (`authenticateUser`, `getGeminiApiKey`, `usesOwnApiKey`)
- **Storage**: New assets follow `user_assets/{userId}/…` layout with thumbnails under `thumbnails/`
- **Billing**: Every paid generation path flows through `checkCredits` → `recordUsageEvent` → `deductCredits` so affiliate commissions, usage budgets, and overage accounting stay consistent
- **Cron — dual-trigger architecture**: same cron functions (`runTrashSweep`, `runPurgeSweep`, `runOverageBillingBatch`) invoked via TWO interchangeable paths. (a) **HTTP triggers via GitHub Actions** — active on Vercel (current production); endpoints `POST /api/internal/cleanup/{trash,purge}` + `POST /api/internal/billing/run-overage-batch` protected by `requireCronSecret` middleware. (b) **Internal `node-cron`** — active on long-running hosts (Hetzner, VPS, Railway), registered by `startCronJobs()` in `server/index.ts:httpServer.listen` callback. Vercel uses `api/handler.ts` entry, never invokes `server/index.ts`, so internal cron is dormant on serverless deploys. Both paths preserved in code; the active path is determined by deployment target. See [docs/production-cron.md](../docs/production-cron.md) and [.planning/codebase/ARCHITECTURE.md](codebase/ARCHITECTURE.md) "Scheduled Operations".

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| User-scoped vs admin Supabase client | User client respects RLS; admin bypasses it — wrong client causes silent failures | ✓ Good — standardized in v1.0 Phase 2 |
| Zod safeParse on all request bodies | Prevents processing malformed input | ✓ Good — pattern established in v1.0 |
| staleTime: Infinity global with per-page overrides | Reduces API calls; billing pages override to staleTime: 0 | ✓ Good — v1.0 Phase 4 |
| Reuse `/api/generate` patterns for new routes | SSE streaming, credit gating, and admin-storage uploads are battle-tested | ✓ Good — confirmed in v1.1 |
| Extend `content_type` enum vs new tables per media type | Single discriminator keeps gallery, billing, and storage code paths shared | ✓ Good — locked as 4-value CHECK in v1.1 Phase 5 |
| Scenery catalog stored in `platform_settings` row | Reuses existing key/value JSONB store and `getStyleCatalogPayload()` cache path | ✓ Good — v1.1 Phase 5 |
| `post_slides` as dedicated table with RLS | Enables per-row ownership checks, clean storage cleanup via triggers, future per-slide regeneration | ✓ Good — v1.1 Phase 5 |
| Carousel/enhancement as isolated service modules (no routes/SSE/express imports) | D-15 seam: routes own SSE streaming and request lifecycle; services expose pure `onProgress` callback — decouples testability from HTTP | ✓ Good — v1.1 Phase 6 |
| `checkCredits(slideCount?)` additive optional param | Backwards-compat: all 5 existing callers unchanged, operationType union frozen at 3 values | ✓ Good — v1.1 Phase 6 |
| `node-cron` over pg_cron for scheduled jobs | Self-contained, no Supabase dashboard config dependency, consistent with Express service architecture | ✓ Good — v1.1 Phase 11 (extended in Phase 12) |
| Two-stage trash (soft-delete → 30d → permanent) instead of hard-delete on expiration | Recoverability for accidental user deletes; matches industry standard (Gmail, GitHub) | ✓ Good — v1.1 Phase 11 |
| Manual cleanup endpoints kept (TRSH-06 / `/api/internal/billing/run-overage-batch`) | Admin escape hatch for support investigations and missed-tick recovery | ✓ Good — v1.1 Phase 11 + 12 |
| In-process boolean lock for cron concurrency | Simpler than DB-backed lock; sufficient for single-instance deploys; documented as constraint | ⚠️ Revisit if multi-instance deployment | v1.1 Phase 12 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-08 — v1.4 GHL Signup Sync started (graduates SEED-003 with Option C — repurpose GHL admin as marketing-event sink, scoped to signup-only).*
