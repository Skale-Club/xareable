# Milestones

## v1.4 GHL Signup Sync (Shipped: 2026-05-16)

**Phases completed:** 1 phase, 1 plan, 4 tasks
**Git range:** v1.3..v1.4 (~8 commits)

**Key accomplishments:**

- `sync_on_signup` boolean column added to `integration_settings` via additive migration `20260508203515_integration_settings_sync_on_signup.sql`. Stored as a first-class column (not JSONB) for clean querying and future indexing. Zod schemas (`adminGHLStatusSchema`, `saveGHLSettingsRequestSchema`) extended with the new field.
- `fanGHLSignup()` helper wired into `POST /api/telegram/notify-signup` as a fire-and-forget fan-out branch — runs after the existing telegram path, never blocking it. Gates on `enabled && sync_on_signup && api_key && location_id`. Calls existing `getOrCreateGHLContact()` (sealed, unchanged) with `tags: ["xareable"]`.
- All four delivery outcomes (settings-read-failed, skipped, sent, failed) write to the existing `integration_delivery_logs` table with `integrationType: "ghl"` — zero new schema, identical observability surface to the telegram branch.
- Admin UI: `ghlSyncOnSignup` state + Switch component added to the GHL card in `integrations-tab.tsx`. Hydrates from GET `/api/admin/ghl`, persists via PATCH `/api/admin/ghl`. No page reload required — existing `queryClient.invalidateQueries` handles round-trip.
- `scripts/verify-phase-17.ts` — 20-check static harness covering migration, Zod, server wiring, and admin UI. Re-runnable on any future commit. All 20 checks pass.

---

## v1.3 Generation Quality Observability (Shipped: 2026-05-08)

**Phases completed:** 1 phase, 1 plan, 5 tasks
**Git range:** v1.2..HEAD (~11 commits)

**Key accomplishments:**

- `generation_logs` table extended with 6 first-class columns (`post_id`, `event_kind`, `outcome`, `attempt_count`, `duration_ms`, `metadata`) via additive migration `20260508000000_generation_logs_observability.sql`. `error_type` left as unconstrained TEXT to avoid retro-breaking existing rows; type-narrowing for new OBS values lives in Zod (`generationLogSchema`) + TypeScript signatures. Migration applied in production via `supabase db push --db-url <session-pool-url-port-5432>`.
- New `server/services/observability.service.ts` (3 best-effort emitters): `logTextVerification` (OBS-01), `logCaptionQuality` (OBS-02), `logSubjectFidelityFailure` (OBS-03 — exported but ZERO call sites this phase per scaffolding-only invariant). All wrap `createAdminSupabase().insert()` in try/catch with error-swallowing — logging failures NEVER block, fail, or alter generation flow.
- `server/services/text-rendering.service.ts:enforceExactImageText` instrumented with single-emit-per-invocation logging across 3 exit paths (empty-text early return, success-after-pass, exhausted-passes). Outcome union maps cleanly: `pass` / `repair_succeeded` / `repair_failed`. SHA-256 hash of expected text persisted; never per-pass logging.
- `server/services/caption-quality.service.ts:ensureCaptionQuality` instrumented with single-emit-per-invocation logging across 5 exit paths (candidate-acceptable, firstPass, secondPass, repaired, fallback). Outcome union: `pass` / `retry_triggered` / `repair_triggered` / `fallback_used`.
- `server/routes/posts.routes.ts` cleanup: 4 dead duplicate caption helpers removed (`looksTruncatedCaption`, `hasHashtags`, `isAcceptableCaption`, `buildCaptionFallback` — already canonical in `caption-quality.service.ts`). `extractPromptField` PRESERVED (3 use sites in remake-caption endpoint, no service equivalent).
- `scripts/verify-phase-16.ts` runtime harness — 30 static checks + 1 dynamic round-trip (insert → read → delete via service-role Supabase) with auto-skip when env vars absent (CI-friendly). Live run with production Supabase credentials confirmed: schema match, all three emitters produce well-formed rows, error swallowing works.

---

## v1.2 Production Hardening (Shipped: 2026-05-08)

**Phases completed:** 3 phases, 5 plans, 15 tasks
**Git range:** v1.1..HEAD (~30 commits)

**Key accomplishments:**

- Per-user HTTP 429 rate limiting on 5 paid AI endpoints via `express-rate-limit` + per-user keying + admin bypass, plus SSE `safetyTimer` cleanup migrated into `finally` blocks across all 4 SSE routes (Phase 13: HARD-01, HARD-02)
- App-root React Error Boundary class component with Retry / Go home recovery UI and PT/ES translations, plus removal of 5 dead session/auth deps (`passport`, `passport-local`, `express-session`, `connect-pg-simple`, `memorystore`) + 4 `@types/*` and relocation of `@octokit/rest` to `devDependencies` (Phase 13: HARD-03, HARD-04)
- HTTP-triggered cron architecture wired for Vercel: new `requireCronSecret` middleware (`crypto.timingSafeEqual` + 401/503 split) protecting 3 internal POST endpoints (`/api/internal/cleanup/{trash,purge}` + `/api/internal/billing/run-overage-batch`); legacy `runAdminGuard` handler moved from `billing.routes.ts:649` with auth swap (Phase 14: CRON-01, CRON-02)
- `.github/workflows/cron.yml` GitHub Actions schedule firing cleanup-sweep every 6h + overage-batch weekly Sunday 00:00 UTC; `node-cron` infrastructure preserved untouched so future Hetzner migration is a config flip (Phase 14: CRON-03, CRON-04)
- Runtime verification harness `scripts/verify-cron-jobs.ts` (762 LOC) exercising trash sweep, purge sweep, and overage batch (Mode A always; Mode B Stripe `sk_test_*` gated) against an isolated test user — live run exits 0 with 3 passed / 0 failed / 1 skipped; closes VRFY-01 (Phase 15)
- Cron triggers ACTIVATED in production — `CRON_SECRET` set in Vercel + GitHub Actions secrets (`PROD_BASE_URL` + `CRON_SECRET`) configured via `vercel env add` + `gh secret set`; smoke-tested via `curl` (401/401/200/200 expected pattern; trash + purge endpoints respond in <1.3s)
- Architecture documentation: new `docs/production-cron.md` runbook, `Deployment & Cron` section in CLAUDE.md, "Scheduled Operations" section in `.planning/codebase/ARCHITECTURE.md`, cron concern marked RESOLVED in CONCERNS.md, `cleanup-cron.service.ts` header explaining dual-trigger model

---

## v1.1 Media Creation Expansion (Shipped: 2026-05-08)

**Phases completed:** 9 phases, 26 plans, 46 tasks

**Key accomplishments:**

- SceneriesCard admin UI delivers full CRUD over scenery presets via responsive card grid with thumbnail upload to Supabase Storage, AlertDialog delete confirmation, and inline is_active toggle — wired into PostCreationTab through the existing PATCH /api/admin/style-catalog save path
- en dictionary stays empty:
- Enhancement branch fully wired: JPEG/PNG/WEBP upload with 5MB guard, base64 FileReader encoding, responsive scenery picker grid from activeSceneries, UUID idempotency_key POST to /api/enhance via fetchSSE, and openViewer handoff on SSE complete (D-20)
- Auto-save creator dialog state to localStorage with 500ms debounce, 7-day TTL, and Continue/Start fresh banner restore UI for all content types (image, video, carousel, enhancement)
- postGalleryItemSchema extended with slide_count (number | null) and status (string, default "generated") so downstream gallery tiles can render carousel count badges and draft status indicators
- Gallery tiles now distinguish carousel (deck-stack + Carousel·N badge), enhancement (violet Enhanced badge), and draft carousels (orange Draft badge) with a TypeScript exhaustiveness guard ensuring future content_type values force a compile error
- Carousel slide viewer with post_slides fetch + prev/next + ArrowLeft/ArrowRight keyboard nav added to PostViewerDialog; markCreated() now fires on carousel SSE error path so partial-draft carousels appear in gallery without page reload
- Third cron job added to startCronJobs() invoking runOverageBillingBatch() on a cadence-derived expression (1d/7d/30d → daily/weekly/monthly cron) with in-process boolean lock preventing overlapping invocations

---
