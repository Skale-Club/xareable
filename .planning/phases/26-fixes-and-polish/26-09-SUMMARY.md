---
phase: 26-fixes-and-polish
plan: 09
subsystem: admin
tags: [express, supabase, react, observability, admin-dashboard]

# Dependency graph
requires:
  - phase: 26-01
    provides: scripts/verify-phase-26.ts's [svc-quality-dashboard] tag group (the mechanical gate this plan's code satisfies)
  - phase: 26-08
    provides: posts.feedback column (the third signal this dashboard aggregates)
  - phase: 24
    provides: generation_logs.event_kind='visual_critic' rows (logVisualCritic, CRIT-05)
  - phase: 21
    provides: generation_logs.event_kind='model_fallback' rows (logModelFallback, GATE-04)
provides:
  - "GET /api/admin/quality — admin-guarded, read-only aggregation of posts.feedback tally + visual_critic outcomes + model_fallback rates over a shared, clamped days window"
  - "QualityTab — three-card admin dashboard (User feedback / Visual critic / Model fallbacks) reachable at /admin/quality"
  - "pt-BR/es translations for all new admin Quality dashboard strings"
affects: [26-10 (operator UI-verification runbook: live data render + non-admin 403 check)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-process aggregation over a shared days-window (posts.feedback + generation_logs by event_kind), cloning admin-generations.routes.ts's missing-table/missing-column tolerance so a missing table/column degrades to zeros instead of a 500"
    - "Reused an existing sibling convention (dashboard-tab.tsx's [7,14,30,90]-day Button-group window selector) instead of inventing a new UI pattern"

key-files:
  created:
    - server/routes/admin-quality.routes.ts
    - client/src/components/admin/quality-tab.tsx
    - .planning/phases/26-fixes-and-polish/26-09-SUMMARY.md
  modified:
    - server/routes/index.ts
    - client/src/pages/admin.tsx
    - client/src/components/app-sidebar.tsx
    - client/src/lib/translations/pt.ts
    - client/src/lib/translations/es.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Wrote translations into client/src/lib/translations/pt.ts and client/src/lib/translations/es.ts (the actual, established key/value dictionaries — English is the implicit source key, no en.ts) rather than client/src/lib/translations.ts, which is now only a backward-compatible re-export barrel with no literal strings of its own. Same class of plan-vs-codebase drift 26-08 already resolved for the same files."
  - "Reused the existing 'Helpful'/'Not helpful' translation keys 26-08 added for the post-viewer feedback control instead of adding near-duplicate admin-dashboard-specific keys — same English string, same correct translation, avoids drift between the two surfaces."
  - "Followed dashboard-tab.tsx's existing day-window Button-group pattern (not a new Select/dropdown) for the 7/30/90-day selector, since that idiom is already established elsewhere in the admin panel."
  - "REQUIREMENTS.md's POL-09 row is intentionally left unchecked (not run through `requirements mark-complete`), following the exact precedent 26-05/26-06/26-07 set for POL-08/POL-06/POL-03: both code halves (26-08 user-facing, 26-09 admin-facing) are now complete, but the live proof (real data render, non-admin gets 403) is 26-10's operator sign-off checkpoint, per this plan's own verification step 5."

requirements-completed: []

# Metrics
duration: ~30min
completed: 2026-07-28
---

# Phase 26 Plan 09: Admin Quality Dashboard (Admin Half) Summary

**A read-only `GET /api/admin/quality` endpoint aggregating `posts.feedback` tallies, `visual_critic` outcome rates, and `model_fallback` rates over a shared time window, surfaced on a new three-card admin `QualityTab` at `/admin/quality`.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2
- **Files modified:** 7 (2 created: route, tab component; 5 modified: routes index, admin page, sidebar, 2 translation dicts)

## Accomplishments
- `server/routes/admin-quality.routes.ts` — `GET /api/admin/quality`, admin-guarded (`requireAdminGuard`), strictly read-only (zero insert/update/delete calls), clamps `?days=` to 1..365 (default 30) and applies one shared `since` cutoff to all three queries
- Feedback tally: counts `up`/`down` from `posts.feedback` in the window plus a total-post count for a participation rate, never dividing by zero (guards return `null`, rendered as an em dash client-side)
- Critic aggregate: groups `generation_logs` rows where `event_kind = 'visual_critic'` by `outcome`, plus `text_free_compliance_rate`, `reroll_events` (rows with `metadata.reroll_attempt_count > 0`), and `total_reroll_cost_usd_micros` summed from `metadata.reroll_cost_usd_micros`
- Fallback aggregate: groups `generation_logs` rows where `event_kind = 'model_fallback'` by `metadata.call_class`, bucketing a missing call class as `"(unknown)"`
- A missing table or missing column on any of the three queries degrades to zeros instead of a 500 — the same `isMissingSchemaTable`/`isMissingColumn` tolerance pattern `admin-generations.routes.ts` established, copied locally into this file
- Registered in `server/routes/index.ts` immediately after `adminGenerationsRoutes`
- `client/src/components/admin/quality-tab.tsx` — `QualityTab`, a 7/30/90-day window selector (matching `dashboard-tab.tsx`'s existing Button-group idiom) driving three shadcn `Card`s: User feedback (up/down counts, positive rate, participation), Visual critic (outcome table covering all 4 known outcomes plus any unexpected value rendered verbatim, text-free compliance rate, re-roll event count, re-roll cost in USD), Model fallbacks (total + call-class breakdown table)
- Loading skeleton and a "No quality data in this window yet" zero state; every ratio is guarded so no `NaN`/`Infinity` can reach the screen
- Wired into `client/src/pages/admin.tsx`'s `renderTab` switch (`case "quality":`) and `client/src/components/app-sidebar.tsx`'s `adminNavItems` (new `ThumbsUp`-iconed "Quality" entry at `/admin/quality`) — no new route registration needed, `App.tsx` already handles `/admin/:page` generically
- 23 new English strings translated into real (non-English-copy) pt-BR and es, reusing the 2 "Helpful"/"Not helpful" keys 26-08 already added

## Task Commits

1. **Task 1: GET /api/admin/quality** - `1d1ab35` (feat)
2. **Task 2: QualityTab component + admin nav/tab wiring + pt-BR/es strings** - `af106f3` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `server/routes/admin-quality.routes.ts` - the new admin route (194 lines): 3 queries, in-process aggregation, missing-schema tolerance, one shared `since` window
- `server/routes/index.ts` - imports and registers `adminQualityRoutes` immediately after `adminGenerationsRoutes`
- `client/src/components/admin/quality-tab.tsx` - the new tab component (283 lines): `useQuery` against `/api/admin/quality?days={windowDays}`, three cards, loading/error/zero states
- `client/src/pages/admin.tsx` - `QualityTab` import + `case "quality":` in `renderTab`
- `client/src/components/app-sidebar.tsx` - `ThumbsUp` import + new `adminNavItems` entry (`page: "quality"`)
- `client/src/lib/translations/pt.ts`, `client/src/lib/translations/es.ts` - 23 new keys each (2 reused from 26-08), real translations
- `.planning/REQUIREMENTS.md` - POL-09 row updated to reflect both code halves (26-08 + 26-09) complete, operator sign-off (26-10) outstanding

## Decisions Made
- **Translation file target:** the plan's own `files_modified` frontmatter names `client/src/lib/translations.ts`, but that file is now only a backward-compatible re-export barrel (`export { translations, getStaticTranslation } from "./translations/index"`) with no literal key/value pairs of its own — the actual dictionaries live in `client/src/lib/translations/pt.ts` and `client/src/lib/translations/es.ts` (English is the implicit, unlisted source key). Edited the real files, matching 26-08's own precedent for the exact same drift.
- **Key reuse over duplication:** `"Helpful"`/`"Not helpful"` were already added to both dictionaries by 26-08 for the post-viewer control. Reused them verbatim in the feedback card rather than adding parallel dashboard-specific keys — same meaning, same correct translation, avoids two sources of truth for one English string.
- **Window selector UI:** matched `dashboard-tab.tsx`'s existing `[days].map(...)` Button-group pattern (7/30/90) instead of inventing a `Select`-based selector, since that's the idiom already established elsewhere in this admin panel for the same kind of control.
- **REQUIREMENTS.md POL-09 status:** left the checkbox unchecked and did not run `requirements mark-complete` — both code halves are done, but per this plan's own `<verification>` step 5, the live proof (tab renders real data, non-admin gets 403) is 26-10's operator-sign-off checkpoint. This mirrors the exact precedent 26-05 (POL-08), 26-06 (POL-06), and 26-07 (POL-03) already established this phase.

## Deviations from Plan

### Auto-fixed Issues

None required a code fix — no bugs, missing functionality, or blocking issues were encountered. The one adjustment (translation file target) was a documentation/file-path correction, not a functional deviation, and is recorded above under Decisions Made rather than as an auto-fix.

**Total deviations:** 0 functional deviations (1 file-path correction, consistent with 26-08's own precedent for the same underlying drift).
**Impact on plan:** None — all `must_haves` artifacts, key_links, and acceptance criteria were met without weakening any check.

## Issues Encountered
None. All acceptance criteria (grep-based checks, `npm run check`, `npm run build`, `scripts/verify-phase-26.ts --only=svc-quality-dashboard`) passed on the first attempt for both tasks. Zero regression confirmed on `scripts/verify-phase-19.ts` (28/28), `scripts/verify-phase-21.ts`, `scripts/verify-phase-21.1.ts`, `scripts/verify-phase-24.ts` (incl. its own cross-plan sweep), and `scripts/verify-phase-25.ts` (incl. its own cross-plan sweep of Phases 21/21.1/22/23/24 + the golden-image gate).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- POL-09 is now code-complete end to end: user half (26-08: schema, migration, endpoint, viewer UI) + admin half (26-09: aggregation endpoint, dashboard UI, nav wiring) both landed.
- `scripts/verify-phase-26.ts --only=svc-quality-dashboard` is 8/8 PASS — the full `[svc-quality-dashboard]` tag group this plan and 26-08 together own.
- Live UI proof (open `/admin/quality` as an admin and see real feedback/critic/fallback numbers; confirm a non-admin request gets 403) is deferred to plan 26-10's operator runbook, per this plan's own `<verification>` step 5 — consistent with how 26-03/26-05/26-06/26-07/26-08 deferred their own live-proof steps.

---
*Phase: 26-fixes-and-polish*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: server/routes/admin-quality.routes.ts
- FOUND: client/src/components/admin/quality-tab.tsx
- FOUND: commit 1d1ab35
- FOUND: commit af106f3
