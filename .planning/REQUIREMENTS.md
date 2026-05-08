# Requirements: My Social Autopilot — v1.2 Production Hardening

**Defined:** 2026-05-08
**Core Value:** Users can generate on-brand visual content (single posts, multi-slide carousels, and professionally enhanced product photos) in seconds from a prompt or a reference image — and recover any post they accidentally delete within a 30-day trash window.
**Milestone Goal:** Close the highest-risk production gaps accumulated through v1.0 + v1.1 — security (rate limiting), reliability (SSE timer leak, Error Boundary), verification of destructive cron operations, and dependency hygiene.

## v1.2 Requirements

Each requirement maps to exactly one phase. The roadmapper assigns phase numbers.

### Hardening (HARD)

Production-code fixes for known security, reliability, and hygiene gaps documented in `.planning/codebase/CONCERNS.md`.

- [x] **HARD-01**: All paid AI endpoints (`POST /api/generate`, `POST /api/edit-post`, `POST /api/transcribe`, `POST /api/carousel/generate`, `POST /api/enhance`) enforce per-user rate limits. An authenticated user exceeding the configured limit receives HTTP 429 with `Retry-After` header instead of triggering Gemini billing. Limits are configurable via `app_settings` or environment variables (no hard-coded magic numbers).
- [x] **HARD-02**: The SSE `safetyTimer` in `server/routes/generate.routes.ts` is cleared inside a `finally` block, not just the happy and catch paths. Forcing `sse.sendError` to throw during a generation no longer leaks the timer (verifiable by inspecting active timers after a forced error).
- [ ] **HARD-03**: A React Error Boundary wraps `App` (or every top-level route section) in `client/src/`. A render error in any descendant shows a user-facing recovery UI ("Something went wrong" + Retry button) instead of a blank screen. The boundary logs the error to console with stack and component info.
- [ ] **HARD-04**: The following packages are removed from `package.json` because the codebase does not import or otherwise use them: `passport`, `passport-local`, `@types/passport`, `@types/passport-local`, `express-session`, `connect-pg-simple`, `memorystore`. `@octokit/rest` is moved from `dependencies` to `devDependencies`. `npm install && npm run check && npm run build` all succeed after removal.

### Verification (VRFY)

Automated harness covering destructive cron operations that ship in production but were never UAT'd against seeded test data.

- [ ] **VRFY-01**: A `scripts/verify-cron-jobs.ts` (or equivalent test) seeds three controlled scenarios — (a) posts with `expires_at` in the past awaiting trash, (b) posts with `trashed_at` older than `TRASH_RETENTION_DAYS` awaiting permanent purge (with image, thumbnail, slides, and enhancement source files in storage), (c) `user_billing_profiles` with `pending_overage_micros > 0` awaiting overage invoice — then directly invokes `runTrashSweep()`, `runPurgeSweep()`, and `runOverageBillingBatch()` and asserts: trashed posts have `trashed_at` set; purged posts have DB rows removed AND storage files removed (no orphans); overage batch creates the expected ledger entries. The script exits 0 only when all three sweeps produce the expected observable side effects against seeded data.

## Future Requirements

Deferred to later milestones. Tracked but not in v1.2 scope.

### Live E2E Validation (SEED-002)

- **VRFY-V2-01**: Test-mode harness exercising Stripe (subscription checkout, Connect onboarding, auto-recharge off-session, customer portal, webhook flow) end-to-end with real test credentials.
- **VRFY-V2-02**: GA4 + Facebook Conversions API delivery validation — generate a marketing event, confirm it lands in DebugView / Test Events tool within N seconds.
- **VRFY-V2-03**: Documented runbook + reusable fixtures so the harness re-runs after each integration change.

### Refactor (SEED-004)

- **REFACTOR-V2-01**: Split `client/src/components/post-creator-dialog.tsx` (2189 LOC) into per-step files under `post-creator/`.
- **REFACTOR-V2-02**: Split `server/routes/admin.routes.ts` (1874 LOC) into focused modules.
- **REFACTOR-V2-03**: Split `client/src/components/admin/integrations-tab.tsx` (1817 LOC) by integration section.
- **REFACTOR-V2-04**: Split `client/src/lib/translations.ts` (1096 LOC) into per-language files for tree-shaking.
- **REFACTOR-V2-05**: Split `server/stripe.ts` (1029 LOC) into checkout/subscription/webhook/customer/connect services.

### Observability (SEED-005)

- **OBS-V2-01**: Operational logs in `text-rendering.service.ts` for exact-text verification outcomes and repair triggers (uses existing `generation_logs` table).
- **OBS-V2-02**: Operational logs in `caption-quality.service.ts` for caption retry/repair/fallback outcomes.
- **OBS-V2-03**: Subject-fidelity failure detection signal logged for create + edit paths.
- **OBS-V2-04**: Remove dead caption helpers in `server/routes/posts.routes.ts` left over from post-generation rebuild.

### GHL Reconciliation (SEED-003)

- **GHL-V2-01**: Decide direction (remove admin / build lead-capture surface / repurpose as marketing-event sink) and execute.

## Out of Scope

Explicitly excluded from v1.2. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| New product features | v1.2 is hardening only; feature work resumes in v1.3 |
| Manual human UAT for prior phases (5–9.1, 11, 12) | Owner-time-bounded; tracked in seeds for revisit |
| Live billing/ads validation with real test creds | Tracked in SEED-002; defers to dedicated milestone |
| Fat file refactor | Tracked in SEED-004; not blocking, mechanical, deferred |
| Generation quality observability instrumentation | Tracked in SEED-005; preventive, not urgent |
| GHL integration product-fit decision | Tracked in SEED-003; needs product conversation |
| pg_cron migration | Phase 11 explicitly chose node-cron; revisit only if multi-instance deploys arrive |
| Multi-instance cron coordination (DB-backed lock) | In-process lock acceptable for current single-instance deploy |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HARD-01 | Phase 13 | Complete |
| HARD-02 | Phase 13 | Complete |
| HARD-03 | Phase 13 | Pending |
| HARD-04 | Phase 13 | Pending |
| VRFY-01 | Phase 14 | Pending |

**Coverage:**
- v1.2 requirements: 5 total
- Mapped to phases: 5 (4 → Phase 13, 1 → Phase 14)
- Unmapped: 0

---
*Requirements defined: 2026-05-08. Traceability populated by roadmapper: 2026-05-08.*
