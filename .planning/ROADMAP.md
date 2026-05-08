# Roadmap: My Social Autopilot

## Milestones

- ✅ **v1.0 Bug Fixes & System Hardening** — Phases 1-4 (shipped 2026-04-20)
- ✅ **v1.1 Media Creation Expansion** — Phases 5-12 (shipped 2026-05-08) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Production Hardening** — Phases 13-15 (shipped 2026-05-08) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 Generation Quality Observability** — Phase 16 (in progress)

## Shipped

<details>
<summary>✅ v1.1 Media Creation Expansion (Phases 5-12) — SHIPPED 2026-05-08</summary>

- [x] Phase 5: Schema & Database Foundation (3/3 plans) — completed 2026-04-21
- [x] Phase 6: Server Services (3/3 plans) — completed 2026-04-21
- [x] Phase 7: Server Routes (3/3 plans) — completed 2026-04-22
- [x] Phase 8: Admin — Scenery Catalog (1/1 plan) — completed 2026-04-28
- [x] Phase 9: Frontend Creator — Carousel & Enhancement Branches (4/4 plans) — completed 2026-04-29
- [x] Phase 09.1: Creator dialog UX gap closure (3/3 plans) — completed 2026-04-29
- [x] Phase 10: Gallery Surface Updates (4/4 plans) — completed 2026-04-30
- [x] Phase 11: Post Trash & Automated Cleanup (4/4 plans) — completed 2026-05-07
- [x] Phase 12: Schedule billing overage batch via cleanup-cron (1/1 plan) — completed 2026-05-08

**Totals:** 9 phases, 26 plans, 46 tasks — full details in [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>✅ v1.2 Production Hardening (Phases 13-15) — SHIPPED 2026-05-08</summary>

- [x] Phase 13: Production Hardening Fixes (2/2 plans) — completed 2026-05-08
- [x] Phase 14: Wire production crons via HTTP triggers (2/2 plans) — completed 2026-05-08
- [x] Phase 15: Cron Verification Harness (1/1 plan) — completed 2026-05-08

**Totals:** 3 phases, 5 plans, 15 tasks — full details in [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

## 🚧 v1.3 Generation Quality Observability (In Progress)

**Milestone Goal:** Make the generation pipeline introspectable. Add structured operational logs to `text-rendering.service.ts` (exact-text verification outcomes + repair triggers) and `caption-quality.service.ts` (caption retry/repair/fallback outcomes). Surface any existing subject-fidelity failure signal into the same logs. Remove dead caption helpers in `posts.routes.ts` left over from the post-generation rebuild. Telemetry feeds into the existing `generation_logs` table — no new schema beyond extending `error_type` enum, no new dependencies, no new external pipelines.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (16.1, 16.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 16: Generation Pipeline Observability** — Structured logs in text-rendering + caption-quality services, surface existing subject-fidelity signal, remove dead caption helpers in posts.routes.ts (completed 2026-05-08)

## Phase Details

### Phase 16: Generation Pipeline Observability
**Goal**: Replace zero-introspection generation pipeline with structured operational logs that detect quality regressions automatically (instead of waiting for user complaints), and remove dead caption helpers in `server/routes/posts.routes.ts` left over from the post-generation rebuild.
**Depends on**: Phase 15 (v1.2 production cron foundation; observability shares the same `generation_logs` infrastructure already in production)
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04
**Success Criteria** (what must be TRUE):
  1. After a generation that exercises `verifyExactImageText()` / `enforceExactImageText()` in `server/services/text-rendering.service.ts`, an admin querying `generation_logs` (filtered by the affected `post_id`) finds at least one row carrying the verification outcome (`pass` / `repair_triggered` / `repair_succeeded` / `repair_failed`), an `expected_text_hash` (SHA-256 of the requested exact text), the verbatim `detected_text`, the `repair_attempt_count` (0..2 — matching `maxRepairPasses` cap), and a `duration_ms`. A failure inside the log path does NOT block, fail, or alter the user-visible generation result.
  2. After a generation that calls `ensureCaptionQuality()` in `server/services/caption-quality.service.ts`, an admin querying `generation_logs` finds at least one row carrying the caption-quality outcome (`pass` / `retry_triggered` / `repair_triggered` / `fallback_used`), the attempt count, `final_caption_length`, `final_caption_paragraph_count`, and `duration_ms`. A failure inside the log path does NOT block, fail, or alter the returned caption.
  3. When the existing prompting layer raises a subject-fidelity failure signal during create or edit, one `generation_logs` row is written with `error_type = 'subject_fidelity'`, the affected `post_id`, `reference_image_count`, and a structured `failure_reason`. (Planning note: a grep across `server/` finds NO existing programmatic `subject_fidelity` flag today — only prose-level prompt instructions. Per OBS-03's explicit constraint, no new detection mechanism may be invented; the planner must surface this during `/gsd:plan-phase` and either (a) point at a real existing signal, (b) scope OBS-03 down to instrument-when-signal-arrives scaffolding, or (c) defer OBS-03 to a future milestone with a follow-up seed. The criterion verifies the chosen path.)
  4. `git grep` for the dead caption helpers in `server/routes/posts.routes.ts` (the file's own copies of `looksTruncatedCaption`, `hasHashtags`, `isAcceptableCaption`, `buildCaptionFallback` — duplicates of the canonical versions in `server/services/caption-quality.service.ts`) returns zero hits inside `posts.routes.ts`. The remaining still-used helper `extractPromptField` is preserved (it's called from the `remake-caption` endpoint and has no equivalent in the service).
  5. Backwards compatibility holds: `npm run check` and `npm run build` succeed; the existing post-generation flow (create / edit / remake-caption) continues to work end-to-end with no behavioral change visible to users — the only observable difference is new rows appearing in `generation_logs`.
**Plans**: 1 plan
- [x] 16-01-PLAN.md — Schema extension + observability.service.ts + OBS-01/02 instrumentation + OBS-04 dead-helper cleanup + verify-phase-16 harness

**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 16

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5–12. (v1.1 phases) | v1.1 | 26/26 | Complete | 2026-05-08 |
| 13–15. (v1.2 phases) | v1.2 | 5/5 | Complete | 2026-05-08 |
| 16. Generation Pipeline Observability | v1.3 | 1/1 | Complete    | 2026-05-08 |
