---
phase: 21
slug: openrouter-gateway-foundation
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-18
updated: 2026-07-18
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — project uses `scripts/verify-phase-N.ts` static/functional harness pattern (tsx runner) |
| **Config file** | none — Wave 1 (Plan 21-01) creates `scripts/verify-phase-21.ts` skeleton |
| **Quick run command** | `npx tsx scripts/verify-phase-21.ts` |
| **Full suite command** | `npm run check && npx tsx scripts/verify-phase-21.ts` |
| **Estimated runtime** | ~30 seconds (static checks; live checks env-gated) |

---

## Sampling Rate

- **After every task commit:** Run `npm run check` (tsc) — fast type feedback
- **After every plan wave:** Run `npx tsx scripts/verify-phase-21.ts` (expect exit 1 with only stub-failures until 21-13; GATE-08 checks must NEVER fail)
- **Before `/gsd:verify-work`:** Full suite must be green (after 21-13)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Filled by the planner 2026-07-18. Requirement→check mapping from 21-RESEARCH.md §Validation Architecture. Each implementing task carries its own self-contained `<verify>` command; the shared harness stubs flip to real assertions only in 21-13 (single-owner rule prevents parallel-wave conflicts on scripts/verify-phase-21.ts).

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 21-01/T1 | 21-01 | 1 | GATE-08 | static (SHA-256 baseline + zero-OpenRouter-refs) | `npx tsx scripts/verify-phase-21.ts` | ✅ created W1 | ⬜ pending |
| 21-02/T1 | 21-02 | 2 | POL-01 | static | `grep "checkCredits(user.id, \"edit\", isVideoPost)" server/routes/edit.routes.ts` | ✅ | ⬜ pending |
| 21-02/T2 | 21-02 | 2 | CRSL2-03 | static (code-shape; DI behavioral test deferred per research) | `grep -A3 "if (i === 0) {" server/services/carousel-generation.service.ts \| grep break` | ✅ | ⬜ pending |
| 21-02/T3 | 21-02 | 2 | POL-07 | static | `! grep "?key=" server/services/text-rendering.service.ts` | ✅ | ⬜ pending |
| 21-03/T1-3 | 21-03 | 2 | GATE-04, GATE-05 | static + tsc | `grep realCostUsdMicros server/quota.ts && npm run check` | ✅ | ⬜ pending |
| 21-04/T1-2 | 21-04 | 3 | GATE-01, GATE-03, GATE-04 | static + tsc | `grep chatCompletion server/services/ai-gateway.service.ts && npm run check` | ✅ | ⬜ pending |
| 21-05/T1-2 | 21-05 | 4 | GATE-02 | static + tsc | `grep "openrouter.ai/api/v1/images" server/services/ai-gateway.service.ts` | ✅ | ⬜ pending |
| 21-05/T3 | 21-05 | 4 | GATE-02 | functional (no network) | `npx tsx scripts/test-openrouter-image-adapter.ts` | ✅ created W4 | ⬜ pending |
| 21-06/T1-3 | 21-06 | 5 | GATE-02, GATE-04, GATE-07 | static + tsc | `grep getCallRouting server/services/image-provider.ts && npm run check` | ✅ | ⬜ pending |
| 21-07/T1-2 | 21-07 | 5 | GATE-01, GATE-07, POL-07 | static + tsc | `! grep "?key=" server/services/gemini.service.ts && npm run check` | ✅ | ⬜ pending |
| 21-08/T1-3 | 21-08 | 5 | GATE-01, GATE-07, POL-07 | static + tsc | `! grep "?key=" server/services/caption-quality.service.ts && npm run check` | ✅ | ⬜ pending |
| 21-09/T1-2 | 21-09 | 5 | GATE-03, GATE-05, GATE-07, POL-07 | static + tsc | `! grep "?key=" server/routes/transcribe.routes.ts && npm run check` | ✅ | ⬜ pending |
| 21-10/T1-2 | 21-10 | 6 | GATE-05 | static + tsc | `grep editCostUsdMicros server/routes/edit.routes.ts && npm run check` | ✅ | ⬜ pending |
| 21-11/T1-2 | 21-11 | 6 | GATE-05 | static + tsc | `grep costUsdMicrosTotal server/routes/carousel.routes.ts && npm run check` | ✅ | ⬜ pending |
| 21-12/T1 | 21-12 | 6 | GATE-05 | static + tsc | `grep costUsdMicrosTotal server/routes/enhance.routes.ts && npm run check` | ✅ | ⬜ pending |
| 21-13/T1-2 | 21-13 | 7 | ALL 10 IDs | static + functional (full harness green) | `npx tsx scripts/verify-phase-21.ts` (exit 0) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `scripts/verify-phase-21.ts` — skeleton with check registry (mirrors verify-phase-12/13/16 pattern), 9 checks stubbed failing, GATE-08 checks REAL — **Plan 21-01 (Wave 1)**
- [x] Baseline snapshot of `server/services/video-generation.service.ts` recorded in the verify script as SHA-256 `1b47b62a50cb12d6cc427ddc16923cb5aa745cab265b85e03b1464b9183c7daf` (GATE-08 freeze guard) — **Plan 21-01 (Wave 1)**
- [x] `scripts/test-openrouter-image-adapter.ts` — no-network functional adapter test — **Plan 21-05 (Wave 4)**
- [x] CRSL2-03 behavioral test decision: DI refactor of `generateCarousel` deferred (research flagged it as the one non-trivial infra gap); accepted static code-shape check (`if (i === 0)` + `break` inside catch) per 21-RESEARCH.md §Wave 0 Gaps recommendation.

*No test framework install — project convention is the verify-script harness.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live OpenRouter generation end-to-end (image + text + transcribe) | GATE-01/02/03 | Needs real `OPENROUTER_API_KEY` + paid calls | Set env key, run one generation per surface (single image, edit, carousel, enhancement, transcribe) in staging; confirm posts persist and SSE completes |
| Real `usage.cost` lands in usage event | GATE-05 | Needs live billed call | After live generation, inspect `usage_events` row: `metadata.real_cost_usd_micros` ≈ OpenRouter dashboard cost; `charged_amount_micros` = real cost × markup |
| Fallback chain engages on simulated 404 | GATE-04 | Needs live call against a bogus slug | Set a bogus primary slug + a valid fallback chain; generate; confirm success + `generation_logs` row with `event_kind='model_fallback'`; restore slug |
| Admin rollback flip | GATE-07 | Touches live settings + needs both paths exercised | `PATCH /api/admin/ai-gateway-routing {"call_class":"image","mode":"direct"}`; generate; confirm success via legacy path; flip back |
| Live video generation unaffected | GATE-08 | Needs Veo paid call | Generate one video in staging via direct Google path; confirm success (env-gated Mode-B step, mirrors Phase 15) |

Runbook committed inside `scripts/verify-phase-21.ts` by Plan 21-13.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (21-01 creates the harness before any code lands)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-approved 2026-07-18 (plans 21-01 … 21-13)
