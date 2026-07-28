# Phase 7: Server Routes - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Thin route layer for two new endpoints: `POST /api/carousel/generate` and `POST /api/enhance`. Routes own: auth, credit gating, idempotency check, AbortController wiring, SSE lifecycle, `recordUsageEvent` (aggregated token totals), and `deductCredits`. No generation, storage, or DB writes live in routes — those are Phase 6 service concerns (D-16, D-17). Phase 7 ships two new route files and wires them into `server/routes/index.ts`.

</domain>

<decisions>
## Implementation Decisions

### Idempotency gate

- **D-01:** Idempotency check runs **before** SSE opens, in the same pre-SSE gating layer as auth, credits, and request validation. If `idempotency_key` matches an existing `posts` row owned by the authenticated user, return **JSON 200** with the existing post object — no SSE, no service call, no credit deduction, no new `usage_events` row. Pattern: `SELECT * FROM posts WHERE idempotency_key = $1 AND user_id = $2`. If the hit is for a row with `status = 'draft'` (partial success), return the draft post as-is. Client must handle a JSON 200 (not SSE) for the idempotency-hit code path.
- **D-02:** Idempotency check is **pessimistic** (pre-flight SELECT before calling the service), not optimistic (catch 23505). Rationale: calling the service is expensive (Gemini calls, uploads); never start generation for a duplicate key.

### SSE event shape

- **D-03:** Carousel complete event shape: `{ type: "complete", post, status: "completed" | "draft", saved_slide_count: N, image_urls: string[], caption: string }`. `status` directly reflects `result.status` from `generateCarousel()`. Frontend adapts UI based on `status` — no separate event type for partial vs full success.
- **D-04:** Enhancement complete event shape: `{ type: "complete", post, image_url: string, caption: string }`. Single event; enhancement has no partial-success contract.
- **D-05:** Per-slide progress forwarding for carousel: route's `onProgress` callback maps Phase 6 progress events to SSE events. Mapping: `text_plan_start` → `sendProgress("text_plan", "Crafting slide plan…", 5)`, `text_plan_complete` → `sendProgress("text_plan", "Plan ready. Generating slides…", 10)`, `slide_start {slideNumber}` → `sendProgress("slide_N", "Generating slide N…", 10 + slideNumber * Math.floor(80 / slideCount))`, `slide_complete / slide_failed` → progress update, `complete` → `sendComplete(...)`. Enhancement: `pre_screen_start` → 5%, `pre_screen_passed` → 20%, `normalize_start/complete` → 35%, `enhance_start` → 50%, service's `complete` → route calls `sendComplete`.
- **D-06:** SSE heartbeat: call `sse.startHeartbeat()` immediately after `initSSE(res)` — same as generate.routes.ts.

### Error response codes

- **D-07:** Typed `error` field in all error responses — mirrors the existing pattern in generate.routes.ts (`"insufficient_credits"`, `"upgrade_required"`, etc.). New error codes:
  - `"carousel_full_failure"` — `CarouselFullFailureError` (below 50% threshold, no post saved)
  - `"pre_screen_rejected"` — `PreScreenRejectedError` (enhancement image blocked by pre-screen)
  - `"pre_screen_unavailable"` — `PreScreenUnavailableError` (pre-screen Gemini call failed)
  - `"carousel_aborted"` — `CarouselAbortedError` (safety timer fired — this case actually resolves to a draft or full failure depending on saved slides; route inspects `error.savedSlideCount` to decide)
  - `"enhancement_aborted"` — `EnhancementAbortedError`
- **D-08:** Pre-SSE errors (auth, validation, credits, idempotency hit) return JSON with standard shape. Post-SSE errors (generation failures) go through `sse.sendError({message, error, statusCode})`. Pre-screen rejection fires POST-SSE (the pre-screen is a Gemini call that happens inside the service after SSE opens).

### AbortController and safety timer

- **D-09:** Route creates one `AbortController` per request and passes `controller.signal` to the service. Safety timer: `setTimeout(() => controller.abort(), 260_000)` — 260s cap matches the Phase 6 CONTEXT design (D-01 in Phase 6 CONTEXT). Vercel's hard kill at 280s leaves 20s for teardown. On timer fire: if carousel result has `savedSlideCount > 0`, treat as partial success and surface a `complete` event with `status: "draft"`; if `savedSlideCount === 0`, surface `sendError({ error: "carousel_full_failure", ... })`. Enhancement timeout surfaces as `sendError({ error: "enhancement_aborted", ... })`.
- **D-10:** AbortController signal is NOT threaded into each Gemini fetch call inside the service for individual fetch abort (that's a Phase 7+ concern). The signal is used for the inter-slide `aborted` check already implemented in Phase 6 service.

### Billing (BILL-02, BILL-03, BILL-04)

- **D-11:** `recordUsageEvent` called once per carousel request (BILL-02). Token totals are summed from `result.tokenTotals` returned by `generateCarousel()` — the service accumulates `text_input_tokens + text_output_tokens` from the master text call and sums `image_input_tokens + image_output_tokens` across all successful slides. Route passes the aggregated object to `recordUsageEvent(userId, postId, "generate", aggregatedTokens, { text_model, image_model })`.
- **D-12:** For carousel, `checkCredits` is called with `slideCount = request.slide_count` (the requested count) BEFORE generation, and `deductCredits` is called with `usageEvent.charged_amount_micros` AFTER generation. Credit check uses the requested count (to verify headroom); deduction uses actual cost from the usage event, which is based on token actuals for the slides that succeeded. For a partial-success carousel (3 of 5 slides saved), the usage event records tokens for the 3 successful slides — so billing naturally reflects actual work done. No separate "partial credit" calculation needed (BILL-03, BILL-04).
- **D-13:** Enhancement `checkCredits` uses `slideCount: undefined` (→ 1× single-image cost) per Phase 6 D-20. One `recordUsageEvent` call, one `deductCredits` call.

### Route file layout

- **D-14:** Two new route files: `server/routes/carousel.routes.ts` and `server/routes/enhance.routes.ts`. Registered in `server/routes/index.ts` following the existing import block pattern. Endpoints: `POST /api/carousel/generate` and `POST /api/enhance`.
- **D-15:** 5 MB enforcement for enhancement: check `Buffer.byteLength(body.image.data, 'base64') > 5 * 1024 * 1024` after Zod parse — return JSON 400 before SSE if exceeded. The 5 MB limit is noted in `enhanceRequestSchema` comment as a "route layer" concern.
- **D-16:** Request body parsing for both routes: standard `express.json()` (JSON body with base64 image for enhancement) — no `multer` or multipart/form-data. `enhanceRequestSchema.image.data` is already base64 per shared/schema.ts Phase 5.

### Claude's Discretion

- Exact progress percentage breakpoints per SSE sendProgress call (within the ranges implied by D-05).
- Internal helper names and file-local utilities (e.g., `mapCarouselProgress`, `buildCarouselCompletePayload`).
- `logGenerationError` usage — mirror the generate.routes.ts pattern; use for credits, validation, generation, upload, and database error types.
- Error message strings (English only in Phase 7; i18n is Phase 9).
- Whether carousel and enhancement routes each define their own `sanitizeRequestForLogging` helper or share one.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing route pattern (primary reference)
- `server/routes/generate.routes.ts` — Canonical route structure: auth middleware → credit gate (JSON before SSE) → initSSE → heartbeat → safety timer → service call → recordUsageEvent → deductCredits → sendComplete. Every new route mirrors this shape exactly.
- `server/lib/sse.ts` — SSEWriter interface and initSSE() factory. sendProgress(phase, message, progress), sendComplete(data), sendError({message, error, statusCode}), startHeartbeat(), isClosed().

### Auth and credit middleware
- `server/middleware/auth.middleware.ts` — authenticateUser, getGeminiApiKey, usesOwnApiKey, AuthenticatedRequest
- `server/quota.ts` — checkCredits (with optional slideCount), deductCredits, recordUsageEvent

### Services (Phase 6 outputs — route wires these)
- `server/services/carousel-generation.service.ts` — generateCarousel(params): Promise<CarouselGenerationResult>. Accepts onProgress callback. Returns {post, savedSlideCount, status, imageUrls, caption, tokenTotals}.
- `server/services/enhancement.service.ts` — enhanceProductPhoto(params): Promise<EnhancementResult>. Accepts onProgress callback and signal. Returns {post, imageUrl, caption, tokenTotals}.

### Request schemas (Phase 5 outputs)
- `shared/schema.ts` §carouselRequestSchema (lines ~869-882) — prompt, slide_count (3-8), aspect_ratio (1:1|4:5), idempotency_key (UUID), content_language, post_mood, text_style_id/ids, use_logo, logo_position
- `shared/schema.ts` §enhanceRequestSchema (lines ~884-893) — scenery_id, idempotency_key (UUID), image {mimeType, data}

### Phase decisions
- `.planning/phases/06-server-services/06-CONTEXT.md` — D-15 (onProgress callback seam), D-18/D-19/D-20 (slideCount param), D-21 (recordUsageEvent is Phase 7's job)
- `.planning/phases/06-server-services/06-RESEARCH.md` — Service result object shapes, typed error class hierarchy (CarouselFullFailureError, CarouselAbortedError, PreScreenRejectedError, PreScreenUnavailableError, EnhancementAbortedError)

### Route registration
- `server/routes/index.ts` — Where to add import + router.use() for the two new route files

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `initSSE(res)` — Drop-in SSE factory; returns SSEWriter with sendProgress/sendComplete/sendError/startHeartbeat/isClosed
- `authenticateUser` middleware — Populates `req.user`, `req.profile`; used verbatim
- `getGeminiApiKey(req)` / `usesOwnApiKey(userId)` — Auth helpers; copy usage from generate.routes.ts
- `checkCredits` / `deductCredits` / `recordUsageEvent` — Billing pipeline; all three used in sequence
- `createAdminSupabase()` — For idempotency pre-check SELECT

### Established Patterns
- Auth → validate → credit check → initSSE → try/finally with safetyTimer — this ordering is locked; routes MUST follow it
- Pre-SSE errors: `return res.status(4xx).json({ error, message })` — JSON, never SSE
- Post-SSE errors: `sse.sendError({ message, error, statusCode })` then the outer catch swallows
- `clearTimeout(safetyTimer)` in both success and error paths

### Integration Points
- `server/routes/index.ts` — Add two `import` + `router.use()` entries
- `server/index.ts` — No changes needed; createApiRouter() already registered
- `server/middleware/auth.middleware.ts` — No changes needed

</code_context>

<specifics>
## Specific Ideas

- User confirmed "do recommended" for all three gray areas — no overrides.
- Enhancement image is always base64 in the JSON body (`image.data`) — no multipart/form-data; no multer.
- Idempotency hit returns the existing post as JSON 200 (not SSE) — client must handle both SSE and JSON 200 for these endpoints.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-server-routes*
*Context gathered: 2026-04-22*
