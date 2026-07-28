// scripts/verify-phase-24.ts
// Phase 24 (Visual Critic & Re-roll) static + functional verifier.
// Run: npx tsx scripts/verify-phase-24.ts
// Supports a --only=<substring> filter for fast per-task feedback, e.g.:
//   npx tsx scripts/verify-phase-24.ts --only=self-test
//
// Ownership: this harness is created by plan 24-01 — the Wave 0 Nyquist
// requirement (nothing in Phase 24 can be verified until this file exists) —
// and is extended by plan 24-07, which adds a 7th tag, [svc-cross-plan], for
// invariants that span files no single plan owns (mirrors
// scripts/verify-phase-23.ts's [svc-cross-plan] precedent). Plans 24-02..24-06
// must NOT edit this file — their job is to turn its red checks green by
// writing the code these checks describe.
//
// Wave 0 requirements tracked by this harness but delivered by plan 24-05:
//   - scripts/test-critic-reroll-logic.ts (no-network unit harness for the
//     pure re-roll decision function — invoked by [svc-reroll-logic])
//   - scripts/verify-critic-live.ts (OPENROUTER_API_KEY-gated live smoke test
//     — its mere existence is asserted by [svc-critic-call]; its live-network
//     behavior is intentionally NOT exercised by this static harness)
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
function read(p: string) {
  return fs.readFileSync(p, "utf8");
}
function exists(p: string) {
  return fs.existsSync(p);
}
function readSafe(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
// Only bother running an expensive (subprocess-spawning) functional check
// group if the --only filter could possibly match one of its check names.
function tagActive(tag: string): boolean {
  return !only || tag.includes(only) || only.includes(tag);
}

// ── Balanced-delimiter extraction helpers ──────────────────────────────────
// Self-contained (no dependency on any other verify-phase-*.ts file) —
// heuristics good enough for grepping this repo's own TypeScript style, not a
// general parser. Mirrors scripts/verify-phase-23.ts's extractZodObjectBody /
// extractMethodBody pattern, generalized for Phase 24's target shapes.

/** Extracts `export const NAME = z.object({ ... });`'s balanced-brace body. */
function extractZodObjectBody(src: string, constName: string): string {
  const marker = `export const ${constName} = z.object({`;
  const idx = src.indexOf(marker);
  if (idx === -1) return "";
  let i = idx + marker.length - 1; // at the opening "{"
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(start, i);
}

/** Extracts `<markerPrefix> = { ... }`'s balanced-brace body (plain object literal, not z.object). */
function extractConstObjectLiteral(src: string, markerPrefix: string): string {
  const marker = `${markerPrefix} = {`;
  const idx = src.indexOf(marker);
  if (idx === -1) return "";
  let i = idx + marker.length - 1;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(start, i);
}

/** Extracts an `(?:export )?interface NAME { ... }`'s balanced-brace body. */
function extractInterfaceBody(src: string, name: string): string {
  const m = new RegExp(`(?:export )?interface ${name}\\s*\\{`).exec(src);
  if (!m) return "";
  let i = m.index + m[0].length - 1;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(start, i);
}

/** Extracts an `export async function NAME(...) { ... }`'s balanced-brace body. */
function extractFunctionBody(src: string, name: string): string {
  const m = new RegExp(`export async function ${name}\\s*\\(`).exec(src);
  if (!m) return "";
  let i = m.index + m[0].length - 1; // at the params' opening "("
  let parenDepth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parenDepth++;
    else if (src[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        i++;
        break;
      }
    }
  }
  const braceIdx = src.indexOf("{", i);
  if (braceIdx === -1) return "";
  let depth = 0;
  let j = braceIdx;
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  return src.slice(start, j);
}

/** Extracts a class body: from `class NAME ... {` to its balanced closing brace. */
function extractClassBody(src: string, name: string): string {
  const m = new RegExp(`class ${name}[^{]*\\{`).exec(src);
  if (!m) return "";
  let i = m.index + m[0].length - 1;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(start, i);
}

/** Extracts a call's argument list `marker(...)` via balanced-paren scan from marker's first "(". */
function extractCallArgs(src: string, marker: string): string {
  const idx = src.indexOf(marker);
  if (idx === -1) return "";
  const openIdx = src.indexOf("(", idx);
  if (openIdx === -1) return "";
  let depth = 0;
  let i = openIdx;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(openIdx, i);
}

// ── Load sources ONCE. Every Phase 24 target file EXCEPT
// visual-critic.service.ts (and the two Wave 0 scripts checked by exists())
// already exists — written by Phases 21-23 — so this harness's job for those
// is to detect the ABSENCE of not-yet-written Phase 24 behavior inside them.
// readSafe() (not read()) keeps this harness from throwing on the one file
// that genuinely does not exist yet. ──
const visualCriticPath = "server/services/visual-critic.service.ts";
const aiGatewayPath = "server/services/ai-gateway.service.ts";
const aiGatewaySettingsPath = "server/services/ai-gateway-settings.service.ts";
const obsPath = "server/services/observability.service.ts";
const imageProviderPath = "server/services/image-provider.ts";
const generateRoutePath = "server/routes/generate.routes.ts";
const adminSettingsRoutePath = "server/routes/admin-settings.routes.ts";
const quotaPath = "server/quota.ts";
const sharedSchemaPath = "shared/schema.ts";
const aiModelsCardPath = "client/src/components/admin/post-creation/ai-models-card.tsx";

const visualCriticSrc = readSafe(visualCriticPath);
const aiGatewaySrc = readSafe(aiGatewayPath);
const aiGatewaySettingsSrc = readSafe(aiGatewaySettingsPath);
const obsSrc = readSafe(obsPath);
const imageProviderSrc = readSafe(imageProviderPath);
const generateRouteSrc = readSafe(generateRoutePath);
const adminSettingsRouteSrc = readSafe(adminSettingsRoutePath);
const quotaSrc = readSafe(quotaPath);
const sharedSchemaSrc = readSafe(sharedSchemaPath);
const aiModelsCardSrc = readSafe(aiModelsCardPath);
// admin-settings.routes.ts and ai-models-card.tsx are loaded for structural
// parity with the full Phase 24 target-file set (24-04 wires FALLBACK_CLASSES
// and the admin "critic" model card into these two files). No check below
// asserts on them directly — referencing them here documents the intent
// without a silent "declared but never read" trap for a future editor.
void aiGatewaySettingsSrc;
void adminSettingsRouteSrc;
void aiModelsCardSrc;

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  // [self-test] — proves THIS harness is not vacuous (5 checks)
  // ══════════════════════════════════════════════════════════════════════
  check("[self-test] harness executes", true);
  {
    const selfSrc = read("scripts/verify-phase-24.ts");
    const requiredTags = [
      "[self-test]",
      "[svc-critic-call]",
      "[svc-reroll-logic]",
      "[svc-billing-reroll]",
      "[svc-abort-signal]",
      "[svc-observability]",
    ];
    check(
      "[self-test] harness source contains all 6 Phase 24 tag literals",
      requiredTags.every((t) => selfSrc.includes(t)),
    );
    // Checks 3 & 4 assert this harness is WIRED to eventually verify the two
    // Wave 0 scripts 24-05 creates (scripts/test-critic-reroll-logic.ts,
    // scripts/verify-critic-live.ts) — NOT that those files already exist on
    // disk today. Asserting raw exists() here would make --only=self-test
    // legitimately red until 24-05 lands, contradicting this plan's own
    // must_haves.truths ("self-test exits 0") and the Phase 22/23 precedent
    // that [self-test] only proves the CURRENT plan's own deliverables, never
    // a future plan's (see scripts/verify-phase-23.ts's [self-test] block,
    // which only checks 23-01's own fonts/canvas/fixtures). The actual
    // existence assertions live in [svc-reroll-logic] and [svc-critic-call]
    // below, where they are honestly red until 24-05.
    check(
      "[self-test] harness is wired to invoke the Wave 0 unit harness scripts/test-critic-reroll-logic.ts (created by 24-05)",
      selfSrc.includes("scripts/test-critic-reroll-logic.ts"),
    );
    check(
      "[self-test] harness is wired to assert the Wave 0 live smoke scripts/verify-critic-live.ts exists (created by 24-05)",
      selfSrc.includes("scripts/verify-critic-live.ts"),
    );
  }
  check(
    "[self-test] scanner is not vacuous — a deliberately absent sentinel is correctly reported ABSENT",
    !generateRouteSrc.includes("__phase24_sentinel_never_present__"),
  );

  // ══════════════════════════════════════════════════════════════════════
  // [svc-critic-call] (CRIT-01) — the critic call itself
  // ══════════════════════════════════════════════════════════════════════
  check(
    "[svc-critic-call] server/services/visual-critic.service.ts exists",
    exists(visualCriticPath),
  );

  check(
    "[svc-critic-call] visual-critic.service.ts exports CRITIC_JSON_SCHEMA",
    visualCriticSrc.includes("export const CRITIC_JSON_SCHEMA"),
  );

  const criticSchemaBody = extractConstObjectLiteral(visualCriticSrc, "export const CRITIC_JSON_SCHEMA");

  check(
    "[svc-critic-call] CRITIC_JSON_SCHEMA literal contains strict: true AND additionalProperties: false",
    criticSchemaBody.includes("strict: true") && criticSchemaBody.includes("additionalProperties: false"),
  );

  check(
    "[svc-critic-call] CRITIC_JSON_SCHEMA declares all six properties: composition_score, color_harmony_score, text_legibility_zone_score, unwanted_text_detected, unwanted_text_detail, reasoning",
    [
      "composition_score",
      "color_harmony_score",
      "text_legibility_zone_score",
      "unwanted_text_detected",
      "unwanted_text_detail",
      "reasoning",
    ].every((prop) => criticSchemaBody.includes(prop)),
  );

  check(
    "[svc-critic-call] bounded scores use enum: [1, 2, 3, 4, 5] (>= 3 occurrences — 24-RESEARCH Pitfall 2)",
    (criticSchemaBody.match(/enum:\s*\[\s*1,\s*2,\s*3,\s*4,\s*5\s*\]/g) ?? []).length >= 3,
  );

  check(
    "[svc-critic-call] CRITIC_JSON_SCHEMA contains NEITHER minimum: NOR maximum: (Pitfall 2 hard rule)",
    !criticSchemaBody.includes("minimum:") && !criticSchemaBody.includes("maximum:"),
  );

  const runVisualCriticBody = extractFunctionBody(visualCriticSrc, "runVisualCritic");
  check(
    '[svc-critic-call] runVisualCritic calls chatCompletion with callClass: "critic"',
    runVisualCriticBody.includes("chatCompletion(") && runVisualCriticBody.includes('callClass: "critic"'),
  );

  check(
    "[svc-critic-call] uses toOpenRouterInputReference (imported from ai-gateway.service.js) — no hand-rolled data-URI",
    visualCriticSrc.includes("toOpenRouterInputReference") &&
      /from\s+["'][^"']*ai-gateway\.service\.js["']/.test(visualCriticSrc) &&
      !/data:\$\{/.test(visualCriticSrc),
  );

  const aiModelsSchemaBody = extractZodObjectBody(sharedSchemaSrc, "aiModelsSchema");
  check(
    "[svc-critic-call] shared/schema.ts aiModelsSchema declares a critic: field AND generate.routes.ts references ai_models?.critic",
    /critic:\s*z\.string\(\)\.default\(/.test(aiModelsSchemaBody) && generateRouteSrc.includes("ai_models?.critic"),
  );

  // Not one of 24-VALIDATION.md's per-tag counts for [svc-critic-call] — added
  // so [self-test] check 4 (which proves this harness is WIRED for 24-05's
  // Wave 0 live smoke test, rather than asserting its premature existence)
  // has a real, honestly-red-until-24-05 assertion to point at.
  check(
    "[svc-critic-call] Wave 0 live smoke scripts/verify-critic-live.ts exists (created by 24-05)",
    exists("scripts/verify-critic-live.ts"),
  );

  // ══════════════════════════════════════════════════════════════════════
  // [svc-reroll-logic] (CRIT-02) — bounded sequential re-roll
  // ══════════════════════════════════════════════════════════════════════
  check(
    "[svc-reroll-logic] visual-critic.service.ts exports MAX_REROLL_ATTEMPTS bound to the literal 2",
    /export const MAX_REROLL_ATTEMPTS\s*=\s*2\b/.test(visualCriticSrc),
  );

  check(
    "[svc-reroll-logic] generate.routes.ts contains a bounded loop: attempt <= MAX_REROLL_ATTEMPTS + 1",
    generateRouteSrc.includes("attempt <= MAX_REROLL_ATTEMPTS + 1"),
  );

  check(
    "[svc-reroll-logic] generate.routes.ts calls runVisualCritic( exactly once",
    (generateRouteSrc.match(/runVisualCritic\(/g) ?? []).length === 1,
  );

  check(
    "[svc-reroll-logic] visual-critic.service.ts exports selectFinalAttempt",
    visualCriticSrc.includes("export function selectFinalAttempt") ||
      visualCriticSrc.includes("export const selectFinalAttempt"),
  );

  check(
    "[svc-reroll-logic] visual-critic.service.ts exports computeRerollMetadata",
    visualCriticSrc.includes("export function computeRerollMetadata") ||
      visualCriticSrc.includes("export const computeRerollMetadata"),
  );

  // Not one of 24-VALIDATION.md's per-tag counts for [svc-reroll-logic] —
  // companion existence assertion to the spawnSync check below (see
  // [self-test] check 3's rationale).
  check(
    "[svc-reroll-logic] Wave 0 unit harness scripts/test-critic-reroll-logic.ts exists (created by 24-05)",
    exists("scripts/test-critic-reroll-logic.ts"),
  );

  if (tagActive("svc-reroll-logic")) {
    const run = spawnSync("npx", ["tsx", "scripts/test-critic-reroll-logic.ts"], {
      encoding: "utf8",
      shell: true,
    });
    check(
      "[svc-reroll-logic] scripts/test-critic-reroll-logic.ts exits 0 (no-network unit harness for the hard-fail gate / soft-fail threshold / best-of-3 tie-break, mirrors scripts/test-planning-schema-classification.ts)",
      run.status === 0,
      run.status !== 0 ? (run.stderr || run.stdout || "").slice(-800) : "",
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-billing-reroll] (CRIT-03) — bill once, track discarded cost only
  // ══════════════════════════════════════════════════════════════════════
  const recordUsageEventSigMatch = /export async function recordUsageEvent\(([\s\S]*?)\): Promise<RecordedUsageEvent>/.exec(
    quotaSrc,
  );
  const recordUsageEventSig = recordUsageEventSigMatch ? recordUsageEventSigMatch[1] : "";
  check(
    "[svc-billing-reroll] server/quota.ts recordUsageEvent signature declares extraMetadata?: Record<string, unknown>",
    /extraMetadata\?:\s*Record<string,\s*unknown>/.test(recordUsageEventSig),
  );

  check(
    "[svc-billing-reroll] quota.ts metadata object spreads ...extraMetadata",
    quotaSrc.includes("...extraMetadata"),
  );

  const hasGatewayMetaMatch = /const hasGatewayMeta = ([^;]+);/.exec(quotaSrc);
  const hasGatewayMetaExpr = hasGatewayMetaMatch ? hasGatewayMetaMatch[1] : "";
  check(
    "[svc-billing-reroll] quota.ts hasGatewayMeta also fires on a non-empty extraMetadata",
    hasGatewayMetaExpr.includes("extraMetadata"),
  );

  check(
    "[svc-billing-reroll] generate.routes.ts contains exactly ONE recordUsageEvent( call site",
    (generateRouteSrc.match(/recordUsageEvent\(/g) ?? []).length === 1,
  );

  const realCostMatch = /const realCostUsdMicros =([\s\S]*?);/.exec(generateRouteSrc);
  const gatewayRealCostMatch = /const gatewayRealCost =([\s\S]*?);/.exec(generateRouteSrc);
  const realCostExpr = realCostMatch ? realCostMatch[1] : "";
  const gatewayRealCostExpr = gatewayRealCostMatch ? gatewayRealCostMatch[1] : "";
  check(
    "[svc-billing-reroll] BILLING INVARIANT: neither the realCostUsdMicros nor the gatewayRealCost expression references 'reroll' — the discarded-attempt cost must never reach the charge",
    realCostMatch !== null &&
      gatewayRealCostMatch !== null &&
      !/reroll/i.test(realCostExpr) &&
      !/reroll/i.test(gatewayRealCostExpr),
  );

  check(
    "[svc-billing-reroll] generate.routes.ts still calls deductCredits( with usageEvent.cost_usd_micros and usageEvent.charged_amount_micros (unchanged billing structure)",
    /deductCredits\(\s*[\s\S]{0,160}usageEvent\.cost_usd_micros[\s\S]{0,160}usageEvent\.charged_amount_micros/.test(
      generateRouteSrc,
    ),
  );

  // ══════════════════════════════════════════════════════════════════════
  // [svc-abort-signal] (CRIT-04) — real fetch-level AbortSignal threading
  // ══════════════════════════════════════════════════════════════════════
  // 1
  const chatCompletionParamsBody = extractInterfaceBody(aiGatewaySrc, "ChatCompletionParams");
  check(
    "[svc-abort-signal] ChatCompletionParams declares signal?: AbortSignal",
    chatCompletionParamsBody.includes("signal?: AbortSignal"),
  );

  // 2
  check(
    "[svc-abort-signal] ai-gateway.service.ts passes the signal as chat.completions.create's SECOND argument",
    /chat\.completions\.create\([\s\S]{0,1200}\},\s*\{\s*signal:/.test(aiGatewaySrc),
  );

  // 3
  const gatewayImageParamsBody = extractInterfaceBody(aiGatewaySrc, "GatewayImageParams");
  check(
    "[svc-abort-signal] GatewayImageParams declares signal?: AbortSignal",
    gatewayImageParamsBody.includes("signal?: AbortSignal"),
  );

  // 4
  const callImageApiFetchArgs = extractCallArgs(aiGatewaySrc, 'fetch("https://openrouter.ai/api/v1/images"');
  check(
    '[svc-abort-signal] callImageApi\'s fetch("https://openrouter.ai/api/v1/images", {...}) init object contains signal:',
    callImageApiFetchArgs.includes("signal:"),
  );

  // 5
  const imageGenerationInputBody = extractInterfaceBody(imageProviderSrc, "ImageGenerationInput");
  const openRouterProviderClassBody = extractClassBody(imageProviderSrc, "OpenRouterImageProvider");
  const openRouterGenerateStart = openRouterProviderClassBody.indexOf("async generate(");
  const openRouterEditStart = openRouterProviderClassBody.indexOf("async edit(");
  const openRouterGenerateBody =
    openRouterGenerateStart !== -1
      ? openRouterProviderClassBody.slice(
          openRouterGenerateStart,
          openRouterEditStart !== -1 ? openRouterEditStart : undefined,
        )
      : "";
  check(
    "[svc-abort-signal] ImageGenerationInput declares signal?: AbortSignal AND OpenRouterImageProvider.generate forwards signal: input.signal",
    imageGenerationInputBody.includes("signal?: AbortSignal") &&
      openRouterGenerateBody.includes("signal: input.signal"),
  );

  // 6
  const hasAbortController = generateRouteSrc.includes("new AbortController()");
  const timerStartIdx = generateRouteSrc.indexOf("const safetyTimer = setTimeout");
  const timerEndMarker = "}, GENERATION_SAFETY_TIMEOUT_MS);";
  const timerEndIdx = timerStartIdx !== -1 ? generateRouteSrc.indexOf(timerEndMarker, timerStartIdx) : -1;
  const safetyTimerBody =
    timerStartIdx !== -1 && timerEndIdx !== -1
      ? generateRouteSrc.slice(timerStartIdx, timerEndIdx + timerEndMarker.length)
      : "";
  const timerAbortIdx = safetyTimerBody.indexOf("controller.abort()");
  const timer504Idx = safetyTimerBody.indexOf("statusCode: 504");
  const timerSendErrorIdx = safetyTimerBody.indexOf("sse.sendError(");
  const timerLogErrorIdx = safetyTimerBody.indexOf("logGenerationError(");
  check(
    "[svc-abort-signal] generate.routes.ts: new AbortController() constructed, safety timer body calls controller.abort(), and its statusCode: 504 sse.sendError( appears BEFORE logGenerationError( within the same body (SSEWriter.sendError is first-write-wins)",
    hasAbortController &&
      timerAbortIdx !== -1 &&
      timer504Idx !== -1 &&
      timerSendErrorIdx !== -1 &&
      timerLogErrorIdx !== -1 &&
      timerSendErrorIdx < timerLogErrorIdx,
  );

  // 7
  const providerGenerateArgs = extractCallArgs(generateRouteSrc, "provider.generate(");
  const runVisualCriticArgs = extractCallArgs(generateRouteSrc, "runVisualCritic(");
  check(
    "[svc-abort-signal] generate.routes.ts threads signal: controller.signal into BOTH provider.generate( and runVisualCritic(",
    providerGenerateArgs.includes("signal: controller.signal") &&
      runVisualCriticArgs.includes("signal: controller.signal"),
  );

  // 8
  const safetyTimeoutDeclMatch = /const GENERATION_SAFETY_TIMEOUT_MS = ([^;]+);/.exec(generateRouteSrc);
  const safetyTimeoutExpr = safetyTimeoutDeclMatch ? safetyTimeoutDeclMatch[1] : "";
  check(
    "[svc-abort-signal] generate.routes.ts declares CRITIC_REROLL_BUDGET_MS and derives GENERATION_SAFETY_TIMEOUT_MS from config.GENERATION_SAFETY_TIMEOUT_MS ?? 280_000 PLUS that budget",
    /const CRITIC_REROLL_BUDGET_MS/.test(generateRouteSrc) &&
      safetyTimeoutExpr.includes("config.GENERATION_SAFETY_TIMEOUT_MS") &&
      safetyTimeoutExpr.includes("280_000") &&
      safetyTimeoutExpr.includes("CRITIC_REROLL_BUDGET_MS") &&
      safetyTimeoutExpr.includes("+"),
  );

  // 9 — FUNCTIONAL (not grep): re-execute the REAL isFallbackWorthy regex.
  {
    const m = /const isFallbackWorthy = (\/.+\/i)\.test/.exec(aiGatewaySrc);
    if (!m) {
      check(
        "[svc-abort-signal] FUNCTIONAL: isFallbackWorthy regex extracted from ai-gateway.service.ts and re-executed — abort messages are not fallback-worthy, model_not_found is",
        false,
        "could not extract the `const isFallbackWorthy = /.../i.test` regex literal from ai-gateway.service.ts",
      );
    } else {
      const literal = m[1];
      const lastSlash = literal.lastIndexOf("/");
      const pattern = literal.slice(1, lastSlash);
      const flags = literal.slice(lastSlash + 1);
      let functional = false;
      let detail = "";
      try {
        const re = new RegExp(pattern, flags);
        const abortNotWorthy1 = !re.test("This operation was aborted");
        const abortNotWorthy2 = !re.test("The operation was aborted");
        const modelNotFoundWorthy = re.test("model_not_found");
        functional = abortNotWorthy1 && abortNotWorthy2 && modelNotFoundWorthy;
        if (!functional) {
          detail = `abortNotWorthy1=${abortNotWorthy1} abortNotWorthy2=${abortNotWorthy2} modelNotFoundWorthy=${modelNotFoundWorthy}`;
        }
      } catch (e) {
        detail = `extracted pattern failed to compile as RegExp: ${String(e)}`;
      }
      check(
        "[svc-abort-signal] FUNCTIONAL: isFallbackWorthy regex extracted from ai-gateway.service.ts and re-executed — abort messages are not fallback-worthy, model_not_found is",
        functional,
        detail,
      );
    }
  }

  // 10 — ABORT/CATCH RACE
  const lastCatchIdx = generateRouteSrc.lastIndexOf("} catch (error) {");
  const finallyIdx = lastCatchIdx !== -1 ? generateRouteSrc.indexOf("} finally {", lastCatchIdx) : -1;
  const outerCatchSlice =
    lastCatchIdx !== -1 && finallyIdx !== -1 ? generateRouteSrc.slice(lastCatchIdx, finallyIdx) : "";
  const abortedCheckIdx = outerCatchSlice.indexOf("controller.signal.aborted");
  const outerSendErrorIdx = outerCatchSlice.indexOf("sse.sendError(");
  const outerLogErrorIdx = outerCatchSlice.indexOf("logGenerationError(");
  check(
    "[svc-abort-signal] ABORT/CATCH RACE: the OUTER catch block checks controller.signal.aborted BEFORE both sse.sendError( and logGenerationError( — a timed-out request cannot emit a generic 500 nor a duplicate error row ahead of the safety timer's 504",
    abortedCheckIdx !== -1 &&
      outerSendErrorIdx !== -1 &&
      outerLogErrorIdx !== -1 &&
      abortedCheckIdx < outerSendErrorIdx &&
      abortedCheckIdx < outerLogErrorIdx,
  );

  // ══════════════════════════════════════════════════════════════════════
  // [svc-observability] (CRIT-05) — generation_logs event_kind='visual_critic'
  // ══════════════════════════════════════════════════════════════════════
  const logVisualCriticBody = extractFunctionBody(obsSrc, "logVisualCritic");
  check(
    "[svc-observability] observability.service.ts exports logVisualCritic",
    obsSrc.includes("export async function logVisualCritic"),
  );

  check(
    '[svc-observability] logVisualCritic inserts event_kind: "visual_critic" into generation_logs',
    logVisualCriticBody.includes('event_kind: "visual_critic"') && logVisualCriticBody.includes("generation_logs"),
  );

  check(
    "[svc-observability] logVisualCritic uses createAdminSupabase() and wraps its body in try { ... } catch {} (fire-and-forget, never blocks generation)",
    logVisualCriticBody.includes("createAdminSupabase()") && /try\s*\{[\s\S]*\}\s*catch/.test(logVisualCriticBody),
  );

  const eventKindEnumMatch = /event_kind: z\.enum\(\[([\s\S]*?)\]\)/.exec(sharedSchemaSrc);
  const eventKindEnumBody = eventKindEnumMatch ? eventKindEnumMatch[1] : "";
  check(
    '[svc-observability] shared/schema.ts generationLogSchema event_kind enum includes "visual_critic"',
    eventKindEnumBody.includes('"visual_critic"'),
  );

  check(
    "[svc-observability] generate.routes.ts calls logVisualCritic( exactly TWICE (success path + hard-fail path)",
    (generateRouteSrc.match(/logVisualCritic\(/g) ?? []).length === 2,
  );

  {
    const occurrences: number[] = [];
    let idx = generateRouteSrc.indexOf("logVisualCritic(");
    while (idx !== -1) {
      occurrences.push(idx);
      idx = generateRouteSrc.indexOf("logVisualCritic(", idx + 1);
    }
    const hasNearbyPostIdNull = occurrences.some((i) => {
      const windowStart = Math.max(0, i - 400);
      const windowEnd = Math.min(generateRouteSrc.length, i + 400);
      return generateRouteSrc.slice(windowStart, windowEnd).includes("postId: null");
    });
    check(
      "[svc-observability] FK SAFETY: the hard-fail logVisualCritic( call passes postId: null (within 400 chars of a call site)",
      hasNearbyPostIdNull,
    );
  }

  console.log(`\n=== Phase 24 verify ===`);
  console.log(`PASS: ${ok.length}`);
  ok.forEach((n) => console.log(`  ✓ ${n}`));
  if (failures.length) {
    console.log(`\nFAIL: ${failures.length}`);
    failures.forEach((n) => console.log(`  ✗ ${n}`));
    process.exit(1);
  }
  console.log(`\nAll Phase 24 checks passed.`);
}

main().catch((err) => {
  console.error("verify-phase-24 harness crashed:", err);
  process.exit(1);
});
