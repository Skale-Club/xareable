---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: GHL Signup Sync
status: roadmap_ready
stopped_at: null
last_updated: "2026-05-08T20:30:00.000Z"
last_activity: 2026-05-08 — v1.4 roadmap created (Phase 17 single-phase wire-up; 3/3 reqs mapped, 5 planning concerns flagged for /gsd:plan-phase)
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-08)

**Core value:** Users can generate on-brand visual content (single posts, carousels, enhancements) in seconds and recover deletions within a 30-day trash window.
**Current focus:** Phase 17 — GHL signup sync wire-up (v1.4)

## Current Position

Phase: 17
Plan: Not started
Status: Roadmap ready — awaiting `/gsd:plan-phase 17`
Last activity: 2026-05-08

Progress: [          ] 0% (0 of TBD plans complete)

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

## Performance Metrics

**v1.1, v1.2, v1.3 archived.** v1.4 metrics will be appended after the first plan ships.

| Phase / Plan | Duration | Tasks | Files | Notes |
|--------------|----------|-------|-------|-------|
| 17-01 | — | — | — | TBD |

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

### Roadmap Evolution

- 2026-05-08: v1.3 shipped (Phase 16). v1.4 milestone started.
- 2026-05-08: v1.4 roadmap created — single Phase 17 covering GHL-01..03. 3/3 mapped, 0 orphans, plan count TBD. Five storage-shape Planning Concerns documented for `/gsd:plan-phase 17`.

### Pending Todos

None.

### Blockers/Concerns

- **None blocking** — all five planning concerns have viable, in-scope resolutions. Listed in `milestones/v1.4-ROADMAP.md` for `/gsd:plan-phase 17` to decide:
  1. Signup `event_name` is `CompleteRegistration` (not `signup`) — informational; planner uses the right name in the new code.
  2. `marketing_events.delivery_status` JSONB does NOT exist — recommend reusing existing `integration_delivery_logs` table (already in production for telegram).
  3. `integration_settings.ghl.settings` JSONB does NOT exist — three storage options for `sync_on_signup`; planner picks.
  4. `getOrCreateGHLContact()` already supports `tags` per `GHLContactPayload` schema → no change needed (verify in plan).
  5. Hooking GHL into `POST /api/telegram/notify-signup` makes the route name lie a little; rename is out of scope for v1.4 (keep the route, document the name smell in a code comment).
- Six prior phases (5–9.1, 11, 12) carry `human_needed` UAT debt — tracked outside v1.4 scope (owner-time-bounded). Carry-over from v1.2/v1.3.
- Live E2E billing/ads validation harness — tracked in SEED-002. Out of scope for v1.4.
- Fat file refactor (`integrations-tab.tsx` is one of the 5 monoliths >1000 LOC) — tracked in SEED-004. v1.4 will add to its size, not refactor it; that's deferred.

## Session Continuity

Last session: 2026-05-08T20:30:00.000Z
Stopped at: v1.4 roadmap created — Phase 17 ready to plan
Next action: Run `/gsd:plan-phase 17` to decompose GHL-01..03 into executable plans (and resolve the 5 Planning Concerns: event_name disambiguation, delivery-log table choice, `sync_on_signup` storage location, tags-pass-through verification, route naming-smell).
Resume file: None
