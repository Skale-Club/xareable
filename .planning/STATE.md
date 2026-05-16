---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: GHL Signup Sync
status: verifying
stopped_at: Completed 17-01-PLAN.md — all 4 tasks done, GHL-01..03 requirements satisfied
last_updated: "2026-05-16T13:55:08.964Z"
last_activity: 2026-05-16
progress:
  total_phases: 1
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-16)

**Core value:** Users can generate on-brand visual content (single posts, carousels, enhancements) in seconds and recover deletions within a 30-day trash window.
**Current focus:** Phase 17 — ghl-signup-sync-wire-up

## Current Position

Phase: 17
Plan: Not started
Status: Phase complete — ready for verification
Last activity: 2026-05-16

Progress: [          ] 0% (0 of 1 plans complete)

## v1.4 Phase Summary

| Phase | Plans | Summaries | Verification | Status |
|-------|-------|-----------|--------------|--------|
| 17. GHL Signup Sync (Wire-Up) | TBD | — | — | Ready to plan |

## v1.4 Requirement Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| GHL-01 (server push on signup, opt-in gated, tag `xareable`) | 17 | Pending |
| GHL-02 (admin opt-in checkbox `sync_on_signup`, persisted) | 17 | Pending |
| GHL-03 (best-effort, signup never blocked, delivery logged) | 17 | Pending |

3/3 mapped — no orphans, no duplicates.

## v1.5 Roadmap (Defined 2026-05-16)

v1.5 Brand Style References roadmap defined. 3 phases, 10 requirements, 0 orphans.
Execution begins after v1.4 Phase 17 ships.

| Phase | Goal | Requirements | Status |
|-------|------|--------------|--------|
| 18. Data Layer + API Endpoints | Complete server-side data contract (table, RLS, 4 endpoints, Zod types) | REF-01, API-01, API-02, API-03, API-04 | Not started |
| 19. Settings UI — Style Tab | 4th Settings tab with photo grid and description textarea | SET-01, SET-02, SET-03 | Not started |
| 20. Generation Integration | Creator toggle + server-side brand reference injection | GEN-01, GEN-02 | Not started |

10/10 requirements mapped — no orphans, no duplicates.

## Performance Metrics

**v1.1, v1.2, v1.3 archived.** v1.4 metrics will be appended after the first plan ships.

| Phase / Plan | Duration | Tasks | Files | Notes |
|--------------|----------|-------|-------|-------|
| 17-01 | — | — | — | TBD |
| Phase 17 P01 | 25min | 4 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.4 roadmap]: All three GHL reqs (GHL-01..03) bundled into a single Phase 17. The three reqs touch the SAME code paths (the existing signup hook + the existing GHL admin card + the existing `integration_delivery_logs` table) and ship together as one cohesive deliverable. Splitting into multiple phases would be overhead-heavy for what is fundamentally glue-work between four already-existing surfaces. Plan count left as TBD so `/gsd:plan-phase 17` can pick the natural cut (likely 1 plan; possibly 2 — server-push + admin-checkbox).
- [v1.4 scope]: Push-only, opt-in (defaults OFF), best-effort. No bidirectional sync, no webhook receivers, no event types beyond `signup`, no backfill, no custom-field mapping UI beyond email/name/tags. Single tag `xareable`. Out of scope explicitly enumerated in REQUIREMENTS.md.
- [v1.4 storage shape — DEFERRED to /gsd:plan-phase]: The seed/PROJECT.md text named two specific storage paths that don't exist in the codebase as written:
  (a) `marketing_events.delivery_status` JSONB → does NOT exist (table has fixed `ga4_status`/`facebook_status` columns instead). Recommended path: reuse the existing `integration_delivery_logs` table (migration `20260307000000_integration_observability.sql`), already used by the telegram signup branch via `recordIntegrationDeliveryLog()`. Schema fits the GHL case unchanged.
  (b) `integration_settings.ghl.settings` JSONB → does NOT exist (table has fixed columns; `custom_field_mappings` is the only JSONB and is semantically different). Three options for `sync_on_signup`: (1) add a `sync_on_signup boolean DEFAULT false` column on `integration_settings`, (2) stash inside `custom_field_mappings` under a synthetic reserved key (zero migration but conflates concerns), (3) add a new generic `settings jsonb` column for current + future flags. Planner picks.

- [v1.4 event name disambiguation]: The seed/PROJECT.md text said "`event_type='signup'`". In the codebase the relevant call is `trackMarketingEvent({ event_name: "CompleteRegistration", event_key: "signup:<user.id>", … })` at `server/routes/integrations.routes.ts:1901`. The GHL push branch hooks into this exact handler, in parallel with the existing telegram branch.

- [v1.5 roadmap]: 10 requirements across 3 phases. Phase 18 delivers the full server-side data contract (DB + RLS + 4 endpoints + Zod) before any UI is built — ensures Phase 19 (UI) and Phase 20 (generation) have a stable API to call. Phase 19 delivers the complete Style tab including both the photo grid and description textarea (they share a single tab and are closely coupled in UX). Phase 20 is isolated at the end because it depends on brand references existing in the system (Phase 18) and the user query pattern established by Phase 19's mount-time check.
- [Phase 17]: fanGHLSignup extracted as module-scope helper (Option B2) — GHL runs regardless of telegram exit path, signup never blocked, best-effort fire-and-forget
- [Phase 17]: sync_on_signup stored as boolean column on integration_settings (not JSONB) — clean schema, additive migration, query-friendly
- [Phase 17]: Reused integration_delivery_logs for GHL delivery records — identical observability surface to telegram, zero new schema

### Roadmap Evolution

- 2026-05-08: v1.3 shipped (Phase 16). v1.4 milestone started.
- 2026-05-08: v1.4 roadmap created — single Phase 17 covering GHL-01..03. 3/3 mapped, 0 orphans, plan count TBD. Five storage-shape Planning Concerns documented for `/gsd:plan-phase 17`.
- 2026-05-16: v1.5 roadmap defined — Phases 18-20 covering all 10 Brand Style References requirements. 10/10 mapped, 0 orphans.

### Pending Todos

None.

### Blockers/Concerns

- **None blocking v1.4** — all five planning concerns have viable, in-scope resolutions. Listed in `milestones/v1.4-ROADMAP.md` for `/gsd:plan-phase 17` to decide:
  1. Signup `event_name` is `CompleteRegistration` (not `signup`) — informational; planner uses the right name in the new code.
  2. `marketing_events.delivery_status` JSONB does NOT exist — recommend reusing existing `integration_delivery_logs` table (already in production for telegram).
  3. `integration_settings.ghl.settings` JSONB does NOT exist — three storage options for `sync_on_signup`; planner picks.
  4. `getOrCreateGHLContact()` already supports `tags` per `GHLContactPayload` schema → no change needed (verify in plan).
  5. Hooking GHL into `POST /api/telegram/notify-signup` makes the route name lie a little; rename is out of scope for v1.4 (keep the route, document the name smell in a code comment).
- Six prior phases (5–9.1, 11, 12) carry `human_needed` UAT debt — tracked outside v1.4 scope (owner-time-bounded). Carry-over from v1.2/v1.3.
- Live E2E billing/ads validation harness — tracked in SEED-002. Out of scope for v1.4.
- Fat file refactor (`integrations-tab.tsx` is one of the 5 monoliths >1000 LOC) — tracked in SEED-004. v1.4 will add to its size, not refactor it; that's deferred.

## Session Continuity

Last session: 2026-05-16T13:13:03.162Z
Stopped at: Completed 17-01-PLAN.md — all 4 tasks done, GHL-01..03 requirements satisfied
Next action: Run `/gsd:plan-phase 17` to decompose GHL-01..03 into executable plans (and resolve the 5 Planning Concerns: event_name disambiguation, delivery-log table choice, `sync_on_signup` storage location, tags-pass-through verification, route naming-smell).
Resume file: None
