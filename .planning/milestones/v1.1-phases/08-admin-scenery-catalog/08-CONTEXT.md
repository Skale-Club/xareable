# Phase 8: Admin — Scenery Catalog - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a `SceneriesCard` component to the existing Post Creation admin tab so administrators can create, edit, and delete scenery presets. The card follows the exact patterns of the 5 existing catalog cards (`TextStylesCard`, `PostMoodsCard`, etc.) and uses the already-present `sceneries` field in `StyleCatalog`. No new API endpoints are needed — `PATCH /api/admin/style-catalog` already accepts sceneries.

**Out of scope:** Enhancement creator dialog UI (Phase 9), gallery surface (Phase 10), per-scenery image upload to Storage (URL input only in v1.1).

</domain>

<decisions>
## Implementation Decisions

### Item layout inside the card
- **D-01:** Use the Accordion pattern from `TextStylesCard` — each scenery item expands to show/edit its fields inline. Flat rows are insufficient because `prompt_snippet` can span multiple sentences and needs a `<Textarea>`. The accordion keeps the list scannable at a glance while giving full edit access on expand.

### Add / Edit flow
- **D-02:** Add new sceneries via a Dialog (same pattern as `TextStylesCard` → Dialog with form fields → adds to local `catalog` state). No separate "edit mode" — inline editing inside the accordion item is sufficient for the three editable fields (`label`, `prompt_snippet`, `preview_image_url`). Inline edits update local state immediately; `AdminFloatingSaveButton` persists.
- **D-03:** ID is auto-generated from label using `slugifyCatalogId(label)` with a numeric suffix deduplication loop — mirrors `TextStylesCard` exactly. IDs are not user-editable.

### `is_active` toggle
- **D-04:** Include the `is_active` boolean toggle in the admin UI (checkbox or Switch component per existing admin UI style). Admins can disable a preset without deleting it. The enhancement service's `resolveScenery()` must filter to `is_active === true` — this is already scoped to Phase 6 (verify at planning time). The 12 seeded presets all start `is_active: true`.

### `preview_image_url` field
- **D-05:** Include a plain URL text input for `preview_image_url` in the add/edit form. It is nullable — empty input saves as `null`. Binary upload (via `image-upload-field.tsx`) is deferred; URL input is sufficient for v1.1 and Phase 9 can render it as a `<img>` thumbnail in the scenery picker.

### Wiring into PostCreationTab
- **D-06:** Add `SceneriesCard` as a full-width row at the bottom of `PostCreationTab`'s grid, below the `PostFormatsCard` rows. Same pattern as other full-width cards (`TextStylesCard`). Component receives `catalog` and `setCatalog` props identical to all other cards.

### No delete guard
- **D-07:** No minimum-count guard on delete (unlike `TextStylesCard` which requires ≥1 text style). Admins can delete all sceneries — the enhancement service handles an empty sceneries array gracefully (returns a typed error). Prevents blocking legitimate catalog resets.

### Claude's Discretion
- Exact field ordering in the add/edit Dialog form (suggested: label → prompt_snippet → preview_image_url → is_active)
- Exact placeholder text and label copy for each field
- Whether to show a character count hint on `prompt_snippet`
- Icon choice for the SceneriesCard header (suggested: `Sparkles` or `Image` from lucide-react, consistent with other catalog cards)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing pattern to mirror exactly
- `client/src/components/admin/post-creation/text-styles-card.tsx` — The canonical card pattern: Accordion item list, Dialog for add, inline editing in accordion, `slugifyCatalogId` for ID generation, `setCatalog` state updater pattern
- `client/src/components/admin/post-creation-tab.tsx` — Where SceneriesCard is wired in; shows grid layout, `AdminFloatingSaveButton`, and how other cards receive `catalog`/`setCatalog`

### Schema (source of truth for Scenery type)
- `shared/schema.ts` lines 167–192 — `scenerySchema`, `Scenery` type, and `styleCatalogSchema` with `sceneries` field
- `shared/schema.ts` — `DEFAULT_STYLE_CATALOG` (check if sceneries are included; if not, planner must add them)

### Existing admin utilities
- `client/src/lib/admin/utils.ts` — `slugifyCatalogId()` function used for ID generation
- `client/src/components/admin/post-creation/index.ts` — barrel export; `SceneriesCard` must be added here

### API (no changes needed, just for reference)
- `server/routes/style-catalog.routes.ts` — `PATCH /api/admin/style-catalog` already accepts and persists the full `StyleCatalog` including `sceneries`; `getStyleCatalogPayload()` already returns sceneries

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TextStylesCard` (accordion + dialog pattern) — copy this structure verbatim, substituting `Scenery` fields
- `AdminFloatingSaveButton` — already handles save; no changes needed
- `slugifyCatalogId` from `@/lib/admin/utils` — reuse for scenery ID generation
- `Dialog`, `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` — all already imported in TextStylesCard; same imports apply
- `Switch` component from `@/components/ui/switch` — likely the right control for `is_active`; check if it exists in the ui/ directory
- `Textarea` from `@/components/ui/textarea` — already used in project; needed for `prompt_snippet`

### Established Patterns
- Cards accept `{ catalog: StyleCatalog; setCatalog: React.Dispatch<...> }` props — no exceptions
- Local state mutation → `AdminFloatingSaveButton` save — do NOT add per-item save buttons
- `useMemo` to derive the working array from `catalog.sceneries` with fallback to `[]` (not `DEFAULT_STYLE_CATALOG.sceneries` since sceneries start seeded in the DB, not in the DEFAULT constant)
- Toast notifications on validation errors (label required, etc.)
- `useTranslation()` hook for all user-facing strings

### Integration Points
- `client/src/components/admin/post-creation-tab.tsx` — add `import { SceneriesCard } from "./post-creation"` and render `<SceneriesCard catalog={currentCatalog} setCatalog={setCatalog} />` at bottom of grid
- `client/src/components/admin/post-creation/index.ts` — add `export { SceneriesCard } from "./sceneries-card"`
- `shared/schema.ts` `DEFAULT_STYLE_CATALOG` — verify whether `sceneries: []` needs to be added as a default (the 12 presets are seeded in DB, not hardcoded in the DEFAULT; the DEFAULT is only a fallback when DB row is absent)

</code_context>

<specifics>
## Specific Ideas

- The 12 seeded scenery IDs are: `white-studio`, `marble-light`, `marble-dark`, `wooden-table`, `concrete-urban`, `outdoor-natural`, `kitchen-counter`, `dark-premium`, `softbox-studio`, `pastel-flat`, `seasonal-festive`, `cafe-ambience` — these will appear in the list immediately from the DB; no hardcoding needed in the component
- `preview_image_url` is nullable in the schema — the form should save `null` (not empty string) when the URL input is blank

</specifics>

<deferred>
## Deferred Ideas

- Binary image upload for scenery preview (use `image-upload-field.tsx` to upload to Supabase Storage) — URL input is sufficient for v1.1; upgrade in v2 when creator dialog needs high-quality thumbnails
- Per-scenery usage stats (how many enhancements used each preset) — analytics phase

</deferred>

---

*Phase: 08-admin-scenery-catalog*
*Context gathered: 2026-04-22*
