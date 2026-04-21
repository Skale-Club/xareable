# Domain Pitfalls: Carousel Generator + Image Enhancement (v1.1)

**Domain:** Adding multi-slide carousel generation and product photo enhancement to an existing SSE-streamed AI SaaS
**Researched:** 2026-04-21
**Scope:** Pitfalls specific to these two features and their integration with the hardened v1.0 system

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, silent billing errors, or broken user sessions.

---

### CAROUSEL-01: Independent slide generation produces incoherent carousels

**What goes wrong:** Each slide is generated with a fresh Gemini image call carrying only a text prompt. Without a shared visual anchor, the model produces images that look like they came from different photoshoots: different lighting temperatures, different background tones, different levels of product close-up, and inconsistent color grading even when brand colors are specified. The user receives 10 technically valid slides that look nothing like a carousel.

**Why it's easy to make:** The existing `generateImageAsset` service takes a prompt and returns a buffer. The obvious carousel implementation calls it N times in a loop — same function, new slide prompt. The per-slide prompts encode narrative role ("hook", "feature", "CTA") but not visual continuity.

**Prevention:** Generate slide 1 first. Download the result buffer and pass it as `referenceImages[0]` into every subsequent slide generation call. Gemini image-to-image mode uses the reference as a visual anchor and reproduces lighting, color temperature, and subject treatment more consistently than prompt-only mode. This converts the problem from "how do I describe a consistent look?" to "here is the look, match it."

**Phase/layer:** API — carousel generation service, slide sequencing logic.

---

### CAROUSEL-02: Palette drift compounds across slides

**What goes wrong:** Even with brand hex colors in the prompt, Gemini interprets color instructions loosely. Slide 1 might render a warm amber background; slide 2 goes cooler. By slide 5, the palette has drifted. This is worse than incoherence — it looks intentional but wrong.

**Why it's easy to make:** Brand colors are already injected into single-image prompts and they work acceptably for one image. Developers assume the same approach scales to N images.

**Prevention:** Two-layer approach: (1) use the slide-1-as-reference technique from CAROUSEL-01 to propagate the rendered palette visually; (2) include an explicit palette constraint in every slide prompt: "Match the background tone and color temperature of the reference image exactly. Do not shift the warmth or saturation." Do not rely on hex color names alone — describe the rendered mood as the constraint, not the target.

**Phase/layer:** API — prompt construction for carousel slides.

---

### CAROUSEL-03: Partial success — 7 of 10 slides generated, 3 failed — unclear user contract

**What goes wrong:** Carousel generation runs sequentially. An upstream Gemini rate limit hit or transient 503 on slide 5 aborts the loop. The route either (a) throws and sends `sse.sendError`, discarding the 4 successful slides, or (b) tries to save a partial post, leading to an `N < slide_count` mismatch in the database.

**Why it's easy to make:** The existing single-image route throws on any image generation error (see `generate.routes.ts:435-442` — the catch block re-throws). Carrying this pattern to carousel means the first per-slide failure kills the whole job, wasting all prior AI spend.

**Prevention:** Define the partial-success contract explicitly before writing code. Recommended contract: if ≥ 50% of slides succeed AND slide 1 (hook) succeeded, save the partial carousel with `slide_count` set to the actual number of stored slides, mark status as `partial`, and send a completion event with a `partial_slides_warning` field. If < 50% succeed or slide 1 failed, treat as full failure, do not save, do not charge. Store slide-level error info in the post's `metadata` JSONB column so the user can see which slides failed. Do not charge for slides that failed; charge only for slides successfully generated and uploaded.

**Phase/layer:** API — carousel route error handling; Schema — `posts` table `metadata` column; Billing — per-slide credit deduction.

---

### CAROUSEL-04: Double-charging on client retry after partial failure

**What goes wrong:** User's browser disconnects mid-carousel SSE stream (network drop, tab backgrounded on mobile). The server finishes generating slides and charges credits but the client never received the `complete` event. The client retries the full carousel request. The user is charged twice; only one carousel may be saved (the second run creates a new `postId`).

**Why it's easy to make:** The existing flow for single images has the same theoretical risk, but single-image jobs complete in 10-20s so client disconnect is unlikely. Carousel jobs run 100-200s — the risk window is 10-20x larger.

**Prevention:** (1) Generate a client-side idempotency key (UUID) before submitting the carousel request; send it as a request header. (2) The server stores this key in the post record on first insert. (3) On retry with the same key, the server checks for an existing post with that idempotency key and returns the already-generated result instead of re-running. This is the same pattern used by Stripe for payment idempotency. The key must be scoped to `(user_id, idempotency_key)` to prevent key collision across users.

**Phase/layer:** Schema — `idempotency_key` column on `posts`; API — check before generation; Frontend — generate key before submit.

---

### CAROUSEL-05: Carousel SSE stream exceeds the 280-second safety timer

**What goes wrong:** 10 slides × 15s average image generation = 150s of generation time, plus text, caption quality, upload, and DB insert overhead. Sequential generation with `enforceExactImageText` per slide (if text is enabled) adds another 10-15s per slide. The existing safety timer fires at 280s (see `generate.routes.ts:325-334`), sending `sse.sendError` and logging a timeout. The user gets an error after 4.5 minutes of waiting.

**Why it's easy to make:** The 280s timer is hardcoded as a reasonable Vercel safety margin for single-image jobs. Nobody recalculated it for N-image jobs.

**Prevention:** Either (a) skip `enforceExactImageText` for carousel slides entirely — text enforcement is defined as out of scope for v1.1 (PROJECT.md lists "Text overlays or logo composition on enhancements" as out of scope; carousels share this boundary) — or (b) raise the safety timer for carousel to 500s and document that Vercel Pro's 300s limit requires the carousel endpoint to be deployed as a long-running process or background job. Simplest safe path: no per-slide text enforcement in v1.1; disable caption quality polishing for slides (it runs once on the unified caption); set slide count cap at 8 to keep worst-case under 200s.

**Phase/layer:** API — carousel route timeout configuration; Admin — slide count cap in config.

---

### CAROUSEL-06: Narrative incoherence from independent prompt generation

**What goes wrong:** Each slide gets its own Gemini text-generation call. Slide 3's "develop" call produces content that overlaps with or contradicts slide 2's "develop" call. The CTA slide may repeat the hook verbatim. The unified caption becomes disconnected from what's actually on any slide.

**Why it's easy to make:** The existing `gemini.generateText` contract is one-in, one-out. Running it per slide is structurally natural.

**Prevention:** Run one master text-generation call that produces a `slides` array: `[{ role: "hook", image_prompt, overlay_text }, { role: "develop_1", image_prompt }, ...]`. The model has the full narrative context and can ensure each slide builds on the last without contradiction. Generate the unified caption in the same call. Image generation then reads from the pre-planned `slides[i].image_prompt`. This is one text call total, not N.

**Phase/layer:** API — carousel-specific Gemini text service method.

---

### CAROUSEL-07: Gemini per-user per-minute rate limit hit by parallel slide generation

**What goes wrong:** If the carousel implementation switches from sequential to parallel (to reduce total latency), all N image generation calls fire simultaneously. Gemini's rate limits are per-API-key per-minute. 10 concurrent image generation calls from one key will hit the limit. Some calls succeed; others fail with 429. The partial failure handling then kicks in (CAROUSEL-03) but in a harder-to-predict way since failures are non-sequential.

**Why it's easy to make:** `Promise.all([...slides.map(generateImageAsset)])` is a one-liner optimization that any developer will reach for when sequential latency is criticized.

**Prevention:** Keep sequential generation. If latency becomes a user complaint, implement a concurrency cap of 2 with `p-limit` or manual queue, not full parallelism. Document the rate limit ceiling in comments at the carousel generation function.

**Phase/layer:** API — carousel generation service.

---

### CAROUSEL-08: Storage cleanup does not handle N-file carousel deletion

**What goes wrong:** The existing `processStorageCleanup` service (see `storage-cleanup.service.ts`) processes items from `version_cleanup_log` and deletes `image_url` + `thumbnail_url` per record. Carousel posts have N slides stored as separate files. Deleting a carousel post queues 1 cleanup record but leaves N-1 slide images as orphans in storage.

**Why it's easy to make:** The cleanup service is slide-count-unaware — it was built for single-image posts.

**Prevention:** Store carousel slide URLs in a `carousel_slides` child table (one row per slide with `post_id` FK). On carousel post deletion, the cleanup job reads all associated slide rows and includes all their storage paths in the deletion batch. Alternatively, store slide paths as a JSONB array column on the post and expand it in the cleanup query. Do not rely on the current single-URL cleanup path.

**Phase/layer:** Schema — `carousel_slides` table or JSONB slides column; API — cleanup service extension.

---

### CAROUSEL-09: `content_type` enum extension causes downtime on large `posts` table

**What goes wrong:** Adding `'carousel'` and `'enhancement'` to a PostgreSQL `content_type` enum requires `ALTER TYPE ... ADD VALUE`. In PostgreSQL 12+, this is non-transactional — it cannot be wrapped in a transaction with other DDL. On a large `posts` table, this blocks reads during the schema lock acquisition window, causing visible downtime.

**Why it's easy to make:** Supabase migrations look simple, and enum additions seem trivial compared to column additions.

**Prevention:** Use `ALTER TYPE content_type ADD VALUE IF NOT EXISTS 'carousel'` in its own migration, deployed before any code that uses the new value. For the transition window, add a feature flag so old code paths never attempt to insert `'carousel'` rows until migration is confirmed complete. Alternatively, store `content_type` as a plain `text` column with a CHECK constraint instead of a PostgreSQL enum — text is more migration-friendly. If the enum was originally created as text+CHECK, no migration issue exists.

**Phase/layer:** Schema — migration design; API — deployment sequencing.

---

## IMAGE ENHANCEMENT PITFALLS

---

### ENHANCE-01: Gemini "improves" the subject into a different product

**What goes wrong:** The user uploads a photo of their specific hamburger. The enhancement prompt says "place on a rustic wooden table with soft studio lighting." Gemini's image model may regenerate the burger at a different angle, with different toppings, or as a "stylized" version that no longer looks like the actual product. The user's real burger has been replaced with a model's idea of a burger.

**Why it's easy to make:** Image enhancement with Gemini flash image model is image-to-image with a text prompt. Without explicit subject-preservation constraints in the prompt, the model treats the input as creative reference, not as a required output subject.

**Prevention:** The enhancement prompt must include explicit subject-preservation language: "Preserve the exact subject from the input image without modification. Do not change the shape, color, texture, or identity of the product. Only modify the background environment and lighting. The subject must be pixel-for-pixel faithful to the input." Test this against diverse product categories (food, objects, apparel) during development — food is particularly prone to creative drift. Consider including the subject image as both the primary reference and repeating it in the prompt context: "The foreground subject is shown in the attached image. It must not change."

**Phase/layer:** API — enhancement prompt engineering; QA — per-category verification.

---

### ENHANCE-02: User upload too large — memory spike and timeout

**What goes wrong:** A user uploads a 20MB raw DSLR photo. The server loads it into memory, passes it to Gemini as base64 (which increases size by ~33%), and then tries to process the result. Memory usage spikes; on Vercel serverless, the function hits the 1GB memory limit and crashes silently, leaving an orphaned SSE connection.

**Why it's easy to make:** There is no upload size validation in the existing `reference_images` flow in `generateRequestSchema` (the schema accepts `{ mimeType: string; data: string }[]` with no size check on `data`).

**Prevention:** (1) Enforce a client-side pre-upload size check (reject if > 5MB before base64 encoding). (2) Add server-side validation in the enhancement route: decode the base64 `data` string, compute byte length, reject with 413 if > 5MB. (3) Pass the upload through `sharp` to resize to max 2048px on the longest edge before sending to Gemini. Do not pass raw DSLR resolution to the model — it does not improve output quality and substantially increases cost (more input tokens).

**Phase/layer:** Schema — enhancement request Zod schema with size validation; API — server-side size guard + sharp resize; Frontend — client-side file picker with size gate.

---

### ENHANCE-03: Scenery prompt contaminates the subject

**What goes wrong:** Admin sets up a scenery preset called "Rustic Wooden Table." The description generates a prompt fragment: "place on a weathered wooden surface with visible wood grain." Gemini applies wood-grain texture to the subject as well as the background — a smooth white ceramic mug acquires a wood-grain pattern, or a shiny metal product gets a matte wooden finish blending into the table.

**Why it's easy to make:** Scenery presets are designed for backgrounds. The prompt builder concatenates scenery description + subject description linearly. The model has no understanding of which part of the scene is "background" vs "foreground subject."

**Prevention:** Scenery preset prompts must be structured with explicit spatial separation: "Background environment: [scenery description]. Foreground subject: the product from the input image, fully intact with its original surface material, texture, and reflectivity." This dual-zone framing constrains the model to apply scenery attributes only to the background region. Test each scenery preset against at least three product surface types (smooth, reflective, matte) during admin QA.

**Phase/layer:** Admin — scenery catalog prompt structure guidelines; API — enhancement prompt template.

---

### ENHANCE-04: NSFW or harmful user uploads sent directly to Gemini

**What goes wrong:** A user uploads an explicit image or an image containing prohibited content. The server passes it directly to Gemini, which rejects it with a safety error. The error is logged, may include the image data in the error object, and the rejection message is returned to the user. Worse, if Gemini's safety filters ever miss something, the generated "enhancement" propagates the content.

**Why it's easy to make:** The existing `reference_images` flow in `generate.routes.ts` does no content moderation — it passes user-supplied image data straight to Gemini as reference images. Enhancement is different: the user's image is the primary subject, not a style reference, making this the first route where user-controlled content drives the entire output.

**Prevention:** (1) Validate MIME type server-side — accept only `image/jpeg`, `image/png`, `image/webp`. (2) Use Gemini's text model to pre-screen the uploaded image before the enhancement call: send it with a binary "is this safe for a commercial product photo context?" prompt. If the response is not clearly affirmative, reject with 400 and a generic "Image not suitable for enhancement" message. (3) Never log the raw base64 image data in error paths. (4) Document the content moderation step in the route with a comment explaining why it exists.

**Phase/layer:** API — enhancement route pre-screen step.

---

### ENHANCE-05: User uploads a non-product image — face, logo, screenshot

**What goes wrong:** Enhancement is designed for product shots. A user uploads a selfie and requests "wooden table" scenery. The model tries to render a face on a wooden table, which may produce uncanny results, trigger safety filters, or succeed and confuse the user. A screenshot upload produces a flat digital artifact surrounded by wooden planks.

**Why it's easy to make:** There is no input validation beyond MIME type. The enhancement UX may not communicate clearly that "product photo" is the expected input.

**Prevention:** (1) Add an explicit UI hint: "Upload a clear photo of your product against a plain background." (2) Use the same Gemini pre-screen call from ENHANCE-04 to also classify: "Is this image a product photo suitable for commercial use? Answer YES or NO." If NO, reject with a user-facing explanation: "Please upload a product photo. Portraits and screenshots are not supported." (3) This does not need to be perfect — it is a UX improvement, not a security gate. If the pre-screen is wrong in edge cases, the enhancement will simply produce poor results, which is acceptable.

**Phase/layer:** Frontend — upload UX copy and hints; API — pre-screen classification.

---

### ENHANCE-06: EXIF data and original image metadata stored in Supabase Storage

**What goes wrong:** A user uploads a raw phone photo. EXIF data includes GPS coordinates of where the photo was taken, device model, timestamp, and potentially copyright information. The enhancement source file is stored in Supabase Storage. If the storage bucket is public or if the stored URL is accessed, the metadata is exposed.

**Why it's easy to make:** `sharp` is already used for image optimization (`image-optimization.service.ts`), and EXIF stripping is an available option. But if the enhancement source file is stored before passing through `sharp`, or if `sharp` is not explicitly configured to strip EXIF, the metadata persists.

**Prevention:** Run the uploaded image through `sharp().rotate().toBuffer()` before storing it anywhere. `sharp` strips EXIF by default during format conversion but not during passthrough — calling `.rotate()` with no argument normalizes orientation and strips EXIF consistently. Apply this to the source file before storage and before passing to Gemini. The result file from Gemini will not contain the user's EXIF (Gemini generates a new image) but the source file must be sanitized.

**Phase/layer:** API — enhancement upload processing pipeline.

---

## SHARED PITFALLS (both features)

---

### SHARED-01: Charging credits before confirming Gemini call will succeed

**What goes wrong:** `checkCredits` runs before the SSE stream opens. For carousel, N credits are reserved (or estimated) before any slide is generated. If generation fails at slide 1, credits were never actually consumed but the billing check has already passed. If `deductCredits` runs per slide as each succeeds, and the route crashes before all deductions complete, some slides were delivered but not charged; some were charged but not stored.

**Why it's easy to make:** The existing flow is `checkCredits → generate → recordUsageEvent → deductCredits` (all or nothing for a single image). Extending this to N slides requires deciding: do you check/deduct N times upfront, or once per slide?

**Prevention:** Check credits once upfront using the maximum possible cost (N × single-image estimate). Generate slides. Record usage events per successfully generated slide. Deduct the actual total at the end based on successful slides only. If the job fails partially, deduct only for successful slides. This requires storing per-slide usage data during generation and deferring `deductCredits` until the final tally is known. For `ownApiKey` users (admin/affiliate), skip all credit operations — this is already handled by the `!ownApiKey` guard in the existing route.

**Phase/layer:** API — carousel billing logic; Billing — per-slide usage recording.

---

### SHARED-02: New `carousel_slides` table created without RLS policies

**What goes wrong:** A new `carousel_slides` table is added in the Supabase schema migration. No RLS policies are written. The table defaults to no access, meaning the user-scoped Supabase client cannot read slide data (silent failure returning empty array), and the admin client always works (masking the missing policy during development).

**Why it's easy to make:** RLS policies are written separately from table creation in Supabase. During rapid schema development, the table is created and tested with the admin client — everything works. The bug only manifests in production when the user-scoped client tries to load slides.

**Prevention:** Add RLS to the `supabase-setup.sql` script in the same commit that creates the table. Required minimum: `SELECT` policy for `auth.uid() = user_id`, `INSERT`/`UPDATE`/`DELETE` restricted to service role or admin. Add a comment in the migration: "RLS required — do not deploy this migration without its accompanying RLS policy block." Verify with a user-scoped client smoke test before merging.

**Phase/layer:** Schema — migration + RLS policy co-deployment.

---

### SHARED-03: `content_type` not guarded in gallery and billing statement UI

**What goes wrong:** The existing gallery iterates over `posts` and renders cards. The card component branches on `content_type === "video"` to render a video player vs image. A post with `content_type === "carousel"` or `"enhancement"` falls into the else branch and is rendered as a single image. The first carousel slide is displayed; the other slides are silently ignored. The billing statement similarly shows "image" for all non-video content types.

**Why it's easy to make:** `content_type` is a string union. TypeScript only enforces exhaustiveness if the code uses a switch with a `never` check. Most gallery/card code uses if-else chains without exhaustiveness guards.

**Prevention:** Use a TypeScript exhaustiveness guard at the card rendering switch: `default: const _exhaustive: never = contentType` — this will produce a compile error when a new `content_type` value is not handled. Add this guard before the v1.1 feature code is merged. Update the gallery card component to handle `"carousel"` (show slide strip or first slide with slide count badge) and `"enhancement"` (show before/after toggle) explicitly.

**Phase/layer:** Frontend — gallery card component; TypeScript — exhaustiveness checks.

---

### SHARED-04: Scenery catalog updates not reflected until server restart

**What goes wrong:** Admin adds a new scenery preset via the admin panel. The scenery catalog is cached server-side (same pattern as `styleCatalog` via `getStyleCatalogPayload`). The enhancement route reads from cache. New presets are invisible to users until the cache TTL expires or the server restarts.

**Why it's easy to make:** The `style_catalog` caching pattern works for the existing catalog because the catalog changes infrequently and a 60s TTL is acceptable. Admins testing a new scenery preset expect to see it immediately in the creator UI.

**Prevention:** (1) Document the cache TTL in the admin scenery UI: "New presets appear within 60 seconds." (2) Add an admin "Flush catalog cache" button that calls a `/api/admin/flush-catalog-cache` endpoint. (3) Keep the TTL at 60s — this is acceptable for v1.1. Do not reduce to 0 (that would cause a DB hit on every enhancement request).

**Phase/layer:** Admin — scenery catalog UI; API — cache flush endpoint.

---

### SHARED-05: SSE reconnection re-runs the generation job

**What goes wrong:** For long carousel jobs (100-200s), the browser's `EventSource` may disconnect and automatically reconnect. The `EventSource` API reconnects to the same URL with the same headers. The server treats the reconnection as a new request and starts a new generation job. The user now has two concurrent jobs running, two sets of credits being consumed, and two posts being created.

**Why it's easy to make:** `EventSource` reconnection is transparent to the frontend — the `onmessage` handler just starts receiving events again. There is no built-in deduplication.

**Prevention:** (1) Use `fetch` with a `ReadableStream` instead of `EventSource` for the carousel route. `fetch`-based SSE does not auto-reconnect. (2) If `EventSource` must be used, include the idempotency key from CAROUSEL-04 so the server can detect and reject duplicate concurrent jobs. (3) Track active job state client-side: if a `complete` or `error` event was received, do not reconnect; if the connection drops mid-stream, show an error UI rather than silently reconnecting.

**Phase/layer:** Frontend — SSE client implementation for long-running jobs.

---

### SHARED-06: Admin config added to scenery catalog but missing from Zod schema

**What goes wrong:** Admin adds a `scenery_catalog` array to `platform_settings` JSONB. The enhancement route reads from this setting. A Zod schema for `StyleCatalog` in `shared/schema.ts` does not include `scenery_catalog`. TypeScript compiles fine (JSONB is `unknown`). The enhancement route accesses `catalog.scenery_catalog` as `any`. When a field is renamed in admin config (e.g., `background_description` to `scene_prompt`), the code silently reads `undefined`, falls through to a default, and generates an enhancement with a blank scenery — no error, no warning.

**Why it's easy to make:** `platform_settings` stores arbitrary JSONB. The settings cache returns `unknown`. It is natural to access subfields without a Zod schema.

**Prevention:** Define a `SceneryCatalogItem` Zod schema in `shared/schema.ts` and `safeParse` the scenery catalog from the settings JSONB on read. If parsing fails, throw a logged error and return a 503 to the user rather than silently degrading. This catches admin config drift at runtime rather than in production support tickets.

**Phase/layer:** Schema — `SceneryCatalogItem` Zod type; API — `safeParse` on scenery read.

---

### SHARED-07: Frontend wizard state explosion across three content types

**What goes wrong:** The creator page currently manages state for `content_type: "image" | "video"`. Adding `"carousel"` (with slide count, narrative structure) and `"enhancement"` (with user photo upload, scenery selection) into the same component creates a combinatorial state machine. Conditional rendering branches multiply. A bug introduced for carousel hides behind video-only state and is missed in review.

**Why it's easy to make:** The simplest extension is to add more if-else branches to the existing creator form. There is no architectural pressure to split until the component is already unmanageable.

**Prevention:** Extract each content type into a self-contained form component: `<CarouselCreatorForm>`, `<EnhancementCreatorForm>`, and the existing `<PostCreatorForm>`. The parent creator page renders the appropriate component based on a `contentType` tab selection. Each form manages its own local state. This is a refactor boundary, not gold-plating — the existing form is already ~400 lines; adding two new modes inline will push it past 800.

**Phase/layer:** Frontend — creator page component architecture.

---

### SHARED-08: i18n strings for new features added only in English

**What goes wrong:** Carousel and enhancement introduce new UI strings: "Slide count", "Select scenery", "Enhancement in progress", "Slide 3 of 10", etc. These strings are added only in English. The Portuguese and Spanish translations are either missing (key not found, fallback to key string displayed to user) or added in English under the PT/ES keys by mistake.

**Why it's easy to make:** Translation is a final step that is easy to defer and forget, especially if the translation workflow is manual (no CI check for missing keys).

**Prevention:** At implementation time, add placeholder translations for PT and ES that are marked with `[NEEDS TRANSLATION]` prefix. Run a translation key completeness check in CI: `grep -r "NEEDS TRANSLATION" client/src/` should fail the build. Engage a translator before shipping or use machine translation with a review flag. Never ship a key present in `en` but absent in `pt` or `es` without an explicit fallback decision.

**Phase/layer:** Frontend — i18n translation files; CI — missing-key check.

---

## Moderate Pitfalls

---

### MODERATE-01: `recordUsageEvent` called once for carousel but N slides were generated

**What goes wrong:** The existing `recordUsageEvent` call records one event with one `event_type: "generate"`. For carousel, the actual cost is the sum of N image generation calls plus one text generation call. If usage is recorded as a single event with aggregated token counts, the per-slide breakdown is lost. Admin analytics show carousel as "one generation" alongside single-image posts — cost accounting is correct in aggregate but wrong for per-slide analytics.

**Why it's easy to make:** `recordUsageEvent` is a single function call at the end of the generate route. Wrapping carousel in the same call is the path of least resistance.

**Prevention:** For carousel, call `recordUsageEvent` once per slide with `event_type: "carousel_slide"` and record the aggregate in a single `event_type: "carousel"` event that references the post ID. This supports per-slide cost attribution in admin analytics and enables future per-slide refund logic.

**Phase/layer:** Billing — usage event recording; Schema — new `event_type` values.

---

### MODERATE-02: Enhancement source file stored permanently alongside result

**What goes wrong:** The user's original (pre-enhancement) photo is uploaded to `user_assets/{userId}/enhancement-source/{uuid}.webp` for processing. After the enhanced result is stored, the source file remains. Two files accumulate per enhancement. Storage costs double for enhancements. Storage cleanup does not know about source files.

**Why it's easy to make:** Storing the source for debugging or "before/after" display seems useful. But this commits to permanent storage of user-uploaded content, which has privacy, cost, and compliance implications.

**Prevention:** Do not store the source file in Supabase Storage. Load it into memory, process it (resize + EXIF strip per ENHANCE-06), send to Gemini, receive result, upload only the result. If a "before/after" toggle is desired in the gallery, store the source as a thumbnail-size preview only (max 400px wide) under `user_assets/{userId}/thumbnails/{uuid}-source.webp`. Add this thumbnail path to cleanup alongside the result.

**Phase/layer:** API — enhancement upload pipeline; Schema — clarify what gets stored.

---

### MODERATE-03: Gemini image-to-image returns different aspect ratio than requested

**What goes wrong:** The enhancement prompt specifies `1:1` aspect ratio for an Instagram post. Gemini's image generation model returns a `4:3` image. The gallery renders it stretched or with letterboxing. The Instagram export looks wrong.

**Why it's easy to make:** The existing `generateImageAsset` service passes `aspectRatio` to Gemini's API. For image-to-image (where a reference image is provided), Gemini may prioritize the input image's aspect ratio over the requested output ratio, especially if the input is landscape and the requested output is square.

**Prevention:** Post-process the Gemini output through `sharp`: crop/pad to the requested aspect ratio before upload. Use `sharp().resize({ width, height, fit: 'cover' })` for crop or `fit: 'contain'` with background fill for pad. Do not trust the model output dimensions to match the request.

**Phase/layer:** API — image processing pipeline after Gemini response.

---

### MODERATE-04: Carousel slide count used as billing multiplier without cap

**What goes wrong:** A malicious or confused user submits a carousel request with `slide_count: 1000`. The server accepts it (no max validation), kicks off 1000 sequential Gemini calls, runs for 4+ hours, exhausts the user's credits multiple times, and hits Gemini's daily quota. The safety timer fires at 280s and abandons the job mid-way after billing for ~18 slides.

**Why it's easy to make:** The Zod schema for carousel request would naively be `z.number().min(3)` for slide count. Adding a max requires an explicit decision about what the cap should be.

**Prevention:** The schema must enforce `z.number().int().min(3).max(10)`. The PROJECT.md already specifies "3-10 slides" as the range. This is not ambiguous — add both bounds to the Zod validator. Log a warning if the request attempts to exceed the cap (possible client bug or tampering).

**Phase/layer:** Schema — carousel request Zod validation.

---

### MODERATE-05: Billing statement "content_type" filter breaks with new values

**What goes wrong:** The billing statement page has a filter or grouping: "Show: Images | Videos | All". This uses `content_type === "image"` and `content_type === "video"` as filter predicates. Carousel and enhancement posts appear in "All" but are invisible in both "Images" and "Videos". Users cannot find their carousel spend in the billing statement.

**Why it's easy to make:** String equality filters are fragile against new enum values. The frontend billing filter was written when only two content types existed.

**Prevention:** Extend the billing filter to `"image" | "video" | "carousel" | "enhancement" | "all"`. Update the filter UI to show all four content types. Add a `content_type` label helper function: `getContentTypeLabel(type: string): string` that returns "Image", "Video", "Carousel", or "Enhancement" — and use it everywhere labels appear (gallery, billing, usage history). The TypeScript exhaustiveness check from SHARED-03 will catch missing cases.

**Phase/layer:** Frontend — billing statement filter; UI — content type label utility.

---

## Minor Pitfalls

---

### MINOR-01: Logo overlay applied to enhancement output

**What goes wrong:** The enhancement route is implemented by extending the existing `generate.routes.ts` image path. The existing path includes logo overlay logic (`applyLogoOverlay` at line 526-552). If `use_logo: true` is passed in the enhancement request, a logo is composited on top of the professionally enhanced product photo. The PROJECT.md explicitly lists "Text overlays or logo composition on enhancements" as out of scope.

**Prevention:** Hardcode `use_logo: false` in the enhancement route regardless of what the client sends. Do not pass `logo_position` to the processing pipeline. Add a comment: "Logo overlay intentionally disabled for enhancement content type — see PROJECT.md out-of-scope."

**Phase/layer:** API — enhancement route.

---

### MINOR-02: `staleTime: Infinity` causes gallery to show outdated carousel after partial retry

**What goes wrong:** A carousel generation fails partially. The user retries and a new carousel is created. The gallery TanStack Query cache has `staleTime: Infinity` (global default) so it does not refetch. The new carousel post does not appear in the gallery until the user manually refreshes.

**Why it's easy to make:** The existing generate route calls `queryClient.invalidateQueries({ queryKey: ['posts'] })` on success via the SSE complete handler. But for a carousel where some slides failed and the result was a `partial` status, the invalidation may not fire.

**Prevention:** Always fire `queryClient.invalidateQueries({ queryKey: ['posts'] })` from the SSE `complete` event regardless of partial status. Also fire it from the SSE `error` handler — even after an error, the user may have had a previous successful carousel that changed status, and the gallery should be current.

**Phase/layer:** Frontend — SSE event handlers.

---

### MINOR-03: `generation_logs` error type enum does not cover new failure modes

**What goes wrong:** `logGenerationError` accepts `errorType` values including `"image_generation"`, `"text_generation"`, `"upload"`, etc. Carousel introduces new failure categories: `"carousel_slide_generation"` (a specific slide failed), `"enhancement_prescreen"` (NSFW check failed), `"enhancement_resize"`. These are logged as `"unknown"` if the type union is not extended.

**Prevention:** Extend the `errorType` union before implementing the new routes. Add `"carousel_slide_generation"`, `"enhancement_prescreen"`, `"enhancement_upload"` as valid values. Use them in the new route error paths.

**Phase/layer:** API — `logGenerationError` type definition.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Schema migration (content_type enum) | Enum alteration blocks reads | Use `ADD VALUE IF NOT EXISTS` in isolated migration before code deploy |
| Carousel slide storage design | N-file orphan leak on post delete | Decide carousel_slides table vs JSONB array before writing cleanup code |
| Enhancement Zod schema | No size limit on uploaded image data | Add `z.string().max(7_000_000)` (5MB base64 ≈ 6.7M chars) on the image data field |
| Carousel prompt generation | N independent text calls produce incoherent narrative | Single master text call returning slides array — lock this before API coding begins |
| Credit deduction for carousel | When to deduct: upfront vs per-slide vs end | Decide billing contract before route is written — retrofitting changes credit ledger schema |
| Carousel SSE timeout | 10 slides × 15s exceeds 280s safety timer | Disable text enforcement for slides; cap at 8 slides; raise carousel safety timer to 500s |
| Enhancement pre-screen | Adds one extra Gemini call per enhancement | Cache pre-screen decisions? No — per-upload check is intentional; budget this in cost model |
| RLS on carousel_slides table | Table created without policies | Policy co-deployment rule: no table ships without RLS block in same migration |
| Frontend content type routing | New types fall into image/video else branch | Exhaustiveness check in TypeScript before feature merge |
| i18n new strings | PT/ES keys added in English | `[NEEDS TRANSLATION]` placeholder pattern with CI grep check |

---

## Sources

- Direct codebase inspection: `server/routes/generate.routes.ts` — error paths, safety timer, credit flow, SSE lifecycle
- Direct codebase inspection: `server/quota.ts` — `checkCredits`, `recordUsageEvent`, `deductCredits` contract
- Direct codebase inspection: `server/lib/sse.ts` — `isClosed`, `sendError`, heartbeat, reconnect behavior
- Direct codebase inspection: `server/services/storage-cleanup.service.ts` — single-URL cleanup model
- Direct codebase inspection: `server/services/image-generation.service.ts` — image-to-image reference image handling
- Direct codebase inspection: `shared/schema.ts` — `content_type` type, `generateRequestSchema`, existing Zod patterns
- Direct codebase inspection: `.planning/PROJECT.md` — v1.1 scope, constraints, out-of-scope list
- Direct codebase inspection: `.planning/codebase/CONCERNS.md` — prior performance and error-handling concerns
- Prior research: `.planning/debug/full-system-bug-audit.md` — recurring issue themes
- Confidence: HIGH for all pitfalls derived from codebase inspection; MEDIUM for Gemini model behavior pitfalls (model behavior verified against known image-to-image documentation patterns but model updates may change behavior)
