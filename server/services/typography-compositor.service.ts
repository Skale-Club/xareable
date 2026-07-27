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
import { GlobalFonts } from "@napi-rs/canvas";

import type { TextBlock, TextBlockRole } from "../../shared/schema.js";
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
