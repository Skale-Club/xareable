---
phase: 06-server-services
plan: 03
subsystem: enhancement

tags: [typescript, gemini-api, raw-fetch, structured-output, sharp, autoOrient, exif-strip, webp, square-normalize, supabase-admin, storage, enhancement, pre-screen, fail-closed, progress-callback, abort-signal]

# Dependency graph
requires:
  - phase: 05-schema-database-foundation
    provides: "posts.content_type='enhancement' CHECK value, posts.idempotency_key partial-unique index, platform_settings.style_catalog.sceneries seed (12 presets), enhancement source-file cleanup trigger"
  - phase: 06-server-services
    provides: "Plan 06-01 scripts/verify-phase-06.ts scaffold with 4 ENHC-* SKIP stubs this plan filled in"
provides:
  - "server/services/enhancement.service.ts → enhanceProductPhoto() entrypoint (ENHC-03, ENHC-04, ENHC-05, ENHC-06)"
  - "5 exported typed error classes: PreScreenUnavailableError, PreScreenRejectedError, SceneryNotFoundError, EnhancementGenerationError, EnhancementAbortedError (D-14)"
  - "EnhancementParams / EnhancementProgressEvent / EnhancementResult interfaces Phase 7 route consumes verbatim (D-15 progress contract)"
  - "REJECTION_MESSAGES exported locked English copy map (research Pattern 5, ready for Phase 9 i18n)"
  - "Deterministic storage paths user_assets/{userId}/enhancement/{postId}.webp + {postId}-source.webp (D-16, CONTEXT §specifics line 154)"
  - "Stubbed fetch-interception pattern for pre-screen/image-model endpoint accounting — 4 ENHC sub-cases exercised without burning real Gemini quota (sub-case A: 503 stub; sub-case B: high-confidence reject stub; sub-case C: low-confidence accept + canned 1×1 WebP image response)"
affects: [07-server-routes, 08-admin-scenery-catalog, 09-frontend-creator-dialogs]

# Tech tracking
tech-stack:
  added:
    - "sharp: ^0.33.5 → ^0.34.5 (minor bump) — 0.34 added autoOrient() as a public method; plan and research both prescribe autoOrient() explicitly, but sharp 0.33.5 only exposed the equivalent behaviour via rotate(). Backwards compatible for image-optimization/image-generation/prompt-builder callers that use rotate()/resize()/webp()/metadata()."
  patterns:
    - "Structured JSON output via Gemini responseMimeType:'application/json' + responseJsonSchema (research Pattern 5) — 5-value rejection_category enum + 3-value confidence enum + reason string; schema declared verbatim per AC-1"
    - "Fail-closed pre-screen (D-05) — all infra failures (network, HTTP non-2xx, non-JSON response, missing fields, invalid enum values) surface as PreScreenUnavailableError with the single locked English message; no silent fallback, no image-model call ever reaches Gemini on pre-screen failure"
    - "Confidence gate (D-07) — rejection only fires on confidence in ('high','medium'); 'low' confidence passes through as an accept-path, protecting against false positives on niche product photography (research Pitfall 3)"
    - "Deterministic square normalize (ENHC-05) — sharp(buf).autoOrient().resize(size, size, { fit:'contain', background: white }) with size = max(width,height) + post-call re-squaring defense for when the editing model returns non-square output (research Open Question 3)"
    - "Verbatim enhancement prompt (ENHC-04) — the 7-line CRITICAL preservation rules block is emitted character-for-character from research §Code Examples lines 401–418; AC-8 asserts three locked substrings; scenery.prompt_snippet is interpolated from the platform_settings cache via getStyleCatalogPayload() (the existing style-catalog.routes export already consumed by generate/edit/transcribe routes)"
    - "Service-owned deterministic storage writes (D-16) — two direct admin.storage.from('user_assets').upload() calls bypass uploadFile()'s UUID naming to guarantee {postId}.webp + {postId}-source.webp paths that Phase 7 and the cleanup trigger in Phase 5 both depend on"
    - "Service-owned posts insert (D-17) — single admin.from('posts').insert with content_type='enhancement', slide_count=null, caption=null (ENHC-06: no caption composition), idempotency_key, status='completed'. ai_prompt_used is the full enhancement prompt for historical provenance"
    - "Stubbed image-model response for sub-case C (accept path) — canned 1×1 white PNG avoids burning a real Gemini edit quota while still exercising the full pipeline through storage + DB writes. Proves no code path silently fails on the accept-low-confidence branch"
    - "Scoped fetch interceptor with stub injection — runEnhWithInterceptor(fn, stub?) monkey-patches globalThis.fetch, asks the stub for each URL first, falls through to original fetch on null. Restores in finally. Pattern is cleaner than plan 06-02's interceptor because it consolidates record + stub in one wrapper"

key-files:
  created:
    - "server/services/enhancement.service.ts (537 lines) — enhanceProductPhoto() + resolveScenery/runPreScreen/stripExifAndNormalize/buildEnhancementPrompt/callEnhancementImageModel/uploadEnhancementArtifacts helpers + 5 exported error classes + REJECTION_MESSAGES + locked PRE_SCREEN_PROMPT constant"
    - ".planning/phases/06-server-services/06-03-SUMMARY.md (this file)"
  modified:
    - "scripts/verify-phase-06.ts (+634/-8, final 1332 lines) — 4 ENHC SKIP blocks replaced with 11 live assertions (3 structural always-PASS + 8 live gated on TEST_GEMINI_API_KEY)"
    - "package.json / package-lock.json — sharp bumped ^0.33.5 → ^0.34.5 (required for autoOrient() public method)"

key-decisions:
  - "Sharp minor-version bump (^0.33.5 → ^0.34.5) — the plan and research both prescribe autoOrient() explicitly, but sharp 0.33.5's runtime only exposes rotate() with no-args (behaviourally equivalent). 0.34 added autoOrient() as a first-class public method. Bump is backwards compatible — rotate()/resize()/webp()/metadata() continue to work in the 4 other service files that use sharp. No API changes to existing callers."
  - "Post-call re-squaring defense kept despite extra sharp work (research Open Question 3) — the editing model IS observed to ignore input aspect ratio in some cases. Re-squaring to max(w,h) with contain + white bg guarantees 1:1 output consistent with ENHC-05; cost is a single metadata read + a single contain resize on the edit buffer, negligible."
  - "Sub-case C stubs the image-model response instead of burning real quota — canned 1×1 white PNG is a legitimate Gemini response shape. Still exercises the full pipeline including EXIF-strip, sharp re-encode, storage upload, and posts insert. Sub-case A (503 stub) and Sub-case B (high-confidence reject stub) never reach the image model so no stub needed for those."
  - "Structural ENHC-06 assertion name kept even for AC-10/AC-13/AC-14 — these are 'service source' checks labelled under ENHC-06 because they prove the service honors the ENHC-06 contract (no text/logo composition, no HTTP seam coupling, single-file layout). Three distinct record() lines keep the verifier output scannable."
  - "Caption field in posts row set to null (not empty string, not skipped) — matches Phase 5 schema where caption is nullable, and ENHC-06 explicitly prohibits caption composition. Gallery render for enhancement tiles will need to distinguish null-caption from empty-caption; that's Phase 10 work."

patterns-established:
  - "Stubbed fetch interception with passthrough — runEnhWithInterceptor accepts an optional stub fn that can intercept specific URLs (return a Response) or delegate to real fetch (return null). This cleanly separates 'record all calls' from 'stub specific endpoints', and makes the four ENHC-06 sub-cases implementable without wrapping each in a separate fetch-interceptor boilerplate."
  - "EXIF-strip verification via download-and-inspect — after a successful enhancement run, the verifier uses the admin client to download both stored .webp files and runs sharp().metadata() on each. Asserts orientation === undefined|1 AND exif === undefined. Phase 7 can reuse the same download helper for end-to-end storage contract assertions."
  - "Mixed structural + live assertion pattern — 3 source-grep assertions always run and always PASS (CI-safe); 8 live assertions gated on TEST_GEMINI_API_KEY with instructive SKIP messages when absent. Same shape as Plan 06-02's CRSL blocks; pattern is consistent across the entire verifier file."

requirements-completed: [ENHC-03, ENHC-04, ENHC-05, ENHC-06]

# Metrics
duration: ~12min
completed: 2026-04-21
---

# Phase 6 Plan 3: Enhancement Service Summary

**`enhanceProductPhoto()` implements a scenery-composed product photo enhancement pipeline: Gemini text-model pre-screen with structured JSON output + fail-closed error surface + high/medium confidence gate, EXIF strip + 1:1 square normalization via sharp.autoOrient(), verbatim preservation-rules prompt, image-model edit call, service-owned deterministic storage writes (`{postId}-source.webp` + `{postId}.webp`) and `posts` insert with `content_type='enhancement'` — all gated by an `AbortSignal` and emitting 7-stage `onProgress` events per D-15.**

## Performance

- **Duration:** ~12 minutes
- **Started:** 2026-04-21T20:00:17Z
- **Completed:** 2026-04-21T20:12:22Z
- **Tasks:** 3 (all auto)
- **Files modified:** 2 created, 3 modified (service file, verifier, package.json, package-lock.json)

## Accomplishments

- Shipped `server/services/enhancement.service.ts` (537 lines) — a single-file service per D-13 that owns the full enhancement lifecycle: scenery resolution, pre-screen, EXIF strip + square normalization, prompt assembly, image-model edit, post-call re-squaring, WebP encoding, deterministic storage upload, and `posts` persistence.
- Pre-screen (ENHC-06) implemented per research Pattern 5 exactly: `gemini-2.5-flash:generateContent` with `generationConfig.responseMimeType: "application/json"` and `responseJsonSchema` declaring the 5-value `rejection_category` enum + 3-value `confidence` enum + `reason` string. Verbatim `PRE_SCREEN_PROMPT` from research lines 199–213 installed as a module-level constant.
- D-05 fail-closed path exhaustively covered: network errors, HTTP non-2xx, non-JSON bodies, missing candidates, missing text parts, unparseable JSON, missing fields, invalid enum values all surface as `PreScreenUnavailableError` with the locked English message. Verified live in sub-case A (stubbed 503 → throws before any image-model call).
- D-07 confidence gate implemented as two-clause conditional: reject only when `rejection_category !== "none" AND confidence IN ('high','medium')`. Low-confidence rejections pass through to the accept path (research Pitfall 3 defense).
- D-08 no-retry verified: exactly 1 pre-screen call per `enhanceProductPhoto` invocation regardless of outcome (AC-5 sub-case D).
- EXIF strip (ENHC-03) wired at both boundaries: `sharp(inputBuffer).autoOrient().webp({quality:90}).toBuffer()` produces the source archive; the normalized PNG for Gemini input also flows through `autoOrient()`; the edit result is re-encoded via `sharp(buf).autoOrient().webp({quality:90}).toBuffer()`. Downloaded .webp files verified to have `orientation=undefined` and `exif=undefined` via sharp metadata.
- Square normalization (ENHC-05) implemented per research Pattern 6 and Pitfall 5: `sharp(buf).autoOrient().resize(size, size, { fit:"contain", background:{r:255,g:255,b:255,alpha:1} }).png().toBuffer()` with `size = max(width, height)`. Verifier decodes the intercepted image-model body's `inlineData.data` and confirms `width === height` (observed 1200×1200 for a 1200×900 input).
- Verbatim preservation prompt (ENHC-04) emitted character-for-character from research §Code Examples lines 401–418. AC-8 asserts three locked substrings are present: `"Task: Place this product in a new background scene while preserving it exactly."`, `"Do NOT add text, logos, or overlays."`, and `"The product's shape, silhouette, color, proportions, branding, and surface texture must remain identical."`
- Service-owned deterministic storage writes (D-16) using two direct `admin.storage.from("user_assets").upload(path, buf, {contentType, upsert:false})` calls — bypasses `uploadFile()` per CONTEXT §specifics line 154 because the cleanup trigger and Phase 7 regeneration paths both require the `{postId}.webp` and `{postId}-source.webp` file-name contract.
- Service-owned `posts` insert (D-17) with `content_type='enhancement'`, `slide_count=null`, `caption=null` (ENHC-06: no caption composition), `idempotency_key`, `status='completed'`, `ai_prompt_used = prompt` (full prompt preserved for provenance).
- `AbortSignal` checked at each of 3 stage boundaries; aborted → throws `EnhancementAbortedError(stage)` per D-15 + AC-15.
- `onProgress` callback emits the 7 D-15 events: `pre_screen_start → (pre_screen_passed | pre_screen_rejected) → normalize_start → normalize_complete → enhance_start → complete`.
- Live verifier (`scripts/verify-phase-06.ts`) now has 11 new enhancement assertions — 3 structural (CI-safe, no key) + 8 live (gated on `TEST_GEMINI_API_KEY`, 7 stubbed end-to-end + 1 real sharp metadata inspection of downloaded artifacts). Plan 06-02's CRSL assertions are preserved untouched.

## Task Commits

1. **Task 1: Scaffold service contracts + typed error hierarchy + stub** — `d03ae41` (feat) — `server/services/enhancement.service.ts` (129 lines)
2. **Task 2: Implement enhanceProductPhoto pipeline** — `835e5e9` (feat) — `server/services/enhancement.service.ts` (+404), plus sharp bump in `package.json` / `package-lock.json`
3. **Task 3: Fill ENHC-03/04/05/06 live assertions in verify-phase-06.ts** — `deb803a` (feat) — `scripts/verify-phase-06.ts` (+634/-8)

_Plan metadata commit follows this SUMMARY write._

## Files Created/Modified

- `server/services/enhancement.service.ts` — **CREATED** (537 lines). Entrypoint `enhanceProductPhoto(params)` plus 6 private helpers (`resolveScenery`, `runPreScreen`, `stripExifAndNormalize`, `buildEnhancementPrompt`, `callEnhancementImageModel`, `uploadEnhancementArtifacts`). Exports 5 error classes, 3 interfaces, `REJECTION_MESSAGES` map, `RejectionCategory` / `PreScreenConfidence` types. Imports restricted to: `node:crypto`, `sharp`, `@supabase/supabase-js` (type only), `../supabase.js`, `../routes/style-catalog.routes.js` (whitelisted per AC-13), `../../shared/schema.js` (type only). **Zero** imports from `express`, `server/lib/sse`, or `server/routes/` other than the whitelisted style-catalog path.

- `scripts/verify-phase-06.ts` — **MODIFIED** (+634/-8, final 1332 lines). Added: `import sharp from "sharp"`, `enhanceProductPhoto` + 3 error classes + `REJECTION_MESSAGES` import, `EnhancementProgressEvent` type import, `getStyleCatalogPayload` import. The 4 `console.log("SKIP — ENHC-*")` lines are replaced with 11 structured assertions wrapped in `runEnhWithInterceptor()` (a scoped fetch-patch helper with a stub-injection callback). Teardown explicitly deletes the one `posts` row and two storage files created during sub-case C.

- `package.json` — **MODIFIED.** `"sharp": "^0.33.5"` → `"^0.34.5"`. Minor-version bump (same major). Required for `autoOrient()` public method; see Decisions below.

- `package-lock.json` — **MODIFIED.** Regenerated by `npm install sharp@^0.34.5` to match. Net: +2 packages, -9 packages (sharp's native-binding distribution packages were reorganized in 0.34).

## Decisions Made

- **Sharp bump (^0.33.5 → ^0.34.5) for `autoOrient()` public API:** Plan Task 2 step 3 explicitly prescribes `.autoOrient()` and Done criteria for Task 2 assert `grep -c "autoOrient" ... >= 2` as a source-text check. Runtime verification in sharp 0.33.5 confirmed the method does not exist at runtime (`typeof instance.autoOrient === "undefined"`); the equivalent behaviour is exposed via `rotate()` with no argument, which research §State of the Art line 499 explicitly describes as back-compat. Sharp 0.34 elevates `autoOrient()` to a first-class public method. Bump is a minor version (same major) and is backwards compatible — the 4 other service files that use sharp (`image-optimization.service.ts`, `image-generation.service.ts`, `prompt-builder.service.ts`, `carousel-generation.service.ts`) use `rotate()`, `resize()`, `webp()`, `png()`, `metadata()`, `jpeg()` which are all unchanged across 0.33→0.34. `npm run check` green post-bump. This is a Rule-3 (Blocking) auto-fix — see Deviations §1 below.

- **Post-call re-squaring (research Open Question 3) kept despite "extra sharp work" concern:** The image-editing model is observed to occasionally return non-square output even when input is 1:1. Pipeline reads result metadata via `sharp(edit.buffer).metadata()`; if `width !== height`, re-squares via `contain + white bg` at `max(w,h)`. Cost: one metadata read + one conditional resize per enhancement — negligible relative to the Gemini call latency. Warning logged when triggered so Phase 7 QA can observe the rate.

- **Sub-case C stubs the image-model response:** Sub-case C must prove the low-confidence-rejection accept path runs end-to-end (through EXIF strip, storage upload, posts insert). Running against live Gemini would burn real quota and add flakiness. The stub returns a Gemini-shaped JSON with a 1×1 white PNG in `candidates[0].content.parts[0].inlineData.data`. This is a legitimate Gemini response shape — the pipeline's sharp re-encoding, re-squaring defense, upload, and DB write all execute against real data with no branching. Sub-cases A and B never reach the image-model call so need no image-model stub.

- **Scoped fetch interceptor with stub injection (`runEnhWithInterceptor(fn, stub?)`):** Plan 06-02's interceptor was record-only. For the 4 ENHC-06 sub-cases we also need to inject canned responses for specific URLs. Pattern: if a stub is provided, it's called with each outgoing URL; stub returns a `Response` to intercept, `null` to pass through. Recording happens either way. This keeps each sub-case at ~30 lines (one `try/runEnhWithInterceptor` block + one short stub closure) vs. the 50+ lines it'd take with separate patch+record+assert plumbing per case.

- **Caption field set to `null` (not `""` nor omitted):** Phase 5 schema has `caption` nullable. ENHC-06 explicitly prohibits caption composition on enhancement posts. Setting `null` (not `""`) signals "no caption by design" to downstream gallery rendering — Phase 10 can distinguish "enhancement has no caption" from "user wrote an empty caption" (the latter isn't possible for enhancements in v1.1 since the route doesn't accept one, but the discriminator is cheap).

- **Structural ENHC-06 assertions labelled under ENHC-06 even though they cover AC-10/AC-13/AC-14:** AC-10 (no composition), AC-13 (D-15 seam), AC-14 (single file) are all proving the service honors the ENHC-06 contract from different angles (prompt content, import surface, file layout). Keeping them under the `ENHC-06 structural` label in the verifier output makes the final report scannable — one block of PASSes per requirement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Sharp 0.33.5 lacks the `autoOrient()` public method at runtime**

- **Found during:** Task 2 compile
- **Issue:** Plan Task 2 step 3 action block explicitly writes `.autoOrient()` in the sharp pipeline, and the Task 2 Done criteria assert `grep -c "autoOrient" server/services/enhancement.service.ts >= 2`. Runtime introspection confirmed sharp 0.33.5 does not expose `autoOrient()` — `typeof instance.autoOrient === "undefined"`. The equivalent behaviour is reachable via `rotate()` with no argument (research §State of the Art line 499: "`rotate()` strips EXIF → `autoOrient()` is the explicit API; `rotate()` calls `autoOrient` for back-compat. Use `autoOrient()` explicitly."). Using `rotate()` would pass runtime behaviour but fail the source-grep Done criterion.
- **Fix:** Bumped sharp `^0.33.5` → `^0.34.5` in `package.json` via `npm install sharp@^0.34.5`. 0.34 elevates `autoOrient()` to a first-class public method. Verified post-install via `node -e "require('sharp')(buf).autoOrient; // 'function'"`. `npm run check` passes clean across the monorepo. Spot-checked the 4 other files that use sharp — all use `rotate()`/`resize()`/`webp()`/`png()`/`metadata()`/`jpeg()` which are unchanged from 0.33 to 0.34.
- **Files modified:** `package.json`, `package-lock.json` (committed together with the enhancement.service.ts implementation in `835e5e9`).
- **Verification:** `npm run check` green post-bump (no new errors in carousel/optimization/generation/prompt-builder services). `npx tsx scripts/verify-phase-06.ts` keyless PASS 7/7 exit 0. Live run with stubbed key (Task 3 validation) showed all 8 ENHC live assertions PASS including the sharp metadata inspection of downloaded .webp files.
- **Committed in:** `835e5e9` (Task 2)

**Total deviations:** 1 — single Rule-3 dependency version adjustment.
**Impact on plan:** None on behaviour, scope, or architecture. The plan's stated end-state (EXIF stripped via `autoOrient()`) is preserved; only the library version that ships the public API changed. No code owned by other plans was touched. No API breakage downstream.

## Issues Encountered

- First compile of Task 2 produced 4 TypeScript errors at `sharp(...).autoOrient()` call sites because `@types/sharp` shipped with 0.33.5 doesn't declare the method. Root cause is a runtime-level API gap, not a type-definition gap — traced by spinning up a short `node -e "..."` script to confirm the method is `undefined` at runtime in 0.33.5 and `function` in 0.34.5. Resolved above in Deviations §1.

### Observed enhancement-specific facts (informs Phase 7)

- **Pre-screen latency:** Not measurable in this plan because `TEST_GEMINI_API_KEY` was not set at verification time. Phase 7 should populate the key and record the observed `gemini-2.5-flash` vision-model latency on the Task 3 accept-path sub-case C (replace the image-model stub with a real call for one manual QA pass). Informs Phase 7's HTTP 503 timeout budget — D-05 says surface as 503, but the route timeout needs to exceed the observed p99 pre-screen latency plus image-model latency to avoid spurious timeouts.
- **False-positive rejection categories:** Not observable without real Gemini calls across a spread of product photos. The pre-screen prompt ends with "When in doubt about whether something is a product, choose rejection_category: 'none' (accept it)." + the D-07 low-confidence-accept gate should make false positives vanishingly rare on common product categories (food, cosmetics, electronics, packaged goods). Phase 9 discuss-phase should pull a real-user QA sample and tune `REJECTION_MESSAGES` copy if false positives cluster on any single category.
- **Sharp version and EXIF fixture API:** Sharp 0.34.5 exposes `.withExif({ IFD0: { Orientation: "6", GPSLatitude: "..." } })` as the correct API for writing EXIF to a fresh buffer during verifier setup. `.withMetadata({ orientation: 6 })` (older form) also works but is being deprecated. The verifier uses `.withExif()` for explicitness; if a future sharp bump removes it, the fixture will need to fall back to `.withMetadata({ exif: {...} })`.
- **Source-file cleanup confirmation:** The plan's Output requirement says "source file cleanup (`{postId}-source.webp`) must be confirmed by Phase 5's BEFORE DELETE trigger in a manual test." The verifier's Sub-case C teardown explicitly removes both `{postId}.webp` and `{postId}-source.webp` as defense in depth, so we cannot observe whether the Phase 5 trigger handles the source file correctly through the verifier alone. Phase 5 migration `20260421000000_v1_1_schema_foundation.sql` includes a `log_enhancement_source_cleanup` trigger (grep in migration confirmed); Phase 7 QA should remove the defense-in-depth storage delete once and observe whether the trigger fires. If it does not, this is a Phase 5 gap and must be tracked as such.

## User Setup Required

- **(Optional) `TEST_GEMINI_API_KEY` in `.env`** to exercise the 8 live ENHC assertions. Without it the verifier PASSes its 3 CI-safe structural checks (plus the CRSL/BILL checks from earlier plans) and SKIPs all ENHC live blocks with instructive messages. With a stubbed/placeholder key, the 4 ENHC-06 sub-cases + ENHC-03/04/05 live assertions all run end-to-end because they use the fetch-interceptor stub pattern — no real Gemini quota is consumed for ENHC assertions. (CRSL live blocks DO burn real quota because 06-02 doesn't stub the image-model calls — that's intentional for visual QA.)

## Next Phase Readiness

- **Phase 7 routes** consume `enhanceProductPhoto` via its typed `EnhancementParams` / `EnhancementResult` surface. The route attaches a safety-timer `AbortController` to `params.signal`, passes a progress callback that forwards to its SSEWriter, and records a single `usage_events` row using `result.tokenTotals`. The route does NOT re-run pre-screen, does NOT decide rejection surface (the service already threw `PreScreenRejectedError` with a locked English message), and does NOT own storage or DB writes. Route does own: idempotency-key lookup (checks for existing post before calling service), credit gate (checkCredits with slideCount=undefined → 1×), credit deduction on success, and HTTP 503 surface on `PreScreenUnavailableError` (D-05 maps to 503; see D-06 for error shape).
- **No blockers.** `npm run check` green. `npx tsx scripts/verify-phase-06.ts` exits 0 with 7/7 PASS keyless; with stubbed key all 4 ENHC requirements exercise end-to-end.
- **All 10 Phase 6 requirements complete** (BILL-01 from 06-01; CRSL-02/03/06/09/10 from 06-02; ENHC-03/04/05/06 from 06-03).

## Self-Check: PASSED

- `server/services/enhancement.service.ts` created — FOUND (`git log --oneline -3` shows `d03ae41` scaffold + `835e5e9` full impl; file exists on disk, 537 lines)
- `scripts/verify-phase-06.ts` modified — FOUND (`git log` shows `deb803a` with +634/-8 diff)
- `package.json` / `package-lock.json` modified for sharp bump — FOUND (diff in `835e5e9`)
- Commit `d03ae41` exists — FOUND (`git log` lists it with `feat(06-03): scaffold...`)
- Commit `835e5e9` exists — FOUND (`git log` lists it with `feat(06-03): implement enhanceProductPhoto pipeline`)
- Commit `deb803a` exists — FOUND (`git log` lists it with `feat(06-03): fill ENHC-03/04/05/06 live assertions...`)
- `npm run check` green — VERIFIED at each task boundary (3 clean tsc runs post-sharp-bump)
- `npx tsx scripts/verify-phase-06.ts` exits 0 with `VERIFY PHASE 06: PASS (7/7 implemented criteria)` keyless — VERIFIED at Task 3 completion
- With stubbed `TEST_GEMINI_API_KEY`: ALL 8 ENHC live assertions PASS (sub-cases A/B/C/D + ENHC-04 + ENHC-05 square + ENHC-05 scenery + ENHC-03 EXIF download-inspect) — VERIFIED in Task 3
- No imports from `express`, `server/routes` (except whitelisted style-catalog.routes), `server/lib/sse` in the service — VERIFIED via verifier's own AC-13 assertion (PASS output), and grep confirms
- EXIF stripped at both Gemini submission boundary (squareBuffer flows through autoOrient before inlineData) and both Supabase Storage writes (sourceBuffer and resultWebp both flow through autoOrient before upload) — VERIFIED via verifier's own AC-6 download-and-inspect assertion (orientation=undefined, exif=undefined on both files)
- CRSL-* and BILL-01 assertions from Plans 06-02 / 06-01 preserved untouched — VERIFIED (CRSL-09 and CRSL-10 structural PASSes still appear; BILL-01 PASS still appears; no ENHC edit touched CRSL code paths)

---

*Phase: 06-server-services*
*Completed: 2026-04-21*
