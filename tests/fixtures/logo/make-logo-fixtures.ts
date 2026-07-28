// tests/fixtures/logo/make-logo-fixtures.ts
// Phase 26 (POL-03) — deterministic fixture generator for the adaptive logo
// overlay + region-contrast functional tests. Mirrors
// tests/fixtures/typography/make-fixtures.ts's conventions exactly (flat sharp
// `create`, `compressionLevel: 9`, idempotent, `npx tsx` runnable, prints
// `wrote <name>` per file). Produces exactly three fixtures:
//
//   - logo-alpha-256.png   — 256x256 RGBA. Fully transparent background with
//     an opaque white circle. hasAlpha === true.
//   - logo-opaque-256.jpg  — 256x256 JPEG, no alpha channel, opaque flat
//     background with an opaque dark circle. hasAlpha === false, channels === 3.
//     This is the fixture that exposes the pre-Phase-26 bug: compositing a raw
//     rectangular non-transparent image produces a visible opaque box.
//   - quad-corners-1024.png — 1024x1024, four flat/textured quadrants with
//     deterministically distinct analyzeRegionContrast() outcomes (see the
//     trailing comment block below for the exact per-corner luminance/stdev
//     math and which Phase 26 assertions depend on it).
//
// Idempotent: every fixture is built from a pure function of its own pixel
// coordinates (no randomness anywhere), so re-running this script produces
// byte-identical output.
//
// Run: npx tsx tests/fixtures/logo/make-logo-fixtures.ts
import sharp from "sharp";
import path from "node:path";

const OUT_DIR = path.resolve(process.cwd(), "tests/fixtures/logo");

async function makeLogoAlphaPng(): Promise<void> {
  const filename = "logo-alpha-256.png";
  const outPath = path.join(OUT_DIR, filename);
  const svg = Buffer.from('<svg width="256" height="256"><circle cx="128" cy="128" r="96" fill="#FFFFFF"/></svg>');
  await sharp(svg).png({ compressionLevel: 9 }).toFile(outPath);
  console.log(`wrote ${filename}`);
}

async function makeLogoOpaqueJpg(): Promise<void> {
  const filename = "logo-opaque-256.jpg";
  const outPath = path.join(OUT_DIR, filename);
  const circleSvg = Buffer.from('<svg width="256" height="256"><circle cx="128" cy="128" r="96" fill="#111111"/></svg>');
  await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 236, g: 236, b: 236 },
    },
  })
    .composite([{ input: circleSvg, blend: "over" }])
    .jpeg({ quality: 92 })
    .toFile(outPath);
  console.log(`wrote ${filename}`);
}

/**
 * Builds the 1024x1024 raw RGB pixel buffer for quad-corners-1024.png, one
 * quadrant at a time, as a pure function of (x, y). See the trailing comment
 * block at the bottom of this file for why each corner's values were chosen.
 */
function buildQuadCornersRaw(): Buffer {
  const SIZE = 1024;
  const HALF = SIZE / 2;
  const buf = Buffer.alloc(SIZE * SIZE * 3);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r: number, g: number, b: number;
      if (x < HALF && y < HALF) {
        // top-left: flat near-black.
        r = g = b = 12;
      } else if (x >= HALF && y < HALF) {
        // top-right: flat mid-grey (mid-luminance band).
        r = g = b = 128;
      } else if (x < HALF && y >= HALF) {
        // bottom-left: flat near-white.
        r = g = b = 250;
      } else {
        // bottom-right: deterministic 8x8-block checkerboard, pure function
        // of (x, y) relative to the quadrant origin — no randomness.
        const blockX = Math.floor((x - HALF) / 8);
        const blockY = Math.floor((y - HALF) / 8);
        const isBlack = (blockX + blockY) % 2 === 0;
        r = g = b = isBlack ? 0 : 255;
      }
      const idx = (y * SIZE + x) * 3;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
    }
  }

  return buf;
}

async function makeQuadCornersPng(): Promise<void> {
  const filename = "quad-corners-1024.png";
  const outPath = path.join(OUT_DIR, filename);
  const raw = buildQuadCornersRaw();
  await sharp(raw, { raw: { width: 1024, height: 1024, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`wrote ${filename}`);
}

async function main(): Promise<void> {
  await makeLogoAlphaPng();
  await makeLogoOpaqueJpg();
  await makeQuadCornersPng();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ── Which Phase 26 assertions depend on each fixture ([svc-logo-contrast]) ──
// Do NOT change any luminance/stdev value below without checking what breaks.
//
// logo-alpha-256.png / logo-opaque-256.jpg: exercised by
// scripts/test-logo-overlay-contrast.ts (created by plan 26-07) to prove
// applyLogoOverlay() detects a no-alpha source (hasAlpha === false) and
// applies a soft-edged plate/shadow treatment instead of compositing a raw
// rectangular opaque box — the exact pre-Phase-26 bug POL-03 fixes.
//
// quad-corners-1024.png: exercised by the same harness to prove automatic
// corner selection (the position-not-specified fallback path only — an
// explicit logo_position must always be respected per 26-CONTEXT.md) picks
// one unambiguous winner. Per
// server/services/typography-compositor.service.ts's analyzeRegionContrast()
// (LUMINANCE_TEXT_SWITCH=140, MIN_LUMINANCE_DELTA=90, BUSY_STDEV_THRESHOLD=55,
// MID_BAND_LOW=90, MID_BAND_HIGH=170), each flat 512x512 corner has stdev=0,
// so scrimNeeded reduces to the luminance-only clauses:
//   - top-left  rgb(12,12,12):    luminance ~12  -> textColor WHITE (255);
//     |255-12|=243 >= 90, not mid-band -> scrimNeeded FALSE (the winner: the
//     only corner that is both low-stdev AND clearly outside the mid band).
//   - top-right rgb(128,128,128): luminance ~128 -> inside [90,170] mid band
//     -> scrimNeeded TRUE regardless of the delta clauses.
//   - bottom-left rgb(250,250,250): luminance ~250 -> textColor DARK (17);
//     |17-250|=233 >= 90, not mid-band -> scrimNeeded FALSE too, but this
//     corner deliberately TIES with top-left on stdev (both 0) and FALSE
//     scrimNeeded — proving any corner-selection tie-break rule is exercised
//     by a real ambiguous pair, not just a single trivial winner.
//   - bottom-right: 8x8 checkerboard -> stdev >> 55 ("busy") -> scrimNeeded
//     TRUE via the BUSY_STDEV_THRESHOLD clause alone, independent of mean
//     luminance.
