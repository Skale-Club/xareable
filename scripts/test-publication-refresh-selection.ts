// Functional test for the post_publications sweep-selection fix: relevance
// anchored on scheduled_for (not created_at alone), the refresh_attempts
// cap, and the NULL-scheduled_for defensive fallback. No network, no DB.
// Run:
//   npx tsx scripts/test-publication-refresh-selection.ts
import {
  MAX_REFRESH_ATTEMPTS,
  computeSweepCutoffs,
  shouldPollPublication,
  type SweepableRow,
} from "../server/services/social-publish.service.js";

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

const NOW = Date.parse("2026-08-21T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function row(params: {
  status: string;
  createdAgoMs?: number;
  updatedAgoMs?: number;
  scheduledForMs?: number | null;
  refreshAttempts?: number;
}): SweepableRow {
  const createdAgoMs = params.createdAgoMs ?? 0;
  const updatedAgoMs = params.updatedAgoMs ?? 5 * MINUTE_MS; // touched a while ago by default (not in quiet window)
  return {
    id: "test-row",
    status: params.status,
    created_at: iso(NOW - createdAgoMs),
    updated_at: iso(NOW - updatedAgoMs),
    scheduled_for: params.scheduledForMs === undefined ? null : params.scheduledForMs === null ? null : iso(params.scheduledForMs),
    refresh_attempts: params.refreshAttempts ?? 0,
  };
}

// ── 1-2: pending, inside/outside the 7-day window ───────────────────────────

assertEqual(
  "pending row created 1 day ago -> IS polled",
  shouldPollPublication(row({ status: "pending", createdAgoMs: 1 * DAY_MS }), NOW),
  true,
);

assertEqual(
  "pending row created 8 days ago -> NOT polled (past the 7-day abandon window)",
  shouldPollPublication(row({ status: "pending", createdAgoMs: 8 * DAY_MS }), NOW),
  false,
);

// ── 3-4: scheduled row far in the future, then once scheduled_for arrives ──

assertEqual(
  "scheduled row due in 10 days -> NOT polled (nothing can change before scheduled_for)",
  shouldPollPublication(
    row({ status: "scheduled", createdAgoMs: 0, scheduledForMs: NOW + 10 * DAY_MS }),
    NOW,
  ),
  false,
);

assertEqual(
  "same row once scheduled_for is now (created 10 days ago, due now) -> IS polled",
  shouldPollPublication(
    row({ status: "scheduled", createdAgoMs: 10 * DAY_MS, scheduledForMs: NOW }),
    NOW,
  ),
  true,
);

assertEqual(
  "scheduled row due in 4 minutes (inside the 5-minute look-ahead) -> IS polled",
  shouldPollPublication(
    row({ status: "scheduled", createdAgoMs: 10 * DAY_MS, scheduledForMs: NOW + 4 * MINUTE_MS }),
    NOW,
  ),
  true,
);

assertEqual(
  "scheduled row due in 6 minutes (outside the 5-minute look-ahead) -> NOT polled",
  shouldPollPublication(
    row({ status: "scheduled", createdAgoMs: 10 * DAY_MS, scheduledForMs: NOW + 6 * MINUTE_MS }),
    NOW,
  ),
  false,
);

// ── 5: scheduled row 8 days stale ───────────────────────────────────────────

assertEqual(
  "scheduled row whose scheduled_for was 8 days ago -> NOT polled (abandoned — this is the bug this fix closes)",
  shouldPollPublication(
    row({ status: "scheduled", createdAgoMs: 8 * DAY_MS, scheduledForMs: NOW - 8 * DAY_MS }),
    NOW,
  ),
  false,
);

assertEqual(
  "scheduled row whose scheduled_for was 6 days ago -> IS polled (stale-but-not-abandoned)",
  shouldPollPublication(
    row({ status: "scheduled", createdAgoMs: 6 * DAY_MS, scheduledForMs: NOW - 6 * DAY_MS }),
    NOW,
  ),
  true,
);

// ── 6: row at MAX_REFRESH_ATTEMPTS ──────────────────────────────────────────

assertEqual(
  "pending row at MAX_REFRESH_ATTEMPTS -> NOT polled",
  shouldPollPublication(
    row({ status: "pending", createdAgoMs: 1 * DAY_MS, refreshAttempts: MAX_REFRESH_ATTEMPTS }),
    NOW,
  ),
  false,
);

assertEqual(
  "pending row one below MAX_REFRESH_ATTEMPTS -> IS polled",
  shouldPollPublication(
    row({ status: "pending", createdAgoMs: 1 * DAY_MS, refreshAttempts: MAX_REFRESH_ATTEMPTS - 1 }),
    NOW,
  ),
  true,
);

assertEqual(
  "scheduled+due row at MAX_REFRESH_ATTEMPTS -> NOT polled",
  shouldPollPublication(
    row({
      status: "scheduled",
      createdAgoMs: 10 * DAY_MS,
      scheduledForMs: NOW,
      refreshAttempts: MAX_REFRESH_ATTEMPTS,
    }),
    NOW,
  ),
  false,
);

// ── 7: scheduled row with null scheduled_for ────────────────────────────────

assertEqual(
  "scheduled row with NULL scheduled_for, created 1 day ago -> IS polled (defensive created_at fallback)",
  shouldPollPublication(row({ status: "scheduled", createdAgoMs: 1 * DAY_MS, scheduledForMs: null }), NOW),
  true,
);

assertEqual(
  "scheduled row with NULL scheduled_for, created 8 days ago -> NOT polled (fallback window also expires)",
  shouldPollPublication(row({ status: "scheduled", createdAgoMs: 8 * DAY_MS, scheduledForMs: null }), NOW),
  false,
);

// ── 8: quiet window — a row touched within the last 60s is never re-selected

assertEqual(
  "pending row touched 30s ago -> NOT polled (inside the 60s quiet window)",
  shouldPollPublication(row({ status: "pending", createdAgoMs: 1 * DAY_MS, updatedAgoMs: 30_000 }), NOW),
  false,
);

assertEqual(
  "pending row touched 90s ago -> IS polled (outside the 60s quiet window)",
  shouldPollPublication(row({ status: "pending", createdAgoMs: 1 * DAY_MS, updatedAgoMs: 90_000 }), NOW),
  true,
);

// ── 9: unrecognized/terminal statuses are never selected ───────────────────

assertEqual(
  "published row -> NOT polled (terminal state)",
  shouldPollPublication(row({ status: "published", createdAgoMs: 1 * DAY_MS }), NOW),
  false,
);

assertEqual(
  "failed row -> NOT polled (terminal state)",
  shouldPollPublication(row({ status: "failed", createdAgoMs: 1 * DAY_MS }), NOW),
  false,
);

// ── 10: computeSweepCutoffs — sanity check on the derived timestamps ───────

{
  const cutoffs = computeSweepCutoffs(NOW);
  assertEqual("computeSweepCutoffs(NOW).nowIso", cutoffs.nowIso, iso(NOW));
  assertEqual("computeSweepCutoffs(NOW).pending.createdAfter is 7 days before now", cutoffs.pending.createdAfter, iso(NOW - 7 * DAY_MS));
  assertEqual("computeSweepCutoffs(NOW).pending.updatedBefore is 60s before now", cutoffs.pending.updatedBefore, iso(NOW - 60_000));
  assertEqual("computeSweepCutoffs(NOW).scheduled.dueBy is 5 minutes after now", cutoffs.scheduled.dueBy, iso(NOW + 5 * MINUTE_MS));
  assertEqual(
    "computeSweepCutoffs(NOW).scheduled.abandonedAfter is 7 days before now",
    cutoffs.scheduled.abandonedAfter,
    iso(NOW - 7 * DAY_MS),
  );
}

console.log("\nAll post_publications sweep-selection tests passed.");
