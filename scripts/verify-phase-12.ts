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
check("PROV-04 migration seeds gemini default", /'image_provider'\s*,\s*'gemini'/.test(mig));

// PROV-06: migration column + Profile schema typing + key resolver
check("PROV-06 migration adds openai_api_key column", /ADD COLUMN IF NOT EXISTS openai_api_key/.test(mig));
const schema = read("shared/schema.ts");
check("PROV-06 profileSchema typed with openai_api_key",
  /openai_api_key:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/.test(schema));
const am = read("server/middleware/auth.middleware.ts");
check("PROV-06 getOpenAIApiKey exported", /export async function getOpenAIApiKey\b/.test(am));
check("PROV-06 reads process.env.OPENAI_API_KEY", /process\.env\.OPENAI_API_KEY/.test(am));
check("PROV-06 reads profile.openai_api_key", /openai_api_key/.test(am));

// ── PROV-05 / PROV-07 checks are added by Plan 12-05 (Wave 4 extension) ──

console.log(`\n=== Phase 12 verify (Wave 2 baseline) ===`);
console.log(`PASS: ${ok.length}`);
ok.forEach((n) => console.log(`  ✓ ${n}`));
if (failures.length) {
  console.log(`\nFAIL: ${failures.length}`);
  failures.forEach((n) => console.log(`  ✗ ${n}`));
  process.exit(1);
}
console.log(`\nAll Wave-2 PROV checks passed (PROV-01..04 + PROV-06).`);
