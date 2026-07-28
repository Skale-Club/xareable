// scripts/test-logo-overlay-contrast.ts
// Functional test for POL-03 (Phase 26, plan 26-07): the contrast- and
// alpha-aware applyLogoOverlay/applyLogoOverlayDetailed rewrite in
// server/services/image-optimization.service.ts. Mirrors
// scripts/test-typography-treatment.ts's no-network unit-harness convention
// (numbered PASS/FAIL, failure count, process.exit(1) on any failure).
// Standalone, no network. Run with: npx tsx scripts/test-logo-overlay-contrast.ts

import fs from "node:fs";
import sharp from "sharp";

import {
  applyLogoOverlayDetailed,
  type LogoOverlayResult,
} from "../server/services/image-optimization.service.js";

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

function assertTrue(condition: boolean, label: string, detail?: string): void {
  if (condition) pass(label);
  else fail(label, detail);
}

const LOGO_OPAQUE_JPEG = fs.readFileSync("tests/fixtures/logo/logo-opaque-256.jpg");
const LOGO_ALPHA_PNG = fs.readFileSync("tests/fixtures/logo/logo-alpha-256.png");
const QUAD_CORNERS = fs.readFileSync("tests/fixtures/logo/quad-corners-1024.png");
const HIGH_CONTRAST_FLAT = fs.readFileSync("tests/fixtures/typography/high-contrast-1024.png");
const LOW_CONTRAST_FLAT = fs.readFileSync("tests/fixtures/typography/low-contrast-1024.png");

async function main(): Promise<void> {
  // 1. Fixture sanity: logo-opaque-256.jpg has no alpha, 3 channels — if this
  // fails, every downstream assertion is meaningless.
  const jpegMeta = await sharp(LOGO_OPAQUE_JPEG).metadata();
  assertTrue(
    jpegMeta.hasAlpha === false && jpegMeta.channels === 3,
    "1. logo-opaque-256.jpg metadata: hasAlpha === false, channels === 3",
    JSON.stringify({ hasAlpha: jpegMeta.hasAlpha, channels: jpegMeta.channels }),
  );

  // 2. Fixture sanity: logo-alpha-256.png has an alpha channel.
  const pngMeta = await sharp(LOGO_ALPHA_PNG).metadata();
  assertTrue(
    pngMeta.hasAlpha === true,
    "2. logo-alpha-256.png metadata: hasAlpha === true",
    JSON.stringify({ hasAlpha: pngMeta.hasAlpha }),
  );

  // 3. position omitted => autoSelected === true and the chosen corner is one
  // of the two scrimNeeded===false quadrants (top-left/bottom-left tie on
  // stdev=0; array order makes bottom-left win) — NEVER the legacy
  // bottom-right default, and never a scrimNeeded quadrant.
  const autoResult = await applyLogoOverlayDetailed(QUAD_CORNERS, LOGO_OPAQUE_JPEG, undefined);
  assertTrue(
    autoResult.autoSelected === true &&
      ["top-left", "bottom-left"].includes(autoResult.position) &&
      autoResult.position !== "bottom-right",
    "3. auto-selection on quad-corners + opaque JPEG: autoSelected true, chosen position is a non-scrim quadrant, never the legacy bottom-right default",
    `position=${autoResult.position}, autoSelected=${autoResult.autoSelected}`,
  );

  // 4. position supplied => that exact position is used, autoSelected ===
  // false, even though it lands on the busy checkerboard quadrant (a
  // strictly worse score than the other three corners).
  const explicitResult = await applyLogoOverlayDetailed(QUAD_CORNERS, LOGO_OPAQUE_JPEG, "bottom-right");
  assertTrue(
    explicitResult.position === "bottom-right" && explicitResult.autoSelected === false,
    "4. explicit position 'bottom-right' survives even though it lands on the busy checkerboard quadrant",
    JSON.stringify({ position: explicitResult.position, autoSelected: explicitResult.autoSelected }),
  );

  // 5. No-alpha logo (JPEG) => plateApplied === true regardless of background
  // contrast (high-contrast-1024.png is a clean, flat, high-contrast fixture).
  const noAlphaOnClean = await applyLogoOverlayDetailed(HIGH_CONTRAST_FLAT, LOGO_OPAQUE_JPEG, "bottom-right");
  assertTrue(
    noAlphaOnClean.logoHasAlpha === false && noAlphaOnClean.plateApplied === true,
    "5. no-alpha (JPEG) logo on a clean high-contrast background still gets a plate",
    JSON.stringify({ logoHasAlpha: noAlphaOnClean.logoHasAlpha, plateApplied: noAlphaOnClean.plateApplied }),
  );

  // 6. Alpha PNG on a clean, high-contrast background => plateApplied ===
  // false. Kept for reuse by assertion 8's byte proof.
  const alphaOnClean = await applyLogoOverlayDetailed(HIGH_CONTRAST_FLAT, LOGO_ALPHA_PNG, "bottom-right");
  assertTrue(
    alphaOnClean.logoHasAlpha === true && alphaOnClean.plateApplied === false,
    "6. alpha PNG logo on a clean high-contrast background gets NO plate",
    JSON.stringify({ logoHasAlpha: alphaOnClean.logoHasAlpha, plateApplied: alphaOnClean.plateApplied }),
  );

  // 7. Alpha PNG on a mid-grey (scrimNeeded) background => plateApplied ===
  // true — contrast-driven, not alpha-driven.
  const alphaOnLow = await applyLogoOverlayDetailed(LOW_CONTRAST_FLAT, LOGO_ALPHA_PNG, "bottom-right");
  assertTrue(
    alphaOnLow.plateApplied === true,
    "7. alpha PNG logo on a low-contrast background gets a plate (contrast-driven, not alpha-driven)",
    JSON.stringify({ plateApplied: alphaOnLow.plateApplied }),
  );

  // 8. NO-REGRESSION BYTE PROOF for assertion 6's case: re-implement the
  // legacy recipe inline (same resize/margin math as the pre-Phase-26
  // implementation) and assert byte-identity — proves the common
  // good-PNG-good-background path did not change.
  const baseWidth = 1024;
  const baseHeight = 1024;
  const targetLogoWidth = Math.max(64, Math.round(baseWidth * 0.14));
  const margin = Math.max(24, Math.round(Math.min(baseWidth, baseHeight) * 0.06));
  const preparedLogo = await sharp(LOGO_ALPHA_PNG)
    .resize({ width: targetLogoWidth, withoutEnlargement: true, fit: "inside" })
    .png()
    .toBuffer();
  const preparedLogoMeta = await sharp(preparedLogo).metadata();
  const logoWidth = preparedLogoMeta.width || targetLogoWidth;
  const logoHeight = preparedLogoMeta.height || targetLogoWidth;
  const legacyLeft = Math.max(0, baseWidth - logoWidth - margin);
  const legacyTop = Math.max(0, baseHeight - logoHeight - margin);
  const legacyBuffer = await sharp(HIGH_CONTRAST_FLAT)
    .composite([{ input: preparedLogo, blend: "over", top: legacyTop, left: legacyLeft }])
    .toBuffer();
  assertTrue(
    Buffer.compare(alphaOnClean.buffer, legacyBuffer) === 0,
    "8. NO-REGRESSION BYTE PROOF: the untreated (alpha-on-clean-background) path is byte-identical to the legacy positional-only composite",
  );

  // 9. Output dimensions always equal input dimensions, across every case
  // exercised above.
  const dimensionCases: Array<{ base: Buffer; result: LogoOverlayResult }> = [
    { base: HIGH_CONTRAST_FLAT, result: noAlphaOnClean },
    { base: HIGH_CONTRAST_FLAT, result: alphaOnClean },
    { base: LOW_CONTRAST_FLAT, result: alphaOnLow },
    { base: QUAD_CORNERS, result: autoResult },
  ];
  let dimensionsMatch = true;
  for (const { base, result } of dimensionCases) {
    const baseMeta = await sharp(base).metadata();
    const outMeta = await sharp(result.buffer).metadata();
    if (outMeta.width !== baseMeta.width || outMeta.height !== baseMeta.height) {
      dimensionsMatch = false;
    }
  }
  assertTrue(dimensionsMatch, "9. every result's output width/height equals the base image's dimensions");

  // 10. A garbage (non-image) logo buffer resolves (does not reject) and
  // returns the base buffer unchanged rather than throwing.
  const garbage = Buffer.from("not an image");
  const garbageResult = await applyLogoOverlayDetailed(HIGH_CONTRAST_FLAT, garbage, "bottom-right");
  assertTrue(
    Buffer.compare(garbageResult.buffer, HIGH_CONTRAST_FLAT) === 0,
    "10. a garbage (non-image) logo buffer resolves (does not reject) and returns the base buffer unchanged",
  );

  const total = passed + failed;
  console.log(`\n${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unhandled error in test-logo-overlay-contrast.ts:", err);
  process.exit(1);
});
