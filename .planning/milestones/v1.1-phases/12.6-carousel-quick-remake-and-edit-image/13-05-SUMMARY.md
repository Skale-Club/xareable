---
phase: 13-carousel-quick-remake-and-edit-image
plan: 05
subsystem: i18n + verification + uat
tags: [i18n, translations, provider-parity, verify-script, uat, CRSL-EDIT-06]

requires:
  - phase: 13-carousel-quick-remake-and-edit-image
    plan: 03
    provides: PostEditDialog carousel-slide variant with Phase 13 EN strings
  - phase: 13-carousel-quick-remake-and-edit-image
    plan: 04
    provides: PostViewerDialog carousel branches with Phase 13 EN strings
  - phase: 13-carousel-quick-remake-and-edit-image
    plan: 02
    provides: scripts/verify-phase-13.ts with 6 active checks (CRSL-EDIT-01/03/04/05)

provides:
  - PT + ES translations for all Phase 13 EN strings (21 entries each)
  - CRSL-EDIT-06 provider parity static check (Check 7 in verify-phase-13.ts)
  - 13-UAT.md human-executable UAT script for both Gemini and OpenAI providers

affects:
  - client/src/lib/translations.ts (PT + ES dictionaries extended)
  - scripts/verify-phase-13.ts (7/7 active checks, no SKIP)
  - .planning/phases/13-carousel-quick-remake-and-edit-image/13-UAT.md (new)

tech-stack:
  added: []
  patterns:
    - "Flat EN-keyed translation dictionary with {n} placeholder preserved literally (Phase 09-01 convention)"
    - "Static grep checks in verify-phase-13.ts using dynamic import('node:fs') consistent with checks 2-6"

key-files:
  created:
    - .planning/phases/13-carousel-quick-remake-and-edit-image/13-UAT.md
  modified:
    - client/src/lib/translations.ts
    - scripts/verify-phase-13.ts

key-decisions:
  - "Included 'Cannot quick remake' and 'Original generation prompt not available.' translations from plan table even though not currently in source — future-proofs if those toast paths are added (zero cost, zero risk)"
  - "CRSL-EDIT-06 check validates route window (not full file) to avoid false positives from carousel-generation service imports"
  - "CRSL-EDIT-02 and CRSL-EDIT-07 intentionally excluded from static checks — they require live UI interaction and live billing observation; covered by 13-UAT.md"
  - "UAT script numbered 1-based with checkboxes; sign-off table per provider to support operator record-keeping"

metrics:
  duration: 15min
  completed: 2026-05-18T10:05:00Z
  tasks: 3
  files_modified: 2
  files_created: 1
---

# Phase 13 Plan 05: i18n, Provider-Parity Verify, and UAT Script Summary

**PT + ES translations for 21 Phase 13 EN strings; verify-phase-13.ts promoted to 7/7 CRSL-EDIT-01..06 active checks; 13-UAT.md authored for human sign-off on both Gemini and OpenAI providers**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-05-18T10:05:00Z
- **Tasks:** 3 (+ checkpoint:human-verify gate pending)
- **Files modified:** 2 (translations.ts, verify-phase-13.ts)
- **Files created:** 1 (13-UAT.md)

## Accomplishments

### Task 1: PT + ES translations for Phase 13 strings

Added 21 entries each to the PT and ES dictionaries in `client/src/lib/translations.ts`, covering every EN string introduced by Plans 13-03 and 13-04:

| EN key (abbreviated) | Notes |
|---|---|
| `Edit slide {n}` | `{n}` placeholder preserved literally |
| `Editing slide 1 may affect the visual style of the rest of the carousel.` | In-dialog drift warning banner |
| `Editing slide 1` | Toast title when Edit Image clicked on slide 1 |
| `Slide 1 sets the visual style for the rest of the carousel. Edits may cause visual drift in other slides.` | Toast description for slide-1 edit intent |
| `Slide not ready` / `Please wait for slides to load.` | Quick Remake guard when slides not loaded |
| `Cannot quick remake` / `Original generation prompt not available.` | Future-proofed (in plan table, not yet used in source) |
| `Remaking slide...` | Quick Remake progress message |
| `Slide remade` / `Slide {n} updated.` | Quick Remake complete toast |
| `Quick remake failed` | Quick Remake error toast |
| `Slide updated` / `Slide {n} edited.` | Edit Slide complete toast |
| `Edit Slide` | Generate button label in carousel-slide variant |
| `Starting slide edit...` | Carousel edit initial progress message |
| `Slide edited successfully` | Edit success toast title |
| `Could not edit slide` | Edit error fallback description |

Verification: `node -e "..."` key-presence check confirmed all 8 required keys.

### Task 2: CRSL-EDIT-06 provider parity check

Added Check 7 to `scripts/verify-phase-13.ts`:

**Part A — route abstraction:**
- Asserts `/api/carousel/slide/edit` route window calls `getActiveImageProvider(`
- Asserts no `new GoogleGenerativeAI(` or `new OpenAI(` instantiation inside route window
- Asserts `provider.name === "openai"` conditional guard for `imageApiKey` selection

**Part B — provider implementations:**
- Asserts `GeminiImageProvider` class present with `async edit()`
- Asserts `OpenAIImageProvider` class present with `async edit()`
- Asserts `ImageEditInput.additionalRefs?:` declared in interface
- Asserts `OpenAIImageProvider.edit` references `additionalRefs` in its implementation

Result: `7/7 PASS, 0 SKIP, 0 FAIL`

Updated header comment: `// Phase 13 verify — CRSL-EDIT-01..06`

### Task 3: 13-UAT.md authored

Created `.planning/phases/13-carousel-quick-remake-and-edit-image/13-UAT.md` with:

- **Pre-flight** checklist: migration, dev server, carousel post creation, 7/7 verify
- **Provider A (Gemini):** 13 numbered steps with pass/fail checkboxes covering CRSL-EDIT-01, 02, 03, 04, 05, 07
- **Provider B (OpenAI):** Repeat steps + additionalRefs log verification (CRSL-EDIT-06)
- **Regression block:** non-carousel Edit Image (2-step dialog) and Quick Remake routing
- **Sign-off table** per provider with notes field for failure narrative and gap-plan guidance

## Task Commits

1. **Task 1: PT+ES translations** — `1809068 feat(13-05): add PT+ES translations for Phase 13 carousel slide edit strings`
2. **Task 2: CRSL-EDIT-06 verify check** — `219e778 feat(13-05): add CRSL-EDIT-06 provider parity check to verify-phase-13.ts`
3. **Task 3: 13-UAT.md** — `b35280f docs(13-05): add Phase 13 UAT script for carousel slide edit + quick remake`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — translations.ts entries are fully wired. `Cannot quick remake` and `Original generation prompt not available.` were added per the plan's translation table as future-proof entries; they are not referenced by source yet but adding them now costs nothing and avoids a future omission.

## Human UAT Gate (Pending)

Task 3 includes a `checkpoint:human-verify` gate. The UAT script has been authored and committed. The operator must:

1. Apply migration `20260518000000_post_slide_versions.sql` via Supabase dashboard (if not already done in 13-01).
2. Run `npx tsx scripts/verify-phase-13.ts` — confirm 7/7 PASS.
3. Execute UAT for Provider A (Gemini) and Provider B (OpenAI).
4. Record PASS/FAIL per provider in the sign-off table inside `13-UAT.md`.

If any step fails: open a `/gsd:plan-phase 13 --gaps` follow-up and describe the failure.

## Self-Check: PASSED

- `client/src/lib/translations.ts` contains `Editing slide 1 may affect` — confirmed
- `scripts/verify-phase-13.ts` contains `GeminiImageProvider` — confirmed
- `scripts/verify-phase-13.ts` reports 7/7 PASS — confirmed
- `.planning/phases/13-carousel-quick-remake-and-edit-image/13-UAT.md` exists (104 lines) — confirmed
- `npm run check` exits 0 (zero TypeScript errors) — confirmed
- `1809068`, `219e778`, `b35280f` commits verified in git log — confirmed
