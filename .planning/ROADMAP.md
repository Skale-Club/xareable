# Roadmap: Xareable

## Milestones

- ✅ **v1.0 Bug Fixes & System Hardening** — Phases 1-4 (shipped 2026-04-20)
- ✅ **v1.1 Media Creation Expansion** — Phases 5-12 + 12.5 + 12.6 (shipped 2026-05-18) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Production Hardening** — Phases 13-15 (shipped 2026-05-08) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Generation Quality Observability** — Phase 16 (shipped 2026-05-08) — see [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 GHL Signup Sync** — Phase 17 (shipped 2026-05-16) — see [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- ✅ **v1.5 Brand Style References** — Phases 18-20 (shipped 2026-05-16)
- 📋 **v1.6** — TBD (run `/gsd:new-milestone` to plan)

> **Merge reconciliation note (2026-05-17):** Phase 12 had two parallel implementations across `dev` and `origin/dev`. Resolution:
> - **Phase 12** (canonical, integer) = Image Provider Abstraction (OpenAI gpt-image-2 alternative) — from origin/dev, shipped 2026-05-17. Includes decimal patches 12.1, 12.2, 12.3, 12-audit.
> - **Phase 12.5** (decimal insert) = Schedule billing overage batch via existing cleanup-cron — from local dev, graduated SEED-001, shipped 2026-05-08.
> Both implementations preserved in code; planning narrative unified.

> **Merge reconciliation note (2026-05-18):** A second divergence was discovered on `origin/main`: a Phase 13 implementing **carousel quick-remake + per-slide edit** had shipped there in parallel with `dev`'s Phase 13 (Production Hardening). Resolution:
> - `dev`'s **Phase 13** (canonical for v1.2) = Production Hardening Fixes — preserved.
> - `origin/main`'s Phase 13 renamed to **Phase 12.6** (decimal insert under v1.1, depends on Phase 12 image provider) = Carousel Quick Remake & Per-Slide Edit Image — shipped 2026-05-18.
> Both implementations preserved in code; planning folder renamed; ROADMAP/STATE unified.

## Shipped

<details>
<summary>✅ v1.1 Media Creation Expansion (Phases 5-12 + 12.5 + 12.6) — SHIPPED 2026-05-18</summary>

- [x] Phase 5: Schema & Database Foundation (3/3 plans) — completed 2026-04-21
- [x] Phase 6: Server Services (3/3 plans) — completed 2026-04-21
- [x] Phase 7: Server Routes (3/3 plans) — completed 2026-04-22
- [x] Phase 8: Admin — Scenery Catalog (1/1 plan) — completed 2026-04-28
- [x] Phase 9: Frontend Creator — Carousel & Enhancement Branches (4/4 plans) — completed 2026-04-29
- [x] Phase 09.1: Creator dialog UX gap closure (3/3 plans) — completed 2026-04-29
- [x] Phase 10: Gallery Surface Updates (4/4 plans) — completed 2026-04-30
- [x] Phase 11: Post Trash & Automated Cleanup (4/4 plans) — completed 2026-05-07
- [x] **Phase 12: Image Provider Abstraction (OpenAI gpt-image-2 alternative) (5/5 plans + 4 decimal patches) — completed 2026-05-17**
- [x] Phase 12.1: per-user image provider preference (admin/affiliate) — completed 2026-05-17
- [x] Phase 12.2: platform API keys move from env to admin panel — completed 2026-05-17
- [x] Phase 12.3: tier model hardening — admins share platform key — completed 2026-05-17
- [x] Phase 12-audit: resolve 7 audit findings from Phase 12+12.1 review — completed 2026-05-17
- [x] **Phase 12.5: Schedule billing overage batch via cleanup-cron** (graduates SEED-001; 1 plan) — completed 2026-05-08
- [x] **Phase 12.6: Carousel Quick Remake & Per-Slide Edit Image** (5/5 plans) — completed 2026-05-18

**Totals:** 9 phases (5-12) + 2 decimal inserts (12.5, 12.6) + 4 patches (12.1-12.3, 12-audit). Full details in [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).

</details>

<details>
<summary>✅ v1.2 Production Hardening (Phases 13-15) — SHIPPED 2026-05-08</summary>

- [x] Phase 13: Production Hardening Fixes (2/2 plans) — completed 2026-05-08
- [x] Phase 14: Wire production crons via HTTP triggers (2/2 plans) — completed 2026-05-08
- [x] Phase 15: Cron Verification Harness (1/1 plan) — completed 2026-05-08

**Totals:** 3 phases, 5 plans, 15 tasks — full details in [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

<details>
<summary>✅ v1.3 Generation Quality Observability (Phase 16) — SHIPPED 2026-05-08</summary>

- [x] Phase 16: Generation Pipeline Observability (1/1 plan) — completed 2026-05-08

**Totals:** 1 phase, 1 plan, 5 tasks — full details in [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

</details>

<details>
<summary>✅ v1.4 GHL Signup Sync (Phase 17) — SHIPPED 2026-05-16</summary>

- [x] Phase 17: GHL Signup Sync (Wire-Up) (1/1 plan) — completed 2026-05-16

**Totals:** 1 phase, 1 plan, 4 tasks — full details in [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)

</details>

<details>
<summary>✅ v1.5 Brand Style References (Phases 18-20) — SHIPPED 2026-05-16</summary>

- [x] Phase 18: Data Layer + API Endpoints (3/3 plans) — completed 2026-05-16
- [x] Phase 19: Settings UI — Style Tab (1/1 plan) — completed 2026-05-16
- [x] Phase 20: Generation Integration (1/1 plan) — completed 2026-05-16

**Totals:** 3 phases, 5 plans — graduates SEED-006. Brand reference photos are now end-to-end wired (storage → API → settings UI → generation injection).

</details>

## Next Milestone

No active milestone. Run `/gsd:new-milestone` to plan v1.6.

Pending seeds (will surface during questioning):
- [SEED-002](seeds/SEED-002-live-e2e-billing-ads-validation.md) — live E2E validation harness for Stripe/GA4/Facebook
- [SEED-004](seeds/SEED-004-fat-file-refactor.md) — split 5 monolithic files >1000 LOC each
