// scripts/verify-phase-12.ts
// Phase 12 static + invocation verifier. Wave-2 baseline; extended by 12-05.
// Run: npx tsx scripts/verify-phase-12.ts
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const failures: string[] = [];
const ok: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) ok.push(name);
  else failures.push(`${name}${detail ? " — " + detail : ""}`);
}
function read(p: string) { return fs.readFileSync(p, "utf8"); }
function exists(p: string) { return fs.existsSync(p); }

// PROV-01: ImageProvider interface + Gemini class
const ip = read("server/services/image-provider.ts");
check("PROV-01 ImageProvider interface exported", /export interface ImageProvider\b/.test(ip));
check("PROV-01 GeminiImageProvider exported", /export class GeminiImageProvider\b/.test(ip));
check("PROV-01 OpenAIImageProvider exported", /export class OpenAIImageProvider\b/.test(ip));
check("PROV-01 getActiveImageProvider factory exported", /export async function getActiveImageProvider\b/.test(ip));

// PROV-02: Responses API, NOT images.edit, model = gpt-5.5
check("PROV-02 uses responses.create", /responses\.create\(/.test(ip));
check("PROV-02 image_generation tool referenced", /['\"]image_generation['\"]/.test(ip));
check("PROV-02 NEVER calls images.edit (SDK bug #1844)", !/images\.edit\(/.test(ip));
check("PROV-02 OPENAI_RESPONSES_MODEL = 'gpt-5.5' (per D-03)", /OPENAI_RESPONSES_MODEL\s*=\s*"gpt-5\.5"/.test(ip));

// PROV-03: converter exists AND has a runnable unit test that exits 0
check("PROV-03 toOpenAIInputImage converter exported", /export function toOpenAIInputImage\b/.test(ip));
check("PROV-03 converter emits data: URL", /data:\$\{[^}]+\.mimeType\};base64,/.test(ip));
check("PROV-03 unit-test script exists", exists("scripts/test-openai-converter.ts"));
if (exists("scripts/test-openai-converter.ts")) {
  const run = spawnSync("npx", ["tsx", "scripts/test-openai-converter.ts"], { encoding: "utf8", shell: true });
  check("PROV-03 unit-test script exits 0 (functional invocation)", run.status === 0, run.stderr || run.stdout);
}

// PROV-04: platform_settings helpers + factory reads setting + migration seeds
const app = read("server/services/app-settings.service.ts");
check("PROV-04 getPlatformSetting exported", /export async function getPlatformSetting\b/.test(app));
check("PROV-04 setPlatformSetting exported (uses upsert)",
  /export async function setPlatformSetting\b/.test(app) && /onConflict: ['\"]setting_key/.test(app));
check("PROV-04 factory reads image_provider key", /getPlatformSetting\(['\"]image_provider['\"]\)/.test(ip));
const mig = read("supabase/migrations/20260517_image_provider_settings.sql");
check("PROV-04 migration seeds gemini default", /'image_provider'\s*,\s*'"gemini"'::jsonb/.test(mig));

// PROV-06: migration column + Profile schema typing + key resolver
check("PROV-06 migration adds openai_api_key column", /ADD COLUMN IF NOT EXISTS openai_api_key/.test(mig));
const schema = read("shared/schema.ts");
check("PROV-06 profileSchema typed with openai_api_key",
  /openai_api_key:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/.test(schema));
const am = read("server/middleware/auth.middleware.ts");
check("PROV-06 getOpenAIApiKey exported", /export async function getOpenAIApiKey\b/.test(am));
// PROV-06: env-var fallback obsoleted by Phase 12.2 — see 12.2-C for new check
check("PROV-06 reads profile.openai_api_key", /openai_api_key/.test(am));

// ── PROV-07: all 4 flows route through factory (Wave 3 wiring from 12-04) ──
for (const f of [
  "server/routes/generate.routes.ts",
  "server/routes/edit.routes.ts",
  "server/routes/carousel.routes.ts",
  "server/routes/enhance.routes.ts",
]) {
  const src = read(f);
  check(`PROV-07 ${path.basename(f)} imports getActiveImageProvider`, /getActiveImageProvider/.test(src));
}
const car = read("server/services/carousel-generation.service.ts");
check("PROV-07 carousel service has imageProvider param", /imageProvider:\s*ImageProvider/.test(car));
check("PROV-07 carousel uses provider.generate / provider.edit", /imageProvider\.(generate|edit)\(/.test(car));
check("PROV-07 carousel has no direct GEMINI_BASE+IMAGE_MODEL fetch", !/GEMINI_BASE[^]*IMAGE_MODEL[^]*generateContent/.test(car));
const enh = read("server/services/enhancement.service.ts");
check("PROV-07 enhancement service has imageProvider param", /imageProvider:\s*ImageProvider/.test(enh));
check("PROV-07 enhancement uses provider.edit", /imageProvider\.edit\(/.test(enh));

// ── PROV-05: admin UI + admin route (Wave 4 from this plan) ──
const adminUI = read("client/src/components/admin/image-provider-section.tsx");
check("PROV-05 ImageProviderSection component exists", /export function ImageProviderSection/.test(adminUI));
check("PROV-05 component calls PATCH /api/admin/image-provider", /\/api\/admin\/image-provider/.test(adminUI));
const admRoutes = read("server/routes/admin.routes.ts");
check("PROV-05 admin GET + PATCH endpoint exists", (admRoutes.match(/\/api\/admin\/image-provider/g) ?? []).length >= 2);
check("PROV-05 admin PATCH calls setPlatformSetting('image_provider', ...)", /setPlatformSetting\(['\"]image_provider/.test(admRoutes));

// ── PROV-06 UI half (this plan) ──
const settingsUI = read("client/src/pages/settings.tsx");
check("PROV-06 settings.tsx exposes openai_api_key field", /openai_api_key/.test(settingsUI));
check("PROV-06 settings.tsx saves via direct supabase update (no new route)", /from\(['\"]profiles['\"]\)\.update/.test(settingsUI));

// ── Phase 12.1: per-user provider preference (admin/affiliate override) ───
const mig121 = read("supabase/migrations/20260517100000_profiles_image_provider.sql");
check("12.1-A migration adds profiles.image_provider column",
  /ADD COLUMN IF NOT EXISTS image_provider/.test(mig121));
check("12.1-B profileSchema has image_provider field",
  /image_provider:\s*z\.enum\(\["gemini",\s*"openai"\]\)/.test(schema));
check("12.1-C resolveImageProviderName exported", /export async function resolveImageProviderName/.test(ip));
check("12.1-D getActiveImageProvider accepts profile param",
  /getActiveImageProvider\(profile\?:\s*ProfileForProvider\)/.test(ip));
// CRITICAL: ensures profile.image_provider is actually loaded from DB on every request
for (const f of [
  "server/routes/generate.routes.ts",
  "server/routes/edit.routes.ts",
  "server/routes/carousel.routes.ts",
  "server/routes/enhance.routes.ts",
]) {
  const src = read(f);
  check(`12.1-E ${path.basename(f)} SELECTs image_provider from profiles`,
    /\.select\(['\"][^'\"]*image_provider[^'\"]*['\"]\)/.test(src));
}
check("12.1-F settings.tsx has provider-pref RadioGroup",
  /radiogroup-image-provider-pref/.test(settingsUI));
check("12.1-G settings.tsx writes null for 'global' selection",
  /imageProviderPref\s*===\s*['\"]global['\"]\s*\?\s*null/.test(settingsUI));

// ── Phase 12.3: tier model — admin shares platform key; only affiliates use own ──
check("12.3-A usesOwnApiKey returns is_affiliate ONLY (no admin)",
  /return\s+profile\?\.is_affiliate\s*===\s*true;\s*\}/.test(am));
check("12.3-B getGeminiApiKey error msg names affiliates (not admin)",
  /Affiliate accounts must configure their own Gemini API key/.test(am));
check("12.3-C getOpenAIApiKey error msg names affiliates (not admin)",
  /Affiliate accounts must configure their own OpenAI API key/.test(am));
check("12.3-D resolveImageProviderName scoped to affiliate only",
  /profile\.is_affiliate\s*===\s*true\s*&&\s*profile\.image_provider/.test(ip));
const quota = read("server/quota.ts");
check("12.3-E quota.ts dropped is_business from credit-bypass",
  /\.select\("is_admin,\s*is_affiliate"\)/.test(quota)
  && !/profile\?\.is_business/.test(quota));
check("12.3-F /settings has Gemini API Key input (mirrors OpenAI)",
  /data-testid="input-gemini-api-key"/.test(settingsUI));
check("12.3-G /settings has Save Gemini Key button",
  /data-testid="button-save-gemini-api-key"/.test(settingsUI));
check("12.3-H /settings local usesOwnApiKey is affiliate-only",
  /return\s+profile\?\.is_affiliate\s*===\s*true;\s*\}/.test(settingsUI));

// ── Phase 12.2: platform API keys moved from env to platform_settings ──────
const mig122 = read("supabase/migrations/20260517110000_platform_api_keys.sql");
check("12.2-A migration seeds gemini_api_key + openai_api_key rows",
  /gemini_api_key.*?openai_api_key/s.test(mig122));
check("12.2-B getGeminiApiKey reads from platform_settings (no env fallback)",
  /getPlatformDefaultApiKey\(['\"]gemini_api_key['\"]\)/.test(am)
  && !/process\.env\.GEMINI_API_KEY/.test(am));
check("12.2-C getOpenAIApiKey reads from platform_settings (no env fallback)",
  /getPlatformDefaultApiKey\(['\"]openai_api_key['\"]\)/.test(am)
  && !/process\.env\.OPENAI_API_KEY/.test(am));
check("12.2-D admin GET /api/admin/api-keys endpoint",
  /router\.get\(['\"]\/api\/admin\/api-keys['\"]/.test(admRoutes));
check("12.2-E admin PATCH /api/admin/api-keys endpoint",
  /router\.patch\(['\"]\/api\/admin\/api-keys['\"]/.test(admRoutes));
check("12.2-F admin response never includes raw key (preview only)",
  /gemini_preview|openai_preview/.test(admRoutes));
const platformKeysUI = read("client/src/components/admin/platform-api-keys-section.tsx");
check("12.2-G PlatformApiKeysSection component exists",
  /export function PlatformApiKeysSection/.test(platformKeysUI));
check("12.2-H PlatformApiKeysSection rendered in admin.tsx",
  /<PlatformApiKeysSection\s*\/>/.test(read("client/src/pages/admin.tsx")));

console.log(`\n=== Phase 12 verify (full) ===`);
console.log(`PASS: ${ok.length}`);
ok.forEach((n) => console.log(`  ✓ ${n}`));
if (failures.length) {
  console.log(`\nFAIL: ${failures.length}`);
  failures.forEach((n) => console.log(`  ✗ ${n}`));
  process.exit(1);
}
console.log(`\nAll PROV-01..07 + 12.1-A..G + 12.2-A..H + 12.3-A..H static + functional checks passed.`);
