---
id: SEED-004
status: dormant
planted: 2026-05-08
planted_during: v1.1 milestone post-completion (plan/ folder review)
trigger_when: when adding features to one of these files becomes painful, OR when onboarding a new contributor, OR before next big surface change
scope: Medium
---

# SEED-004: Refactor 5 fat files (>1000 lines each)

## Why This Matters

After the first server-refactoring pass (which successfully deleted `server/app-routes.ts` and modularized routes, services, middleware), `plan/further-refactoring-plan.md` queued up a second pass for the remaining monoliths. **None of that work happened.** Some files actually grew during v1.1.

| File | Current LOC | Plan target |
|---|---|---|
| `client/src/components/post-creator-dialog.tsx` | **2187** | Split into `post-creator/` with per-step files (was already 800 lines when plan was written; grew during v1.1) |
| `server/routes/admin.routes.ts` | **1874** | Split into `admin-analytics`, `admin-users`, etc. (also flagged in `.planning/codebase/CONCERNS.md`) |
| `client/src/components/admin/integrations-tab.tsx` | **1817** | Split into `integrations/` with per-section files (GTM, GHL, Telegram, GA4, Facebook, billing-plan) |
| `client/src/lib/translations.ts` | **1096** | Split into `translations/languages/{en,pt,es}.ts` for tree-shaking + lazy loading |
| `server/stripe.ts` | **1029** | Split into `services/stripe/{checkout,subscription,webhook,customer,connect}.service.ts` (also flagged in `.planning/codebase/CONCERNS.md`) |

Total: ~8,000 lines of monolithic surface area.

## When to Surface

**Trigger:** any of the following:
- A phase needs to add a step to `post-creator-dialog.tsx` (e.g., new content type) and the diff would be unreadable
- New integration added to `integrations-tab.tsx` (would push it past ~2000 lines)
- New language added (current shape requires rewriting one giant file)
- Stripe code changes for a non-trivial reason (split would scope the change)
- A new contributor needs to find code in `admin.routes.ts`

Surface during `/gsd:new-milestone` if scope touches: creator UI, integrations admin panel, translations, Stripe, admin endpoints.

## Scope Estimate

**Medium** — could be one phase covering all 5, or split per file. Each split is mechanical (extract, re-import, verify type-check), but together it's significant churn.

Risk: doing all 5 in one pass produces a huge PR that's hard to review. Recommend incremental: pick the most painful one (probably `post-creator-dialog.tsx` since it's hottest), split that, then iterate.

## Breadcrumbs

Files (and current LOC):
- `client/src/components/post-creator-dialog.tsx` — 2187
- `server/routes/admin.routes.ts` — 1874
- `client/src/components/admin/integrations-tab.tsx` — 1817
- `client/src/lib/translations.ts` — 1096
- `server/stripe.ts` — 1029

Concerns documents that already flag these:
- `.planning/codebase/CONCERNS.md` — Code Quality section, flags `admin.routes.ts` (1837 lines at audit time) and `stripe.ts` (1029 lines)

Original plan (will be deleted with `plan/`; preserved here):
- `plan/further-refactoring-plan.md` — proposed directory structures for each split

## Notes

The first refactor pass (eliminating `app-routes.ts`) shows the team's pattern for these splits is well-established (extract by domain → service or routes module → re-export from index). Replaying that pattern on these 5 files is low-risk.

This is technical debt without urgency — the code works, it's just hostile to incremental change. Surface it the moment incremental change to one of these files comes up, not before.
