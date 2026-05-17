// scripts/test-openai-converter.ts
// Unit test for PROV-03: toOpenAIInputImage converter.
// Run with: npx tsx scripts/test-openai-converter.ts
// Exits 0 on all-pass, 1 on any failure.

import { toOpenAIInputImage } from "../server/services/image-provider.js";

function assertDeepEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

// Test 1 — happy path PNG
assertDeepEqual(
  "toOpenAIInputImage(png) returns correct input_image block",
  toOpenAIInputImage({ mimeType: "image/png", data: "abc" }),
  { type: "input_image", image_url: "data:image/png;base64,abc" }
);

// Test 2 — JPEG mime preserved
assertDeepEqual(
  "toOpenAIInputImage(jpeg) preserves mime in data URL",
  toOpenAIInputImage({ mimeType: "image/jpeg", data: "xyz" }),
  { type: "input_image", image_url: "data:image/jpeg;base64,xyz" }
);

console.log("\nAll PROV-03 converter tests passed.");
