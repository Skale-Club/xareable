---
phase: 23-deterministic-typography-and-edit-fidelity
verified: 2026-07-27T23:30:00Z
status: gaps_found
score: 4/5 must-haves verified (1 partial — narrow edge-case leak)
gaps:
  - truth: "No prompt path any longer instructs the image model to render on-image text (23-05-PLAN.md); the local transport-failure fallback prompt is also text-free"
    status: partial
    reason: >
      server/services/gemini.service.ts's buildDefaultCreativePlan() still hardcodes
      the literal required_elements entry "clear promotional typography" (line 340,
      unchanged since a pre-Phase-23 commit — 23-05 removed the `text_rendering`
      sub-object but never touched this separate literal). This creative_plan.structured_image_prompt
      is only used by buildLocalTextFallback() (the double-transport-failure, no-LLM
      fallback), which builds its own manually-authored, negative-space-safe image_prompt
      string (line 467) but then returns `image_prompt: flattenedPrompt || image_prompt`
      (line 479) — and flattenedPrompt (from buildImagePromptFromStructuredJson(),
      line 472-474) is ALWAYS non-empty in practice, so it ALWAYS wins the `||`. The
      negative-space-instructed manual string is dead code. Empirically reproduced:
      calling buildImagePromptFromStructuredJson() with buildDefaultCreativePlan's
      shape and useText=true (headline is populated in virtually all useText=true
      calls, since headlineSource always falls back to `${brand.company_name} ${mood}`)
      yields "...MUST INCLUDE these elements: clear promotional typography..." as the
      actual image_prompt sent to the image model. This both (a) leaks a direct
      typography-rendering instruction to the image model, contradicting TYPO-01, and
      (b) risks double-rendered/ghosted text in that same generation, since
      generate.routes.ts's compositeTypography() step runs unconditionally whenever
      use_text is true and text_blocks are present, regardless of which code path
      (real planning call vs. local fallback) produced textResult — undermining TYPO-07's
      no-ghosting guarantee for this narrow trigger.
      Scope: only reachable when BOTH planning-call attempts (initial + retry) fail
      with a TRANSPORT error (network/auth/empty-completion) — schema-validation
      failures now correctly throw and surface to the user (PLAN-02), never reaching
      this path. scripts/verify-phase-23.ts's [svc-text-free-prompt] checks only grep
      for the literal "text_rendering" substring and a few specific label-fragment
      strings; they do not exercise buildLocalTextFallback's actual returned
      image_prompt, so this defect is invisible to the harness (80/80 still passes).
    artifacts:
      - path: "server/services/gemini.service.ts"
        issue: "buildDefaultCreativePlan() required_elements literal 'clear promotional typography' (line ~340) survives Phase 23's text-free sweep; buildLocalTextFallback()'s flattenedPrompt-wins-by-construction `||` (line ~479) makes it reachable, and its own negative-space-instructed manual image_prompt (line ~467) is dead code as a result."
    missing:
      - "Remove or rewrite the 'clear promotional typography' required_elements literal in buildDefaultCreativePlan() so it never asks the image model to include typography/text."
      - "Fix buildLocalTextFallback()'s `image_prompt: flattenedPrompt || image_prompt` so the negative-space-safe manually-built string is actually used (or drop the flattened path entirely for this fallback, consistent with 23-05's stated intent)."
      - "Add a harness check that calls buildLocalTextFallback()/buildImagePromptFromStructuredJson() directly and asserts the RETURNED string contains no typography/text-rendering directive — the current grep-only checks cannot catch semantically-equivalent leaks that don't reuse the literal 'text_rendering' string."
human_verification:
  - test: "Migration application — apply supabase/migrations/20260728000000_posts_base_image_typography_generation_params.sql via the Supabase SQL editor on the live project and confirm 3 new columns on posts + 2 on post_versions."
    expected: "Column-existence query returns 3 rows for posts, 2 rows for post_versions."
    why_human: "Requires the live Supabase project; migration has not been applied there yet (deferred by explicit user decision, tracked in 23-HUMAN-UAT.md item 1)."
  - test: "Alpine/AVX smoke check on the real Coolify/Hetzner production host: docker exec <container> node -e \"require('@napi-rs/canvas')\"."
    expected: "Prints 'AVX OK' / no 'Illegal instruction' crash (ref: Brooooooklyn/canvas#1117)."
    why_human: "Requires the real production Alpine host's CPU; cannot be reproduced in this sandbox. 23-HUMAN-UAT.md item 2."
  - test: "Golden-image glyph test inside the real Docker build (builder stage) for pt-BR/es accented characters."
    expected: "Zero tofu/missing-glyph boxes for á, ç, ñ, ã, õ, í, ú, ê in the actual container filesystem/fontconfig environment."
    why_human: "Font rendering can differ between this dev sandbox and the real Alpine container; requires a real `docker build`. 23-HUMAN-UAT.md item 3."
  - test: "Live generation in 'exact text' mode (use_text=true, text_mode=\"exact\", aspect_ratio=\"1200:628\") against the live Supabase + paid Gemini/OpenRouter APIs."
    expected: "Exact aspect ratio, crisp correctly-spelled text, zero text_verification rows in generation_logs, all three new columns populated."
    why_human: "Requires live Supabase + real paid AI calls. 23-HUMAN-UAT.md item 4."
  - test: "Live edit of the post from the previous test with a visual-concept change."
    expected: "No double-rendered or ghosted text in the result; base_image_url/typography_meta populated on the new version."
    why_human: "Requires live Supabase + real paid AI calls. 23-HUMAN-UAT.md item 5."
  - test: "Text-only fast path + Quick Remake fidelity on a live post."
    expected: "Text-only edit uses the compositor-only fast path (visibly faster, no AI image call); Quick Remake reuses persisted generation_params (aspect ratio, logo position) rather than defaulting."
    why_human: "Requires a live post + live UI interaction. 23-HUMAN-UAT.md item 6."
  - test: "Legacy post (base_image_url IS NULL) edit + one video post edit regression."
    expected: "Legacy edit succeeds via the fallback path with no lockout and no re-composite; video edit still works via the GATE-08-frozen path."
    why_human: "Requires a real pre-Phase-23 post and a live video generation call. 23-HUMAN-UAT.md item 7."
---

# Phase 23: Deterministic Typography & Edit Fidelity Verification Report

**Phase Goal:** Images are generated text-free with reserved negative space; a `@napi-rs/canvas`-based typography compositor renders headline/support/CTA text with real bundled fonts and guaranteed contrast; edit and remake flows operate on a persisted pre-typography base image and reuse the original generation parameters — eliminating the AI-rendered-text verify/repair loop entirely.

**Verified:** 2026-07-27
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A newly generated post in "exact text" mode shows crisp, correctly spelled headline/support/CTA text composited by the server — zero AI-render verify/repair loop calls in `generation_logs` | ⚠ PARTIAL | Compositor genuinely wired into `generate.routes.ts` (crop → `compositeTypography` → logo → optimize, lines 656-748); verify/repair loop (`enforceExactImageText`/`verifyExactImageText`/`logTextVerification`) confirmed fully deleted with zero real call sites repo-wide. **BUT** a confirmed, reproducible edge-case leak in `buildLocalTextFallback()`/`buildDefaultCreativePlan()` (see Gaps) means the double-transport-failure fallback path can still instruct the image model to render typography and risks double-rendered text. Live "zero rows in `generation_logs`" claim is unverified pending Task 3 (human, deferred). |
| 2 | Text is always legible — scrim/plate auto-applied when contrast insufficient — across bottom band/top stack/centered hero and full pt-BR/es glyph coverage (CI golden-image test guards this) | ✓ VERIFIED (code-level) | `typography-compositor.service.ts` (595 lines) implements `analyzeRegionContrast`/scrim logic; functional harness checks (`verify-phase-23.ts` `[svc-contrast-scrim]`) confirm scrim applied on a low-contrast fixture and NOT applied on a high-contrast fixture. `scripts/verify-golden-image.ts` (167 lines) + `Dockerfile` builder-stage `RUN fc-cache -f ... && npx tsx scripts/verify-golden-image.ts` + CI `verify` job (runs before `build-and-deploy`) all confirmed present and correctly ordered. Real-Alpine glyph rendering is deferred to human verification (Task 3, not a gap — accepted). |
| 3 | Editing an existing post edits the persisted `base_image_url` (not the flattened, already-composited image) and re-applies typography — no double-rendered/ghosted text | ✓ VERIFIED | `resolveEditTarget()` in `edit.routes.ts` (lines 79-107) correctly prioritizes `latestVersion.base_image_url` → `post.base_image_url` → LEGACY flattened fallback; `isBaseImage` flag gates crop/compositor/logo re-application (lines 662-729); LEGACY branch (`base_image_url IS NULL`) never re-crops or recomposites, exactly reproducing pre-Phase-23 behavior (confirmed via diff against pre-23 `edit.routes.ts`, commit `5c717a7`). This truth is unaffected by the Truth-1 gap (edit path builds its own prompts directly, never calls `buildLocalTextFallback`). |
| 4 | A post requested at a non-native aspect ratio is cropped to the exact requested aspect before typography/logo compositing runs | ✓ VERIFIED | `image-crop.service.ts` (125 lines) exports `parseAspectRatio`/`cropToExactAspectRatio`; harness functional test confirms exact-ratio match (within 0.01) across 1:1/4:5/16:9/1200:628/21:9/1:8/8:1. Pipeline order in both routes confirmed: crop runs before `compositeTypography`/`applyLogoOverlay` in both `generate.routes.ts` (line 661 crop → 686 composite → 704 logo) and `edit.routes.ts` (line 663 crop → 695 composite → 721 logo). |
| 5 | Remaking or editing a post reuses its originally persisted aspect ratio, resolution, and content options rather than defaulting or guessing | ✓ VERIFIED | `generation_params` JSONB persisted on `posts` insert (`generate.routes.ts` line 846); `edit.routes.ts`'s `resolveEditAspectRatio()` reads `post.generation_params.aspect_ratio` first, falling back to the regex-based `recoverVideoAspectRatioFromPrompt` ONLY for LEGACY (pre-migration) posts, documented explicitly. UI wiring confirmed: `post-edit-dialog.tsx` pre-fills aspect ratio/logo position from `generation_params` (lines 169-171, 218-242); `quick-remake.ts` forwards `generationParams` into `edit_context` (lines 33-35); `post-viewer-dialog.tsx` selects and passes `generation_params` through to both (lines 85, 118-123, 334, 403, 831). |

**Score:** 4/5 fully verified, 1 partial (narrow, reproducible edge-case gap — see below).

### Required Artifacts (spot check across all 11 plans)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/assets/fonts/Inter-{Regular,SemiBold,Bold}.ttf` | Bundled font weights | ✓ VERIFIED | Present, registered via `GlobalFonts.registerFromPath` under distinct per-weight aliases (`registerBundledFonts`) |
| `scripts/smoke-canvas.ts` | AVX/musl runtime smoke check | ✓ VERIFIED | Exists, `require("@napi-rs/canvas")` present |
| `scripts/verify-phase-23.ts` | 13-tag phase gate | ✓ VERIFIED | 80/80 checks pass across 13 tags (re-ran independently) |
| `supabase/migrations/20260728000000_..._generation_params.sql` | Additive columns | ✓ VERIFIED | `base_image_url`/`typography_meta`/`generation_params` on `posts`; `base_image_url`/`typography_meta` on `post_versions`; migration NOT yet applied to live Supabase (deferred, human item) |
| `shared/schema.ts` | `typographyMetaSchema`/`generationParamsSchema` + extended post/version/edit schemas | ✓ VERIFIED | All exports present and used |
| `server/services/image-crop.service.ts` | Generic W:H center-crop | ✓ VERIFIED | 125 lines, `parseAspectRatio`/`cropToExactAspectRatio` exported, no reliance on the old 6-of-15 lookup table |
| `server/services/typography-compositor.service.ts` | Font registration, archetypes, contrast/scrim, glyph hashing | ✓ VERIFIED | 595 lines, all 9 required exports present, functional archetype/contrast tests pass |
| `server/services/gemini.service.ts` | Text-free negative-space prompt instructions | ⚠ PARTIAL | New instruction builders present and correctly used on the LIVE (planning-call) path; but a pre-existing, un-swept literal in `buildDefaultCreativePlan()` leaks into the transport-failure fallback path — see Gaps |
| `server/services/planning-schema.service.ts` | `text_rendering` sub-schema removed, both dialects | ✓ VERIFIED | Read in full; confirmed absent from both `PLANNING_JSON_SCHEMA` and `PLANNING_GEMINI_RESPONSE_SCHEMA`; `image_prompt`/`text_blocks` descriptions explicitly assert text-free/compositor-consumed |
| `server/services/prompt-builder.service.ts` | `text_rendering` flattening branch removed | ✓ VERIFIED | Read in full; no such branch exists; `buildImagePromptFromStructuredJson` only flattens subject/composition/style/color/required_elements/logo/aspect/negative — no typography field remains (but see Gaps re: `required_elements`) |
| `server/routes/generate.routes.ts` | crop → typography → logo → optimize pipeline + persistence | ✓ VERIFIED | Confirmed by direct read, lines 656-748 |
| `server/routes/edit.routes.ts` | base-image edit target, LEGACY fallback, fast path, params reuse | ✓ VERIFIED | Confirmed by direct read, lines 47-946 |
| `server/services/text-rendering.service.ts` | DELETED | ✓ VERIFIED | File does not exist; `git rm`'d in Phase 23 |
| `server/services/observability.service.ts` | `logTextVerification` removed | ✓ VERIFIED | Only `logCaptionQuality`/`logSubjectFidelityFailure` remain exported |
| `Dockerfile` | fontconfig + fc-cache + golden-image + AVX gates | ✓ VERIFIED | Builder stage: `fc-cache` + `verify-golden-image.ts` (fails build on tofu/AVX crash); runner stage: functional `createCanvas`/`fillRect` smoke test |
| `.github/workflows/build-deploy.yml` | CI runs golden-image before build | ✓ VERIFIED | `verify` job runs `npx tsx scripts/verify-golden-image.ts`; `build-and-deploy` job has `needs: verify` |
| `client/src/components/post-edit-dialog.tsx` | Format+logo pre-fill from `generation_params`, `text_only` signal | ✓ VERIFIED | Confirmed |
| `client/src/lib/quick-remake.ts` | `generationParams` passthrough | ✓ VERIFIED | Confirmed |
| `client/src/components/post-viewer-dialog.tsx` | `generation_params` fetched + passed down | ✓ VERIFIED | Confirmed |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `generate.routes.ts` | `image-crop.service.ts` | `cropToExactAspectRatio(` before compositing | ✓ WIRED | Line 661, before line 686 `compositeTypography` and line 704 `applyLogoOverlay` |
| `generate.routes.ts` | `typography-compositor.service.ts` | `compositeTypography(` after crop, before logo | ✓ WIRED | Line 686, between crop (661) and logo (704) |
| `generate.routes.ts` | `posts.base_image_url/typography_meta/generation_params` | Supabase insert payload | ✓ WIRED | Lines 844-846 |
| `edit.routes.ts` | `post_versions.base_image_url`/`posts.base_image_url` | `resolveEditTarget` explicit legacy branch | ✓ WIRED | Lines 79-107, LEGACY marker present and reachable |
| `edit.routes.ts` | `typography-compositor.service.ts` | `compositeTypography(` on full pipeline + fast path | ✓ WIRED | Lines 566-571 (fast path, no AI call) and 695 (full pipeline) |
| `edit.routes.ts` | `posts.generation_params` | `resolveEditAspectRatio` replacing regex-only recovery | ✓ WIRED | Lines 110-123; regex fallback (`recoverVideoAspectRatioFromPrompt`) documented as LEGACY-ONLY |
| `planning-schema.service.ts structured_image_prompt` | compositor inputs | `text_blocks`/`layout_archetype_id` only | ✓ WIRED | No parallel `text_rendering` channel in either schema dialect |
| `Dockerfile` builder stage | `scripts/verify-golden-image.ts` | `RUN` gate before build succeeds | ✓ WIRED | Confirmed |
| `.github/workflows/build-deploy.yml` | `scripts/verify-golden-image.ts` | `verify` job, `needs: verify` gate | ✓ WIRED | Confirmed |
| `gemini.service.ts buildDefaultCreativePlan` (fallback) | image model prompt | `required_elements` → `buildImagePromptFromStructuredJson` flattening | ⚠ LEAK | Confirmed reachable in the double-transport-failure fallback path only — see Gaps |

### Orchestrator-Directed Deep-Dive Checks

| # | Check | Result |
|---|-------|--------|
| 1 | Text-free prompt fix: `text_rendering` sub-schema gone from both dialects; no leak into authoritative `image_prompt` | ⚠ MOSTLY CONFIRMED — the named `text_rendering` sub-object is genuinely gone from both `PLANNING_JSON_SCHEMA` and `PLANNING_GEMINI_RESPONSE_SCHEMA`, and `buildImagePromptFromStructuredJson`'s old flattening branch for it is removed. However, a **different, pre-existing literal** (`"clear promotional typography"` in `buildDefaultCreativePlan`'s `required_elements`) was not swept, and reaches the actual image_prompt in the local transport-failure fallback path. Empirically reproduced (see Gaps). |
| 2 | Legacy `base_image_url IS NULL` edit branch reproduces pre-Phase-23 behavior | ✓ CONFIRMED — diffed against pre-Phase-23 `edit.routes.ts` (commit `5c717a7`): old edit path had no crop, no logo re-overlay, no compositor — just AI edit + optimize + upload; new LEGACY branch (`editTarget.isBaseImage === false`) matches exactly (no crop, no compositor, no logo re-overlay, `newBaseImageUrl` stays `null`). |
| 3 | Verify/repair loop (`text-rendering.service.ts`, `verifyExactImageText`, `enforceExactImageText`, `logTextVerification`) fully removed, zero call sites | ✓ CONFIRMED — repo-wide grep finds zero real call sites; all remaining matches are inside verification harnesses (`verify-phase-06.ts`, `verify-phase-16.ts`, `verify-phase-23.ts`) that assert absence. `text-rendering.service.ts` does not exist. `npm run check` is clean (no dangling imports). |
| 4 | Compositor wired into BOTH `generate.routes.ts` and `edit.routes.ts`, crop → composite → logo → optimize order | ✓ CONFIRMED — read both files directly; order is correct in both. |
| 5 | GATE-08 (video pipeline, frozen since Phase 21) untouched | ✓ CONFIRMED — `git diff` shows zero changes to `server/services/video-generation.service.ts` since well before Phase 23 started; video branches in both `generate.routes.ts` and `edit.routes.ts` are structurally isolated (`if (isVideoPost) {...} else {...}`) from the new crop/composite/logo code; `scripts/verify-phase-21.ts` and `verify-phase-21.1.ts` both independently re-run clean. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| TYPO-01 | 23-05 | Generated images text-free by prompt design, negative space reserved | ⚠ SATISFIED WITH GAP | True on the live/normal LLM-planning path; violated in the double-transport-failure local fallback (see Gaps) |
| TYPO-02 | 23-01, 23-04, 23-08 | Typography compositor (`@napi-rs/canvas`) renders text_blocks with archetypes/safe zones | ✓ SATISFIED | Confirmed |
| TYPO-03 | 23-04 | Contrast guaranteed, scrim auto-applied | ✓ SATISFIED | Confirmed, functional tests pass |
| TYPO-04 | 23-01, 23-08 | Fonts bundled in Docker image, CI golden-image test guards tofu/missing glyphs | ✓ SATISFIED (code-level) | Confirmed; real-Alpine confirmation deferred to human (Task 3) |
| TYPO-05 | 23-02, 23-06 | Posts persist `base_image_url`+`typography_meta` | ✓ SATISFIED | Confirmed |
| TYPO-06 | 23-06, 23-07, 23-09 | Verify/repair loop removed | ✓ SATISFIED | Confirmed, zero call sites |
| TYPO-07 | 23-07 | Edit flow edits base image, re-applies typography, no double-render | ✓ SATISFIED (edit path); ⚠ indirect risk from TYPO-01's gap on the generate path | Edit path itself is clean; the generate-path fallback bug could seed a base image with AI-drawn text that a later edit's compositor would then draw over |
| POL-04 | 23-03, 23-06 | Deterministic center-crop before typography/logo compositing | ✓ SATISFIED | Confirmed |
| POL-05 | 23-02, 23-06, 23-07, 23-10 | `generation_params` persisted and reused for edit/remake | ✓ SATISFIED | Confirmed, including UI wiring |

No orphaned requirements: all 9 IDs mapped to Phase 23 in `.planning/REQUIREMENTS.md` (TYPO-01..07, POL-04, POL-05) appear in at least one plan's `requirements:` frontmatter field, and every plan's declared requirements map to a REQUIREMENTS.md entry marked "Phase 23 | Complete". REQUIREMENTS.md currently marks all 9 as `[x]` complete; TYPO-01 and (indirectly) TYPO-07's completeness should be reconsidered pending the gap fix below.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server/services/gemini.service.ts` | ~340 | Hardcoded `"clear promotional typography"` in `required_elements`, reachable via `buildLocalTextFallback`'s always-truthy `flattenedPrompt \|\| image_prompt` | 🛑 Blocker (narrow trigger) | Directly contradicts TYPO-01 in the double-transport-failure fallback path; risks double-rendered text (TYPO-07) in that same scenario |
| (all other Phase 23 files scanned) | — | TODO/FIXME/placeholder/empty-return scan | ℹ️ None found | `typography-compositor.service.ts`, `image-crop.service.ts`, `generate.routes.ts`, `edit.routes.ts`, `planning-schema.service.ts`, `prompt-builder.service.ts`, `post-edit-dialog.tsx`, `quick-remake.ts`, `post-viewer-dialog.tsx`, `verify-golden-image.ts` all clean |

`npm run check` (TypeScript) is clean. `npx tsx scripts/verify-phase-23.ts` independently re-run: 80/80 PASS. `npx tsx scripts/verify-phase-21.ts` re-run clean (GATE-08 non-regression).

### Human Verification Required

The following 7 items are Task 3 of `23-11-PLAN.md` — an explicit, previously-recorded checkpoint (`23-HUMAN-UAT.md`, status: `partial`, all 7 pending) requiring the real Coolify/Hetzner Alpine production host, the live Supabase project, and real paid AI calls, none of which are reachable from this sandbox. Per instruction, these are reflected as human-verification items, not as blocking gaps:

1. **Migration application** — apply `supabase/migrations/20260728000000_posts_base_image_typography_generation_params.sql` via the Supabase SQL editor; confirm 3 new columns on `posts`, 2 on `post_versions`.
2. **Alpine/AVX smoke check** — on the real production container: `docker exec <container> node -e "require('@napi-rs/canvas')"`; expect no `Illegal instruction` crash.
3. **Golden-image glyph test inside the real Docker build** — confirm zero tofu/missing-glyph boxes for pt-BR/es accented text in the actual container.
4. **Live generation — exact text mode** — `use_text=true`, `text_mode="exact"`, `aspect_ratio="1200:628"`; confirm exact ratio, correct text, zero `text_verification` rows in `generation_logs`.
5. **Live edit — no ghosting** — edit the post from #4; confirm no double-rendered/ghosted text.
6. **Text-only fast path + Quick Remake fidelity** — confirm the compositor-only fast path and faithful params reuse.
7. **Legacy post + video regression** — edit a pre-Phase-23 post (`base_image_url IS NULL`); regress one video post edit (GATE-08).

### Gaps Summary

One confirmed, reproducible code-level gap was found by direct source inspection and an isolated function-call reproduction (not caught by `scripts/verify-phase-23.ts`'s 80/80 green run, which only greps for the literal string `text_rendering` and a handful of specific label-fragment strings):

`server/services/gemini.service.ts`'s `buildDefaultCreativePlan()` still contains a pre-existing, un-related-to-`text_rendering` literal — `"clear promotional typography"` — in its `structured_image_prompt.required_elements` array, whenever `useText` is on (which is true whenever a headline is present, and headline is populated in virtually every `useText=true` call). This structured plan is used by `buildLocalTextFallback()` (the path exercised only when BOTH attempts of the planning call fail with a transport error, not a schema error). That function computes its own negative-space-safe `image_prompt` string but then does `flattenedPrompt || image_prompt`, and `flattenedPrompt` (built from the tainted `structured_image_prompt` via `buildImagePromptFromStructuredJson`) is always non-empty, so the negative-space-safe string is dead code — the actual prompt sent to the image model in this fallback can read `"...MUST INCLUDE these elements: clear promotional typography..."`, directly contradicting TYPO-01. Because `generate.routes.ts` unconditionally runs `compositeTypography()` whenever `use_text` is on and `text_blocks` resolve to something non-empty — regardless of whether the text came from the real planning call or this local fallback — this same trigger also risks visibly double-rendered text (undermining TYPO-07's no-ghosting guarantee) for any generation that hits the double-transport-failure fallback with text enabled.

This is narrow in *frequency* (requires two consecutive transport failures on the planning call — a rare event distinct from the common "schema failure surfaces to user" path that PLAN-02 correctly hardened) but direct in *severity* (it reproduces, in miniature, the exact defect class — "AI renders text; risk of double text" — that this entire phase exists to eliminate). Recommended fix: remove/rewrite the literal, and/or stop `buildLocalTextFallback` from preferring the flattened prompt over its own text-free manual string, plus add a harness check that calls the actual function and asserts on its *returned value* rather than grepping source text for known-bad substrings.

All 5 ROADMAP success criteria are otherwise genuinely and substantively implemented — the compositor is real (not a stub), the crop service is real and tested across 15 aspect-ratio values, the verify/repair loop is genuinely and completely deleted, the edit flow's legacy branch faithfully reproduces pre-Phase-23 behavior, and the remake/edit UI wiring to `generation_params` is real and traced end-to-end. The 7 items requiring the live production host, live Supabase, and paid AI calls remain correctly deferred per the existing `23-HUMAN-UAT.md` checkpoint and are not being treated as gaps.

---
_Verified: 2026-07-27_
_Verifier: Claude (gsd-verifier)_
