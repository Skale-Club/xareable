/**
 * Autopilot sweep — computeNextSlotAt (pure scheduling math), runAutoPostSweep
 * (the 5-minute cron job entry point), and publishAutoPostItem (the
 * single-item publish helper shared by the sweep and the manual "approve"
 * route).
 *
 * See docs/autopost-scheduling.md ("State machine", "Sweep design") for the
 * full contract this file implements. NOTE: that doc still describes the
 * PRE-two-lane single-lock design (materialize → publish → generate → janitor
 * under one autoPostSweepRunning lock) — this file has since split into two
 * independently-locked lanes (see "Sweep entry point" below); the doc is
 * owned by a different file-ownership slice and hasn't been updated to match.
 *
 * TWO trigger paths coexist (mirrors cleanup-cron.service.ts): node-cron via
 * startCronJobs() and the HTTP trigger at POST /api/internal/autopost/sweep.
 * Both call runAutoPostSweep() directly — no logic divergence, and its
 * signature/return shape (AutoPostSweepResult) is unchanged by the two-lane
 * split below, so neither caller needed to change. Cross-process
 * double-firing is handled at the DB layer: every slot insert is protected
 * by auto_post_items' (track_id, scheduled_for) unique constraint, and every
 * status transition is an optimistic guarded update
 * (`update ... where status = <expected>`) — a cross-process race only ever
 * produces a skipped claim, never a duplicate post/charge/publish.
 */

import { createAdminSupabase } from "../supabase.js";
import { captureException } from "../lib/observability.js";
import {
    AUTO_POST_TIME_REGEX,
    isValidIanaTimeZone,
    type AutoPostItem,
    type AutoPostItemStatus,
    type AutoPostTrack,
    type AutoPostTrackCadence,
    type PostPublication,
} from "../../shared/schema.js";
import { resolveZernioCredentials } from "./zernio-credentials.service.js";
import { publishPost, mapZernioError } from "./social-publish.service.js";
import { generateAutoPost } from "./autopost-generation.service.js";

// ── Constants (docs/autopost-scheduling.md "Sweep design") ─────────────────

/** node-cron schedule — every 5 minutes. */
export const SWEEP_CRON = "*/5 * * * *";

/** Manual-mode tracks materialize a slot's item this far ahead of the publish
 * time, giving the owner a window to approve/reject before it goes live. */
export const GENERATION_LEAD_MS = {
    manual: 12 * 60 * 60 * 1000,
    auto: 0,
} as const;

/** Max tracks materialized / items generated per sweep tick. Generation is
 * sequential (one AI call chain at a time), so this bounds a single tick's
 * wall time, not just its DB read size. */
export const TRACK_BATCH_LIMIT = 10;

/** M3 — after downtime, a track can have MANY missed slots queued up behind
 * its stale `next_slot_at`. Materializing (and paying to generate/publish)
 * one item per slot would flood old, stale content out to live social
 * accounts — Autopilot promises no catch-up. Any slot older than this grace
 * window is fast-forwarded past (skipped, no item materialized) instead; only
 * the most recent missed slot within the grace window still gets one. */
export const MATERIALIZE_GRACE_MS = 60 * 60 * 1000;

/** Bounds the fast-forward loop above so a pathological config (or a bug in
 * computeNextSlotAt) can't spin forever inside one sweep tick. */
export const MAX_MATERIALIZE_FASTFORWARD_ITERATIONS = 100;

/** Max approved-and-due items published per sweep tick. */
export const PUBLISH_BATCH_LIMIT = 20;

/** An item stuck in 'generating' longer than this is presumed crashed
 * mid-pipeline (process restart, uncaught rejection) and is failed by the
 * janitor phase so it can be retried instead of hanging forever. */
export const GENERATING_STALE_MS = 30 * 60 * 1000;

/** Consecutive generation failures after which a track auto-pauses. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** M3-adjacent — a manual-mode item sitting in 'awaiting_approval' longer
 * than this is presumed abandoned by its owner (never reviewed) rather than
 * "about to be approved any minute now." Approving (and publishing) content
 * that was generated a week-plus ago would contradict the same "Autopilot
 * never does catch-up" contract materializeDueSlots enforces for freshly
 * missed slots — it's just as stale. 7 days: generous enough that a normal
 * absence (a short vacation, a busy week) never silently expires someone's
 * queue, but short enough that "still awaiting approval" keeps an
 * unambiguous meaning of "fresh and actionable." Enforced by the janitor's
 * third pass, below. */
export const AWAITING_APPROVAL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface AutoPostSweepResult {
    materialized: number;
    generated: number;
    published: number;
    failed: number;
    /**
     * Whether each lane actually RAN this tick, or was skipped because its
     * own in-process lock was still held by a previous tick.
     *
     * This has to be surfaced, not just logged: a skipped lane contributes
     * zeros to every counter above, which is byte-for-byte identical to
     * "the lane ran and there was nothing to do". Those two states need very
     * different responses — one is healthy idling, the other is a lane wedged
     * long enough to starve every subsequent tick. `cron_runs.result`
     * (server/services/cron-runs.service.ts) stores this whole object, so
     * without these flags the admin cron health view would report a wedged
     * generation lane as a series of perfectly healthy zero-work runs — the
     * exact "running idle and nobody noticed" failure that observability was
     * added to catch.
     */
    fast_lane_skipped: boolean;
    generation_lane_skipped: boolean;
}

// ── computeNextSlotAt — pure scheduling math ────────────────────────────────

interface ParsedTime {
    h: number;
    m: number;
}

/** Config shape computeNextSlotAt needs — a subset of AutoPostTrack so callers
 * can pass either a full row or a request-shaped patch merge.
 *
 * TIMEZONE REDEFINITION (supabase/migrations/20260821000001_auto_post_tracks_timezone.sql):
 * `posting_times` / `weekly_day` used to be UTC; they are now LOCAL
 * wall-clock values interpreted in `timezone` (an IANA identifier, e.g.
 * "America/New_York"). See that migration's header and
 * docs/autopost-scheduling.md ("Cadence & timezone semantics") for the full
 * story of why (DST drift + weekly_day flip at the boundary). */
export interface AutoPostScheduleConfig {
    cadence: AutoPostTrackCadence;
    posting_times: unknown;
    weekly_day: number | null | undefined;
    timezone: string;
}

function parseHHMM(value: string): ParsedTime | null {
    const match = AUTO_POST_TIME_REGEX.exec(value);
    if (!match) return null;
    const [h, m] = value.split(":").map(Number);
    return { h, m };
}

/** Parses + sorts (ascending, by minute-of-day) whatever posting_times holds.
 * Never throws — unparseable entries are dropped; an all-invalid/empty array
 * yields [], which the caller treats as an invalid config. */
function parseAndSortTimes(raw: unknown): ParsedTime[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((v) => (typeof v === "string" ? parseHHMM(v) : null))
        .filter((v): v is ParsedTime => v !== null)
        .sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
}

// ── Timezone-aware wall-clock math (pure) ───────────────────────────────────
//
// computeNextSlotAt used to do pure UTC arithmetic (setUTCHours / getUTCDay).
// That's exactly the bug: a UTC instant's wall-clock reading in ANY OTHER
// zone shifts by an hour across that zone's DST transitions, and (for
// weekly_day) can even land on a different calendar day. The functions below
// instead work entirely in terms of the TARGET ZONE's wall clock — "what
// UTC instant is 09:00 in America/New_York on 2026-03-09" — via
// Intl.DateTimeFormat, which already knows every zone's DST rules. No
// UTC-only helpers remain; UTC itself is just one more zone Intl handles
// (offset 0, no DST), which is what makes the "UTC" test case below behave
// identically to the old pure-UTC math for the zero-offset default.

interface ZonedParts {
    year: number;
    month: number; // 1-indexed (matches "2-digit" month formatting) — NOT Date.UTC's 0-indexed convention
    day: number;
    hour: number;
    minute: number;
    second: number;
}

/**
 * The wall-clock components of `instant` AS OBSERVED in `timeZone`.
 *
 * `hourCycle: "h23"` is deliberate, not `hour12: false` — some ICU builds
 * render midnight as hour "24" under `hour12: false` (a documented ICU
 * quirk), which would silently corrupt the hour this function returns.
 * `hourCycle: "h23"` guarantees an hour in [0, 23].
 */
function getZonedParts(instant: Date, timeZone: string): ZonedParts {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    });
    const parts = formatter.formatToParts(instant);
    const get = (type: string): number => {
        const part = parts.find((p) => p.type === type);
        return part ? parseInt(part.value, 10) : 0;
    };
    return {
        year: get("year"),
        month: get("month"),
        day: get("day"),
        hour: get("hour"),
        minute: get("minute"),
        second: get("second"),
    };
}

/**
 * The UTC instant corresponding to the LOCAL wall-clock time
 * (y, mo, d, h, mi) in `timeZone`. `mo` is 0-indexed, matching Date.UTC's
 * convention (so callers can pass a JS Date's `.getMonth()`-style value
 * directly).
 *
 * ALGORITHM (fixed-point offset correction — the standard technique for this
 * without a full tz-database library):
 *   1. `guess` = Date.UTC(y, mo, d, h, mi) — treat the local components AS IF
 *      they were already UTC. This is wrong by exactly the zone's offset,
 *      but it's a concrete instant we can ask Intl about.
 *   2. Find the zone's offset AT that guess by round-tripping it through
 *      getZonedParts: format `guess` in `timeZone`, re-interpret THOSE
 *      components as UTC, and subtract — the difference is the offset in
 *      effect at (approximately) the requested time.
 *   3. `candidate = guess - offset` — the corrected instant.
 *   4. Re-check the offset AT `candidate` (it can differ from step 2's offset
 *      right at a DST transition boundary, where `guess` and `candidate`
 *      fall on opposite sides of the transition). If it changed, recompute
 *      `candidate` once more with the new offset. One extra iteration is
 *      sufficient — the offset only changes once between the two candidates
 *      considered here, never more (DST transitions are hours apart, this
 *      correction is at most one offset-width).
 *
 * This converges correctly for ordinary (unambiguous, existing) wall-clock
 * times in any zone, including fractional-offset zones (Asia/Kolkata
 * +05:30, Pacific/Chatham +12:45/+13:45).
 *
 * DST EDGE CASES (handled below, after the fixed-point correction above):
 *   - SPRING-FORWARD GAP: a wall-clock time that doesn't exist on the
 *     transition day (e.g. 02:30 on America/New_York's March transition,
 *     where clocks jump 02:00 -> 03:00). Detected by round-tripping the
 *     final `candidate` back through getZonedParts and checking it actually
 *     reads back as the requested (y, mo, d, h, mi) — a gap is exactly the
 *     case where no instant reads back that way. On a gap, this falls
 *     FORWARD by the shortfall between the requested and observed wall-clock
 *     reading, landing on a real, later, valid instant. Not hardcoded to any
 *     particular gap width (e.g. NOT always "+1h") — Pacific/Chatham's DST
 *     transitions are the standard 1h, but this generalizes to any width.
 *   - FALL-BACK AMBIGUITY: a wall-clock time that happens TWICE (e.g. 01:30
 *     on America/New_York's November transition, EDT 01:30 then EST 01:30
 *     an hour later). The fixed-point algorithm above is deterministic
 *     (same input always produces the same output) and, by construction,
 *     resolves to the offset that was in effect at `guess`'s literal instant
 *     — which for the ambiguous window is consistently the FIRST (earlier)
 *     occurrence's offset, since `guess` (the local components read as UTC)
 *     falls chronologically before the later occurrence's UTC instant for
 *     every zone/sign combination exercised by this codebase's test suite
 *     (scripts/test-autopost-timezone.ts asserts this directly for
 *     America/New_York's fall-back). No extra branching needed for this
 *     case — determinism plus "prefers earlier" falls out of the algorithm.
 */
function zonedWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
    const guessMs = Date.UTC(y, mo, d, h, mi, 0, 0);

    const offsetAtMs = (instantMs: number): number => {
        const parts = getZonedParts(new Date(instantMs), timeZone);
        const zonedAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
        return zonedAsUtcMs - instantMs;
    };

    const offset1 = offsetAtMs(guessMs);
    let candidateMs = guessMs - offset1;
    const offset2 = offsetAtMs(candidateMs);
    if (offset2 !== offset1) {
        candidateMs = guessMs - offset2;
    }

    // Spring-forward gap check — verify the round trip. If replaying
    // `candidateMs` through the zone doesn't read back as the wall-clock
    // time that was actually requested, that wall-clock time doesn't exist
    // on this calendar day in this zone (a DST gap). Detected via round
    // trip rather than by comparing offset1/offset2 directly: a mismatched
    // pair alone doesn't necessarily mean a gap (see the fall-back case in
    // this function's doc comment, where the two offsets considered can
    // also legitimately differ without any gap being involved).
    const requestedWallMs = guessMs; // same construction as guessMs, named for clarity below
    const observed = getZonedParts(new Date(candidateMs), timeZone);
    const observedWallMs = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, 0, 0);
    if (observedWallMs !== requestedWallMs) {
        const shortfallMs = requestedWallMs - observedWallMs;
        if (shortfallMs > 0) {
            // The candidate landed BEFORE the requested wall-clock reading
            // (the signature of a gap, not an ordinary rounding artifact) —
            // fall forward by exactly the shortfall so the result is a real,
            // valid instant at/after what was asked for.
            candidateMs += shortfallMs;
        }
        // A negative shortfall isn't expected from this algorithm (it would
        // mean the candidate overshot the request), but if it ever occurred
        // the safest thing is to leave candidateMs alone rather than move it
        // further from what was asked for.
    }

    return new Date(candidateMs);
}

/** The local calendar date (in `timeZone`) that `instant` falls on. */
function localDateForInstant(instant: Date, timeZone: string): { year: number; month: number; day: number } {
    const parts = getZonedParts(instant, timeZone);
    return { year: parts.year, month: parts.month, day: parts.day };
}

/** Adds `deltaDays` calendar days to a (year, 1-indexed month, day) triple,
 * correctly rolling over month/year boundaries. Routed through Date.UTC
 * (not local Date methods) so this function's own arithmetic never depends
 * on the HOST's timezone — only `getZonedParts`/`zonedWallClockToUtc` above
 * ever consult the TRACK's timezone; this is pure calendar math. */
function addLocalDays(date: { year: number; month: number; day: number }, deltaDays: number): { year: number; month: number; day: number } {
    const base = Date.UTC(date.year, date.month - 1, date.day);
    const shifted = new Date(base + deltaDays * 24 * 60 * 60 * 1000);
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** The weekday (0=Sun..6=Sat) of a (year, 1-indexed month, day) triple,
 * matching weekly_day's convention. Derived from the LOCAL y/m/d directly
 * (via Date.UTC, again purely as a calendar-math trick — no timezone
 * involved), NOT from any instant's `.getUTCDay()` — those can legitimately
 * disagree near local midnight, which is exactly the bug this whole
 * migration fixes for weekly tracks. */
function localWeekdayOf(date: { year: number; month: number; day: number }): number {
    return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Daily cadence needs to look at most 2 local calendar days ahead (today's
 * remaining times, else tomorrow's earliest) — 3 leaves a full extra day of
 * safety margin for the loop bound without meaningfully changing behavior. */
const DAILY_SEARCH_DAY_LIMIT = 3;

/** Weekly cadence needs a full 7-day cycle to guarantee landing on
 * `weekly_day` at least once; 9 leaves 2 extra days of margin (covering the
 * same "today vs. already advanced past" slack daily's limit covers, plus
 * headroom for a DST-shifted wall-clock read right at the search window's
 * edge) without letting a pathological config spin unreasonably long. */
const WEEKLY_SEARCH_DAY_LIMIT = 9;

/**
 * Walks local calendar days forward (bounded by `dayLimit`) from `after`'s
 * own local calendar date in `timeZone`, and within each qualifying day
 * tries every posting time in ascending order, returning the first resulting
 * UTC instant STRICTLY after `after`. This — iterating local calendar days,
 * not doing UTC offset arithmetic — is what stays correct across both a DST
 * transition (each day's times are independently converted via
 * zonedWallClockToUtc, which already handles the transition) and a weekly
 * weekday boundary (weekday is derived from the LOCAL date, not from any
 * UTC-instant reading).
 *
 * `requiredWeekday` (0=Sun..6=Sat) restricts candidate days to weekly_day
 * for the weekly-cadence caller; `null` for daily (every day qualifies).
 */
function findNextOccurrence(
    times: ParsedTime[],
    after: Date,
    timeZone: string,
    dayLimit: number,
    requiredWeekday: number | null,
): Date | null {
    const afterMs = after.getTime();
    const startDate = localDateForInstant(after, timeZone);

    for (let dayOffset = 0; dayOffset <= dayLimit; dayOffset++) {
        const candidateDate = dayOffset === 0 ? startDate : addLocalDays(startDate, dayOffset);
        if (requiredWeekday !== null && localWeekdayOf(candidateDate) !== requiredWeekday) continue;

        for (const t of times) {
            const instant = zonedWallClockToUtc(candidateDate.year, candidateDate.month - 1, candidateDate.day, t.h, t.m, timeZone);
            if (instant.getTime() > afterMs) return instant;
        }
    }

    // Exhausted the search window without finding a qualifying instant.
    // Unreachable in practice given the bounds above (daily always finds a
    // slot within 2 days; weekly within 7) for a config that passed the
    // caller's validity checks — but never throw or spin: treat it the same
    // as any other invalid/unrepresentable config.
    return null;
}

/**
 * Pure. Timezone-aware. Returns the earliest posting-time occurrence
 * STRICTLY after `after` — daily: today or tomorrow, LOCAL to
 * `track.timezone`; weekly: this week's occurrence of `weekly_day` or next
 * week's, weekday and time both LOCAL to `track.timezone`. Returns null on
 * an invalid config: no parseable posting_times, a weekly track with
 * no/out-of-range weekly_day, OR an unrecognized/invalid `timezone` — the
 * caller treats a null next_slot_at as "this track is effectively idle" and
 * never materializes a slot for it. A track must never crash the sweep, so
 * an invalid timezone is deliberately just another "invalid config" case,
 * not a thrown error.
 */
export function computeNextSlotAt(track: AutoPostScheduleConfig, after: Date): Date | null {
    const times = parseAndSortTimes(track.posting_times);
    if (times.length === 0) return null;

    if (!isValidIanaTimeZone(track.timezone)) return null;

    if (track.cadence === "daily") {
        return findNextOccurrence(times, after, track.timezone, DAILY_SEARCH_DAY_LIMIT, null);
    }

    if (track.cadence === "weekly") {
        if (
            track.weekly_day === null ||
            track.weekly_day === undefined ||
            !Number.isInteger(track.weekly_day) ||
            track.weekly_day < 0 ||
            track.weekly_day > 6
        ) {
            return null;
        }
        return findNextOccurrence(times, after, track.timezone, WEEKLY_SEARCH_DAY_LIMIT, track.weekly_day);
    }

    return null;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

type AdminSupabase = ReturnType<typeof createAdminSupabase>;

async function failItem(sb: AdminSupabase, itemId: string, message: string): Promise<void> {
    const { error } = await sb
        .from("auto_post_items")
        .update({ status: "failed", error_message: message, updated_at: new Date().toISOString() })
        .eq("id", itemId);
    if (error) {
        console.error(`[autopost] failItem(${itemId}) update failed:`, error.message);
    }
}

/** Bounds bumpTrackFailure's CAS retry loop below. */
const MAX_BUMP_FAILURE_ATTEMPTS = 3;

/**
 * TASK 4 — atomic increment via compare-and-set, not read-modify-write.
 *
 * The original implementation read `track.consecutive_failures` off the
 * in-memory `track` row this caller already had (materialized at claim time,
 * possibly stale by the time generation actually fails minutes later) and
 * wrote back `that value + 1`. Two concurrent generation failures for the
 * SAME track (plausible: the fast/generation lane split in runAutoPostSweep
 * means a track's queued items are no longer strictly serialized against
 * each other the way a single sequential sweep loop used to make them feel)
 * can both read `consecutive_failures = N` and both write `N + 1` — one
 * increment is silently lost. Over enough races the track never actually
 * reaches MAX_CONSECUTIVE_FAILURES and never auto-pauses, even though it
 * really did fail that many times.
 *
 * There is no Postgres RPC helper (e.g. an `increment()` function) in this
 * repo today, so this re-reads the CURRENT `consecutive_failures` from the
 * DB immediately before writing, and guards the write with
 * `.eq("consecutive_failures", currentValue)` — a plain optimistic CAS. Zero
 * rows updated means a concurrent writer already bumped the count since the
 * read; re-read the new current value and retry, bounded to
 * MAX_BUMP_FAILURE_ATTEMPTS total attempts so a pathological hot race can't
 * spin forever, then give up (logged) rather than lose the caller's own
 * increment entirely.
 */
async function bumpTrackFailure(sb: AdminSupabase, track: AutoPostTrack, lastError: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_BUMP_FAILURE_ATTEMPTS; attempt++) {
        const { data: current, error: readError } = await sb
            .from("auto_post_tracks")
            .select("consecutive_failures")
            .eq("id", track.id)
            .maybeSingle();
        if (readError) {
            console.error(`[autopost] bumpTrackFailure(${track.id}) re-read failed:`, readError.message);
            return;
        }
        if (!current) {
            // Track was deleted concurrently — nothing left to bump.
            return;
        }

        const currentCount = current.consecutive_failures ?? 0;
        const nextCount = currentCount + 1;
        const update: Record<string, unknown> = {
            consecutive_failures: nextCount,
            updated_at: new Date().toISOString(),
        };
        if (nextCount >= MAX_CONSECUTIVE_FAILURES) {
            update.is_active = false;
            update.paused_reason =
                `Auto-paused after ${MAX_CONSECUTIVE_FAILURES} consecutive generation failures: ${lastError}`.slice(0, 2000);
        }

        const { data: updated, error: updateError } = await sb
            .from("auto_post_tracks")
            .update(update)
            .eq("id", track.id)
            .eq("consecutive_failures", currentCount)
            .select("id")
            .maybeSingle();
        if (updateError) {
            console.error(`[autopost] bumpTrackFailure(${track.id}) update failed:`, updateError.message);
            return;
        }
        if (updated) return; // CAS won — increment persisted.

        console.log(`[autopost] bumpTrackFailure(${track.id}) lost a CAS race on attempt ${attempt}/${MAX_BUMP_FAILURE_ATTEMPTS} — re-reading and retrying`);
    }
    console.error(
        `[autopost] bumpTrackFailure(${track.id}) gave up after ${MAX_BUMP_FAILURE_ATTEMPTS} CAS attempts — consecutive_failures may be understated by one`,
    );
}

// ── Phase 1: materialize due slots ──────────────────────────────────────────

/**
 * m5 — compare-and-set a track's `next_slot_at`, guarded on `expectedIso`
 * (the value this materialize-loop iteration read BEFORE any fast-forwarding
 * or advancing). 0 rows updated means a concurrent writer (typically a
 * PATCH from the owner) already changed `next_slot_at` since we read it —
 * that writer's value is authoritative, so skip silently rather than
 * overwriting it.
 */
async function advanceTrackNextSlot(
    sb: AdminSupabase,
    track: AutoPostTrack,
    expectedIso: string,
    patch: { next_slot_at: string | null; last_generated_at?: string; updated_at: string },
): Promise<void> {
    const { data, error } = await sb
        .from("auto_post_tracks")
        .update(patch)
        .eq("id", track.id)
        .eq("user_id", track.user_id)
        .eq("next_slot_at", expectedIso)
        .select("id")
        .maybeSingle();
    if (error) throw new Error(`advance next_slot_at [track=${track.id}]: ${error.message}`);
    if (!data) {
        console.log(`[autopost] materializeDueSlots: next_slot_at advance for track=${track.id} lost a race to a concurrent write — skipped`);
    }
}

/**
 * Fetches active tracks with next_slot_at within the widest possible lead
 * (12h — the manual-mode lead; auto-mode's effective lead is narrower and is
 * re-checked in JS below), inserts a 'queued' auto_post_items row for every
 * track whose PER-TRACK lead has actually elapsed, and advances next_slot_at
 * BEFORE generation ever runs — so a crash between insert and generation
 * never re-materializes the same slot (the unique (track_id, scheduled_for)
 * constraint would just skip the duplicate anyway, but the advance still has
 * to happen exactly once per due slot).
 *
 * M3 — before any of that, a track whose `next_slot_at` is older than
 * MATERIALIZE_GRACE_MS (e.g. the app was down for days) is fast-forwarded
 * through its missed slots via computeNextSlotAt WITHOUT materializing an
 * item for each one — only the slot landing inside the grace window (or the
 * next future one) gets an item. See docs/autopost-scheduling.md "Sweep
 * design" for the grace-window contract.
 *
 * m5 — every write to a track's `next_slot_at` in this function is a
 * compare-and-set guarded on the exact `next_slot_at` value this loop
 * iteration read at the top (`advanceTrackNextSlot` above), so a concurrent
 * PATCH (the owner editing posting_times while the sweep is mid-materialize)
 * always wins — the sweep's write silently no-ops instead of clobbering it.
 */
async function materializeDueSlots(sb: AdminSupabase, now: Date): Promise<{ materialized: number }> {
    const horizonIso = new Date(now.getTime() + GENERATION_LEAD_MS.manual).toISOString();

    // Fetch one extra row past the batch limit purely to detect (and log) an
    // under-provisioned sweep — never processed.
    const { data: dueTracks, error } = await sb
        .from("auto_post_tracks")
        .select("*")
        .eq("is_active", true)
        .not("next_slot_at", "is", null)
        .lte("next_slot_at", horizonIso)
        .order("next_slot_at", { ascending: true })
        .limit(TRACK_BATCH_LIMIT + 1);
    if (error) throw new Error(`materializeDueSlots [load tracks]: ${error.message}`);

    const candidates = (dueTracks ?? []) as AutoPostTrack[];
    if (candidates.length > TRACK_BATCH_LIMIT) {
        console.warn(
            `[autopost] materializeDueSlots: ${candidates.length} track(s) due within the lead horizon, processing only ${TRACK_BATCH_LIMIT} this tick`,
        );
    }
    const tracks = candidates.slice(0, TRACK_BATCH_LIMIT);

    let materialized = 0;
    for (const track of tracks) {
        try {
            const originalNextSlotAtIso = track.next_slot_at; // read once — the m5 CAS guard value
            if (!originalNextSlotAtIso) continue;

            const leadMs = GENERATION_LEAD_MS[track.approval_mode];
            let slot: Date | null = new Date(originalNextSlotAtIso);
            if (Number.isNaN(slot.getTime())) continue;

            // M3 — fast-forward through any slots older than the grace window
            // WITHOUT materializing an item for each one (no catch-up flood).
            const graceThresholdMs = now.getTime() - MATERIALIZE_GRACE_MS;
            let fastForwardIterations = 0;
            while (slot && slot.getTime() <= graceThresholdMs) {
                slot = computeNextSlotAt(track, slot);
                fastForwardIterations += 1;
                if (fastForwardIterations > MAX_MATERIALIZE_FASTFORWARD_ITERATIONS) {
                    captureException(
                        new Error(
                            `materializeDueSlots: track=${track.id} exceeded ${MAX_MATERIALIZE_FASTFORWARD_ITERATIONS} fast-forward iterations catching up from downtime`,
                        ),
                        { job: "autopost_sweep", phase: "materialize", trackId: track.id },
                    );
                    break;
                }
            }

            if (!slot) {
                // Fast-forward ran into an invalid config (computeNextSlotAt
                // returned null) — persist null so the track goes idle instead
                // of re-walking the same slots every tick.
                await advanceTrackNextSlot(sb, track, originalNextSlotAtIso, {
                    next_slot_at: null,
                    updated_at: now.toISOString(),
                });
                continue;
            }

            if (slot.getTime() <= graceThresholdMs) {
                // The iteration bail-out above exited the loop with a slot
                // that is STILL stale. Persist the progress made and let the
                // next tick keep fast-forwarding — never materialize a
                // stale slot (that would be exactly the M3 catch-up flood,
                // rate-limited to one old post per tick).
                await advanceTrackNextSlot(sb, track, originalNextSlotAtIso, {
                    next_slot_at: slot.toISOString(),
                    updated_at: now.toISOString(),
                });
                continue;
            }

            const due = slot.getTime() - leadMs <= now.getTime();
            if (!due) {
                // Not due yet under THIS track's lead. Persist the
                // fast-forwarded slot (if fast-forwarding moved it at all) so
                // future ticks don't re-walk the same stale slots, but don't
                // advance past it — it still needs its own item materialized
                // once it becomes due.
                if (slot.getTime() !== new Date(originalNextSlotAtIso).getTime()) {
                    await advanceTrackNextSlot(sb, track, originalNextSlotAtIso, {
                        next_slot_at: slot.toISOString(),
                        updated_at: now.toISOString(),
                    });
                }
                continue;
            }

            const { error: insertError } = await sb.from("auto_post_items").insert({
                track_id: track.id,
                user_id: track.user_id,
                status: "queued",
                scheduled_for: slot.toISOString(),
            });

            if (insertError) {
                if (insertError.code !== "23505") {
                    throw new Error(`insert item [track=${track.id}]: ${insertError.message}`);
                }
                // Unique violation — another process already materialized this
                // exact slot. Skip silently (still advance next_slot_at below).
            } else {
                materialized += 1;
            }

            const advanced = computeNextSlotAt(track, slot);
            await advanceTrackNextSlot(sb, track, originalNextSlotAtIso, {
                next_slot_at: advanced ? advanced.toISOString() : null,
                last_generated_at: now.toISOString(),
                updated_at: now.toISOString(),
            });
        } catch (err) {
            console.error(`[autopost] materializeDueSlots failed for track=${track.id}:`, err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "materialize", trackId: track.id });
        }
    }

    return { materialized };
}

// ── Generate queued items (m7: invoked AFTER publish in runAutoPostSweep —
// see that function's comment for why) ──────────────────────────────────────

/**
 * Claims and generates 'queued' items sequentially — one AI-generation call
 * chain at a time, deliberately not parallelized (these are minutes-long
 * calls; see docs/autopost-scheduling.md). Each claim is an optimistic guard
 * (`update ... where status='queued'`); losing the race just skips the item
 * for this tick (another process's sweep already has it).
 *
 * Two guards run right after loading the track and before touching the paid
 * generation pipeline: M4 (skip a paused track's item instead of generating
 * for it) and C1 (skip regeneration entirely when the item already has a
 * post_id from an earlier attempt). See their inline comments below.
 */
async function generateQueuedItems(sb: AdminSupabase, now: Date): Promise<{ generated: number; failed: number }> {
    const { data: queuedItems, error } = await sb
        .from("auto_post_items")
        .select("id")
        .eq("status", "queued")
        .order("scheduled_for", { ascending: true })
        .limit(TRACK_BATCH_LIMIT);
    if (error) throw new Error(`generateQueuedItems [load items]: ${error.message}`);

    let generated = 0;
    let failed = 0;

    for (const row of queuedItems ?? []) {
        try {
            const { data: claimed, error: claimError } = await sb
                .from("auto_post_items")
                .update({ status: "generating", updated_at: new Date().toISOString() })
                .eq("id", row.id)
                .eq("status", "queued")
                .select("*")
                .maybeSingle();
            if (claimError) throw new Error(`claim item=${row.id}: ${claimError.message}`);
            if (!claimed) continue; // lost the claim race — another process picked it up

            const item = claimed as AutoPostItem;

            const { data: track, error: trackError } = await sb
                .from("auto_post_tracks")
                .select("*")
                .eq("id", item.track_id)
                .maybeSingle();
            if (trackError) throw new Error(`load track=${item.track_id}: ${trackError.message}`);
            if (!track) {
                await failItem(sb, item.id, "Track no longer exists");
                failed += 1;
                continue;
            }

            // M4 — the track can have been deactivated (manually, or
            // auto-paused by bumpTrackFailure) between materialize and this
            // generate phase; an already-queued item must not still burn a
            // paid generation for a paused track. Deliberately doesn't call
            // bumpTrackFailure — the track is already inactive, so bumping
            // consecutive_failures further is a no-op at best.
            if (!track.is_active) {
                await failItem(sb, item.id, "Track is paused — reactivate it to generate this slot");
                failed += 1;
                continue;
            }

            // C1 — this item already produced a post in an earlier attempt
            // (most commonly: retry after a publish failure re-queues it —
            // see the retry route below — or a lost claim race that still
            // persisted post_id post-hoc, see the M2 note further down).
            // Re-running the full paid generation pipeline here would burn a
            // second paid generation AND collide with the posts insert's
            // idempotency_key ("autopost:<item.id>", stable per item) on a
            // 23505 unique violation, permanently dead-ending the item. Skip
            // straight to the post-generation state instead.
            if (item.post_id) {
                const skipStatus: AutoPostItemStatus = track.approval_mode === "auto" ? "approved" : "awaiting_approval";
                const { data: skipped, error: skipError } = await sb
                    .from("auto_post_items")
                    .update({ status: skipStatus, error_message: null, updated_at: new Date().toISOString() })
                    .eq("id", item.id)
                    .eq("status", "generating")
                    .select("id")
                    .maybeSingle();
                if (skipError) throw new Error(`skip-regenerate item=${item.id}: ${skipError.message}`);
                if (skipped) {
                    if ((track.consecutive_failures ?? 0) > 0) {
                        await sb
                            .from("auto_post_tracks")
                            .update({ consecutive_failures: 0, updated_at: new Date().toISOString() })
                            .eq("id", track.id);
                    }
                    generated += 1;
                }
                continue;
            }

            const [{ data: profile }, { data: brand }] = await Promise.all([
                sb.from("profiles").select("*").eq("id", item.user_id).maybeSingle(),
                sb.from("brands").select("*").eq("user_id", item.user_id).maybeSingle(),
            ]);

            if (!profile || !brand) {
                const message = "Missing profile or brand configuration — complete onboarding to resume Autopilot";
                await failItem(sb, item.id, message);
                await bumpTrackFailure(sb, track as AutoPostTrack, message);
                failed += 1;
                continue;
            }

            try {
                const { postId } = await generateAutoPost({
                    item,
                    track: track as AutoPostTrack,
                    brand,
                    profile,
                });

                const nextStatus: AutoPostItemStatus = track.approval_mode === "auto" ? "approved" : "awaiting_approval";
                const { data: successUpdated, error: successError } = await sb
                    .from("auto_post_items")
                    .update({
                        status: nextStatus,
                        post_id: postId,
                        error_message: null,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", item.id)
                    .eq("status", "generating")
                    .select("id")
                    .maybeSingle();
                if (successError) throw new Error(`persist success item=${item.id}: ${successError.message}`);

                if (!successUpdated) {
                    // M2 — lost the 'generating' claim AFTER a successful (and
                    // already paid-for) generation — e.g. a concurrent
                    // process's janitor beat us to 'failed' on this exact
                    // item. Without checking this, the guarded update above
                    // silently no-ops: the user was charged, a post was
                    // generated, and nothing on the item row records that —
                    // an unrecoverable orphan. Persist post_id unconditionally
                    // (no status guard) so the C1 skip-regeneration path above
                    // can find it the next time this item is retried.
                    captureException(
                        new Error(`generateQueuedItems: lost the 'generating' claim persisting success for item=${item.id}`),
                        { job: "autopost_sweep", phase: "generate", itemId: item.id, postId },
                    );
                    const { error: orphanError } = await sb
                        .from("auto_post_items")
                        .update({ post_id: postId, updated_at: new Date().toISOString() })
                        .eq("id", item.id);
                    if (orphanError) {
                        console.error(`[autopost] persisting orphaned post_id for item=${item.id} failed:`, orphanError.message);
                    }
                } else {
                    if ((track.consecutive_failures ?? 0) > 0) {
                        await sb
                            .from("auto_post_tracks")
                            .update({ consecutive_failures: 0, updated_at: new Date().toISOString() })
                            .eq("id", track.id);
                    }
                    generated += 1;
                }
            } catch (genErr) {
                const message = genErr instanceof Error ? genErr.message : "Generation failed";
                await failItem(sb, item.id, message);
                await bumpTrackFailure(sb, track as AutoPostTrack, message);
                failed += 1;
            }
        } catch (err) {
            console.error(`[autopost] generateQueuedItems failed for item=${row.id}:`, err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "generate", itemId: row.id });
        }
    }

    return { generated, failed };
}

// ── Publish (m7: invoked BEFORE generate in runAutoPostSweep) ───────────────

/** Dedupes non-empty, non-null strings while preserving first-seen order —
 * used below to fold N per-platform PostPublication.error_message values
 * down to their distinct causes before joining them into one item-level
 * message. */
function dedupeMessages(messages: (string | null | undefined)[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of messages) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        out.push(m);
    }
    return out;
}

/** Caps a composed message the same way bumpTrackFailure caps
 * paused_reason — a long error_message column value is unhelpful and this
 * keeps the two conventions consistent. */
const ERROR_MESSAGE_MAX_LENGTH = 2000;

/**
 * TASK 1 — pure decision function: given the PostPublication[] rows
 * publishPost() returns, decide what auto_post_items.status/error_message
 * this publish attempt resolves to.
 *
 * WHY THIS EXISTS: `publishPost()` does NOT throw when Zernio accepts a post
 * but a per-platform publish attempt itself fails (rate limit, revoked
 * token, platform-side rejection, etc.) — it only throws on request-level
 * failures (bad payload, no accounts, Zernio unreachable). A per-platform
 * failure comes back as an ordinary `PostPublication` row with
 * `status: 'failed'`. Before this fix, `publishAutoPostItem` discarded
 * `publishPost`'s return value entirely and unconditionally marked the item
 * `published` right after the call — so in `auto` approval mode, Autopilot's
 * history showed "published" for slots where EVERY platform actually failed,
 * and nobody was watching to notice (there is no interactive user for an
 * auto-mode publish). Inspecting the returned rows is the only way to know
 * whether anything actually went out.
 *
 * Pure and exported so it's independently testable (see
 * scripts/test-autopost-publish-outcome.ts) without a network or DB —
 * `publishAutoPostItem` below is the only caller in production code.
 */
export function resolvePublishOutcome(
    publications: PostPublication[],
): { status: "published" | "failed"; error_message: string | null } {
    if (publications.length === 0) {
        // publishPost() resolved without throwing but produced no rows at
        // all — e.g. every target account got filtered out somewhere
        // upstream. No evidence anything published; treat as failure rather
        // than silently reporting success with nothing to show for it.
        return { status: "failed", error_message: "Publish produced no publication records" };
    }

    const failedRows = publications.filter((p) => p.status === "failed");

    if (failedRows.length === publications.length) {
        // Every platform failed — nothing published. Fail the item so it's
        // retryable and the owner sees an actionable reason, instead of a
        // false "published".
        const causes = dedupeMessages(failedRows.map((r) => r.error_message));
        const joined = causes.length > 0 ? causes.join("; ") : "Publish failed on all target platforms";
        return { status: "failed", error_message: joined.slice(0, ERROR_MESSAGE_MAX_LENGTH) };
    }

    if (failedRows.length > 0) {
        // Partial failure — SOME platforms published, so the slot is not a
        // clean failure (content did go live somewhere, retrying would
        // re-publish to the already-successful platforms too). Still mark
        // `published`, but keep the failure visible via error_message
        // instead of nulling it out, naming which platforms need attention.
        const platforms = dedupeMessages(failedRows.map((r) => r.platform));
        const summary = `Publish failed on: ${platforms.join(", ")}`;
        return { status: "published", error_message: summary.slice(0, ERROR_MESSAGE_MAX_LENGTH) };
    }

    // No failures at all (rows are published/pending/scheduled) — clean
    // success, matches the pre-fix behavior for the common case.
    return { status: "published", error_message: null };
}

/**
 * Claims an 'approved' item and publishes it via the existing Zernio publish
 * path, re-reading track/account state fresh (never trusting stale data from
 * the caller). Exported so the manual approve route can publish inline when
 * the approved item's slot has already arrived. Idempotent under races: the
 * claim (`update ... where status='approved'`) means a second concurrent call
 * (sweep + manual approve landing at the same moment) just no-ops on the
 * loser side and reports whatever status the row already settled on.
 *
 * M1 — everything from the claim onward runs inside one try/catch.
 * `resolveZernioCredentials` (below) can THROW — DB errors, or a Zernio
 * profile-provision failure — it only RETURNS null for the "not configured"
 * case. Before this fix that throw propagated straight out of this function
 * with the item already claimed into 'publishing' and nothing left to catch
 * it (the janitor only covered 'generating', and retry only accepts
 * 'failed') — a permanently stuck item. Now any unexpected throw here falls
 * into the catch-all below, which fails the item via mapZernioError (its
 * generic-Error fallback branch handles a non-Zernio error just fine) so the
 * item is always retryable afterward.
 */
export async function publishAutoPostItem(
    itemId: string,
): Promise<{ status: AutoPostItemStatus; error_message?: string }> {
    const sb = createAdminSupabase();

    const { data: claimed, error: claimError } = await sb
        .from("auto_post_items")
        .update({ status: "publishing", updated_at: new Date().toISOString() })
        .eq("id", itemId)
        .eq("status", "approved")
        .select("*")
        .maybeSingle();
    if (claimError) throw new Error(`publishAutoPostItem(${itemId}) [claim]: ${claimError.message}`);

    if (!claimed) {
        const { data: current } = await sb
            .from("auto_post_items")
            .select("status, error_message")
            .eq("id", itemId)
            .maybeSingle();
        return {
            status: (current?.status as AutoPostItemStatus | undefined) ?? "failed",
            error_message: current?.error_message ?? undefined,
        };
    }

    const item = claimed as AutoPostItem;

    try {
        // Re-read track fresh — never trust anything about targets/ownership
        // from before the claim.
        const { data: track, error: trackError } = await sb
            .from("auto_post_tracks")
            .select("*")
            .eq("id", item.track_id)
            .eq("user_id", item.user_id)
            .maybeSingle();
        if (trackError) throw new Error(`publishAutoPostItem(${itemId}) [load track]: ${trackError.message}`);
        if (!track) {
            const message = "Track no longer exists";
            await failItem(sb, item.id, message);
            return { status: "failed", error_message: message };
        }
        const trackRow = track as AutoPostTrack;

        // M4 — mirrors the same check in generateQueuedItems: a track
        // deactivated after this item was already approved must not publish.
        if (!trackRow.is_active) {
            const message = "Track is paused — reactivate it to publish this post";
            await failItem(sb, item.id, message);
            return { status: "failed", error_message: message };
        }

        if (!item.post_id) {
            const message = "No generated post attached to this item";
            await failItem(sb, item.id, message);
            return { status: "failed", error_message: message };
        }

        const accountIds = Array.isArray(trackRow.account_ids) ? (trackRow.account_ids as unknown as string[]) : [];
        if (accountIds.length === 0) {
            const message = "No target social accounts configured for this track — add one in Autopilot before it can publish";
            await failItem(sb, item.id, message);
            return { status: "failed", error_message: message };
        }

        const credentials = await resolveZernioCredentials(item.user_id);
        if (!credentials) {
            const message = "Social publishing isn't configured — connect a Zernio account in Settings → Social";
            await failItem(sb, item.id, message);
            return { status: "failed", error_message: message };
        }

        const publications = await publishPost(item.user_id, { post_id: item.post_id, account_ids: accountIds }, credentials);

        // TASK 1 — inspect what actually happened per-platform BEFORE writing
        // the item's final status. See resolvePublishOutcome's doc comment
        // for why: publishPost() only throws on request-level failures, not
        // per-platform ones, so a discarded return value here is exactly how
        // "published" used to get reported when every platform had failed.
        const outcome = resolvePublishOutcome(publications);
        const nowIso = new Date().toISOString();

        if (outcome.status === "failed") {
            await failItem(sb, item.id, outcome.error_message ?? "Publish failed on all target platforms");
            return { status: "failed", error_message: outcome.error_message ?? undefined };
        }

        const { data: publishedRow, error: publishedError } = await sb
            .from("auto_post_items")
            .update({ status: "published", published_at: nowIso, error_message: outcome.error_message, updated_at: nowIso })
            .eq("id", item.id)
            .eq("status", "publishing")
            .select("id")
            .maybeSingle();
        if (publishedError) throw new Error(`persist published: ${publishedError.message}`);
        if (!publishedRow) {
            // Lost the claim while the Zernio call was in flight (e.g. the
            // janitor swept a >30-min 'publishing' row to 'failed'). The
            // publish itself DID happen — surface the divergence instead of
            // silently reporting success against a row that now says failed.
            // A subsequent Retry would re-publish; Zernio's 24h dedup 409
            // is the backstop for that.
            captureException(
                new Error(`publishAutoPostItem: item=${item.id} published on Zernio but lost the 'publishing' claim before persisting`),
                { job: "autopost_sweep", phase: "publish", itemId: item.id },
            );
        }
        return { status: "published", error_message: outcome.error_message ?? undefined };
    } catch (err) {
        const mapped = mapZernioError(err);
        await failItem(sb, item.id, mapped.message);
        return { status: "failed", error_message: mapped.message };
    }
}

async function publishDueItems(sb: AdminSupabase, now: Date): Promise<{ published: number; failed: number }> {
    const { data: dueItems, error } = await sb
        .from("auto_post_items")
        .select("id")
        .eq("status", "approved")
        .lte("scheduled_for", now.toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(PUBLISH_BATCH_LIMIT);
    if (error) throw new Error(`publishDueItems [load items]: ${error.message}`);

    let published = 0;
    let failed = 0;
    for (const row of dueItems ?? []) {
        try {
            const result = await publishAutoPostItem(row.id);
            if (result.status === "published") published += 1;
            else if (result.status === "failed") failed += 1;
        } catch (err) {
            console.error(`[autopost] publishDueItems failed for item=${row.id}:`, err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "publish", itemId: row.id });
            failed += 1;
        }
    }
    return { published, failed };
}

// ── Phase 4: janitor ─────────────────────────────────────────────────────────

/**
 * Fails items stuck in an in-flight status for longer than GENERATING_STALE_MS
 * — a crashed process, an uncaught rejection, or (M1) an unexpected throw
 * from a claimed-but-incomplete publish. Covers BOTH 'generating' (the
 * original case) and 'publishing' (M1 — resolveZernioCredentials, among
 * other calls between the claim and the final status write, can throw; that
 * throw is now caught inside publishAutoPostItem itself, but this janitor
 * pass stays as a second line of defense for any other way a 'publishing'
 * row could get abandoned, e.g. a process crash mid-publish).
 *
 * TASK 3 — third pass: fails 'awaiting_approval' items whose SCHEDULED slot
 * (`scheduled_for`, the intended publish time — deliberately NOT
 * `updated_at`, which would reset every time something merely touched the
 * row) is older than AWAITING_APPROVAL_EXPIRY_MS (7 days). Without this,
 * manual-mode items sit in the approval queue forever; approving one weeks
 * later would publish stale content immediately, which is exactly the
 * catch-up behavior the M3 grace window in materializeDueSlots exists to
 * prevent for freshly-missed slots — an item that already made it into the
 * queue and then just sat there deserves the same treatment.
 *
 * Retry still works mechanically afterward: the C1 path in
 * POST /api/autopost/items/:id/retry sends a 'failed' item that has a
 * post_id but no approved_at back to 'awaiting_approval' (skipping
 * regeneration, since the post already exists). Note the resulting UX
 * wrinkle this creates, which is out of scope to fix here: since retry does
 * not change `scheduled_for`, an item retried after expiring lands back in
 * 'awaiting_approval' with the same stale `scheduled_for` it had before —
 * the very next janitor tick will expire it again unless the owner approves
 * it within that ~5-minute cron window. Approving fast enough still works;
 * simply retrying and walking away does not.
 */
async function janitorStaleItems(sb: AdminSupabase, now: Date): Promise<number> {
    const cutoffIso = new Date(now.getTime() - GENERATING_STALE_MS).toISOString();
    const nowIso = now.toISOString();

    const { data: staleGenerating, error: generatingError } = await sb
        .from("auto_post_items")
        .update({
            status: "failed",
            error_message: "generation timed out — retry from the queue",
            updated_at: nowIso,
        })
        .eq("status", "generating")
        .lt("updated_at", cutoffIso)
        .select("id");
    if (generatingError) throw new Error(`janitorStaleItems [generating]: ${generatingError.message}`);

    const { data: stalePublishing, error: publishingError } = await sb
        .from("auto_post_items")
        .update({
            status: "failed",
            error_message: "publish timed out — retry from the queue",
            updated_at: nowIso,
        })
        .eq("status", "publishing")
        .lt("updated_at", cutoffIso)
        .select("id");
    if (publishingError) throw new Error(`janitorStaleItems [publishing]: ${publishingError.message}`);

    const approvalExpiryCutoffIso = new Date(now.getTime() - AWAITING_APPROVAL_EXPIRY_MS).toISOString();
    const { data: expiredApprovals, error: expiredApprovalError } = await sb
        .from("auto_post_items")
        .update({
            status: "failed",
            error_message: "Approval window expired (7 days) — this slot was never approved",
            updated_at: nowIso,
        })
        .eq("status", "awaiting_approval")
        .lt("scheduled_for", approvalExpiryCutoffIso)
        .select("id");
    if (expiredApprovalError) throw new Error(`janitorStaleItems [awaiting_approval expiry]: ${expiredApprovalError.message}`);

    return (staleGenerating?.length ?? 0) + (stalePublishing?.length ?? 0) + (expiredApprovals?.length ?? 0);
}

// ── Sweep entry point — TASK 2: two independently-locked lanes ─────────────

/**
 * TASK 2 — why the single-lock design broke publish latency.
 *
 * Previously all four phases (materialize → publish → generate → janitor)
 * ran sequentially under ONE in-process lock (`autoPostSweepRunning`).
 * Generation is strictly sequential and can run up to TRACK_BATCH_LIMIT (10)
 * items, each up to AUTOPOST_GENERATION_TIMEOUT_MS (~6 min) — a single tick
 * could legitimately take close to an hour. While that tick was still
 * running, the lock made every subsequent 5-minute tick a no-op — including
 * ticks that had nothing to do with generation at all. An item that was
 * ALREADY `approved` and due could sit waiting for up to that same ~hour
 * before its publish was even attempted, because materialize/publish/janitor
 * never got to run independently of generate. The prior "m7" reordering
 * (publish before generate) only fixed the ordering WITHIN a single tick; it
 * did nothing for a tick that never got to run at all because the lock was
 * still held by a previous tick's generation phase.
 *
 * Fix: split into two lanes with SEPARATE in-process locks, run
 * CONCURRENTLY via Promise.all:
 *   - FAST LANE (autoPostFastLaneRunning): materialize → publish → janitor.
 *     Bounded and quick (PUBLISH_BATCH_LIMIT=20 fast Zernio calls at most,
 *     plus cheap DB sweeps) — normally completes well within one 5-minute
 *     tick.
 *   - GENERATION LANE (autoPostGenerationLaneRunning): generate only.
 *     Minutes-long; its own lock means a long generation run only ever skips
 *     its OWN subsequent ticks, never the fast lane's.
 *
 * `runAutoPostSweep()` stays the single exported entry point both trigger
 * paths (node-cron in cleanup-cron.service.ts, and the HTTP endpoint in
 * internal-cron.routes.ts) call, with an unchanged signature and unchanged
 * `AutoPostSweepResult` shape — neither caller's logging needed to change.
 *
 * CONCURRENCY SAFETY — why running these two lanes at once, over the same
 * tables, doesn't introduce a race that didn't exist before:
 *   - generateQueuedItems claims each row with an optimistic guarded update
 *     (`update ... where status='queued'`) before touching it — the fast
 *     lane never writes a 'queued' row, so there's no contention on the
 *     claim itself.
 *   - janitorStaleItems (now in the fast lane) only touches 'generating' /
 *     'publishing' rows whose `updated_at` is older than GENERATING_STALE_MS
 *     (30 min). A row the generation lane just claimed has a fresh
 *     `updated_at` (set at claim time), so the janitor cannot steal a
 *     freshly-claimed row out from under an in-flight generation — it can
 *     only ever catch a row that's been stuck for a full 30 minutes, which
 *     was already true before this split (the janitor and generate phase
 *     already ran in the same tick, sequentially, under the old single
 *     lock — the janitor pass never checked "is generateQueuedItems
 *     currently running" even then).
 *   - materializeDueSlots' inserts are protected by auto_post_items'
 *     (track_id, scheduled_for) UNIQUE constraint, and its next_slot_at
 *     writes are a CAS guarded on the value read at the top of that loop
 *     iteration (see advanceTrackNextSlot) — neither depends on anything the
 *     generation lane touches.
 *   - The fast lane's publish phase (publishDueItems /
 *     publishAutoPostItem) only claims 'approved' rows; the generation lane
 *     only claims 'queued' rows and writes 'approved'/'awaiting_approval' —
 *     these are disjoint status transitions on disjoint row sets at any
 *     given instant, so there's no double-claim between the two lanes.
 *   - Both lanes call `createAdminSupabase()` independently below (rather
 *     than sharing one client instance across the concurrent calls) — the
 *     Supabase JS client is a thin per-request HTTP wrapper with no shared
 *     mutable request state, so this is a defensive/clarity choice, not a
 *     correctness requirement.
 */

interface FastLaneResult {
    materialized: number;
    published: number;
    failed: number;
    /** True when the lock was already held and this tick did no work at all. */
    skipped: boolean;
}

interface GenerationLaneResult {
    generated: number;
    failed: number;
    /** True when the lock was already held and this tick did no work at all. */
    skipped: boolean;
}

/** In-process lock for the fast lane (materialize → publish → janitor).
 * Lives here, not in the caller, so BOTH trigger paths (node-cron + the HTTP
 * endpoint) share the exact same guard within a process. Separate from
 * autoPostGenerationLaneRunning below — that's the entire point of TASK 2. */
let autoPostFastLaneRunning = false;

/** In-process lock for the generation lane (generate only). Separate from
 * autoPostFastLaneRunning so a long-running generation batch never blocks a
 * publish. */
let autoPostGenerationLaneRunning = false;

async function runFastLane(now: Date): Promise<FastLaneResult> {
    if (autoPostFastLaneRunning) {
        console.log("[autopost] Fast lane (materialize/publish/janitor) skipped — previous run still in progress");
        return { materialized: 0, published: 0, failed: 0, skipped: true };
    }
    autoPostFastLaneRunning = true;

    try {
        const sb = createAdminSupabase();

        // Each phase is independently guarded: a phase-level failure (e.g. a
        // transient DB error while loading the due-tracks batch) must not
        // abort the phases before/after it, and a per-track/per-item failure
        // inside a phase is already caught by that phase's own inner loop.
        //
        // m7 — publish still runs BEFORE materialize's downstream consumers
        // matter, i.e. publish stays ahead of anything generation-shaped.
        // With the lane split, generation is no longer even IN this
        // sequence, so publish latency is now bounded purely by this lane's
        // own (bounded, fast) phases plus the 5-minute tick interval — never
        // by generation's minutes-long AI call chain.
        let materialized = 0;
        try {
            ({ materialized } = await materializeDueSlots(sb, now));
        } catch (err) {
            console.error("[autopost] materialize phase failed:", err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "materialize" });
        }

        let published = 0;
        let publishFailed = 0;
        try {
            ({ published, failed: publishFailed } = await publishDueItems(sb, now));
        } catch (err) {
            console.error("[autopost] publish phase failed:", err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "publish" });
        }

        let janitorFailed = 0;
        try {
            janitorFailed = await janitorStaleItems(sb, now);
        } catch (err) {
            console.error("[autopost] janitor phase failed:", err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "janitor" });
        }

        return { materialized, published, failed: publishFailed + janitorFailed, skipped: false };
    } finally {
        autoPostFastLaneRunning = false;
    }
}

async function runGenerationLane(now: Date): Promise<GenerationLaneResult> {
    if (autoPostGenerationLaneRunning) {
        console.log("[autopost] Generation lane skipped — previous run still in progress");
        return { generated: 0, failed: 0, skipped: true };
    }
    autoPostGenerationLaneRunning = true;

    try {
        const sb = createAdminSupabase();

        let generated = 0;
        let generateFailed = 0;
        try {
            ({ generated, failed: generateFailed } = await generateQueuedItems(sb, now));
        } catch (err) {
            console.error("[autopost] generate phase failed:", err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "generate" });
        }

        return { generated, failed: generateFailed, skipped: false };
    } finally {
        autoPostGenerationLaneRunning = false;
    }
}

export async function runAutoPostSweep(): Promise<AutoPostSweepResult> {
    const now = new Date();

    const [fastResult, generationResult] = await Promise.all([
        runFastLane(now),
        runGenerationLane(now),
    ]);

    return {
        materialized: fastResult.materialized,
        generated: generationResult.generated,
        published: fastResult.published,
        failed: fastResult.failed + generationResult.failed,
        fast_lane_skipped: fastResult.skipped,
        generation_lane_skipped: generationResult.skipped,
    };
}
