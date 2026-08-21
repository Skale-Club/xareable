// Functional test for the Autopilot DST/timezone correctness fix: verifies
// computeNextSlotAt (server/services/autopost.service.ts) does timezone-aware
// wall-clock scheduling instead of pure UTC arithmetic — the previous design
// stored posting_times/weekly_day as UTC and let the client convert local <->
// UTC once at save time, which drifted by an hour across every DST
// transition. No network, no DB. Run:
//   npx tsx scripts/test-autopost-timezone.ts
import { computeNextSlotAt, type AutoPostScheduleConfig } from "../server/services/autopost.service.js";

let failures = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (!condition) {
    console.error(`FAIL ${label}${detail ? `\n  ${detail}` : ""}`);
    failures += 1;
    return;
  }
  console.log(`PASS ${label}`);
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    console.error(`FAIL ${label}\n  expected: ${expectedStr}\n  actual:   ${actualStr}`);
    failures += 1;
    return;
  }
  console.log(`PASS ${label}`);
}

// ── Fixture builder ──────────────────────────────────────────────────────────

function track(params: {
  cadence: "daily" | "weekly";
  posting_times: string[];
  weekly_day?: number | null;
  timezone: string;
}): AutoPostScheduleConfig {
  return {
    cadence: params.cadence,
    posting_times: params.posting_times,
    weekly_day: params.weekly_day ?? null,
    timezone: params.timezone,
  };
}

/** The local wall-clock hour (0-23) `instant` reads as in `timeZone`. */
function localHour(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" });
  return parseInt(formatter.formatToParts(instant).find((p) => p.type === "hour")!.value, 10);
}

/** The local wall-clock minute (0-59) `instant` reads as in `timeZone`. */
function localMinute(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, minute: "2-digit" });
  return parseInt(formatter.formatToParts(instant).find((p) => p.type === "minute")!.value, 10);
}

/** The local calendar weekday (0=Sun..6=Sat) `instant` reads as in `timeZone`. */
function localWeekday(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const label = formatter.formatToParts(instant).find((p) => p.type === "weekday")!.value;
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label];
}

// ── 1: THE REGRESSION — America/New_York daily 09:00 stays 09:00 local
//    across both the March 2026 spring-forward and the November 2026
//    fall-back, even though the UTC hour shifts underneath it ─────────────

{
  const t = track({ cadence: "daily", posting_times: ["09:00"], timezone: "America/New_York" });

  // Well before the March 2026 transition (2026-03-08 02:00 EST -> 03:00 EDT).
  const beforeSpring = new Date("2026-03-01T00:00:00Z");
  const afterSpringSlot = computeNextSlotAt(t, beforeSpring);
  assert("NY daily 09:00: slot exists before spring-forward", afterSpringSlot !== null);
  if (afterSpringSlot) {
    assertEqual("NY daily 09:00 (pre-DST, 2026-03-01 anchor) local hour", localHour(afterSpringSlot, "America/New_York"), 9);
    assertEqual("NY daily 09:00 (pre-DST, 2026-03-01 anchor) UTC hour is 14 (EST, UTC-5)", afterSpringSlot.getUTCHours(), 14);
  }

  // Walk slot-by-slot across the spring-forward boundary and confirm the
  // LOCAL hour never moves even though the UTC hour does.
  let cursor = new Date("2026-03-06T00:00:00Z");
  let sawPreDstUtcHour14 = false;
  let sawPostDstUtcHour13 = false;
  for (let i = 0; i < 6; i++) {
    const slot = computeNextSlotAt(t, cursor);
    assert(`NY daily 09:00 spring-forward walk step ${i}: slot exists`, slot !== null);
    if (!slot) break;
    assertEqual(`NY daily 09:00 spring-forward walk step ${i}: local hour stays 09`, localHour(slot, "America/New_York"), 9);
    assertEqual(`NY daily 09:00 spring-forward walk step ${i}: local minute stays 00`, localMinute(slot, "America/New_York"), 0);
    if (slot.getUTCHours() === 14) sawPreDstUtcHour14 = true;
    if (slot.getUTCHours() === 13) sawPostDstUtcHour13 = true;
    cursor = slot;
  }
  assert("NY daily 09:00 spring-forward walk: observed a pre-DST UTC-14:00 slot", sawPreDstUtcHour14);
  assert(
    "NY daily 09:00 spring-forward walk: observed a post-DST UTC-13:00 slot (the UTC hour shifted, proving DST-awareness)",
    sawPostDstUtcHour13,
  );

  // Same walk across the November 2026 fall-back (2026-11-01 02:00 EDT -> 01:00 EST).
  cursor = new Date("2026-10-29T00:00:00Z");
  let sawPreFallUtcHour13 = false;
  let sawPostFallUtcHour14 = false;
  for (let i = 0; i < 6; i++) {
    const slot = computeNextSlotAt(t, cursor);
    assert(`NY daily 09:00 fall-back walk step ${i}: slot exists`, slot !== null);
    if (!slot) break;
    assertEqual(`NY daily 09:00 fall-back walk step ${i}: local hour stays 09`, localHour(slot, "America/New_York"), 9);
    if (slot.getUTCHours() === 13) sawPreFallUtcHour13 = true;
    if (slot.getUTCHours() === 14) sawPostFallUtcHour14 = true;
    cursor = slot;
  }
  assert("NY daily 09:00 fall-back walk: observed a pre-fall-back UTC-13:00 slot", sawPreFallUtcHour13);
  assert(
    "NY daily 09:00 fall-back walk: observed a post-fall-back UTC-14:00 slot (UTC hour shifted back, proving DST-awareness)",
    sawPostFallUtcHour14,
  );
}

// ── 2: America/Sao_Paulo — no DST since 2019 (-03 year-round) ───────────────

{
  const t = track({ cadence: "daily", posting_times: ["09:00"], timezone: "America/Sao_Paulo" });
  let cursor = new Date("2026-01-01T00:00:00Z");
  for (let i = 0; i < 10; i++) {
    const slot = computeNextSlotAt(t, cursor);
    assert(`Sao_Paulo daily 09:00 step ${i}: slot exists`, slot !== null);
    if (!slot) break;
    assertEqual(`Sao_Paulo daily 09:00 step ${i}: local hour stays 09`, localHour(slot, "America/Sao_Paulo"), 9);
    assertEqual(`Sao_Paulo daily 09:00 step ${i}: UTC hour stays 12 (fixed -03)`, slot.getUTCHours(), 12);
    cursor = slot;
  }
  // Also check a date deep into what USED to be DST season pre-2019, to make
  // sure nothing accidentally reintroduces a seasonal offset.
  const julSlot = computeNextSlotAt(t, new Date("2026-07-15T00:00:00Z"));
  assert("Sao_Paulo daily 09:00 in July: slot exists", julSlot !== null);
  if (julSlot) assertEqual("Sao_Paulo daily 09:00 in July: still local 09 / UTC 12", [localHour(julSlot, "America/Sao_Paulo"), julSlot.getUTCHours()], [9, 12]);
}

// ── 3: Asia/Kolkata — a half-hour offset zone (+05:30) ───────────────────────

{
  const t = track({ cadence: "daily", posting_times: ["09:00"], timezone: "Asia/Kolkata" });
  const slot = computeNextSlotAt(t, new Date("2026-06-01T00:00:00Z"));
  assert("Kolkata daily 09:00: slot exists", slot !== null);
  if (slot) {
    assertEqual("Kolkata daily 09:00: local hour is 09", localHour(slot, "Asia/Kolkata"), 9);
    assertEqual("Kolkata daily 09:00: local minute is 00", localMinute(slot, "Asia/Kolkata"), 0);
    // 09:00 IST (+05:30) = 03:30 UTC.
    assertEqual("Kolkata daily 09:00: UTC instant is 03:30", [slot.getUTCHours(), slot.getUTCMinutes()], [3, 30]);
  }
}

// ── 4: Pacific/Chatham — extreme fractional offset WITH DST (+12:45/+13:45) ─

{
  const t = track({ cadence: "daily", posting_times: ["09:00"], timezone: "Pacific/Chatham" });
  let cursor = new Date("2026-01-01T00:00:00Z");
  let sawStandardOffset = false;
  let sawDstOffset = false;
  for (let i = 0; i < 12; i++) {
    const slot = computeNextSlotAt(t, cursor);
    assert(`Chatham daily 09:00 step ${i}: slot exists`, slot !== null);
    if (!slot) break;
    assertEqual(`Chatham daily 09:00 step ${i}: local hour stays 09`, localHour(slot, "Pacific/Chatham"), 9);
    assertEqual(`Chatham daily 09:00 step ${i}: local minute stays 00`, localMinute(slot, "Pacific/Chatham"), 0);
    // +12:45 (standard) => UTC 20:15 the previous day; +13:45 (DST) => UTC 19:15.
    const utcMinuteOfDay = slot.getUTCHours() * 60 + slot.getUTCMinutes();
    if (utcMinuteOfDay === 20 * 60 + 15) sawStandardOffset = true;
    if (utcMinuteOfDay === 19 * 60 + 15) sawDstOffset = true;
    cursor = new Date(slot.getTime() + 45 * 24 * 60 * 60 * 1000); // jump ~45 days to cross both transitions within 12 steps
  }
  assert("Chatham daily 09:00: observed the standard (+12:45) offset at some point", sawStandardOffset);
  assert("Chatham daily 09:00: observed the DST (+13:45) offset at some point", sawDstOffset);
}

// ── 5: UTC — identical to the old pure-UTC math (regression guard) ──────────

{
  const t = track({ cadence: "daily", posting_times: ["09:00", "18:30"], timezone: "UTC" });
  const after = new Date("2026-05-01T10:00:00Z");
  const slot = computeNextSlotAt(t, after);
  assertEqual("UTC daily [09:00,18:30] after 10:00Z -> 18:30Z same day", slot?.toISOString(), "2026-05-01T18:30:00.000Z");

  const afterBoth = new Date("2026-05-01T20:00:00Z");
  const slot2 = computeNextSlotAt(t, afterBoth);
  assertEqual("UTC daily [09:00,18:30] after 20:00Z -> 09:00Z next day", slot2?.toISOString(), "2026-05-02T09:00:00.000Z");
}

// ── 6: Weekly cadence — local weekday holds across a DST boundary, including
//    a posting time near local midnight where local and UTC weekday differ ──

{
  // weekly_day = 1 (Monday), 09:00 local, America/New_York, spanning the
  // March 2026 spring-forward (which falls on a Sunday -> Monday transition
  // week: 2026-03-08 is a Sunday).
  const t = track({ cadence: "weekly", posting_times: ["09:00"], weekly_day: 1, timezone: "America/New_York" });
  let cursor = new Date("2026-02-01T00:00:00Z");
  for (let i = 0; i < 4; i++) {
    const slot = computeNextSlotAt(t, cursor);
    assert(`NY weekly Monday 09:00 step ${i}: slot exists`, slot !== null);
    if (!slot) break;
    assertEqual(`NY weekly Monday 09:00 step ${i}: local weekday is Monday`, localWeekday(slot, "America/New_York"), 1);
    assertEqual(`NY weekly Monday 09:00 step ${i}: local hour is 09`, localHour(slot, "America/New_York"), 9);
    cursor = slot;
  }

  // Near-local-midnight case: weekly_day = 1 (Monday) at 00:15 local in a
  // zone well ahead of UTC (Asia/Kolkata, +05:30) — 00:15 IST Monday is
  // still SUNDAY in UTC (18:45 UTC Sunday). The LOCAL weekday must still
  // read Monday.
  const midnightTrack = track({ cadence: "weekly", posting_times: ["00:15"], weekly_day: 1, timezone: "Asia/Kolkata" });
  const midnightSlot = computeNextSlotAt(midnightTrack, new Date("2026-04-01T00:00:00Z"));
  assert("Kolkata weekly Monday 00:15: slot exists", midnightSlot !== null);
  if (midnightSlot) {
    assertEqual("Kolkata weekly Monday 00:15: LOCAL weekday is Monday", localWeekday(midnightSlot, "Asia/Kolkata"), 1);
    assert(
      "Kolkata weekly Monday 00:15: UTC weekday differs from local weekday (proves this isn't just reading getUTCDay())",
      midnightSlot.getUTCDay() !== 1,
      `UTC weekday was ${midnightSlot.getUTCDay()}, local was 1 (Monday) — expected these to differ for this fixture`,
    );
  }
}

// ── 7: Multiple posting times sorted correctly within a day + rollover ──────

{
  const t = track({ cadence: "daily", posting_times: ["18:00", "06:00", "12:00"], timezone: "America/New_York" });
  const afterEarly = new Date("2026-06-01T04:00:00Z"); // 00:00 EDT — before all three
  const first = computeNextSlotAt(t, afterEarly);
  assert("NY daily multi-time: first slot exists", first !== null);
  if (first) assertEqual("NY daily multi-time: sorted ascending picks 06:00 first", localHour(first, "America/New_York"), 6);

  const second = first ? computeNextSlotAt(t, first) : null;
  assert("NY daily multi-time: second slot exists", second !== null);
  if (second) assertEqual("NY daily multi-time: second pick is 12:00", localHour(second, "America/New_York"), 12);

  const third = second ? computeNextSlotAt(t, second) : null;
  assert("NY daily multi-time: third slot exists", third !== null);
  if (third) assertEqual("NY daily multi-time: third pick is 18:00", localHour(third, "America/New_York"), 18);

  const fourth = third ? computeNextSlotAt(t, third) : null;
  assert("NY daily multi-time: rolls over to next day", fourth !== null);
  if (fourth && third) {
    assertEqual("NY daily multi-time: next-day pick is 06:00 again", localHour(fourth, "America/New_York"), 6);
    assert("NY daily multi-time: next-day pick is strictly later than third", fourth.getTime() > third.getTime());
  }
}

{
  // Weekly rollover: after this week's occurrence, the next slot is exactly
  // one week later (allowing for a DST shift in the UTC gap, but the local
  // weekday+time must be identical).
  const t = track({ cadence: "weekly", posting_times: ["09:00"], weekly_day: 3, timezone: "America/New_York" }); // Wednesday
  const first = computeNextSlotAt(t, new Date("2026-03-04T00:00:00Z"));
  const second = first ? computeNextSlotAt(t, first) : null;
  assert("NY weekly rollover: both slots exist", first !== null && second !== null);
  if (first && second) {
    assertEqual("NY weekly rollover: both land on Wednesday locally", [localWeekday(first, "America/New_York"), localWeekday(second, "America/New_York")], [3, 3]);
    assertEqual("NY weekly rollover: both at 09:00 locally", [localHour(first, "America/New_York"), localHour(second, "America/New_York")], [9, 9]);
    assert("NY weekly rollover: second is strictly after first", second.getTime() > first.getTime());
  }
}

// ── 8: Invalid config returns null ───────────────────────────────────────────

assertEqual(
  "invalid: empty posting_times -> null",
  computeNextSlotAt(track({ cadence: "daily", posting_times: [], timezone: "UTC" }), new Date()),
  null,
);
assertEqual(
  "invalid: unparseable posting_times entries -> null",
  computeNextSlotAt(
    { cadence: "daily", posting_times: ["not-a-time", "25:99"], weekly_day: null, timezone: "UTC" },
    new Date(),
  ),
  null,
);
assertEqual(
  "invalid: weekly with null weekly_day -> null",
  computeNextSlotAt(track({ cadence: "weekly", posting_times: ["09:00"], weekly_day: null, timezone: "UTC" }), new Date()),
  null,
);
assertEqual(
  "invalid: weekly with out-of-range weekly_day (7) -> null",
  computeNextSlotAt({ cadence: "weekly", posting_times: ["09:00"], weekly_day: 7, timezone: "UTC" }, new Date()),
  null,
);
assertEqual(
  "invalid: weekly with out-of-range weekly_day (-1) -> null",
  computeNextSlotAt({ cadence: "weekly", posting_times: ["09:00"], weekly_day: -1, timezone: "UTC" }, new Date()),
  null,
);
assertEqual(
  "invalid: unknown timezone string -> null, not a throw",
  computeNextSlotAt(track({ cadence: "daily", posting_times: ["09:00"], timezone: "Not/AZone" }), new Date()),
  null,
);
assertEqual(
  "invalid: empty-string timezone -> null, not a throw",
  computeNextSlotAt(track({ cadence: "daily", posting_times: ["09:00"], timezone: "" }), new Date()),
  null,
);

// ── 9: Spring-forward gap — a wall-clock time that doesn't exist ────────────

{
  // 2026-03-08 is America/New_York's spring-forward day; 02:00-02:59 local
  // does not exist (clocks jump 02:00 EST -> 03:00 EDT).
  const t = track({ cadence: "daily", posting_times: ["02:30"], timezone: "America/New_York" });
  const after = new Date("2026-03-07T12:00:00Z"); // well before the gap
  let threw = false;
  let slot: Date | null = null;
  try {
    slot = computeNextSlotAt(t, after);
  } catch {
    threw = true;
  }
  assert("NY spring-forward gap (02:30): computeNextSlotAt does not throw", !threw);
  assert("NY spring-forward gap (02:30): returns a slot (not null)", slot !== null);
  if (slot) {
    assert("NY spring-forward gap (02:30): result is not NaN", !Number.isNaN(slot.getTime()));
    assert("NY spring-forward gap (02:30): result is strictly after `after`", slot.getTime() > after.getTime());
  }
}

// ── 10: Strict monotonicity across a DST boundary (materializeDueSlots'
//     fast-forward loop depends on this — a non-advancing return spins it) ──

{
  const t = track({ cadence: "daily", posting_times: ["09:00"], timezone: "America/New_York" });
  let cursor = new Date("2026-03-01T00:00:00Z"); // before spring-forward
  let prev: Date | null = null;
  let allStrictlyIncreasing = true;
  for (let i = 0; i < 20; i++) {
    const slot = computeNextSlotAt(t, cursor);
    if (!slot) {
      allStrictlyIncreasing = false;
      break;
    }
    if (prev && slot.getTime() <= prev.getTime()) {
      allStrictlyIncreasing = false;
      break;
    }
    prev = slot;
    cursor = slot;
  }
  assert("NY daily 09:00: 20 chained computeNextSlotAt calls across March DST are strictly increasing", allStrictlyIncreasing);
}

{
  // Same monotonicity check across the November fall-back, and for a weekly
  // cadence too.
  const t = track({ cadence: "weekly", posting_times: ["01:30", "09:00"], weekly_day: 0, timezone: "America/New_York" }); // Sunday
  let cursor = new Date("2026-10-01T00:00:00Z"); // before fall-back (2026-11-01)
  let prev: Date | null = null;
  let allStrictlyIncreasing = true;
  for (let i = 0; i < 20; i++) {
    const slot = computeNextSlotAt(t, cursor);
    if (!slot) {
      allStrictlyIncreasing = false;
      break;
    }
    if (prev && slot.getTime() <= prev.getTime()) {
      allStrictlyIncreasing = false;
      break;
    }
    prev = slot;
    cursor = slot;
  }
  assert(
    "NY weekly Sunday [01:30,09:00]: 20 chained computeNextSlotAt calls across November fall-back are strictly increasing",
    allStrictlyIncreasing,
  );
}

// ── 11: Fall-back ambiguity — deterministic, prefers the FIRST occurrence ───

{
  // 2026-11-01 01:30 America/New_York happens twice: 01:30 EDT (UTC-4,
  // earlier) and 01:30 EST (UTC-5, an hour later). Assert the same input
  // always resolves to the same instant (deterministic) and that it's the
  // EARLIER of the two possible real-world instants.
  const t = track({ cadence: "daily", posting_times: ["01:30"], timezone: "America/New_York" });
  // Deliberately AFTER Oct 31's own (unambiguous) 01:30 occurrence
  // (2026-10-31T05:30:00Z) so the next slot found is the ambiguous Nov 1
  // one, not just the ordinary day before it.
  const after = new Date("2026-11-01T00:00:00Z");
  const slotA = computeNextSlotAt(t, after);
  const slotB = computeNextSlotAt(t, after);
  assert("NY fall-back 01:30: slot exists", slotA !== null);
  assertEqual("NY fall-back 01:30: deterministic (same input -> same output)", slotA?.toISOString(), slotB?.toISOString());
  if (slotA) {
    assertEqual("NY fall-back 01:30: local hour reads 01", localHour(slotA, "America/New_York"), 1);
    assertEqual("NY fall-back 01:30: local minute reads 30", localMinute(slotA, "America/New_York"), 30);
    // The earlier (EDT, UTC-4) occurrence of 01:30 local is 05:30 UTC; the
    // later (EST, UTC-5) occurrence is 06:30 UTC. Assert we got the earlier one.
    assertEqual(
      "NY fall-back 01:30: resolves to the EARLIER (EDT, 05:30 UTC) occurrence, not the later (EST, 06:30 UTC) one",
      slotA.toISOString(),
      "2026-11-01T05:30:00.000Z",
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}

console.log("\nAll Autopilot DST/timezone tests passed.");
