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

/*
 * ── MANUAL/LIVE VERIFICATION RUNBOOK (Phase 21.1 / GATE-06) ──
 * Not automatable: requires a real SECOND OpenRouter account (the affiliate's)
 * with its own credit balance. Mirrors Phase 21's GATE-04/GATE-07 manual-step
 * precedent. Run once before /gsd:verify-work and record the outcome.
 *
 * 0. MIGRATION APPLIED (blocking prerequisite)
 *    Run supabase/migrations/20260727000000_profiles_openrouter_api_key.sql in
 *    the Supabase SQL editor (project convention since Phase 11 — Drizzle
 *    db:push is skipped for Supabase-native migrations). Confirm with:
 *      select column_name from information_schema.columns
 *       where table_name = 'profiles' and column_name = 'openrouter_api_key';
 *    Also confirm api_key (still LIVE for video) and openai_api_key (dead) are
 *    STILL present.
 *
 * 1. SC1 — PROVISIONING + ROTATION
 *    a. Sign in as an is_affiliate=true account. Settings → Account.
 *    b. Confirm exactly TWO API-key cards are visible, in this order:
 *         1) "OpenRouter API Key"
 *         2) "Gemini API Key (video only)"
 *       (The OpenAI key card and the AI Image Provider radio card must be gone.)
 *    c. Paste the affiliate's real sk-or-v1-... key in the OpenRouter card, Save.
 *       Toast confirms.
 *    d. Reload; the field repopulates from profiles.openrouter_api_key.
 *    e. ROTATION: paste a second valid key from the same account, Save,
 *       generate a post, confirm it succeeds on the new key.
 *
 * 2. SC3 — CLEAR ERROR, NOT A SILENT 401
 *    a. Clear the affiliate's OpenRouter key (empty the field, Save → column
 *       becomes NULL). Leave the Gemini key alone.
 *    b. Attempt each surface: generate (image), edit, carousel, slide-edit,
 *       enhance, transcribe, remake-caption.
 *    c. Each must return HTTP 400 with EXACTLY:
 *       "Affiliate accounts must configure their own OpenRouter API key in
 *        Settings before generating."
 *       BEFORE the SSE stream opens (check the Network tab: a JSON 400
 *       response, not a text/event-stream that errors mid-flight).
 *    d. Restore the OpenRouter key.
 *
 * 3. SC2 — BILLING ATTRIBUTION (the reason this phase exists)
 *    a. Note the PLATFORM OpenRouter account's credit balance and the
 *       AFFILIATE account's credit balance.
 *    b. As the affiliate, generate one single-image post and one carousel.
 *    c. Confirm the AFFILIATE balance dropped and the PLATFORM balance did NOT.
 *    d. Confirm the affiliate's OpenRouter activity log shows those requests.
 *    e. Confirm no deductCredits ran for the affiliate (internal ledger
 *       unchanged — the pre-existing !ownApiKey guard).
 *
 * 4. SC2 — SIMULATED FAILURE / PROVIDER PINNING
 *    NOTE: "provider pinning" here is a VERIFICATION TECHNIQUE, not a request
 *    parameter. Do NOT add provider.only / allow_fallbacks to any call — which
 *    OpenRouter account is billed is determined solely by the Authorization
 *    key, independent of the upstream provider OpenRouter internally selects.
 *    a. Temporarily set style_catalog.ai_models.text_generation to a bogus slug
 *       (e.g. "google/nonexistent-model") AND set the text fallback chain to a
 *       second bogus slug via PATCH /api/admin/ai-model-fallbacks, so the whole
 *       chain fails for the affiliate's request.
 *    b. Generate as the affiliate. The call must fail cleanly.
 *    c. Confirm the PLATFORM balance is UNCHANGED — the failure must not have
 *       retried against the platform key.
 *    d. Restore the slug and the fallback chain.
 *
 * 5. AFFILIATE VIDEO REGRESSION (GATE-08 carve-out — do NOT skip)
 *    Video is a direct-Google (Veo) call, not an OpenRouter gateway call, so it
 *    still runs on profiles.api_key. This step proves the migration did not
 *    silently break a live, billed affiliate feature.
 *    a. With BOTH keys set, generate one video as the affiliate → must succeed.
 *    b. Edit that video post (quick remake) as the affiliate → must succeed.
 *    c. Clear ONLY the Gemini key (Save → profiles.api_key NULL). Attempt a
 *       video generation: expect HTTP 400 JSON, pre-SSE, with EXACTLY:
 *       "Video generation requires a Gemini API key. Add yours in Settings →
 *        Gemini API key (used for video generation only)."
 *    d. With the Gemini key still cleared, generate one IMAGE post → must still
 *       SUCCEED (image work needs only the OpenRouter key). This is the
 *       no-lockout proof (SC1).
 *    e. Restore the Gemini key.
 *
 * 6. NON-AFFILIATE REGRESSION
 *    As a regular (non-affiliate, non-admin) user and as an admin, generate one
 *    post each. Both must still succeed on the platform OPENROUTER_API_KEY.
 *
 * 7. GATE-07 ROLLBACK LIMITATION (documented, accepted — do not "fix")
 *    Flipping ai_gateway_routing.planning to "direct" throws for any affiliate
 *    who left the (now optional, video-scoped) Settings Gemini field empty, and
 *    degrades to buildTextFallback. See the comment in gemini.service.ts
 *    generateText. If a "direct" rollback must persist with active affiliates,
 *    ask them to fill in the Settings Gemini key field, or backfill
 *    profiles.api_key for them via direct DB access.
 */
