---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Generation Quality Observability
status: defining_requirements
stopped_at: null
last_updated: "2026-05-08T18:30:00.000Z"
last_activity: 2026-05-08 — v1.3 milestone started (graduating SEED-005)
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-08)

**Core value:** Users can generate on-brand visual content (single posts, carousels, enhancements) in seconds and recover deletions within a 30-day trash window.
**Current focus:** v1.3 Generation Quality Observability — defining requirements + roadmap

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements (graduating SEED-005)
Last activity: 2026-05-08 — Milestone v1.3 started

Progress: [          ] 0% (0 of 0 plans complete)

## v1.2 Phase Summary

| Phase | Plans | Summaries | Verification | Status |
|-------|-------|-----------|--------------|--------|
| 13. Production Hardening Fixes | 2 | 2 | ✅ PASS 13/13 | Complete (2026-05-08) |
| 14. Wire production crons via HTTP triggers | 2 | 2 | ✅ PASS 7/7 | Complete (2026-05-08) |
| 15. Cron Verification Harness | 1 | 1 | — | Complete — ready for verification (2026-05-08) |

## v1.2 Requirement Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| HARD-01 (rate limit AI endpoints) | 13 | Complete |
| HARD-02 (SSE finally cleanup) | 13 | Complete |
| HARD-03 (React Error Boundary) | 13 | Complete |
| HARD-04 (dead deps removal) | 13 | Complete |
| CRON-01 (requireCronSecret middleware) | 14 | Complete |
| CRON-02 (3 internal HTTP endpoints) | 14 | Complete |
| CRON-03 (GitHub Actions workflow) | 14 | Complete |
| CRON-04 (architecture docs) | 14 | Complete |
| VRFY-01 (cron verification harness) | 15 | Complete |

9/9 mapped — no orphans.

## Performance Metrics

**v1.1 archived.** v1.2 metrics:

| Phase / Plan | Duration | Tasks | Files | Notes |
|--------------|----------|-------|-------|-------|
| 13-01 / 13-02 | (per phase 13 SUMMARYs) | — | — | HARD-01..04 fixes |
| 14-01 | (per 14-01 SUMMARY) | — | — | requireCronSecret + 3 internal HTTP endpoints |
| 14-02 | (per 14-02 SUMMARY) | — | — | GitHub Actions workflow + architecture docs |
| 15-01 | ~25 min | 5 | 1 | scripts/verify-cron-jobs.ts (761 LOC); live run exit 0 |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.2 roadmap]: Bundled HARD-01..04 into single Phase 13 — all four are independent, small, parallel-friendly production fixes; no dependency ordering required
- [v1.2 roadmap]: VRFY-01 isolated in Phase 14 — different shape (test harness with seeded data) and bigger scope than per-fix plans; conceptually separate deliverable
- [v1.2 scope]: Live Stripe/GA4/Facebook E2E validation deferred to SEED-002 — VRFY-01 covers only cron-job side effects against seeded data, not external service integration
- [Phase 11/12 carry-over]: In-process boolean cron lock acceptable for current single-instance deploy; revisit if multi-instance arrives
- [Phase 13]: Used express-rate-limit library over extending in-memory Map pattern from translate.routes.ts (typed, IETF draft-7 headers, single-source admin bypass via skip)
- [Phase 13]: Inline limiter invocation (await new Promise(resolve => limiter(req,res,resolve))) over middleware-chain conversion — preserves existing inline authenticateUser pattern in all 5 paid AI routes
- [Phase 13]: try/finally (no outer catch) for carousel + enhance safetyTimer cleanup — preserves existing inner try/catch error semantics; finally runs on every termination path including early returns
- [Phase 13]: ErrorBoundary placed inside LanguageProvider, outside AuthProvider — useTranslation works in recovery UI AND AuthProvider init errors are caught
- [Phase 13]: Removed 5 dead session/auth deps + 4 @types and relocated @octokit/rest to devDependencies — pre-removal grep confirmed zero source-code imports
- [Phase 14]: [Phase 14-01]: Single internal-cron.routes.ts file (cohesion over distribution); preserved /api/internal/billing/run-overage-batch path identity across move from billing.routes.ts; requireCronSecret REPLACES requireAdminGuard on moved endpoint (no admin escape hatch via app surface); 503 vs 401 split kept distinct for ops semantics.
- [Phase 14]: [Phase 14-02]: Created .github/workflows/cron.yml with two scheduled jobs (cleanup every 6h, overage weekly Sunday 00:00 UTC) plus workflow_dispatch for manual smoke-testing; expanded cleanup-cron.service.ts header to canonically document dual-trigger model (Path A: HTTP via GH Actions on Vercel / Path B: node-cron on Hetzner); body sealed, reorg-era docs verified intact (no duplication).
- [Phase 15]: [Phase 15-01]: Built scripts/verify-cron-jobs.ts (761 LOC) — runtime harness for runTrashSweep/runPurgeSweep/runOverageBillingBatch via dedicated test user + try/finally cleanup; ≥ N (not === N) sweep-count assertions because sweeps are process-wide; Mode B Stripe path lazy-imports SDK and is sk_test_* gated with sk_live_* refusal; image_url markers (not timestamp string equality) used to identify seeded rows after Postgres timestamptz roundtrip mismatch was caught by the live runtime gate. Live run exit 0 — VRFY-01 closed.

### Roadmap Evolution

- 2026-05-08: v1.1 shipped (Phases 5–12). v1.2 milestone started.
- 2026-05-08: v1.2 roadmap created — Phase 13 (HARD fixes) + Phase 14 (cron verification harness). 5 requirements mapped to 2 phases.
- 2026-05-08: Phase 13 shipped (HARD-01..04 all complete; verification 13/13).
- 2026-05-08: **v1.2 reorganized after Vercel/Hetzner cron-mismatch surfaced.** Phase 11 + 12 used `node-cron` in `server/index.ts`, but Vercel uses `api/handler.ts` as serverless entry — internal scheduler never runs in production. Inserted **Phase 14 "Wire production crons via HTTP triggers"** (HARD: HTTP endpoints + auth middleware + GitHub Actions schedule, preserving `node-cron` for future Hetzner). Renumbered original Phase 14 (verify harness) → **Phase 15**. Added 4 new requirement IDs (CRON-01..04). Total v1.2 requirements: 9 (was 5).

### Pending Todos

None.

### Blockers/Concerns

- Six prior phases (5–9.1, 11, 12) carry `human_needed` UAT debt; tracked outside v1.2 scope (owner-time-bounded). VRFY-01 partially addresses Phase 11/12 cron operations only — not the live-credentials Gemini/Stripe/GA4/Facebook gaps.

## Session Continuity

Last session: 2026-05-08T17:41:41.748Z
Stopped at: Completed 15-01-PLAN.md (VRFY-01) — Phase 15 ready for verification
Next action: Run `/gsd:verify-phase 15` to validate the cron verification harness (VRFY-01)
Resume file: None
