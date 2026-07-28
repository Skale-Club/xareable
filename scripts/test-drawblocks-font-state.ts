// scripts/test-drawblocks-font-state.ts
//
// Phase 26, plan 26-03 (POL-02 phase gate tag: svc-drawblocks-font-fix).
//
// THE BUG: server/services/typography-compositor.service.ts's drawBlocks()
// never assigns ctx.font itself. It silently inherits whatever font
// layoutBlocks()'s measurement loop happened to leave the canvas context in
// when IT returns — i.e. the LAST block layoutBlocks iterated. In a
// multi-block layout (e.g. highlight + cta) that means every block EXCEPT
// the last one is drawn at the wrong size: a headline rendered alongside a
// CTA silently shrinks down to CTA size on the canvas, even though
// typography_meta.fonts[] has always reported the correct per-role size
// (the bug is in the RASTER, never in the metadata).
//
// This harness proves the bug with real rendered pixels — no font-metrics
// memorization, no snapshot comparison against a stored golden PNG — by
// measuring the actual ink extent (vertical span of non-background pixels)
// of the first drawn line, alone vs. as the first of two blocks.
//
// Standalone, no external calls of any kind. Run with:
//   npx tsx scripts/test-drawblocks-font-state.ts
// Exits 0 on all-pass, 1 on any failure (RED before the plan's Task 2 fix,
// GREEN after it).

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import type { TextBlock } from "../shared/schema.js";
import {
  compositeTypography,
  computeArchetypeRegion,
  type TypographyMeta,
} from "../server/services/typography-compositor.service.js";

let passed = 0;
let failed = 0;

function pass(label: string, detail?: string): void {
  passed++;
  console.log(`PASS ${label}${detail ? `  [${detail}]` : ""}`);
}

function fail(label: string, detail?: string): void {
  failed++;
  console.error(`FAIL ${label}${detail ? `  [${detail}]` : ""}`);
}

function assertTrue(condition: boolean, label: string, detail?: string): void {
  if (condition) pass(label, detail);
  else fail(label, detail);
}

// ── Fixture ──────────────────────────────────────────────────────────────
// Flat rgb(12,12,12) 1024x1024 (tests/fixtures/typography/make-fixtures.ts):
// near-black, so the compositor always chooses white (#FFFFFF) text and
// never applies a scrim. That makes "greyscale value > 128" an unambiguous
// ink/no-ink threshold for this specific fixture — verified per-render below
// rather than assumed blindly.
const FIXTURE_PATH = path.resolve(process.cwd(), "tests/fixtures/typography/high-contrast-1024.png");

// Same glyphs on both blocks ("HHH") so any ink-extent difference between
// them can only be explained by a font-size difference, never by different
// letterforms. Single word, ASCII, short — word-wrap can never fire.
const HIGHLIGHT = { role: "highlight", text: "HHH" } as const;
const CTA = { role: "cta", text: "HHH" } as const;

/**
 * Asserts the per-render assumptions that make the >128 ink threshold valid
 * for this fixture: white text, no scrim. If either assumption doesn't hold
 * (e.g. a future fixture or contrast-analysis change), the whole measurement
 * is meaningless — fail loudly with the concrete values rather than silently
 * producing a bogus pixel count.
 */
function requireUsableMeta(meta: TypographyMeta, label: string): void {
  if (meta.text_color !== "#FFFFFF" || meta.scrim !== null) {
    throw new Error(
      `[test-drawblocks-font-state] ink-extent threshold assumption violated for "${label}": ` +
        `expected meta.text_color === "#FFFFFF" and meta.scrim === null (flat rgb(12,12,12) fixture), ` +
        `got text_color=${meta.text_color}, scrim=${JSON.stringify(meta.scrim)}`,
    );
  }
}

/**
 * Measures the vertical ink extent of the FIRST drawn line inside
 * `region` (left/top/width — the archetype region's own left/top/width),
 * over exactly one line-height's worth of rows (`lineHeightPx`, taken from
 * that render's OWN meta.fonts[0].line_height_px). A pixel counts as ink when
 * its greyscale value is > 128 (see requireUsableMeta). Returns
 * (last ink row index - first ink row index + 1), or 0 when no ink is found
 * anywhere in the extracted band.
 */
async function firstLineInkExtent(
  buffer: Buffer,
  region: { left: number; top: number; width: number },
  lineHeightPx: number,
): Promise<number> {
  const INK_THRESHOLD = 128;
  const extractHeight = Math.max(1, lineHeightPx);

  const { data, info } = await sharp(buffer)
    .extract({ left: region.left, top: region.top, width: region.width, height: extractHeight })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let firstInkRow = -1;
  let lastInkRow = -1;
  for (let row = 0; row < info.height; row++) {
    const rowStart = row * info.width * info.channels;
    let rowHasInk = false;
    for (let col = 0; col < info.width; col++) {
      if (data[rowStart + col * info.channels] > INK_THRESHOLD) {
        rowHasInk = true;
        break;
      }
    }
    if (rowHasInk) {
      if (firstInkRow === -1) firstInkRow = row;
      lastInkRow = row;
    }
  }

  return firstInkRow === -1 ? 0 : lastInkRow - firstInkRow + 1;
}

async function main(): Promise<void> {
  const baseImageBuffer = fs.readFileSync(FIXTURE_PATH);
  const metadata = await sharp(baseImageBuffer).metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;

  // "top_stack" is the only archetype where the FIRST block's FIRST line is
  // drawn at exactly (region.left, region.top) with textBaseline: "top" and
  // textAlign: "left" — the only archetype where the first line's position
  // is independent of total text height, which is what makes this
  // measurement stable regardless of how many blocks follow it.
  const region = computeArchetypeRegion("top_stack", width, height, undefined);

  // ── 1 & 2: highlight alone vs. highlight as the FIRST of two blocks ────
  const soloHighlight = await compositeTypography({
    baseImageBuffer,
    textBlocks: [HIGHLIGHT] as TextBlock[],
    layoutArchetypeId: "top_stack",
  });
  requireUsableMeta(soloHighlight.meta, "soloHighlight");
  const soloExtent = await firstLineInkExtent(
    soloHighlight.buffer,
    region,
    soloHighlight.meta.fonts[0].line_height_px,
  );

  const multi = await compositeTypography({
    baseImageBuffer,
    textBlocks: [HIGHLIGHT, CTA] as TextBlock[],
    layoutArchetypeId: "top_stack",
  });
  requireUsableMeta(multi.meta, "multi");
  const multiExtent = await firstLineInkExtent(multi.buffer, region, multi.meta.fonts[0].line_height_px);

  assertTrue(
    Math.abs(soloExtent - multiExtent) <= 2,
    "1. highlight's ink extent alone matches its ink extent as the first of three blocks (within 2px)",
    `soloExtent=${soloExtent}px multiExtent=${multiExtent}px`,
  );

  const multiHighlightSizePx = multi.meta.fonts[0].size_px;
  assertTrue(
    multiExtent >= 0.5 * multiHighlightSizePx,
    "2. highlight's ink extent in the multi-block render is >= 0.5 * its own meta size_px",
    `multiExtent=${multiExtent}px, 0.5*size_px=${(0.5 * multiHighlightSizePx).toFixed(1)}px, size_px=${multiHighlightSizePx}px`,
  );

  // ── 3: sanity control — CTA alone must ALWAYS pass, before and after ───
  // the fix. drawBlocks's bug only affects blocks that are NOT the last one
  // layoutBlocks iterated; a solo CTA render is trivially both first and
  // last, so ctx.font is always correct for it regardless of the bug.
  const soloCta = await compositeTypography({
    baseImageBuffer,
    textBlocks: [CTA] as TextBlock[],
    layoutArchetypeId: "top_stack",
  });
  requireUsableMeta(soloCta.meta, "soloCta");
  const soloCtaExtent = await firstLineInkExtent(soloCta.buffer, region, soloCta.meta.fonts[0].line_height_px);
  const soloCtaSizePx = soloCta.meta.fonts[0].size_px;
  assertTrue(
    soloCtaExtent >= 0.5 * soloCtaSizePx,
    "3. [sanity control] solo CTA's ink extent is >= 0.5 * its own meta size_px (must pass before AND after the fix)",
    `soloCtaExtent=${soloCtaExtent}px, 0.5*size_px=${(0.5 * soloCtaSizePx).toFixed(1)}px, size_px=${soloCtaSizePx}px`,
  );

  // ── 4: the eyeball test — a headline must look bigger than a CTA ───────
  assertTrue(
    multiExtent > soloCtaExtent + 4,
    "4. the multi-block highlight's ink extent is unambiguously bigger than the solo CTA's ink extent",
    `multiExtent=${multiExtent}px, soloCtaExtent=${soloCtaExtent}px`,
  );

  // ── 5: zero-text-block pass-through invariant is preserved ─────────────
  const passThrough = await compositeTypography({
    baseImageBuffer,
    textBlocks: [],
    layoutArchetypeId: "top_stack",
  });
  assertTrue(
    Buffer.compare(passThrough.buffer, baseImageBuffer) === 0,
    "5. compositeTypography({ textBlocks: [] }) returns the input buffer byte-identical (pass-through preserved)",
  );

  // ── 6: the metadata was never the bug — document that explicitly ──────
  const multiSizes = multi.meta.fonts.map((f) => f.size_px);
  const strictlyDescending = multiSizes.every((size, i) => i === 0 || size < multiSizes[i - 1]);
  assertTrue(
    strictlyDescending,
    "6. multi.meta.fonts size_px values are strictly descending across [highlight, cta] (metadata was always correct)",
    `sizes=${JSON.stringify(multiSizes)}`,
  );
}

main()
  .then(() => {
    const total = passed + failed;
    console.log(`\n${passed}/${total} passed`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Unhandled error in test-drawblocks-font-state.ts:", err);
    process.exit(1);
  });
