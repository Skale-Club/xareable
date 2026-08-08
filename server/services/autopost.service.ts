/**
 * Autopilot sweep — computeNextSlotAt (pure scheduling math), runAutoPostSweep
 * (the 5-minute cron job that materializes due slots, publishes due approved
 * items, then generates queued items — publish runs BEFORE generate so a
 * slow, minutes-long generation chain never blocks an already-approved
 * item's publish behind it; see "Sweep design" in docs/autopost-scheduling.md
 * for the full phase-order rationale), and publishAutoPostItem (the
 * single-item publish helper shared by the sweep and the manual "approve"
 * route).
 *
 * See docs/autopost-scheduling.md ("State machine", "Sweep design") for the
 * full contract this file implements.
 *
 * TWO trigger paths coexist (mirrors cleanup-cron.service.ts): node-cron via
 * startCronJobs() and the HTTP trigger at POST /api/internal/autopost/sweep.
 * Both call runAutoPostSweep() directly — no logic divergence. The
 * autoPostSweepRunning lock below lives HERE (not in the caller) so both
 * paths share the exact same in-process guard against overlapping runs.
 * Cross-process double-firing is handled at the DB layer instead: every slot
 * insert is protected by auto_post_items' (track_id, scheduled_for) unique
 * constraint, and every status transition is an optimistic guarded update
 * (`update ... where status = <expected>`) — a cross-process race only ever
 * produces a skipped claim, never a duplicate post/charge/publish.
 */

import { createAdminSupabase } from "../supabase.js";
import { captureException } from "../lib/observability.js";
import {
    AUTO_POST_TIME_REGEX,
    type AutoPostItem,
    type AutoPostItemStatus,
    type AutoPostTrack,
    type AutoPostTrackCadence,
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

export interface AutoPostSweepResult {
    materialized: number;
    generated: number;
    published: number;
    failed: number;
}

// ── computeNextSlotAt — pure scheduling math ────────────────────────────────

interface ParsedTime {
    h: number;
    m: number;
}

/** Config shape computeNextSlotAt needs — a subset of AutoPostTrack so callers
 * can pass either a full row or a request-shaped patch merge. */
export interface AutoPostScheduleConfig {
    cadence: AutoPostTrackCadence;
    posting_times: unknown;
    weekly_day: number | null | undefined;
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

function atUtcTime(base: Date, t: ParsedTime): Date {
    const d = new Date(base.getTime());
    d.setUTCHours(t.h, t.m, 0, 0);
    return d;
}

function startOfUtcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function nextDailyOccurrence(times: ParsedTime[], after: Date): Date {
    const afterMs = after.getTime();
    const today = startOfUtcDay(after);
    for (const t of times) {
        const candidate = atUtcTime(today, t);
        if (candidate.getTime() > afterMs) return candidate;
    }
    // Nothing today qualifies (all times already passed, or "after" itself is
    // past the last one) — earliest time tomorrow.
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return atUtcTime(tomorrow, times[0]);
}

function nextWeeklyOccurrence(times: ParsedTime[], weeklyDay: number, after: Date): Date {
    const afterMs = after.getTime();
    const currentDay = after.getUTCDay(); // 0=Sun..6=Sat, matches weekly_day's convention
    const daysUntilTarget = (weeklyDay - currentDay + 7) % 7; // 0 => target weekday is today
    const targetDayBase = new Date(startOfUtcDay(after).getTime() + daysUntilTarget * 24 * 60 * 60 * 1000);

    for (const t of times) {
        const candidate = atUtcTime(targetDayBase, t);
        if (candidate.getTime() > afterMs) return candidate;
    }
    // Every time on this week's occurrence of the target weekday has already
    // passed (or "after" lands exactly on the last one) — jump a full week.
    const nextWeekBase = new Date(targetDayBase.getTime() + 7 * 24 * 60 * 60 * 1000);
    return atUtcTime(nextWeekBase, times[0]);
}

/**
 * Pure. UTC math only. Returns the earliest posting-time occurrence STRICTLY
 * after `after` — daily: today or tomorrow; weekly: this week's occurrence of
 * `weekly_day` or next week's. Returns null on an invalid config (no parseable
 * posting_times, or a weekly track with no/out-of-range weekly_day) — the
 * caller treats a null next_slot_at as "this track is effectively idle" and
 * never materializes a slot for it.
 */
export function computeNextSlotAt(track: AutoPostScheduleConfig, after: Date): Date | null {
    const times = parseAndSortTimes(track.posting_times);
    if (times.length === 0) return null;

    if (track.cadence === "daily") {
        return nextDailyOccurrence(times, after);
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
        return nextWeeklyOccurrence(times, track.weekly_day, after);
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

async function bumpTrackFailure(sb: AdminSupabase, track: AutoPostTrack, lastError: string): Promise<void> {
    const nextCount = (track.consecutive_failures ?? 0) + 1;
    const update: Record<string, unknown> = {
        consecutive_failures: nextCount,
        updated_at: new Date().toISOString(),
    };
    if (nextCount >= MAX_CONSECUTIVE_FAILURES) {
        update.is_active = false;
        update.paused_reason =
            `Auto-paused after ${MAX_CONSECUTIVE_FAILURES} consecutive generation failures: ${lastError}`.slice(0, 2000);
    }
    const { error } = await sb.from("auto_post_tracks").update(update).eq("id", track.id);
    if (error) {
        console.error(`[autopost] bumpTrackFailure(${track.id}) update failed:`, error.message);
    }
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

        await publishPost(item.user_id, { post_id: item.post_id, account_ids: accountIds }, credentials);
        const nowIso = new Date().toISOString();
        const { data: publishedRow, error: publishedError } = await sb
            .from("auto_post_items")
            .update({ status: "published", published_at: nowIso, error_message: null, updated_at: nowIso })
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
        return { status: "published" };
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

    return (staleGenerating?.length ?? 0) + (stalePublishing?.length ?? 0);
}

// ── Sweep entry point ────────────────────────────────────────────────────────

/** In-process lock — skip a tick entirely if the previous one is still
 * running (mirrors overageBatchRunning in cleanup-cron.service.ts). Lives
 * here, not in the caller, so BOTH trigger paths (node-cron + the HTTP
 * endpoint) share the exact same guard within a process. */
let autoPostSweepRunning = false;

export async function runAutoPostSweep(): Promise<AutoPostSweepResult> {
    if (autoPostSweepRunning) {
        console.log("[autopost] Sweep skipped — previous run still in progress");
        return { materialized: 0, generated: 0, published: 0, failed: 0 };
    }
    autoPostSweepRunning = true;

    try {
        const sb = createAdminSupabase();
        const now = new Date();

        // Each phase is independently guarded: a phase-level failure (e.g. a
        // transient DB error while loading the due-tracks batch) must not
        // abort the phases before/after it, and a per-track/per-item failure
        // inside a phase is already caught by that phase's own inner loop —
        // see the invariant this double-guards in the module header.
        //
        // m7 — publish runs BEFORE generate (materialize still runs first).
        // Generation is a minutes-long, strictly-sequential AI call chain
        // (TRACK_BATCH_LIMIT items, one at a time); publishing is fast and
        // bounded. With generate first, an already-`approved` item could sit
        // waiting behind a full batch of slow generations — up to
        // ~TRACK_BATCH_LIMIT generation chains — before its publish is even
        // attempted, on top of the up-to-5-minute tick interval. Publishing
        // first keeps publish latency bounded by the tick interval alone; a
        // slot that only just became due for generation this same tick still
        // publishes next tick, same as before.
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

        let generated = 0;
        let generateFailed = 0;
        try {
            ({ generated, failed: generateFailed } = await generateQueuedItems(sb, now));
        } catch (err) {
            console.error("[autopost] generate phase failed:", err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "generate" });
        }

        let janitorFailed = 0;
        try {
            janitorFailed = await janitorStaleItems(sb, now);
        } catch (err) {
            console.error("[autopost] janitor phase failed:", err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "janitor" });
        }

        return {
            materialized,
            generated,
            published,
            failed: generateFailed + publishFailed + janitorFailed,
        };
    } finally {
        autoPostSweepRunning = false;
    }
}
