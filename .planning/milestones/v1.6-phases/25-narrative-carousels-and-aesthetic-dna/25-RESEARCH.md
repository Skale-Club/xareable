# Phase 25: Narrative Carousels & Aesthetic DNA - Research

**Researched:** 2026-07-28
**Domain:** Server-side prompt engineering + deterministic image compositing (internal codebase extension, no new external libraries)
**Confidence:** HIGH (all findings verified by direct file reads of the current codebase; no external library research was load-bearing)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Narrative Structure & Composition Variation (CRSL2-01)**
- Each slide gains a `role` field (`"hook" | "content" | "cta"`) in the master plan schema, assigned DETERMINISTICALLY by server-side code, not left to the model: slide 1 is always `hook`, the last slide is always `cta`, everything in between is `content`.
- Each slide's schema also gains a required `composition_note` field describing its intended framing/camera angle/shot type. The master prompt instructs the model to vary this across slides (e.g. wide establishing shot for the hook, close-up detail shots for content, a clear product/CTA shot for the closer) — explicitly countering today's "reference the same composition" instruction in the slide-2..N edit prompt.
- SC2's "automated inter-slide composition-similarity check" is implemented as a text/schema-based check (comparing the structured `composition_note` values for meaningful difference across slides) — cheap, deterministic, CI-testable via the static harness. A true visual/pixel-level similarity check is NOT required; real visual confirmation is a manual/live runbook item.

**Deterministic Compositor Wiring for Carousels (CRSL2-02, CRSL2-04)**
- Every slide runs through the SAME pipeline order as Phase 23's single-image path: AI image-gen/edit → `cropToExactAspectRatio` → `resolveTextBlocks`/`compositeTypography` → `applyLogoOverlay` → optimize/upload.
- Each slide gets its own `text_blocks` array (same shape as the single-image schema — headline/support/cta role-tagged text entries), populated per-slide by the master planning call.
- `layout_archetype_id` is chosen ONCE for the whole carousel (same mechanism as `shared_style`) and applied consistently to every slide — this satisfies SC1's explicit requirement that "fonts/colors/layout archetype [are] held consistent across all slides." Per-slide layout archetype variation is explicitly NOT done.
- `textStyleIds` (currently parsed into `CarouselGenerationParams` but never read anywhere) is wired to actually influence the typography compositor's font/style choice for the carousel.
- Logo overlay is ALREADY functional for carousels today (`applyLogoOverlay` already runs per slide) — CRSL2-04's logo clause is a confirm/harden task, not new construction. Contrast-aware logo treatment is explicitly Phase 26's scope, not this phase's.
- `post_slides`/`post_slide_versions` (or equivalent) need additive columns analogous to Phase 23's `posts.base_image_url`/`typography_meta` — exact schema/migration is research/planning's job, following the established additive-migration pattern.

**Aesthetic DNA — Dense Art Direction & Color (PLAN-05, PLAN-06)**
- `brandStyleSchema`/`postMoodSchema` (the style catalog's data shape) gain new structured fields for dense art direction — photography type, lighting treatment, anti-AI-look negative prompts — as admin-curated DATA (extending the catalog schema + its admin editor UI), not just prompt-engineering synthesized on top of the existing thin `label`/`description` fields.
- 60-30-10 color usage: `color_1` as the 60% dominant tone, `color_2` as the 30% secondary tone, `color_4` as the 10% accent — exact prompt-phrasing formula is Claude's technical discretion, but MUST explicitly reference `color_4` per SC4's callout (today's `color_4` field exists in brand schema but is unused in any 60-30-10 proportion language — it's currently just flat-joined with the other colors).
- The EXISTING `DEFAULT_STYLE_CATALOG` entries (styles + post_moods) get real, dense content written for their new art-direction fields as part of this phase — not left as empty schema slots awaiting future curation. This is real content/copywriting work within the phase's scope.

**Admin-Curated Style Reference Boards (PLAN-07)**
- New platform-wide table (e.g. `style_reference_photos`) keyed by `style_id` (not `brand_id`/`user_id` like the existing `brand_reference_photos`) — admin-only write RLS, public/any-authenticated-user read RLS. Structurally similar to `brand_reference_photos` (image set + position ordering + storage bucket pattern) but with an inverted ownership/ACL model.
- When multiple reference-image sources compete for the limited multimodal image-slot budget (the existing 4-slot Gemini limit), priority order is: user-uploaded images (most specific intent) > brand reference photos (established brand look) > style reference board images (general aesthetic direction, least specific) — filling remaining slots in that order.
- The admin UI for managing style reference boards lives inside the existing style-catalog admin editor (wherever styles/moods are currently managed), not a new separate admin page.

### Claude's Discretion
- Exact `post_slides`/`post_slide_versions` migration shape for base-image/typography persistence.
- Exact composition_note variation phrasing/instructions in the master prompt.
- Exact new art-direction schema field names and their prompt-injection format.
- Exact 60-30-10 color-usage prompt formula.
- Exact dense content written for each existing DEFAULT_STYLE_CATALOG entry.
- Exact `style_reference_photos` migration/RLS policy wording.

### Deferred Ideas (OUT OF SCOPE)
- Contrast-aware adaptive logo overlay — explicitly Phase 26's scope, not this phase's (logo overlay stays purely positional here, as it is today).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-05 | Style catalog upgraded from one-liners to dense art direction per style/mood (photography type, lighting, composition, texture) + a global anti-AI-look negative prompt block | See "Aesthetic DNA Schema Extension" (Architecture Patterns) + `brandStyleSchema`/`postMoodSchema` current shape (Code Examples) + admin editor precedent (`text-styles-card.tsx` CSV-array pattern) |
| PLAN-06 | Brand colors injected as named colors with 60-30-10 proportion rules; `color_4` included | See "60-30-10 Color Injection" (Architecture Patterns) + `formatBrandColors`/`formatBrandColorsLabeled` current shape (Code Examples) + prompt-engineering findings (State of the Art) |
| PLAN-07 | Platform-curated style reference boards (admin-managed images per style/mood) attached to image generation as style references | See "Style Reference Boards" (Architecture Patterns) + `brand_reference_photos`/`app_settings` RLS precedents + `mergedReferenceImages` 4-slot mechanism (Code Examples) + Open Question 1 (scope: single-image vs. carousel) |
| CRSL2-01 | Carousel master plan produces per-slide `text_blocks` with narrative typing (hook slide → content slides → CTA slide), a layout archetype, and a per-slide composition variation directive (reverses CRSL-10) | See "Carousel Master Plan Schema Extension" (Architecture Patterns) + exact current `CarouselTextPlan`/`buildCarouselMasterPrompt`/`validateCarouselTextPlan` (Code Examples) |
| CRSL2-02 | Compositor applies per-slide typography with shared style tokens (fonts, colors, archetype) held constant across slides | See "Per-Slide Compositor Wiring" (Architecture Patterns) + exact single-image pipeline order (Code Examples) + Pitfall "Single bundled font family" |
| CRSL2-04 | Carousel honors previously-dead creator options: text styles feed the compositor; `use_logo`/`logo_position` apply the deterministic logo overlay per slide | See "Per-Slide Compositor Wiring" + Pitfall "textStyleIds has no compositor-visible effect today, anywhere" + logo overlay already-functional confirmation |
</phase_requirements>

## Summary

This phase touches ONLY internal application code — no new npm packages, no new external services. It extends four existing subsystems that Phases 22-24 already built: (1) the carousel master-plan JSON contract (`carousel-generation.service.ts`), (2) the style-catalog JSONB blob (`shared/schema.ts` + `app_settings`-style admin editor), (3) the Phase 23 typography compositor/crop/logo pipeline (already proven for single images, needs per-slide wiring), and (4) the reference-image merging pattern first built in `generate.routes.ts` for brand references.

The single most important finding is that **the carousel generation path is currently much thinner than the single-image path it needs to mirror**: `buildCarouselMasterPrompt` never resolves `brand.mood`/`postMood` against the style catalog (it uses raw IDs, not labels/descriptions), never attaches any reference images (user, brand, or otherwise) to either the text-plan call or the per-slide image calls, and its text-plan call uses the flash-tier `ai_models.text_generation` model with loose `json_object` parsing — NOT the higher-tier `ai_models.planning` model with strict `json_schema` validation that Phase 22 built for the single-image path. A load-bearing comment left in the code by Phase 22 explicitly assigns this upgrade to "Phase 25." The typography compositor itself has exactly ONE bundled font family (Inter, 3 static weights) with a hardcoded role→weight mapping and no per-style-selection mechanism at all — "wiring `textStyleIds` to influence font/style choice" cannot mean swapping typefaces without new font-bundling work that is not in this phase's scope; it more plausibly means driving weight/size/case treatment variations or (at minimum) reaching feature parity with the single-image path where `textStyleIds` currently only steers COPY tone, not rendering.

**Primary recommendation:** Treat this phase as "bring the carousel path up to the single-image path's Phase 22/23 standard, then layer the new Aesthetic DNA fields on top of both paths." Concretely: (1) resolve style/mood labels+descriptions+new dense fields in `buildCarouselMasterPrompt` exactly like `gemini.service.ts#buildContextPrompt` already does; (2) extend `CarouselTextPlan`/`validateCarouselTextPlan` with `role`, `composition_note`, `text_blocks`, `layout_archetype_id` mirroring `PLANNING_JSON_SCHEMA`'s exact field shapes; (3) upgrade `callCarouselTextPlan`'s model resolution from `text_generation` to `planning`; (4) insert the crop→compositor→logo pipeline into the carousel per-slide loop verbatim from `generate.routes.ts`'s image branch; (5) add additive `base_image_url`/`typography_meta` columns to `post_slides` (and consider `post_slide_versions`); (6) add new dense art-direction fields to `brandStyleSchema`/`postMoodSchema` + write real content for all 10 styles/12 moods in `DEFAULT_STYLE_CATALOG`; (7) build the 60-30-10 color formula as a new labeled-color helper that explicitly names `color_4`; (8) create the `style_reference_photos` table mirroring `brand_reference_photos`'s structure but `app_settings`'s inverted RLS ACL, plus a new admin Card component (NOT wired through the batched `catalog`/`setCatalog` state — it needs its own immediate-persist CRUD routes like `brand-references.routes.ts`).

## Standard Stack

No new external dependencies. This phase is 100% internal wiring: schema extension (Zod), prompt-string construction (plain TS template literals), and reuse of already-installed `@napi-rs/canvas`/`sharp` via the existing compositor/crop services.

### Core (already installed, reused as-is)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@napi-rs/canvas` | 1.0.2 (confirmed in `package-lock.json`, Phase 23) | Typography compositor rendering | Already the platform's only font-rendering engine; no reason to add another |
| `sharp` | (existing dependency, used throughout) | Aspect-ratio crop, logo overlay compositing, image optimization | Already the platform's only image-processing library |
| `zod` | (existing dependency) | Schema validation for all new fields (`shared/schema.ts`) | Single source of truth for both client and server types per CLAUDE.md |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `PLANNING_JSON_SCHEMA`-style strict `json_schema` dialect for the carousel's text-plan call | Keep the carousel's current loose `json_object` + manual `validateCarouselTextPlan()` pattern | Strict schema eliminates a class of malformed-plan failures (PLAN-02's rationale) but is more upfront work touching both OpenRouter and legacy-direct dialects; CRSL2-02 only requires the plan to "reuse/mirror this same **shape**," not necessarily the same **transport**. See Open Question 4. |
| A brand-new admin page for style reference boards | Extend the existing `PostCreationTab` with a new Card (mirrors `SceneriesCard`) | CONTEXT.md explicitly locks this: "lives inside the existing style-catalog admin editor... not a new separate admin page." |

**Installation:** None required — no `npm install` needed for this phase.

## Architecture Patterns

### Carousel Master Plan Schema Extension (CRSL2-01)

**Current state** (`server/services/carousel-generation.service.ts:149-153`):
```typescript
interface CarouselTextPlan {
    shared_style: string;
    slides: Array<{ slide_number: number; image_prompt: string }>;
    caption: string;
}
```

Target shape (mirroring `PlanningWirePlan`/`PLANNING_JSON_SCHEMA` from `server/services/planning-schema.service.ts:33-95,107-245`, which already established the exact `text_blocks`/`layout_archetype_id` field shapes and descriptions for the single-image path):
```typescript
interface CarouselTextPlan {
    shared_style: string;
    layout_archetype_id: LayoutArchetypeId;   // NEW — chosen ONCE, same mechanism as shared_style
    slides: Array<{
        slide_number: number;
        image_prompt: string;
        role: "hook" | "content" | "cta";      // NEW — assigned server-side, not model-chosen (see below)
        composition_note: string;              // NEW — model-authored, varied per slide
        text_blocks: Array<{ role: "highlight"|"support"|"cta"; text: string }>; // NEW
    }>;
    caption: string;
}
```

**`role` MUST be assigned deterministically in server code, not trusted from the model's JSON**, per CONTEXT.md's explicit locked decision ("assigned DETERMINISTICALLY by server-side code, not left to the model"). The cleanest place is a small post-processing step in `validateCarouselTextPlan` (or immediately after it returns): `slides[0].role = "hook"`, `slides[last].role = "cta"`, all others `"content"`. Do NOT ask the model to emit `role` and trust it — even though it's easy to also have the model emit it for schema symmetry, server code must overwrite it.

**Token budget**: `CAROUSEL_TOKENS_PER_SLIDE` (currently `350`, `carousel-generation.service.ts:36`) was already sized for "per-slide `image_prompt` + future text/layout fields" per its own comment — but adding `composition_note` + `text_blocks[]` (up to 3 entries) + `role` per slide meaningfully increases per-slide output size. Follow PLAN-03's exact reasoning (`carousel-generation.service.ts:28-40`) and bump this constant; verify against the real 65,536-token completion ceiling headroom the comment already documents.

### 60-30-10 Color Injection (PLAN-06)

**Current state** (`server/services/prompt-builder.service.ts:272-288`):
```typescript
export function formatBrandColors(brand: BrandColorFields): string {
    return [brand.color_1, brand.color_2, brand.color_3, brand.color_4]
        .filter((color): color is string => Boolean(color && color.trim()))
        .join(", ");
}
export function formatBrandColorsLabeled(brand: BrandColorFields): string {
    const labels = ["Primary", "Secondary", "Accent", "Accent 2"];
    return [brand.color_1, brand.color_2, brand.color_3, brand.color_4]
        .map((color, index) => (color && color.trim() ? `${labels[index]} ${color}` : null))
        .filter(Boolean)
        .join(", ");
}
```
Neither function expresses proportion — colors are flat-joined. `color_4` is nullable in `brandSchema` (`shared/schema.ts:73`) so any 60-30-10 phrasing must degrade gracefully when `color_4` (and even `color_3`) is absent.

Recommended pattern (new function, e.g. `formatBrandColorsProportional`): produce a sentence naming each hex as a "named color" (web research below confirms AI image models respond far better to descriptive color names/relationships than raw hex codes) with explicit percentage roles: `color_1` = 60% dominant, `color_2` = 30% secondary, `color_4` = 10% accent (per CONTEXT.md's explicit mapping — note `color_4`, not `color_3`, is the accent slot; `color_3` is unused in the 60-30-10 formula per the locked decision). Both `gemini.service.ts`'s `buildContextPrompt` (single-image, ~line 662) and the carousel's `buildCarouselMasterPrompt` (currently only calls the flat `formatBrandColors`, line 176) need this new call site.

### Aesthetic DNA Schema Extension (PLAN-05)

**Current state** (`shared/schema.ts:119-132`):
```typescript
export const brandStyleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
});
export const postMoodSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  style_ids: z.array(z.string().min(1)).default([]),
});
```
These are genuinely thin — `description` is a single free-text sentence, injected today as `${brandStyleLabel}${brandStyleDesc}` (a "Label (description)" fragment) at `gemini.service.ts:563-566,595,610-611,636,663-664` and NEVER at all in the carousel path (`buildCarouselMasterPrompt` doesn't reference the style catalog whatsoever — see Pitfalls).

Recommended new fields (additive, `.optional()`/`.default()` so existing rows parse untouched — mirrors how `textStyleSchema`'s `prompt_hints`/`preview` sub-objects were added): `photography_type: z.string().default("")`, `lighting: z.string().default("")`, `negative_prompts: z.array(z.string()).default([])` (or a single dense string — see `textStylePromptHintsSchema.avoid` at `shared/schema.ts:141` for the array-of-strings precedent already in this codebase, edited via the `splitCsv`/`joinCsv` CSV-textarea pattern in `text-styles-card.tsx:30-39`). A **global** anti-AI-look negative prompt block (PLAN-05's "+ a global anti-AI-look negative prompt block") is a platform-wide constant, not per-style data — likely a new exported string constant near `ARCHETYPE_NEGATIVE_SPACE_ZONE` or inline in `gemini.service.ts`, always appended regardless of which style/mood is chosen.

The admin editor precedent is `client/src/components/admin/post-creation/brand-styles-card.tsx` (Accordion-per-style, `Input`/`Textarea` bound to `updateField`) and `text-styles-card.tsx` (same pattern, plus the CSV-array editing trick for `avoid`). New fields slot into the existing Accordion content the same way.

**Both `styles` (10 entries) and `post_moods` (12 entries) in `DEFAULT_STYLE_CATALOG`** (`shared/schema.ts:253-416`) need real dense content written for every existing entry — this is explicit in-scope copywriting work per CONTEXT.md, not just schema plumbing.

### Style Reference Boards (PLAN-07)

**Structural precedent — `brand_reference_photos`** (`supabase/migrations/20260516000000_brand_style_references.sql`, `shared/schema.ts:81-100`, `server/routes/brand-references.routes.ts`): UUID PK, FK to owner (`brand_id`+`user_id`), `photo_url text`, `position integer`, `created_at`. RLS: 4 policies, all `user_id = auth.uid()` (owner-only CRUD).

**ACL precedent — `app_settings`** (`supabase/migrations/20260303000010_app_settings.sql`): the EXACT inverted ACL this phase needs — `FOR SELECT USING (true)` (anyone can read) + `FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))` (admin-only write). Use this exact `EXISTS (...profiles.is_admin = true)` subquery pattern for `style_reference_photos`'s INSERT/UPDATE/DELETE policies; SELECT policy should be `USING (true)` (or `auth.role() = 'authenticated'` if anonymous reads must be blocked — check whether the creator UI needs these photos client-side at all, since generation-time attachment happens server-side via the admin client, so public SELECT may not even be strictly required — see Open Question 2).

**Storage-path/upload precedent — `sceneries-card.tsx`** (`client/src/components/admin/post-creation/sceneries-card.tsx:122-149`): admin's own authenticated Supabase client uploads directly to `user_assets` storage under `${user.id}/sceneries/...`, then the resulting public URL is stored in catalog state. A `style_reference_photos` table, being a REAL relational table (not a JSONB blob field), should instead follow `brand-references.routes.ts`'s POST/DELETE-immediately pattern (`server/routes/brand-references.routes.ts:67-176`) — client uploads the file to storage, then POSTs `{ photo_url, position }` to a new `/api/admin/style-reference-photos` endpoint that inserts the DB row (admin-guarded via `requireAdminGuard`, mirroring `style-catalog.routes.ts:60-62`).

**Critical architectural note:** because `style_reference_photos` is a genuinely separate table (not part of the `platform_settings.style_catalog` JSONB blob), the new admin Card CANNOT be wired through `PostCreationTab`'s existing `catalog`/`setCatalog` batched-save pattern (`client/src/components/admin/post-creation-tab.tsx:21-58`, one big "Save Post Settings" button). It needs its OWN `useQuery`/`useMutation` pair hitting dedicated CRUD endpoints with immediate persistence (like `SceneriesCard` almost does, except `SceneriesCard`'s data actually IS part of `catalog` — style reference boards are not). CONTEXT.md's locked decision that it "lives inside the existing style-catalog admin editor" is about UI LOCATION (same tab/page), not about the JSONB save mechanism.

**Reference-image priority merging (PLAN-07's competing-sources rule):** exact precedent in `server/routes/generate.routes.ts:487-510`:
```typescript
const userRefImages = (reference_images || []).map(img => ({ mimeType: img.mimeType, data: img.data }));
let mergedReferenceImages = userRefImages;
if (!isVideo && use_brand_references !== false && userRefImages.length < 4) {
    const slotsRemaining = 4 - userRefImages.length;
    const { data: brandPhotos } = await supabase.from("brand_reference_photos")
        .select("photo_url").eq("brand_id", brand.id).order("position").limit(slotsRemaining);
    if (brandPhotos?.length) {
        mergedReferenceImages = [...userRefImages, ...await fetchBrandReferenceImagesAsBase64(brandPhotos.map(p => p.photo_url))];
    }
}
```
This same `mergedReferenceImages` array is passed BOTH to the planning/text call (`gemini.generateText({ referenceImages: mergedReferenceImages, ... })`, line 525) AND to the actual image-generation call (`provider.generate({ referenceImages: mergedReferenceImages, ... })`, line 653) — confirming "attached to image generation" in ROADMAP's SC5 wording covers the real `ImageProvider.generate()` call, not just the planning call. A third tier (style board images) should extend this exact block: after brand photos fill remaining slots, if slots STILL remain, query `style_reference_photos` for the selected style/mood id and fill the rest — same `slotsRemaining` arithmetic, lowest priority, last to fill.

### Per-Slide Compositor Wiring (CRSL2-02, CRSL2-04)

**Exact single-image pipeline order to replicate** (`server/routes/generate.routes.ts:745-822`):
```typescript
finalImageBuffer = await cropToExactAspectRatio(finalImageBuffer, aspect_ratio);      // POL-04
baseImageUrl = await uploadFile(sb, "user_assets", `${user.id}/base/${postId}.png`, finalImageBuffer, "image/png"); // TYPO-05
if (use_text) {
    const blocks = resolveTextBlocks({ textBlocks, headline, subtext });
    if (blocks.length > 0) {
        const composed = await compositeTypography({ baseImageBuffer: finalImageBuffer, textBlocks: blocks, layoutArchetypeId, aspectRatio: aspect_ratio });
        finalImageBuffer = composed.buffer;
        typographyMeta = composed.meta;
    }
}
if (use_logo && brand.logo_url) {
    finalImageBuffer = await applyLogoOverlay(finalImageBuffer, logoBuffer, logoPosition);
}
const { image, thumbnail } = await processImageWithThumbnail(finalImageBuffer);
```

**Carousel's current per-slide loop** (`carousel-generation.service.ts:544-628`) does: AI generate/edit → (if `logoBuffer`) `applyLogoOverlay` → `uploadSlideBuffer` (which internally calls `processImageWithThumbnail` then two `.storage.upload()` calls). It is MISSING the crop step, the base-image persist step, and the entire typography-compositor step. The insertion point is right after the `buffer = result.buffer;` assignment (lines 568/590) and before the existing `if (logoBuffer)` block (line 601) — crop, then base-image upload, then compositor, THEN logo (matching the single-image order exactly), then the existing `uploadSlideBuffer` call.

**Per-slide `text_blocks`**: the master plan's per-slide `text_blocks` (new field, see Schema Extension above) feeds `resolveTextBlocks`/`compositeTypography` exactly like the single-image path's `textResult.content.text_blocks` does. `layout_archetype_id` comes from the CAROUSEL-LEVEL field (chosen once), applied identically to every slide's `compositeTypography` call — this is the literal meaning of "shared style tokens... held constant across slides."

**Exact function signatures to call** (`server/services/typography-compositor.service.ts:101-105,496-501`, `server/services/image-crop.service.ts:58-61`):
```typescript
function resolveTextBlocks(input: { textBlocks?: TextBlock[] | null; headline?: string | null; subtext?: string | null }): TextBlock[]
async function compositeTypography(params: { baseImageBuffer: Buffer; textBlocks: TextBlock[]; layoutArchetypeId: LayoutArchetypeId; aspectRatio?: string }): Promise<{ buffer: Buffer; meta: TypographyMeta }>
async function cropToExactAspectRatio(buffer: Buffer, aspectRatio: string): Promise<Buffer>
```
All three degrade gracefully (never throw) on internal failure — `compositeTypography` catches everything and returns the base image unchanged; `cropToExactAspectRatio` returns the original buffer on any parse/metadata failure. This "never break a generation" contract should be preserved for the carousel loop exactly as-is (no new try/catch needed around these calls beyond what the single-image path already omits, since the functions self-protect).

**Carousel-specific wrinkle — `slide1Base64` must stay PRE-compositor/PRE-logo.** The existing comment at `carousel-generation.service.ts:599-600` ("slide1Base64 (the style anchor for slides 2..N) intentionally stays pre-overlay so the edit model never tries to repaint the logo") already establishes this discipline for the logo. The SAME reasoning applies to typography now: `slide1Base64`/`slide1MimeType` (captured at line 571-572, right after `generateSlideOne`) must be captured BEFORE crop/compositor/logo run on slide 1's buffer, or slides 2..N's `provider.edit()` call will be shown a reference image that already has slide 1's rendered text baked in, and the edit model may try to reproduce or "clean up" that text in slides 2..N's freshly-generated (pre-compositor) output. Capture the raw buffer for the anchor first, THEN run crop/compositor/logo on a separate local variable for upload.

**Model tier upgrade (load-bearing comment, not optional):** `carousel-generation.service.ts:266-270` states verbatim: *"Phase 22 scope note: carousel keeps ai_models.text_generation. Only the token budget changes this phase (PLAN-03); the model tier + multimodal references are Phase 25 (Narrative Carousels & Aesthetic DNA)."* This means `callCarouselTextPlan`'s model resolution (currently `params.styleCatalog.ai_models?.text_generation || TEXT_MODEL` at line 270) should become `params.styleCatalog.ai_models?.planning || "gemini-2.5-pro"` — mirroring `gemini.service.ts:791-793`'s exact ternary for the non-video case.

### Recommended Additive Migration Shape (post_slides)

Mirroring `supabase/migrations/20260728000000_posts_base_image_typography_generation_params.sql` exactly (nullable, no backfill, no default, LEGACY rows keep `base_image_url IS NULL` forever):
```sql
ALTER TABLE public.post_slides
  ADD COLUMN IF NOT EXISTS base_image_url text,
  ADD COLUMN IF NOT EXISTS typography_meta jsonb;
```
`shared/schema.ts`'s `postSlideSchema` (currently lines 610-618) needs matching additive fields: `base_image_url: z.string().nullable().default(null)`, `typography_meta: typographyMetaSchema.nullable().default(null)` — reuse the EXISTING `typographyMetaSchema` (`shared/schema.ts:468-486`), do not invent a parallel type. The `slideRows` insert at `carousel-generation.service.ts:684-689` needs both new fields added at insert time.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-slide aspect-ratio normalization | A new crop function for carousels | `cropToExactAspectRatio()` from `image-crop.service.ts` (generic `"W:H"` parser, works for any ratio string including the carousel's `"1:1"`/`"4:5"`) | Already handles the tolerance/no-op/never-throw contract; carousels only use 2 of its 15 supported ratios but the function needs zero modification |
| Per-slide text rendering | A carousel-specific text compositor | `compositeTypography()` from `typography-compositor.service.ts` | Exact same font/archetype/contrast/scrim logic Phase 23 already hardened with a golden-image CI gate; duplicating it would fork font registration and drift from the single-image path |
| Logo placement per slide | New logo math | `applyLogoOverlay()` from `image-optimization.service.ts` — ALREADY called in the carousel loop today | CRSL2-04's logo clause is confirm-only per CONTEXT.md; do not touch this function |
| Style reference board RLS | Ad-hoc admin-check SQL | The `EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)` pattern from `app_settings`'s migration | Already the proven admin-write/public-read idiom in this codebase; reinventing risks a subtly different (and possibly bypassable) admin check |
| Reference-image slot budgeting | A new "how many images can I attach" heuristic | The exact `4 - userRefImages.length` / `.limit(slotsRemaining)` arithmetic from `generate.routes.ts:495-509` | This is already the codebase's one enforced convention for the model's practical multi-image input limit; a second, slightly different cap invites drift |
| Carousel plan JSON parsing | A new parser | `parseGeminiJson()` already exists locally in `carousel-generation.service.ts:201-220` (mirrors `gemini.service.ts:807-821`) | Two independent implementations of the same "extract JSON from possibly-fenced text" logic already exist in this codebase; a third would be pure duplication — reuse whichever one already lives in the file being edited |

**Key insight:** almost nothing genuinely new needs to be built. The overwhelming majority of this phase's server-side work is *wiring existing Phase 22/23 machinery into a code path (carousels) that was never connected to it*, not building new machinery.

## Common Pitfalls

### Pitfall 1: Carousel path currently resolves NO style/mood catalog data at all
**What goes wrong:** A planner might assume the carousel master prompt already injects dense style/mood context (since the single-image path does) and only add the NEW art-direction fields on top.
**Why it happens:** `buildCarouselMasterPrompt` (`carousel-generation.service.ts:171-197`) destructures `{ brand, postMood, aspectRatio, prompt, contentLanguage, slideCount }` from params — it never reads `params.styleCatalog` (despite it being passed into `CarouselGenerationParams`), never resolves `brand.mood` against `styleCatalog.styles`, and injects the raw `postMood` ID string directly (`Mood: ${postMood}`) instead of a resolved label+description.
**How to avoid:** The carousel master prompt needs the SAME `styleCatalog.styles.find(...)`/`styleCatalog.post_moods.find(...)` resolution that `gemini.service.ts:560-566` already does, from scratch — this is net-new carousel work, not a copy of an already-working carousel mechanism.
**Warning signs:** If `buildCarouselMasterPrompt`'s signature still destructures only the original 6 fields after this phase, the dense art-direction fields have not reached the carousel path.

### Pitfall 2: `textStyleIds` has no compositor-visible effect ANYWHERE today, not just in carousels
**What goes wrong:** Assuming the single-image path already has a working "textStyleIds → compositor font choice" mechanism that just needs to be copied into the carousel path.
**Why it happens:** `gemini.service.ts:256-267`'s `buildTextStyleCopyInstruction` explicitly states in its own body text: *"A deterministic server-side compositor renders text_blocks in a bundled font at fixed weights, so do NOT describe typography, lettering, font choice, or text placement anywhere in image_prompt."* `textStyleIds` today ONLY steers the TONE/WORD CHOICE of generated copy (via the `emphasisDirections`/`styleSummary` strings) — it has zero connection to `typography-compositor.service.ts`, which has exactly one font family (`Inter`, 3 static weights: Regular/SemiBold/Bold) registered via `FONT_ALIASES`/`ROLE_FONT_ALIAS` (`typography-compositor.service.ts:24-34`), hardcoded per TEXT ROLE (highlight/support/cta), with no per-textStyle branching logic at all.
**How to avoid:** Decide (this is Claude's technical discretion, not covered by an explicit CONTEXT.md field) what "font/style choice" can mean within a single-font-family, three-weight system: e.g. per-textStyle overrides of `ROLE_SIZE_RATIO`/letter-casing/line-height, driven by `textStylePromptHints` semantic content (already has `typography`/`layout`/`emphasis`/`avoid` string fields per style). Do NOT plan to bundle new font files this phase — that's excluded scope ("Per-user custom font uploads... Platform-curated font set only" from REQUIREMENTS.md's Out of Scope table, and no new-font-bundling work is mentioned anywhere in CONTEXT.md).
**Warning signs:** A plan that says "pass textStyleIds into compositeTypography and select a different GlobalFonts alias" without a concrete plan for WHICH new font files get bundled and how they pass the Phase 23 golden-image tofu/glyph-coverage CI gate (`scripts/verify-golden-image.ts`) is underspecified.

### Pitfall 3: Slide-1-as-style-anchor must stay pre-compositor/pre-logo
**What goes wrong:** Wiring the crop/compositor/logo pipeline into the loop in a way that overwrites `slide1Base64`/`slide1MimeType` with the POST-typography, POST-logo buffer.
**Why it happens:** The natural refactor is to insert the new pipeline steps right where `buffer` is reassigned, and it's easy to also update the anchor variables at the same point since they're set nearby (`carousel-generation.service.ts:571-572`).
**How to avoid:** Capture `slide1Base64`/`slide1MimeType` from the RAW AI-generated buffer (as today), before crop/compositor/logo run. Run the new pipeline on a separate buffer used only for THIS slide's upload.
**Warning signs:** Slides 2-N start showing baked-in text or logo artifacts that weren't in the actual slide-1 generation intent, or the edit model visibly tries to "match" text that shouldn't exist yet in the reference.

### Pitfall 4: Two incompatible structured-output dialects exist; don't cross-wire them
**What goes wrong:** Copy-pasting `PLANNING_JSON_SCHEMA` (OpenRouter's lowercase/`strict`/`additionalProperties:false` dialect) directly into a place that also needs `PLANNING_GEMINI_RESPONSE_SCHEMA`'s (direct-Gemini's UPPERCASE `Type` enum, no `additionalProperties`, `nullable: true`) dialect, or vice versa.
**Why it happens:** `planning-schema.service.ts`'s own header comment warns about this explicitly; the carousel's `callCarouselTextPlan` currently has a "direct" fallback branch (`carousel-generation.service.ts:300-332`) using raw `fetch()` to the Gemini API directly, alongside an "openrouter" branch (`256-298`) using `chatCompletion`.
**How to avoid:** If a new carousel JSON schema is introduced (Open Question 4), it needs BOTH dialects written out separately, exactly like `planning-schema.service.ts` does — or the phase should explicitly decide to keep the carousel's existing loose `json_object` transport with an extended MANUAL validator (`validateCarouselTextPlan`), which sidesteps the two-dialect problem entirely (recommended — see Standard Stack's Alternatives Considered).
**Warning signs:** A single JSON-schema object used identically for both `responseFormat.json_schema` (OpenRouter) and `generationConfig.responseSchema` (direct Gemini) call sites.

### Pitfall 5: Slide-edit endpoint is unaware of `base_image_url`/`typography_meta` — potential text double-render on edit
**What goes wrong:** After this phase ships, generated carousel slides will have real composited on-slide text. The EXISTING `/api/carousel/slide/edit` route (`carousel.routes.ts:595-1122`) still fetches `slide.image_url` (the FINAL, already-composited-with-text image) and sends it straight to `provider.edit()` with a prompt whose comment explicitly says *"no AI text verify/repair pass is applied to carousel slides... carousel slides (v1.1) do not use on-image text rendering (CRSL-10)"* (line 903-905) — that comment becomes STALE once this phase ships, because carousel slides WILL have on-image text after Phase 25.
**Why it happens:** CRSL2-01/02/04's stated success criteria (SC1-SC5 in ROADMAP.md) are all about GENERATION-time behavior; slide editing isn't explicitly mentioned as in-scope, but it shares the exact same class of problem Phase 23's `TYPO-07`/edit fidelity work solved for single images via `base_image_url`.
**How to avoid:** At minimum, add the additive `post_slides.base_image_url`/`typography_meta` columns (already planned) so a FUTURE phase can wire slide-editing the same way `edit.routes.ts` was wired in Phase 23. Explicitly decide and document whether THIS phase also updates `/api/carousel/slide/edit` to use `slide.base_image_url` when present (mirroring `edit.routes.ts`'s `resolveEditTarget` LEGACY-branch pattern) or explicitly defers it. See Open Question 3 — this is a real scope gap CONTEXT.md does not explicitly resolve.
**Warning signs:** A verification pass that only exercises the generation path and never re-runs slide edit after this phase ships would silently miss a text-mangling regression.

### Pitfall 6: `carouselRequestSchema` currently has NO `reference_images`/`use_brand_references` fields at all
**What goes wrong:** Assuming carousels already attach user/brand reference images somewhere and only need a THIRD (style-board) tier added.
**Why it happens:** `generate.routes.ts`'s `mergedReferenceImages` mechanism is single-image-only; `carouselRequestSchema` (`shared/schema.ts:1059-1071`) has no `reference_images` field, and neither `buildCarouselMasterPrompt` nor `generateSlideOne`/`generateSlideN` (`carousel-generation.service.ts:337-387`) pass any `referenceImages` to their respective AI calls today.
**How to avoid:** If style-board images are meant to reach carousel generation too (Open Question 1), this is NET-NEW reference-image plumbing for carousels, not a one-line extension of an existing merge — budget accordingly.
**Warning signs:** A plan that says "extend carousel's reference image merging" without first establishing that carousel reference image merging doesn't exist yet.

### Pitfall 7: `DEFAULT_STYLE_CATALOG` dense-content work is real copywriting, easy to underestimate
**What goes wrong:** Treating PLAN-05's "write dense content for all existing entries" as a trivial mechanical task delegable to a placeholder/lorem-ipsum pass.
**Why it happens:** 10 styles + 12 post_moods = 22 entries, each needing genuinely distinct, specific photography-type/lighting/negative-prompt content that must "verifiably appear in the prompt payload" per SC4 — generic filler would fail that verification criterion in spirit even if it technically populates the fields.
**How to avoid:** Budget real per-entry authoring time; consider drafting field-by-field (e.g., write all 10 `photography_type` values first, then all 10 `lighting` values) for consistency of voice/format across entries, rather than one entry fully at a time.
**Warning signs:** Entries whose new fields are near-duplicates of each other or of their existing `description` field (no new information added).

## Code Examples

### Current carousel master prompt (to be extended)
```typescript
// server/services/carousel-generation.service.ts:171-197
function buildCarouselMasterPrompt(params: CarouselGenerationParams): string {
    const { brand, postMood, aspectRatio, prompt, contentLanguage, slideCount } = params;
    return `You are an Art Director planning a ${slideCount}-slide Instagram carousel for ${brand.company_name}.

Brand: ${brand.company_name} (${brand.company_type})
Colors: ${formatBrandColors(brand)}
Mood: ${postMood}
Aspect ratio: ${aspectRatio}
User direction: ${prompt}
Language: ${contentLanguage}

Return ONLY valid JSON with this exact shape:
{
  "shared_style": "...",
  "slides": [
    { "slide_number": 1, "image_prompt": "..." }
  ],
  "caption": "..."
}
...`;
}
```

### Single-image style/mood resolution to mirror (`gemini.service.ts:560-566`)
```typescript
const brandStyle = styleCatalog.styles.find((item) => item.id === brand.mood);
const selectedPostMood = styleCatalog.post_moods.find((item) => item.id === postMood);
const brandStyleLabel = brandStyle?.label || brand.mood;
const brandStyleDesc = brandStyle?.description ? ` (${brandStyle.description})` : "";
const postMoodLabel = selectedPostMood?.label || postMood;
const postMoodDesc = selectedPostMood?.description ? ` (${selectedPostMood.description})` : "";
```

### Planning schema field descriptions to mirror for the new carousel per-slide fields (`planning-schema.service.ts:94-98`)
```typescript
const TEXT_BLOCKS_DESCRIPTION =
  "On-image text broken into at most 3 role-tagged blocks (highlight = main attention trigger, support = secondary line, cta = compact call to action). Emit an empty array when the image must stay text-free. Consumed by the server-side typography compositor — these blocks are composited server-side onto the image, NOT rendered by the image model.";
const LAYOUT_ARCHETYPE_DESCRIPTION =
  "Layout archetype the text_blocks copy should occupy once composited server-side: bottom_band (a band across the lower third), top_stack (stacked at the top), or centered_hero (centered over the focal point). Choose bottom_band when uncertain.";
```

### app_settings RLS — the exact inverted-ACL precedent for `style_reference_photos`
```sql
-- supabase/migrations/20260303000010_app_settings.sql
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_select" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "app_settings_update" ON public.app_settings FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
);
```

### Carousel model-tier upgrade (single-image precedent, `gemini.service.ts:790-793`)
```typescript
const isVideoPlanning = params.contentType === "video";
const model = isVideoPlanning
    ? (params.styleCatalog.ai_models?.text_generation || "gemini-2.5-flash")
    : (params.styleCatalog.ai_models?.planning || "gemini-2.5-pro");
```
Carousel's current (to be changed) equivalent (`carousel-generation.service.ts:270`):
```typescript
const textModel = params.styleCatalog.ai_models?.text_generation || TEXT_MODEL;
```

## State of the Art

| Old Approach (current carousel code) | Current Approach (already proven in single-image path) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `buildCarouselMasterPrompt` uses raw `postMood` ID string, ignores `styleCatalog` entirely | `buildContextPrompt` resolves `styleCatalog.styles`/`post_moods` to label+description | Phase 22 (single-image only) | Carousel prompts are strictly less informed than single-image prompts about the SAME style/mood selection |
| `callCarouselTextPlan` uses `ai_models.text_generation` (flash-tier), loose `json_object` | `generateText` uses `ai_models.planning` (pro-tier) + strict `json_schema` (PLAN-02/03) | Phase 22 (single-image only) | Carousel plans are more failure-prone (JSON-shape drift) and lower-fidelity model tier than single-image plans |
| Carousel slides: text-free forever (CRSL-10, v1.1 decision) | Single images: deterministic compositor renders real `text_blocks` (TYPO-01..07) | Phase 23 (single-image only) | This phase (CRSL2-01/02) is explicitly reversing CRSL-10 for carousels |
| `formatBrandColors`/`formatBrandColorsLabeled`: flat-joined, no proportion, `color_4` present but inert | New 60-30-10 named-color formula explicitly weighting `color_1`/`color_2`/`color_4` | This phase (PLAN-06) | `color_4` finally has real prompt-visible effect |
| Reference images: single-image path only (`generate.routes.ts`'s `mergedReferenceImages`) | N/A — carousels have never had ANY reference-image attachment | Phase 20 (v1.5, single-image only) | PLAN-07's style boards would be carousels' FIRST reference-image mechanism if extended there (Open Question 1) |

**Deprecated/outdated:**
- CRSL-10 ("no text rendering for carousels") is explicitly being reversed by CRSL2-01, per this phase's own boundary description.
- The slide-2..N edit prompt's current instruction to "Reference the visual style, color palette, lighting, and composition of the attached image" (`carousel-generation.service.ts:372`, emphasis on "composition") is the literal thing CRSL2-01 is countering — composition/framing must now be allowed to vary while color/lighting/style stay consistent.

### 60-30-10 / composition-variation prompt-engineering findings (brief, web-verified)

The 60-30-10 rule (60% dominant/neutral tone, 30% secondary, 10% accent) is a design convention, not an AI-specific technique, but multiple current sources agree AI image generators respond much better to **descriptive named colors and explicit relationships** than to raw hex codes or vague terms — e.g. "deep navy blue with warm gold accents" outperforms "#1a2b4c and #d4af37" or "professional colors." This supports building the 60-30-10 phrasing as a natural-language sentence naming each brand color's hex alongside a plain-English color-name approximation and its proportion role, rather than injecting bare hex strings with a percentage label.

For carousel hook/content/CTA framing variation: current social-content guidance for AI-generated carousels converges on the SAME shape CONTEXT.md already locked — slide 1 as a "hook" (bold claim/question/cliffhanger demanding the swipe), middle slides varying supporting detail, and a final CTA slide — while explicitly keeping brand colors/lighting/overall visual template constant across slides for cohesion. This validates the "vary composition_note, hold shared_style/layout_archetype_id constant" split CONTEXT.md already specifies; no additional research changed that design.

## Open Questions

1. **Does PLAN-07 (style reference boards) apply to carousel generation, or only to single-image generation?**
   - What we know: CONTEXT.md's "Integration Points" section lists only `gemini.service.ts`/`prompt-builder.service.ts` for the dense-art-direction/color work (single-image-scoped), and the research question about `mergedReferenceImages` explicitly targets `generate.routes.ts`. Carousels have NEVER had any reference-image mechanism (Pitfall 6).
   - What's unclear: ROADMAP SC5's phrasing ("attached to the image-generation call as style references when that style/mood is selected") is generic and doesn't explicitly exclude carousels; carousels DO have a style/mood selection (`post_mood` field in `carouselRequestSchema`).
   - Recommendation: Scope PLAN-07 to `generate.routes.ts` (single-image) as the primary/required deliverable, since that's where the merge mechanism and all three research anchors point. Treat carousel style-board attachment as a stretch goal only if time budget allows, given it requires building reference-image plumbing for carousels from scratch (not just adding a third tier to an existing merge).

2. **Does `style_reference_photos` need a public/any-authenticated-user SELECT policy at all, if only server-side admin-client code ever reads it for generation?**
   - What we know: `style-catalog.routes.ts`'s pattern always uses `createAdminSupabase()` (service-role, RLS-bypassing) for both public GET and admin PATCH — meaning RLS on `platform_settings` is largely moot for that table.
   - What's unclear: whether `style_reference_photos` will EVER be read via a user-scoped (RLS-respecting) Supabase client (e.g. if a future creator-UI feature displays the style board), or only ever via the admin client during generation.
   - Recommendation: Follow CONTEXT.md's explicit instruction (public/any-authenticated read RLS) regardless — it's a locked decision — but note that if generation-time reads always go through `createAdminSupabase()`, the public SELECT policy is a defense-in-depth/future-proofing measure, not a load-bearing one for this phase's actual data flow.

3. **Should `/api/carousel/slide/edit` be updated in this phase to be typography-aware (avoid double-rendering text on edit)?**
   - What we know: Pitfall 5 above documents the real regression risk — post-Phase-25 carousel slides will have real on-image text, but the edit endpoint's prompt-building comments still assert carousels are text-free.
   - What's unclear: CONTEXT.md's explicit "Deferred Ideas" section only lists contrast-aware logo overlay as deferred — it does not mention slide-edit typography-awareness at all, so it's ambiguous whether this was considered and implicitly deferred, or simply not considered.
   - Recommendation: At minimum, add the additive schema columns (`post_slides.base_image_url`/`typography_meta`) so this doesn't require a second migration later. Explicitly flag in the phase's own scope decision whether `/api/carousel/slide/edit` gets updated this phase or is deliberately left as a known follow-up (mirroring how Phase 23's `edit.routes.ts` LEGACY branch handled pre-migration posts) — do not let it be silently unaddressed.

4. **Should the carousel's text-plan call transport upgrade to strict `json_schema` (matching PLAN-02's single-image pattern), or keep the current loose `json_object` + manual validator?**
   - What we know: `chatCompletion()` (`ai-gateway.service.ts:121-123`) already supports `{ type: "json_schema"; json_schema: Record<string, unknown> }` as a `responseFormat` option — the gateway-level capability already exists. CRSL2-02's wording only requires the plan to "reuse/mirror this same shape," not necessarily the transport.
   - What's unclear: whether the added schema complexity (role/composition_note/text_blocks/layout_archetype_id per slide) increases malformed-JSON risk enough to justify the strict-schema upgrade's extra work (two dialects, mirroring `planning-schema.service.ts`'s dual-schema pattern).
   - Recommendation: Keep the existing `json_object` + extended `validateCarouselTextPlan()` manual-validation pattern for this phase (lower risk, smaller diff, and the "direct" Gemini fallback branch already exists and works with this transport) unless the planner has strong reason to invest in the dual-dialect strict-schema upgrade as well. Document this choice explicitly either way since PLAN-02-style reliability is a real, cited motivation elsewhere in this milestone.

## Environment Availability

No new external dependencies are introduced by this phase — all work reuses already-installed packages (`@napi-rs/canvas`, `sharp`, `zod`) and already-configured services (Supabase Postgres/Storage/RLS, the OpenRouter gateway, the existing `platform_settings`/`app_settings` tables). No environment probing is required; every dependency this phase touches was already verified operational by Phases 21-24's own verification harnesses (`scripts/verify-phase-21.ts` through `scripts/verify-phase-24.ts`, all currently green per `.planning/STATE.md`).

## Validation Architecture

This project does not use a conventional test runner (no jest/vitest/mocha in `package.json`). Its established convention (Phases 16, 18-24) is a bespoke, hand-written static-and-functional verification script per phase: `scripts/verify-phase-{N}.ts`, run via `npx tsx scripts/verify-phase-{N}.ts`, supporting a `--only=<tag-substring>` filter for fast iteration. Checks are grouped into `[bracketed-tag]` categories; each check is a `check(name, condition, detail)` call that either reads/greps source files (static) or `import()`s real exported functions and asserts on their actual return values (functional, "no-network" pattern — see `scripts/test-critic-reroll-logic.ts`, `scripts/test-aspect-crop.ts`, `scripts/test-planning-schema-classification.ts` for the pure-logic-import style). A final `[svc-cross-plan]` tag (added late in every recent phase: 23, 24) asserts invariants spanning multiple plans' files plus a `spawnSync`-based non-regression sweep against every prior phase's own verify script.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom TypeScript verification harness (no jest/vitest) |
| Config file | none — each `scripts/verify-phase-{N}.ts` is self-contained |
| Quick run command | `npx tsx scripts/verify-phase-25.ts --only=<tag>` |
| Full suite command | `npx tsx scripts/verify-phase-25.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRSL2-01 | `role` assigned deterministically (hook/content/cta); `composition_note` present and varies per slide | functional (no-network, import `validateCarouselTextPlan`/plan-postprocessing with a fixture plan object) | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-narrative` | ❌ Wave 0 |
| CRSL2-02 | Per-slide crop→compositor→logo pipeline present in the exact order; `layout_archetype_id` applied identically across all slides | static (grep for call-site ordering, mirrors `verify-phase-23.ts`'s pipeline-order cross-plan check) | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-compositor` | ❌ Wave 0 |
| CRSL2-04 | `textStyleIds` reaches the compositor/prompt; `use_logo`/`logo_position` still apply per slide (regression, not new) | static + functional | `npx tsx scripts/verify-phase-25.ts --only=svc-carousel-textstyle-logo` | ❌ Wave 0 |
| PLAN-05 | New art-direction fields present on `brandStyleSchema`/`postMoodSchema`; ALL `DEFAULT_STYLE_CATALOG` entries populated (non-empty, non-duplicate-of-description) | functional (import `DEFAULT_STYLE_CATALOG`, iterate + assert) | `npx tsx scripts/verify-phase-25.ts --only=svc-aesthetic-dna-catalog` | ❌ Wave 0 |
| PLAN-06 | 60-30-10 formula present, explicitly references `color_4`, degrades when `color_4`/`color_3` null | functional (import the new color-formatting function, call with fixture brands) | `npx tsx scripts/verify-phase-25.ts --only=svc-color-proportion` | ❌ Wave 0 |
| PLAN-07 | `style_reference_photos` table/RLS/routes exist; reference-image priority order (user > brand > style board) is correct within the 4-slot cap | static (migration/RLS grep) + functional (priority-merge logic with fixture data) | `npx tsx scripts/verify-phase-25.ts --only=svc-style-reference-boards` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsx scripts/verify-phase-25.ts --only=<this-task's-tag>`
- **Per wave merge:** `npx tsx scripts/verify-phase-25.ts` (full suite) + `npm run check`
- **Phase gate:** Full suite green, plus a `spawnSync` non-regression sweep against `verify-phase-21.ts`/`verify-phase-21.1.ts`/`verify-phase-22.ts`/`verify-phase-23.ts`/`verify-phase-24.ts` (mirrors the `[svc-cross-plan]` pattern from Phases 23/24), before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `scripts/verify-phase-25.ts` — the phase-gate harness itself does not exist yet; Wave 0 must create it (mirrors `verify-phase-24.ts`'s Plan-01 origin) with all tags initially red, describing not-yet-written artifacts.
- [ ] A no-network fixture-based test for the `role`/`composition_note` deterministic-assignment + "meaningful variation" check (SC2's automated inter-slide composition-similarity check) — likely `scripts/test-carousel-narrative-plan.ts`, mirroring `scripts/test-critic-reroll-logic.ts`'s pure-logic-import style.
- [ ] A no-network fixture-based test for the reference-image priority-merge arithmetic (PLAN-07), mirroring `scripts/test-aspect-crop.ts`'s style — needs the merge logic extracted into a testable pure function rather than left inline in `generate.routes.ts`.

## Sources

### Primary (HIGH confidence — direct codebase reads)
- `server/services/carousel-generation.service.ts` (732 lines, read in full)
- `server/routes/carousel.routes.ts` (1125 lines, read in full)
- `shared/schema.ts` (1591 lines; read lines 1-260, 260-700, 1000-1135 covering brand/style/mood/text-style/typography/generation-params/post/post-slide/carousel-request/edit-slide-request schemas)
- `server/services/typography-compositor.service.ts` (read font-registration, `resolveTextBlocks`, `compositeTypography` sections in full)
- `server/services/image-crop.service.ts` (125 lines, read in full)
- `server/services/planning-schema.service.ts` (465 lines, read in full)
- `server/services/prompt-builder.service.ts` (289 lines, read in full)
- `server/services/gemini.service.ts` (read lines 100-1083 partial, covering `GenerateParams`, `getSelectedTextStyles`, `buildContextPrompt`, `buildNegativeSpaceInstruction`, `buildTextFidelityInstruction`, `buildTextStyleCopyInstruction`, `buildDefaultCreativePlan`, `generateText`)
- `server/services/image-optimization.service.ts` (read `processImageWithThumbnail`/`applyLogoOverlay` sections)
- `server/services/image-provider.ts` (read `ReferenceImage`/`ImageGenerationInput`/`ImageEditInput`/`GeminiImageProvider` sections)
- `server/routes/generate.routes.ts` (read reference-image merge block + crop/compositor/logo pipeline block)
- `server/routes/brand-references.routes.ts` (207 lines, read in full)
- `server/routes/style-catalog.routes.ts` (86 lines, read in full)
- `supabase/migrations/20260516000000_brand_style_references.sql` (read in full)
- `supabase/migrations/20260728000000_posts_base_image_typography_generation_params.sql` (read in full)
- `supabase/migrations/20260518000000_post_slide_versions.sql` (read in full)
- `supabase/migrations/20260421000000_v1_1_schema_foundation.sql` (`post_slides` table creation section)
- `supabase/migrations/20260303000010_app_settings.sql` (read in full — the inverted-ACL RLS precedent)
- `client/src/components/admin/post-creation/brand-styles-card.tsx` (306 lines, read in full)
- `client/src/components/admin/post-creation/sceneries-card.tsx` (471 lines, read in full)
- `client/src/components/admin/post-creation/text-styles-card.tsx` (read first 120 lines, CSV-array editing pattern)
- `client/src/components/admin/post-creation-tab.tsx` (107 lines, read in full)
- `server/services/ai-gateway-settings.service.ts` (`CallClass`/`FallbackCallClass` type definitions)
- `server/services/ai-gateway.service.ts` (`ChatCompletionParams.responseFormat` type)
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` (progress/traceability context), `.planning/phases/25-narrative-carousels-and-aesthetic-dna/25-CONTEXT.md`

### Secondary (MEDIUM confidence — web search, verified against multiple sources)
- 60-30-10 color rule + AI image-generation named-color guidance: cross-referenced across [Toolify](https://www.toolify.ai/ai-news/master-the-603010-color-rule-33679), [Coloracci](https://coloracci.ai/blog/color-proportions-60-30-10-rule), and [ZSky AI's color palette guide](https://zsky.ai/blog/ai-color-palette-guide) — consistent agreement that named/descriptive colors outperform hex codes for AI image models.
- Carousel hook/content/CTA narrative structure conventions: cross-referenced across [MindStudio](https://www.mindstudio.ai/blog/ai-image-generation-social-media-content) and [Promptslove's Instagram carousel prompt](https://promptslove.com/prompts/instagram-carousel-post-creator-chatgpt-prompt/) — consistent with CONTEXT.md's already-locked hook/content/CTA + consistent-style/varied-framing design.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all reused APIs read directly from source with exact line numbers.
- Architecture: HIGH — every integration point named in the phase brief was located and read; exact current vs. target shapes documented with line-precise citations.
- Pitfalls: HIGH for codebase-internal findings (font limitation, missing reference-image plumbing, missing style resolution, stale edit-path comments — all directly observed in source); MEDIUM for the prompt-engineering/copywriting guidance (web-sourced, but the phase brief itself already characterizes this domain as "more of a copywriting/prompt-engineering question than a technical one").

**Research date:** 2026-07-28
**Valid until:** No external-library version drift risk (nothing new installed). Internal-codebase findings remain valid until another phase touches the same files (`carousel-generation.service.ts`, `gemini.service.ts`, `typography-compositor.service.ts`, `shared/schema.ts`) — recommend re-verifying line numbers if planning is delayed more than a few completed plans after this research.
