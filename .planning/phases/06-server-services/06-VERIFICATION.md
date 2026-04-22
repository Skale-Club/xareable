---
phase: 06-server-services
verified: 2026-04-21T00:00:00Z
status: human_needed
score: 10/10 must-haves verified (structural + BILL-01 end-to-end); 7 live Gemini assertions SKIPped pending TEST_GEMINI_API_KEY
requirements:
  - id: BILL-01
    status: satisfied
    evidence: "server/quota.ts:340 signature extended with optional 4th param slideCount?:number; line 347 single slideMultiplier clamp; line 368 single multiplication at estimatedCostMicros. Live verifier asserts single=117000µ$, 5×=585000µ$ — PASS."
  - id: CRSL-02
    status: satisfied
    evidence: "server/services/carousel-generation.service.ts:492 generateCarousel exists; helpers buildCarouselMasterPrompt/callCarouselTextPlan/generateSlideOne/generateSlideNWithSignature invoke TEXT_MODEL='gemini-2.5-flash' (line 23) once per job and IMAGE_MODEL='gemini-3.1-flash-image-preview' (line 24) sequentially N times with 3000ms D-02 delay. Live count assertion SKIPped pending TEST_GEMINI_API_KEY."
  - id: CRSL-03
    status: satisfied
    evidence: "generateSlideNWithSignature sends role:'model' turn carrying slide-1 inlineData + thoughtSignature per research Pattern 4. D-06 fallback (generateSlideNFallbackSingleTurn) covers both signature-absent and signature-rejected (400) paths. Live body-shape assertion SKIPped pending TEST_GEMINI_API_KEY."
  - id: CRSL-06
    status: satisfied
    evidence: "params.signal?.aborted checked between slides (line 617 loop guard); partial-success applied to completed slides before CarouselAbortedError propagates. Abort-timing assertion SKIPped pending TEST_GEMINI_API_KEY."
  - id: CRSL-09
    status: satisfied
    evidence: "grep 'ensureCaptionQuality(' server/services/carousel-generation.service.ts returns exactly 1 call site (line 673) — AFTER the slide loop, never inside it. Verifier CRSL-09 source-grep PASSes."
  - id: CRSL-10
    status: satisfied
    evidence: "grep 'enforceExactImageText' server/services/carousel-generation.service.ts returns 0 matches. Verifier CRSL-10 source-grep PASSes. Partial-success contract: successRate >=0.5 AND slide1Succeeded → status='draft' with slide_count=successfulSlides.length (line 691); else CarouselFullFailureError."
  - id: ENHC-03
    status: satisfied
    evidence: "server/services/enhancement.service.ts:294 stripExifAndNormalize — sharp(buf).autoOrient().webp({quality:90}).toBuffer() for source (line 301); autoOrient() applied again before storage write of result (line 535). Post-call re-squaring also flows through autoOrient (line 523). Download-and-inspect verification SKIPped pending TEST_GEMINI_API_KEY."
  - id: ENHC-04
    status: satisfied
    evidence: "buildEnhancementPrompt (referenced from enhanceProductPhoto at line 445) emits verbatim preservation rules from research §Code Examples — 'Task: Place this product...', 'Do NOT add text, logos, or overlays.', 'shape, silhouette, color, proportions, branding, and surface texture must remain identical.' Scenery.prompt_snippet interpolated. Live prompt-content assertion SKIPped pending TEST_GEMINI_API_KEY."
  - id: ENHC-05
    status: satisfied
    evidence: "stripExifAndNormalize line 311 — sharp(buf).autoOrient().resize(size, size, { fit:'contain', background:{r:255,g:255,b:255,alpha:1} }).png().toBuffer() with size=max(width,height). Post-call re-squaring defense (line 523) handles non-square edit output. Live square-metadata inspection SKIPped pending TEST_GEMINI_API_KEY."
  - id: ENHC-06
    status: satisfied
    evidence: "runPreScreen calls gemini-2.5-flash:generateContent with responseMimeType='application/json' and responseJsonSchema (5 rejection_category values, 3 confidence values) per research Pattern 5. Line 475–480 enforces D-07 confidence gate (reject only high|medium). D-05 fail-closed: non-2xx/non-JSON/missing fields → PreScreenUnavailableError with no image-model call. grep for applyLogoOverlay/enforceExactImageText/logo_url/logoPosition returns 0 matches. All 3 structural verifier assertions PASS; 4 live sub-cases (A/B/C/D) SKIPped pending TEST_GEMINI_API_KEY."
human_verification:
  - test: "Live CRSL-02 — 1 text call + N sequential image calls"
    expected: "Set TEST_GEMINI_API_KEY in .env and re-run `npx tsx scripts/verify-phase-06.ts`. Verifier intercepts fetch and asserts exactly 1 POST to gemini-2.5-flash:generateContent and exactly 3 POSTs to gemini-3.1-flash-image-preview with ≥2900ms gaps."
    why_human: "Requires live Gemini API key; CI environment lacks TEST_GEMINI_API_KEY (by design — avoids burning real quota on every verifier run)."
  - test: "Live CRSL-03 — thoughtSignature echo + slide-1 inlineData in slides 2..N"
    expected: "With TEST_GEMINI_API_KEY set, verifier parses intercepted image-call bodies and asserts slides 2..N contain a role:'model' turn with slide-1 base64 inlineData (and thoughtSignature when slide 1 returned one)."
    why_human: "Validation requires a real Gemini response to observe whether the current gemini-3.1-flash-image-preview model returns thoughtSignature. Also informs research Open Question 2."
  - test: "Live CRSL-06 — abort mid-run"
    expected: "With TEST_GEMINI_API_KEY set, AbortController fires at 8s mid-generation; verifier accepts either CarouselAbortedError (savedSlideCount≥1) with posts.status='draft' OR CarouselFullFailureError (abort before slide 1)."
    why_human: "Race-condition outcome depends on live Gemini latency."
  - test: "Live CRSL-09 — ensureCaptionQuality runtime spy"
    expected: "Structural grep PASS is already recorded (exactly 1 call site, outside the slide loop). Optional live complement with TEST_GEMINI_API_KEY would count runtime invocations."
    why_human: "Live runtime spy requires real Gemini generation; structural proof is already stronger (it's impossible to call per-slide when the source has only 1 call site)."
  - test: "Live ENHC-03 — EXIF strip verified via download-and-inspect"
    expected: "With TEST_GEMINI_API_KEY set, verifier uploads a test JPEG with EXIF Orientation=6 + GPS tags, downloads both {postId}.webp and {postId}-source.webp from Supabase Storage, runs sharp().metadata() and asserts orientation=undefined|1 AND exif=undefined."
    why_human: "Requires live end-to-end run including Gemini image-model call (sub-case C stubs the image model so this can also run without real Gemini cost if the key is present)."
  - test: "Live ENHC-04 — verbatim preservation rules in intercepted image-model prompt"
    expected: "With TEST_GEMINI_API_KEY set, verifier intercepts image-model fetch, parses request body, and asserts 3 verbatim substrings are present plus resolved scenery.prompt_snippet."
    why_human: "Fetch interceptor needs to observe a real-ish request flow; structural guarantee exists via buildEnhancementPrompt but live confirmation catches accidental paraphrasing during future refactors."
  - test: "Live ENHC-05 — square input buffer (width===height) in intercepted image-model body"
    expected: "With TEST_GEMINI_API_KEY set, verifier decodes the inlineData.data from the intercepted image-model request and asserts sharp(decoded).metadata() returns width===height."
    why_human: "Requires a live-ish pipeline execution past the normalize stage; stub pattern still exercises this end-to-end when the key is present."
  - test: "Live ENHC-06 — 4 pre-screen sub-cases (fail-closed 503, high-reject, low-accept, no-retry)"
    expected: "With TEST_GEMINI_API_KEY set, 4 stubbed sub-cases run: (A) 503 → PreScreenUnavailableError + 0 image calls; (B) high-confidence face_or_person → PreScreenRejectedError with locked English copy + 0 image calls; (C) low-confidence face_or_person → accept path, stubbed 1×1 WebP image response flows through storage + DB insert; (D) exactly 1 pre-screen call per invocation."
    why_human: "All 4 sub-cases use fetch interception with canned responses; requires TEST_GEMINI_API_KEY to be present (the interceptor gate uses it as an enable flag even though no real Gemini quota is consumed for ENHC assertions)."
---

# Phase 6: Server Services Verification Report

**Phase Goal:** The carousel generation logic (N sequential Gemini calls with style consistency, partial-success contract, and idempotency) and the enhancement logic (EXIF stripping, pre-screen, scenery prompt injection, sharp normalization) are implemented as isolated, testable service modules; billing multiplier accepts a slide count.

**Verified:** 2026-04-21
**Status:** human_needed (all automated checks PASS; 7 live Gemini-gated assertions require TEST_GEMINI_API_KEY to exercise)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `carousel-generation.service.ts` produces 1 master text call + N sequential image calls with slide-1 passed as inlineData reference to slides 2..N | ✓ VERIFIED (structural); ? UNCERTAIN live count | TEXT_MODEL/IMAGE_MODEL constants at lines 23–24; generateSlideOne + generateSlideNWithSignature helpers wired; D-02 delay applied in loop. Live counts require TEST_GEMINI_API_KEY. |
| 2 | Partial-success contract at ≥50% + slide 1 → status='draft' with slide_count=actual; below threshold → throws | ✓ VERIFIED | carousel-generation.service.ts:663–691 implements the exact semantics; `content_type:"carousel"`, `slide_count: successfulSlides.length` (actual), `status=postStatus`. |
| 3 | 260s safety timer surfaces abort via CarouselAbortedError; partial-success applied to completed slides before throw | ✓ VERIFIED (structural); ? UNCERTAIN live timing | `params.signal?.aborted` checked between slides; error class exported. Live timing assertion SKIPped. |
| 4 | Caption quality enforcement runs once on unified caption, not per slide | ✓ VERIFIED | Exactly 1 `ensureCaptionQuality(` call site at line 673 — after slide loop, before DB insert. |
| 5 | `enhancement.service.ts` strips EXIF metadata before Gemini submission and before Supabase storage writes | ✓ VERIFIED (structural); ? UNCERTAIN live metadata inspection | `autoOrient()` applied at 3 sites: source encode (line 301), normalize-read (line 306/309), post-result encode (line 535). Live download-inspect SKIPped. |
| 6 | Pre-screen rejects faces/screenshots/unsafe before image-model call with structured rejection | ✓ VERIFIED (structural); ? UNCERTAIN live stubs | `runPreScreen` calls gemini-2.5-flash with responseJsonSchema; D-07 confidence gate at line 475–480; D-05 fail-closed. 4 live stubbed sub-cases SKIPped. |
| 7 | `checkCredits` accepts slideCount parameter; 5× multiplier for slideCount=5, 1× for slideCount=1|undefined, clamp for 0|-3 | ✓ VERIFIED (live) | Verifier PASS: single=117000µ$, 5×=585000µ$, all 5 sub-assertions pass end-to-end against minted user. |

**Score:** 7/7 truths verified structurally; 5/7 have live Gemini assertions gated behind TEST_GEMINI_API_KEY (by design per D-10 testing strategy).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/quota.ts` | checkCredits with optional slideCount multiplier, additive, backwards-compat | ✓ VERIFIED | 4th optional positional param at line 340, single Math.max clamp at 347, single multiplication at 368. 5 pre-existing callers compile unchanged. |
| `server/services/carousel-generation.service.ts` | generateCarousel + 5 typed errors + helpers; no route/SSE/express imports | ✓ VERIFIED | 29886 bytes, exports generateCarousel at line 492 plus 5 error classes, 3 interfaces, 3 constants, 1 progress event union. D-15 seam: 0 matches for `from "(express|../lib/sse|../routes)"`. |
| `server/services/enhancement.service.ts` | enhanceProductPhoto + preScreen + normalizeForEnhancement helpers; no logo/caption; D-15 seam via whitelisted style-catalog.routes | ✓ VERIFIED | 21928 bytes, exports enhanceProductPhoto at line 445, 5 error classes, REJECTION_MESSAGES, structural grep for applyLogoOverlay/enforceExactImageText/logo_url/logoPosition returns 0. D-15 seam: 0 matches for express/lib/sse; whitelisted getStyleCatalogPayload import at line 14. |
| `scripts/verify-phase-06.ts` | Live verifier with BILL-01 live + CRSL/ENHC structural + CRSL/ENHC live gated | ✓ VERIFIED | 59282 bytes, exits 0 with "VERIFY PHASE 06: PASS (7/7 implemented criteria)", 7 SKIP lines for Gemini-gated assertions. |

### Key Link Verification

| From | To | Via | Status |
|------|------|-----|--------|
| `server/quota.ts → checkCredits` | `estimatedBaseCostMicros` | `slideMultiplier = Math.max(slideCount ?? 1, 1)` at single site | ✓ WIRED |
| `carousel-generation.service.ts → generateCarousel` | gemini-2.5-flash:generateContent (master text) | callCarouselTextPlan with responseMimeType='application/json' | ✓ WIRED |
| `carousel-generation.service.ts → generateSlideN*` | gemini-3.1-flash-image-preview:generateContent | single-turn slide 1; multi-turn role:'model' + thoughtSignature for slides 2..N | ✓ WIRED |
| `carousel-generation.service.ts → generateCarousel` | posts + post_slides | createAdminSupabase().from('posts').insert + .from('post_slides').insert | ✓ WIRED (lines 685–702) |
| `carousel-generation.service.ts → generateCarousel` | user_assets/{userId}/carousel/{postId}/slide-{N}.webp | uploadSlideBuffer → direct admin.storage.from('user_assets').upload | ✓ WIRED |
| `carousel-generation.service.ts → generateCarousel` | ensureCaptionQuality (single call) | line 673, after slide loop | ✓ WIRED (CRSL-09) |
| `enhancement.service.ts → enhanceProductPhoto` | gemini-2.5-flash:generateContent (pre-screen) | responseJsonSchema enforcing 5 rejection_category enum + confidence enum | ✓ WIRED |
| `enhancement.service.ts → enhanceProductPhoto` | gemini-3.1-flash-image-preview:generateContent (edit call) | callEnhancementImageModel with contents:[{parts:[text,inlineData]}] | ✓ WIRED |
| `enhancement.service.ts → enhanceProductPhoto` | user_assets/{userId}/enhancement/{postId}.webp + {postId}-source.webp | uploadEnhancementArtifacts → direct admin.storage.from('user_assets').upload | ✓ WIRED |
| `enhancement.service.ts → enhanceProductPhoto` | posts (content_type='enhancement') | createAdminSupabase().from('posts').insert | ✓ WIRED (line 552) |
| `enhancement.service.ts → resolveScenery` | platform_settings.setting_value.sceneries | getStyleCatalogPayload() (confirmed reads `platform_settings` at style-catalog.routes.ts:20) | ✓ WIRED (PROJECT.md evolution respected — NOT stale app_settings) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| generateCarousel | slide buffers | Live gemini-3.1-flash-image-preview fetch (raw fetch with x-goog-api-key) | Yes — when TEST_GEMINI_API_KEY set | ✓ FLOWING (live path proven by 06-01 BILL-01 end-to-end; CRSL live path gated) |
| generateCarousel | text plan (shared_style, slides[], caption) | Live gemini-2.5-flash fetch | Yes — when TEST_GEMINI_API_KEY set | ✓ FLOWING (gated) |
| enhanceProductPhoto | scenery.prompt_snippet | platform_settings.setting_value.sceneries via getStyleCatalogPayload | Yes — Phase 5 seeded 12 sceneries | ✓ FLOWING |
| enhanceProductPhoto | preScreen JSON | Live gemini-2.5-flash pre-screen or stubbed response | Yes — stubbed in sub-case C; live when key present | ✓ FLOWING (gated) |
| enhanceProductPhoto | normalized square buffer | sharp autoOrient + resize contain, input from params.image.data | Yes — deterministic on any input | ✓ FLOWING |
| checkCredits | estimatedCostMicros (× slideMultiplier) | estimateBaseCostMicros (image_fallback_pricing.sell_micros=117000 µ$) | Yes — verified live | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles across monorepo | `npm run check` | exit 0, no errors | ✓ PASS |
| Phase 6 verifier self-mints, runs assertions, tears down | `npx tsx scripts/verify-phase-06.ts` | exit 0, "VERIFY PHASE 06: PASS (7/7 implemented criteria)", teardown log confirms minted user deleted | ✓ PASS |
| BILL-01 multiplier end-to-end (live) | Via verifier BILL-01 block | single=117000 µ$, 5×=585000 µ$, all 5 sub-assertions PASS | ✓ PASS |
| CRSL-09 structural proof (no spy framework) | Via verifier source-grep assertion | Exactly 1 `ensureCaptionQuality(` call site | ✓ PASS |
| CRSL-10 structural proof | Via verifier source-grep assertion | Zero `enforceExactImageText` matches | ✓ PASS |
| D-15 seam on enhancement.service.ts | Via verifier AC-13 structural assertion | Zero express/lib/sse imports; whitelisted style-catalog only | ✓ PASS |
| D-13 single-file layout | Via verifier AC-14 structural assertion | Exactly 1 enhancement-prefixed file in server/services/ | ✓ PASS |
| 7 live Gemini-gated assertions | SKIP lines printed by verifier | "SKIP — set TEST_GEMINI_API_KEY in .env to run live" | ? SKIP (routed to human_verification) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BILL-01 | 06-01 | checkCredits accepts slideCount multiplier | ✓ SATISFIED | server/quota.ts:340/347/368 + live verifier BILL-01 PASS |
| CRSL-02 | 06-02 | 1 master text call + N image calls | ✓ SATISFIED (structural); live gated | generateCarousel sequentially calls TEXT_MODEL once + IMAGE_MODEL N times with D-02 delay |
| CRSL-03 | 06-02 | Slides 2..N receive slide-1 inlineData for style consistency | ✓ SATISFIED (structural); live gated | generateSlideNWithSignature + D-06 fallback; research Pattern 4 shape |
| CRSL-06 | 06-02 | 260s safety timer surfaces abort before function cap | ✓ SATISFIED (structural); live gated | AbortSignal check between slides + CarouselAbortedError class |
| CRSL-09 | 06-02 | Caption quality runs once on unified caption | ✓ SATISFIED | Exactly 1 ensureCaptionQuality call site at line 673 post-loop |
| CRSL-10 | 06-02 | enforceExactImageText not called for carousels | ✓ SATISFIED | grep returns 0 matches |
| ENHC-03 | 06-03 | EXIF strip via sharp autoOrient before Gemini AND storage | ✓ SATISFIED (structural); live gated | autoOrient at 3 sites (source/normalize/result) |
| ENHC-04 | 06-03 | Verbatim preservation rules in enhancement prompt | ✓ SATISFIED (structural); live gated | buildEnhancementPrompt emits research §Code Examples verbatim |
| ENHC-05 | 06-03 | Normalize to 1:1 square with sharp before image model | ✓ SATISFIED (structural); live gated | stripExifAndNormalize: autoOrient + resize(size,size,{fit:'contain',background:white}) |
| ENHC-06 | 06-03 | Gemini pre-screen rejects non-product uploads before image model | ✓ SATISFIED (structural); live gated | runPreScreen + responseJsonSchema + D-05 fail-closed + D-07 confidence gate + D-08 no-retry |

All 10 Phase 6 requirement IDs are accounted for. No orphaned requirements — REQUIREMENTS.md traceability table confirms Phase 6 ownership for exactly these 10 IDs.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TODO/FIXME/XXX/HACK/PLACEHOLDER in either service file | — | Clean |

Grep across both service files for TODO/FIXME/XXX/HACK/PLACEHOLDER/"not yet implemented"/"placeholder" (case-insensitive) returned zero matches.

### Human Verification Required

7 live Gemini-gated assertions in `scripts/verify-phase-06.ts` SKIP when `TEST_GEMINI_API_KEY` is absent. This is by design (D-10 testing strategy — avoid burning real Gemini quota on every verifier run). To exercise them:

1. Populate `.env` with `TEST_GEMINI_API_KEY=<valid key>`.
2. Re-run `npx tsx scripts/verify-phase-06.ts`.
3. Expect 11 PASS lines (4 already passing + 7 previously SKIPped turning green) and exit 0.

See `human_verification` section in the YAML frontmatter above for per-assertion expected behavior. None of these are gaps — they are the documented live-API portion of the verifier contract.

### Gaps Summary

**No gaps.** All 10 requirements are satisfied structurally. BILL-01 is proven live end-to-end against a minted throwaway user. The remaining 7 live assertions (CRSL-02, CRSL-03, CRSL-06, CRSL-09-live, ENHC-03, ENHC-04, ENHC-05, ENHC-06 sub-cases A/B/C/D) are gated behind `TEST_GEMINI_API_KEY` and print instructive SKIP messages. The verifier exits 0 with "VERIFY PHASE 06: PASS (7/7 implemented criteria)" — this is the green signal that the structural contract is honored and the phase is safe to progress past.

Phase 6 is **ready for progression to Phase 7 (Server Routes)**. Phase 7 consumes `generateCarousel`/`enhanceProductPhoto` via their typed surfaces without touching the service internals, attaches the 260s safety-timer `AbortController`, forwards progress events to its SSEWriter, and records the single `usage_events` row per carousel/enhancement using `result.tokenTotals` (BILL-02 Phase 7 concern per D-21).

---

_Verified: 2026-04-21_
_Verifier: Claude (gsd-verifier)_
