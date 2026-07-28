/**
 * Phase 23 (TYPO-02, TYPO-03). Deterministic server-side typography. The image
 * model no longer renders text (TYPO-01); this module draws it. Fonts are
 * registered from a REAL local filesystem path — never a URL (23-RESEARCH.md
 * Pitfall 2: font registration from a URL silently no-ops, rendering blank
 * text with no error). Each weight gets its OWN alias — weight-keyword
 * matching within one shared family alias is undocumented for
 * @napi-rs/canvas (Pitfall 5).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import sharp from "sharp";

import type { TextBlock, TextBlockRole, TextStyle } from "../../shared/schema.js";
import type { LayoutArchetypeId } from "./planning-schema.service.js";

// ── Fonts ────────────────────────────────────────────────────────────────

export const COMPOSITOR_VERSION = 1;

export const FONT_ALIASES = {
  regular: "Inter-Regular",
  semibold: "Inter-SemiBold",
  bold: "Inter-Bold",
} as const;

export const ROLE_FONT_ALIAS: Record<TextBlockRole, string> = {
  highlight: FONT_ALIASES.bold,
  support: FONT_ALIASES.regular,
  cta: FONT_ALIASES.semibold,
};

/**
 * Resolves the bundled-fonts directory. Probes production first (the Docker
 * runner stage only copies the build output, and the build step copies the
 * bundled fonts alongside it), falling back to the dev source location when
 * running directly from source (`tsx server/index.ts`).
 */
export function resolveFontDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "dist/assets/fonts"),
    path.resolve(process.cwd(), "server/assets/fonts"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`[typography] no bundled font directory found; looked in: ${candidates.join(", ")}`);
}

let registeredAliases: string[] | null = null;

/**
 * Registers the three bundled Inter weights under distinct per-weight aliases.
 * Memoized at module scope — registration must happen ONCE per process, never
 * per request. A falsy return from the font-registration call means the font
 * did NOT register; a silently unregistered font renders blank text with zero
 * error (Pitfall 2), so this fails loudly rather than continuing silently.
 */
export function registerBundledFonts(): string[] {
  if (registeredAliases) return registeredAliases;

  const fontDir = resolveFontDir();
  const regularOk = !!GlobalFonts.registerFromPath(path.join(fontDir, "Inter-Regular.ttf"), FONT_ALIASES.regular);
  const semiboldOk = !!GlobalFonts.registerFromPath(path.join(fontDir, "Inter-SemiBold.ttf"), FONT_ALIASES.semibold);
  const boldOk = !!GlobalFonts.registerFromPath(path.join(fontDir, "Inter-Bold.ttf"), FONT_ALIASES.bold);

  const results: Array<{ ok: boolean; alias: string; file: string }> = [
    { ok: regularOk, alias: FONT_ALIASES.regular, file: "Inter-Regular.ttf" },
    { ok: semiboldOk, alias: FONT_ALIASES.semibold, file: "Inter-SemiBold.ttf" },
    { ok: boldOk, alias: FONT_ALIASES.bold, file: "Inter-Bold.ttf" },
  ];

  for (const { ok, alias, file } of results) {
    if (!ok) {
      console.error(`[typography] font registration returned falsy: alias=${alias} file=${file}`);
      throw new Error(
        `[typography] font registration failed for ${alias} (${file}) — a silently unregistered ` +
          "font renders blank text with zero error (Pitfall 2), so this must fail loudly.",
      );
    }
  }

  registeredAliases = [FONT_ALIASES.regular, FONT_ALIASES.semibold, FONT_ALIASES.bold];
  return registeredAliases;
}

// ── Phase 25 (CRSL2-04) — text-style-driven type treatment ──────────────────
// SCOPE GUARD: the platform bundles exactly ONE font family (Inter, 3 static
// weights). "Text styles feed the compositor" therefore means WEIGHT / SIZE /
// CASE / TRACKING variation inside that family — never a new typeface. Bundling
// a new family would have to clear scripts/verify-golden-image.ts's tofu and
// glyph-coverage gates and is explicitly out of scope (25-RESEARCH.md Pitfall 2,
// REQUIREMENTS.md "Platform-curated font set only").
export interface TypographyTreatment {
  sizeScale: number; // multiplies ROLE_SIZE_RATIO
  roleAliasOverride: Partial<Record<TextBlockRole, string>>; // values MUST be FONT_ALIASES members
  uppercaseHighlight: boolean;
  letterSpacingRatio: number; // fraction of the rendered size_px
}

export const IDENTITY_TYPOGRAPHY_TREATMENT: TypographyTreatment = {
  sizeScale: 1,
  roleAliasOverride: {},
  uppercaseHighlight: false,
  letterSpacingRatio: 0,
};

export const TREATMENT_SIZE_SCALE_MIN = 0.8;
export const TREATMENT_SIZE_SCALE_MAX = 1.25;
export const TREATMENT_LETTER_SPACING_MAX = 0.08;

function clampTreatmentValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Derives a deterministic `TypographyTreatment` from the selected text
 * styles' `prompt_hints.typography` (falling back to `description` when that
 * hint is empty). Pure — no randomness, no date/env reads — so the same
 * style selection always yields the same treatment. `[]`, or a selection
 * whose hints match none of the keyword rules below, yields
 * `IDENTITY_TYPOGRAPHY_TREATMENT` exactly, preserving Phase 23's default
 * compositor behavior for callers that pass no treatment.
 *
 * Merge semantics across multiple selected styles: `sizeScale` accumulates as
 * a product (then clamped), `uppercaseHighlight` is OR-ed (monotonic — never
 * un-set once true), `letterSpacingRatio` is the max across styles (then
 * clamped), and `roleAliasOverride` is taken from the FIRST style in
 * selection order that supplies one (selection order wins).
 */
export function resolveTypographyTreatment(textStyles: TextStyle[]): TypographyTreatment {
  let sizeScale = 1;
  let uppercaseHighlight = false;
  let letterSpacingRatio = 0;
  let roleAliasOverride: Partial<Record<TextBlockRole, string>> = {};
  let roleAliasOverrideSet = false;

  for (const style of textStyles) {
    const typographyHint = (style.prompt_hints?.typography ?? "").trim();
    const raw = (typographyHint || (style.description ?? "")).toLowerCase().trim();
    if (!raw) continue;

    if (/ultra-?bold|ultra-?heavy|brutalist|black|display/.test(raw)) {
      uppercaseHighlight = true;
      sizeScale *= 1.15;
    }
    if (/condensed|poster/.test(raw)) {
      uppercaseHighlight = true;
      letterSpacingRatio = Math.max(letterSpacingRatio, 0.1);
    }
    // Negative lookbehinds exclude "sans-serif"/"sans serif" — that substring
    // appears in bold-promo's own hint ("sans-serif display typography") and
    // must NOT be mistaken for the elegant/serif treatment.
    if (/elegant|editorial|classic|journal|(?<!sans-)(?<!sans )serif/.test(raw)) {
      sizeScale *= 0.9;
    }
    if (/casual|handwritten|marker|script|organic/.test(raw)) {
      if (!roleAliasOverrideSet) {
        roleAliasOverride = { highlight: FONT_ALIASES.semibold };
        roleAliasOverrideSet = true;
      }
    }
  }

  return {
    sizeScale: clampTreatmentValue(sizeScale, TREATMENT_SIZE_SCALE_MIN, TREATMENT_SIZE_SCALE_MAX),
    roleAliasOverride,
    uppercaseHighlight,
    letterSpacingRatio: clampTreatmentValue(letterSpacingRatio, 0, TREATMENT_LETTER_SPACING_MAX),
  };
}

// ── Text-block resolution ───────────────────────────────────────────────

const ROLE_ORDER: Record<TextBlockRole, number> = { highlight: 0, support: 1, cta: 2 };

/**
 * Resolves the `text_blocks` vs `headline`/`subtext` overlap Phase 22
 * deliberately deferred to Phase 23. Prefers `text_blocks` when at least one
 * entry has real text; otherwise synthesizes `highlight`/`support` blocks
 * from `headline`/`subtext`; otherwise returns `[]` (caller skips compositing
 * entirely).
 */
export function resolveTextBlocks(input: {
  textBlocks?: TextBlock[] | null;
  headline?: string | null;
  subtext?: string | null;
}): TextBlock[] {
  const provided = (input.textBlocks ?? [])
    .map((b) => ({ role: b.role, text: (b.text ?? "").trim() }))
    .filter((b) => b.text.length > 0);

  if (provided.length > 0) {
    return provided
      .map((b) => ({ role: b.role, text: b.text.slice(0, 200) }))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
      .slice(0, 3);
  }

  const synthesized: TextBlock[] = [];
  const headline = (input.headline ?? "").trim();
  const subtext = (input.subtext ?? "").trim();
  if (headline) synthesized.push({ role: "highlight", text: headline.slice(0, 200) });
  if (subtext) synthesized.push({ role: "support", text: subtext.slice(0, 200) });
  return synthesized;
}

// ── Archetype geometry & safe zones ─────────────────────────────────────

export const SAFE_ZONE_INSET_RATIO = 0.07;

/**
 * Pitfall 7: sources conflict on Instagram's current 4:5 grid-crop behavior
 * (legacy 1:1 center-crop losing ~10% top/bottom vs. a reported 2025 shift to
 * a 3:4 grid preview that would crop from the sides instead). Inset BOTH axes
 * conservatively for 4:5 so critical text survives either interpretation.
 */
export const IG_GRID_SAFE_INSET_RATIO = 0.1;

export function computeSafeZone(
  width: number,
  height: number,
  aspectRatio?: string,
): { left: number; top: number; width: number; height: number } {
  const insetRatio = aspectRatio === "4:5" ? IG_GRID_SAFE_INSET_RATIO : SAFE_ZONE_INSET_RATIO;
  const insetX = Math.round(width * insetRatio);
  const insetY = Math.round(height * insetRatio);
  return {
    left: insetX,
    top: insetY,
    width: Math.max(1, width - insetX * 2),
    height: Math.max(1, height - insetY * 2),
  };
}

// Claude's-discretion values per 23-CONTEXT.md (exact layout-archetype
// pixel/percentage specs are explicitly left to implementation judgment),
// tuned so text lands in the frame region the negative-space prompt
// instruction (plan 23-05) reserves for it.
const ARCHETYPE_FRACTIONS: Record<LayoutArchetypeId, { x: number; y: number; w: number; h: number }> = {
  bottom_band: { x: 0.0, y: 0.58, w: 1.0, h: 0.42 },
  top_stack: { x: 0.0, y: 0.0, w: 1.0, h: 0.42 },
  centered_hero: { x: 0.0, y: 0.3, w: 1.0, h: 0.4 },
};

export function computeArchetypeRegion(
  archetypeId: LayoutArchetypeId,
  width: number,
  height: number,
  aspectRatio?: string,
): { left: number; top: number; width: number; height: number } {
  const frac = ARCHETYPE_FRACTIONS[archetypeId];
  const rawLeft = Math.round(frac.x * width);
  const rawTop = Math.round(frac.y * height);
  const rawWidth = Math.round(frac.w * width);
  const rawHeight = Math.round(frac.h * height);

  const safeZone = computeSafeZone(width, height, aspectRatio);

  const left = Math.max(rawLeft, safeZone.left);
  const top = Math.max(rawTop, safeZone.top);
  const right = Math.min(rawLeft + rawWidth, safeZone.left + safeZone.width);
  const bottom = Math.min(rawTop + rawHeight, safeZone.top + safeZone.height);

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Plan 23-05 imports this constant so the image-generation prompt's
 * negative-space instruction and this file's geometry can never drift apart.
 */
export const ARCHETYPE_NEGATIVE_SPACE_ZONE: Record<LayoutArchetypeId, string> = {
  bottom_band:
    "the lower 40% of the frame calm, uncluttered, and free of important subject detail so a text band can be overlaid",
  top_stack: "the upper 40% of the frame open, visually simple, and free of important subject detail",
  centered_hero: "clear, uncluttered negative space across the horizontal middle band of the frame",
};

// ── Contrast analysis & automatic scrim decision (TYPO-03) ─────────────

export const LUMINANCE_TEXT_SWITCH = 140;
export const MIN_LUMINANCE_DELTA = 90;
export const BUSY_STDEV_THRESHOLD = 55;
export const MID_BAND_LOW = 90;
export const MID_BAND_HIGH = 170;
export const TEXT_COLOR_LIGHT = "#FFFFFF";
export const TEXT_COLOR_DARK = "#111111";
export const SCRIM_ALPHA_DARK = 0.45;
export const SCRIM_ALPHA_LIGHT = 0.55;

export interface RegionContrast {
  luminance: number;
  stdev: number;
  textColor: string;
  scrimNeeded: boolean;
  scrimColor: string;
  scrimAlpha: number;
}

/**
 * Deterministic, WCAG-inspired (NOT WCAG-conformant — per 23-CONTEXT.md,
 * strict WCAG relative-luminance linearization is not required) region
 * contrast analysis. Samples the target text region's mean luminance/stdev
 * via `sharp`'s region stats and decides whether a scrim is required and
 * which text color to use. Never throws — on any failure it returns a
 * fail-toward-legibility default (dark scrim + white text) rather than
 * risking illegible text in the generation pipeline.
 */
export async function analyzeRegionContrast(
  baseBuffer: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<RegionContrast> {
  try {
    const metadata = await sharp(baseBuffer).metadata();
    const imgWidth = metadata.width ?? region.left + region.width;
    const imgHeight = metadata.height ?? region.top + region.height;

    const left = Math.max(0, Math.min(region.left, Math.max(0, imgWidth - 1)));
    const top = Math.max(0, Math.min(region.top, Math.max(0, imgHeight - 1)));
    const width = Math.max(1, Math.min(region.width, imgWidth - left));
    const height = Math.max(1, Math.min(region.height, imgHeight - top));

    const { channels } = await sharp(baseBuffer).extract({ left, top, width, height }).stats();

    const luminance =
      channels.length >= 3
        ? 0.299 * channels[0].mean + 0.587 * channels[1].mean + 0.114 * channels[2].mean
        : channels[0].mean;
    const stdev =
      channels.length >= 3
        ? (channels[0].stdev + channels[1].stdev + channels[2].stdev) / 3
        : channels[0].stdev;

    const textColor = luminance > LUMINANCE_TEXT_SWITCH ? TEXT_COLOR_DARK : TEXT_COLOR_LIGHT;
    const textLuminance = textColor === TEXT_COLOR_LIGHT ? 255 : 17;

    // A mid-luminance background defeats BOTH white and dark text at typical
    // photographic variance, so the mid band always gets a scrim — this is
    // what makes the flat rgb(128,128,128) fixture scrim (its raw delta of
    // 127 would otherwise pass the first clause) while rgb(12,12,12)
    // correctly does not.
    const scrimNeeded =
      Math.abs(textLuminance - luminance) < MIN_LUMINANCE_DELTA ||
      stdev > BUSY_STDEV_THRESHOLD ||
      (luminance >= MID_BAND_LOW && luminance <= MID_BAND_HIGH);

    const scrimColor = textColor === TEXT_COLOR_LIGHT ? "#000000" : "#FFFFFF";
    const scrimAlpha = textColor === TEXT_COLOR_LIGHT ? SCRIM_ALPHA_DARK : SCRIM_ALPHA_LIGHT;

    return { luminance, stdev, textColor, scrimNeeded, scrimColor, scrimAlpha };
  } catch (err) {
    console.warn("[typography] analyzeRegionContrast failed, defaulting to scrim + white text:", err);
    return {
      luminance: 128,
      stdev: 0,
      textColor: TEXT_COLOR_LIGHT,
      scrimNeeded: true,
      scrimColor: "#000000",
      scrimAlpha: SCRIM_ALPHA_DARK,
    };
  }
}

// ── Draw loop: word-wrap, auto-shrink, scrim + text compositing ────────

/**
 * `typography_meta` shape returned by `compositeTypography`. Mirrors
 * `shared/schema.ts`'s `typographyMetaSchema` (plan 23-02) field-for-field so
 * the two never drift; kept local here so this service type-checks
 * standalone regardless of migration/schema-plan sequencing.
 */
export interface TypographyMeta {
  compositor_version: number;
  layout_archetype_id: LayoutArchetypeId;
  text_blocks: TextBlock[];
  text_color: string;
  fonts: Array<{ role: TextBlockRole; alias: string; size_px: number; line_height_px: number; lines: number }>;
  scrim: { applied: true; color: string; alpha: number; region: { left: number; top: number; width: number; height: number } } | null;
  safe_zone: { left: number; top: number; width: number; height: number };
  canvas: { width: number; height: number };
}

// Type-size fractions of `base = Math.min(width, height)`. Claude's-discretion
// per 23-CONTEXT.md — exact typographic scale/ratios are implementation
// judgment, informed by research, not mandated pixel values.
export const ROLE_SIZE_RATIO: Record<TextBlockRole, number> = { highlight: 0.085, support: 0.045, cta: 0.038 };
export const LINE_HEIGHT_RATIO = 1.18;
export const AUTOSHRINK_STEP = 0.94;
export const MIN_SIZE_RATIO = 0.03;
export const BLOCK_GAP_RATIO = 0.35;

// Canvas 2D has NO built-in word-wrap (Pitfall 4) — greedy word-wrap via
// ctx.measureText against the archetype's safe-zone width. A single word
// longer than maxWidth is emitted on its own line rather than looping
// forever waiting for it to "fit".
function wrapTextToWidth(ctx: any, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const candidateWidth = ctx.measureText(candidate).width;
    if (candidateWidth > maxWidth && current) {
      lines.push(current);
      current = word;
    } else if (candidateWidth > maxWidth && !current) {
      lines.push(candidate);
      current = "";
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

interface BlockLayout {
  role: TextBlockRole;
  alias: string;
  size_px: number;
  line_height_px: number;
  lines: string[];
}

/**
 * Lays out every block at the role's target size, auto-shrinking ALL sizes
 * together (never per-block) whenever the total drawn height exceeds the
 * archetype region, down to `MIN_SIZE_RATIO * base` where it accepts the
 * minimum and clips rather than looping forever.
 */
function layoutBlocks(
  ctx: any,
  blocks: TextBlock[],
  region: { left: number; top: number; width: number; height: number },
  base: number,
  treatment: TypographyTreatment = IDENTITY_TYPOGRAPHY_TREATMENT,
): { layouts: BlockLayout[]; totalHeight: number } {
  const minSizePx = Math.round(MIN_SIZE_RATIO * base);
  let scale = 1;

  for (;;) {
    const layouts: BlockLayout[] = [];
    let totalHeight = 0;
    let clippedAtMin = false;

    blocks.forEach((block, index) => {
      const alias = treatment.roleAliasOverride[block.role] ?? ROLE_FONT_ALIAS[block.role];
      let sizePx = Math.round(ROLE_SIZE_RATIO[block.role] * base * scale * treatment.sizeScale);
      if (sizePx <= minSizePx) {
        sizePx = minSizePx;
        clippedAtMin = true;
      }
      ctx.font = `${sizePx}px ${alias}`;
      const renderedText =
        treatment.uppercaseHighlight && block.role === "highlight" ? block.text.toUpperCase() : block.text;
      const lines = wrapTextToWidth(ctx, renderedText, region.width);
      const lineHeightPx = Math.round(sizePx * LINE_HEIGHT_RATIO);

      totalHeight += lines.length * lineHeightPx;
      if (index < blocks.length - 1) {
        totalHeight += Math.round(lineHeightPx * BLOCK_GAP_RATIO);
      }

      layouts.push({ role: block.role, alias, size_px: sizePx, line_height_px: lineHeightPx, lines });
    });

    if (totalHeight <= region.height || clippedAtMin) {
      return { layouts, totalHeight };
    }
    scale *= AUTOSHRINK_STEP;
  }
}

function sumTextHeight(layouts: BlockLayout[]): number {
  return layouts.reduce((sum, l, i) => {
    const blockHeight = l.lines.length * l.line_height_px;
    const gap = i < layouts.length - 1 ? Math.round(l.line_height_px * BLOCK_GAP_RATIO) : 0;
    return sum + blockHeight + gap;
  }, 0);
}

// Scrim rect per archetype, drawn BEFORE any text.
function computeScrimRect(
  archetypeId: LayoutArchetypeId,
  region: { left: number; top: number; width: number; height: number },
  layouts: BlockLayout[],
  width: number,
  height: number,
  base: number,
): { left: number; top: number; width: number; height: number } {
  if (archetypeId === "bottom_band") {
    const top = Math.max(0, region.top - Math.round(height * 0.03));
    return { left: 0, top, width, height: Math.max(1, height - top) };
  }
  if (archetypeId === "top_stack") {
    const bottom = Math.min(height, region.top + region.height + Math.round(height * 0.03));
    return { left: 0, top: 0, width, height: Math.max(1, bottom) };
  }

  // centered_hero: pad the laid-out text bounding box by 4% of `base` on all
  // sides, clamped to the canvas.
  const textHeight = sumTextHeight(layouts);
  const pad = Math.round(base * 0.04);
  const centerY = region.top + region.height / 2;
  const rawTop = Math.round(centerY - textHeight / 2) - pad;
  const rawBottom = Math.round(centerY + textHeight / 2) + pad;
  const rawLeft = region.left - pad;
  const rawRight = region.left + region.width + pad;

  const left = Math.max(0, rawLeft);
  const top = Math.max(0, rawTop);
  const right = Math.min(width, rawRight);
  const bottom = Math.min(height, rawBottom);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

// Draws every block per the archetype's alignment/anchor rules, advancing `y`
// by `line_height_px` per line plus a `BLOCK_GAP_RATIO` gap between blocks.
function drawBlocks(
  ctx: any,
  archetypeId: LayoutArchetypeId,
  region: { left: number; top: number; width: number; height: number },
  layouts: BlockLayout[],
  treatment: TypographyTreatment = IDENTITY_TYPOGRAPHY_TREATMENT,
): void {
  const textHeight = sumTextHeight(layouts);

  let y: number;
  if (archetypeId === "top_stack") {
    y = region.top;
  } else if (archetypeId === "centered_hero") {
    y = Math.round(region.top + region.height / 2 - textHeight / 2);
  } else {
    // bottom_band: bottom-anchored inside the region.
    y = Math.round(region.top + region.height - textHeight);
  }

  const x = archetypeId === "centered_hero" ? region.left + region.width / 2 : region.left;
  ctx.textAlign = archetypeId === "centered_hero" ? "center" : "left";

  // Feature-guard: an older @napi-rs/canvas build without CanvasRenderingContext2D.letterSpacing
  // support should degrade silently (no tracking applied) rather than throw.
  const supportsLetterSpacing = typeof ctx.letterSpacing !== "undefined";

  layouts.forEach((layout, i) => {
    const trackingPx = Math.round(layout.size_px * treatment.letterSpacingRatio);
    layout.lines.forEach((line) => {
      if (treatment.letterSpacingRatio > 0 && supportsLetterSpacing) {
        ctx.letterSpacing = `${trackingPx}px`;
      }
      ctx.fillText(line, x, y);
      if (treatment.letterSpacingRatio > 0 && supportsLetterSpacing) {
        ctx.letterSpacing = "0px";
      }
      y += layout.line_height_px;
    });
    if (i < layouts.length - 1) {
      y += Math.round(layout.line_height_px * BLOCK_GAP_RATIO);
    }
  });
}

function emptyMeta(
  layoutArchetypeId: LayoutArchetypeId,
  textBlocks: TextBlock[],
  width: number,
  height: number,
  aspectRatio: string | undefined,
): TypographyMeta {
  return {
    compositor_version: COMPOSITOR_VERSION,
    layout_archetype_id: layoutArchetypeId,
    text_blocks: textBlocks,
    text_color: TEXT_COLOR_LIGHT,
    fonts: [],
    scrim: null,
    safe_zone: computeSafeZone(width, height, aspectRatio),
    canvas: { width, height },
  };
}

/**
 * Renders `text_blocks` over `baseImageBuffer` using the chosen layout
 * archetype: real bundled Inter weights, safe-zone-aware word-wrap with
 * auto-shrink, a contrast-driven scrim, and a schema-valid `typography_meta`
 * record. Degrades to the base image (no text, no throw) on any failure —
 * a compositor error must never break a generation.
 */
export async function compositeTypography(params: {
  baseImageBuffer: Buffer;
  textBlocks: TextBlock[];
  layoutArchetypeId: LayoutArchetypeId;
  aspectRatio?: string;
  treatment?: TypographyTreatment; // Phase 25 (CRSL2-04). Omitted => IDENTITY_TYPOGRAPHY_TREATMENT (exact Phase 23 behavior)
}): Promise<{ buffer: Buffer; meta: TypographyMeta }> {
  let width = 0;
  let height = 0;
  try {
    registerBundledFonts();
    const treatment = params.treatment ?? IDENTITY_TYPOGRAPHY_TREATMENT;

    const metadata = await sharp(params.baseImageBuffer).metadata();
    width = metadata.width ?? 0;
    height = metadata.height ?? 0;

    if (params.textBlocks.length === 0) {
      // A no-text post must be a cheap pass-through, not a re-encode of the
      // same pixels through canvas.
      return { buffer: params.baseImageBuffer, meta: emptyMeta(params.layoutArchetypeId, [], width, height, params.aspectRatio) };
    }

    const region = computeArchetypeRegion(params.layoutArchetypeId, width, height, params.aspectRatio);
    const safeZone = computeSafeZone(width, height, params.aspectRatio);
    const contrast = await analyzeRegionContrast(params.baseImageBuffer, region);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const baseImage = await loadImage(params.baseImageBuffer);
    ctx.drawImage(baseImage, 0, 0, width, height);

    const base = Math.min(width, height);
    const { layouts } = layoutBlocks(ctx, params.textBlocks, region, base, treatment);

    let scrimMeta: TypographyMeta["scrim"] = null;
    if (contrast.scrimNeeded) {
      const scrimRect = computeScrimRect(params.layoutArchetypeId, region, layouts, width, height, base);
      ctx.globalAlpha = contrast.scrimAlpha;
      ctx.fillStyle = contrast.scrimColor;
      ctx.fillRect(scrimRect.left, scrimRect.top, scrimRect.width, scrimRect.height);
      ctx.globalAlpha = 1;
      scrimMeta = { applied: true, color: contrast.scrimColor, alpha: contrast.scrimAlpha, region: scrimRect };
    }

    ctx.fillStyle = contrast.textColor;
    ctx.textBaseline = "top";
    drawBlocks(ctx, params.layoutArchetypeId, region, layouts, treatment);

    const buffer = await canvas.encode("png");

    const meta: TypographyMeta = {
      compositor_version: COMPOSITOR_VERSION,
      layout_archetype_id: params.layoutArchetypeId,
      // Phase 25 (CRSL2-04): kept verbatim (original casing) even when
      // treatment.uppercaseHighlight rendered the highlight block upper-case
      // on the canvas — only the LOCAL `renderedText` string inside
      // layoutBlocks is uppercased, never params.textBlocks itself. The edit
      // path re-composites from this persisted typography_meta.text_blocks,
      // so baking uppercase into it would make the original casing
      // unrecoverable on a later edit/remake.
      text_blocks: params.textBlocks,
      text_color: contrast.textColor,
      // Effective alias/size AFTER treatment (roleAliasOverride / sizeScale)
      // is applied — `layouts` entries already reflect the resolved values.
      fonts: layouts.map((l) => ({
        role: l.role,
        alias: l.alias,
        size_px: l.size_px,
        line_height_px: l.line_height_px,
        lines: l.lines.length,
      })),
      scrim: scrimMeta,
      safe_zone: safeZone,
      canvas: { width, height },
    };

    return { buffer, meta };
  } catch (err) {
    console.error("[typography] composite failed, returning base image:", err);
    return {
      buffer: params.baseImageBuffer,
      meta: emptyMeta(params.layoutArchetypeId, params.textBlocks, width, height, params.aspectRatio),
    };
  }
}

/**
 * Golden-image tofu detector used by `--only=svc-golden-image-glyphs` and by
 * `scripts/verify-golden-image.ts` (plan 23-08). Detection principle: a
 * missing glyph renders as the font's notdef/tofu box (or nothing at all), so
 * a real glyph's raster hash differs from the hash of a guaranteed-unmapped
 * codepoint AND from the hash of a blank space — any codepoint whose hash
 * collides with either control is presumed unrendered. Deterministic for the
 * same font file and library version.
 */
export async function renderGlyphRasterHash(char: string): Promise<string> {
  registerBundledFonts();

  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#000000";
  ctx.font = `48px ${FONT_ALIASES.regular}`;
  ctx.textBaseline = "top";
  ctx.fillText(char, 4, 4);

  const buffer = await canvas.encode("png");
  return createHash("sha256").update(buffer).digest("hex");
}
