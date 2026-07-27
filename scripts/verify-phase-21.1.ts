// scripts/verify-phase-21.1.ts
// Phase 21.1 (Affiliate BYOK Migration) static + functional verifier.
// Run: npx tsx scripts/verify-phase-21.1.ts
// Supports a --only=<substring> filter for fast per-task feedback, e.g.:
//   npx tsx scripts/verify-phase-21.1.ts --only=foundation-schema
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const failures: string[] = [];
const ok: string[] = [];

const onlyArg = process.argv.find((a) => /^--only=(.+)$/.test(a));
const only = onlyArg ? onlyArg.match(/^--only=(.+)$/)![1] : null;

function check(name: string, cond: boolean, detail = "") {
  if (only && !name.includes(only)) return;
  if (cond) ok.push(name);
  else failures.push(`${name}${detail ? " — " + detail : ""}`);
}
function read(p: string) { return fs.readFileSync(p, "utf8"); }
function exists(p: string) { return fs.existsSync(p); }
function readSafe(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

// Structural helper for Pitfall 1: a bare `getGeminiApiKey` at the top of a
// route (with no conditional affiliate gate) would lock out every new
// affiliate. `gateIsConditional` requires that `await getOpenRouterApiKey(`
// is present and, when `await getGeminiApiKey(` is also present, that the
// affiliate branch is resolved first inside an if/else (not two bare calls).
function gateIsConditional(src: string): boolean {
  const orIdx = src.search(/await getOpenRouterApiKey\(/);
  const gemIdx = src.search(/await getGeminiApiKey\(/);
  if (orIdx < 0) return false;            // affiliate gate missing entirely
  if (gemIdx < 0) return true;            // gemini gate removed entirely — also acceptable
  if (orIdx > gemIdx) return false;       // affiliate branch must be resolved first
  return /\}\s*else\s*\{/.test(src.slice(orIdx, gemIdx));  // must be an if/else, not two bare calls
}

// ── [self-test] ──
check("[self-test] harness executes", true);

// ── [foundation-schema] ──
const MIGRATION_PATH = "supabase/migrations/20260727000000_profiles_openrouter_api_key.sql";
check("[foundation-schema] migration file exists", exists(MIGRATION_PATH));
const mig = readSafe(MIGRATION_PATH);
check(
  "[foundation-schema] migration is additive ADD COLUMN IF NOT EXISTS openrouter_api_key",
  /ADD COLUMN IF NOT EXISTS openrouter_api_key/.test(mig),
);
check("[foundation-schema] migration drops nothing", !/DROP\s+(COLUMN|TABLE)/i.test(mig));
const schema = readSafe("shared/schema.ts");
check(
  "[foundation-schema] profileSchema has openrouter_api_key",
  /openrouter_api_key:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/.test(schema),
);
check(
  "[foundation-schema] profileSchema retains api_key + openai_api_key (dead, not dropped)",
  /\bapi_key:\s*z\.string\(\)/.test(schema) && /openai_api_key:\s*z\.string\(\)/.test(schema),
);

// ── [foundation-resolver] ──
const auth = readSafe("server/middleware/auth.middleware.ts");
check(
  "[foundation-resolver] getOpenRouterApiKey exported",
  /export async function getOpenRouterApiKey\b/.test(auth),
);
check(
  "[foundation-resolver] getOpenRouterApiKey gated by usesOwnApiKey",
  /usesOwnApiKey\(profile\)/.test(auth),
);
check(
  "[foundation-resolver] exact SC3 missing-key error string",
  auth.includes("Affiliate accounts must configure their own OpenRouter API key in Settings before generating."),
);
check(
  "[foundation-resolver] platform tier reads config.OPENROUTER_API_KEY (single source of truth)",
  /config\.OPENROUTER_API_KEY/.test(auth) && !/getPlatformDefaultApiKey\(["']openrouter/.test(auth),
);
check(
  "[foundation-resolver] selectImageApiKey exported (pure)",
  /export function selectImageApiKey\b/.test(auth),
);

// ── [functional] ──
const FUNCTIONAL_TEST_PATH = "scripts/test-affiliate-key-resolution.ts";
check("[functional] test-affiliate-key-resolution.ts exists", exists(FUNCTIONAL_TEST_PATH));
if (exists(FUNCTIONAL_TEST_PATH)) {
  const run = spawnSync("npx", ["tsx", FUNCTIONAL_TEST_PATH], { encoding: "utf8", shell: true });
  check("[functional] test-affiliate-key-resolution.ts exits 0", run.status === 0, run.stderr || run.stdout);
}

// ── [svc-image-provider] (plan 02) ──
const ip = readSafe("server/services/image-provider.ts");
check(
  "[svc-image-provider] OpenRouterImageProvider prefers caller key in generate + edit",
  (ip.match(/apiKey: input\.apiKey \|\| requireOpenRouterKey\(\)/g) || []).length >= 2,
);
check(
  "[svc-image-provider] stale \"affiliate keys land in Phase 21.1\" TODO comment removed",
  !/Affiliate BYO OpenRouter keys land in Phase 21\.1/.test(ip),
);

// ── [svc-gemini] (plan 02) ──
const gs = readSafe("server/services/gemini.service.ts");
check(
  "[svc-gemini] GeminiService constructor accepts openRouterApiKey",
  /constructor\(apiKey\?: string, openRouterApiKey\?: string\)/.test(gs),
);
check(
  "[svc-gemini] createGeminiService forwards openRouterApiKey",
  /export function createGeminiService\(apiKey\?: string, openRouterApiKey\?: string\)/.test(gs),
);
check(
  "[svc-gemini] both openrouter branches use the threaded key",
  (gs.match(/this\.openRouterApiKey \|\| config\.OPENROUTER_API_KEY/g) || []).length >= 2,
);
check(
  "[svc-gemini] no bare config.OPENROUTER_API_KEY left",
  !/apiKey: config\.OPENROUTER_API_KEY/.test(gs) && !/const orKey = config\.OPENROUTER_API_KEY;/.test(gs),
);
check(
  "[svc-gemini] GATE-07 direct-rollback affiliate limitation documented",
  /GATE-07 rollback limitation/.test(gs),
);

// ── [svc-caption] (plan 03) ──
const cq = readSafe("server/services/caption-quality.service.ts");
check(
  "[svc-caption] callGeminiForCaption + ensureCaptionQuality accept openRouterApiKey",
  (cq.match(/openRouterApiKey\?: string/g) || []).length >= 2,
);
check(
  "[svc-caption] gateway branch uses the threaded key",
  /params\.openRouterApiKey \|\| config\.OPENROUTER_API_KEY/.test(cq),
);
check(
  "[svc-caption] all 3 internal callGeminiForCaption calls thread the key",
  (cq.match(/openRouterApiKey: params\.openRouterApiKey/g) || []).length >= 3,
);

// ── [svc-carousel] (plan 03) ──
const cg = readSafe("server/services/carousel-generation.service.ts");
check("[svc-carousel] CarouselGenerationParams has openRouterApiKey", /openRouterApiKey\?: string/.test(cg));
check(
  "[svc-carousel] master-plan call uses the threaded key",
  /params\.openRouterApiKey \|\| config\.OPENROUTER_API_KEY/.test(cg),
);
check(
  "[svc-carousel] ensureCaptionQuality receives openRouterApiKey",
  /openRouterApiKey: params\.openRouterApiKey/.test(cg),
);

// ── [svc-enhancement] (plan 03) ──
const en = readSafe("server/services/enhancement.service.ts");
check("[svc-enhancement] EnhancementParams has openRouterApiKey", /openRouterApiKey\?: string/.test(en));
check(
  "[svc-enhancement] runPreScreen + generateEnhancementCaption use the threaded key",
  (en.match(/openRouterApiKey \|\| config\.OPENROUTER_API_KEY/g) || []).length >= 2,
);
check(
  "[svc-enhancement] both internal call sites pass params.openRouterApiKey",
  (en.match(/openRouterApiKey: params\.openRouterApiKey/g) || []).length >= 2,
);

// ── Route checks (plans 04/05/06) ──
const routeEntries: Array<[string, string, boolean]> = [
  ["route-generate", "server/routes/generate.routes.ts", true],
  ["route-edit", "server/routes/edit.routes.ts", true],
  ["route-carousel", "server/routes/carousel.routes.ts", true],
  ["route-enhance", "server/routes/enhance.routes.ts", true],
  ["route-transcribe", "server/routes/transcribe.routes.ts", false],
  ["route-remake-caption", "server/routes/posts.routes.ts", false],
];

for (const [tag, file, selectsImageKey] of routeEntries) {
  const src = readSafe(file);
  check(
    `[${tag}] profile SELECT includes openrouter_api_key`,
    /select\("[^"]*openrouter_api_key[^"]*"\)/.test(src),
  );
  check(
    `[${tag}] affiliate gate is conditional (Pitfall 1 — no bare getGeminiApiKey at top)`,
    gateIsConditional(src),
  );
  if (selectsImageKey) {
    check(
      `[${tag}] image key selected via selectImageApiKey`,
      /selectImageApiKey\(/.test(src),
    );
  }
}

// File-specific checks
const carousel = readSafe("server/routes/carousel.routes.ts");
check(
  "[route-carousel] both handlers select the image key (generate + slide-edit)",
  (carousel.match(/selectImageApiKey\(/g) || []).length >= 2,
);
const tr = readSafe("server/routes/transcribe.routes.ts");
check(
  "[route-transcribe] no bare platform-key read left",
  !/const orKey = config\.OPENROUTER_API_KEY;/.test(tr),
);
const gen = readSafe("server/routes/generate.routes.ts");
check(
  "[route-generate] video branch keeps the direct-Google Gemini key + guards it (GATE-08 carve-out)",
  /apiKey: geminiApiKey,/.test(gen)
    && gen.includes("Video generation requires a Gemini API key.")
    && /await getGeminiApiKey\(/.test(gen),
);
const ed = readSafe("server/routes/edit.routes.ts");
check(
  "[route-edit] video branch keeps the direct-Google Gemini key + guards it (GATE-08 carve-out)",
  /apiKey: geminiApiKey,/.test(ed)
    && ed.includes("Video generation requires a Gemini API key.")
    && /await getGeminiApiKey\(/.test(ed),
);

// ── UI + regression checks (plan 07) ──
const st = readSafe("client/src/pages/settings.tsx");
check(
  "[ui-settings] OpenRouter key card gated on usesOwnApiKey",
  /usesOwnApiKey\(profile\)/.test(st) && /input-openrouter-api-key/.test(st),
);
check(
  "[ui-settings] saves to profiles.openrouter_api_key",
  /\.update\(\{ openrouter_api_key: key \|\| null \}\)/.test(st),
);
check(
  "[ui-settings] Gemini key input RETAINED for affiliates and relabeled video-only (CONTEXT lock)",
  /data-testid="input-gemini-api-key"/.test(st)
    && st.includes("Gemini API key (used for video generation only)"),
);
check(
  "[ui-settings] OpenAI key input removed from affiliate UI",
  !/data-testid="input-openai-api-key"/.test(st),
);

check(
  "[regression] verify-phase-21.ts still exits 0",
  spawnSync("npx", ["tsx", "scripts/verify-phase-21.ts"], { encoding: "utf8", shell: true }).status === 0,
);

if (only) {
  console.log(`=== Phase 21.1 verify (filter: ${only}) ===`);
} else {
  console.log(`\n=== Phase 21.1 verify ===`);
}
console.log(`PASS: ${ok.length}`);
ok.forEach((n) => console.log(`  ✓ ${n}`));
if (failures.length) {
  console.log(`\nFAIL: ${failures.length}`);
  failures.forEach((n) => console.log(`  ✗ ${n}`));
  process.exit(1);
}
console.log(`\nAll Phase 21.1 checks passed.`);
