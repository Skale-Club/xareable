// scripts/verify-phase-21.ts
// Phase 21 (OpenRouter Gateway Foundation) static + functional verifier.
// Run: npx tsx scripts/verify-phase-21.ts
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const failures: string[] = [];
const ok: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) ok.push(name);
  else failures.push(`${name}${detail ? " — " + detail : ""}`);
}
function read(p: string) { return fs.readFileSync(p, "utf8"); }
function exists(p: string) { return fs.existsSync(p); }

// ── GATE-08: video pipeline freeze guard (REAL from Wave 1 — nothing in this
// phase should ever change server/services/video-generation.service.ts) ──
const VIDEO_SVC_PATH = "server/services/video-generation.service.ts";
const VIDEO_SVC_BASELINE_SHA256 = "1b47b62a50cb12d6cc427ddc16923cb5aa745cab265b85e03b1464b9183c7daf";
const videoSvc = read(VIDEO_SVC_PATH);
const videoSvcHash = createHash("sha256").update(videoSvc).digest("hex");
check(
  "GATE-08 video-generation.service.ts byte-identical to pre-phase baseline",
  videoSvcHash === VIDEO_SVC_BASELINE_SHA256,
  `expected ${VIDEO_SVC_BASELINE_SHA256}, got ${videoSvcHash}`,
);
check("GATE-08 video-generation.service.ts has zero OpenRouter references", !/openrouter/i.test(videoSvc));
check(
  "GATE-08 video-generation.service.ts still targets generativelanguage.googleapis.com",
  /generativelanguage\.googleapis\.com/.test(videoSvc),
);

// ── GATE-01: text/planning call sites migrated to the gateway ──
const gw = read("server/services/ai-gateway.service.ts");
check("GATE-01 gateway exposes chatCompletion", /export async function chatCompletion\b/.test(gw));
for (const f of [
  "server/services/gemini.service.ts",
  "server/services/carousel-generation.service.ts",
  "server/services/caption-quality.service.ts",
  "server/services/enhancement.service.ts",
]) {
  const src = read(f);
  check(`GATE-01 ${path.basename(f)} imports gateway chatCompletion`, /from ["']\.\/ai-gateway\.service\.js["']/.test(src) || /chatCompletion/.test(src));
  check(`GATE-01/GATE-07 ${path.basename(f)} branches on getCallRouting`, /getCallRouting\(/.test(src));
}

// ── GATE-02: dedicated Image API + preserved ImageProvider interface ──
check("GATE-02 gateway targets openrouter.ai/api/v1/images", /openrouter\.ai\/api\/v1\/images/.test(gw));
check("GATE-02 top-level aspect_ratio + resolution passed", /aspect_ratio/.test(gw) && /resolution/.test(gw));
const ip = read("server/services/image-provider.ts");
check("GATE-02 OpenRouterImageProvider implements ImageProvider", /class OpenRouterImageProvider implements ImageProvider/.test(ip));
check("GATE-02 ImageProvider interface preserved (generate + edit)", /generate\(input: ImageGenerationInput\)/.test(ip) && /edit\(input: ImageEditInput\)/.test(ip));
check("GATE-02 adapter functional test exists", exists("scripts/test-openrouter-image-adapter.ts"));
if (exists("scripts/test-openrouter-image-adapter.ts")) {
  const run = spawnSync("npx", ["tsx", "scripts/test-openrouter-image-adapter.ts"], { encoding: "utf8", shell: true });
  check("GATE-02 adapter test exits 0 (functional)", run.status === 0, run.stderr || run.stdout);
}

// ── GATE-03: transcription via gateway ──
const tr = read("server/routes/transcribe.routes.ts");
check("GATE-03 transcribe route uses gateway transcribe()", /aiGatewayTranscribe|from ["']\.\.\/services\/ai-gateway\.service\.js["']/.test(tr));
check("GATE-03/GATE-07 transcribe route branches on getCallRouting", /getCallRouting\(["']transcription["']\)/.test(tr));

// ── GATE-04: fallback chains + slug config + toggle retired ──
const gws = read("server/services/ai-gateway-settings.service.ts");
check("GATE-04 getFallbackChain exported", /export async function getFallbackChain\b/.test(gws));
check("GATE-04 fallback loop logs model_fallback", /model_fallback/.test(gw));
check("GATE-04 event_kind Zod enum includes model_fallback", /model_fallback/.test(read("shared/schema.ts")));
check("GATE-04 seed migration exists", exists("supabase/migrations/20260718000000_ai_gateway_settings.sql"));
check("GATE-04 image_provider toggle no longer read by factory", !/getPlatformSetting\(["']image_provider["']\)/.test(ip));

// ── GATE-05: real cost into billing ──
const quota = read("server/quota.ts");
check("GATE-05 recordUsageEvent has realCostUsdMicros param", /realCostUsdMicros\?: number/.test(quota));
check("GATE-05 recordUsageEvent has estimatedCostMicros param", /estimatedCostMicros\?: number/.test(quota));
check("GATE-05 markup applied to real cost", /getMarkupMultiplier\(userId\)/.test(quota));
check("GATE-05 estimate+actual stored in metadata", /metadata: hasGatewayMeta/.test(quota));
check("GATE-05 usage_events.metadata migration exists", exists("supabase/migrations/20260718000001_usage_events_metadata.sql"));
for (const [f, marker] of [
  ["server/routes/generate.routes.ts", /estimated_cost_micros/],
  ["server/routes/edit.routes.ts", /editCostUsdMicros/],
  ["server/routes/carousel.routes.ts", /costUsdMicrosTotal/],
  ["server/routes/enhance.routes.ts", /costUsdMicrosTotal/],
  ["server/routes/transcribe.routes.ts", /gatewayCostUsdMicros/],
] as const) {
  check(`GATE-05 ${path.basename(f as string)} passes gateway cost`, (marker as RegExp).test(read(f as string)));
}

// ── GATE-07: rollback plumbing ──
check("GATE-07 getCallRouting exported", /export async function getCallRouting\b/.test(gws));
check("GATE-07 setCallRouting exported", /export async function setCallRouting\b/.test(gws));
check("GATE-07 image factory branches on routing", /getCallRouting\(["']image["']\)/.test(ip));
const adminSettings = read("server/routes/admin-settings.routes.ts");
check("GATE-07 admin routing endpoints exist", (adminSettings.match(/\/api\/admin\/ai-gateway-routing/g) ?? []).length >= 2);
check("GATE-04 admin fallback endpoints exist", (adminSettings.match(/\/api\/admin\/ai-model-fallbacks/g) ?? []).length >= 2);

// ── POL-01: isVideo threaded into edit credit gate ──
const editR = read("server/routes/edit.routes.ts");
check("POL-01 edit checkCredits passes isVideoPost", /checkCredits\(user\.id,\s*["']edit["'],\s*isVideoPost\)/.test(editR));

// ── POL-07: zero query-string API keys anywhere in server/ ──
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}
const keyOffenders = walkTs("server").filter((f) => /[?&]key=\$\{/.test(read(f)));
check("POL-07 zero ?key= query-string keys in server/", keyOffenders.length === 0, keyOffenders.join(", "));

// ── CRSL2-03: slide-1 failure breaks the loop ──
const car = read("server/services/carousel-generation.service.ts");
check("CRSL2-03 slide-1 failure breaks immediately", /if \(i === 0\) \{[\s\S]{0,600}?break;/.test(car));

console.log(`\n=== Phase 21 verify ===`);
console.log(`PASS: ${ok.length}`);
ok.forEach((n) => console.log(`  ✓ ${n}`));
if (failures.length) {
  console.log(`\nFAIL: ${failures.length}`);
  failures.forEach((n) => console.log(`  ✗ ${n}`));
  process.exit(1);
}
console.log(`\nAll Phase 21 checks passed.`);
