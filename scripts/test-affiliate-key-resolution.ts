// scripts/test-affiliate-key-resolution.ts
// Functional test for GATE-06 (SC2 + SC3). Guards 21.1-RESEARCH.md Pitfall 3 —
// fixing image-provider.ts without the route-level branch silently re-bills
// the platform. No network.
// Run with: npx tsx scripts/test-affiliate-key-resolution.ts
// Exits 0 on all-pass, 1 on any failure.

process.env.SUPABASE_URL ||= "https://fixture.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "fixture-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "fixture-service";
process.env.OPENROUTER_API_KEY = "sk-or-platform-fixture";

import { getOpenRouterApiKey, selectImageApiKey } from "../server/middleware/auth.middleware.js";

function assertEq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

async function main() {
  // 1. affiliate WITH key -> own key, no error
  const r1 = await getOpenRouterApiKey({ is_affiliate: true, openrouter_api_key: "sk-or-affiliate-fixture" });
  assertEq("affiliate WITH key returns own key", r1, { key: "sk-or-affiliate-fixture" });

  // 2. affiliate WITHOUT key -> exact SC3 error string, empty key
  const r2 = await getOpenRouterApiKey({ is_affiliate: true, openrouter_api_key: null });
  if (r2.key !== "") {
    console.error(`FAIL affiliate WITHOUT key returns empty key\n  actual key: ${JSON.stringify(r2.key)}`);
    process.exit(1);
  }
  if (
    r2.error !==
    "Affiliate accounts must configure their own OpenRouter API key in Settings before generating."
  ) {
    console.error(`FAIL affiliate WITHOUT key returns exact SC3 error string\n  actual: ${JSON.stringify(r2.error)}`);
    process.exit(1);
  }
  console.log("PASS affiliate WITHOUT key returns empty key + exact SC3 error string");

  // 3. affiliate WITHOUT key does NOT leak the platform key
  if (r2.key === "sk-or-platform-fixture") {
    console.error("FAIL affiliate WITHOUT key must not leak the platform key");
    process.exit(1);
  }
  console.log("PASS affiliate WITHOUT key does not leak the platform key");

  // 4. non-affiliate (regular user) -> platform key from env
  const r4 = await getOpenRouterApiKey({ is_affiliate: false });
  assertEq("non-affiliate returns the platform key", r4, { key: process.env.OPENROUTER_API_KEY });

  // 5. admin is NOT treated as own-key -> platform key, no error
  const r5 = await getOpenRouterApiKey({ is_admin: true, is_affiliate: false });
  assertEq("admin is NOT treated as own-key (uses platform key)", r5, { key: process.env.OPENROUTER_API_KEY });

  // 6. selectImageApiKey: openrouter wins with empty gemini key
  assertEq(
    "selectImageApiKey(openrouter) returns openRouterApiKey (empty geminiApiKey)",
    selectImageApiKey({ providerName: "openrouter", geminiApiKey: "", openRouterApiKey: "sk-or-affiliate-fixture" }),
    "sk-or-affiliate-fixture",
  );

  // 7. selectImageApiKey: openrouter wins over a non-empty gemini key (Pitfall 3 core assertion)
  assertEq(
    "selectImageApiKey(openrouter) wins over a non-empty geminiApiKey",
    selectImageApiKey({ providerName: "openrouter", geminiApiKey: "AIza-x", openRouterApiKey: "sk-or-affiliate-fixture" }),
    "sk-or-affiliate-fixture",
  );

  // 8. selectImageApiKey: gemini
  assertEq(
    "selectImageApiKey(gemini) returns geminiApiKey",
    selectImageApiKey({ providerName: "gemini", geminiApiKey: "AIza-x", openRouterApiKey: "sk-or-y" }),
    "AIza-x",
  );

  // 9. selectImageApiKey: openai
  assertEq(
    "selectImageApiKey(openai) returns openaiApiKey",
    selectImageApiKey({ providerName: "openai", geminiApiKey: "AIza-x", openRouterApiKey: "sk-or-y", openaiApiKey: "sk-oai-z" }),
    "sk-oai-z",
  );

  console.log("\nAll GATE-06 key-resolution tests passed.");
}

main();
