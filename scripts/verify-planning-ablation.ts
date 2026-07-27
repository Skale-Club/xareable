// scripts/verify-planning-ablation.ts
// PLAN-01 / Phase 22 SC1: live ablation proving that attaching reference images
// MEASURABLY changes the planning call's image_prompt. Sends the SAME prompt twice
// through the SAME gateway function and the SAME strict schema the production call
// uses — once text-only, once with the image attached via toOpenRouterInputReference.
//
// COSTS REAL MONEY (two planning-tier completions). Gated behind OPENROUTER_API_KEY.
// Run: OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-planning-ablation.ts --image=./ref.jpg [--model=gemini-2.5-pro]
import fs from "node:fs";
import path from "node:path";
import { chatCompletion, toOpenRouterInputReference } from "../server/services/ai-gateway.service.js";
import { PLANNING_JSON_SCHEMA, PLANNING_MAX_OUTPUT_TOKENS } from "../server/services/planning-schema.service.js";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.log(
    "SKIP verify-planning-ablation — OPENROUTER_API_KEY not set (live-only check, see verify-phase-22.ts runbook step 1)",
  );
  process.exit(0);
}

const imageArg = process.argv.find((a) => /^--image=(.+)$/.test(a));
const modelArg = process.argv.find((a) => /^--model=(.+)$/.test(a));
const imagePath = imageArg ? imageArg.match(/^--image=(.+)$/)![1] : null;
const model = modelArg ? modelArg.match(/^--model=(.+)$/)![1] : "gemini-2.5-pro";

if (!imagePath || !fs.existsSync(imagePath)) {
  console.log(
    "Usage: OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-planning-ablation.ts --image=./path/to/reference.jpg [--model=gemini-2.5-pro]",
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
const base64 = imageBuffer.toString("base64");
const mimeType = mimeTypeFor(imagePath);

const PROMPT = `You are an expert Art Director and Social Media Strategist.
Brand: Aurora Coffee Co. (specialty coffee roastery). Brand colors: #1B3A2F, #E4C590, #F5F1E8.
Brand style: minimalist. Post mood: premium launch. Aspect ratio: 4:5.
The user wants on-image text: HIGHLIGHT "New Single Origin", SUPPORT "Roasted this week".
A real logo file will be composited after generation — keep the bottom-right corner clean.
Produce the full art-director plan. If reference images are attached, the plan MUST reflect
the specific subject, materials, colors and composition visible in them.`;

interface RunResult {
  imagePrompt: string;
  modelUsed: string;
  costUsdMicros?: number;
}

async function run(withImage: boolean): Promise<RunResult> {
  try {
    const result = await chatCompletion({
      apiKey: apiKey as string,
      model,
      fallbackModels: [], // explicit — avoids a Supabase round-trip for the chain
      messages: [
        {
          role: "user",
          content: withImage
            ? [{ type: "text", text: PROMPT }, toOpenRouterInputReference({ mimeType, data: base64 })]
            : PROMPT,
        },
      ],
      temperature: 0.2, // low, so any difference is attributable to the image, not sampling noise
      maxTokens: PLANNING_MAX_OUTPUT_TOKENS,
      responseFormat: { type: "json_schema", json_schema: PLANNING_JSON_SCHEMA },
    });
    const parsed = JSON.parse(result.text);
    return {
      imagePrompt: String(parsed.image_prompt ?? ""),
      modelUsed: result.modelUsed,
      costUsdMicros: result.costUsdMicros,
    };
  } catch (err) {
    console.log(`FAIL (${withImage ? "with-images" : "text-only"}): ${(err as Error).message}`);
    process.exit(1);
  }
}

function jaccardOverlap(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length >= 4),
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

async function main() {
  console.log(`Running SC1 ablation with model=${model}, image=${imagePath} (${mimeType})...\n`);

  console.log("→ Running text-only planning call...");
  const without = await run(false);
  console.log("→ Running with-images planning call...");
  const withImg = await run(true);

  console.log("\n=== text-only image_prompt ===");
  console.log(without.imagePrompt);
  console.log("\n=== with-images image_prompt ===");
  console.log(withImg.imagePrompt);

  const overlap = jaccardOverlap(without.imagePrompt, withImg.imagePrompt);
  const totalCost = (without.costUsdMicros ?? 0) + (withImg.costUsdMicros ?? 0);

  console.log(`\nmodelUsed: text-only=${without.modelUsed}, with-images=${withImg.modelUsed}`);
  console.log(`total costUsdMicros: ${totalCost}`);
  console.log(`word-overlap ratio: ${overlap.toFixed(3)}`);

  const failures: string[] = [];

  const bothNonEmpty =
    without.imagePrompt.trim().length >= 40 && withImg.imagePrompt.trim().length >= 40;
  if (bothNonEmpty) console.log("PASS: both image_prompt values are non-empty and >= 40 characters");
  else failures.push("both image_prompt values are non-empty and >= 40 characters");

  const notIdentical = without.imagePrompt !== withImg.imagePrompt;
  if (notIdentical) console.log("PASS: the two prompts are not byte-identical");
  else failures.push("the two prompts are not byte-identical");

  const belowThreshold = overlap < 0.95;
  if (belowThreshold) console.log(`PASS: word-overlap ratio ${overlap.toFixed(3)} is below 0.95`);
  else failures.push(`word-overlap ratio ${overlap.toFixed(3)} is below 0.95`);

  if (failures.length) {
    console.log(`\nFAIL: ${failures.length} assertion(s) failed:`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exit(1);
  }

  console.log(
    `\nABLATION PROVEN — reference images measurably change the planning output (overlap=${overlap.toFixed(3)}).`,
  );
  console.log(
    "NOTE: also eyeball the with-images prompt for subject details only visible in the photo — overlap ratio alone is a proxy, not proof of fidelity.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-planning-ablation.ts: unhandled error:", err);
  process.exit(1);
});
