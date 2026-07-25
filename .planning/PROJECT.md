# Xareable

## What This Is

AI-powered social media content creation SaaS platform. Users connect their brand identity (colors, logo, mood), describe what they want to post, and the platform uses Google Gemini to generate a complete post — single image, multi-slide carousel, or professionally enhanced product photo — ready to publish. Target audience is small businesses and creators who want consistent, on-brand social media presence without a design team.

## Core Value

Users can generate on-brand visual content (single posts, multi-slide carousels, and professionally enhanced product photos) in seconds from a prompt or a reference image — and recover any post they accidentally delete within a 30-day trash window.

## Current State

**Last shipped:** v1.5 Brand Style References (2026-05-16; merge reconciliation completed 2026-05-18)

**Active milestone:** v1.6 Professional Design Quality Overhaul + OpenRouter Gateway (started 2026-07-18)

## Current Milestone: v1.6 Professional Design Quality Overhaul + OpenRouter Gateway

**Goal:** Rebuild the generation pipeline so output has professional-designer quality — moving quality-critical work OUT of the AI models into deterministic, verifiable server-side layers — on top of a single unified AI gateway (OpenRouter) that replaces direct Gemini/OpenAI API calls for text, image, and transcription.

**Why now:** Deep end-to-end analysis (2026-07-18 session, covering generate/carousel/video/enhancement/billing) identified the root causes of "AI-looking" output: AI-rendered pixel typography, a blind/underpowered art-director text call, one-liner aesthetic direction, no visual quality gate, and lossy post-processing. The tool's entire value proposition is designer-grade output; today's pipeline structurally cannot deliver it. Simultaneously, consolidating on OpenRouter unifies model selection, keys, and per-request real cost — eliminating the per-provider pricing-table drift found in billing.

**Target features (pillars):**

*P0 — foundation:*
- **OpenRouter gateway**: ALL AI calls (text/planning, image generation, transcription) routed through OpenRouter; provider abstraction becomes model selection through one gateway; unified keys (platform + admin/affiliate BYO keys become OpenRouter keys); real per-request cost consumed by billing
- **Deterministic typography**: images generated text-free (with reserved negative space) + headline/support/CTA composited server-side with real fonts via sharp/SVG — eliminates the verify/repair loop entirely
- **Art director fixed**: reference images actually attached to the planning call, higher-tier planning model, structured outputs (json_schema), structured-prompt precedence corrected, output token budget scaled to slide count
- **Surgical fixes**: `break` on carousel slide-1 failure; `isVideo` flag on video-edit credit gate

*P1 — raising the average:*
- Dense aesthetic DNA: style catalog upgraded from one-liners to professional art direction (photography type, lighting, palette usage 60-30-10 with named colors, global anti-AI-look negative prompts) + platform-curated style reference boards
- Multimodal visual critic with automatic re-roll on low score (composition, legibility, color harmony, unwanted-text detection)
- Narrative carousels: per-slide composition variation + on-slide text via deterministic overlay
- Generation parameters (aspect, resolution, duration) persisted on posts; timers/AbortSignal aligned to Coolify long-running host; idempotency on generate/edit routes

*P2 — polish & hygiene:*
- WebP q85+, logo overlay with contrast treatment (plate/shadow, adaptive corner), post-generation crop for non-native aspect ratios, API keys via headers only, thumbs up/down feedback loop on posts

**Explicitly out of scope (deferred):**
- **Video pipeline changes — FROZEN this milestone.** Veo is not available on OpenRouter; video stays on the direct Google API untouched. Only the `isVideo` billing-gate fix lands. Video gateway/model decision (Veo direct vs OpenRouter video model) deferred to a future milestone.
- Video remake parameter persistence / logo watermark via ffmpeg — follows the video freeze
- Enhancement pipeline redesign — pre-screen/scenery flow stays as-is (only inherits the OpenRouter call layer)
- ffmpeg-based processing of any kind
- Live E2E billing/ads validation harness — tracked in [SEED-002](seeds/SEED-002-live-e2e-billing-ads-validation.md)
- Fat file refactor — tracked in [SEED-004](seeds/SEED-004-fat-file-refactor.md)

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

### Validated (v1.4 — added 2026-05-16)

- ✓ On user signup, push contact to GHL with `email`, `firstName/lastName` (when available), tag `xareable` (GHL-01) — v1.4 / Phase 17
- ✓ Admin opt-in checkbox "Sync new signups to GHL" persisted in `integration_settings.sync_on_signup` (GHL-02) — v1.4 / Phase 17
- ✓ GHL push is best-effort: errors swallowed, signup never blocked; delivery logged to `integration_delivery_logs` (GHL-03) — v1.4 / Phase 17

### Validated (v1.5 — shipped 2026-05-16)

- ✓ DB schema: `brand_reference_photos` table + `brands.style_description`; Zod schemas + types (REF-01) — v1.5 / Phase 18
- ✓ API: list / upload (5 MB, 10-photo cap) / delete brand reference photos + style description save (REF-02..05) — v1.5 / Phase 18
- ✓ Settings UI: "Style" tab with reference photo grid + style description textarea (SET-01..02) — v1.5 / Phase 19
- ✓ Creator dialog "Use my style references" toggle + server-side injection into image generation (user photos take 4-slot priority) (GEN-01..02) — v1.5 / Phase 20

### Validated (v1.1 late additions — shipped 2026-05-17/18)

- ✓ Pluggable image provider abstraction (Gemini default, OpenAI Responses API alternative) with admin/affiliate provider preference (PROV-01..07) — v1.1 / Phase 12 + 12.1–12.3
- ✓ Carousel quick-remake + per-slide Edit Image with `post_slide_versions` history (CRSL-EDIT-01..07) — v1.1 / Phase 12.6

### Active (v1.6)

Being defined — see `.planning/REQUIREMENTS.md` (requirements scoping in progress, 2026-07-18).

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
- **Cron — dual-trigger architecture**: same cron functions (`runTrashSweep`, `runPurgeSweep`, `runOverageBillingBatch`) invoked via TWO interchangeable paths. (a) **HTTP triggers via GitHub Actions** — was active on Vercel (former production; workflow now disabled — production is Coolify/Hetzner since 2026-05-30); endpoints `POST /api/internal/cleanup/{trash,purge}` + `POST /api/internal/billing/run-overage-batch` protected by `requireCronSecret` middleware. (b) **Internal `node-cron`** — active on long-running hosts (Hetzner, VPS, Railway), registered by `startCronJobs()` in `server/index.ts:httpServer.listen` callback. Vercel uses `api/handler.ts` entry, never invokes `server/index.ts`, so internal cron is dormant on serverless deploys. Both paths preserved in code; the active path is determined by deployment target. See [docs/production-cron.md](../docs/production-cron.md) and [.planning/codebase/ARCHITECTURE.md](codebase/ARCHITECTURE.md) "Scheduled Operations".

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
*Last updated: 2026-07-18 — v1.6 Professional Design Quality Overhaul + OpenRouter Gateway started. v1.5 requirements moved to Validated. Production is Coolify/Hetzner (xareable.com) since 2026-05-30.*
