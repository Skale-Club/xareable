---
phase: 21-openrouter-gateway-foundation
plan: 08
subsystem: api
tags: [openrouter, gemini, gateway, carousel, caption-quality, enhancement, cost-tracking]

# Dependency graph
requires:
  - phase: 21-openrouter-gateway-foundation (21-04)
    provides: ai-gateway.service.ts chatCompletion()/transcribe() core
  - phase: 21-openrouter-gateway-foundation (21-05)
    provides: ImageProviderResult.costUsdMicros contract + OpenRouterImageProvider
provides:
  - carousel-generation.service.ts callCarouselTextPlan routed through the OpenRouter gateway with a direct-Gemini rollback branch and admin-configurable text model
  - caption-quality.service.ts callGeminiForCaption routed through the gateway (last POL-07 query-string-key site closed)
  - enhancement.service.ts runPreScreen + generateEnhancementCaption routed through the gateway with fail-closed parity preserved on both branches
  - CarouselGenerationResult.costUsdMicrosTotal and EnhancementResult.costUsdMicrosTotal for Wave 6 billing plans (21-11/21-12)
affects: [21-11, 21-12, 21-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getCallRouting(\"planning\") branch at each text-call site, gateway attempt self-contained (try/catch, no double-call fallthrough), direct branch retained verbatim as GATE-07 rollback"
    - "Shared parse/validation helpers (parsePreScreenText, parseEnhancementCaptionJson) extracted so gateway and direct branches cannot drift on parsing or fail-closed semantics"
    - "costUsdMicros accumulated additively onto existing result contracts (CarouselGenerationResult, EnhancementResult), undefined (not 0) when no gateway cost was recorded so downstream billing falls back to token-table pricing"

key-files:
  created: []
  modified:
    - server/services/carousel-generation.service.ts
    - server/services/caption-quality.service.ts
    - server/services/enhancement.service.ts

key-decisions:
  - "caption-quality.service.ts's direct path already used x-goog-api-key header auth (not ?key=) at plan-execution time — the plan's 'current call-site facts' were stale; only the gateway routing branch was net-new work there, POL-07 was already satisfied"
  - "Extracted parsePreScreenText/parseEnhancementCaptionJson as file-scope shared helpers rather than duplicating parse logic per branch, guaranteeing the pre-screen fail-closed contract cannot silently diverge between gateway and direct paths"

patterns-established:
  - "Text-call gateway migration pattern: resolve routing once via getCallRouting, gateway branch wrapped in its own try/catch returning the established failure contract (null / thrown typed error), direct branch left byte-identical except for prior POL-07 fixes"

requirements-completed: [GATE-01, GATE-07, POL-07]

# Metrics
duration: 15min
completed: 2026-07-27
---

# Phase 21 Plan 08: Carousel/Caption-Quality/Enhancement Gateway Migration Summary

**Carousel master text plan, caption-quality helper, and enhancement pre-screen/caption calls all now branch on `ai_gateway_routing.planning` through OpenRouter's `chatCompletion`, each with an intact direct-Gemini rollback and (for carousel/enhancement) an aggregated `costUsdMicrosTotal` on their result contracts.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-27T14:08:00Z (approx, file investigation start)
- **Completed:** 2026-07-27T14:23:44Z
- **Tasks:** 3/3 completed
- **Files modified:** 3

## Accomplishments
- `callCarouselTextPlan` in carousel-generation.service.ts routes through the gateway with `getCallRouting("planning")`, uses the admin-configurable `styleCatalog.ai_models.text_generation` model slug (GATE-04 hardcoded-model fix as a side effect), and the CRSL2-03 slide-1 `break` fix from 21-02 was verified still intact.
- `CarouselGenerationResult.costUsdMicrosTotal` aggregates the text-plan cost plus every slide's `provider.generate()/edit()` cost (both `SlideOneResult`/`SlideNResult` extended to carry `costUsdMicros`).
- `callGeminiForCaption` in caption-quality.service.ts (the single transport helper behind all 3 passes of `ensureCaptionQuality`) now branches on the gateway; falls through to direct only when `OPENROUTER_API_KEY` is missing, never double-calls on gateway failure. Confirmed zero `?key=` query-string usage (last POL-07 service-side site).
- `runPreScreen` and `generateEnhancementCaption` in enhancement.service.ts both route through the gateway. Pre-screen's fail-closed contract (any infra failure → `PreScreenUnavailableError`, never silent accept) is provably identical on both branches via the shared `parsePreScreenText` helper.
- `EnhancementResult.costUsdMicrosTotal` sums pre-screen + caption + edit-call gateway costs.

## Task Commits

Each task was committed atomically:

1. **Task 1: carousel-generation.service.ts — master plan via gateway + cost aggregation** - `9aa0f95` (feat)
2. **Task 2: caption-quality.service.ts — routing branch + POL-07 header fix** - `c757fcd` (feat)
3. **Task 3: enhancement.service.ts — pre-screen + caption via gateway, fail-closed preserved, cost aggregated** - `36af061` (feat)

_Note: no plan-metadata commit yet — this SUMMARY + STATE/ROADMAP update lands as the final commit below._

## Files Created/Modified
- `server/services/carousel-generation.service.ts` - `callCarouselTextPlan` gateway branch, admin-configurable text model, `SlideOneResult`/`SlideNResult`/`CarouselGenerationResult` extended with cost fields, `gatewayCostTotal` accumulation in `generateCarousel`.
- `server/services/caption-quality.service.ts` - `callGeminiForCaption` gateway branch with self-contained try/catch fallback contract; `ensureCaptionQuality`'s 3-pass retry/repair flow untouched.
- `server/services/enhancement.service.ts` - `parsePreScreenText`/`parseEnhancementCaptionJson` shared helpers extracted; `runPreScreen` and `generateEnhancementCaption` gateway branches added; `EnhancementResult`/`PreScreenResult`/`CaptionResult` extended with cost fields; `enhanceProductPhoto` aggregates `costUsdMicrosTotal`.

## Decisions Made
- caption-quality.service.ts's direct path was already header-auth compliant (POL-07) at execution time — the plan's stated "current call-site facts" (`?key=` query string) were stale relative to the actual codebase; adjusted the implementation comment to reflect reality instead of literally introducing a header-auth "fix" that was already present. No functional deviation — routing branch was still net-new and is the substantive Task 2 deliverable.
- Extracted `parsePreScreenText` (enhancement.service.ts) and `parseEnhancementCaptionJson` (enhancement.service.ts) as shared, file-scope helpers reused by both the gateway and direct branches, per the plan's explicit instruction, to make the fail-closed contract provably identical rather than duplicated-and-liable-to-drift.

## Deviations from Plan

### Auto-fixed Issues

None — all three services followed the plan's action blocks essentially verbatim (routing branch shape, cost aggregation, shared-helper extraction). No Rule 1/2/3 auto-fixes were required.

### Cross-agent git index contamination (documented, not a plan deviation)

This plan executed in parallel with three sibling agents (21-06, 21-07, 21-09) in the same shared working directory (no worktree isolation). Task 1's commit (`9aa0f95`) was created via `git add server/services/carousel-generation.service.ts` followed by `git commit`; a `git status` check immediately after the `add` confirmed only my file was staged. However, `git commit` without an explicit pathspec commits the *entire* index at execution time — in the gap between my `add`/`status` check and the `commit` call actually running, the 21-09 agent's concurrent `git add server/routes/transcribe.routes.ts` (a follow-up change wiring `gatewayCostUsdMicros`/`estimatedCostMicros` into `recordUsageEvent`, on top of their already-committed `62c85f0`) got swept into commit `9aa0f95` alongside my carousel changes.

- **Verification performed:** `git log --oneline` confirmed HEAD had not moved since (no other agent had committed on top), and `git show HEAD -- server/routes/transcribe.routes.ts` showed a complete, well-formed diff (not a partial/corrupted edit) — the 21-09 agent's work was not lost, only mis-attributed to my commit message.
- **Action taken:** Did not amend/rewrite the shared commit — per the git safety protocol (avoid rewriting history) and the Phase 21-03 precedent recorded in STATE.md for this identical class of race, rewriting `HEAD` while other agents may be mid-commit risks index-lock collisions or orphaning a concurrent commit. The transcribe.routes.ts change is intact and correctly present in the repository; it is simply recorded under commit `9aa0f95`'s message instead of a 21-09 commit. No functional or data-loss impact.
- **Tasks 2 and 3's commits** (`c757fcd`, `36af061`) were verified clean (`git status --short` immediately before each `git commit` showed only my target file staged).

---

**Total deviations:** 0 plan deviations; 1 documented cross-agent git-index race (no content lost, no action required beyond documentation).
**Impact on plan:** None. All three tasks match the plan's design exactly.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. (Runtime parity checkpoints — one carousel generation and one enhancement completing end-to-end via the gateway with `OPENROUTER_API_KEY` provisioned — remain a manual staging verification per the plan's `<verification>` section, deferred to whenever the platform key is provisioned.)

## Next Phase Readiness
- `CarouselGenerationResult.costUsdMicrosTotal` and `EnhancementResult.costUsdMicrosTotal` are now available for Wave 6 billing plans (21-11/21-12) to bill real gateway cost instead of token-table estimates.
- All four text-call sites migrated across this wave (21-07 gemini.service.ts, 21-08 carousel/caption-quality/enhancement, 21-09 transcribe.routes.ts) — `grep -rn "?key=" server/services/` returns zero matches, confirming POL-07 is fully closed service-side.
- `scripts/verify-phase-21.ts` GATE-08 (video freeze) still passes 3/3; the other 9 requirement checks remain intentionally stubbed pending 21-13's wiring plan — unchanged by this plan, as expected.

---
*Phase: 21-openrouter-gateway-foundation*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 3 modified files found on disk; all 3 task commit hashes (9aa0f95, c757fcd, 36af061) found in git log.
