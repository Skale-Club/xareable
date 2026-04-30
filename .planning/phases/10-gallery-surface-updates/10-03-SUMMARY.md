---
phase: 10-gallery-surface-updates
plan: 03
subsystem: ui
tags: [react, typescript, tailwindcss, lucide-react, supabase, gallery, carousel, i18n]

# Dependency graph
requires:
  - phase: 10-gallery-surface-updates
    plan: 01
    provides: postGalleryItemSchema with slide_count and status fields; posts.tsx SELECT extended
  - phase: 10-gallery-surface-updates
    plan: 02
    provides: gallery i18n strings for PT and ES (Carousel·{n}, Enhanced, Draft, accessibility labels)

provides:
  - "assertNever(x: never): never exhaustiveness guard function"
  - "getContentTypeIcon(contentType, t) helper with 4-arm switch covering image/video/carousel/enhancement"
  - "Carousel deck-stack visual (two background card strips behind main tile)"
  - "Carousel · N badge (bottom-left, sourced from post.slide_count)"
  - "Enhanced badge (bottom-left, violet-400/15 styling)"
  - "Draft badge (top-right, orange-500/10 styling, replaces version badge for draft posts)"
  - "SELECT and fallback ladder with slide_count and status as first-rung fallback"

affects:
  - 10-gallery-surface-updates/10-04 (slide viewer reads slide_count passed via openViewer)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "assertNever exhaustiveness guard: default branch in content_type switch calls assertNever(contentType) forcing compile error on new union values"
    - "Deck-stack visual: two absolutely-positioned sibling divs (translate-x-1, translate-x-2) behind z-10 image container"
    - "Param interpolation: t(key).replace('{n}', String(value)) — project t() only accepts 1 argument"
    - "Column-missing fallback ladder: slide_count||status check is first rung, expires_at is second rung"

key-files:
  created: []
  modified:
    - client/src/pages/posts.tsx

key-decisions:
  - "t() function only accepts 1 argument; t('Carousel · {n}').replace('{n}', String(n)) used for interpolation instead of t(key, {n}) pattern from the plan spec"
  - "Cherry-picked plan 10-01 (schema extension) and 10-02 (i18n strings) into this worktree as dependency base — those commits were on a sibling branch not yet merged here"
  - "Column-missing fallback order: slide_count||status first (newest columns), then expires_at — trying to drop newest additions first on older DB deployments"

patterns-established:
  - "getContentTypeIcon pattern: module-level helper returns absolute-positioned pill JSX, called as single JSX expression {getContentTypeIcon(post.content_type, t)}"
  - "Deck-stack carousel wrapper: outer relative div, two aria-hidden strip divs, inner relative z-10 aspect-square div"

requirements-completed: [GLRY-01, GLRY-02, GLRY-04]

# Metrics
duration: 30min
completed: 2026-04-30
---

# Phase 10 Plan 03: Gallery Surface Updates — Tile Rendering Summary

**Gallery tiles now distinguish carousel (deck-stack + Carousel·N badge), enhancement (violet Enhanced badge), and draft carousels (orange Draft badge) with a TypeScript exhaustiveness guard ensuring future content_type values force a compile error**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-04-30T07:05:07Z
- **Completed:** 2026-04-30T07:35:00Z
- **Tasks:** 3
- **Files modified:** 1 (client/src/pages/posts.tsx), plus cherry-picked dependencies from plans 10-01 and 10-02

## Accomplishments
- Extended SELECT fallback ladder with combined slide_count||status as the first rung (graceful degradation for older DB deployments)
- Added `assertNever(x: never): never` and `getContentTypeIcon` helpers satisfying GLRY-04 exhaustiveness requirement
- Replaced binary video/image icon block with a 4-arm switch covering all content types with aria-labels
- Rendered carousel deck-stack visual (two strip divs at translate-x-1/translate-x-2 behind z-10 tile)
- Added Carousel · N badge (bottom-left) sourced from `post.slide_count` with null-fallback to "Carousel"
- Added violet "Enhanced" badge (bottom-left) for enhancement posts
- Added orange "Draft" badge (top-right) for draft posts, replacing the version badge; V{n} badge preserved as the else-branch
- TypeScript compiles cleanly (exit 0)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Supabase SELECT with slide_count and status; add column-missing fallback** - `74c0ed4` (feat)
2. **Task 2: Add getContentTypeIcon helper with assertNever exhaustiveness guard** - `2dc9bef` (feat)
3. **Task 3: Render carousel deck-stack, Carousel·N badge, Enhanced badge, Draft badge** - `204dd13` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `client/src/pages/posts.tsx` - All three tasks applied: SELECT extension, assertNever+getContentTypeIcon helpers, deck-stack wrapper + three badge overlays
- `shared/schema.ts` - Cherry-picked from plan 10-01: postGalleryItemSchema extended with slide_count and status
- `client/src/lib/translations.ts` - Cherry-picked from plan 10-02: 12 gallery i18n strings for PT and ES

## Decisions Made
- `t()` function in this project only accepts a single string argument; `t("Carousel · {n}", { n })` pattern specified in the plan was invalid TypeScript. Fixed by using `t("Carousel · {n}").replace("{n}", String(post.slide_count))` — this is functionally equivalent and follows the project's actual param interpolation convention.
- The Plan 10-01 and Plan 10-02 commits were on a different branch lineage not yet merged into this worktree. Both were cherry-picked as `--no-commit` before executing Plan 10-03's tasks, then included in Task 1's commit.
- The column-missing fallback ladder now tries dropping `slide_count` and `status` first (returning to the `expires_at`-only SELECT), then tries dropping `expires_at`, then falls back to the minimal SELECT. This ordering matches the principle of "try dropping the newest additions first."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error: t() only accepts 1 argument**
- **Found during:** Task 3 (carousel badge rendering)
- **Issue:** Plan spec used `t("Carousel · {n}", { n: post.slide_count })` but `t: (text: string) => string` is the actual project signature — TypeScript error TS2554: Expected 1 arguments, but got 2.
- **Fix:** Changed to `t("Carousel · {n}").replace("{n}", String(post.slide_count))` — same runtime behavior, valid TypeScript.
- **Files modified:** `client/src/pages/posts.tsx`
- **Verification:** `npm run check` exits 0
- **Committed in:** 204dd13 (Task 3 commit)

**2. [Rule 3 - Blocking] Cherry-picked plan 10-01 and 10-02 dependencies into worktree**
- **Found during:** Before Task 1 execution
- **Issue:** This worktree was based on a commit before plan 10-01 and 10-02 ran — `postGalleryItemSchema` was missing `slide_count`/`status` fields and translations were absent. Plan 10-03 depends on both.
- **Fix:** `git cherry-pick b5b3144 0aabf08 --no-commit` to bring in schema extension and i18n strings, then staged with Task 1's changes.
- **Files modified:** `shared/schema.ts`, `client/src/lib/translations.ts`, `client/src/pages/posts.tsx`
- **Verification:** `npm run check` exits 0 after cherry-pick
- **Committed in:** 74c0ed4 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 — bug, 1 Rule 3 — blocking dependency)
**Impact on plan:** Both fixes required for correctness. No scope creep — the t() fix is a direct substitute with identical runtime behavior. The cherry-pick brings in the declared dependencies that were missing from the worktree.

## Issues Encountered
None beyond the two auto-fixed deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Gallery tiles now correctly render carousel (deck-stack + Carousel·N badge), enhancement (Enhanced badge), and draft carousels (Draft badge)
- `openViewer` calls pass `post.slide_count ?? null` — Plan 04 (slide viewer dialog) can read `viewingPost.slide_count` without further change
- TypeScript exhaustiveness guard is in place — adding a 5th content_type value to the enum will cause a compile error at the `assertNever(contentType)` call site
- No blockers.

---
*Phase: 10-gallery-surface-updates*
*Completed: 2026-04-30*
