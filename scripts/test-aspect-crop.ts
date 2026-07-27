// scripts/test-aspect-crop.ts
// Functional test for POL-04: cropToExactAspectRatio / parseAspectRatio.
// Proves the crop against all 15 accepted aspect_ratio enum values
// (shared/schema.ts:919-925), the no-op identity case, and degenerate
// inputs. Standalone, no network, no dependency on the typography fixtures.
// Run with: npx tsx scripts/test-aspect-crop.ts
// Exits 0 on all-pass, 1 on any failure.

import sharp from "sharp";
import {
  cropToExactAspectRatio,
  parseAspectRatio,
} from "../server/services/image-crop.service.js";

let passed = 0;
let failed = 0;

function pass(label: string): void {
  passed++;
  console.log(`PASS ${label}`);
}

function fail(label: string, detail?: string): void {
  failed++;
  console.error(`FAIL ${label}${detail ? `\n  ${detail}` : ""}`);
}

// The exhaustive 15-value aspect_ratio enum (shared/schema.ts:919-925).
const ALL_RATIOS = [
  "1:1", "1:4", "1:8",
  "2:3", "3:2", "3:4",
  "4:1", "4:3", "4:5", "5:4",
  "8:1", "9:16", "16:9", "21:9",
  "1200:628",
];

async function main(): Promise<void> {
  // Build a synthetic 1024x1024 PNG in-memory — this test stands alone.
  const source = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 96, g: 128, b: 160 },
    },
  })
    .png()
    .toBuffer();

  // 1-15: all 15 accepted aspect_ratio enum values crop to within 0.01 of target.
  for (const ratio of ALL_RATIOS) {
    const [rw, rh] = ratio.split(":").map(Number);
    const targetRatio = rw / rh;
    try {
      const cropped = await cropToExactAspectRatio(source, ratio);
      const meta = await sharp(cropped).metadata();
      const actualRatio = (meta.width ?? 0) / (meta.height ?? 1);
      const diff = Math.abs(actualRatio - targetRatio);
      if (diff <= 0.01) {
        pass(`cropToExactAspectRatio(source, "${ratio}") matches target ratio within 0.01 (actual=${actualRatio.toFixed(4)}, target=${targetRatio.toFixed(4)})`);
      } else {
        fail(
          `cropToExactAspectRatio(source, "${ratio}") ratio mismatch`,
          `actual=${actualRatio.toFixed(4)}, target=${targetRatio.toFixed(4)}, diff=${diff.toFixed(4)}`,
        );
      }
    } catch (err) {
      fail(`cropToExactAspectRatio(source, "${ratio}") threw`, String((err as Error)?.message ?? err));
    }
  }

  // 16: identity case — 1024x1024 source cropped to "1:1" returns the SAME
  // buffer bytes (no re-encode).
  try {
    const identityOut = await cropToExactAspectRatio(source, "1:1");
    if (Buffer.compare(identityOut, source) === 0) {
      pass('cropToExactAspectRatio(source, "1:1") returns identical bytes (no re-encode) for an already-square source');
    } else {
      fail('cropToExactAspectRatio(source, "1:1") should return identical bytes for an already-square source');
    }
  } catch (err) {
    fail('cropToExactAspectRatio(source, "1:1") threw', String((err as Error)?.message ?? err));
  }

  // 17-20: degenerate ratio strings never throw — original buffer returned.
  const degenerateRatios = ["abc", "0:1", "1:0", ""];
  for (const bad of degenerateRatios) {
    try {
      const out = await cropToExactAspectRatio(source, bad);
      if (Buffer.compare(out, source) === 0) {
        pass(`cropToExactAspectRatio(source, ${JSON.stringify(bad)}) returns input buffer unchanged, does not throw`);
      } else {
        fail(`cropToExactAspectRatio(source, ${JSON.stringify(bad)}) should return the input buffer unchanged`);
      }
    } catch (err) {
      fail(`cropToExactAspectRatio(source, ${JSON.stringify(bad)}) must not throw`, String((err as Error)?.message ?? err));
    }
  }

  // 21: parseAspectRatio("1200:628") deep-equals { w: 1200, h: 628 }.
  const parsed1200 = parseAspectRatio("1200:628");
  if (parsed1200 && parsed1200.w === 1200 && parsed1200.h === 628) {
    pass('parseAspectRatio("1200:628") deep-equals { w: 1200, h: 628 }');
  } else {
    fail('parseAspectRatio("1200:628") deep-equals { w: 1200, h: 628 }', `actual=${JSON.stringify(parsed1200)}`);
  }

  // 22: parseAspectRatio("nonsense") is null.
  const parsedNonsense = parseAspectRatio("nonsense");
  if (parsedNonsense === null) {
    pass('parseAspectRatio("nonsense") is null');
  } else {
    fail('parseAspectRatio("nonsense") is null', `actual=${JSON.stringify(parsedNonsense)}`);
  }

  const total = passed + failed;
  console.log(`\n${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unhandled error in test-aspect-crop.ts:", err);
  process.exit(1);
});
