---
phase: 19-settings-ui-style-tab
plan: "01"
subsystem: frontend-settings
tags: [settings, style-tab, reference-photos, tanstack-query, supabase-storage]
dependency_graph:
  requires: [18-01]
  provides: [style-tab-ui, reference-photo-upload, style-description-save]
  affects: [client/src/pages/settings.tsx]
tech_stack:
  added: []
  patterns: [useQuery-direct-import, queryClient-direct-import, supabase-storage-upload, cache-invalidation]
key_files:
  created:
    - scripts/verify-phase-19.ts
  modified:
    - client/src/pages/settings.tsx
decisions:
  - "Direct queryClient import from @/lib/queryClient (not useQueryClient hook) — consistent with trash.tsx, credits.tsx project pattern"
  - "uploadingPhoto: boolean (not per-slot ID) — spinner only on first empty slot (i===0)"
  - "styleDescription sync merged into existing [brand] useEffect (not a second effect)"
  - "upsert: false with crypto.randomUUID() path — UUID guarantees no collision, no overwrite risk"
metrics:
  duration_minutes: 25
  completed_date: "2026-05-16"
  tasks_completed: 4
  tasks_total: 4
  files_modified: 2
---

# Phase 19 Plan 01: Settings UI — Style Tab Summary

## One-liner

Added 4th "Style" tab to settings.tsx with 10-slot reference photo grid (drag-drop + file picker, X-to-delete on hover) and style description textarea (1000-char limit with counter, PATCH + refreshBrand on save).

## What Was Built

The Settings page now has four tabs (Info, Colors, Logo, Style). The Style tab provides:

1. **Style References card** — a responsive photo grid (`grid-cols-3 sm:grid-cols-4 md:grid-cols-5`) showing up to 10 brand reference photos. Filled slots display the thumbnail with an X button visible on hover. Empty slots act as file-picker labels with drag-and-drop support. Uploads go directly to Supabase Storage at `${user.id}/references/${uuid}.${ext}`, then the public URL is POSTed to `/api/brand/reference-photos`. Cache is invalidated after upload/delete via `queryClient.invalidateQueries`.

2. **Visual Style card** — a Textarea bounded at 1000 characters with a live counter (`{n}/1000`). The Save button calls `PATCH /api/brand/style-description`, then `refreshBrand()` to sync the auth context, then shows a success toast.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Imports, state vars, useQuery, useEffect sync | 63c97ad | client/src/pages/settings.tsx |
| 2 | handleUploadPhoto, handleDeletePhoto, handleSaveStyleDescription | 50afe4e | client/src/pages/settings.tsx |
| 3 | TabsList grid-cols-4, 4th TabsTrigger, Style TabsContent block | 618b32c | client/src/pages/settings.tsx |
| 4 | Static verification harness scripts/verify-phase-19.ts | 229d074 | scripts/verify-phase-19.ts |

## Verification

- `npm run check` — exits 0 (no TypeScript errors)
- `npx tsx scripts/verify-phase-19.ts` — 28/28 checks passed (SET-01: 4, SET-02: 12, SET-03: 8, imports: 4)

## Deviations from Plan

None — plan executed exactly as written. All 6 edits in Task 1, 3 handlers in Task 2, 3 JSX edits in Task 3, and the 28-assertion verification harness in Task 4 all followed the plan specifications exactly.

## Known Stubs

None. The Style tab is fully wired end-to-end:
- useQuery fetches real photos from `/api/brand/reference-photos` (Phase 18 endpoint)
- Upload flow uploads to real Supabase Storage and calls the real POST endpoint
- Style description saves to real `/api/brand/style-description` PATCH endpoint
- All data flows to UI rendering without placeholders

## Self-Check: PASSED

- `client/src/pages/settings.tsx` — modified (confirmed via git log)
- `scripts/verify-phase-19.ts` — created (confirmed via git log)
- All 4 task commits exist: 63c97ad, 50afe4e, 618b32c, 229d074
- `npm run check` exits 0
- `npx tsx scripts/verify-phase-19.ts` exits 0 with 28/28 passed
