// scripts/verify-critic-live.ts
// CRIT-01: live proof that the image + strict-`json_schema` combination
// actually works against the live OpenRouter catalog (24-RESEARCH.md
// Pitfall 6 — capability data is volatile, a research snapshot is not
// evidence). Also the only automatable proof of CRIT-04's real-cancellation
// behavior via the optional --abort-probe flag.
//
// COSTS REAL MONEY (one vision completion per run, two when --abort-probe is
// passed and the first one is not aborted in time). Gated behind
// OPENROUTER_API_KEY.
// Run:
//   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-critic-live.ts --image=./sample.png [--model=<slug>]
//   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-critic-live.ts --image=./sample.png --abort-probe
import fs from "node:fs";
import path from "node:path";
import { runVisualCritic, summarizeCriticScores } from "../server/services/visual-critic.service.js";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.log("SKIP verify-critic-live — OPENROUTER_API_KEY not set (live-only check, see verify-phase-24.ts runbook)");
  process.exit(0);
}

const imageArg = process.argv.find((a) => /^--image=(.+)$/.test(a));
const modelArg = process.argv.find((a) => /^--model=(.+)$/.test(a));
const abortProbe = process.argv.includes("--abort-probe");
const imagePath = imageArg ? imageArg.match(/^--image=(.+)$/)![1] : null;
const model = modelArg ? modelArg.match(/^--model=(.+)$/)![1] : undefined;

if (!imagePath || !fs.existsSync(imagePath)) {
  console.log(
    "Usage: OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-critic-live.ts --image=./sample.png [--model=<slug>] [--abort-probe]",
  );
  console.log(`  --image is required and must point to an existing file (got: ${imagePath ?? "<none>"})`);
  process.exit(1);
}

function mimeTypeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

const imageBuffer = fs.readFileSync(imagePath);
const imageMimeType = mimeTypeFor(imagePath);

async function main() {
  console.log(`Running live critic call with model=${model ?? "(default)"}, image=${imagePath} (${imageMimeType})...\n`);

  const outcome = await runVisualCritic({
    apiKey: apiKey as string,
    model,
    imageBuffer,
    imageMimeType,
    layoutArchetypeId: "bottom_band",
  });

  console.log("\n=== CriticOutcome ===");
  console.log(JSON.stringify(outcome, null, 2));
  console.log(`\ncostUsdMicros: ${outcome.costUsdMicros ?? "(none reported)"}`);
  console.log(`modelUsed: ${outcome.modelUsed ?? "(none reported)"}`);

  const failures: string[] = [];

  const isScored = outcome.status === "scored";
  if (isScored) {
    console.log("PASS: outcome.status === \"scored\"");
  } else {
    failures.push(
      'outcome.status === "scored" — got "unavailable". The live model rejected the vision+strict-schema ' +
        "combination (or the call transport-failed). Check the console.warn preview logged by runVisualCritic " +
        "above, and consider changing ai_models.critic to a different live-verified vision + structured_outputs slug.",
    );
  }

  const scoresValid =
    isScored &&
    outcome.scores !== null &&
    [outcome.scores.composition, outcome.scores.color_harmony, outcome.scores.text_legibility_zone].every(
      (v) => Number.isInteger(v) && v >= 1 && v <= 5,
    );
  if (scoresValid) {
    console.log("PASS: all three scores are integers within 1-5");
  } else {
    failures.push("all three scores are integers within 1-5");
  }

  const unwantedTextIsBoolean = typeof outcome.unwantedTextDetected === "boolean";
  if (unwantedTextIsBoolean) {
    console.log("PASS: typeof outcome.unwantedTextDetected === \"boolean\"");
  } else {
    failures.push('typeof outcome.unwantedTextDetected === "boolean"');
  }

  const reasoningNonEmpty = outcome.reasoning.trim().length > 0;
  if (reasoningNonEmpty) {
    console.log("PASS: outcome.reasoning.trim().length > 0");
  } else {
    failures.push("outcome.reasoning.trim().length > 0");
  }

  const thresholdsAgree =
    isScored && outcome.scores !== null && outcome.passesThresholds === summarizeCriticScores(outcome.scores).passesThresholds;
  if (thresholdsAgree) {
    console.log("PASS: outcome.passesThresholds agrees with summarizeCriticScores(outcome.scores) — pure logic and live path agree");
  } else {
    failures.push("outcome.passesThresholds agrees with summarizeCriticScores(outcome.scores)");
  }

  if (abortProbe) {
    console.log("\nRunning --abort-probe: firing AbortController after 50ms, expecting runVisualCritic to REJECT...");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    try {
      await runVisualCritic({
        apiKey: apiKey as string,
        model,
        imageBuffer,
        imageMimeType,
        layoutArchetypeId: "bottom_band",
        signal: controller.signal,
      });
      failures.push("--abort-probe: runVisualCritic resolved instead of rejecting after a fired AbortSignal (CRIT-04 real-cancellation not proven)");
    } catch (err) {
      console.log(`PASS: --abort-probe: runVisualCritic rejected as expected (${(err as Error)?.message ?? String(err)})`);
    }
  } else {
    console.log("\n(--abort-probe not passed — skipping the CRIT-04 real-cancellation probe)");
  }

  if (failures.length) {
    console.log(`\nFAIL: ${failures.length} assertion(s) failed:`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exit(1);
  }

  console.log("\nLIVE CRITIC CALL VERIFIED — image + strict json_schema works against the live catalog.");
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-critic-live.ts: unhandled error:", err);
  process.exit(1);
});
