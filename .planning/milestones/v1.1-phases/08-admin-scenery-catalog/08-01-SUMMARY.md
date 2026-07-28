---
phase: 08-admin-scenery-catalog
plan: 01
subsystem: ui
tags: [react, admin, catalog, card-grid, dialog, file-upload, supabase-storage, alert-dialog, switch, scenery]

# Dependency graph
requires:
  - phase: 07-server-routes
    provides: PATCH /api/admin/style-catalog endpoint already accepts sceneries array
  - phase: 05-schema-database-foundation
    provides: scenerySchema + styleCatalogSchema.sceneries field in shared/schema.ts; 12 presets seeded in DB migration

provides:
  - SceneriesCard component — responsive card-grid CRUD over Scenery[] inside StyleCatalog admin UI
  - Real preview image upload to Supabase Storage (user_assets/{adminId}/sceneries/{id}-{ts}.{ext}) with client-side validation (image-only, 5MB cap)
  - AlertDialog delete confirmation
  - Inline is_active toggle directly on each card (no dialog round-trip)
  - Barrel export of SceneriesCard from post-creation/index.ts
  - SceneriesCard rendered as full-width row at bottom of PostCreationTab grid

affects:
  - 09-frontend-creator-dialogs (reads sceneries from getStyleCatalogPayload cache)
  - 10-gallery-surface-updates

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Card-grid layout (grid-cols-1 sm:grid-cols-2 xl:grid-cols-3) for catalog items with thumbnail at top — alternative to TextStylesCard's accordion pattern when items have visual previews
    - File upload + Supabase Storage public URL flow mirroring brand logo upload from onboarding.tsx (image validation, object-URL preview, upload-on-submit)
    - AlertDialog confirmation before destructive operation (mirrors users-table delete flow)
    - Inline toggle on the catalog item (Switch on card) — Save Post Settings persistence model unchanged
    - useMemo derives working array from catalog.sceneries ?? [] — no DEFAULT_STYLE_CATALOG fallback

key-files:
  created:
    - client/src/components/admin/post-creation/sceneries-card.tsx
  modified:
    - client/src/components/admin/post-creation/index.ts
    - client/src/components/admin/post-creation-tab.tsx

key-decisions:
  - "Card-grid layout chosen over accordion — sceneries have visual previews and grid surfaces them better than rows; also avoided horizontal-overflow caused by accordion's min-w-[120px] flex children on narrow viewports"
  - "Preview image is uploaded (file input + Supabase Storage), not a URL field — admins are not expected to host their own image URLs"
  - "Storage path scopes to admin user ID: user_assets/{adminId}/sceneries/{sceneryId}-{ts}.{ext} — fits existing user-scoped RLS without needing new policies; public URL works for all viewers"
  - "AlertDialog confirms delete — destructive action requires acknowledgement; copy reminds admin to Save Post Settings to persist"
  - "is_active toggle moved from edit dialog to card footer — single source of truth, no dialog round-trip, matches the at-a-glance management model the admin expects"
  - "catalog.sceneries ?? [] fallback (not DEFAULT_STYLE_CATALOG.sceneries) — 12 presets seeded in DB not in DEFAULT constant"
  - "No minimum-count delete guard (D-07) — enhancement service handles empty sceneries array gracefully"

patterns-established:
  - "SceneriesCard card-grid: thumbnail (aspect-video, object-cover) → label + ID + truncated prompt → footer with is_active Switch + Edit + Delete buttons; one Dialog handles both create and edit modes"
  - "File upload UX: object-URL preview, Replace button overlay when image present, X button to clear, validation toasts for type/size errors"

requirements-completed:
  - ADMN-01
  - ADMN-02
  - ADMN-03

# Metrics
duration: 1d (iterative — initial impl + 4 rounds of user-driven refinements)
completed: 2026-04-29
---

# Phase 8 Plan 01: Admin Scenery Catalog Summary

**SceneriesCard admin UI delivers full CRUD over scenery presets via responsive card grid with thumbnail upload to Supabase Storage, AlertDialog delete confirmation, and inline is_active toggle — wired into PostCreationTab through the existing PATCH /api/admin/style-catalog save path**

## Performance

- **Tasks:** 2 of 3 automated (Task 3 is human-verify checkpoint — addressed via iterative user feedback)
- **Files modified:** 3
- **Iterative refinements:** 4 rounds of user feedback applied after initial implementation

## Accomplishments
- Created `SceneriesCard` (~390 lines) with card-grid layout, thumbnail at top of each card, footer with inline is_active toggle + Edit + Delete buttons
- File upload pipeline: client-side validation (image MIME, ≤5 MB) → object-URL preview → Supabase Storage upload on submit at `user_assets/{adminId}/sceneries/{sceneryId}-{ts}.{ext}` → public URL persisted in catalog
- AlertDialog confirmation before delete (Cancel / Delete) — mirrors users-table delete flow
- Single Dialog handles both create and edit modes via discriminated `DialogMode` state
- Barrel-exported `SceneriesCard` from `post-creation/index.ts`; rendered as last full-width row in `PostCreationTab` grid
- TypeScript compiles clean (`npm run check` exits 0)

## Task Commits

Each task / refinement was committed atomically:

1. **Task 1: Create SceneriesCard component (initial accordion impl)** — `bb2073a` (feat)
2. **Task 2: Export SceneriesCard from barrel and wire into PostCreationTab** — `6f3db21` (feat)
3. **Refinement 1: Card grid + thumbnail + file upload + AlertDialog delete** — `88f814d` (fix)
4. **Refinement 2: Move is_active toggle from dialog to card footer** — `2288897` (fix)

**Plan metadata:** `4b16870` (docs: complete plan)

## Files Created/Modified
- `client/src/components/admin/post-creation/sceneries-card.tsx` — SceneriesCard component (~390 lines): card-grid CRUD + Supabase Storage upload + AlertDialog delete + inline is_active toggle. Single Dialog component handles create AND edit modes via discriminated `DialogMode` state
- `client/src/components/admin/post-creation/index.ts` — Added `export * from "./sceneries-card"` as 6th barrel export
- `client/src/components/admin/post-creation-tab.tsx` — Extended import destructure to include SceneriesCard; added full-width grid row at bottom

## Decisions Made

### Initial implementation decisions
- **Icon choice:** `Image` from lucide-react (aliased as `ImageIcon`) — scenery concerns backdrop imagery
- **DB fallback:** `catalog.sceneries ?? []` (not `DEFAULT_STYLE_CATALOG.sceneries`) — 12 presets seeded in DB via Phase 5 migration
- **No minimum-count guard:** Per D-07, admins can delete all sceneries; enhancement service handles empty catalog gracefully

### Iterative refinement decisions (driven by user feedback after initial impl)
- **Layout: card-grid over accordion** — Sceneries have visual previews and the grid surfaces them; eliminates horizontal-overflow caused by accordion's `min-w-[120px]` flex children on narrow viewports inside admin's `overflow-auto` page wrapper
- **Preview image as file upload, not URL field** — Admins shouldn't be expected to host their own image URLs; storage path `user_assets/{adminId}/sceneries/{sceneryId}-{ts}.{ext}` fits existing user-scoped RLS without new policies; public URL works for all viewers
- **AlertDialog before delete** — Destructive action gets explicit acknowledgement; copy reminds admin to Save Post Settings to persist
- **is_active toggle on card, not dialog** — Single source of truth; no dialog round-trip needed for a frequent quick action; new sceneries default to `is_active: true` on create, edit preserves existing value

## Deviations from Plan

The plan specified an Accordion + URL-input + dialog-toggle implementation. After initial delivery, user feedback drove four substantive divergences:

1. Accordion → card grid (better surfaces visual previews; fixes horizontal scroll)
2. URL input → file upload via Supabase Storage (better admin UX)
3. No-confirmation delete → AlertDialog confirmation (safer for destructive op)
4. Dialog-only is_active → inline switch on card (faster activation toggle)

All four diverge from `must_haves.truths` line 21 (which describes inline-edit accordion content) but each was committed in a labeled `fix(08-01)` commit and preserves all three ADMN requirement outcomes. The plan's intent (admin can CRUD sceneries through the existing catalog cache path) is fully satisfied.

## Issues Encountered

None blocking — refinements were UX improvements driven by user review, not bugs.

## Known Stubs

None — SceneriesCard reads from `catalog.sceneries` populated from the DB via existing `getStyleCatalogPayload()` cache path. File upload writes to existing `user_assets` bucket. No hardcoded data or placeholders.

## User Setup Required

None — no external service configuration required. Existing `user_assets` bucket and PATCH `/api/admin/style-catalog` endpoint cover the storage and persistence paths.

## Next Phase Readiness

- SceneriesCard fully wired: admin can CRUD scenery presets through Post Creation tab with image previews
- Toggling `is_active` off filters the scenery out of `resolveScenery()` in `enhancement.service.ts:153` — admins can soft-disable presets
- Edits persist via existing `AdminFloatingSaveButton` → `PATCH /api/admin/style-catalog` path
- `getStyleCatalogPayload()` returns updated sceneries unchanged (ADMN-03); `enhancement.service.ts:151` reads from same row
- Phase 9 (unified `post-creator-dialog` with Image/Video/Carousel/Enhancement branches) can now safely depend on a populated, admin-curated scenery list with public preview URLs

---
*Phase: 08-admin-scenery-catalog*
*Completed: 2026-04-29*
