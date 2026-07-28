// Functional test for CRIT-02: the pure re-roll decision matrix (hard-fail
// asymmetry, soft-fail best-of-3 tie-break, fail-open-on-outage, and the
// discarded-attempt cost exclusion). No network. Run:
//   npx tsx scripts/test-critic-reroll-logic.ts
import {
  CRITIC_MIN_DIMENSION_SCORE,
  MAX_REROLL_ATTEMPTS,
  computeRerollMetadata,
  selectFinalAttempt,
  shouldRerollAfter,
  summarizeCriticScores,
  type CriticAttempt,
  type CriticOutcome,
  type CriticScores,
} from "../server/services/visual-critic.service.js";

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    console.error(`FAIL ${label}\n  expected: ${expectedStr}\n  actual:   ${actualStr}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

// ── Fixture builders ────────────────────────────────────────────────────────

function scoredOutcome(params: {
  composition: number;
  color_harmony: number;
  text_legibility_zone: number;
  unwantedText?: boolean;
  costUsdMicros?: number;
}): CriticOutcome {
  const scores: CriticScores = {
    composition: params.composition,
    color_harmony: params.color_harmony,
    text_legibility_zone: params.text_legibility_zone,
  };
  const { totalScore, passesThresholds } = summarizeCriticScores(scores);
  const unwantedTextDetected = params.unwantedText ?? false;
  return {
    status: "scored",
    scores,
    unwantedTextDetected,
    unwantedTextDetail: unwantedTextDetected ? "detected watermark-style overlay text" : "",
    reasoning: "test fixture",
    passesThresholds,
    totalScore,
    costUsdMicros: params.costUsdMicros,
  };
}

function unavailableOutcome(): CriticOutcome {
  return {
    status: "unavailable",
    scores: null,
    unwantedTextDetected: false,
    unwantedTextDetail: "",
    reasoning: "critic unavailable",
    passesThresholds: false,
    totalScore: 0,
  };
}

function attempt(index: number, outcome: CriticOutcome, imageCostUsdMicros = 0): CriticAttempt {
  return { index, outcome, imageCostUsdMicros };
}

// ── 1-3: summarizeCriticScores ──────────────────────────────────────────────

{
  const { totalScore, passesThresholds } = summarizeCriticScores({ composition: 5, color_harmony: 5, text_legibility_zone: 5 });
  assertEqual("summarizeCriticScores({5,5,5}) totalScore", totalScore, 15);
  assertEqual("summarizeCriticScores({5,5,5}) passesThresholds", passesThresholds, true);
}
{
  const { passesThresholds } = summarizeCriticScores({ composition: 3, color_harmony: 3, text_legibility_zone: 3 });
  assertEqual("summarizeCriticScores({3,3,3}) passesThresholds is true (3 is the inclusive floor)", passesThresholds, true);
}
{
  const { passesThresholds } = summarizeCriticScores({ composition: 3, color_harmony: 3, text_legibility_zone: 2 });
  assertEqual("summarizeCriticScores({3,3,2}) passesThresholds is false (ANY dimension < 3 fails)", passesThresholds, false);
}

// ── 4-7: shouldRerollAfter ───────────────────────────────────────────────────

assertEqual(
  "shouldRerollAfter(scored, passes, no unwanted text) is false",
  shouldRerollAfter(scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5 })),
  false,
);
assertEqual(
  "shouldRerollAfter(scored, soft-fail) is true",
  shouldRerollAfter(scoredOutcome({ composition: 2, color_harmony: 4, text_legibility_zone: 4 })),
  true,
);
assertEqual(
  "shouldRerollAfter(scored, unwanted text, perfect scores) is true",
  shouldRerollAfter(scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })),
  true,
);
assertEqual(
  "shouldRerollAfter(unavailable) is false — an outage must not burn re-rolls",
  shouldRerollAfter(unavailableOutcome()),
  false,
);

// ── 8-18: selectFinalAttempt ─────────────────────────────────────────────────

assertEqual(
  "selectFinalAttempt([pass]) -> accepted 1, outcome pass",
  selectFinalAttempt([attempt(1, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5 }))]),
  { acceptedIndex: 1, outcome: "pass" },
);

assertEqual(
  "selectFinalAttempt([hardFail, pass]) -> accepted 2, outcome pass",
  selectFinalAttempt([
    attempt(1, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })),
    attempt(2, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5 })),
  ]),
  { acceptedIndex: 2, outcome: "pass" },
);

assertEqual(
  "selectFinalAttempt([softFail(9), softFail(12), softFail(10)]) -> accepted 2, outcome soft_fail_accepted_best",
  selectFinalAttempt([
    attempt(1, scoredOutcome({ composition: 2, color_harmony: 3, text_legibility_zone: 4 })), // total 9
    attempt(2, scoredOutcome({ composition: 2, color_harmony: 5, text_legibility_zone: 5 })), // total 12
    attempt(3, scoredOutcome({ composition: 2, color_harmony: 4, text_legibility_zone: 4 })), // total 10
  ]),
  { acceptedIndex: 2, outcome: "soft_fail_accepted_best" },
);

assertEqual(
  "selectFinalAttempt([softFail(11), softFail(11)]) -> accepted 1 (tie -> lowest index, deterministic)",
  selectFinalAttempt([
    attempt(1, scoredOutcome({ composition: 2, color_harmony: 4, text_legibility_zone: 5 })), // total 11
    attempt(2, scoredOutcome({ composition: 2, color_harmony: 4, text_legibility_zone: 5 })), // total 11
  ]),
  { acceptedIndex: 1, outcome: "soft_fail_accepted_best" },
);

assertEqual(
  "selectFinalAttempt([hardFail(15), softFail(6)]) -> accepted 2 — a hard-fail attempt is NEVER selected even with a strictly higher total",
  selectFinalAttempt([
    attempt(1, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })), // total 15
    attempt(2, scoredOutcome({ composition: 2, color_harmony: 2, text_legibility_zone: 2 })), // total 6
  ]),
  { acceptedIndex: 2, outcome: "soft_fail_accepted_best" },
);

assertEqual(
  "selectFinalAttempt([hardFail, hardFail, hardFail]) -> accepted null, outcome hard_fail_all_attempts",
  selectFinalAttempt([
    attempt(1, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })),
    attempt(2, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })),
    attempt(3, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })),
  ]),
  { acceptedIndex: null, outcome: "hard_fail_all_attempts" },
);

assertEqual(
  "selectFinalAttempt([hardFail, softFail, hardFail]) -> accepted 2, outcome soft_fail_accepted_best",
  selectFinalAttempt([
    attempt(1, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })),
    attempt(2, scoredOutcome({ composition: 2, color_harmony: 3, text_legibility_zone: 3 })),
    attempt(3, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })),
  ]),
  { acceptedIndex: 2, outcome: "soft_fail_accepted_best" },
);

assertEqual(
  "selectFinalAttempt([unavailable]) -> accepted 1, outcome critic_unavailable",
  selectFinalAttempt([attempt(1, unavailableOutcome())]),
  { acceptedIndex: 1, outcome: "critic_unavailable" },
);

assertEqual(
  "selectFinalAttempt([softFail, unavailable]) -> accepted 1, outcome soft_fail_accepted_best (an observed non-hard-fail image beats an unobserved one)",
  selectFinalAttempt([
    attempt(1, scoredOutcome({ composition: 2, color_harmony: 3, text_legibility_zone: 3 })),
    attempt(2, unavailableOutcome()),
  ]),
  { acceptedIndex: 1, outcome: "soft_fail_accepted_best" },
);

assertEqual(
  "selectFinalAttempt([hardFail, unavailable]) -> accepted 2, outcome critic_unavailable",
  selectFinalAttempt([
    attempt(1, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true })),
    attempt(2, unavailableOutcome()),
  ]),
  { acceptedIndex: 2, outcome: "critic_unavailable" },
);

assertEqual(
  "selectFinalAttempt([]) -> accepted null, outcome hard_fail_all_attempts (total function, no throw)",
  selectFinalAttempt([]),
  { acceptedIndex: null, outcome: "hard_fail_all_attempts" },
);

// ── 19-21: computeRerollMetadata ─────────────────────────────────────────────

assertEqual(
  "computeRerollMetadata(3 attempts costing 100/200/400 image + 10/20/40 critic, acceptedIndex 2) -> discarded-only sum, accepted 220 excluded",
  computeRerollMetadata(
    [
      attempt(1, scoredOutcome({ composition: 2, color_harmony: 3, text_legibility_zone: 3, costUsdMicros: 10 }), 100),
      attempt(2, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, costUsdMicros: 20 }), 200),
      attempt(3, scoredOutcome({ composition: 2, color_harmony: 3, text_legibility_zone: 3, costUsdMicros: 40 }), 400),
    ],
    2,
  ),
  { reroll_attempt_count: 2, reroll_cost_usd_micros: 550 },
);

assertEqual(
  "computeRerollMetadata(single accepted attempt) -> zero reroll count and cost",
  computeRerollMetadata(
    [attempt(1, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, costUsdMicros: 20 }), 200)],
    1,
  ),
  { reroll_attempt_count: 0, reroll_cost_usd_micros: 0 },
);

assertEqual(
  "computeRerollMetadata(attempts, acceptedIndex: null) -> counts every attempt as discarded",
  computeRerollMetadata(
    [
      attempt(1, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true, costUsdMicros: 10 }), 100),
      attempt(2, scoredOutcome({ composition: 5, color_harmony: 5, text_legibility_zone: 5, unwantedText: true, costUsdMicros: 20 }), 200),
    ],
    null,
  ),
  { reroll_attempt_count: 2, reroll_cost_usd_micros: 330 },
);

// ── 22-23: locked constants ──────────────────────────────────────────────────

assertEqual("MAX_REROLL_ATTEMPTS === 2", MAX_REROLL_ATTEMPTS, 2);
assertEqual("CRITIC_MIN_DIMENSION_SCORE === 3", CRITIC_MIN_DIMENSION_SCORE, 3);

console.log("\nAll CRIT-02 re-roll decision tests passed.");
