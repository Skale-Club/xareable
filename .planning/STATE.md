---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Brand Style References
status: completed
stopped_at: "v1.5 shipped 2026-05-16; merges with origin/dev (2026-05-17) and origin/main (2026-05-18) reconciled — Phase 12 = image provider, Phase 12.5 = overage cron, Phase 12.6 = carousel quick-remake/per-slide edit"
last_updated: "2026-05-18T11:30:00.000Z"
last_activity: 2026-05-18 — merge of origin/main reconciled (Phase 13 carousel quick-remake folded in as Phase 12.6 under v1.1)
progress:
  total_phases: 22
  completed_phases: 22
  total_plans: 55
  completed_plans: 55
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18 after origin/main merge reconciliation)

**Core value:** Users can generate on-brand visual content (single posts, carousels, enhancements) in seconds and recover deletions within a 30-day trash window.
**Current focus:** No active milestone. Run `/gsd:new-milestone` to plan v1.6.

## Current Position

Phase: All shipped through Phase 20 + decimal inserts (09.1, 12.5, 12.6)
Plan: —
Status: All v1.x milestones complete; awaiting next milestone
Last activity: 2026-05-18 — merge reconciliation (origin/main) complete

Progress: [██████████] 100% (all 22 phases / 55 plans complete)

## Merge Reconciliation Note (2026-05-17)

This branch (`dev`) was 102 commits ahead of `origin/dev` while `origin/dev` had 35 commits of independent work (Phase 12 image provider abstraction track + decimal patches 12.1, 12.2, 12.3, 12-audit, plus UI polish + gitleaks security). The merge preserved BOTH streams. Resolution decisions:

1. **Phase 12 ambiguity resolved by renumbering:**
   - **Phase 12** (canonical) = origin/dev's "Image Provider Abstraction (OpenAI gpt-image-2 alternative)" — 5 plans, 7 PROV requirements, 4 decimal patches, shipped 2026-05-17
   - **Phase 12.5** (decimal insert) = local's "Schedule billing overage batch via existing cleanup-cron service" — graduated SEED-001, shipped 2026-05-08. Renamed from `12-schedule-...` to `12.5-schedule-billing-overage-batch` on disk.
2. **Code conflicts unioned**, not replaced:
   - `package.json`: added `openai` (their image provider), kept `passport`/etc removed (Phase 13 HARD-04 sealed)
   - `carousel.routes.ts`, `enhance.routes.ts`: both `aiRateLimit` (mine) AND `getActiveImageProvider` (theirs) imported
   - `generate.routes.ts`: `imageApiKey` (theirs, provider-aware) + `mergedReferenceImages` (mine, Phase 20 brand refs) — both correct
   - `translations.ts`, `settings.tsx`: union of all new strings/handlers from both sides
3. **Original migration sealed.** New migrations from both sides applied additively. `npm run check` exits 0 post-merge.

## Merge Reconciliation Note (2026-05-18)

After pushing the 2026-05-17 merge to `origin/dev`, `origin/main` was found to be 20 commits ahead with an independent Phase 13 implementing **carousel quick-remake and per-slide Edit Image**. To preserve both Phase 13s without losing data:

1. **Phase 13 ambiguity resolved by renumbering:**
   - **Phase 13** (canonical for v1.2) = dev's "Production Hardening Fixes" — preserved.
   - **Phase 12.6** (decimal insert under v1.1) = origin/main's "Carousel Quick Remake & Per-Slide Edit Image" — 5 plans, 7 CRSL-EDIT requirements, depends on Phase 12 image provider (slide-1-as-reference style consistency works through `provider.edit()` for both Gemini and OpenAI). Folder renamed from `.planning/phases/13-carousel-quick-remake-and-edit-image/` to `.planning/phases/12.6-carousel-quick-remake-and-edit-image/`. Shipped 2026-05-18.
2. **Code conflicts unioned via 3-way auto-merge** in `App.tsx`, `lib/translations.ts`, `server/routes/carousel.routes.ts`, `shared/schema.ts`. Manual resolution only in `.planning/ROADMAP.md` and `.planning/STATE.md` (this file).
3. **Additive migrations only.** `20260518000000_post_slide_versions.sql` (post_slide_versions table + RLS + unique index) ships alongside Phase 20 brand-reference migration without conflict.
4. **`scripts/verify-phase-13.ts`** (origin/main, carousel quick-remake checks) does NOT collide with my dev's `scripts/verify-phase-13.ts` (Production Hardening checks) — verified during merge that both files only exist on one side. Renamed origin/main's to `scripts/verify-phase-12.6.ts` post-merge.

## Phase Summary (unified post-merge)

| Phase | Milestone | Plans | Verification | Status |
|-------|-----------|-------|--------------|--------|
| 01-04 | v1.0 | 8 | — | Complete (2026-04-20) |
| 05-11 | v1.1 | 22 | varies | Complete |
| 12 (Image Provider Abstraction) | v1.1 | 5 | PASS 36/36 | Complete (2026-05-17) |
| 12.1, 12.2, 12.3 (decimal patches) | v1.1 | — | — | Complete |
| 12-audit | v1.1 | — | — | Complete |
| 12.5 (Schedule billing overage batch — SEED-001) | v1.1 | 1 | — | Complete (2026-05-08) |
| 12.6 (Carousel Quick Remake & Per-Slide Edit Image) | v1.1 | 5 | static PASS, UAT pending | Complete (2026-05-18) |
| 13. Production Hardening Fixes | v1.2 | 2 | PASS 13/13 | Complete (2026-05-08) |
| 14. Wire production crons via HTTP triggers | v1.2 | 2 | PASS 7/7 | Complete (2026-05-08) |
| 15. Cron Verification Harness | v1.2 | 1 | PASS 7/7 | Complete (2026-05-08) |
| 16. Generation Pipeline Observability | v1.3 | 1 | PASS 5/5 | Complete (2026-05-08) |
| 17. GHL Signup Sync (Wire-Up) | v1.4 | 1 | verified | Complete (2026-05-16) |
| 18. Data Layer + API Endpoints | v1.5 | 3 | PASS | Complete (2026-05-16) |
| 19. Settings UI — Style Tab | v1.5 | 1 | PASS | Complete (2026-05-16) |
| 20. Generation Integration | v1.5 | 1 | PASS | Complete (2026-05-16) |

## Performance Metrics

**v1.1, v1.2, v1.3, v1.4, v1.5 all archived in `.planning/milestones/`.**

| Phase / Plan | Duration | Tasks | Files | Notes |
|--------------|----------|-------|-------|-------|
| Phase 10 P03 | 30 | 3 tasks | 3 files | gallery |
| Phase 10 P04 | 22 | 2 tasks | 2 files | viewer + markCreated |
| Phase 11 P01 | 12 | 3 tasks | 5 files | trash schema |
| Phase 11 P04 | 25 | 3 tasks | 4 files | trash UI |
| Phase 12 P04 | 12 | 3 tasks | 6 files | image provider |
| Phase 12 P05 | 12 | 3 tasks | 5 files | image provider final |
| Phase 12.6 P02 | 25 | 2 tasks | 2 files | slide-edit route |
| Phase 12.6 P03 | 15 | 1 task  | 1 file  | PostEditDialog carousel-slide variant |
| Phase 12.6 P04 | 20 | 2 tasks | 2 files | viewer Edit/Quick-Remake wiring |
| Phase 12.6 P05 | 15 | 3 tasks | 3 files | i18n + UAT + provider parity |
| Phase 18 P01 | 5 | 2 tasks | 2 files | brand reference schema |
| Phase 18 P02 | 10 | 2 tasks | 2 files | brand reference API |
| Phase 18 P03 | 5 | 2 tasks | 1 files | verify-phase-18 |
| Phase 19 P01 | 25 | 4 tasks | 2 files | Style tab UI |
| Phase 20 P01 | 25 | 4 tasks | 4 files | generation injection |

## Accumulated Context

### Decisions (unified from all branches)

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

**v1.1 carousel/enhancement track (Phases 5-11):**
- [Phase 05]: Zod enum extension and RLS policy structure reuse v1.0 patterns — no research phase needed
- [Phase 06]: Sequential slide generation (not parallel) — IPM rate limits LOW confidence; fallback documented
- [Phase 06]: thoughtSignature multi-turn + single-turn fallback pattern for style consistency
- [Phase 06]: ensureCaptionQuality called once after slide loop, never per-slide (CRSL-09)
- [Phase 06]: Enhancement pre-screen fail-closed — non-2xx/non-JSON → PreScreenUnavailableError, no image call
- [Phase 07]: Checked out Phase 5/6 dependency files from main branch into worktree (Rule 3 deviation)
- [Phase 07]: contentLanguage hardcoded to 'en' in enhance.routes.ts — enhanceRequestSchema deliberately omits content_language in v1.1
- [Phase 07]: No prefix argument on router.use() for carousel and enhance — flat-mount pattern matches existing routes
- [Phase 10]: t() only accepts 1 arg; t(key).replace('{n}', String(value)) used for param interpolation
- [Phase 10]: assertNever default branch provides GLRY-04 exhaustiveness guard at compile time
- [Phase 10-04]: Carousel branch added inside existing PostViewerDialog; two-path GLRY-05 (SSE onError + catch-block else both call markCreated)
- [Phase 11]: Skip Drizzle db:push for Supabase-native migrations; apply via Supabase dashboard SQL editor
- [Phase 11]: trashed_at soft-delete filter applied only to primary gallery queries
- [Phase 11]: verify-phase-11.ts storage-before-DB check uses indexOf comparison pattern

**Phase 12 — Image Provider Abstraction (origin/dev track):**
- [Phase 12]: OpenAIImageProvider stub added in 12-03 for TypeScript compilation; 12-02 full Responses API implementation replaces at merge
- [Phase 12]: thoughtSignature multi-turn pattern dropped at provider abstraction boundary — slides 2..N use provider.edit() with slide-1 buffer as currentImage for style consistency (works for both Gemini and OpenAI)
- [Phase 12]: callEnhancementImageModel deleted entirely — provider.edit() replaces it inline; no dead code path
- [Phase 12]: imageApiKey separate optional param in carousel/enhancement params — text-model calls use apiKey (Gemini), image calls use imageApiKey when provider != gemini
- [Phase 12]: ImageProviderSection rendered in admin.tsx settings tab (alongside AppSettingsTab) — minimal surgery, provider config belongs with app settings
- [Phase 12]: openai_api_key supabase update on single line in settings.tsx to match PROV-06 regex; direct supabase update (no server route) mirrors api_key pattern

**Phase 12.5 — Schedule billing overage batch (graduated SEED-001):**
- [Phase 12.5]: runOverageBillingBatch wired into startCronJobs via single cron.schedule registration — follows Phase 11 + 12 trash sweep pattern; SEED-001 marker resolved.

**Phase 12.6 — Carousel Quick Remake & Per-Slide Edit Image (was origin/main's Phase 13):**
- [Phase 12.6]: No storage cleanup trigger in post_slide_versions migration — ON DELETE CASCADE from post_slides handles row cleanup automatically
- [Phase 12.6]: editSlideRequestSchema reuses editPostRequestSchema.shape.edit_context to stay in lockstep with single-image edit schema evolution
- [Phase 12.6]: Caption regeneration skipped for slide-level edits — carousel caption is master-text scoped (CRSL-09)
- [Phase 12.6]: post_slides.image_url updated to latest version (latest-wins); prior URL preserved in post_slide_versions
- [Phase 12.6-03]: carouselEditContext strips text_mode/replacement_text/text_style_ids — CRSL-10 compliance; single handleGenerateEdit function with isCarouselSlide branch (Option A)
- [Phase 12.6-04]: fetchSSE auth handled internally via getAuthHeaders() — no token param needed in viewer's carousel quick-remake branch
- [Phase 12.6-04]: Per-slide version navigation UI deferred to v2 — CRSL-V2-01 scope; carousel slides show only latest version inline
- [Phase 12.6-05]: CRSL-EDIT-02 + CRSL-EDIT-07 excluded from static verify — require live UI/billing; covered by 12.6-UAT.md operator sign-off

**v1.2 — Production Hardening (Phases 13-15):**
- [Phase 13]: Used express-rate-limit library over extending in-memory Map pattern from translate.routes.ts (typed, IETF draft-7 headers, single-source admin bypass via skip)
- [Phase 13]: Inline limiter invocation (await new Promise(resolve => limiter(req,res,resolve))) over middleware-chain conversion — preserves existing inline authenticateUser pattern in all 5 paid AI routes
- [Phase 13]: try/finally (no outer catch) for carousel + enhance safetyTimer cleanup — preserves existing inner try/catch error semantics
- [Phase 13]: ErrorBoundary placed inside LanguageProvider, outside AuthProvider — useTranslation works in recovery UI AND AuthProvider init errors are caught
- [Phase 13]: Removed 5 dead session/auth deps + 4 @types and relocated @octokit/rest to devDependencies
- [Phase 14]: Wired cleanup-cron HTTP triggers via .github/workflows/cron.yml + Vercel `CRON_SECRET` env — Hetzner internal-cron path preserved unchanged
- [Phase 15]: verify-cron-jobs.ts harness exits 0 against real Supabase; SK_TEST_* gated Mode B for Stripe live path

**v1.3 — Generation Observability (Phase 16):**
- [Phase 16]: extended generation_logs with 6 first-class columns + 3 enum values; original migration sealed; first-class columns chosen over JSONB for query-friendliness
- [Phase 16]: observability.service.ts emits via createAdminSupabase().insert() wrapped in try/catch — best-effort logging, never blocks gen flow

**v1.4 — GHL Signup Sync (Phase 17):**
- [Phase 17]: fanGHLSignup extracted as module-scope helper — GHL runs regardless of telegram exit path, signup never blocked, fire-and-forget best-effort
- [Phase 17]: sync_on_signup stored as boolean column on integration_settings (not JSONB) — clean schema, additive migration, query-friendly

**v1.5 — Brand Style References (Phases 18-20):**
- [v1.5 roadmap]: Phase 18 delivers full server-side data contract (DB + RLS + 4 endpoints + Zod) before any UI is built
- [v1.5 scope]: Style description injected into image gen only (not text gen). Carousel and enhancement routes excluded in v1.5. Drag-to-reorder deferred. Single-image pipeline only.
- [v1.5 AI integration]: Brand reference photos fetched server-side at generation time. User-provided inline images take priority in Gemini's 4-slot limit. Brand references fill remaining slots. use_brand_references flag is ephemeral per-generation (not persisted).
- [Phase 18]: user_id stored denormalized on brand_reference_photos for O(1) RLS check; UPDATE policy included for future drag-to-reorder; brandReferencePhotoSchema.photo_url is z.string() not .url() (read model only)
- [Phase 18]: No multer/multipart — POST body is JSON { photo_url: string, position?: number }; client uploads directly to Supabase Storage
- [Phase 18]: 10-photo cap enforced server-side via count query before insert (non-atomic, acceptable for v1.5)
- [Phase 19]: Direct queryClient import from @/lib/queryClient (not useQueryClient hook) for cache invalidation
- [Phase 19]: styleDescription sync merged into existing [brand] useEffect
- [Phase 20]: !isVideo guard in merge block prevents brand reference injection on video generation
- [Phase 20]: use_brand_references: undefined treated as true on server (opt-out pattern, not opt-in)
- [Phase 20]: Type split maintained: mergedReferenceImages.map(img => img.data) for generateText (string[]), raw objects for generateVideo/generateImageAsset

**Merge reconciliation (2026-05-17):**
- [Merge]: Phase 12 (image provider) kept canonical integer; Phase 12.5 (overage cron) renamed with decimal — preserves both tracks
- [Merge]: package.json union — added openai, kept passport removed (Phase 13 sealed)
- [Merge]: generate.routes.ts conflict resolved by combining imageApiKey (provider-aware, theirs) with mergedReferenceImages (brand refs, mine)

**Merge reconciliation (2026-05-18 — origin/main fold-in):**
- [Merge]: origin/main's parallel "Phase 13" (carousel quick-remake) renamed to **Phase 12.6** to preserve dev's Phase 13 (Production Hardening) as canonical v1.2 integer. Folder renamed `13-carousel-quick-remake-and-edit-image/` → `12.6-carousel-quick-remake-and-edit-image/`.
- [Merge]: origin/main's `scripts/verify-phase-13.ts` (carousel checks) renamed to `scripts/verify-phase-12.6.ts` to avoid clash with dev's `scripts/verify-phase-13.ts` (Production Hardening checks).
- [Merge]: ROADMAP/STATE manually resolved; code files (App.tsx, translations.ts, carousel.routes.ts, shared/schema.ts) auto-merged cleanly.

### Roadmap Evolution

- 2026-04-21: v1.1 milestone started (Media Creation Expansion)
- 2026-05-07: Phase 11 complete (trash + cleanup-cron)
- 2026-05-08: v1.2 milestone shipped (Phases 13-15 — Production Hardening). v1.3 milestone shipped (Phase 16). Phase 12.5 (SEED-001 graduation) completed.
- 2026-05-16: v1.4 milestone shipped (Phase 17 — GHL Signup Sync). v1.5 milestone shipped (Phases 18-20 — Brand Style References).
- 2026-05-17: origin/dev's parallel Phase 12 (Image Provider Abstraction) shipped + 4 decimal patches (12.1-12.3, 12-audit). v1.1 closed with image provider as canonical Phase 12. Merge reconciliation — both branches unified; Phase 12 = image provider, Phase 12.5 = overage cron (decimal insert).
- 2026-05-18: origin/main's parallel "Phase 13" (carousel quick-remake + per-slide edit) folded in as Phase 12.6 — depends on Phase 12 image provider. v1.1 re-closed with 12.6 added.

### Pending Todos

None.

### Blockers/Concerns

- Seven prior phases (5–9.1, 11, 12, 12.5, 12.6, 17) carry `human_needed` UAT debt — owner-time-bounded. Run `/gsd:audit-uat` to review.
- Live E2E billing/ads validation harness — tracked in SEED-002. Deferred.
- Fat file refactor — tracked in SEED-004. Deferred.
- Post-merge: `npm run check` exits 0 but `npm run build` not yet validated end-to-end. Run before next deploy.

## Session Continuity

Last session: 2026-05-18T11:30:00.000Z (origin/main merge reconciliation)
Stopped at: `dev`, `origin/dev`, and `origin/main` reconciled — 2 conflict files resolved (ROADMAP, STATE); code unioned; Phase 12.6 folder + verify script renamed.
Next action: `git commit` the merge, push to `origin/dev`, then `/gsd:audit-uat` or `/gsd:new-milestone` v1.6
Resume file: None
