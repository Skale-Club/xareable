// Phase 24 (CRIT-01/CRIT-02) — the multimodal visual critic + its bounded
// sequential re-roll decision logic.
//
// This file locks two Claude's-discretion decisions (24-CONTEXT.md):
//   1. Scores are a 1-5 integer enum per dimension (not a numeric range —
//      see Pitfall 2 below), with an INCLUSIVE floor of 3 for "acceptable".
//   2. A critic OUTAGE is fail-OPEN: the image is accepted as-is and NO paid
//      re-roll attempt is burned trying to "fix" a problem that was never
//      observed. Only an image the critic actually SCORED and found to
//      contain unwanted rendered text is ever excluded.
//
// Task 1 (below): PURE decision functions, zero imports from
// ai-gateway.service.ts. Proven by scripts/test-critic-reroll-logic.ts
// (no network). Task 2 (further below) appends the actual multimodal
// gateway call.

import { chatCompletion, toOpenRouterInputReference, type ChatMessageContent } from "./ai-gateway.service.js";

/** 3 total generations: 1 initial + MAX_REROLL_ATTEMPTS re-rolls (24-CONTEXT.md locked). */
export const MAX_REROLL_ATTEMPTS = 2;

/** Inclusive floor. ANY dimension below this is a SOFT fail. Claude's-discretion constant — change here, nowhere else. */
export const CRITIC_MIN_DIMENSION_SCORE = 3;

export interface CriticScores {
  composition: number;
  color_harmony: number;
  text_legibility_zone: number;
}

export interface CriticOutcome {
  status: "scored" | "unavailable";
  scores: CriticScores | null; // null iff status === "unavailable"
  unwantedTextDetected: boolean; // ALWAYS false when unavailable — never assert a hard fail we did not observe
  unwantedTextDetail: string;
  reasoning: string;
  passesThresholds: boolean; // false when unavailable
  totalScore: number; // 0 when unavailable
  costUsdMicros?: number;
  modelUsed?: string;
}

export interface CriticAttempt {
  index: number; // 1-based attempt number
  outcome: CriticOutcome;
  imageCostUsdMicros: number; // that attempt's image-generation cost (0 when the provider reported none)
}

export type FinalSelectionOutcome = "pass" | "soft_fail_accepted_best" | "critic_unavailable" | "hard_fail_all_attempts";

export interface FinalSelection {
  acceptedIndex: number | null;
  outcome: FinalSelectionOutcome;
}

/** Sums the three dimension scores and applies the inclusive-floor threshold. */
export function summarizeCriticScores(scores: CriticScores): { totalScore: number; passesThresholds: boolean } {
  const totalScore = scores.composition + scores.color_harmony + scores.text_legibility_zone;
  const passesThresholds =
    scores.composition >= CRITIC_MIN_DIMENSION_SCORE &&
    scores.color_harmony >= CRITIC_MIN_DIMENSION_SCORE &&
    scores.text_legibility_zone >= CRITIC_MIN_DIMENSION_SCORE;
  return { totalScore, passesThresholds };
}

/**
 * Whether the caller should generate ANOTHER attempt after this outcome.
 *
 * An "unavailable" critic returns false: a critic outage is fail-OPEN (accept
 * the image) and must never consume paid re-roll attempts.
 */
export function shouldRerollAfter(outcome: CriticOutcome): boolean {
  return outcome.status === "scored" && (outcome.unwantedTextDetected || !outcome.passesThresholds);
}

/**
 * LOCKED SEMANTICS (24-CONTEXT.md "Re-roll trigger logic", non-negotiable) —
 * applied IN ORDER, returns on the first match:
 *
 *   1. First attempt with status "scored", !unwantedTextDetected,
 *      passesThresholds -> outcome "pass".
 *   2. Among attempts with status "scored" and !unwantedTextDetected, the one
 *      with the highest totalScore; ties resolve to the LOWEST index
 *      (deterministic, no Math.random, no sort instability) -> outcome
 *      "soft_fail_accepted_best".
 *   3. First attempt with status "unavailable" -> outcome "critic_unavailable".
 *      (Rule 2 outranks rule 3 on purpose: an image we scored and found
 *      text-free is safer than one we never looked at.)
 *   4. Otherwise -> { acceptedIndex: null, outcome: "hard_fail_all_attempts" }.
 *      This is the ONLY branch where the caller must fail the generation. An
 *      attempt with unwantedTextDetected === true is unreachable by rules 1-3
 *      at ANY attempt count — there is no "best available" escape hatch for
 *      rendered text (24-CONTEXT.md, non-negotiable).
 */
export function selectFinalAttempt(attempts: CriticAttempt[]): FinalSelection {
  // Rule 1: first clean pass.
  for (const candidate of attempts) {
    if (
      candidate.outcome.status === "scored" &&
      !candidate.outcome.unwantedTextDetected &&
      candidate.outcome.passesThresholds
    ) {
      return { acceptedIndex: candidate.index, outcome: "pass" };
    }
  }

  // Rule 2: best-of-3 among scored, text-free (but threshold-failing) attempts.
  // Strict `>` (not `>=`) keeps the FIRST (lowest-index) attempt on a tie.
  let best: CriticAttempt | null = null;
  for (const candidate of attempts) {
    if (candidate.outcome.status !== "scored" || candidate.outcome.unwantedTextDetected) continue;
    if (best === null || candidate.outcome.totalScore > best.outcome.totalScore) {
      best = candidate;
    }
  }
  if (best !== null) {
    return { acceptedIndex: best.index, outcome: "soft_fail_accepted_best" };
  }

  // Rule 3: no text-free scored candidate exists — fall back to an unobserved
  // (outage) attempt if one exists, in preference to an observed hard fail.
  const unavailable = attempts.find((candidate) => candidate.outcome.status === "unavailable");
  if (unavailable) {
    return { acceptedIndex: unavailable.index, outcome: "critic_unavailable" };
  }

  // Rule 4: everything remaining is a hard fail (or there were no attempts at
  // all). The caller must fail the generation.
  return { acceptedIndex: null, outcome: "hard_fail_all_attempts" };
}

/**
 * Sums, over every attempt whose index !== acceptedIndex,
 * imageCostUsdMicros + (outcome.costUsdMicros ?? 0), and counts them. The
 * ACCEPTED attempt's image + critic cost is deliberately excluded — it is
 * what the user is charged (CRIT-03).
 */
export function computeRerollMetadata(
  attempts: CriticAttempt[],
  acceptedIndex: number | null,
): { reroll_attempt_count: number; reroll_cost_usd_micros: number } {
  let reroll_attempt_count = 0;
  let reroll_cost_usd_micros = 0;
  for (const candidate of attempts) {
    if (candidate.index === acceptedIndex) continue;
    reroll_attempt_count += 1;
    reroll_cost_usd_micros += candidate.imageCostUsdMicros + (candidate.outcome.costUsdMicros ?? 0);
  }
  return { reroll_attempt_count, reroll_cost_usd_micros };
}

// ── Task 2: the actual multimodal critic call ───────────────────────────────

export const CRITIC_SCHEMA_NAME = "visual_critic_score";
export const CRITIC_MAX_OUTPUT_TOKENS = 512;
/** Mirrors shared/schema.ts aiModelsSchema.critic's own default — kept in sync manually, not imported (Zod default() is a literal, not an exported const). */
export const DEFAULT_CRITIC_MODEL = "gemini-2.5-flash";

/**
 * OpenRouter `response_format.json_schema` dialect, mirroring
 * PLANNING_JSON_SCHEMA's proven strict-mode shape exactly (standard JSON
 * Schema, lowercase types, `strict: true`, `additionalProperties: false`,
 * every property listed in `required`).
 *
 * HARD RULE (24-RESEARCH.md Pitfall 2, validated in this exact codebase by
 * planning-schema.service.ts's own MIN_IMAGE_PROMPT_LENGTH comment):
 * `minimum`/`maximum` JSON-Schema keywords are NOT reliable under this
 * gateway's strict mode. Bound values with `enum` instead, and defensively
 * re-validate the parsed result at runtime (parseCriticWireResult below,
 * mirroring validatePlanningWireResult's spirit) — strict mode reduces but
 * does not eliminate malformed output risk.
 */
export const CRITIC_JSON_SCHEMA = {
  name: CRITIC_SCHEMA_NAME,
  strict: true,
  schema: {
    type: "object",
    properties: {
      composition_score: {
        type: "integer",
        enum: [1, 2, 3, 4, 5],
        description: "Composition quality: 1 = unusable, 3 = acceptable for publication, 5 = professional art direction.",
      },
      color_harmony_score: {
        type: "integer",
        enum: [1, 2, 3, 4, 5],
        description: "Color harmony quality: 1 = unusable/clashing, 3 = acceptable for publication, 5 = professional art direction.",
      },
      text_legibility_zone_score: {
        type: "integer",
        enum: [1, 2, 3, 4, 5],
        description:
          "How clean and low-detail the layout archetype's reserved text zone is: 1 = unusable (no legible space left), 3 = acceptable for publication, 5 = professional art direction.",
      },
      unwanted_text_detected: {
        type: "boolean",
        description:
          "True for ANY AI-rendered overlay/graphic-design text the image model invented (headlines, captions, watermarks, signage, labels, gibberish or malformed letterforms, or any lettering that reads as a design element). False for incidental, naturally-occurring real-world text that legitimately belongs to a depicted subject.",
      },
      unwanted_text_detail: {
        type: "string",
        description: "What text was detected and where. Empty string when unwanted_text_detected is false.",
      },
      reasoning: {
        type: "string",
        description: "One or two sentences justifying the scores.",
      },
    },
    required: [
      "composition_score",
      "color_harmony_score",
      "text_legibility_zone_score",
      "unwanted_text_detected",
      "unwanted_text_detail",
      "reasoning",
    ],
    additionalProperties: false,
  },
};

/** Human-readable name for the region the composited text will occupy, per layout archetype. Defaults to bottom_band when unknown. */
const LAYOUT_ZONE_NAMES: Record<string, string> = {
  bottom_band: "the lower third",
  top_stack: "the upper third",
  centered_hero: "a central band",
};

/**
 * The critic's scoring rubric. The image under review is a PRE-TYPOGRAPHY
 * base image — all headline/support/CTA text is composited deterministically
 * by the server AFTERWARD (Phase 23), so this prompt's entire framing is
 * "judge the photograph, not the (nonexistent) copy".
 */
export function buildCriticPrompt(layoutArchetypeId?: string): string {
  const zoneName = LAYOUT_ZONE_NAMES[layoutArchetypeId ?? "bottom_band"] ?? LAYOUT_ZONE_NAMES.bottom_band;
  return `You are a professional art director reviewing a base image before it ships.

This image is a PRE-TYPOGRAPHY base image: ALL headline/support/CTA text is composited
deterministically by the server AFTERWARD — you are not looking at, and must not expect to
see, any finished on-image copy. The base image must therefore be completely free of
rendered text and must reserve clean, low-detail negative space for that text to be
composited into later.

Score each of the following on an integer scale of 1-5, with these anchors: 1 = unusable,
3 = acceptable for publication, 5 = professional art direction.
- composition_score: overall compositional quality (framing, balance, focal point).
- color_harmony_score: color palette cohesion and harmony.
- text_legibility_zone_score: specifically whether ${zoneName} of the image — the layout
  archetype's reserved text zone — is clean and low-detail enough for legible text to be
  composited on top of it later. Default to judging the lower third when the archetype is
  unknown.

unwanted_text_detected must be TRUE for any AI-rendered overlay/graphic-design text the
image model invented: headlines, captions, watermarks, signage, labels, gibberish or
malformed letterforms, or any lettering that reads as a design element rather than as part
of a photographed object. It must be FALSE for incidental, naturally-occurring real-world
text that legitimately belongs to a depicted subject (for example, a product label on a
bottle that came from a reference image) — an over-strict reading here would make
legitimate product photography hard-fail every attempt and fail the entire generation
outright, which is worse than the artifact it guards against.

Return ONLY the JSON object matching the schema. No markdown, no commentary.`;
}

/**
 * Defense-in-depth runtime re-validation of the parsed wire result (strict
 * mode reduces, but does not eliminate, malformed output — mirrors
 * validatePlanningWireResult's spirit). Returns `null` (never throws) when
 * any of the three scores is missing, non-integer, or outside 1-5, or when
 * unwanted_text_detected is not a boolean. A `null` here becomes an
 * "unavailable" outcome in runVisualCritic — never a hard fail we did not
 * actually observe.
 */
export function parseCriticWireResult(
  raw: unknown,
): (CriticScores & { unwantedTextDetected: boolean; unwantedTextDetail: string; reasoning: string }) | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const isValidScore = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;

  if (
    !isValidScore(r.composition_score) ||
    !isValidScore(r.color_harmony_score) ||
    !isValidScore(r.text_legibility_zone_score)
  ) {
    return null;
  }
  if (typeof r.unwanted_text_detected !== "boolean") return null;
  if (typeof r.unwanted_text_detail !== "string") return null;
  if (typeof r.reasoning !== "string") return null;

  return {
    composition: r.composition_score,
    color_harmony: r.color_harmony_score,
    text_legibility_zone: r.text_legibility_zone_score,
    unwantedTextDetected: r.unwanted_text_detected,
    unwantedTextDetail: r.unwanted_text_detail,
    reasoning: r.reasoning,
  };
}

/**
 * True when `err` (or the passed `signal`) indicates a fired AbortSignal
 * rather than a genuine transport/schema failure. CRIT-04: a fired abort
 * must propagate out of the critic, never be swallowed as a fail-open
 * "unavailable" outage — see the catch block in runVisualCritic below.
 */
export function isAbortLikeError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) return true;
  if ((err as { name?: unknown })?.name === "AbortError") return true;
  if (/abort/i.test(String((err as { message?: unknown })?.message ?? ""))) return true;
  return false;
}

function unavailableCriticOutcome(): CriticOutcome {
  return {
    status: "unavailable",
    scores: null,
    unwantedTextDetected: false,
    unwantedTextDetail: "",
    reasoning: "",
    passesThresholds: false,
    totalScore: 0,
  };
}

/**
 * The single strict-schema multimodal critic call (CRIT-01). Fails OPEN on
 * any non-abort error (missing key, transport failure, malformed JSON,
 * schema re-validation failure) — an outage never fails the generation and
 * never consumes a re-roll attempt (see shouldRerollAfter above).
 */
export async function runVisualCritic(params: {
  apiKey: string;
  model?: string;
  imageBuffer: Buffer;
  imageMimeType: string;
  layoutArchetypeId?: string;
  signal?: AbortSignal;
}): Promise<CriticOutcome> {
  // An affiliate or a rollback window without an OpenRouter key must not
  // break generation — fail open immediately, no call, no throw.
  if (!params.apiKey) {
    return unavailableCriticOutcome();
  }

  try {
    const content: ChatMessageContent = [
      { type: "text", text: buildCriticPrompt(params.layoutArchetypeId) },
      toOpenRouterInputReference({ mimeType: params.imageMimeType, data: params.imageBuffer.toString("base64") }),
    ];

    const result = await chatCompletion({
      apiKey: params.apiKey,
      model: params.model || DEFAULT_CRITIC_MODEL,
      // MANDATORY: without this, the call silently inherits the shared
      // "text" fallback chain (24-RESEARCH.md Pitfall 1) and its
      // model_fallback log rows are mislabeled.
      callClass: "critic",
      messages: [{ role: "user", content }],
      temperature: 0.1,
      maxTokens: CRITIC_MAX_OUTPUT_TOKENS,
      responseFormat: { type: "json_schema", json_schema: CRITIC_JSON_SCHEMA },
      signal: params.signal,
    });

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(result.text);
    } catch {
      console.warn(`[visual-critic] failed to JSON.parse critic response (first 300 chars): ${result.text.slice(0, 300)}`);
      return unavailableCriticOutcome();
    }

    const wire = parseCriticWireResult(parsedRaw);
    if (wire === null) {
      console.warn(
        `[visual-critic] critic response failed schema re-validation (first 300 chars): ${result.text.slice(0, 300)}`,
      );
      return unavailableCriticOutcome();
    }

    const scores: CriticScores = {
      composition: wire.composition,
      color_harmony: wire.color_harmony,
      text_legibility_zone: wire.text_legibility_zone,
    };
    const { totalScore, passesThresholds } = summarizeCriticScores(scores);

    return {
      status: "scored",
      scores,
      unwantedTextDetected: wire.unwantedTextDetected,
      unwantedTextDetail: wire.unwantedTextDetail,
      reasoning: wire.reasoning,
      passesThresholds,
      totalScore,
      costUsdMicros: result.costUsdMicros,
      modelUsed: result.modelUsed,
    };
  } catch (err) {
    // CRIT-04: swallowing an abort here would silently defeat cancellation
    // and let the re-roll loop start another paid attempt after the safety
    // timer fired. Re-throw BEFORE the fail-open return below.
    if (isAbortLikeError(err, params.signal)) throw err;

    console.warn(
      `[visual-critic] critic call failed, treating as unavailable (fail-open): ${(err as Error)?.message ?? String(err)}`,
    );
    return unavailableCriticOutcome();
  }
}
