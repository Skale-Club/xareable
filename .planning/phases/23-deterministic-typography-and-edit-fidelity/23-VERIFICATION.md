---
phase: 23-deterministic-typography-and-edit-fidelity
verified: 2026-07-27T23:47:18Z
status: human_needed
score: 5/5 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: "4/5 must-haves verified (1 partial — narrow edge-case leak)"
  gaps_closed:
    - "No prompt path any longer instructs the image model to render on-image text — the local transport-failure fallback prompt is also text-free (TYPO-01), and its negative-space instruction now actually reaches the image model instead of being dead code"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Migration application — apply supabase/migrations/20260728000000_posts_base_image_typography_generation_params.sql via the Supabase SQL editor on the live project and confirm 3 new columns on posts + 2 on post_versions."
    expected: "Column-existence query returns 3 rows for posts, 2 rows for post_versions."
    why_human: "Requires the live Supabase project; migration has not been applied there yet (deferred by explicit user decision, tracked in 23-HUMAN-UAT.md item 1)."
  - test: "Alpine/AVX smoke check on the real Coolify/Hetzner production host: docker exec <container> node -e \"require('@napi-rs/canvas')\"."
    expected: "Prints 'AVX OK' / no 'Illegal instruction' crash (ref: Brooooooklyn/canvas#1117)."
    why_human: "Requires the real production Alpine host's CPU; cannot be reproduced in this sandbox. 23-HUMAN-UAT.md item 2."
  - test: "Golden-image glyph test inside the real Docker build (builder stage) for pt-BR/es accented characters."
    expected: "Zero tofu/missing-glyph boxes for á, ç, ñ, ã, õ, í, ú, ê in the actual container filesystem/fontconfig environment."
    why_human: "Font rendering can differ between this dev sandbox and the real Alpine container; requires a real docker build. 23-HUMAN-UAT.md item 3."
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

**Verified:** 2026-07-27T23:47:18Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plan 23-12)

## Goal Achievement

### Gap Closure Verification (the item this re-verification targets)

The prior `23-VERIFICATION.md` recorded exactly one gap: `buildDefaultCreativePlan()`'s hardcoded `required_elements` literal `"clear promotional typography"` reached the image model through `buildLocalTextFallback()`'s always-losing `flattenedPrompt || image_prompt`, reachable only on double-transport-failure. Plan 23-12 claims to have fixed this. Independently re-verified against the actual codebase (not the SUMMARY's claims):

| # | Check | Result |
|---|-------|--------|
| 1 | `buildDefaultCreativePlan()`'s `required_elements` no longer contains `"clear promotional typography"` or equivalent typography-instructing language | ✓ CONFIRMED. Read `server/services/gemini.service.ts` lines 338-353 directly: the tainted slot (line ~349-351) now reads `"calm uncluttered empty space across the lower 40% of the frame, free of important subject detail"` — no typography/text/font/lettering vocabulary anywhere in the array. `grep -c "clear promotional typography" server/services/gemini.service.ts` → `0`. `grep -c "text_rendering" server/services/gemini.service.ts` → `0` (23-05's shipped state preserved). |
| 2 | `buildLocalTextFallback()` now actually returns a text-free, negative-space-instructed `image_prompt` (not silently losing to `flattenedPrompt`) | ✓ CONFIRMED. Read the function directly (lines 453-503): the `flattenedPrompt`/`creativePlan.structured_image_prompt`-flattening branch is gone entirely; the function now returns the bare `image_prompt` local (built at line 478, which interpolates `this.buildNegativeSpaceInstruction(...)` at line 466) with a doc comment explaining the historical defect without reproducing the banned literal. `grep -c "flattenedPrompt \|\| image_prompt"` → `0`. `grep -c "buildImagePromptFromStructuredJson"` → `2` (import + the single remaining call site inside `normalizeGeminiTextResult`, down from 3) — confirmed via direct grep, matching the plan's acceptance criteria exactly. |
| 3 | The new harness check in `scripts/verify-phase-23.ts` calls the real function and checks its return value (not just grepping source text); re-ran it and it is green; the check's logic makes sense | ✓ CONFIRMED. Independently re-ran `npx tsx scripts/verify-phase-23.ts --only=svc-text-free-prompt` → `PASS: 29`, exit 0, all 6 new checks green including the self-test. Read the actual added code in `scripts/verify-phase-23.ts`: it does `await import("../server/services/gemini.service.js")`, calls `gem.createGeminiService("harness-probe-key")`, then `svc.buildLocalTextFallback(params)` and `svc.buildDefaultCreativePlan(params, ...)` across a 4-point `useText` x `contentType` matrix — a genuine dynamic-import-and-invoke, not a source grep. Logic sanity-checked: `positiveTypographyLeaks()` splits the returned prompt into sentences, drops any sentence containing a negation token (`do not`, `avoid`, `free of`, etc. — case-insensitive), then flags remaining sentences containing typography vocabulary; this correctly excludes the legitimate "Do NOT render any text... typographic marks..." negative-space instruction while still catching a reintroduced positive directive like `"clear promotional typography"`. The scanner's own self-test (confirmed present and green) proves it flags a known-bad control string (leak count 1) and clears a known-good one (leak count 0) — so the semantic checks are not vacuous. Full suite independently re-run: `npx tsx scripts/verify-phase-23.ts` → `PASS: 86`, exit 0, no FAIL line, `All Phase 23 checks passed.` |
| 4 | The fix didn't touch/regress plan 23-05's already-shipped `text_rendering` schema removal (`planning-schema.service.ts`, `prompt-builder.service.ts` untouched by this gap-closure plan) | ✓ CONFIRMED. `git diff` between the commit immediately preceding 23-12's first commit (`099ecf7`) and current `HEAD` for `server/services/planning-schema.service.ts`, `server/services/prompt-builder.service.ts`, `server/routes/generate.routes.ts`, `server/routes/edit.routes.ts`, `server/services/typography-compositor.service.ts`, and `server/services/image-crop.service.ts` is **empty** — all six files are byte-identical across the entire gap-closure plan. `git show --stat` on all three 23-12 commits (`c4d6ab3` test, `a86ed78` fix, `0632890` docs) plus the doc-only follow-up (`0f6ead1`, SUMMARY.md + STATE.md) confirms the only source file touched is `server/services/gemini.service.ts` (28 lines) plus `scripts/verify-phase-23.ts` (153 lines) and `.planning/ROADMAP.md`/`.planning/STATE.md` (docs only). |

**Before/after `buildLocalTextFallback()` return value** (independently re-derived by reading the function, matching the SUMMARY's claimed strings):

- BEFORE (prior gap): `"...MUST INCLUDE these elements: clear promotional typography, reserved clean zone for real logo overlay..."` — positive typography directive present, negative-space instruction absent (dead code).
- AFTER (current tree): `"...CRITICAL: Do NOT render any text, letters, numbers, or typographic marks anywhere in the image — all on-image copy is composited server-side after generation by a deterministic typography engine. Compose the scene so it keeps the lower 40% of the frame calm, uncluttered, and free of important subject detail..."` — zero positive typography directives; the negative-space instruction is the value actually returned.

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A newly generated post in "exact text" mode shows crisp, correctly spelled headline/support/CTA text composited by the server — zero AI-render verify/repair loop calls in `generation_logs` | ✓ VERIFIED (code-level) | Compositor wired into `generate.routes.ts` (crop → `compositeTypography` → logo → optimize); verify/repair loop fully deleted, zero real call sites. The previously-open edge case (double-transport-failure fallback leaking a typography directive) is now closed — confirmed above. Live "zero rows in `generation_logs`" claim remains gated on human item 4 (unaffected by code-level status). |
| 2 | Text is always legible — scrim/plate auto-applied when contrast insufficient — across bottom band/top stack/centered hero and full pt-BR/es glyph coverage (CI golden-image test guards this) | ✓ VERIFIED (code-level) | Unchanged from prior verification; `typography-compositor.service.ts` scrim logic and golden-image CI gate both confirmed present and correctly ordered. Real-Alpine glyph rendering deferred to human item 3. |
| 3 | Editing an existing post edits the persisted `base_image_url` (not the flattened, already-composited image) and re-applies typography — no double-rendered/ghosted text | ✓ VERIFIED | Unchanged from prior verification; `resolveEditTarget()`/LEGACY branch confirmed byte-unchanged by 23-12 (see gap-closure check 4 above). The closed gap also removes the residual TYPO-07 risk noted previously (a fallback-seeded base image with AI-drawn text that a later edit's compositor would double-render over) — that seed path no longer exists. |
| 4 | A post requested at a non-native aspect ratio is cropped to the exact requested aspect before typography/logo compositing runs | ✓ VERIFIED | Unchanged; `image-crop.service.ts` untouched by 23-12 (confirmed via empty `git diff`). |
| 5 | Remaking or editing a post reuses its originally persisted aspect ratio, resolution, and content options rather than defaulting or guessing | ✓ VERIFIED | Unchanged; `generation_params` persistence and UI wiring untouched by 23-12. |

**Score:** 5/5 truths verified (up from 4/5 — the previously-partial Truth 1 is now fully verified at the code level; live-environment confirmation for Truths 1 and 2 remains a human-verification item, not a code gap).

### Required Artifacts (delta from prior verification — only files touched by 23-12 re-checked; all others unchanged from the initial `23-VERIFICATION.md`)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/services/gemini.service.ts` | Text-free negative-space prompt instructions, on every reachable path including the local fallback | ✓ VERIFIED | `required_elements` literal removed; `buildLocalTextFallback()` no longer shadows its own negative-space-safe string. Confirmed by direct read + grep, not by trusting the SUMMARY. |
| `scripts/verify-phase-23.ts` | 6 new `[svc-text-free-prompt]` FUNCTIONAL checks calling real code and asserting on returned strings | ✓ VERIFIED | Confirmed present, confirmed they perform a genuine dynamic import + function call (not a grep), confirmed green on independent re-run (`PASS: 29` scoped, `PASS: 86` full suite). |
| `server/services/planning-schema.service.ts` | 23-05's `text_rendering` removal, unmodified by 23-12 | ✓ VERIFIED (non-regression) | `git diff` empty since before 23-12's first commit. |
| `server/services/prompt-builder.service.ts` | 23-05's flattening-branch removal, unmodified by 23-12 | ✓ VERIFIED (non-regression) | `git diff` empty since before 23-12's first commit. |

All other artifacts from the initial verification (typography-compositor.service.ts, image-crop.service.ts, generate.routes.ts, edit.routes.ts, migration, shared/schema.ts, Dockerfile, CI workflow, UI wiring) are unaffected by this gap-closure plan and were re-confirmed as untouched via the same `git diff` scope check; their prior VERIFIED status stands.

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `buildLocalTextFallback()` | image model prompt | `image_prompt` local (interpolates `buildNegativeSpaceInstruction`) | ✓ WIRED (fixed) | Previously `flattenedPrompt \|\| image_prompt` always chose the tainted flattened string; now returns `image_prompt` directly — confirmed by direct read of lines 484-499. |
| `scripts/verify-phase-23.ts` | `server/services/gemini.service.ts` | dynamic `import()` + `createGeminiService(...)` + `(svc as any).buildLocalTextFallback(params)` / `buildDefaultCreativePlan(...)` | ✓ WIRED | Confirmed by direct read of the harness code; not a source grep — a real runtime call, verified by the check's own PASS/FAIL sensitivity (RED commit `c4d6ab3` proved it fails against the unfixed tree: `PASS: 24 / FAIL: 5`). |
| `scripts/verify-phase-23.ts` | `server/services/prompt-builder.service.ts` | dynamic `import()` of `buildImagePromptFromStructuredJson` to scan the flattened fallback plan (closes the second, `normalizeGeminiTextResult` channel) | ✓ WIRED | Confirmed present and exercised (the `semanticFlatten` check). |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| TYPO-01 | 23-05, 23-12 | Generated images text-free by prompt design, negative space reserved | ✓ SATISFIED | Gap closed; true on both the live planning-call path AND the local transport-failure fallback path now. |
| TYPO-02 | 23-01, 23-04, 23-08 | Typography compositor renders text_blocks with archetypes/safe zones | ✓ SATISFIED | Unaffected by 23-12; re-confirmed untouched. |
| TYPO-03 | 23-04 | Contrast guaranteed, scrim auto-applied | ✓ SATISFIED | Unaffected. |
| TYPO-04 | 23-01, 23-08 | Fonts bundled, CI golden-image test guards tofu/missing glyphs | ✓ SATISFIED (code-level) | Unaffected; real-Alpine confirmation still deferred (human item 3). |
| TYPO-05 | 23-02, 23-06 | Posts persist `base_image_url`+`typography_meta` | ✓ SATISFIED | Unaffected. |
| TYPO-06 | 23-06, 23-07, 23-09 | Verify/repair loop removed | ✓ SATISFIED | Unaffected. |
| TYPO-07 | 23-07, 23-12 | Edit flow edits base image, re-applies typography, no double-render | ✓ SATISFIED | Gap closure also removes the residual double-render risk from a fallback-seeded base image. |
| POL-04 | 23-03, 23-06 | Deterministic center-crop before typography/logo compositing | ✓ SATISFIED | Unaffected. |
| POL-05 | 23-02, 23-06, 23-07, 23-10 | `generation_params` persisted and reused for edit/remake | ✓ SATISFIED | Unaffected. |

All 9 requirement IDs (TYPO-01..07, POL-04, POL-05) mapped to Phase 23 in `.planning/REQUIREMENTS.md` are `[x]`/"Complete" and confirmed backed by evidence. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none — the prior blocker is resolved) | — | — | — | The single 🛑 Blocker from the prior verification (`"clear promotional typography"` literal reachable via `buildLocalTextFallback`) is confirmed removed. `grep -c "clear promotional typography" server/services/gemini.service.ts` → `0`. |

`npm run check` (TypeScript) independently re-run: clean, exit 0. `npx tsx scripts/verify-phase-23.ts` independently re-run: `PASS: 86`, exit 0, all four `[svc-cross-plan]` "no prior-phase harness regressed" lines (Phases 16, 21, 21.1, 22) present and `✓`.

### Human Verification Required

The following 7 items remain Task 3 of `23-11-PLAN.md` — an explicit, previously-recorded checkpoint (`23-HUMAN-UAT.md`, status: `partial`, all 7 still `[pending]`, confirmed unchanged since the prior verification) requiring the real Coolify/Hetzner Alpine production host, the live Supabase project, and real paid AI calls, none of which are reachable from this sandbox. Per explicit user decision this task remains deferred; these are reflected as human-verification items, not blocking gaps:

1. **Migration application** — apply `supabase/migrations/20260728000000_posts_base_image_typography_generation_params.sql` via the Supabase SQL editor; confirm 3 new columns on `posts`, 2 on `post_versions`.
2. **Alpine/AVX smoke check** — on the real production container: `docker exec <container> node -e "require('@napi-rs/canvas')"`; expect no `Illegal instruction` crash.
3. **Golden-image glyph test inside the real Docker build** — confirm zero tofu/missing-glyph boxes for pt-BR/es accented text in the actual container.
4. **Live generation — exact text mode** — `use_text=true`, `text_mode="exact"`, `aspect_ratio="1200:628"`; confirm exact ratio, correct text, zero `text_verification` rows in `generation_logs`.
5. **Live edit — no ghosting** — edit the post from #4; confirm no double-rendered/ghosted text.
6. **Text-only fast path + Quick Remake fidelity** — confirm the compositor-only fast path and faithful params reuse.
7. **Legacy post + video regression** — edit a pre-Phase-23 post (`base_image_url IS NULL`); regress one video post edit (GATE-08).

### Gaps Summary

No gaps remain from this re-verification. The single gap recorded in the prior `23-VERIFICATION.md` — `buildDefaultCreativePlan()`'s hardcoded `"clear promotional typography"` literal leaking into the image model prompt via `buildLocalTextFallback()`'s always-losing `flattenedPrompt || image_prompt` — is confirmed closed by direct source inspection (not by trusting `23-12-SUMMARY.md`'s claims):

- The literal is gone (`grep -c` → 0), replaced with a text-free empty-space description.
- `buildLocalTextFallback()` no longer computes a competing flattened prompt; its own negative-space-safe manual string (the only one that interpolates `buildNegativeSpaceInstruction`) is the value actually returned — independently re-derived and matches the SUMMARY's claimed before/after strings.
- The second reachable channel identified in the plan's gap evidence (`normalizeGeminiTextResult`'s lazy flattening of `fallbackPlan.structured_image_prompt` when the planning model returns a `creative_plan` but no `image_prompt`) is also closed at the source, since it flattens the same now-text-free `required_elements`.
- The new harness checks are functional (call the real, private-but-runtime-accessible `buildLocalTextFallback`/`buildDefaultCreativePlan` methods via a dynamic import and `as any` cast) rather than grep-based, independently re-run green, and self-test their own semantic scanner to guard against future vacuity.
- No regression: the six files explicitly out of scope for this gap-closure plan (`planning-schema.service.ts`, `prompt-builder.service.ts`, `generate.routes.ts`, `edit.routes.ts`, `typography-compositor.service.ts`, `image-crop.service.ts`) are byte-identical across the entire plan, confirmed via `git diff`. `npm run check` and the full 86-check Phase 23 harness (plus Phases 16/21/21.1/22 non-regression) all pass on independent re-run.

Phase 23 is NOT being marked fully `passed` in this report because 7 items remain gated on human/live-environment verification (Task 3 of `23-11-PLAN.md`, tracked in `23-HUMAN-UAT.md`), which is an explicit, previously-recorded user decision to defer rather than a code-level gap. Status is therefore `human_needed`, not `gaps_found`: all automated, sandbox-reachable checks pass; the phase's remaining open item is real-environment operator sign-off, not a defect in the codebase.

---
_Verified: 2026-07-27T23:47:18Z_
_Verifier: Claude (gsd-verifier)_
