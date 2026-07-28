---
phase: 07-server-routes
verified: 2026-04-22T12:00:00Z
status: human_needed
score: 11/11 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 9/9 plan-01 truths; 7/11 requirements deferred
  gaps_closed:
    - "server/routes/enhance.routes.ts created and fully implemented (ENHC-01, ENHC-02, ENHC-07, ENHC-08)"
    - "ENHC-08 compliance confirmed — no ensureCaptionQuality or applyLogoOverlay calls in enhance.routes.ts"
    - "carousel.routes.ts and enhance.routes.ts both mounted in server/routes/index.ts (Plan 07-03 complete)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "End-to-end SSE streaming from POST /api/carousel/generate"
    expected: "Per-slide progress events arrive on the client SSE stream; final complete event includes post, status, saved_slide_count, image_urls, caption"
    why_human: "Requires live Supabase + Gemini credentials; cannot simulate SSE behavior with static analysis"
  - test: "Idempotency duplicate request on /api/carousel/generate returns JSON 200"
    expected: "Second call with same idempotency_key returns { idempotent: true, post: <existing row> } as JSON 200 with no SSE opened, no generation, no new usage_events row"
    why_human: "Requires registered route and live Supabase round-trip"
  - test: "POST /api/enhance end-to-end: upload product photo, select scenery, receive enhanced image URL"
    expected: "SSE stream emits pre_screen_start, pre_screen_passed, normalize_start, normalize_complete, enhance_start, complete events; final complete payload contains { type:'complete', post, image_url, caption } where caption is the scenery label"
    why_human: "Requires live credentials and a real product photo; cannot simulate pre-screen or Gemini image edit with static analysis"
  - test: "Partial success billing (draft carousel deducts only for successful slides)"
    expected: "Draft post billed for N successful slides; usage_events row shows token totals summed for successful slides only; deducted credits equal successful_slides x single-image cost"
    why_human: "Requires live Gemini call with engineered mid-generation failures"
  - test: "Pre-screen rejection on /api/enhance (face photo upload)"
    expected: "SSE stream emits pre_screen_start, then sendError with error:'pre_screen_rejected' and statusCode 422; no recordUsageEvent or deductCredits called"
    why_human: "Requires a real face photograph and live Gemini pre-screen call"
---

# Phase 7: Server Routes Verification Report

**Phase Goal:** The carousel and enhancement API endpoints are live, correctly orchestrated over Phase 6 services, and enforce idempotency, partial-success billing, and single usage-event recording
**Verified:** 2026-04-22T12:00:00Z
**Status:** human_needed — all automated checks pass; 5 items require live credentials for behavioral verification
**Re-verification:** Yes — after gap closure (Plans 07-02 and 07-03 executed since initial verification)

## Re-verification Context

Initial verification (2026-04-22T02:10:00Z) found three gaps:
1. `server/routes/enhance.routes.ts` did not exist
2. ENHC-08 compliance could not be verified (file missing)
3. Routes not registered in `server/routes/index.ts`

All three gaps are closed. This report verifies the complete phase.

---

## Goal Achievement

### Observable Truths — All Plans

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /api/carousel/generate authenticates, validates with carouselRequestSchema, returns 400 on failure | VERIFIED | carousel.routes.ts line 89: route registered; line 139: `carouselRequestSchema.safeParse(req.body)`; line 148: 400 return |
| 2 | Idempotency hit on carousel returns JSON 200, does NOT open SSE / call service / bill | VERIFIED | Lines 155-168: admin SELECT `.eq("idempotency_key"...).eq("user_id"...).maybeSingle()` → `return res.status(200).json({ idempotent: true, post: existingPost })` — all downstream bypassed |
| 3 | Carousel credit gate runs BEFORE initSSE; denial returns JSON 402 with correct error codes | VERIFIED | Line 172: `checkCredits(user.id, "generate", false, parsed.slide_count)`; SSE initialized at line 211; 402 response at line 199 |
| 4 | Carousel SSE pipeline: initSSE → heartbeat → AbortController 260s → generateCarousel with onProgress + signal | VERIFIED | Lines 211-293: all four components present in correct order |
| 5 | onProgress mapping: text_plan_start→5%, text_plan_complete→10%, slide events→10%+i*floor(80/slideCount), complete→95% | VERIFIED | Lines 229-270: full switch on all 6 event types with correct formulas |
| 6 | On success/draft: recordUsageEvent ONCE (summed tokenTotals) then deductCredits ONCE; single sendComplete | VERIFIED | Lines 432-471: one recordUsageEvent, one conditional deductCredits, one sendComplete at line 464 |
| 7 | CarouselFullFailureError → sendError error:'carousel_full_failure'; NO billing | VERIFIED | Lines 319-333: instanceof check → `sse.sendError({ error: "carousel_full_failure", statusCode: 500 })` → return (billing code unreachable) |
| 8 | CarouselAbortedError savedSlideCount≥1 → partial success billing; savedSlideCount===0 → carousel_aborted error | VERIFIED | Lines 297-318: branched on `err.savedSlideCount >= 1` |
| 9 | sendComplete payload: { type:'complete', post, status, saved_slide_count, image_urls, caption } per D-03 | VERIFIED | Lines 464-471: exact field names confirmed |
| 10 | POST /api/enhance authenticates, validates with enhanceRequestSchema, enforces 5 MB guard, idempotency, credit gate — all pre-SSE | VERIFIED | Lines 87-215 of enhance.routes.ts: auth→profile→key→brand→safeParse→5MB guard→idempotency→checkCredits all before `initSSE(res)` at line 218 |
| 11 | Enhancement response contains NO logo overlay and NO caption post-processing; single billing path; single sendComplete | VERIFIED | `grep -c "ensureCaptionQuality\|applyLogoOverlay\|use_logo"` = 0; one `sse.sendComplete` call at line 406; one `recordUsageEvent` at line 372; one `deductCredits` at line 388 |

**Score:** 11/11 truths verified

---

## Required Artifacts

| Artifact | Min Lines | Status | Details |
|----------|-----------|--------|---------|
| `server/routes/carousel.routes.ts` | 280 | VERIFIED | 474 lines; exports default router; `router.post("/api/carousel/generate")` present |
| `server/routes/enhance.routes.ts` | 220 | VERIFIED | 414 lines; exports default router; `router.post("/api/enhance")` present |
| `server/routes/index.ts` | — | VERIFIED | Both routes imported and mounted; carouselRoutes: 3 occurrences (import+use+export); enhanceRoutes: 3 occurrences |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| carousel.routes.ts | carousel-generation.service.ts | `generateCarousel({..., onProgress, signal})` | WIRED | Line 278: await generateCarousel with all required params including signal and onProgress |
| carousel.routes.ts | server/quota.ts | checkCredits(slide_count), recordUsageEvent, deductCredits | WIRED | Line 172: checkCredits; line 432: recordUsageEvent; line 448: deductCredits — correct order |
| carousel.routes.ts | server/supabase.ts | createAdminSupabase() for idempotency SELECT | WIRED | Line 155: createAdminSupabase(); lines 157-161: .from("posts").eq("idempotency_key"...).maybeSingle() |
| carousel.routes.ts | server/lib/sse.ts | initSSE(res) + sendProgress + sendComplete + sendError | WIRED | Lines 211-471: all four SSEWriter methods used |
| enhance.routes.ts | enhancement.service.ts | `enhanceProductPhoto({..., onProgress, signal})` | WIRED | Lines 264-273: await enhanceProductPhoto with all required params |
| enhance.routes.ts | server/quota.ts | checkCredits(undefined), recordUsageEvent, deductCredits | WIRED | Line 179: checkCredits with undefined slideCount (1x cost); line 372: recordUsageEvent; line 388: deductCredits |
| enhance.routes.ts | server/supabase.ts | createAdminSupabase() for idempotency SELECT | WIRED | Line 162: createAdminSupabase(); lines 163-168: .from("posts").eq("idempotency_key"...).maybeSingle() |
| enhance.routes.ts | server/lib/sse.ts | initSSE(res) + sendProgress + sendComplete + sendError | WIRED | Lines 218-411: all four SSEWriter methods used |
| server/routes/index.ts | carousel.routes.ts | import carouselRoutes + router.use(carouselRoutes) | WIRED | Lines 31-32 (import), line 50 (router.use), line 87 (export) |
| server/routes/index.ts | enhance.routes.ts | import enhanceRoutes + router.use(enhanceRoutes) | WIRED | Lines 31-32 (import), line 51 (router.use), line 88 (export) |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| carousel.routes.ts | `result` (CarouselGenerationResult) | generateCarousel() → writes to Supabase posts/post_slides | Yes — Phase 6 service writes to DB | FLOWING |
| carousel.routes.ts | `existingPost` (idempotency) | adminSb SELECT on posts with user_id + idempotency_key WHERE | Yes — real DB query | FLOWING |
| carousel.routes.ts | `finalPost` (sendComplete payload) | adminSb SELECT on posts by result.postId after billing | Yes — real DB query | FLOWING |
| carousel.routes.ts | `usageEvent` (billing) | recordUsageEvent() inserts into usage_events, returns id + cost fields | Yes — real DB write, returned values used in deductCredits | FLOWING |
| enhance.routes.ts | `result` (EnhancementResult) | enhanceProductPhoto() → uploads to storage, writes posts row | Yes — Phase 6 service; storage paths at `${userId}/enhancement/${postId}*.webp` confirmed at service lines 415-416 | FLOWING |
| enhance.routes.ts | `existingPost` (idempotency) | adminSb SELECT on posts | Yes — real DB query | FLOWING |
| enhance.routes.ts | `finalPost` (sendComplete payload) | adminSb2 SELECT on posts by result.postId | Yes — real DB query | FLOWING |
| enhance.routes.ts | sendComplete caption | `result.scenery.label` — scenery resolved by service from style_catalog platform_setting | Yes — real DB lookup in service | FLOWING |

---

## Behavioral Spot-Checks

TypeScript compilation is the only runnable static check. Live HTTP checks require credentials.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean | `npm run check` | Exit 0, no output | PASS |
| No 501 stub in carousel route | `grep -c "501" carousel.routes.ts` | 0 | PASS |
| Single sendComplete in carousel | `grep -c "sse.sendComplete" carousel.routes.ts` | 1 | PASS |
| clearTimeout in both paths (carousel) | `grep -c "clearTimeout(safetyTimer)" carousel.routes.ts` | 2 | PASS |
| ENHC-08: no logo/caption calls in enhance | `grep -c "ensureCaptionQuality\|applyLogoOverlay\|use_logo" enhance.routes.ts` | 0 | PASS |
| Single sendComplete in enhance | `grep -c "sse.sendComplete" enhance.routes.ts` | 1 | PASS |
| clearTimeout in both paths (enhance) | `grep -c "clearTimeout(safetyTimer)" enhance.routes.ts` | 2 | PASS |
| No multer in enhance (JSON body only) | `grep -c "multer" enhance.routes.ts` | 0 | PASS |
| Both routes mounted in index.ts | `grep -c "router.use(carouselRoutes)\|router.use(enhanceRoutes)" index.ts` | 2 | PASS |
| carousel.routes.js import in index.ts | `grep -c "carousel.routes.js" index.ts` | 1 | PASS |
| enhance.routes.js import in index.ts | `grep -c "enhance.routes.js" index.ts` | 1 | PASS |

All live behavioral tests are in the Human Verification section below.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CRSL-01 | 07-01, 07-03 | User can generate multi-slide carousel from prompt | SATISFIED | POST /api/carousel/generate exists, implemented, registered in index.ts |
| CRSL-05 | 07-01 | Each slide emits distinct SSE progress event | SATISFIED | onProgress maps slide_start/slide_complete/slide_failed to distinct sendProgress calls; slide_count drives N events |
| CRSL-07 | 07-01 | Partial success saves as draft with actual slide_count | SATISFIED | Service returns status='draft' + actual slideCount; route passes to sendComplete |
| CRSL-08 | 07-01 | Duplicate idempotency_key returns existing post | SATISFIED | Pessimistic SELECT pre-flight at lines 155-168; returns JSON 200 on hit without billing |
| ENHC-01 | 07-02, 07-03 | User can upload product photo and receive enhanced version | SATISFIED | POST /api/enhance exists with 5 MB guard (line 153), JSON base64 upload, SSE complete, registered in index.ts |
| ENHC-02 | 07-02 | User selects scenery preset; no free-text scenery prompt | SATISFIED (route level) | Route accepts `scenery_id` (required string per enhanceRequestSchema); passes to enhanceProductPhoto which resolves via style_catalog; no free-text scenery field in schema |
| ENHC-07 | 07-02 (service) | Result at user_assets/{userId}/enhancement/{postId}.webp; source at {postId}-source.webp | SATISFIED | Service lines 415-416 confirm exact paths: `${userId}/enhancement/${postId}-source.webp` + `${userId}/enhancement/${postId}.webp` uploaded to `user_assets` bucket |
| ENHC-08 | 07-02 | Enhancement posts skip logo overlay and caption quality | SATISFIED | `grep "ensureCaptionQuality\|applyLogoOverlay\|use_logo"` = 0 in enhance.routes.ts; caption at sendComplete is `result.scenery.label` (plain label, no quality pass) |
| BILL-02 | 07-01 | One usage_events row per carousel | SATISFIED | Single recordUsageEvent call site (line 432); idempotency path bypasses it entirely; no per-slide calls |
| BILL-03 | 07-01 | Draft carousel deducts for successful slides only | SATISFIED | tokenTotals from service summed for successful slides only; route passes them directly to recordUsageEvent |
| BILL-04 | 07-01, 07-02 | Retries with same idempotency_key do not create additional usage_events | SATISFIED | Idempotency gate returns early before any billing code in both routes |

**All 11 requirements: SATISFIED**

Note on ENHC-02: The requirement is fully implemented at the route and service layers. The checkbox remains unchecked in REQUIREMENTS.md because the admin-curated catalog UI (ADMN-01..03, Phase 8) is not yet deployed — the scenery catalog exists as seeded data but lacks the admin CRUD surface. The route correctly enforces `scenery_id` selection from the catalog without free-text fallback.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| carousel.routes.ts | 281 | `brand: brand as any` | Info | Type assertion needed — Supabase client returns generic type for `.select("*")`; matches generate.routes.ts pattern; not a stub |
| carousel.routes.ts | 403 | `(s: any)` in slide row map | Info | Supabase returns generic type for dynamic select; data flows correctly |
| enhance.routes.ts | None | No anti-patterns found | — | Clean file |

No blockers. No TODO/FIXME/placeholder comments. No empty implementations. No hardcoded empty arrays/objects flowing to render.

---

## ROADMAP Success Criteria Coverage

| SC # | Criterion | Status |
|------|-----------|--------|
| SC-1 | POST /api/carousel/generate accepts valid request and streams per-slide SSE | SATISFIED — route implemented and registered |
| SC-2 | Duplicate idempotency_key returns existing post without re-running | SATISFIED — idempotency gate verified |
| SC-3 | Partial success below 50% → zero credit deduction + structured error on SSE | SATISFIED — CarouselFullFailureError path verified |
| SC-4 | Partial success meeting threshold → status='draft', credits for successful slides only | SATISFIED — draft billing path verified |
| SC-5 | POST /api/enhance accepts upload (≤5 MB), returns SSE complete with result URL at correct storage path | SATISFIED — route implemented and registered; service owns storage path |
| SC-6 | Enhancement posts contain only enhanced image URL and plain caption | SATISFIED — ENHC-08 confirmed; caption = scenery.label |
| SC-7 | One usage_events row per carousel with token totals summed across all slides | SATISFIED — single recordUsageEvent call site in carousel route |

---

## Human Verification Required

### 1. End-to-End SSE Streaming — Carousel

**Test:** Send a valid POST /api/carousel/generate request (prompt, slide_count=4, aspect_ratio="1:1", uuid idempotency_key, valid post_mood) with a real Gemini API key and configured brand. Monitor the SSE stream.
**Expected:** Events arrive in order: progress(auth,2%) → progress(text_plan,5%) → progress(text_plan,10%) → progress(slide_1,...) × 4 → progress(finalizing,95%) → complete event with `{ type:"complete", post, status:"completed", saved_slide_count:4, image_urls:[...], caption }`.
**Why human:** Requires live Supabase + Gemini credentials; SSE streaming behavior cannot be verified with static analysis.

### 2. Idempotency Duplicate Request — Carousel

**Test:** Send identical POST /api/carousel/generate body twice (same idempotency_key UUID). Inspect both responses.
**Expected:** First request completes normally via SSE. Second request returns `{ idempotent: true, post: <existing DB row> }` as JSON 200 with Content-Type: application/json (not text/event-stream), and no new usage_events row is created.
**Why human:** Requires registered route and live Supabase round-trip.

### 3. End-to-End SSE — Enhancement

**Test:** Send POST /api/enhance with a JPEG product photo (≤5 MB) as base64, a valid scenery_id from the catalog, and a uuid idempotency_key.
**Expected:** SSE emits pre_screen_start→pre_screen_passed→normalize_start→normalize_complete→enhance_start→complete (at ≥95%). Final complete payload: `{ type:"complete", post, image_url: "https://.../user_assets/{userId}/enhancement/{postId}.webp", caption: "<scenery label>" }`. Storage contains both `{postId}.webp` and `{postId}-source.webp`.
**Why human:** Requires live Gemini pre-screen + image edit call and Supabase storage.

### 4. Pre-Screen Rejection on Enhancement (Face Photo)

**Test:** Upload a portrait/face photograph to POST /api/enhance.
**Expected:** SSE emits pre_screen_start, then an error event: `{ error:"pre_screen_rejected", statusCode:422, message:"Upload must be a product photo..." }`. No usage_events row created.
**Why human:** Requires a real face photograph and live Gemini pre-screen validation.

### 5. Partial Success Billing (Draft Carousel)

**Test:** Trigger a carousel where some slides fail (e.g., using an API key at quota limit mid-generation, or engineered network failures for specific slides). Inspect usage_events table afterward.
**Expected:** usage_events row records token totals for successful slides only; deducted credits equal successful_slides × single-image cost, not the originally requested count; post.status = "draft"; post.slide_count = actual saved count.
**Why human:** Cannot simulate mid-generation Gemini failures with static analysis.

---

## Gaps Summary

No gaps. All three gaps from the initial verification are closed:

1. `server/routes/enhance.routes.ts` — created at 414 lines with full SSE pipeline, all 5 error types handled, single billing path, ENHC-08 compliance confirmed.
2. ENHC-08 — zero calls to `ensureCaptionQuality`, `applyLogoOverlay`, or `use_logo` anywhere in enhance.routes.ts.
3. Route registration — both `carouselRoutes` and `enhanceRoutes` imported, mounted via `router.use()`, and exported in `server/routes/index.ts`. TypeScript compiles clean.

The phase goal is structurally achieved: both endpoints are live, orchestrated over Phase 6 services, idempotency gating is enforced, partial-success billing is wired, and single usage-event recording is implemented. Remaining items are all behavioral checks that require live credentials.

---

_Verified: 2026-04-22T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
