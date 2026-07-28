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
// Task 1 (this block): PURE decision functions, zero imports from
// ai-gateway.service.ts. Proven by scripts/test-critic-reroll-logic.ts
// (no network). Task 2 appends the actual multimodal gateway call below.

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
