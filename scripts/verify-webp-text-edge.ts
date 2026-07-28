// scripts/verify-webp-text-edge.ts
//
// Phase 26 (POL-02), plan 26-02. Standalone, no-network regression gate:
// proves the DEFAULT_IMAGE_QUALITY bump (80 -> 85) does not smear composited
// typography glyph edges into WebP compression artifacts. Mirrors
// scripts/verify-golden-image.ts's exact shape (PASS/FAIL lines, a final
// report, non-zero exit on failure) but is scoped ONLY to the WebP
// text-edge-sharpness question, not the full golden-image render suite.
//
// Pipeline: render real composited typography (a lossless PNG ground truth)
// via compositeTypography(), then re-encode that PNG through the REAL
// optimizeImage() at several WebP qualities, and measure how much edge energy
// (a Laplacian-convolution stdev proxy) survives in the text region relative
// to the lossless ground truth.
//
// Usage: npx tsx scripts/verify-webp-text-edge.ts

import fs from "node:fs";
import sharp from "sharp";

const failures: string[] = [];
const ok: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    ok.push(name);
    console.log(`PASS: ${name}`);
  } else {
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

// Calibrated once against this repo's real fixtures/encoder (sharp 0.34.5,
// libwebp 1.6.0). Observed ratio table (edge-energy-in-text-region /
// lossless-ground-truth-edge-energy), bottom_band archetype, pt_br fixture,
// tests/fixtures/typography/high-contrast-1024.png (white text on a flat
// near-black background — the extreme luminance jump at glyph edges survives
// WebP's DCT-based intra encoding far better than a busier/lower-contrast
// photo would):
//
//   q=40 ratio=0.98944304
//   q=80 ratio=0.99535946
//   q=85 ratio=0.99633062
//   q=95 ratio=0.99881171
//
// The literal "target ~ratios[85] - 0.05" heuristic does not apply here —
// all four ratios are clustered within ~1% of 1.0 (this fixture's
// high-contrast glyph edges are inherently WebP-friendly), so ratios[85] -
// 0.05 (~0.9463) would fall BELOW ratios[40] and break the non-vacuity
// control. Instead: 0.99 is the only 2-decimal value strictly between
// ratios[40] (0.98944304) and ratios[85] (0.99633062) — closest 2-decimal
// approximation that still keeps q=40 firmly failing while q=80/85/95 pass.
export const WEBP_TEXT_EDGE_MIN_RATIO = 0.99;

const EDGE_KERNEL = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] } as const;

async function edgeEnergy(
  buf: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  // Extract BEFORE greyscale/convolve so the kernel never sees pixels outside
  // the text region (a convolution computed over the full frame first would
  // leak background edge energy into the region's border pixels).
  const stats = await sharp(buf).extract(region).greyscale().convolve(EDGE_KERNEL).stats();
  return stats.channels[0].stdev;
}

async function main(): Promise<void> {
  const { compositeTypography, computeArchetypeRegion } = await import(
    "../server/services/typography-compositor.service.js"
  );
  const { optimizeImage, generateThumbnail } = await import("../server/services/image-optimization.service.js");

  const baseImageBuffer = fs.readFileSync("tests/fixtures/typography/high-contrast-1024.png");
  const strings = JSON.parse(fs.readFileSync("tests/fixtures/typography/strings.json", "utf8"));

  const { buffer: composited, meta } = await compositeTypography({
    baseImageBuffer,
    textBlocks: strings.pt_br,
    layoutArchetypeId: "bottom_band",
  });

  // If either fixture assumption changed, every downstream ratio is
  // meaningless — fail loudly here rather than producing a misleading ratio.
  if (meta.fonts.length !== 3 || meta.scrim !== null) {
    console.error(
      `FATAL: fixture assumptions changed — expected meta.fonts.length === 3 and meta.scrim === null, ` +
        `got fonts.length=${meta.fonts.length} scrim=${JSON.stringify(meta.scrim)}. Every downstream ratio would be meaningless.`,
    );
    process.exit(1);
  }

  const region = computeArchetypeRegion("bottom_band", 1024, 1024);
  const groundTruth = await edgeEnergy(composited, region);

  const qualities = [40, 80, 85, 95] as const;
  const ratios: Record<number, number> = {};
  for (const q of qualities) {
    const { buffer } = await optimizeImage(composited, q);
    ratios[q] = (await edgeEnergy(buffer, region)) / groundTruth;
  }

  console.log("\n=== WebP text-edge quality gate ===");
  console.log(`groundTruth edge energy (lossless PNG): ${groundTruth.toFixed(4)}`);
  for (const q of qualities) {
    console.log(`  q=${q} ratio=${ratios[q].toFixed(4)}`);
  }
  console.log(`WEBP_TEXT_EDGE_MIN_RATIO=${WEBP_TEXT_EDGE_MIN_RATIO}`);
  console.log("");

  check(
    `quality 85's edge-energy ratio (${ratios[85].toFixed(4)}) >= WEBP_TEXT_EDGE_MIN_RATIO (${WEBP_TEXT_EDGE_MIN_RATIO})`,
    ratios[85] >= WEBP_TEXT_EDGE_MIN_RATIO,
    `ratios[85]=${ratios[85].toFixed(4)}`,
  );

  check(
    `NON-VACUITY CONTROL: quality 40's edge-energy ratio (${ratios[40].toFixed(4)}) < WEBP_TEXT_EDGE_MIN_RATIO (${WEBP_TEXT_EDGE_MIN_RATIO}) — if this ever passes, the detector is blind and the gate is worthless`,
    ratios[40] < WEBP_TEXT_EDGE_MIN_RATIO,
    `ratios[40]=${ratios[40].toFixed(4)}`,
  );

  check(
    `quality 85's ratio (${ratios[85].toFixed(4)}) >= quality 80's ratio (${ratios[80].toFixed(4)}) - 0.005 — the bump is a real improvement, not a regression (epsilon tolerates encoder noise)`,
    ratios[85] >= ratios[80] - 0.005,
    `ratios[85]=${ratios[85].toFixed(4)} ratios[80]=${ratios[80].toFixed(4)}`,
  );

  const defaultOptimized = (await optimizeImage(composited)).buffer;
  const q85Optimized = (await optimizeImage(composited, 85)).buffer;
  const q80Optimized = (await optimizeImage(composited, 80)).buffer;

  check(
    "optimizeImage(composited) with no explicit quality is byte-identical to optimizeImage(composited, 85)",
    Buffer.compare(defaultOptimized, q85Optimized) === 0,
    "DEFAULT_IMAGE_QUALITY must be 85 for this to pass — see server/services/image-optimization.service.ts",
  );

  check(
    "optimizeImage(composited) with no explicit quality is NOT byte-identical to optimizeImage(composited, 80)",
    Buffer.compare(defaultOptimized, q80Optimized) !== 0,
    "if these ARE byte-identical, DEFAULT_IMAGE_QUALITY is still 80",
  );

  const defaultThumbnail = (await generateThumbnail(composited)).buffer;
  const explicitThumbnail = (await generateThumbnail(composited, { quality: 70 })).buffer;

  check(
    "generateThumbnail(composited) with no options is byte-identical to generateThumbnail(composited, { quality: 70 }) — the thumbnail setting was not swept along by the main-image quality bump",
    Buffer.compare(defaultThumbnail, explicitThumbnail) === 0,
    "DEFAULT_THUMBNAIL_OPTIONS.quality must remain 70",
  );

  console.log(`\n${ok.length}/${ok.length + failures.length} passed`);
  if (failures.length > 0) {
    console.log(`\nFAIL: ${failures.length}`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`WEBP TEXT-EDGE GATE FAIL: ${(err as Error)?.message ?? err}`);
  process.exit(1);
});
