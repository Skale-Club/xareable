// scripts/verify-phase-22.ts
// Phase 22 (Art Director Planning Upgrade) static + functional verifier.
// Run: npx tsx scripts/verify-phase-22.ts
// Supports a --only=<substring> filter for fast per-task feedback, e.g.:
//   npx tsx scripts/verify-phase-22.ts --only=self-test
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

// Load sources ONCE. Files from later waves do not exist yet at plan 22-01
// execution time — readSafe() (not read()) keeps this harness from throwing.
const planningSchemaSrc = readSafe("server/services/planning-schema.service.ts");
const sharedSchemaSrc   = readSafe("shared/schema.ts");
const obsSrc            = readSafe("server/services/observability.service.ts");
const geminiSrc         = readSafe("server/services/gemini.service.ts");
const generateRouteSrc  = readSafe("server/routes/generate.routes.ts");
const carouselSrc       = readSafe("server/services/carousel-generation.service.ts");
const promptBuilderSrc  = readSafe("server/services/prompt-builder.service.ts");
const aiModelsCardSrc   = readSafe("client/src/components/admin/post-creation/ai-models-card.tsx");

// ── [self-test] ──
check("[self-test] harness executes", true);
{
  const selfSrc = read("scripts/verify-phase-22.ts");
  const requiredTags = [
    "[self-test]",
    "[svc-schema-module]",
    "[svc-multimodal]",
    "[svc-schema]",
    "[svc-schema-failure-log]",
    "[svc-model-tier]",
    "[svc-token-budget]",
    "[svc-prompt-precedence]",
  ];
  check(
    "[self-test] harness source contains all 8 Phase 22 tag literals",
    requiredTags.every((t) => selfSrc.includes(t)),
  );
}

// ── [svc-schema-module] ──
check("[svc-schema-module] planning-schema.service.ts exists", exists("server/services/planning-schema.service.ts"));
check(
  "[svc-schema-module] exports PLANNING_SCHEMA_NAME = \"art_director_plan\"",
  /export const PLANNING_SCHEMA_NAME = "art_director_plan"/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] exports PLANNING_JSON_SCHEMA",
  /export const PLANNING_JSON_SCHEMA\b/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] exports PLANNING_GEMINI_RESPONSE_SCHEMA",
  /export const PLANNING_GEMINI_RESPONSE_SCHEMA\b/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] exports PlanningSchemaError extends Error",
  /export class PlanningSchemaError extends Error/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] exports validatePlanningWireResult",
  /export function validatePlanningWireResult\b/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] exports classifyPlanningFailure",
  /export function classifyPlanningFailure\b/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] exports isPlanningSchemaError",
  /export function isPlanningSchemaError\b/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] exports PLANNING_MAX_OUTPUT_TOKENS = 4096",
  /export const PLANNING_MAX_OUTPUT_TOKENS = 4096/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] LAYOUT_ARCHETYPE_IDS present with all 3 archetypes",
  /LAYOUT_ARCHETYPE_IDS/.test(planningSchemaSrc)
    && ["bottom_band", "top_stack", "centered_hero"].every((id) => planningSchemaSrc.includes(id)),
);
check(
  "[svc-schema-module] strict mode: strict:true + additionalProperties:false at every object level (>= 8)",
  /strict: true/.test(planningSchemaSrc)
    && (planningSchemaSrc.match(/additionalProperties: false/g) ?? []).length >= 8,
  "additionalProperties:false required at EVERY object level",
);
check(
  "[svc-schema-module] day-one forward-compat fields text_blocks + layout_archetype_id present",
  /"?text_blocks"?:/.test(planningSchemaSrc) && /"?layout_archetype_id"?:/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] dialect split: OpenRouter lowercase type:\"object\", Gemini uppercase type:\"OBJECT\"/\"STRING\"",
  /type: "object"/.test(planningSchemaSrc)
    && /type: "OBJECT"/.test(planningSchemaSrc)
    && /type: "STRING"/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] Gemini dialect present and expresses optionality via nullable:true (not additionalProperties)",
  /PLANNING_GEMINI_RESPONSE_SCHEMA/.test(planningSchemaSrc) && /nullable: true/.test(planningSchemaSrc),
);
check(
  "[svc-schema-module] test-planning-schema-classification.ts exists",
  exists("scripts/test-planning-schema-classification.ts"),
);
if (exists("scripts/test-planning-schema-classification.ts")) {
  const run = spawnSync("npx", ["tsx", "scripts/test-planning-schema-classification.ts"], { encoding: "utf8", shell: true });
  check(
    "[svc-schema-module] classification fixture test exits 0 (functional)",
    run.status === 0,
    run.stderr || run.stdout,
  );
}

// ── [svc-model-tier] ──
check(
  "[svc-model-tier] aiModelsSchema.planning defaults to gemini-2.5-pro",
  /planning: z\.string\(\)\.default\("gemini-2\.5-pro"\)/.test(sharedSchemaSrc),
);
check(
  "[svc-model-tier] text_generation NOT repointed (still gemini-2.5-flash)",
  /text_generation: z\.string\(\)\.default\("gemini-2\.5-flash"\)/.test(sharedSchemaSrc),
  "text_generation must NOT be repointed — 4 other call sites share it",
);
check(
  "[svc-model-tier] gemini.service.ts reads ai_models?.planning",
  /ai_models\?\.planning/.test(geminiSrc),
);
check(
  "[svc-model-tier] gemini.service.ts still reads ai_models?.text_generation (video branch keeps it)",
  /ai_models\?\.text_generation/.test(geminiSrc),
);
check(
  "[svc-model-tier] admin AI Models card wires updateModel(\"planning\"",
  /updateModel\("planning"/.test(aiModelsCardSrc),
);
check(
  "[svc-model-tier] admin AI Models card default value=\"gemini-2.5-pro\"",
  /value="gemini-2\.5-pro"/.test(aiModelsCardSrc),
);

// ── [svc-token-budget] ──
check(
  "[svc-token-budget] gemini.service.ts uses PLANNING_MAX_OUTPUT_TOKENS, no leftover 2048 literal",
  /PLANNING_MAX_OUTPUT_TOKENS/.test(geminiSrc)
    && !/maxTokens: 2048/.test(geminiSrc)
    && !/maxOutputTokens: 2048/.test(geminiSrc),
);
check(
  "[svc-token-budget] carousel-generation.service.ts exports CAROUSEL_TOKEN_BASE = 1200",
  /export const CAROUSEL_TOKEN_BASE = 1200/.test(carouselSrc),
);
check(
  "[svc-token-budget] carousel-generation.service.ts exports CAROUSEL_TOKENS_PER_SLIDE = 350",
  /export const CAROUSEL_TOKENS_PER_SLIDE = 350/.test(carouselSrc),
);
check(
  "[svc-token-budget] carousel-generation.service.ts exports carouselPlanMaxTokens",
  /export function carouselPlanMaxTokens\b/.test(carouselSrc),
);
check(
  "[svc-token-budget] both OpenRouter maxTokens and direct maxOutputTokens scale via carouselPlanMaxTokens(params.slideCount)",
  (carouselSrc.match(/carouselPlanMaxTokens\(params\.slideCount\)/g) ?? []).length >= 2,
  "both the OpenRouter maxTokens and the direct maxOutputTokens must scale",
);
check(
  "[svc-token-budget] carousel-generation.service.ts has no leftover 2048 literal",
  !/maxTokens: 2048/.test(carouselSrc) && !/maxOutputTokens: 2048/.test(carouselSrc),
);

// ── [svc-multimodal] ──
check(
  "[svc-multimodal] generate.routes.ts passes referenceImages: mergedReferenceImages (not the pre-flattened .map)",
  /referenceImages: mergedReferenceImages,/.test(generateRouteSrc)
    && !/mergedReferenceImages\.map\(img => img\.data\)/.test(generateRouteSrc),
);
check(
  "[svc-multimodal] gemini.service.ts GenerateParams accepts referenceImages as {mimeType,data}[]",
  /referenceImages\?: Array<\{ mimeType: string; data: string \}>/.test(geminiSrc),
);
check(
  "[svc-multimodal] gemini.service.ts imports/uses toOpenRouterInputReference",
  /toOpenRouterInputReference/.test(geminiSrc),
);
check(
  "[svc-multimodal] gemini.service.ts has buildPlanningContentParts (OpenRouter multimodal content builder)",
  /buildPlanningContentParts/.test(geminiSrc),
);
check(
  "[svc-multimodal] gemini.service.ts has buildPlanningGeminiParts (direct-path inlineData builder)",
  /buildPlanningGeminiParts/.test(geminiSrc),
);
check(
  "[svc-multimodal] gemini.service.ts uses inlineData (kept — already true via generateImage)",
  /inlineData/.test(geminiSrc),
);

// ── [svc-schema] ──
check(
  "[svc-schema] gemini.service.ts references both PLANNING_JSON_SCHEMA and PLANNING_GEMINI_RESPONSE_SCHEMA",
  /PLANNING_JSON_SCHEMA/.test(geminiSrc) && /PLANNING_GEMINI_RESPONSE_SCHEMA/.test(geminiSrc),
);
check(
  "[svc-schema] gemini.service.ts sets response_format type: \"json_schema\"",
  /type: "json_schema"/.test(geminiSrc),
);
check(
  "[svc-schema] gemini.service.ts sets responseSchema: on the direct path",
  /responseSchema:/.test(geminiSrc),
);
check(
  "[svc-schema] video carve-out preserved: contentType === \"video\" still uses loose json_object",
  /contentType === "video"/.test(geminiSrc) && /\{ type: "json_object" \}/.test(geminiSrc),
  "video planning call must keep the loose json_object shape — GATE-08 posture",
);

// ── [svc-schema-failure-log] ──
check(
  "[svc-schema-failure-log] observability.service.ts exports logPlanningSchemaFailure",
  /export async function logPlanningSchemaFailure\b/.test(obsSrc),
);
check(
  "[svc-schema-failure-log] logPlanningSchemaFailure emits event_kind: \"planning_schema_failure\"",
  /event_kind: "planning_schema_failure"/.test(obsSrc),
);
check(
  "[svc-schema-failure-log] logPlanningSchemaFailure emits outcome: \"schema_validation_failed\"",
  /outcome: "schema_validation_failed"/.test(obsSrc),
);
check(
  "[svc-schema-failure-log] shared/schema.ts event_kind Zod enum widened with \"planning_schema_failure\"",
  /"planning_schema_failure"/.test(sharedSchemaSrc),
);
check(
  "[svc-schema-failure-log] gemini.service.ts calls logPlanningSchemaFailure",
  /logPlanningSchemaFailure/.test(geminiSrc),
);
check(
  "[svc-schema-failure-log] gemini.service.ts throws PlanningSchemaError on failure",
  /throw new PlanningSchemaError/.test(geminiSrc),
);
check(
  "[svc-schema-failure-log] generate.routes.ts discriminates via isPlanningSchemaError before falling back",
  /isPlanningSchemaError/.test(generateRouteSrc),
);

// ── [svc-prompt-precedence] ──
check(
  "[svc-prompt-precedence] gemini.service.ts defines const modelImagePrompt",
  /const modelImagePrompt = /.test(geminiSrc),
);
check(
  "[svc-prompt-precedence] old precedence-inverting instruction removed",
  !/Optionally provide a flattened image_prompt/.test(geminiSrc),
);
check(
  "[svc-prompt-precedence] prompt-builder.service.ts documents buildImagePromptFromStructuredJson as FALLBACK-ONLY",
  /FALLBACK-ONLY/.test(promptBuilderSrc),
);
check(
  "[svc-prompt-precedence] gemini.service.ts carries text_blocks: TextBlock[] and layout_archetype_id:",
  /text_blocks: TextBlock\[\]/.test(geminiSrc) && /layout_archetype_id:/.test(geminiSrc),
);

// ── [svc-schema] video carve-out is real, not incidental ──
check(
  "[svc-schema] video planning path excluded from strict schema in BOTH transports",
  (geminiSrc.match(/isVideoPlanning/g) ?? []).length >= 4,
  "expected isVideoPlanning to gate model, responseFormat, responseSchema and the schema-failure branch",
);
// ── [svc-prompt-precedence] flattening is unreachable when the model answered ──
check(
  "[svc-prompt-precedence] flattening computed lazily behind modelImagePrompt",
  /const flattenedPrompt = modelImagePrompt[\s\S]{0,200}buildImagePromptFromStructuredJson/.test(geminiSrc),
);
// ── [svc-multimodal] SC1 live ablation harness present ──
check("[svc-multimodal] live ablation harness exists", exists("scripts/verify-planning-ablation.ts"));

console.log(`\n=== Phase 22 verify ===`);
console.log(`PASS: ${ok.length}`);
ok.forEach((n) => console.log(`  ✓ ${n}`));
if (failures.length) {
  console.log(`\nFAIL: ${failures.length}`);
  failures.forEach((n) => console.log(`  ✗ ${n}`));
  process.exit(1);
}
console.log(`\nAll Phase 22 checks passed.`);

/*
 * ── MANUAL/LIVE VERIFICATION RUNBOOK (not automated — requires a funded OPENROUTER_API_KEY) ──
 * 1. SC1 ablation (PLAN-01): OPENROUTER_API_KEY=... npx tsx scripts/verify-planning-ablation.ts --image=./path/to/reference.jpg
 *    Confirm the two image_prompt outputs differ and that the with-images run mentions
 *    subject details only visible in the photo. Exit 0 = ablation proven.
 * 2. SC2/SC3 live structured output (PLAN-02/PLAN-03): generate one real single-image post
 *    in staging. Confirm: the post completes, generation_logs has NO event_kind='planning_schema_failure'
 *    row for it, and usage_events.metadata carries the gateway cost (the planning call
 *    did not fall back).
 * 3. Schema-failure hard-fail (PLAN-02): temporarily PATCH /api/admin/... style_catalog
 *    ai_models.planning to a slug WITHOUT structured-outputs support (check
 *    https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs). Generate.
 *    Expect: OpenRouter returns an explicit unsupported-model error -> this is a TRANSPORT
 *    failure -> the local template path still applies (documented, unchanged behavior).
 *    Then point ai_models.planning at a supported slug and instead force a schema failure by
 *    flipping ai_gateway_routing.planning to "direct" with a Gemini key whose model rejects
 *    responseSchema. Expect: SSE error "The art director planning step could not produce a
 *    valid creative plan." AND a generation_logs row with event_kind='planning_schema_failure'.
 *    Confirm NO post row and NO usage_events row were created. Restore both settings.
 * 4. GATE-07 rollback parity: PATCH /api/admin/ai-gateway-routing { call_class: "planning",
 *    mode: "direct" }; generate with a reference image; confirm success via the direct Gemini
 *    path (proves the uppercase responseSchema dialect and the inlineData parts are both
 *    accepted). Flip back to "openrouter".
 * 5. Carousel token budget (PLAN-03): generate an 8-slide carousel; confirm all 8 slides are
 *    present in the master plan (no truncation) and the post completes.
 * 6. GATE-08 video regression: generate one video; confirm it still succeeds via the direct
 *    Google path and that its planning call used ai_models.text_generation (not planning).
 */
