// scripts/test-openrouter-image-adapter.ts
// Functional test for GATE-02: toOpenRouterInputReference adapter.
// Guards the 21-RESEARCH.md "input_references shape mismatch" pitfall — a
// wrong shape silently produces reference-less generations.
// Run with: npx tsx scripts/test-openrouter-image-adapter.ts
// Exits 0 on all-pass, 1 on any failure. No network.

import { toOpenRouterInputReference } from "../server/services/ai-gateway.service.js";

function assertDeepEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

// Test 1 — happy path PNG: content-block object shape, NOT a bare string
assertDeepEqual(
  "toOpenRouterInputReference(png) returns { type: 'image_url', image_url: { url } }",
  toOpenRouterInputReference({ mimeType: "image/png", data: "abc" }),
  { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
);

// Test 2 — WEBP mime preserved (carousel slide-1 refs are webp)
assertDeepEqual(
  "toOpenRouterInputReference(webp) preserves mime in data URL",
  toOpenRouterInputReference({ mimeType: "image/webp", data: "xyz" }),
  { type: "image_url", image_url: { url: "data:image/webp;base64,xyz" } },
);

// Test 3 — url is NESTED under image_url (OpenRouter Image API shape), not
// flat like the OpenAI Responses-API converter (toOpenAIInputImage) — the
// two adapters MUST NOT be conflated.
const out = toOpenRouterInputReference({ mimeType: "image/jpeg", data: "q" }) as any;
if (typeof out.image_url !== "object" || typeof out.image_url.url !== "string") {
  console.error("FAIL image_url must be an object with a nested url string");
  process.exit(1);
}
console.log("PASS image_url nesting matches OpenRouter Image API (not OpenAI Responses shape)");

console.log("\nAll GATE-02 adapter tests passed.");
