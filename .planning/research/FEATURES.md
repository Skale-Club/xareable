# Feature Research

**Domain:** Professional-designer AI output quality — deterministic typography overlay, aesthetic direction, visual quality gating, and narrative carousels for an AI social-media content generator
**Researched:** 2026-07-18
**Confidence:** MEDIUM (design/typography/IG-safe-zone principles are HIGH confidence, well-corroborated; vendor-internal mechanics of AdCreative.ai/Predis/Ocoya and exact production re-roll budgets are LOW-MEDIUM confidence — proprietary, not publicly documented in technical depth)

> **Note:** this file supersedes the prior (2026-04-21, v1.1) carousel/enhancement feature research in this same path. That research covered the original carousel/enhancement build; this file covers only the NEW v1.6 features (typography overlay, aesthetic direction, visual critic, narrative carousels) per the milestone context.

## Context: what already exists (don't re-research these)

Xareable already has: a `text_styles` catalog (`shared/schema.ts`) with 8 styles, each carrying `prompt_hints.{typography, layout, emphasis, avoid}` and a **CSS preview `font_family`** (e.g. `Impact`, `'Archivo Black'`, `'Bangers'`, `'DM Serif Display'`, `'Merriweather'`, `'Oswald'`, `'Permanent Marker'` — notably, most of these already map 1:1 to free Google Fonts, which lowers the licensing/sourcing cost of the new deterministic-font pipeline). It also already has a `textBlockSchema` with `TEXT_BLOCK_ROLES = ["highlight", "support", "cta"]` — i.e., the **headline/support/CTA three-tier role model this research recommends is already the schema's shape**; the new work is compositing those roles with real fonts instead of asking the image model to render them as pixels. `post_formats` catalog already spans `1:1, 4:5, 9:16, 16:9, 2:3, 1200:628`; carousels are currently capped to `1:1`/`4:5` only. Brand already carries 3–4 hex colors, a mood word, and up to 10 user reference photos (v1.5) injected with 4-slot priority. Admin-curated catalogs (scenery, v1.1 Phase 8) establish the existing pattern for "platform-curated" content sets.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Legible headline/support/CTA text over a photo background | Every competing tool (Canva, Adobe Express, AdCreative.ai, Predis) produces this as its baseline output; a "design tool" that can't reliably place readable text over an image doesn't clear the category bar | MEDIUM | Xareable already models this as `TEXT_BLOCK_ROLES`; the gap is that today the *image model* renders the pixels (unreliable glyphs) rather than a deterministic compositor |
| Contrast treatment behind text (scrim or plate) whenever background busyness threatens legibility | Universal pattern across every text-over-image tool; users unconsciously expect it and notice its absence as "unprofessional" or "hard to read" | LOW-MEDIUM | Gradient scrim (0%→60-75% opacity black or brand-dark, feathered) for editorial/soft styles; solid semi-opaque plate for punchy/promo styles — chosen by `text_style` category, not global |
| Respect for platform safe zones (no critical text in areas the platform's own UI or grid-crop will cover/clip) | Instagram Stories/Reels overlay profile pic, captions, share buttons in fixed screen regions; feed grid view crops 4:5 to 1:1. A tool ignorant of this looks amateur and produces posts where the CTA is literally hidden | LOW-MEDIUM | Concrete margins below (see Layout Archetypes section) — must be computed per `post_formats` aspect ratio, not a single constant |
| At most 2 font families per graphic, with a clear size hierarchy between headline/support/CTA | Every professional template system (Canva brand kits, Adobe Express) enforces "one display font + one body font"; more than 2 reads as amateurish/cluttered | LOW | Maps directly onto existing `text_styles.preview.font_family` (headline) — catalog currently has no declared *pairing* font for support/CTA; this is a schema gap to close, not a new concept |
| Multi-slide carousel where slides look like one designed set, not one image repeated 8 times | Baseline expectation once carousels exist at all — Xareable already ships this (shared visual style across slides) | Already shipped | No new work — narrative structure below is the *differentiator* layered on top |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Deterministic (non-AI-rendered) typography compositing — server-side sharp/SVG with real font files | Removes the single biggest "looks AI-generated" tell (malformed/hallucinated glyphs) entirely instead of trying to detect-and-repair it after the fact; converts an unreliable generative step into a 100%-reliable rendering step | HIGH | Requires: font files bundled server-side (most already implied by existing catalog's CSS names → swap to actual Google Fonts TTF/WOFF), per-archetype layout templates × per-aspect-ratio safe zones, multi-language text wrapping (PT/ES per CLAUDE.md — variable string length breaks fixed layouts), logo-vs-text collision avoidance using existing `LOGO_POSITION_DESCRIPTIONS` |
| Dense, named aesthetic direction: photography type, lighting, 60-30-10 palette **with named hex roles**, global anti-AI-look negative prompts | One-line mood/style prompts ("bold", "playful") are exactly why today's output reads generic; competing tools that only expose a style *name* to the user still write dense internal art-direction strings — Xareable's catalog needs the same density | MEDIUM | Additive schema work on `brandStyleSchema`/`textStyleSchema` (new fields, not new infra); the cost is curation quality across ~9 existing styles, not engineering risk |
| Platform-curated style reference boards | Gives users AdCreative.ai/Canva-template-library parity — curated "here's what good looks like" reference imagery, boosting output quality without requiring the user to have 10 of their own brand photos | MEDIUM | Reuses the *exact* admin-curated-catalog pattern already built for the scenery catalog (Phase 8) and the reference-photo injection pattern already built for brand references (v1.5) — low infra risk, real content-sourcing/rights-clearance cost |
| Multimodal visual critic with automatic re-roll (composition, legibility, color harmony, unwanted-text) | AdCreative.ai's "Creative Scoring AI" predicts ad *performance*; nothing in the reviewed competitor set gates on *construction quality* (is the text legible, did stray text leak in, are there anatomy/artifact errors) before the user ever sees the output — this is a genuinely differentiated quality gate, not a performance predictor | HIGH | New OpenRouter call type reusing the same structured-output (`json_schema`) pattern already planned for the fixed art-director call; must be threshold-gated and budget-capped (see Visual Critic section) to avoid multiplying per-post cost under credit billing |
| Narrative carousel arc: hook → content → CTA with per-slide composition variation | Today's carousels are visually consistent but structurally flat (slide 2..N are just edits of slide 1); real "does this convert" carousel structure requires typed slide roles and deliberate composition change, which today's architecture doesn't express at all | MEDIUM-HIGH | Builds on the existing carousel service (master-text-call + N sequential image calls) — extends it, doesn't replace it; **hard-depends on the typography overlay landing first**, since carousels currently have *zero* on-slide text |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| AI-rendered pixel text with a verify/repair loop (the current `enforceExactImageText` in `text-rendering.service.ts`) | Seemed like the natural way to get "text in the image" from a text-to-image model | Root cause of the entire quality problem this milestone exists to fix — image models still can't reliably render arbitrary text as pixels, and the repair loop burns extra generation calls trying to fix what a compositor gets right on attempt 1 | Deterministic overlay (this milestone) — this loop is explicitly being **removed**, not iterated on |
| Split-panel / two-column layout (half photo, half solid color block with text) | Looks good in competitor template galleries (comparison/before-after ads) | Requires the *image model itself* to reliably compose the subject into exactly one half of the canvas and leave the other half clean — current models don't reserve space that precisely, so this archetype would silently fail (subject bleeding into the text half) far more often than bottom-band/top-stack/centered-hero | Defer to a later milestone once bottom-band/top-stack/centered-hero are proven reliable with reserved-negative-space prompting |
| Parallel best-of-N (always generate 3-4 full candidates, let the critic pick the best) | Common academic/high-end pattern (Idea2Img, image-arena leaderboards) and conceptually simple | Multiplies generation cost 3-4x on *every* post regardless of whether the first attempt was fine — directly conflicts with Xareable's per-post credit billing model, where the AI call is the dominant COGS | Sequential threshold-triggered re-roll: generate once, critic-score it, only pay for a 2nd/3rd attempt when the score fails a threshold (mirrors the existing `maxRepairPasses` cap of 2 already used — and now removed — in the text-repair loop) |
| Freeform drag-and-drop text box editor (Canva-clone WYSIWYG) | Users who've used Canva expect to nudge text themselves | Directly contradicts PROJECT.md's existing "Out of Scope: general-purpose photo editor" and the product's automated, no-design-skill-required value prop; also a large, unbounded UI/UX surface | Archetype-driven deterministic templates (bottom band / top stack / centered hero) selected automatically by `text_style` + content type, not manually positioned |
| More than 2 font families in one graphic (e.g., a 3rd "flourish" font for a badge) | Feels like it adds personality/variety | Directly contradicts the hierarchy rule that makes professional graphics read as designed rather than chaotic; also multiplies the font-loading/licensing surface for the compositor for no measurable quality gain | Reuse the support font at a different weight/size for any tertiary text (badges, fine print) instead of introducing a 3rd family |
| Mid-carousel CTA slides (CTA repeated at slide 5 *and* slide 8) | Some long-form (13-20 slide) carousel guidance recommends a mid-roll CTA | Xareable's carousel range is capped at 3-8 slides — the mid-carousel-CTA recommendation only applies to carousels roughly double that length; adding it here is copying advice that doesn't fit the product's actual slide-count ceiling | Single CTA on the final slide only, for the existing 3-8 slide range |

## Feature Dependencies

```
[text_styles catalog (existing)] ──extend──> [Dense aesthetic direction: photography type, lighting,
                                                60-30-10 named palette, anti-AI-look negatives]

[text_styles catalog (existing, font_family preview)] ──extend──> [headline+support font PAIRING field]
                                                                        └──requires──> [Deterministic typography overlay]

[TEXT_BLOCK_ROLES: highlight/support/cta (existing schema)] ──requires──> [Deterministic typography overlay]
[post_formats aspect-ratio catalog (existing)]              ──requires──> [Deterministic typography overlay]
[LOGO_POSITION_DESCRIPTIONS (existing)]                     ──requires──> [Deterministic typography overlay]
   (collision avoidance: text layout must not occupy the logo's corner)

[Deterministic typography overlay] ──requires──> [Narrative carousels: on-slide text]
   (carousels today have NO on-slide text — narrative arc cannot ship without the overlay landing first)

[Carousel service: master-text-call + N sequential image calls (existing)] ──enhances──> [Narrative carousels:
                                                                                            per-slide composition variation]

[OpenRouter gateway (P0, same milestone)] ──requires──> [Multimodal visual critic + re-roll]
[Structured outputs / json_schema (P0 fix, same milestone)] ──requires──> [Multimodal visual critic + re-roll]

[Admin-curated catalog pattern (scenery catalog, existing Phase 8)] ──enhances──> [Platform-curated style reference boards]
[Brand reference photo injection, 4-slot priority (existing v1.5)] ──enhances──> [Platform-curated style reference boards]
   (platform boards inject the same way, at LOWER priority than the user's own references when both are present)

[Deterministic typography overlay] ──conflicts──> [AI-rendered exact-text verify/repair loop (being removed)]
[Parallel best-of-N] ──conflicts──> [Credit-based per-post billing model]
```

### Dependency Notes

- **Deterministic typography overlay requires the existing `TEXT_BLOCK_ROLES`, `post_formats`, and `LOGO_POSITION_DESCRIPTIONS`:** the schema shape (headline/support/cta) already matches what a professional layout system needs — this is a compositing/rendering build, not a data-model redesign. The overlay must be computed per aspect ratio (safe zones differ enormously between `9:16` and `1:1`) and must know where the logo sits so text layout doesn't collide with it.
- **Narrative carousels require the typography overlay to land first:** the milestone context states carousels currently have zero on-slide text. A "hook slide" only functions as a hook if it can carry a bold headline; there is no narrative arc without text on the slide. This is a hard phase-ordering constraint for the roadmap.
- **Visual critic requires the OpenRouter gateway and structured outputs (P0):** the critic is architecturally "just another OpenRouter chat completion with image input + `json_schema` response," reusing the same call pattern already planned for the fixed art-director call. Building the critic before the gateway lands would mean building it twice.
- **Platform-curated style boards enhance, don't require, anything new architecturally:** the admin-curated-catalog pattern (scenery) and the reference-photo-injection pattern (brand references) already exist and already compose — this is closer to a content/config feature than a new system.
- **Parallel best-of-N conflicts with the credit billing model:** every paid generation path already flows through `checkCredits → recordUsageEvent → deductCredits` (per CLAUDE.md); a fixed multiplier on every generation (not just failures) breaks the cost model the billing system assumes. Sequential, threshold-triggered re-roll is the only pattern compatible with per-post credit pricing.

## Layout Archetypes (concrete, for the typography compositor)

These are the layout archetypes the compositor should implement — corroborated across Canva/Adobe Express template conventions and Instagram's published safe-zone geometry, not generic platitudes.

### 1. Bottom band / lower third
Text block (support + headline, optionally CTA) occupies the bottom ~25-35% of the canvas over a gradient scrim (black or brand-dark, 0% opacity at the ~65-75% canvas-height mark, ramping to 60-75% opacity at the bottom edge, feathered over the middle ~15-20% of that band to avoid a hard edge). Most versatile archetype; works for product/photo-led content where the subject occupies the upper 2/3. Maps well to `bold-promo`, `modern-corporate`, `event-poster` text styles.

### 2. Top stack
Headline + support stacked, top-aligned, occupying the top ~20-30% of the canvas. Requires a plate or scrim only if the top area of the generated image is visually busy (photography-led images often have simpler skies/backgrounds at the top, reducing plate necessity). Works well for announcement/event content. **Format-specific caveat:** fine for feed square/portrait; if ever extended to Stories/Reels (`9:16`), the top ~13-14% is reserved for the platform's own profile-pic/username chrome and must be excluded from this band.

### 3. Centered hero
Headline (and short support line) placed dead-center or on a rule-of-thirds intersection, large scale, with the *image itself* pushed off-center or softened/darkened behind the text zone via the art-director prompt (reserved negative space), not via a compositor-added plate. Best suited to `elegant-serif`, `classic-journal`, minimal/quote content. Highest dependency on the image-generation step actually leaving clean negative space — ties directly to the milestone's "images generated text-free with reserved negative space" requirement.

### 4. Corner badge (supplementary, not a standalone archetype)
Small badge (discount %, "NEW", date chip) anchored to a canvas corner not already claimed by the logo. Used *in combination* with any of the three primary archetypes above, never alone.

**Deferred / anti-feature:** split-panel/two-column (image half + solid-color text half) — see Anti-Features table above.

### Safe margins (per format, concrete)

| Format | Reserved/no-go zones | Usable text area |
|--------|---------------------|-------------------|
| Feed square `1:1` (1080×1080) | ~40px margin all sides (Instagram's own edge-crop tolerance) | center ~1000×1000px |
| Feed portrait `4:5` (1080×1350) | Outer ~10% of top AND bottom is cropped away when Instagram's **profile grid view** re-crops 4:5 down to a 1:1 thumbnail — critical text placed there survives the feed post but is invisible on the grid | keep headline/CTA within the vertically-centered ~80% band if grid-thumbnail legibility matters |
| Story/Reel `9:16` (1080×1920) | Top ~250px (13%) reserved for profile pic/username/timestamp (Stories) or ~108-190px (Reels); bottom ~250-400px (13-21%) reserved for reply bar (Stories) or caption/like/comment/audio icons (Reels, asymmetric: deeper on the right) | roughly the center 1080×1420-1610px band; use ~14% top / ~35% bottom / ~6% side margins as a conservative default if Reels-style UI is assumed |
| Facebook link preview `1200:628` | No platform UI overlay (link-preview card, not in-app chrome) — standard ad-safe-zone margins (~5-8% all sides) are a stylistic choice, not a platform requirement | wide margin available |

**Confidence note:** exact pixel/percentage figures for Stories/Reels safe zones vary slightly across sources (250px vs ~190-320px depending on device/UI version) — treat these as MEDIUM confidence directional guidance, not pixel-exact platform contract; add a small internal buffer rather than trusting any single source's number to the pixel.

### Contrast plate vs. scrim — decision rule

- **Gradient scrim** (soft, whole-band tint) → pair with **bottom band** and **top stack** archetypes; pair with softer/editorial `text_style` categories (`elegant-serif`, `classic-journal`, `modern-corporate`).
- **Solid/semi-opaque plate** (tight bounding box behind just the text, ~1× cap-height vertical padding, ~1.5× horizontal, corner radius ~2-3% of the shorter canvas edge) → pair with **centered hero** and punchy/high-contrast styles (`bold-promo`, `raw-brutalist`, `event-poster`).
- **Drop shadow / stroke outline only** (no band or plate) → reserve for short accent text (badges, small CTA labels) over already-clean backgrounds; never for full headline blocks on busy photography.

## Typography Hierarchy Rules (concrete)

- **Three roles, three sizes:** map directly to the existing `TEXT_BLOCK_ROLES` — headline (`highlight`) largest, support smallest of the two body texts, CTA sized similarly to support but heavier weight or in a button/plate treatment. Real ad-creative headline:support ratio runs **~1.5-3:1** — noticeably larger than typical UI modular scales (1.125-1.25); use a **Perfect Fourth to Perfect Fifth ratio (1.333-1.5)** as the base scale and let the headline step up 1-2 additional scale increments for poster-level dominance.
- **Max 2 font families per graphic:** one display/headline font + one body/support font; CTA reuses the body font at a bolder weight rather than introducing a third family. This is a genuine gap in the current catalog — each `text_style` entry declares only one `preview.font_family`; extend the schema with a paired support font per style (e.g., `bold-promo`: Impact/Anton headline + a heavy grotesque sans for support).
- **Line length / density caps:** headline ≤ 5-8 words (~40 characters) for hero placements; support text ≤ 1-2 short sentences (~90 characters); CTA ≤ 4-5 words. These caps must be enforced in the planning/art-director call's output schema (it decides the copy) and treated as a hard wrap/truncation contract in the compositor for the cases where translated PT/ES copy runs longer than the English original.
- **Negative space:** reserve roughly 15-25% of the canvas as clear space immediately around the text block; avoid edge-to-edge text except for the intentionally maximalist `raw-brutalist` style.
- **60-30-10 for the composited layer:** the AI-generated image supplies the dominant 60%; a brand secondary color drives the text/plate/scrim tint (30%); a brand accent color is reserved for the CTA plate/button or a badge only (10%) — this maps cleanly onto the existing 3-4 brand hex colors already captured at onboarding.

## Visual Critic / Best-of-N Pattern (concrete)

- **Scoring dimensions** (corroborated by academic image-quality-assessment work, e.g. CVPR "Rich Human Feedback for Text-to-Image Generation" and text-quality-in-images research): technical/artifact issues, unnaturalness (anatomy, warped objects), prompt-discrepancy (does the image match the brief), aesthetics/composition, **plus an explicit unwanted-text hard-check** — since images are now generated *text-free*, any stray/hallucinated glyphs the image model leaks in must be caught before the deterministic overlay is composited on top of them. Treat unwanted-text detection as a binary hard-fail gate, separate from the graded aesthetic score.
- **Recommended rubric for Xareable:** composition/subject clarity, color harmony vs. brand palette, artifact/anatomy check, unwanted-text detection (hard fail → forces re-roll regardless of other scores), brand-color-presence check. Score the graded dimensions on a simple 1-5 scale (5 = clean, 1 = unusable) rather than a free-form paragraph, so a numeric threshold can gate the re-roll decision deterministically.
- **Re-roll pattern: sequential threshold-triggered, not parallel best-of-N.** Academic patterns (Idea2Img: GPT-4V generates N prompts → N draft images → selects best → gives revision feedback → repeats) are the gold-standard approach but assume compute is cheap and per-attempt cost is not passed to an end user. Under Xareable's per-post credit billing, the cost-compatible version is: generate once → critic-score it → if it fails the threshold (or unwanted-text hard-fails), regenerate with the critic's structured feedback folded into the next prompt → cap at **2-3 total attempts**. This mirrors the `maxRepairPasses` cap of 2 already used (and being removed) in the current text-repair loop, and matches the general finding that self-refinement loops see diminishing returns beyond ~3-4 iterations.
- **Architecture reuse:** the critic call is structurally identical to the fixed art-director planning call this milestone already rebuilds (P0): an OpenRouter multimodal call with `json_schema` structured output. Building it as a sibling of that call, not a separate subsystem, avoids duplicating the gateway/schema-validation plumbing.
- **Latency/UX consideration:** generation is SSE-streamed to the client today; a critic pass adds a real round-trip before the user sees a "final" result. Budget the critic call's timeout and progress-event messaging as part of the same generation flow (e.g., an SSE event like `critic_reroll` mirroring the existing `slide_failed`/`slide_complete` event vocabulary in `carousel-generation.service.ts`) rather than a silent, invisible retry.

## Narrative Carousel Structure (concrete)

- **Slide archetypes, mapped to Xareable's existing 3-8 slide range:**
  - **Hook (slide 1):** bold headline, 5-8 words / ≤40 characters, largest text on the slide, high-contrast/pattern-interrupt visual treatment. Must answer "is this for me" and "what do I get if I swipe" within that single glance.
  - **Content (slides 2 through N-1):** one idea per slide ("flashcard" rule) — 1-2 short sentences, ≤ ~90 characters, readable in 2-3 seconds; each slide varies composition (crop/zoom, subject position alternating left/right on a rule-of-thirds grid, background treatment) while holding font system and color palette constant. This composition variation is the concrete answer to "per-slide composition variation" in the milestone's feature list.
  - **CTA (final slide, slide N only):** single direct ask aligned to the post's stated goal; do not repeat CTAs mid-carousel — mid-carousel CTA placement is only advised for carousels roughly double Xareable's 8-slide ceiling.
  - **Ordering rule for content slides:** front-load the most compelling/surprising point into slide 2 or 3, not slide 6 or 7 — swipe-through drop-off means most viewers never reach a "best point" buried deep in a 6-8 slide carousel.
- **Text density enforcement:** the planning/art-director call must be constrained (in its output schema, not just prompt wording) to per-slide-role character caps, matching the compositor's line-wrap capacity — otherwise translated PT/ES copy or an overly verbose planning-model output will overflow the deterministic layout.
- **Engagement data point (context/motivation, not a requirement):** carousels reportedly average meaningfully higher engagement than single images or Reels on Instagram in current data — treat as MEDIUM/LOW confidence (single marketing-blog source), but directionally consistent with widely-observed carousel performance and a reasonable justification for the milestone's investment, not a number to cite as fact externally.

## MVP Definition

### Launch With (v1.6 — this milestone, matches PROJECT.md phasing)

- [ ] Deterministic typography overlay (bottom-band + top-stack + centered-hero archetypes, safe zones per existing `post_formats`, headline/support/CTA mapped onto existing `TEXT_BLOCK_ROLES`) — this is the structural fix the whole milestone exists to deliver; without it the AI-rendered-text problem persists
- [ ] Font pairing extension to `text_styles` catalog (headline + support font per style) — small, cheap, unlocks the compositor
- [ ] Dense aesthetic direction upgrade to `brandStyleSchema`/`textStyleSchema` (photography type, lighting, named 60-30-10 palette, anti-AI-look negatives) — independent of the overlay, can build in parallel
- [ ] Narrative carousel slide typing (hook/content/CTA) + on-slide text via the overlay — sequenced *after* the overlay lands

### Add After Validation (v1.x, later in this milestone per existing P1/P2 phasing)

- [ ] Multimodal visual critic with sequential threshold-triggered re-roll — depends on OpenRouter gateway (P0) landing first
- [ ] Platform-curated style reference boards — independent content/config work, can slot in whenever content-ops bandwidth allows
- [ ] Per-slide composition variation refinement (rule-of-thirds alternation, zoom/crop variety) beyond the initial narrative-structure pass

### Future Consideration (v2+)

- [ ] Split-panel/two-column layout archetype — defer until reserved-negative-space prompting is proven reliable with the 3 primary archetypes
- [ ] Parallel best-of-N generation as an optional "high-quality" paid tier — could be offered as a premium credit-cost option later, but should never be the default given the cost multiplier
- [ ] User-adjustable text placement within an archetype (nudge, not freeform) — a constrained middle ground between "fully automatic" and "Canva clone," worth considering only after the deterministic archetypes ship and user feedback indicates a real need

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Deterministic typography overlay | HIGH | HIGH | P1 |
| Font pairing + text_styles schema extension | MEDIUM | LOW | P1 |
| Dense aesthetic direction upgrade | HIGH | MEDIUM | P1 |
| Narrative carousel (hook/content/CTA + composition variation) | HIGH | MEDIUM-HIGH | P1 (blocked on overlay) |
| Multimodal visual critic + re-roll | HIGH | HIGH | P2 (blocked on OpenRouter gateway) |
| Platform-curated style reference boards | MEDIUM | MEDIUM | P2 |
| Split-panel layout archetype | LOW-MEDIUM | HIGH | P3 (deferred) |
| Parallel best-of-N as premium tier | LOW | MEDIUM | P3 (deferred) |

**Priority key:**
- P1: Must have for this milestone's core value (professional-designer output quality)
- P2: Should have, sequenced after P0/P1 dependencies land within this milestone
- P3: Nice to have, explicitly deferred past this milestone

## Competitor Feature Analysis

| Feature | Canva / Adobe Express | AdCreative.ai / Predis.ai / Ocoya | Our Approach |
|---------|------------------------|-----------------------------------|--------------|
| Text-over-image layout | Human-driven template library (thousands of pre-built headline/support/CTA templates the user picks and edits manually) | Automated layout + messaging generation; user supplies/edits headline, punchline, CTA text directly (Predis "Text Craft AI"); layout largely templated | Fully automatic archetype selection (bottom band / top stack / centered hero) driven by `text_style` + content type, composited server-side with real fonts — no manual template picking |
| Output quality gating before showing the user | None (human is the quality gate — they see the template and either like it or don't) | AdCreative.ai's "Creative Scoring AI" (CNN) predicts ad **performance**, not construction quality (legibility, artifacts, stray text) | Multimodal visual critic scoring construction quality (composition, legibility, artifacts, unwanted text) with automatic sequential re-roll — a different, complementary axis to performance prediction |
| Style/reference curation | Canva's massive stock template + Adobe's Firefly style presets, browsable by the user | Brand kit color/font upload; limited curated "inspiration" surfaces | Platform-curated style reference boards, reusing the existing admin-curated-catalog + reference-photo-injection patterns already built for scenery/brand references |
| Carousel structure | Manual — user builds each slide themselves in a carousel template | Predis.ai generates full carousel content (visuals + captions) but no evidence of an enforced hook/content/CTA narrative typing per slide in public documentation | Explicit slide-role typing (hook/content/CTA) + per-slide composition variation baked into the generation pipeline itself, not left to the user or an undifferentiated "consistent style" pass |

## Sources

- [Best Canva Templates for Facebook and Instagram Ads (DTC Brands)](https://www.askneedle.com/blog/best-canva-templates-for-facebook-and-instagram-ads-dtc-brands)
- [Canva: Your ultimate guide to background design](https://www.canva.com/learn/background-design/)
- [Canva: Marry text and images in your designs](https://www.canva.com/learn/How-to-combine-text-and-images-to-improve-visual-design-and-communication/)
- [Instagram Safe Zone Sizes Guide 2026 — CampaignSwift](https://campaignswift.com/blog/instagram-safe-zone-sizes)
- [Instagram Safe Zone Guide: Sizes & Best Practices (2026) — Outfy](https://www.outfy.com/blog/instagram-safe-zone/)
- [Instagram Safe Zone: Guidelines & Best Practices — Minta](https://www.minta.ai/blog-post/instagram-safe-zone)
- [Instagram Ad Safe Zones: Exact 2026 Dimensions — FirstPier](https://www.firstpier.com/resources/instagram-ad-safe-zones)
- [Instagram Dimensions & Safe Zones Cheat Sheet 2026 — InstaSaver](https://instasaver.io/en/blog/instagram-dimensions-safe-zones/)
- [AdCreative.ai official site — feature descriptions](https://www.adcreative.ai/)
- [What is AdCreative.ai and how does it work? — Semrush KB](https://www.semrush.com/kb/1424-adcreative-ai)
- [Predis.ai official site — feature descriptions](https://predis.ai/)
- [Predis.ai vs AdCreative.ai comparison](https://predis.ai/resources/predis-ai-vs-adcreative-ai/)
- [10 Best AI Ad Creative Generators & Tools in 2026 — Superside](https://www.superside.com/blog/ai-ad-creative-generators)
- [What is the 60-30-10 Rule in Graphic Design? — Zeka Design](https://www.zekagraphic.com/what-is-the-60-30-10-rule-in-graphic-design/)
- [The 60-30-10 Color Rule — Theme & Color](https://themeandcolor.com/blog/60-30-10-color-rule)
- [Master UI design: the 60-30-10 rule — LogRocket](https://blog.logrocket.com/ux-design/60-30-10-rule/)
- [Ultimate Guide to Typography in Design — Figma](https://www.figma.com/resource-library/typography-in-design/)
- [8 social media graphic design principles — Ideas + Outcomes](https://ideasandoutcomes.com/insights/social-media-graphic-design-principles)
- [What are the different types of typographic scales? — Cieden](https://cieden.com/book/sub-atomic/typography/different-type-scale-types)
- [Typographic Scales — spec.fm](https://spec.fm/specifics/type-scale)
- [Design Techniques to Display Text over Background Images — Suleiman's Blog](https://blog.iamsuleiman.com/techniques-to-display-text-overlay-background-images/)
- [Responsive Scrim — Travis Horn](https://travishorn.com/responsive-scrim/)
- [Designing Accessible Text Over Images, Part 1 — Smashing Magazine](https://www.smashingmagazine.com/2023/08/designing-accessible-text-over-images-part1/)
- [Designing Accessible Text Over Images, Part 2 — Smashing Magazine](https://www.smashingmagazine.com/2023/08/designing-accessible-text-over-images-part2/)
- [Instagram Carousel Posts: Templates, Sizes & 12 Tips — CreatorFlow](https://creatorflow.so/blog/instagram-carousel-posts-guide/)
- [Instagram Carousel Strategy 2026 — TrueFuture Media](https://www.truefuturemedia.com/articles/instagram-carousel-strategy-2026)
- [A Guide to Creating an Instagram Carousel Post That Converts — Cometly](https://www.cometly.com/post/instagram-carousel-post)
- [Instagram Carousel Best Practices for More Engagement — PostEverywhere](https://posteverywhere.ai/blog/instagram-carousel-best-practices)
- [How to Make Instagram Carousels That Actually Get Engagement — PostWaffle](https://www.postwaffle.com/blog/instagram-carousel-guide)
- [Best Hooks for Instagram Carousel — Resont](https://resont.com/blog/top-instagram-carousel-hooks/)
- [Instagram Carousel Best Practices 2026: 12 Rules That Drive Saves — Carouselli](https://carouselli.com/blog/instagram-carousel-best-practices)
- [TIQA: Human-Aligned Perceptual Text Quality Assessment in Generated Images (arXiv)](https://arxiv.org/html/2603.07119)
- [Rich Human Feedback for Text-to-Image Generation (CVPR 2024)](https://openaccess.thecvf.com/content/CVPR2024/papers/Liang_Rich_Human_Feedback_for_Text-to-Image_Generation_CVPR_2024_paper.pdf)
- [Idea2Img: Iterative Self-Refinement with GPT-4V(ision) for Automatic Image Design and Generation (arXiv 2310.08541)](https://arxiv.org/abs/2310.08541)
- [Idea2Img project page](https://idea2img.github.io/)
- Internal source (read, not web): `C:\Users\Vanildo\Dev\xareable\shared\schema.ts` (existing `text_styles`, `TEXT_BLOCK_ROLES`, `post_formats`, `styleCatalogSchema`), `server\services\text-rendering.service.ts` (current verify/repair loop being removed), `server\services\carousel-generation.service.ts` (existing carousel architecture), `.planning\PROJECT.md` (milestone scope)

---
*Feature research for: Xareable v1.6 — professional-designer AI output quality (typography overlay, aesthetic direction, visual critic, narrative carousels)*
*Researched: 2026-07-18*
