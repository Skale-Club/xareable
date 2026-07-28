---
phase: 25-narrative-carousels-and-aesthetic-dna
plan: 11
subsystem: admin-ui
tags: [react, tanstack-query, admin, i18n, style-catalog]

# Dependency graph
requires:
  - phase: 25-02
    provides: artDirectionSchema/EMPTY_ART_DIRECTION on brandStyleSchema/postMoodSchema; styleReferencePhotoSchema/StyleReferencePhotosResponse/STYLE_REFERENCE_SCOPES/MAX_STYLE_REFERENCE_PHOTOS
  - phase: 25-08
    provides: "GET/POST/DELETE /api/admin/style-reference-photos admin-guarded CRUD routes"
provides:
  - "Dense art-direction editor fields (photography type, lighting, composition, texture, negative prompts) on every Brand Style and Post Mood in the existing admin style-catalog editor"
  - "StyleReferenceBoardsCard — immediate-persist CRUD UI for style_reference_photos, wired into post-creation-tab.tsx"
  - "pt-BR/es translations for all new strings introduced by this plan"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New admin card that intentionally opts OUT of the batched catalog/setCatalog save pattern shared by every sibling card in post-creation/ — owns its own useQuery/useMutation pair for a real relational table"

key-files:
  created:
    - client/src/components/admin/post-creation/style-reference-boards-card.tsx
  modified:
    - client/src/components/admin/post-creation/brand-styles-card.tsx
    - client/src/components/admin/post-creation/post-moods-card.tsx
    - client/src/components/admin/post-creation/index.ts
    - client/src/components/admin/post-creation-tab.tsx
    - client/src/lib/translations/pt.ts
    - client/src/lib/translations/es.ts

key-decisions:
  - "StyleReferenceBoardsCard accepts only a read-only `catalog` prop (no setCatalog) so it is structurally impossible for this card to dirty the batched style-catalog save state — style_reference_photos is a real table, not part of the style_catalog JSONB blob"
  - "Grouped the single unfiltered /api/admin/style-reference-photos fetch into a Map<scope, Map<style_id, photos[]>> client-side (rewritten with Array.from(...).forEach instead of for-of over Map iterators to satisfy this project's tsc target, matching 25-03's established workaround)"
  - "splitCsv/joinCsv CSV-array helpers duplicated verbatim into brand-styles-card.tsx and post-moods-card.tsx (matching the existing per-file duplication convention already used by text-styles-card.tsx) rather than extracted to a shared util"

patterns-established: []

requirements-completed: [PLAN-05, PLAN-07]

# Metrics
duration: ~20min
completed: 2026-07-28
---

# Phase 25 Plan 11: Admin UI for Aesthetic DNA + Style Reference Boards Summary

**Every Brand Style and Post Mood in the admin style-catalog editor now exposes five dense art-direction fields (photography type, lighting, composition, texture, negative prompts), and a new StyleReferenceBoardsCard gives admins immediate-persist upload/delete control over platform-curated reference image boards — both riding the existing tab, with full pt-BR/es coverage.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- `brand-styles-card.tsx` and `post-moods-card.tsx` each gained an `updateArtDirection` batched-state helper (mirroring the existing `updateField` shape) plus verbatim-copied `splitCsv`/`joinCsv` CSV helpers, and a bordered "Art Direction" sub-section inside every Accordion item with five fields: Photography type, Lighting, Composition, Texture, and Negative prompts (comma-separated, backed by `splitCsv`/`joinCsv`). All reads are defensive (`style.art_direction ?? EMPTY_ART_DIRECTION`) so a stale client cache predating the field never crashes. These fields ride the pre-existing batched `Save Post Settings` button — no new save control was added.
- New `client/src/components/admin/post-creation/style-reference-boards-card.tsx` (301 lines): a `StyleReferenceBoardsCard` that owns its own `useQuery`/`useMutation` pair against `/api/admin/style-reference-photos` (own endpoints from plan 25-08), grouping the single unfiltered fetch into a `scope -> style_id -> sorted photo list` structure client-side. Renders two Accordions (Brand Styles, Post Moods), each entry showing a 4-column thumbnail grid with hover-delete `X` buttons and an "Add image" upload tile gated at `MAX_STYLE_REFERENCE_PHOTOS` (8). Upload flow mirrors `sceneries-card.tsx`'s pattern (image/size validation, upload to `user_assets/{userId}/style-boards/...`, POST the resulting URL, then `invalidateQueries`); delete flow calls `DELETE /api/admin/style-reference-photos/:id` then invalidates. Accepts only a read-only `catalog` prop — no `setCatalog` — making it structurally impossible for this card to participate in the batched catalog save.
- `post-creation-tab.tsx` renders `StyleReferenceBoardsCard` in its own full-width row immediately after `SceneriesCard`, passing only `catalog`; `updateMutation`/`AdminFloatingSaveButton` untouched.
- 23 new English strings (5 field labels + 5 helper lines + the negative-prompts helper + reference-board UI/toast copy) translated into pt-BR and es, byte-identical keys across both files and every component call site.

## Task Commits

Each task was committed atomically:

1. **Task 1: art-direction editor fields on styles and moods** - `d30fcb7` (feat)
2. **Task 2: StyleReferenceBoardsCard (immediate-persist CRUD)** - `9920f8b` (feat)
3. **Task 3: tab wiring + pt-BR/es translations** - `ad5db1c` (feat)

**Plan metadata:** (pending — final docs commit)

## Files Created/Modified

- `client/src/components/admin/post-creation/brand-styles-card.tsx` - `updateArtDirection` helper, `splitCsv`/`joinCsv`, Art Direction UI sub-section per style
- `client/src/components/admin/post-creation/post-moods-card.tsx` - identical additions over `post_moods`
- `client/src/components/admin/post-creation/style-reference-boards-card.tsx` - new immediate-persist CRUD card (created)
- `client/src/components/admin/post-creation/index.ts` - barrel export for the new card
- `client/src/components/admin/post-creation-tab.tsx` - imports + renders `StyleReferenceBoardsCard` with `catalog` only
- `client/src/lib/translations/pt.ts` - 23 new key/value pairs
- `client/src/lib/translations/es.ts` - 23 new key/value pairs (same keys)

## Decisions Made

- Chose to duplicate `splitCsv`/`joinCsv` into both `brand-styles-card.tsx` and `post-moods-card.tsx` rather than extract a shared util, matching the codebase's existing per-file duplication convention (this directory already duplicates the same helpers in `text-styles-card.tsx`).
- Built the reference-board grouping as a real `Map<scope, Map<style_id, photos[]>>` (per the plan's explicit instruction) rather than a simpler inline filter, then rewrote the iteration with `Array.from(...).forEach` instead of `for...of` over `Map.values()`/`Map.entries()` after `tsc` rejected native Map iteration under this project's target — the same class of fix 25-03 already established for `Set` iteration.
- Wrote the four "e.g." helper lines (Photography type/Lighting/Composition/Texture) and one additional helper line for Negative prompts as Claude's discretion content per the plan, keeping the exact wording identical between `brand-styles-card.tsx` and `post-moods-card.tsx` so only one set of translation keys was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Native `Map` iteration rejected by this project's `tsc` target**
- **Found during:** Task 2 (`npm run check` after writing `style-reference-boards-card.tsx`)
- **Issue:** `for (const scopeMap of map.values())` / `for (const [id, list] of scopeMap.entries())` failed with TS2802 ("can only be iterated through when using the `--downlevelIteration` flag or with a `--target` of `es2015` or higher") — same ES3-target constraint 25-03 hit with `Set` iteration.
- **Fix:** Rewrote both loops using `Array.from(map.values()).forEach(...)` / `Array.from(scopeMap.entries()).forEach(...)`, avoiding native iterator protocol entirely while keeping identical grouping semantics.
- **Files modified:** `client/src/components/admin/post-creation/style-reference-boards-card.tsx`
- **Verification:** `npm run check` exits 0 after the fix.
- **Committed in:** `9920f8b` (Task 2 commit)

**Total deviations:** 1 auto-fixed (Rule 3, blocking, pre-existing tsc-target constraint — no scope creep).

## Issues Encountered

None beyond the auto-fixed deviation above. Ran as one of three parallel executor agents (25-09/25-10/25-11) sharing this working directory. Files touched by the sibling plans (`server/services/gemini.service.ts`, `server/routes/generate.routes.ts`, `server/services/carousel-generation.service.ts`) repeatedly appeared as unstaged modifications in `git status` throughout execution; per the parallel-execution protocol, only this plan's own declared files were ever `git add`-ed or committed, verified immediately before every commit.

## User Setup Required

None - no external service configuration required. The admin UI is ready to serve real data as soon as the two Phase 25-02 migrations (including `style_reference_photos`) are applied to the live Supabase project — a standing blocker shared with every other pending Phase 21-25 migration in this environment.

## Next Phase Readiness

- Admins can now curate dense art direction for every style/mood and manage image reference boards, entirely inside the existing style-catalog admin tab — closing out the last UI-facing piece of PLAN-05/PLAN-07.
- `scripts/verify-phase-25.ts --only=svc-style-reference-boards`: unchanged by this plan as expected (10/11 green; the 1 remaining red check, `carousel-generation.service.ts calls planReferenceImageSlots(`, is sibling plan 25-10's server-side wiring job, not this plan's scope).
- Zero regression: `scripts/verify-phase-19.ts` (28/28, Style tab UI) fully green; `npm run check`/`npm run build` both clean.

---
*Phase: 25-narrative-carousels-and-aesthetic-dna*
*Completed: 2026-07-28*

## Self-Check: PASSED

All 7 created/modified files found on disk; all 3 task commits (`d30fcb7`, `9920f8b`, `ad5db1c`) found in git history.
