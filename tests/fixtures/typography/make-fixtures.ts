// tests/fixtures/typography/make-fixtures.ts
// Phase 23 (TYPO-03/TYPO-04) — deterministic fixture generator for the golden-image
// and contrast/scrim tests. Produces two flat-color 1024x1024 PNGs:
//   - low-contrast-1024.png  — mid-grey (mean luminance ~128): neither white nor
//     dark text passes the contrast threshold cleanly -> a scrim MUST be applied.
//   - high-contrast-1024.png — near-black (mean luminance ~12): white text passes
//     cleanly -> NO scrim needed.
//
// Idempotent: sharp's raw-pixel-buffer -> PNG encode path is deterministic for a
// flat color field, so re-running this script produces byte-identical output.
//
// Run: npx tsx tests/fixtures/typography/make-fixtures.ts
import sharp from "sharp";
import path from "node:path";

const SIZE = 1024;
const OUT_DIR = path.resolve(process.cwd(), "tests/fixtures/typography");

async function makeFlatFixture(filename: string, rgb: { r: number; g: number; b: number }) {
  const outPath = path.join(OUT_DIR, filename);
  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 3,
      background: rgb,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`wrote ${filename}`);
}

async function main() {
  await makeFlatFixture("low-contrast-1024.png", { r: 128, g: 128, b: 128 });
  await makeFlatFixture("high-contrast-1024.png", { r: 12, g: 12, b: 12 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
