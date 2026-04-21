# Feature Landscape: v1.1 Carousel Generator + Image Enhancement

**Domain:** AI social media content creation SaaS — two new media creation surfaces
**Researched:** 2026-04-21
**Overall confidence:** MEDIUM-HIGH (IG specs HIGH from official sources; tool behavior MEDIUM from verified third-party reviews; Gemini consistency behavior MEDIUM from official docs)

---

## Feature Area 1: Carousel Generator

### Table Stakes — Carousel

Features users expect from any AI carousel generator. Missing = product feels broken or incomplete relative to Predis.ai, PostNitro, aiCarousels, Contentdrips.

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| User-controlled slide count (3–10) | Standard in every tool surveyed. Users understand carousel length as an intent signal. Tools that auto-pick count frustrate users who already know their format. Hard cap at 10 keeps IG-safe (v1.1 scope); 20-slide update exists but 3–10 is optimal engagement range | Trivial | `generate` request body: add `slide_count: number` param |
| Hook → Develop → CTA narrative structure | Dominant pattern across Predis.ai, PostNitro, Venngage. AI text model generates slide titles/copy in structured arc. Without it carousels feel like random image dumps | Moderate | Gemini text prompt engineering; `slides[]` response schema |
| Shared visual style across all slides | Users expect every slide to look like it belongs to the same deck. Achieved via: (a) a master style description injected into every slide's image prompt, (b) brand colors + mood from existing `brands` table, (c) shared `post_mood` from existing `style_catalog` | Moderate | Brand context reuse; per-slide image prompt includes shared style descriptor string |
| One unified Instagram caption | 100% of surveyed tools produce a single caption for the carousel post, not per-slide captions. Per-slide captions are a LinkedIn/PDF carousel pattern, not IG | Trivial | Gemini text output; existing `posts.caption` column |
| IG-safe aspect ratios: 1:1 and 4:5 only | Instagram forces ALL slides to match the first slide's ratio. 4:5 (1080x1350px) is the recommended format — max vertical screen coverage. 1:1 (1080x1080px) for grid-friendly square look. No other ratios needed for IG carousels in v1.1 | Trivial | Reuse existing `post_formats` catalog entries; restrict carousel creator to these two |
| Billing: N credits (N = slide count) | Users of credit-based tools accept per-slide charging. Must flow through `checkCredits` → `recordUsageEvent` → `deductCredits` at N × image cost | Moderate | Existing billing middleware; carousel generates N images |
| Gallery display: first slide as cover thumbnail | Gallery shows a single thumbnail (first slide). Clicking opens slide viewer/navigator. Standard pattern — users don't expect 10 thumbnails in the grid | Moderate | `posts.thumbnail_url` stores slide 1 thumbnail; new `carousel_slides` table or `posts.slides` JSONB for the rest |
| Per-slide image stored in Supabase Storage | Each of N slides is an uploaded PNG under `user_assets/{userId}/carousel/{postId}/slide_{n}.png` | Moderate | Existing `createAdminSupabase()` upload pattern |

### Differentiators — Carousel

Features that elevate the product above the baseline. Not universally expected but clearly valued by power users.

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Slide navigator in viewer (prev/next arrows or strip) | After generation, users need to review all slides before downloading or publishing. A horizontal strip of slide thumbnails with click-to-focus is the clearest UX. Predis.ai does this inside their editor; PostNitro does it in preview | Moderate | `PostViewerDialog` extension; carousel-aware viewer state |
| Individual slide regeneration | User can tap a single slide and say "regenerate this one only." Common complaint in reviews: "I love 7 of 10 slides but slide 3 is wrong." Keeps the rest intact. Billing: 1 credit per regenerated slide | Complex | New `POST /api/carousel/:postId/slides/:n/regenerate` endpoint; style consistency carried via shared prompt |
| Reference image as visual anchor for all slides | User uploads one product/brand image; that image is sent as a reference to every slide's image generation call via Gemini's image-in prompt. Maintains subject identity across slides better than text-only prompt | Moderate | Reuse existing `referenceImages` upload UX; pass reference base64 to each slide generation call |
| Download all slides as ZIP | One-click ZIP download. Many tools make users download slides one by one, which is a pain point. ZIP is genuinely appreciated | Moderate | Server-side ZIP assembly (JSZip or native Node streams); no new storage needed |
| Credit preview before generation ("This will use 7 credits for 7 slides") | Transparent cost shown on the final wizard step before hitting Generate. Reduces surprise and refund requests | Trivial | Read `slide_count` state; multiply by per-image credit cost; display inline |

### Anti-Features — Carousel

Do not build these. Each has a clear reason.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Per-slide captions | IG carousel posts have ONE caption. Per-slide captions are a LinkedIn/document carousel pattern. Building them adds schema complexity for zero IG user value | Single `caption` on the `posts` record, same as today |
| Drag-to-reorder slides in the UI | Complex DnD implementation (react-beautiful-dnd or @dnd-kit), zero strategic value for v1.1. Users generating fresh carousels rarely need reorder — they regenerate instead | Post-generation slide delete is sufficient; reorder is v2 |
| Panoramic / spanning background across slides | Cool effect (one image cropped across all slides), but IG crop behavior and mixed-device previews make this fragile. Predis.ai does it poorly — backgrounds don't align at swipe boundaries | Shared style description + brand colors create visual coherence without spanning |
| Video slides in carousel | Out of scope per PROJECT.md. Adds codec, duration, and storage complexity disproportionate to v1.1 value | Image-only carousel for v1.1 |
| AI auto-picks slide count | Adds unpredictability. Users who select "carousel" have a mental count already. Tools that surprise users with 4 slides when they expected 8 generate support tickets | User picks N from stepper (3–10); AI fills the narrative into that count |
| Batch carousel generation (generate 5 carousels at once) | Multiplies latency, credit consumption, and failure surface. Single carousel per session is the norm | Single generation per session; power users create sequentially |

---

## Feature Area 2: Image Enhancement

### Table Stakes — Enhancement

Features users expect from any AI product photo enhancement tool. Benchmark: Photoroom, Claid.ai, Flair.ai, Mokker.

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Admin-curated scenery preset catalog | Users do not write prompts for product shots — they pick a scene. Scenery selection is the primary UX of every reviewed tool. Admin manages the list via existing admin surface (mirrors `style_catalog` pattern) | Moderate | New `scenery_catalog` structure in `style_catalog` or separate table; admin CRUD reuses existing admin UI patterns |
| Single-image input (user uploads raw photo) | Core workflow: upload raw photo → pick scenery → get enhanced result. All reviewed tools are single-image-in, single-image-out for their primary flow | Moderate | File upload reuses existing `referenceImages` UX; max 5MB, PNG/JPG/WebP |
| Background removal + scenery compositing | The AI must isolate the product from its original background and place it into the selected scene. This is table stakes for every tool reviewed | Complex | Gemini image model with scenery prompt + reference image input; prompt engineering for clean separation |
| Product identity preservation | The product must look identical (same shape, label, color, proportions) after enhancement. Any distortion is a critical failure. Users will not accept a pizza that looks like a different pizza | Complex | Gemini prompt must include explicit preservation instructions; test carefully with reflective/transparent subjects |
| Result display with before/after toggle | 100% of reviewed tools offer before/after comparison. Without it users cannot evaluate quality. Side-by-side or swipe-reveal both work | Moderate | New viewer state; store original upload URL or base64 alongside enhanced result |
| Single credit billing | Enhancement = one image in, one image out. Charge 1× image credit. Must flow through `checkCredits` → `recordUsageEvent` → `deductCredits` | Trivial | Existing billing middleware; same cost as single post image generation |
| Result stored in Supabase Storage | Enhanced image uploaded under `user_assets/{userId}/enhanced/{uuid}.png` following existing storage layout | Trivial | `createAdminSupabase()` upload; new `content_type: "enhancement"` discriminator on `posts` table |
| Gallery shows enhancements alongside posts | Enhancements appear in the existing gallery grid distinguished by a type badge. Users expect a unified history | Moderate | `content_type` enum expansion: add `"enhancement"` and `"carousel"`; gallery reads and renders both |

### Concrete Scenery Preset List

The following 12 sceneries cover the core use cases for food, beverage, cosmetics, and general product photography. This is the admin's starting catalog — not exhaustive but sufficient for launch.

| ID | Label | Description for Admin | Visual Character |
|----|-------|----------------------|-----------------|
| `white-studio` | Clean White Studio | Pure white background, soft diffused studio light, subtle drop shadow | Minimal, product-first, marketplace-ready |
| `marble-light` | White Marble Surface | Polished white marble tabletop, soft natural side light, faint surface reflection | Luxury, beauty, cosmetics, fine food |
| `marble-dark` | Dark Marble Surface | Deep charcoal/black marble, dramatic low-key lighting, moody reflections | Premium spirits, dark chocolate, luxury goods |
| `wooden-table` | Rustic Wooden Table | Warm oak/walnut table surface, soft daylight from window, slight grain texture | Artisan food, coffee, natural products |
| `concrete-urban` | Urban Concrete | Raw concrete surface, editorial cool tones, industrial aesthetic | Streetwear, supplements, modern brands |
| `outdoor-natural` | Outdoor Natural Light | Open outdoor setting, grass or stone surface, dappled sunlight | Health food, beverages, organic products |
| `kitchen-counter` | Kitchen Counter | Clean modern kitchen countertop, ambient kitchen light, out-of-focus background elements | Food delivery, meal prep, home cooking |
| `dark-premium` | Dark Premium Surface | Near-black matte surface, dramatic key lighting, luxury feel | Perfume, premium spirits, electronics |
| `softbox-studio` | Softbox Studio | Professional studio setup with visible softbox lighting effect, product fully lit | Commercial photography, product catalogs |
| `pastel-flat` | Pastel Flat Lay | Pastel-colored flat background, overhead angle, minimal decorative props | Instagram aesthetics, lifestyle brands |
| `seasonal-festive` | Festive Holiday | Warm holiday bokeh, soft pine/ribbon accents, golden-hour tones | Christmas promotions, gift products |
| `cafe-ambience` | Cafe Ambience | Warm cafe interior blur, wooden cafe table surface, golden warm light | Coffee, pastries, food & drink brands |

### Differentiators — Enhancement

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Scenery prompt augmentation (user adds a short description) | User picks "White Marble" but adds "add a few rose petals." The base scenery preset is the anchor, free text is an optional modifier. Keeps the flow fast while allowing creative control | Trivial | Append user text to scenery prompt before sending to Gemini; textarea below scenery picker |
| Download original + enhanced pair | Download button offers two variants: the original uploaded photo and the AI-enhanced result. Useful for A/B testing in ads | Trivial | Store original in Supabase as `original_image_url` on the post record; surface in viewer |
| Admin-editable scenery prompt | Each scenery in the catalog has an editable Gemini prompt field that the admin can tune without a code deploy. Reuses the existing `style_catalog` admin CRUD pattern exactly | Moderate | Add `scenery_prompt` field to scenery catalog schema; admin form renders it as textarea |

### Anti-Features — Enhancement

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Batch mode (process 5 photos at once) | Flair.ai and Claid offer this as an enterprise tier feature. For v1.1 the billing model, UI, and error surface are all simpler with single-image flow. Bulk users are not the v1.1 target | Single image per session; power users upload sequentially |
| User-uploaded custom sceneries | Out of scope per PROJECT.md. Admin curation keeps quality consistent and prevents abuse (users uploading inappropriate backgrounds). v2 consideration | Admin-curated catalog with 12 presets at launch |
| Text overlay or logo composition on enhanced images | Out of scope per PROJECT.md. Enhancement is a clean product shot, not a branded post. Mixing would confuse two distinct creation workflows | Separate workflow: user takes enhanced image, then creates a regular post with it as a reference |
| AI upscaling / resolution enhancement | Out of scope for v1.1. Upscaling (Claid-style) is a separate product primitive. Conflating it with scenery enhancement overcomplicates the UX | Gemini outputs at a consistent target resolution; no upscale step |
| Auto-detect subject / smart crop | Flair.ai does full scene-setting with drag-and-drop camera control. Too complex for v1.1. Gemini handles subject isolation via prompt, not programmatic segmentation | Trust Gemini image model's subject isolation; prompt explicitly to preserve the product |

---

## Feature Dependencies

```
Enhancement viewer (before/after)
  → requires: original_image_url stored at upload time

Carousel slide navigator
  → requires: per-slide storage + carousel_slides association schema

Individual slide regeneration
  → requires: slide navigator (user must identify which slide to regenerate)
  → requires: shared style descriptor persisted per-carousel (re-inject on regeneration)

Billing (carousel)
  → requires: slide_count on generate request
  → requires: checkCredits called with N × cost BEFORE generation begins

Billing (enhancement)
  → requires: content_type = "enhancement" on posts record
  → requires: checkCredits called same as single-image post

Gallery (both types)
  → requires: content_type enum expansion ("carousel", "enhancement")
  → requires: gallery query returns all three types with correct renderer

Admin scenery catalog
  → requires: scenery_catalog data structure (parallel to style_catalog)
  → requires: admin CRUD form (mirrors existing style_catalog admin pattern)
```

---

## IG Carousel Constraints (Authoritative)

| Constraint | Value | Source confidence |
|------------|-------|------------------|
| Max slides per post | 20 (updated 2024); v1.1 caps at 10 for focused UX | HIGH |
| Aspect ratio rule | ALL slides must match the first slide's ratio; Instagram auto-crops without warning | HIGH |
| Recommended IG aspect ratio | 4:5 (1080x1350px) — max vertical coverage; 1:1 (1080x1080px) alternative | HIGH |
| Image file size per slide | Up to 30MB per image; target under 15MB for reliable uploads | HIGH |
| Min slides | 2 (Instagram requirement); v1.1 minimum is 3 for narrative coherence | HIGH |
| Caption | One per carousel post (not per slide) | HIGH |

---

## MVP Recommendation

### Carousel — Launch with:
1. Slide count picker (3–10), aspect ratio picker (1:1 / 4:5), unified caption
2. Shared brand + mood injected into every slide's prompt for visual consistency
3. Gallery cover = slide 1 thumbnail; click opens slide strip navigator
4. Billing at N × single-image credit cost
5. Download all slides individually (ZIP deferred to v2)

### Carousel — Defer:
- Individual slide regeneration (v2): complex endpoint, low launch priority
- ZIP download: useful but not blocking adoption
- Panoramic backgrounds: anti-feature; do not build

### Enhancement — Launch with:
1. 12-scenery preset catalog (admin-curated, admin-editable prompt)
2. Single-image upload → scenery selection → generate → before/after viewer
3. Result stored in Storage; gallery shows with "Enhancement" type badge
4. Billing: 1× credit per enhancement
5. Optional free-text scenery modifier (trivial to add)

### Enhancement — Defer:
- Batch mode: post-v1.1
- User custom sceneries: explicit out-of-scope decision

---

## Sources

- Predis.ai carousel behavior: https://predis.ai/instagram-carousel-maker/ (MEDIUM confidence)
- PostNitro carousel structure: https://postnitro.ai/blog/post/ai-carousel-generator (MEDIUM confidence)
- aiCarousels.com tool comparison: https://www.aicarousels.com/blog/best-ai-carousel-generator (MEDIUM confidence)
- Lovart carousel visual consistency: https://www.lovart.ai/features/ai-carousel-generator (MEDIUM confidence)
- IG carousel 20-slide update: https://www.socialmediatoday.com/news/instagram-expands-carousels-to-20-frames/723792/ (HIGH confidence)
- IG carousel dimension specs: https://www.overvisual.com/tools/instagram-carousel-size (HIGH confidence — references IG official)
- IG carousel best practice engagement data: https://postnitro.ai/blog/post/viral-instagram-carousels-strategies-2025 (MEDIUM confidence)
- Photoroom product photo scenery: https://www.photoroom.com/blog/product-photography-backgrounds (HIGH confidence — official blog)
- Claid.ai vs Photoroom comparison: https://www.photoroom.com/blog/photoroom-vs-claid (MEDIUM confidence)
- AI product photography tools survey: https://claid.ai/blog/article/ai-product-photo-tools (MEDIUM confidence)
- Flair.ai behavior: https://www.opencart.com/blog/ai-product-photography-generator-comparison (MEDIUM confidence)
- AI product photo failure modes: https://medium.com/@TimDo007/why-your-ai-product-photos-look-terrible-and-its-not-the-tool-s-fault-0686e13aff20 (MEDIUM confidence)
- Shadow artifacts in AI compositing: https://www.cloudretouch.com/fix-generative-fill-shadow-artifacts-product-photos/ (MEDIUM confidence)
- Gemini multi-image consistency: https://towardsdatascience.com/generating-consistent-imagery-with-gemini/ (MEDIUM confidence)
- Gemini image generation official docs: https://ai.google.dev/gemini-api/docs/image-generation (HIGH confidence)
- Before/after comparison UX — batch photo enhancers: https://www.insmind.com/batch-photo-enhancer/ (MEDIUM confidence)
- Carousel slide delete UX: https://carouselmaker.co/en/help/delete-slide (MEDIUM confidence)
