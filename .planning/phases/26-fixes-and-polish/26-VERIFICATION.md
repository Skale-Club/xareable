---
phase: 26-fixes-and-polish
verified: 2026-07-28T00:00:00Z
status: human_needed
score: 5/5 success criteria code-verified in the actual codebase; operator live sign-off (26-HUMAN-UAT.md) intentionally outstanding, not a code gap
human_verification:
  - test: "Live idempotency — generate (POL-06)"
    expected: "Two identical POST /api/generate requests, same idempotency_key -> second returns HTTP 200 {\"idempotent\": true, post}, no SSE stream; exactly 1 posts row and 1 usage_events row for that key"
    why_human: "Requires the live Coolify production host, live Supabase project, and a real paid OpenRouter generation; already logged as pending in 26-HUMAN-UAT.md"
  - test: "Live idempotency — edit (POL-06)"
    expected: "Two identical POST /api/edit-post requests, same idempotency_key -> second returns {\"idempotent\": true, version}; exactly 1 post_versions row, version_number unchanged. A true concurrent race still surfaces as a generic 500 by design, not a regression"
    why_human: "Requires live production + Supabase + a real generation to edit; both Phase 26 migrations must be applied to the live DB first"
  - test: "Adaptive JPEG (no-alpha) logo overlay (POL-03)"
    expected: "A no-alpha JPEG logo gets a soft plate, never a raw opaque box; cleanest corner auto-selected when logo_position is unset; an explicit logo_position is never overridden"
    why_human: "Requires a real uploaded brand logo and visual judgment of the composited output; the code-level decision logic (plateApplied/autoSelected/position) is already proven by scripts/test-logo-overlay-contrast.ts (10/10), but human eyes must confirm the rendered result looks right"
  - test: "WebP quality + text-edge visual check (POL-02)"
    expected: "Crisp glyph edges at quality 85 (200% zoom, no ringing/mosquito artifacts); the drawBlocks per-block font fix is visible (headline plainly larger than the CTA in a multi-block layout); reference ratios q40=0.9934/q85=0.9977/q95=0.9992 against threshold 0.996"
    why_human: "Requires a real generated post and human visual judgment of compression artifacts; the numeric proof already passes automatically (scripts/verify-webp-text-edge.ts)"
  - test: "Feedback round trip (POL-09)"
    expected: "up -> down -> null on one post's feedback field via the viewer's thumbs-up/down control; the active vote state survives dialog reopen"
    why_human: "Requires a live user session against a real post; the endpoint/UI wiring is already statically and functionally proven"
  - test: "Admin Quality dashboard (POL-09)"
    expected: "Feedback tally matches raw SQL count; the 7/30/90-day window toggle changes the numbers; a non-admin GET /api/admin/quality returns 403"
    why_human: "Requires live admin + non-admin sessions against real generation_logs/posts data"
  - test: "No-regression sweep + POL-08 handoff"
    expected: "Video, carousel, enhancement, single-image, and legacy-edit flows all succeed unchanged in production; docs/cost-reconciliation-runbook.md confirmed scheduled/Pending (non-blocking, not run)"
    why_human: "Requires real paid AI calls against the live gateway; cannot be simulated in a sandbox"
  - test: "Migration application (prerequisite)"
    expected: "supabase/migrations/20260730000000_post_versions_idempotency_key.sql and supabase/migrations/20260730000001_posts_feedback.sql applied to the live Supabase project"
    why_human: "Requires live Supabase project access; steps 1/2/5/6 above are meaningless without it"
---

# Phase 26: Fixes & Polish Verification Report

**Phase Goal:** The remaining output-quality and hygiene gaps close out the milestone — sharper WebP compression with a text-edge quality check, contrast-aware adaptive logo overlay, idempotent generate/edit APIs, a post-migration cost reconciliation against the OpenRouter dashboard (scheduled only, non-gating), and a thumbs-up/down feedback loop surfaced on an admin quality dashboard.

**Verified:** 2026-07-28
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Images save at WebP quality 85+ with an automated text-edge regression check | VERIFIED | `server/services/image-optimization.service.ts:37` declares `const DEFAULT_IMAGE_QUALITY = 85;` (old `= 80` literal confirmed gone); `DEFAULT_THUMBNAIL_OPTIONS.quality` still `70`; `scripts/verify-webp-text-edge.ts` exits 0 with a real calibrated ratio table (q40=0.9934, q85=0.9977, q95=0.9992, threshold 0.996), including a genuine non-vacuity control (q40 fails) |
| 2 | Adaptive, contrast-aware logo overlay; JPEG (no-alpha) logos never produce an opaque-box artifact; explicit position never overridden | VERIFIED (code) / human visual sign-off outstanding | `applyLogoOverlayDetailed` in `image-optimization.service.ts:213-378` reads source-buffer `hasAlpha`, calls `analyzeRegionContrast` (imported, not reimplemented), sets `plateApplied = !logoHasAlpha \|\| contrast.scrimNeeded`, renders a real clamped/inset/blurred SVG plate — not a comment. `position !== undefined` short-circuits straight to `chosenPosition = position; autoSelected = false` with no re-evaluation; auto-selection runs only in the `else` branch. `scripts/test-logo-overlay-contrast.ts` exits 0 (10/10) |
| 3 | Duplicate `/api/generate`/`/api/edit-post` submissions never double-post or double-charge | VERIFIED | Both routes run an admin-client pre-flight `SELECT` before `checkCredits(` and before `applyLogoOverlay(` (confirmed by direct byte-offset reading, not just harness trust). `generate.routes.ts` scoped `(idempotency_key, user_id)` on `posts`; `edit.routes.ts` scoped `(idempotency_key, post_id)` on `post_versions` with **no** `.eq("user_id", ...)` in that block (confirmed — `post_versions` has no such column). All 4 client call sites (`post-creator-dialog.tsx`, `post-edit-dialog.tsx`'s non-carousel branch only, `quick-remake.ts`, `posts.tsx`) send a fresh `crypto.randomUUID()` |
| 4 | Cost reconciliation audit set up and scheduled, non-gating | VERIFIED | `docs/cost-reconciliation-runbook.md` (110 lines) names `usage_events.cost_usd_micros` as sole source of truth, a 5% threshold, a computable trigger SQL, and explicitly "does not gate the v1.6 milestone close". `scripts/reconcile-openrouter-costs.ts` queries only `usage_events`, exits 0 cleanly with no credentials (no real creds needed to run/type-check), and is registered in zero schedulers (`cleanup-cron.service.ts`, `.github/workflows/` both grep-clean) |
| 5 | Thumbs-up/down feedback + admin Quality dashboard | VERIFIED | `postSchema.feedback` + `postFeedbackRequestSchema` in `shared/schema.ts`; `PATCH /api/posts/:id/feedback` in `posts.routes.ts` (ownership-checked, overwriting `.update({feedback})`); `GET /api/admin/quality` in `admin-quality.routes.ts` (admin-guarded, read-only, aggregates `posts.feedback` + `generation_logs` visual_critic/model_fallback); registered in `server/routes/index.ts`; `QualityTab` wired into `admin.tsx`'s `renderTab` and `app-sidebar.tsx`'s nav; `post-viewer-dialog.tsx` has a real `ThumbsUp`/`ThumbsDown` control PATCHing the endpoint |

**Score:** 5/5 truths code-verified. Live/human confirmation of truths 2, 3, 5 (and the no-regression sweep) is the one remaining checkpoint, already captured as a pending, non-fabricated human-UAT log rather than skipped.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/services/image-optimization.service.ts` | `DEFAULT_IMAGE_QUALITY = 85`, `applyLogoOverlayDetailed` | VERIFIED | Line 37 confirmed; `applyLogoOverlayDetailed`/`applyLogoOverlay` both present, full algorithm read in full, not a stub |
| `scripts/verify-webp-text-edge.ts` | Standalone text-edge regression gate | VERIFIED | Ran directly: exits 0, prints calibrated ratio table, non-vacuity control present |
| `server/services/typography-compositor.service.ts` | `drawBlocks` sets `ctx.font` per block; `analyzeRegionContrast` region-scoped | VERIFIED | Line 576: `ctx.font = \`${layout.size_px}px ${layout.alias}\`` inside `layouts.forEach` (line 568), first statement of the loop body. `analyzeRegionContrast` (lines 317-385) materializes the extracted region to a raw buffer (`.extract().raw().toBuffer()`) then computes `.stats()` on a fresh `sharp()` instance over just that buffer — genuinely fixes the whole-image-stats bug, not a workaround that hides it elsewhere. `COMPOSITOR_VERSION` still `= 1` |
| `scripts/test-drawblocks-font-state.ts` | Real-pixel ink-extent proof | VERIFIED | Exists, exits 0 per `verify-phase-26.ts`'s functional check |
| `shared/schema.ts` | `idempotency_key` on generate/editPost (top-level, required UUID) + `postVersionSchema` (nullable) + `postSchema.feedback` | VERIFIED | Lines 1367 (`generateRequestSchema`), 1452 (`editPostRequestSchema`, positioned before `edit_context` at 1453), 1484 comment confirms `editSlideRequestSchema` deliberately has none, 946 (`postVersionSchema`, nullable), 876 (`postSchema.feedback`, nullable enum) |
| `supabase/migrations/20260730000000_post_versions_idempotency_key.sql` | Additive `post_versions.idempotency_key` + partial unique index | VERIFIED | Read in full: `add column if not exists` + `create unique index if not exists ... where idempotency_key is not null` |
| `supabase/migrations/20260730000001_posts_feedback.sql` | Additive `posts.feedback` + CHECK constraint | VERIFIED | Read in full: `add column if not exists feedback text` + guarded `do $$ ... add constraint posts_feedback_check check (feedback is null or feedback in ('up','down'))` |
| `server/routes/generate.routes.ts` / `edit.routes.ts` | Pre-flight dedup before credit gate + insert wiring | VERIFIED | Byte-offset-read (not grep-trusted): idempotency check precedes `checkCredits(` in both files; `idempotency_key` present in both insert objects |
| `server/routes/posts.routes.ts` | `PATCH /api/posts/:id/feedback` | VERIFIED | Lines 443-452: auth, Zod parse, ownership check (403/404), scoped update, 200 response |
| `server/routes/admin-quality.routes.ts` | `GET /api/admin/quality` | VERIFIED | 195-line file read in full: `requireAdminGuard`, 3 real Supabase queries (posts.feedback, generation_logs visual_critic, generation_logs model_fallback), missing-schema tolerance, strictly read-only (no insert/update/delete) |
| `client/src/components/admin/quality-tab.tsx` | `QualityTab` — 3-card dashboard | VERIFIED | 284-line file read in full: real `useQuery` against `/api/admin/quality`, 3 cards, window selector, guarded ratios (no raw NaN/Infinity possible — all through `formatPercent`/`formatRatio`) |
| `docs/cost-reconciliation-runbook.md` | POL-08 runbook | VERIFIED | 110 lines, read in full: source-of-truth table, trigger SQL, 5% threshold, 6-step procedure, benign-delta list, empty audit log |
| `scripts/reconcile-openrouter-costs.ts` | POL-08 scaffold | VERIFIED | 283 lines, read in full: queries only `usage_events`, exits 0 with no credentials, zero cron/workflow registration |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `generate.routes.ts` idempotency pre-flight | `checkCredits(` / `applyLogoOverlay(` | source-position ordering | WIRED | Confirmed by direct read: pre-flight at line ~367-375, `checkCredits(` at line 412, `applyLogoOverlay(` at line 802 — correct order |
| `edit.routes.ts` idempotency pre-flight | `checkCredits(` / `applyLogoOverlay(` | source-position ordering | WIRED | Pre-flight at line ~353-362, `checkCredits(` at line 365, `applyLogoOverlay(` at line 740 — correct order |
| 4 client call sites | `idempotency_key` on request body | `crypto.randomUUID()` | WIRED | `post-creator-dialog.tsx:486,511`; `post-edit-dialog.tsx:326,355` (non-carousel branch only — confirmed by reading the ternary); `quick-remake.ts:25`; `posts.tsx:506` |
| `image-optimization.service.ts` | `typography-compositor.service.ts`'s `analyzeRegionContrast` | import + call | WIRED | Imported at line 12, called at lines 280 and 294 |
| `posts.routes.ts` feedback handler | `posts.feedback` column | `.update({feedback})` scoped by id+user_id | WIRED | Line 449 |
| `admin-quality.routes.ts` | `posts.feedback` / `generation_logs` | `.select(...).eq("event_kind", ...)` | WIRED | Lines 92-97 (feedback), 125-130 (visual_critic), 163-168 (model_fallback) |
| `server/routes/index.ts` | `admin-quality.routes.ts` | import + `router.use` | WIRED | Lines 34, 123 |
| `admin.tsx` / `app-sidebar.tsx` | `QualityTab` | `case "quality"` / `adminNavItems` | WIRED | `admin.tsx:21,55-56`; `app-sidebar.tsx:20,36` |
| `post-viewer-dialog.tsx` | `PATCH /api/posts/:id/feedback` | `apiRequest("PATCH", ...)` | WIRED | Lines 406-411, real mutation with toast + cache update |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `quality-tab.tsx` | `data` (feedback/critic/fallback) | `useQuery` -> `adminFetch("/api/admin/quality?days=...")` -> real Supabase `.select()` aggregation in `admin-quality.routes.ts` | Yes — three real DB queries, in-process aggregation, no static/empty fallback in the happy path | FLOWING |
| `post-viewer-dialog.tsx` | `feedback` state | Initialized from `viewingPost.feedback` / a live re-fetch (`.select("ai_prompt_used, generation_params, feedback")`), written via real `PATCH` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full Phase 26 static+functional gate | `npx tsx scripts/verify-phase-26.ts` | 60/60 PASS across all 9 tags (self-test, svc-webp-quality, svc-webp-edge-check, svc-drawblocks-font-fix, svc-idempotency, svc-quality-dashboard, svc-cost-reconciliation-runbook, svc-logo-contrast, svc-cross-plan) — re-ran independently, not just trusted from SUMMARY.md | PASS |
| TypeScript type-check | `npm run check` | Exits 0 | PASS |
| GATE-08 video pipeline untouched | `git diff --stat` across all Phase 26 commits | 41 files changed, zero video-related service/route files present in the change list | PASS |
| Two other `applyLogoOverlay` callers correctly left untouched (out of scope) | `grep -n "applyLogoOverlay" carousel-generation.service.ts carousel.routes.ts` | Both still pass a pre-collapsed `logoPosition`/`effectiveLogoPosition` default — matches `deferred-items.md`'s documented, correct scope boundary | PASS (confirmed, not a gap) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| POL-02 | 26-01, 26-02, 26-03 | WebP quality 85 + text-edge check + drawBlocks font fix | SATISFIED | Code + automated gate verified above; marked Complete in REQUIREMENTS.md (no live-sign-off gate attached to this one per 26-10-SUMMARY.md) |
| POL-03 | 26-01, 26-07 | Contrast-aware adaptive logo overlay | SATISFIED (code) / NEEDS HUMAN (visual sign-off) | Code fully verified above; REQUIREMENTS.md correctly shows "Pending — code complete; operator visual sign-off outstanding" |
| POL-06 | 26-01, 26-04, 26-06 | Idempotent generate/edit APIs | SATISFIED (code) / NEEDS HUMAN (live proof) | Code fully verified above, both client and server, correct ordering and correct edit-side scoping; REQUIREMENTS.md correctly shows "Pending — operator sign-off outstanding" |
| POL-08 | 26-01, 26-05 | Cost reconciliation runbook + scaffold (non-gating) | SATISFIED | Explicitly scheduled, not run, by design; REQUIREMENTS.md correctly shows "Scheduled (non-gating)" |
| POL-09 | 26-01, 26-08, 26-09 | Feedback + admin Quality dashboard | SATISFIED (code) / NEEDS HUMAN (live data + 403 check) | Both user half and admin half fully verified above; REQUIREMENTS.md correctly shows "Pending — operator visual sign-off outstanding" |

No orphaned requirements: `.planning/REQUIREMENTS.md`'s Phase 26 traceability rows (lines 139-143) list exactly POL-02/03/06/08/09, matching every plan frontmatter's declared `requirements` field with no extra or missing IDs.

### Anti-Patterns Found

None. Scanned all Phase 26-modified server/client files for TODO/FIXME/placeholder/empty-implementation patterns — zero blockers, zero warnings. One incidental, unrelated comment (`post-viewer-dialog.tsx:173`, "thumbnail as placeholder" — describes an `<img>` loading-state attribute, not feedback/quality code) is not a Phase 26 stub.

### Human Verification Required

The 7-step MANUAL/LIVE VERIFICATION RUNBOOK (embedded at the bottom of `scripts/verify-phase-26.ts`, plus its prerequisite migration-application step) requires the real Coolify production host, the live Supabase project, real uploaded brand logos, and real paid OpenRouter generations — none of which are available in this sandbox. This was already correctly identified by plan 26-10 as `checkpoint:human-verify`/`gate="blocking"` (Task 3), was explicitly deferred by user decision, and is already persisted as a pending (not fabricated) log in `.planning/phases/26-fixes-and-polish/26-HUMAN-UAT.md` (8 items, 0 passed, 8 pending). See the frontmatter `human_verification` list above for the itemized detail. This is **not** a code gap — it is the designed, final human checkpoint of the v1.6 milestone.

### Gaps Summary

No code-level gaps found. Every must-have artifact, key link, and requirement traced back to real, substantive, wired implementation — independently re-derived from source (not from SUMMARY.md prose), including the two genuine pre-existing bugs this phase fixed along the way:

1. `typography-compositor.service.ts`'s `drawBlocks()` now sets `ctx.font` per block inside `layouts.forEach`, using that block's own `layout.size_px`/`layout.alias` (already correctly computed by `layoutBlocks()`) — confirmed the fix does not merely relocate the bug; it uses the same correct values `layoutBlocks()` always produced, so wrap/geometry is unchanged and only the rasterized glyph is fixed.
2. `analyzeRegionContrast`'s region-extraction bug (`sharp().extract().stats()` silently computing whole-image stats on non-raw buffer inputs) is fixed by materializing the extracted region to a raw buffer before calling `.stats()` on a fresh `sharp()` instance — a real, verifiable fix, not a plausible-sounding no-op.

The only outstanding item is the operator's live/visual sign-off (Task 3 of plan 26-10), which is a deliberate, already-logged human checkpoint — not a defect. Phase 26's ROADMAP checkbox is correctly left unchecked and POL-03/POL-06/POL-09 are correctly left "Pending" in REQUIREMENTS.md pending that sign-off; POL-08 is correctly "Scheduled (non-gating)" and POL-02 is correctly "Complete" (it carries no live-sign-off gate). This matches the phase's own designed completion criteria and should not be treated as a regression or an incomplete implementation.

---

*Verified: 2026-07-28*
*Verifier: Claude (gsd-verifier)*
