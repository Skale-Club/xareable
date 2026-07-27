# Phase 23: Deterministic Typography & Edit Fidelity - Research

**Researched:** 2026-07-27
**Domain:** Server-side raster typography compositing (Node native canvas + Skia), deterministic image post-processing (sharp), Docker/Alpine font packaging, edit-pipeline data-fidelity persistence
**Confidence:** MEDIUM-HIGH (stack choice and existing-codebase integration points are HIGH confidence — read directly from source; a few musl/Docker runtime specifics are MEDIUM/LOW and flagged explicitly below)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Compositor & Layout Archetypes (TYPO-01, TYPO-02, TYPO-03)**
- Single bundled font family (e.g. Inter — full pt-BR/es Latin Extended glyph coverage, permissive license, multiple weights) used across headline/support/CTA, differentiated by weight/size rather than requiring multiple font families.
- Exact positioning/sizing specs for the 3 layout archetypes (bottom band w/ scrim, top stack, centered hero) and per-format safe-zone margins (incl. IG 4:5 grid-crop) are Claude's technical discretion, informed by research — no specific pixel values mandated here.
- The image-generation prompt (built from Phase 22's `text_blocks`/`layout_archetype_id` schema fields) must explicitly instruct the model to leave blank/negative space in the target text region matching the chosen archetype — this is new prompt-engineering work building on Phase 22's forward-compat schema fields.
- Contrast/scrim algorithm: sample target-region stats via `sharp` (e.g. average luminance/color), apply an automatic semi-transparent scrim/plate behind text when contrast is insufficient (WCAG-inspired threshold) — exact algorithm and threshold are Claude's discretion, but must be deterministic and covered by the golden-image test.

**Font Bundling & CI Golden-Image Test (TYPO-04)**
- Font files are committed directly into the repo (e.g. `server/assets/fonts/`), not downloaded at Docker build time — deterministic, no network dependency, controlled license footprint.
- `fontconfig` + `fc-cache` installed via `apk` in the Alpine-based Dockerfile (standard package addition) — exact Dockerfile diff is Claude's discretion.
- A CI golden-image test renders sample pt-BR/es text (accented characters — á, ç, ñ, etc.) at build time and fails the build if missing-glyph/tofu boxes are detected — exact test mechanism (pixel-diff, glyph-presence check, or similar) is Claude's discretion.

**Base Image Persistence & Edit Fidelity (TYPO-05, TYPO-06, TYPO-07)**
- New additive columns: `posts.base_image_url` (the raw AI output, post-crop, pre-typography/pre-logo) and `posts.typography_meta` (JSONB: layout archetype, text blocks, fonts used).
- `post_versions` gains the equivalent per-version columns (`base_image_url`, `typography_meta`) — consistent with the existing versioning pattern.
- Edit flow is rewritten: fetch and edit `base_image_url` (not the flattened `image_url`) via the AI image model, then re-run the crop → compositor (typography + logo) pipeline on the freshly-edited base, persisting both a new `base_image_url` and the new final `image_url` as a new version.
- The AI-rendered-text verify/repair loop (`verifyExactImageText`/`enforceExactImageText` in `text-rendering.service.ts`, plus their `generation_logs` observability calls) is removed entirely — the compositor guarantees correct text deterministically (TYPO-06).
- Backward compatibility: existing posts created before this migration have `base_image_url = NULL`. Editing such a post falls back to the legacy behavior (operates on `image_url` directly, no typography re-composite) — no backfill migration, no lockout. New posts get full base-image fidelity from day one.

**Aspect Ratio Crop & Generation Params Persistence (POL-04, POL-05)**
- Deterministic center-crop to the exact requested aspect ratio via `sharp` (`fit: cover`-equivalent, computed crop box) applied to the raw AI output, BEFORE typography/logo compositing runs.
- New additive `posts.generation_params` JSONB column (aspect_ratio, resolution, content options like `use_logo`/`logo_position`/`text_mode`) persisted at generation time.
- Edit/remake flows read and reuse `generation_params` instead of guessing/regex-parsing the stored prompt text (this replaces the existing `recoverVideoAspectRatioFromPrompt` regex hack and quick-remake's generic-default synthesis found in `edit.routes.ts`).
- Remake/quick-remake UI (`post-viewer-dialog.tsx`, `post-edit-dialog.tsx`) pre-fills from persisted `generation_params` using the aspect-ratio/logo-position controls that already exist in `post-creator-dialog.tsx`, instead of generic defaults — this is UI wiring to existing controls, not new UI design.

### Claude's Discretion
- Exact layout-archetype pixel/percentage specs and safe-zone margins.
- Exact contrast/scrim algorithm and threshold.
- Exact golden-image CI test mechanism.
- Exact Dockerfile fontconfig setup.
- Exact `typography_meta`/`generation_params` JSONB shapes (informed by Phase 22's existing `text_blocks`/`layout_archetype_id` schema).

### Deferred Ideas (OUT OF SCOPE)
- Contrast-aware adaptive logo overlay color/treatment — explicitly Phase 26's scope ("Fixes & Polish"), not this phase. This phase's logo overlay stays purely positional as it is today.
- Backfilling `base_image_url`/`generation_params` for existing posts — explicitly out of scope; old posts keep working via the legacy edit fallback.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TYPO-01 | Generated images are text-free by prompt design, with negative space reserved for the chosen layout archetype | `gemini.service.ts` prompt inversion required — see Architecture Pattern 1 and Pitfall 6. Phase 22 already added generic negative-space language (task 4); this phase must make it archetype-specific and remove the current literal "render this text" instructions. |
| TYPO-02 | Typography compositor service (`@napi-rs/canvas`) renders `text_blocks` with real bundled fonts using layout archetypes and per-format safe zones | Standard Stack + Architecture Pattern 1/2 (font registration, canvas draw loop, word-wrap, archetype geometry). `TextBlock`/`LayoutArchetypeId` shapes read directly from `shared/schema.ts` and `planning-schema.service.ts`. |
| TYPO-03 | Text contrast guaranteed via `sharp` region stats + automatic scrim | Architecture Pattern 3 (contrast/scrim algorithm) + Code Examples. |
| TYPO-04 | Fonts bundled in Docker image with fontconfig; CI golden-image test fails build on tofu/missing glyphs | Standard Stack (Inter, SIL OFL 1.1), Pitfalls 2-3 (Alpine font-rendering failure modes with real GitHub issue evidence), Validation Architecture section. |
| TYPO-05 | Posts persist `base_image_url` + `typography_meta` | Architecture Pattern 4 (migration shape), read directly from `posts`/`post_versions` current schema. |
| TYPO-06 | Exact-text verify/repair loop removed entirely | Confirmed exact deletion targets: `text-rendering.service.ts` (whole file), its 2 call sites in `generate.routes.ts` (`enforceExactImageText`) and `edit.routes.ts`, `logTextVerification` in `observability.service.ts`. `generation_logs.event_kind` is unconstrained TEXT — zero migration needed (Pitfall 8). |
| TYPO-07 | Single-image edit flow edits the base image, re-applies typography, no double-rendered text | Architecture Pattern 4 + Pitfall 11 (legacy-post branch). |
| POL-04 | Post-generation crop normalizes to exact requested aspect ratio before compositing | Architecture Pattern 5 (generic `W:H` parser, not the incomplete `ASPECT_RATIO_DIMENSIONS` lookup) + confirmed root cause (`toGeminiAspectRatio` coercion in `image-generation.service.ts`). |
| POL-05 | Generation parameters persisted for faithful edit/remake | Architecture Pattern 4 + Open Questions 4-6 (text_mode semantic shift, UI wiring target). |
</phase_requirements>

## Summary

Phase 23 replaces AI-rendered on-image text with a deterministic server-side compositor. The image model is instructed to produce a text-free photo with reserved negative space; a new Node service using `@napi-rs/canvas` (a Rust/Skia-backed canvas library with real prebuilt binaries for `linux-x64-musl`, i.e. genuine Alpine support) then draws the `text_blocks` Phase 22 already emits (`highlight`/`support`/`cta`, plus `layout_archetype_id` — `bottom_band`/`top_stack`/`centered_hero`) onto the image using one bundled font family (Inter, SIL OFL 1.1) at different weights/sizes per role. `sharp` (already a dependency) analyzes the target text region's luminance and applies an automatic scrim when contrast is insufficient, and also performs a new deterministic center-crop to the exact requested aspect ratio before compositing — closing a real, confirmed gap where `toGeminiAspectRatio()` silently coerces unsupported ratios (e.g. `1200:628`) to a substitute before generation, with nothing today cropping the result back to what the user actually requested.

The riskiest technical unknown is not the API surface (well-documented, actively maintained, current version 1.0.2) but the Alpine/musl runtime story: `@napi-rs/canvas` has a real history of Alpine-specific failure modes — a 2023 issue where fonts registered from a non-local-path silently failed to render text with zero error (`GlobalFonts.registerFromPath` needs a genuine filesystem path, not a URL), a "Create skia surface failed" crash fixed by installing `fontconfig`, and — most concerning — a still-open 2025/2026 issue where the musl build crashes with `Illegal instruction` on non-AVX x86_64 CPUs since v0.1.78. None of these are theoretical: they are real, dated GitHub issues on the exact library this phase adopts. The CONTEXT.md-mandated CI golden-image test is the correct mitigation for the first two; the AVX risk should be resolved by a cheap runtime smoke check (`node -e "require('@napi-rs/canvas')"`) validated against the actual Coolify/Hetzner host, which this research pass could not verify directly (Windows dev sandbox, no access to the production container).

The base-image/edit-fidelity rework (TYPO-05..07, POL-04/05) is a well-scoped, additive-migration change that follows the project's own established conventions exactly: new nullable columns on `posts`/`post_versions`, a legacy fallback branch for `base_image_url IS NULL`, and reading persisted `generation_params` instead of the existing `recoverVideoAspectRatioFromPrompt` regex hack in `edit.routes.ts`. The genuinely open design question the planner must resolve explicitly is what happens to `post-edit-dialog.tsx`'s existing `text_mode: keep/improve/replace/remove` picker (an AI-image-text-edit concept) now that text is server-composited and edits operate on a pre-typography base image — CONTEXT.md flags this as unresolved, and this research confirms it is a real reconciliation, not a formality.

**Primary recommendation:** Adopt `@napi-rs/canvas` 1.0.2 exactly as CONTEXT.md specifies, bundle Inter v4.1 (SIL OFL 1.1) as 3 static weight files registered under **per-weight aliases** (not one shared family alias relying on bold-keyword matching, which is unverified for this library), add `fontconfig` to the Alpine Dockerfile, and treat the CONTEXT.md-mandated golden-image test as double duty: it is simultaneously the font/glyph-coverage guard AND the cheapest available smoke test for the AVX-crash and Alpine-rendering risks documented below.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@napi-rs/canvas` | 1.0.2 (verified via `npm view`, published ~3 weeks before this research date — actively maintained) | Server-side Canvas 2D API (Skia-backed) for drawing text + shapes over the base image | Rust/napi-rs bindings, zero node-gyp/build step, ships a genuine prebuilt `@napi-rs/canvas-linux-x64-musl` binary (confirmed via `npm view @napi-rs/canvas-linux-x64-musl`) — the only mainstream Node canvas library with real Alpine/musl prebuilts. `node-canvas` (Cairo-based) requires native build toolchains and system Cairo/Pango on Alpine; `skia-canvas` (samizdatco) documents a glibc >= 2.18 requirement with no confirmed musl prebuilt. CONTEXT.md already locks this choice; research confirms it is the correct pick for this stack. |
| `sharp` | `^0.34.5` pinned in `package.json` (registry latest: `0.35.3`) | Region-stats contrast analysis (`.extract().stats()`), deterministic center-crop, existing logo overlay + final WebP optimize | Already the project's only image-processing dependency (Alpine-compatible prebuilt binary already proven in production — see Dockerfile `libc6-compat` note). No new dependency needed for crop/contrast work. |
| Inter (font) | v4.1 (Nov 2024 release, `rsms/inter` GitHub) | Bundled typography — headline/support/CTA, full pt-BR/es Latin Extended glyph coverage | SIL Open Font License 1.1 (confirmed via GitHub `CONTRIBUTING.md` + Wikipedia cross-reference) — free commercial redistribution, no attribution requirement in-product. Matches CONTEXT.md's example choice. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fontconfig` (Alpine `apk` package) | Alpine's current `edge`/`main` repo version (no pinning needed — `apk add --no-cache fontconfig`) | System font-matching library some Skia code paths and error modes depend on | Add to the Dockerfile's `base`/`runner` stage. A real, documented `@napi-rs/canvas` Docker failure ("Create skia surface failed") was fixed exactly this way (see Sources). |
| `ttf-dejavu` or similar system font pack (optional) | N/A | Fallback system glyphs if `GlobalFonts.registerFromPath`-registered fonts ever miss a glyph | NOT required if Inter's glyph coverage is verified sufficient for pt-BR/es via the golden-image test (task description already scopes this in); skip unless the golden-image test finds a gap. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@napi-rs/canvas` | `node-canvas` (Cairo) | Requires system Cairo/Pango/libjpeg native deps and a build step on Alpine (node-gyp); historically fragile in minimal Alpine images. Rejected — CONTEXT.md already locks `@napi-rs/canvas`, and this research confirms it's the better Alpine fit anyway. |
| `@napi-rs/canvas` | `skia-canvas` (samizdatco) | Explicitly documents a glibc >= 2.18 requirement; no confirmed musl-native prebuilt package on npm (unlike `@napi-rs/canvas-linux-x64-musl`, which genuinely exists). Higher Alpine risk, not lower. |
| Bundled static Inter weights | Inter Variable font (single `.ttf` with a weight axis) | Canvas 2D's `ctx.font` shorthand has no standard way to select a variable-font axis instance (no `font-variation-settings` equivalent documented for `@napi-rs/canvas`). Static per-weight files registered under distinct aliases sidestep this entirely — safer, verified pattern. |
| Deterministic crop via `sharp` | Requesting a "closer" native aspect ratio from the image model and accepting the mismatch | Already the status quo and exactly the bug POL-04 fixes — `toGeminiAspectRatio()` silently substitutes `16:9` for `1200:628` today, and nothing crops it back. Not acceptable per explicit success criteria. |

**Installation:**
```bash
npm install @napi-rs/canvas
# Font files added directly to the repo (server/assets/fonts/), NOT an npm package —
# per CONTEXT.md, fonts are committed, not downloaded at build/runtime.
```

**Version verification:** Run before finalizing the plan's dependency pin:
```bash
npm view @napi-rs/canvas version        # 1.0.2 at research time
npm view @napi-rs/canvas-linux-x64-musl version   # confirm musl binary version matches
npm view sharp version                  # 0.35.3 at research time (package.json has ^0.34.5 — no action required)
```

## Architecture Patterns

### Recommended Project Structure
```
server/
  assets/
    fonts/
      Inter-Regular.ttf     # 400 weight — support/body text
      Inter-SemiBold.ttf    # 600 weight — subtext/secondary
      Inter-Bold.ttf        # 700 weight — highlight/headline
  services/
    typography-compositor.service.ts   # NEW — font registration, layout archetypes,
                                        # text-block drawing, word-wrap, contrast/scrim
    image-crop.service.ts              # NEW (or fold into image-optimization.service.ts) —
                                        # deterministic center-crop to exact aspect ratio
    image-optimization.service.ts      # EXISTING — applyLogoOverlay, processImageWithThumbnail
                                        # (unchanged signatures; compositor output feeds in)
    text-rendering.service.ts          # DELETED (TYPO-06) — verifyExactImageText /
                                        # enforceExactImageText removed entirely
  routes/
    generate.routes.ts   # crop → compositor (typography) → logo overlay → optimize
    edit.routes.ts        # fetch base_image_url (not image_url) → AI edit → crop →
                           # compositor → logo overlay → optimize → persist new
                           # base_image_url + image_url as a new version
supabase/migrations/
  {TIMESTAMP}_posts_base_image_and_typography.sql   # additive: posts.base_image_url,
                                                     # posts.typography_meta, posts.generation_params
  {TIMESTAMP}_post_versions_base_image_and_typography.sql  # additive: same 2 columns on post_versions
```

### Pattern 1: Text-Free Prompt Inversion (TYPO-01)

**What:** `gemini.service.ts`'s `buildTextModeInstruction()` currently instructs the **image** model to literally render exact/guided text ("CRITICAL: Render these on-image text blocks EXACTLY as provided..."). This function's output flows into `buildContextPrompt()`'s task 4, which the planning model then bakes into its authoritative `image_prompt` (per Phase 22's PLAN-04 precedence rules, `image_prompt` — not the structured JSON — is what the image model actually sees).

**When to use:** Any time `useText` is true. Today `buildTextModeInstruction` branches on `text_mode` (`auto`/`guided`/`exact`) to decide HOW LITERALLY the AI-rendered text must match the request. Post-Phase-23, the image model must **never** render text — `text_mode` instead governs how literally the **planning call** preserves user wording when composing `text_blocks` (already partially true — Phase 22's task 5 already writes `text_blocks` independent of image rendering). The image-facing instruction must invert to describe the **negative space** the archetype requires, informed by `layout_archetype_id`:
- `bottom_band`: "leave the lower third of the frame visually calm/darker, suitable for a text overlay band"
- `top_stack`: "leave the upper portion of the frame open and uncluttered"
- `centered_hero`: "leave clear negative space near the composition's focal point"

**Example:**
```typescript
// server/services/gemini.service.ts — buildTextModeInstruction (INVERTED)
// Source: this repo, server/services/gemini.service.ts:198-231 (current, AI-renders-text version)
// Phase 23 must replace the "Render these on-image text blocks EXACTLY..." branch with
// an always-text-free instruction keyed on layout_archetype_id, e.g.:
private buildNegativeSpaceInstruction(params: GenerateParams, archetypeId: LayoutArchetypeId): string {
  if (!params.useText) {
    return "CRITICAL: Do not place any visible headline, subtext, price, CTA, or typographic copy inside the image. Keep the image fully text-free.";
  }
  const zoneByArchetype: Record<LayoutArchetypeId, string> = {
    bottom_band: "the lower third of the frame calm, uncluttered, and suitable for a text overlay band",
    top_stack: "the upper portion of the frame open and visually simple",
    centered_hero: "clear negative space near the main focal point",
  };
  return `CRITICAL: Do NOT render any text, letters, numbers, or typographic marks anywhere in the image — all on-image copy will be added by a separate deterministic compositing step after generation. Keep ${zoneByArchetype[archetypeId]} so that text can be legibly overlaid later.`;
}
```

### Pattern 2: Font Registration + Layout-Archetype Draw Loop (TYPO-02)

**What:** Register fonts once at module load (not per-request) using `GlobalFonts.registerFromPath` with an absolute, resolved local path (see Pitfall 2 — a remote URL silently fails). Then, per generation, create a canvas the size of the (already-cropped) base image, draw the base image, then draw each `text_blocks` entry per its role using the archetype's geometry.

**When to use:** Every non-video generation/edit where `useText` is true.

**Example:**
```typescript
// server/services/typography-compositor.service.ts
// Source: @napi-rs/canvas README (Brooooooklyn/canvas) — GlobalFonts.registerFromPath /
// createCanvas / loadImage / ctx.font / ctx.fillText / canvas.encode API confirmed live
// via GitHub README fetch (2026-07-27) and via `require('@napi-rs/canvas')` module dump
// captured in Brooooooklyn/canvas#1117.
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import path from "node:path";

// Register ONCE per process. Use per-weight ALIASES (see Pitfall 5) — do not rely on
// `ctx.font = "bold ..."` weight-keyword matching against a single shared family alias.
const FONT_DIR = path.resolve(process.cwd(), "server/assets/fonts");
GlobalFonts.registerFromPath(path.join(FONT_DIR, "Inter-Regular.ttf"), "Inter-Regular");
GlobalFonts.registerFromPath(path.join(FONT_DIR, "Inter-SemiBold.ttf"), "Inter-SemiBold");
GlobalFonts.registerFromPath(path.join(FONT_DIR, "Inter-Bold.ttf"), "Inter-Bold");

const ROLE_FONT_ALIAS: Record<"highlight" | "support" | "cta", string> = {
  highlight: "Inter-Bold",
  support: "Inter-Regular",
  cta: "Inter-SemiBold",
};

export async function compositeTypography(params: {
  baseImageBuffer: Buffer;
  width: number;
  height: number;
  textBlocks: Array<{ role: "highlight" | "support" | "cta"; text: string }>;
  layoutArchetypeId: "bottom_band" | "top_stack" | "centered_hero";
}): Promise<Buffer> {
  const canvas = createCanvas(params.width, params.height);
  const ctx = canvas.getContext("2d");

  const baseImage = await loadImage(params.baseImageBuffer);
  ctx.drawImage(baseImage, 0, 0, params.width, params.height);

  // ... scrim drawing (Pattern 3) happens here, before text ...

  for (const block of params.textBlocks) {
    const fontSizePx = block.role === "highlight" ? Math.round(params.width * 0.07) : Math.round(params.width * 0.04);
    ctx.font = `${fontSizePx}px ${ROLE_FONT_ALIAS[block.role]}`;
    ctx.fillStyle = "#FFFFFF"; // resolved per Pattern 3's contrast check in the real impl
    // Canvas 2D has NO built-in word-wrap — hand-roll it via ctx.measureText per candidate line.
    const lines = wrapTextToWidth(ctx, block.text, params.width * 0.86 /* safe-zone width */);
    lines.forEach((line, i) => ctx.fillText(line, params.width * 0.07, /* archetype-derived y */ 0 + i * fontSizePx * 1.2));
  }

  return canvas.encode("png"); // lossless — avoid double lossy compression before sharp's WebP pass
}

function wrapTextToWidth(ctx: any, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
```

### Pattern 3: Contrast Analysis + Automatic Scrim (TYPO-03)

**What:** Before drawing text, extract the target text-region rectangle from the base image via `sharp`, compute its mean luminance, and if contrast against the intended text color is insufficient, composite a semi-transparent scrim rectangle first.

**Example:**
```typescript
// Source: sharp official API (.extract, .stats) — well-established, stable API surface.
import sharp from "sharp";

async function getRegionLuminance(baseBuffer: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<number> {
  const { channels } = await sharp(baseBuffer).extract(region).stats();
  // Standard relative-luminance weighting (sRGB, ITU-R BT.601-ish coefficients commonly
  // used for quick perceptual luminance — NOT the full WCAG relative-luminance formula,
  // which requires linearizing each channel; CONTEXT.md calls this "WCAG-inspired", not
  // a strict WCAG conformance requirement).
  const [r, g, b] = channels;
  return 0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean; // 0-255
}

// If luminance is mid-range (neither clearly light nor clearly dark), white text will
// have poor contrast against a light region and dark text will fail against a dark
// region — apply a scrim (e.g. rgba(0,0,0,0.35) behind white text) whenever luminance
// falls outside a safe band, e.g. luminance > 140 for white text.
```

### Pattern 4: Base-Image Persistence + Edit Rewiring (TYPO-05, TYPO-06, TYPO-07)

**What:** Migration + route changes, following the project's own additive-migration convention exactly (confirmed from `supabase/migrations/` naming: `{TIMESTAMP}_{description}.sql`, applied via the Supabase Dashboard SQL editor — this project does **not** use `drizzle db:push` for these; see `STATE.md` Phase 11 decision).

**Example migration (pattern matches `20260518000000_post_slide_versions.sql` and `20260305000012_posts_media_fields.sql` exactly):**
```sql
-- supabase/migrations/{TIMESTAMP}_posts_base_image_typography_generation_params.sql
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS base_image_url text,
  ADD COLUMN IF NOT EXISTS typography_meta jsonb,
  ADD COLUMN IF NOT EXISTS generation_params jsonb;

ALTER TABLE public.post_versions
  ADD COLUMN IF NOT EXISTS base_image_url text,
  ADD COLUMN IF NOT EXISTS typography_meta jsonb;
-- No generation_params on post_versions — CONTEXT.md scopes generation_params to the
-- posts table only ("Edit/remake flows read and reuse generation_params" from the
-- ORIGINAL post row, not a per-version copy); typography_meta IS per-version because
-- each edit re-runs the compositor and may pick a different archetype/text.
```

**Edit-route rewiring (`edit.routes.ts`):**
- Current (line ~274-286): reads `latestVersion?.image_url || post.image_url` as `currentMediaUrl`, fetches it, sends to `provider.edit()`.
- New: read `latestVersion?.base_image_url || post.base_image_url` as the edit target. **Legacy fallback (Pitfall 11):** if that resolves to `NULL` (pre-migration post), fall back to today's exact behavior (`image_url`, no re-composite) — CONTEXT.md explicitly forbids a backfill migration or lockout.
- After `provider.edit()` returns a new base image: run the SAME crop → compositor → logo-overlay → optimize pipeline used at generation time, then insert a `post_versions` row with both `base_image_url` (new) and `image_url` (new, final composited).
- `recoverVideoAspectRatioFromPrompt()` (line 40-43, regex on `ai_prompt_used`) is replaced by reading `post.generation_params?.aspect_ratio`, falling back to the regex only when `generation_params` is `NULL` (pre-migration posts).

### Pattern 5: Universal Aspect-Ratio Crop (POL-04)

**What:** `generateRequestSchema.aspect_ratio` accepts 15 distinct string values (`1:1`, `1:4`, `1:8`, `2:3`, `3:2`, `3:4`, `4:1`, `4:3`, `4:5`, `5:4`, `8:1`, `9:16`, `16:9`, `21:9`, `1200:628`). The existing `ASPECT_RATIO_DIMENSIONS` lookup in `prompt-builder.service.ts` covers only 6 of these and is not used for cropping anywhere today. `toGeminiAspectRatio()` (same file) only special-cases `1200:628` → `16:9` when calling the image model — every other unsupported ratio is passed through as-is, with no confirmation the underlying model actually honors it. **The crop step must therefore be generic** — parse the requested `"W:H"` string directly and compute a center-crop box against whatever the model actually returned, rather than relying on either lookup table.

**Example:**
```typescript
// Source: sharp official API (.metadata, .extract) — parse-then-crop is a standard sharp pattern.
async function cropToExactAspectRatio(buffer: Buffer, aspectRatio: string): Promise<Buffer> {
  const [wRatio, hRatio] = aspectRatio.split(":").map(Number);
  const targetRatio = wRatio / hRatio;
  const image = sharp(buffer);
  const { width = 0, height = 0 } = await image.metadata();
  if (!width || !height) return buffer;

  const currentRatio = width / height;
  let cropWidth = width;
  let cropHeight = height;
  if (currentRatio > targetRatio) {
    // source is relatively too wide — crop width
    cropWidth = Math.round(height * targetRatio);
  } else if (currentRatio < targetRatio) {
    // source is relatively too tall — crop height
    cropHeight = Math.round(width / targetRatio);
  }
  const left = Math.round((width - cropWidth) / 2);
  const top = Math.round((height - cropHeight) / 2);
  return image.extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer();
}
```

### Anti-Patterns to Avoid
- **Relying on `ctx.font = "bold 48px Inter"` weight-keyword matching against one shared family alias:** unverified for `@napi-rs/canvas` — register each weight under its own alias instead (Pattern 2, Pitfall 5).
- **Registering fonts from a remote URL passed to `GlobalFonts.registerFromPath`:** confirmed to silently fail (text never renders, no error thrown) in a real, if old, GitHub issue (Pitfall 2). Always resolve to a genuine local filesystem path baked into the Docker image.
- **Leaving the old "render this text exactly" instructions in `buildTextModeInstruction`/`buildTextHierarchyInstruction`:** would cause the image model to still attempt text rendering alongside the new compositor — directly causing the "double-rendered/ghosted text" failure mode TYPO-07's success criterion explicitly forbids.
- **A lookup-table approach to aspect-ratio cropping:** the existing `ASPECT_RATIO_DIMENSIONS` table only covers 6 of 15 accepted values and was never wired into any crop step — don't extend it; parse the ratio string generically (Pattern 5).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glyph rendering / font shaping | A custom bitmap-font renderer or SVG-text-to-path pipeline | `@napi-rs/canvas`'s `ctx.fillText` + `GlobalFonts` | Skia's text shaping handles pt-BR/es diacritics (á, ç, ñ, ã, õ) correctly out of the box once fonts are registered — reinventing this is exactly the class of bug the golden-image test exists to catch. |
| Relative luminance / contrast math | A hand-derived color-science formula | The standard perceptual-luminance weighting shown in Pattern 3 (or the full WCAG 2.x relative-luminance formula if stricter conformance is later desired) | CONTEXT.md explicitly calls the required rigor "WCAG-inspired" (not full conformance) — a well-known weighted-average formula is sufficient and avoids reinventing color science. |
| Deterministic image cropping | Manual pixel-buffer math | `sharp`'s `.extract()` | Already the project's only image-processing dependency; `.extract()` is the documented, stable crop API. |
| pt-BR/es glyph coverage verification | Manual eyeballing of screenshots per release | A scripted golden-image test (Pattern from Validation Architecture below) | The only way to make TYPO-04's "guarantee" real and repeatable in CI/Docker build, per CONTEXT.md's explicit mandate. |

**Key insight:** The two things genuinely worth hand-rolling in this phase are (1) the text-wrapping loop (Canvas 2D has no built-in word-wrap — this is normal, expected custom code, not a "don't hand-roll" violation) and (2) the golden-image test script itself (no off-the-shelf library does "render sample strings and assert no tofu boxes for this specific font/canvas combination" — it must be a small bespoke script, following this repo's existing `scripts/verify-phase-NN.ts` convention).

## Common Pitfalls

### Pitfall 1: `@napi-rs/canvas` musl build crashes with `Illegal instruction` on non-AVX CPUs
**What goes wrong:** `require('@napi-rs/canvas')` (or any use of it) crashes the Node process immediately with `Illegal instruction (core dumped)` on some x86_64 hosts.
**Why it happens:** A real, currently-**open** GitHub issue (Brooooooklyn/canvas#1117, filed Sep 2025, still receiving "same issue" comments as recently as Feb 2026) reports that the `linux-x64-musl` prebuilt binary stopped supporting non-AVX CPUs starting at v0.1.78, due to compiler flags used in the native build. Confirmed independently by 4 different users on different hosts (an Intel Atom C2338 VM, unspecified "old VM server", others).
**How to avoid:** Verify the actual Coolify/Hetzner production host's CPU supports AVX (virtually all Hetzner Cloud/dedicated x86_64 offerings do — AVX has been standard since ~2011 — but this research pass could not verify the specific instance directly). Add a cheap startup or CI smoke check: `node -e "require('@napi-rs/canvas')"` inside the Docker build or a post-deploy healthcheck. If it ever fails, there is currently no clean library-level fallback other than pinning to a pre-0.1.78 `@napi-rs/canvas` release (not recommended — loses current fixes) or switching the Docker base image away from Alpine for this dependency specifically.
**Warning signs:** Container crash-loops immediately on the first request that touches the compositor, with `Illegal instruction` in the container logs (not a JS exception — a hard native crash, may not even reach the app's error handlers).

### Pitfall 2: `GlobalFonts.registerFromPath` silently fails when given a remote URL instead of a local path
**What goes wrong:** Fonts appear registered (show up in `GlobalFonts.families`) but `ctx.fillText()` renders nothing — no error, no exception, just blank text while other canvas drawing (rectangles, images) works fine.
**Why it happens:** A confirmed 2023 issue (Brooooooklyn/canvas#731) shows a user passing a Firebase Storage **signed URL** as the "path" argument — the function almost certainly expects a genuine local filesystem path, not a URL, and fails silently rather than throwing.
**How to avoid:** This phase's design already avoids the failure mode entirely per CONTEXT.md (fonts committed into the repo, copied into the Docker image, registered from a resolved local path like `path.resolve(process.cwd(), "server/assets/fonts/Inter-Bold.ttf")`) — just don't deviate from that by trying to load fonts from Supabase Storage or any other remote source.
**Warning signs:** `GlobalFonts.families` lists the expected family names, but rendered text is blank/missing — the golden-image test (TYPO-04) will catch this class of bug directly.

### Pitfall 3: Missing `fontconfig` on Alpine causes "Create skia surface failed" or blank text
**What goes wrong:** Canvas creation or text rendering fails/crashes specifically in a minimal Alpine container, working fine locally (non-Alpine dev machine).
**Why it happens:** A confirmed, fixed GitHub issue (Brooooooklyn/canvas#826) shows this exact failure resolved by installing a `fontconfig` package (that specific report was on a Debian-family base using `apt-get install libfontconfig1`; the Alpine equivalent is `apk add --no-cache fontconfig`).
**How to avoid:** Add `fontconfig` to the Dockerfile's Alpine stage (CONTEXT.md already mandates this) and run `fc-cache` after copying any fonts. Confirm the golden-image test actually runs inside a container built from the real Dockerfile (or at minimum, the same Alpine base) — not just on a developer's local (non-Alpine) machine — or this pitfall won't be caught before production.
**Warning signs:** Works on `npm run dev` locally, fails only after `docker build` + run.

### Pitfall 4: Canvas 2D has no built-in word-wrap
**What goes wrong:** Long `text_blocks` entries overflow the archetype's safe-zone width or run off-canvas entirely.
**Why it happens:** `ctx.fillText()` draws a single line at the given coordinates with no wrapping; `@napi-rs/canvas`'s README does not document an automatic-wrap option (consistent with the standard HTML5 Canvas 2D API, which never had one either).
**How to avoid:** Hand-roll a greedy word-wrap using `ctx.measureText(candidateLine).width` against the archetype's safe-zone width (Pattern 2's `wrapTextToWidth` helper) before calling `fillText` per line.
**Warning signs:** Golden-image test or manual QA shows text clipped at the canvas edge.

### Pitfall 5: Font-weight matching within one shared family alias is unverified
**What goes wrong:** Registering `Inter-Regular.ttf` and `Inter-Bold.ttf` both under the alias `"Inter"` and expecting `ctx.font = "bold 48px Inter"` (or `"700 48px Inter"`) to pick the correct file may not work as expected — this specific behavior is not documented in the fetched README excerpt, and getting it wrong silently renders every role in the same weight.
**How to avoid:** Register each weight under its **own** distinct alias (`Inter-Regular`, `Inter-SemiBold`, `Inter-Bold`) and reference the alias directly per text role (Pattern 2) — sidesteps the ambiguity entirely with a verified-safe pattern.
**Warning signs:** All three text roles (highlight/support/CTA) render visually identical weight despite different font-size values being set correctly.

### Pitfall 6: Old AI-render text instructions left in place would double-render text
**What goes wrong:** If `buildTextModeInstruction`'s current "Render these on-image text blocks EXACTLY as provided" branch is not removed/inverted, the image model may still attempt to paint text into the image — which the compositor then draws OVER, producing garbled or duplicated text.
**Why it happens:** This instruction currently flows into the planning model's authoritative `image_prompt` (per Phase 22's PLAN-04 precedence fix) and is exactly what ends up in the prompt handed to the image model. It was written for the OLD (AI-renders-text) architecture and must be inverted for TYPO-01.
**How to avoid:** Explicitly grep for and replace every branch of `buildTextModeInstruction`/`buildTextHierarchyInstruction` that instructs the image model to render text; the new function must ALWAYS tell the image model to stay text-free (Pattern 1). Also check `buildLocalTextFallback()` and `buildDefaultCreativePlan()`'s `text_rendering` fields in `gemini.service.ts` — the local-fallback path builds a raw `image_prompt` string directly (not via an LLM) using these same instructions, and must be updated too.
**Warning signs:** TYPO-07's success criterion ("no double-rendered or ghosted text ever appears") fails during manual QA.

### Pitfall 7: Instagram's grid-crop safe zone may have changed
**What goes wrong:** Text/logo placed too close to the top/bottom (or, per newer reports, left/right) edge of a 4:5 post gets cut off when Instagram crops it for the profile grid preview.
**Why it happens:** Historically Instagram's grid center-cropped 4:5 posts down to 1:1 (cropping ~10% off the top and bottom). Several 2026-dated sources found in this research report Instagram shifted the grid preview to a 3:4 ratio in late 2025 instead — which, for a 4:5 source image, would crop from the **sides** rather than top/bottom (3:4 is a narrower width:height ratio than 4:5). Sources on this point are not fully consistent (MEDIUM confidence).
**How to avoid:** Design the 4:5 archetype safe zone conservatively — keep critical text/logo content within roughly the center 80-85% both horizontally and vertically, which survives either crop interpretation. Treat exact pixel margins as Claude's discretion per CONTEXT.md, informed by this range.
**Warning signs:** N/A directly testable in this codebase (Instagram-side behavior); document the assumption in code comments so it can be revisited if Instagram's grid behavior is confirmed to have changed further.

### Pitfall 8: `generation_logs.event_kind` is an unconstrained TEXT column
**What goes wrong:** Assuming removal of `logTextVerification` requires a companion migration (e.g. dropping an enum value).
**Why it happens:** N/A — this is a non-issue, but worth confirming explicitly so no unnecessary migration is planned.
**How to avoid:** `20260508000000_generation_logs_observability.sql` adds `event_kind` as plain `TEXT` with no `CHECK` constraint or enum type (confirmed by direct read) — deleting the `text_verification` emitter is pure code deletion. Historical rows with `event_kind = 'text_verification'` remain in the table (harmless, informational).
**Warning signs:** N/A.

### Pitfall 9: The 15-value aspect-ratio enum is broader than any existing lookup table
**What goes wrong:** Reusing `ASPECT_RATIO_DIMENSIONS` (in `prompt-builder.service.ts`) for the new crop step, assuming it's complete.
**Why it happens:** That table only has entries for 6 of the 15 values in `generateRequestSchema.aspect_ratio`'s enum (`1:1`, `4:5`, `9:16`, `16:9`, `2:3`, `1200:628`) and is not referenced by any crop logic today (confirmed via repo-wide grep — its only consumers are `toGeminiAspectRatio` callers, not a crop function).
**How to avoid:** Implement the crop step by parsing the `"W:H"` string directly (Pattern 5) rather than looking anything up.
**Warning signs:** Extreme ratios (`1:8`, `8:1`, `4:1`, `1:4`, `21:9`, `3:2`, `3:4`, `5:4`) silently fall through to a default and don't get cropped correctly.

### Pitfall 10: `text_styles` catalog hints have much less to act on with a single deterministic font
**What goes wrong:** The existing `text_styles` catalog (`bold-promo`, `modern-corporate`, `raw-brutalist`, etc.) expresses typography INTENT via `prompt_hints.typography/layout/emphasis/avoid` — these were written to steer an AI model's free-form text rendering. With one bundled font family differentiated only by weight/size, most of that intent has nowhere to go.
**Why it happens:** This catalog predates Phase 23's architecture change; Phase 25's `CRSL2-04` requirement ("text styles feed the compositor") confirms these hints ARE meant to keep influencing the compositor eventually (case treatment, letter-spacing, color, alignment) — just not necessarily fully in this phase.
**How to avoid:** Decide explicitly (this is a genuine open question, not resolved by CONTEXT.md) whether Phase 23's compositor accepts an optional `textStyleIds` parameter now (even if it only lightly uses it, e.g. all-caps for `bold-promo`) to avoid a breaking API change when Phase 25 wires it in fully, or whether it's explicitly out of scope this phase and Phase 25 adds the parameter fresh.
**Warning signs:** N/A directly — this is a design decision, not a bug.

### Pitfall 11: Legacy posts have `base_image_url = NULL`
**What goes wrong:** Edit route crashes or produces a broken result if it assumes `base_image_url` is always populated.
**Why it happens:** CONTEXT.md explicitly locks "no backfill migration" — every post created before this phase ships will have `base_image_url IS NULL` forever.
**How to avoid:** Explicit branch in the edit route: `const editTarget = latestVersion?.base_image_url ?? post.base_image_url ?? latestVersion?.image_url ?? post.image_url;` with a companion boolean tracking whether this is the base-image path (re-composite) or the legacy flattened-image path (no re-composite, exactly today's behavior).
**Warning signs:** Editing an old post throws, or silently double-applies typography onto an already-composited legacy image.

### Pitfall 12: `sharp` version drift
**What goes wrong:** Assuming a `sharp` API used in new region-analysis code (e.g. a `.stats()` option) is available, when the pinned `^0.34.5` resolves to something older than the registry's current `0.35.3`.
**How to avoid:** Run `npm ls sharp` at implementation time to confirm the resolved version; `.extract()` and `.stats()` are long-stable APIs present in both 0.34.x and 0.35.x, so this is a low-risk pitfall, but worth a 10-second check before relying on any newer option.
**Warning signs:** A `TypeError` on an unrecognized sharp option during implementation.

## Code Examples

Verified patterns from official sources — see Patterns 1-5 above for the fully worked examples (font registration, draw loop, word-wrap, contrast/luminance, universal aspect-ratio crop). All code shown is sourced from:
- `@napi-rs/canvas` README (`GlobalFonts.registerFromPath`, `createCanvas`, `loadImage`, `ctx.font`/`fillText`, `canvas.encode`) — fetched live 2026-07-27.
- `sharp`'s stable, long-established `.extract()`/`.stats()`/`.metadata()` API — HIGH confidence, no version-specific behavior relied upon.
- This repository's own `gemini.service.ts`, `image-optimization.service.ts`, `edit.routes.ts`, `generate.routes.ts`, and `supabase/migrations/*.sql` — read directly, not inferred.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Image model renders text directly; a separate Gemini vision call (`verifyExactImageText`) checks it, and up to 2 AI "repair" edit passes (`enforceExactImageText`) attempt to fix wrong/garbled text | Image model never renders text; a deterministic server-side compositor (`@napi-rs/canvas`) draws exact, correctly-spelled text every time | This phase (23) | Eliminates the entire verify/repair Gemini call chain (cost + latency win, exactly TYPO-06's intent) and eliminates "wrong/garbled AI text" as a failure mode entirely — replaced by ordinary raster-rendering concerns (contrast, wrapping, glyph coverage) which are fully deterministic and testable. |
| `toGeminiAspectRatio()` silently substitutes an unsupported ratio (e.g. `1200:628` → `16:9`) with nothing correcting the output afterward | A deterministic crop step normalizes the output to the exact requested ratio before any compositing | This phase (23, POL-04) | Closes a real, currently-shipping gap — non-native aspect ratios have never actually matched what users requested. |
| Edit/remake operates on the flattened, already-composited `image_url` and guesses aspect ratio via regex on the stored prompt text (`recoverVideoAspectRatioFromPrompt`) | Edit/remake operates on a persisted pre-typography `base_image_url` and reads structured `generation_params` | This phase (23, TYPO-05/07, POL-05) | Removes an entire class of "double-rendered text" and "wrong aspect ratio on remake" bugs; the regex hack is retained ONLY as the legacy-post fallback (Pitfall 11), not the primary path. |
| Instagram profile grid center-crops posts to 1:1 | Some 2026-dated sources report a shift to a 3:4 grid preview ratio in late 2025 | Reported late 2025 / uncertain, MEDIUM confidence, sources conflict | Affects exact safe-zone margin recommendations for the 4:5 archetype (Pitfall 7) — design conservatively for either interpretation. |

**Deprecated/outdated:**
- `text-rendering.service.ts` (`verifyExactImageText`, `enforceExactImageText`): deleted entirely per TYPO-06 — not deprecated-but-kept, fully removed.
- `recoverVideoAspectRatioFromPrompt()` in `edit.routes.ts`: demoted to a legacy-only fallback path (posts with `generation_params IS NULL`), no longer the primary path.

## Open Questions

1. **Does `@napi-rs/canvas`'s font-weight matching work correctly when multiple weight files share one family alias?**
   - What we know: The README documents `GlobalFonts.registerFromPath(path, alias)` with no weight parameter; the alias fully determines the family name used in `ctx.font`.
   - What's unclear: Whether registering 2+ files under the identical alias and relying on the `bold`/numeric-weight keyword in `ctx.font` correctly disambiguates them (not documented in the fetched README excerpt).
   - Recommendation: Sidestep entirely — register each weight under its own alias (Pattern 2). Revisit only if a future phase needs true CSS-style weight fallback behavior.

2. **Does the actual Coolify/Hetzner production host's CPU support AVX?**
   - What we know: A real, open GitHub issue (Brooooooklyn/canvas#1117) documents `Illegal instruction` crashes on non-AVX x86_64 hosts since `@napi-rs/canvas` v0.1.78; virtually all modern Hetzner Cloud/dedicated offerings support AVX (standard since ~2011).
   - What's unclear: This research pass ran in a Windows dev sandbox with no access to the actual production container/host to verify directly.
   - Recommendation: Add a build-time or deploy-time smoke check (`node -e "require('@napi-rs/canvas')"`) — cheap, catches this immediately rather than as a production crash-loop. Flag for operator verification alongside the phase's other checkpoint:human-verify items if one is warranted.

3. **Which of the 15 `aspect_ratio` enum values does the OpenRouter Image API / underlying image model actually natively support?**
   - What we know: `toGeminiAspectRatio()` only special-cases `1200:628`; everything else passes through unchanged, with no confirmation in this codebase of what the model does with e.g. `1:8` or `21:9`.
   - What's unclear: Whether extreme ratios get rejected, silently coerced by the provider, or genuinely honored.
   - Recommendation: Moot for output correctness once the universal crop step (Pattern 5) lands — but worth flagging to the planner as a prompt-engineering consideration: extreme ratios may waste more of the generated frame to cropping, so the archetype's negative-space instruction may need to account for a larger crop margin on those ratios.

4. **Does `text_mode` (`auto`/`guided`/`exact`) keep its current meaning post-Phase-23?**
   - What we know: Today it governs how literally the AI **image** model must render requested text.
   - What's unclear: Post-Phase-23, the image model never renders text — CONTEXT.md doesn't explicitly restate what `text_mode` means going forward.
   - Recommendation: Reframe `text_mode` as governing how literally the **planning call** preserves user wording when composing `text_blocks` (already substantially true today per Phase 22's task 5) — confirm this explicitly in the plan rather than leaving it implicit.

5. **How does `post-edit-dialog.tsx`'s `TextEditMode` (`keep`/`improve`/`replace`/`remove`) reconcile with server-side typography?**
   - What we know: This UI concept and its `edit_context.text_mode`/`replacement_text` fields were built for the AI-image-text-edit era (feeding `enforceExactImageText`'s repair prompt). CONTEXT.md explicitly flags this as needing reconciling, without resolving it.
   - What's unclear: Whether "replace text" on edit should now mean "re-run the compositor with new `text_blocks`" (fast, fully deterministic, no AI image call needed at all for a pure text change) or should still route through the AI image model for other simultaneous visual changes.
   - Recommendation: This is a genuine design decision for the planner, not something this research can resolve from the codebase alone — flag explicitly as a task requiring a decision, likely: text-only edits become a compositor-only fast path (re-crop is unnecessary, re-run compositor on the existing `base_image_url` with updated `text_blocks`), while any edit that also changes the AI-generated concept re-runs the full edit→crop→compositor pipeline.

6. **Where does the "remake UI pre-fills from persisted `generation_params`" wiring actually land?**
   - What we know: `post-creator-dialog.tsx` already has aspect-ratio/logo-position controls; the existing one-click "quick remake" flow (`post-viewer-dialog.tsx` → `quick-remake.ts` → `/api/edit-post`) has **no** intermediate dialog UI step at all today — it's fully automatic with no user-facing form.
   - What's unclear: Whether this phase adds a new pre-fill step to `post-edit-dialog.tsx` (which currently has no aspect-ratio/logo-position controls, only edit-goal/focus-area/text-edit-mode) reusing `post-creator-dialog.tsx`'s JSX/logic, or whether it's scoped to a different, not-yet-identified remake surface.
   - Recommendation: Treat as a concrete task requiring the planner to pick a specific integration point — CONTEXT.md's framing ("UI wiring to existing controls, not new UI design") suggests extending `post-edit-dialog.tsx` with the same controls already built in `post-creator-dialog.tsx`, but this needs an explicit decision in the plan.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@napi-rs/canvas` (npm package + `linux-x64-musl` prebuilt) | TYPO-02 compositor | ✓ (published on npm registry, confirmed via `npm view`) | 1.0.2 | None if the musl binary crashes on the production host (Open Question 2) — would require a Docker base-image change (Alpine → Debian) as a last resort. |
| `fontconfig` (Alpine `apk` package) | TYPO-04, canvas text rendering on Alpine | ✓ (standard Alpine repo package, not yet added to this Dockerfile) | Alpine's current repo version, no pinning needed | None needed — trivial `apk add` addition. |
| Inter font files (`.ttf`) | TYPO-04 | ✗ (not yet present in this repo — must be downloaded from `rsms/inter` GitHub release and committed) | v4.1 (Nov 2024) | None needed — one-time asset addition, no runtime dependency. |
| AVX-capable CPU on the production host | `@napi-rs/canvas` musl runtime (Pitfall 1) | Unverified from this research environment | N/A | If unavailable: switch Docker base off Alpine for this service, or pin `@napi-rs/canvas` to a pre-`0.1.78` release (not recommended). |
| `sharp` | POL-04 crop, TYPO-03 contrast analysis, existing logo overlay/optimize | ✓ (already a production dependency, Alpine-compatible binary already proven in this exact Dockerfile) | `^0.34.5` pinned (registry latest `0.35.3`) | None needed. |

**Missing dependencies with no fallback:**
- Confirmed AVX support on the actual Coolify/Hetzner production host — not verifiable from this research pass's environment (Windows dev sandbox). Recommend a cheap smoke check as part of this phase's implementation or deploy verification.

**Missing dependencies with fallback:**
- Inter font files: simply not yet downloaded/committed — zero risk, one-time task.
- `fontconfig`: simply not yet added to the Dockerfile — zero risk, one-time task.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (project convention: bespoke `scripts/verify-phase-NN.ts` static + functional regex/assertion harnesses, run via `tsx`; no vitest/jest configured — confirmed via `package.json` scripts and `tests/` directory contents) |
| Config file | none — see Wave 0 |
| Quick run command | `npx tsx scripts/verify-phase-23.ts --only=<tag>` (to be created, following the exact pattern of `scripts/verify-phase-22.ts`: a `check(name, cond, detail)` helper, `readSafe()` for in-progress files, an `--only=` substring filter) |
| Full suite command | `npx tsx scripts/verify-phase-23.ts && npm run check` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TYPO-01 | Image prompt never instructs the image model to render text; archetype-specific negative-space instruction present | static (grep on `gemini.service.ts` source) | `npx tsx scripts/verify-phase-23.ts --only=svc-text-free-prompt` | ❌ Wave 0 |
| TYPO-02 | Compositor renders `text_blocks` correctly across all 3 archetypes | functional (golden-image render + pixel/glyph check) | `npx tsx scripts/verify-phase-23.ts --only=svc-compositor-archetypes` | ❌ Wave 0 |
| TYPO-03 | Scrim applied automatically when target-region contrast is insufficient | functional (fixture: a deliberately low-contrast base image; assert scrim pixels present) | `npx tsx scripts/verify-phase-23.ts --only=svc-contrast-scrim` | ❌ Wave 0 |
| TYPO-04 | pt-BR/es glyph coverage — no tofu/missing-glyph boxes | functional golden-image test, run in Docker build or CI | `npx tsx scripts/verify-phase-23.ts --only=svc-golden-image-glyphs` (and/or a `RUN` step in the Dockerfile builder stage) | ❌ Wave 0 |
| TYPO-05 | `posts`/`post_versions` gain `base_image_url`/`typography_meta` (+ `generation_params` on `posts`) | static (migration file presence + column-name grep) | `npx tsx scripts/verify-phase-23.ts --only=svc-schema-migration` | ❌ Wave 0 |
| TYPO-06 | `text-rendering.service.ts` deleted; zero remaining imports of `verifyExactImageText`/`enforceExactImageText` | static (file-absence + repo-wide grep) | `npx tsx scripts/verify-phase-23.ts --only=svc-verify-repair-removed` | ❌ Wave 0 |
| TYPO-07 | Edit flow operates on `base_image_url`, re-applies typography, legacy fallback branch present | static + functional (grep for `base_image_url` reads in `edit.routes.ts`; fixture test with a NULL-base-image post row) | `npx tsx scripts/verify-phase-23.ts --only=svc-edit-base-image` | ❌ Wave 0 |
| POL-04 | Output image matches the exact requested aspect ratio | functional (crop test across a representative sample of the 15 enum values, incl. extremes `1:8`/`8:1`/`21:9`) | `npx tsx scripts/verify-phase-23.ts --only=svc-aspect-crop` | ❌ Wave 0 |
| POL-05 | `generation_params` persisted at generation time; read back (not regex-guessed) on edit/remake | static + functional | `npx tsx scripts/verify-phase-23.ts --only=svc-generation-params` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsx scripts/verify-phase-23.ts --only=<relevant-tag>`
- **Per wave merge:** `npx tsx scripts/verify-phase-23.ts && npm run check`
- **Phase gate:** Full suite green, plus the golden-image test actually executed against an Alpine-based build (not just a developer's local non-Alpine machine — Pitfall 3), before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `scripts/verify-phase-23.ts` — new harness, following the exact convention of `scripts/verify-phase-22.ts` (self-test tag list, `readSafe()`, `--only=` filter).
- [ ] `server/assets/fonts/` — Inter static TTF weight files not yet present; must be downloaded from the `rsms/inter` v4.1 GitHub release and committed.
- [ ] A golden-image fixture set — sample pt-BR/es strings with accented characters (á, ç, ñ, ã, õ, í, ú, ê) and a couple of representative base images (one low-contrast, one high-contrast) for the contrast/scrim test; no existing fixtures cover this (`tests/fixtures/` currently only has a `generation/` subdirectory, contents not reviewed but no typography-related fixtures found via directory listing).
- [ ] Dockerfile changes: `fontconfig` + `fc-cache` addition, and a decision on whether the golden-image test runs as a `RUN` step inside the Docker build (per CONTEXT.md's framing: "guards this in the Docker build") or as a separate CI step in `build-deploy.yml`'s existing `verify` job (which currently only runs `npm run check` + a secret scan).
- [ ] Framework install: `npm install @napi-rs/canvas` — not yet a dependency.

## Sources

### Primary (HIGH confidence)
- This repository, read directly: `shared/schema.ts`, `server/services/gemini.service.ts`, `server/services/planning-schema.service.ts`, `server/services/image-optimization.service.ts`, `server/services/text-rendering.service.ts`, `server/services/prompt-builder.service.ts`, `server/services/image-generation.service.ts`, `server/services/observability.service.ts`, `server/routes/generate.routes.ts`, `server/routes/edit.routes.ts`, `Dockerfile`, `.github/workflows/build-deploy.yml`, `script/build.ts`, `package.json`, `supabase-setup.sql`, `supabase/migrations/*.sql`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md`.
- `npm view @napi-rs/canvas version` / `npm view @napi-rs/canvas-linux-x64-musl version` / `npm view sharp version` — live registry queries, 2026-07-27.
- GitHub API (`api.github.com/repos/Brooooooklyn/canvas/issues/...`) — full issue + comment threads fetched directly for issues #731, #826, #1117, and a search across the repo for Alpine-related issues.

### Secondary (MEDIUM confidence)
- `@napi-rs/canvas` README (`raw.githubusercontent.com/Brooooooklyn/canvas/main/README.md`) — fetched live for API surface (`GlobalFonts`, `createCanvas`, `ctx.font`, `canvas.encode`) and the stated "glibc >= 2.18" system requirement (this requirement's applicability given the confirmed existence of a working `linux-x64-musl` prebuilt is itself a source of the AVX-only-not-glibc nuance surfaced in Pitfall 1 — the musl binary exists and is downloadable, but has its own separate CPU-instruction-set risk).
- `rsms/inter` GitHub releases + Wikipedia cross-reference — Inter v4.1 (Nov 2024), SIL OFL 1.1 license.
- Instagram grid-crop safe-zone guidance (Oktopost, Zeely AI, Outfy, and other 2026-dated marketing blog sources) — cross-referenced across ~10 sources with some disagreement on 1:1 vs 3:4 grid ratio (Pitfall 7).

### Tertiary (LOW confidence)
- Individual blog-post claims about "install `ttf-freefont ttf-dejavu ttf-liberation fontconfig`" as a generic Alpine canvas-text fix — plausible and consistent with the confirmed `fontconfig`-fixes-a-real-issue pattern (#826), but not verified against this specific library/version combination; treat `fontconfig` alone (per CONTEXT.md's decision) as the primary fix and add extra font packages only if the golden-image test still finds gaps.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@napi-rs/canvas` version, musl-binary existence, and Inter's license/version are all directly verified via registry/API queries, not inferred from training data.
- Architecture (codebase integration points): HIGH — every file/line reference in this document was read directly from the current repository state, not assumed.
- Alpine/musl runtime risk (Pitfalls 1-3): MEDIUM — real, dated GitHub issues found and read in full, but this research pass could not run the actual Docker build against the production Hetzner host to confirm the AVX question definitively.
- Instagram grid-crop safe zone (Pitfall 7): LOW-MEDIUM — sources conflict on the exact current crop ratio; recommendation is conservative/defensive rather than pixel-precise.

**Research date:** 2026-07-27
**Valid until:** ~30 days for the codebase-integration findings (stable unless other in-flight phases touch the same files); ~7-14 days for the `@napi-rs/canvas` AVX issue status specifically, since it is an actively-discussed open GitHub issue that could be resolved by a new release at any time — re-check `npm view @napi-rs/canvas version` and issue #1117's status immediately before implementation if more than ~2 weeks elapse.
