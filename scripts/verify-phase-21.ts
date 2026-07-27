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

// ── Stub checks — each is flipped from `false` to a real assertion by
// 21-13-PLAN.md ("Final verify wiring"), once every requirement's
// implementing plan has landed. Do NOT edit these stubs in any plan other
// than 21-13 — every other Phase 21 plan proves its own work via
// self-contained per-task <verify> commands instead, to avoid parallel
// plans conflicting on this shared file. ──
check("GATE-01 text/planning calls route through ai-gateway.service.ts", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-04/21-07/21-08/21-09)");
check("GATE-02 image gen/edit via OpenRouter dedicated Image API", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-05/21-06)");
check("GATE-03 transcription routes through the gateway", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-09)");
check("GATE-04 fallback chain config + model_fallback event_kind", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-03/21-04)");
check("GATE-05 recordUsageEvent accepts realCostUsdMicros/estimatedCostMicros", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-03/21-10/21-11/21-12)");
check("GATE-07 ai_gateway_routing branches present per call class (rollback)", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-04..21-09)");
check("POL-01 edit.routes.ts checkCredits passes isVideo from post.content_type", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-02)");
check("POL-07 zero ?key= query-string API keys in server/", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-02/21-07/21-08/21-09)");
check("CRSL2-03 slide-1 failure breaks the loop immediately", false, "TODO: wired in 21-13-PLAN.md (implemented in 21-02)");

console.log(`\n=== Phase 21 verify ===`);
console.log(`PASS: ${ok.length}`);
ok.forEach((n) => console.log(`  ✓ ${n}`));
if (failures.length) {
  console.log(`\nFAIL: ${failures.length}`);
  failures.forEach((n) => console.log(`  ✗ ${n}`));
  process.exit(1);
}
console.log(`\nAll Phase 21 checks passed.`);
