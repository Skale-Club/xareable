/**
 * Autopilot sweep — computeNextSlotAt (pure scheduling math), runAutoPostSweep
 * (the 5-minute cron job that materializes due slots, generates queued items,
 * and publishes due approved items), and publishAutoPostItem (the single-item
 * publish helper shared by the sweep and the manual "approve" route).
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
 * Fetches active tracks with next_slot_at within the widest possible lead
 * (12h — the manual-mode lead; auto-mode's effective lead is narrower and is
 * re-checked in JS below), inserts a 'queued' auto_post_items row for every
 * track whose PER-TRACK lead has actually elapsed, and advances next_slot_at
 * BEFORE generation ever runs — so a crash between insert and generation
 * never re-materializes the same slot (the unique (track_id, scheduled_for)
 * constraint would just skip the duplicate anyway, but the advance still has
 * to happen exactly once per due slot).
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
            const leadMs = GENERATION_LEAD_MS[track.approval_mode];
            const nextSlotAt = track.next_slot_at ? new Date(track.next_slot_at) : null;
            if (!nextSlotAt || Number.isNaN(nextSlotAt.getTime())) continue;
            if (nextSlotAt.getTime() - leadMs > now.getTime()) continue; // not due yet under THIS track's lead

            const { error: insertError } = await sb.from("auto_post_items").insert({
                track_id: track.id,
                user_id: track.user_id,
                status: "queued",
                scheduled_for: nextSlotAt.toISOString(),
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

            const advanced = computeNextSlotAt(track, nextSlotAt);
            const { error: advanceError } = await sb
                .from("auto_post_tracks")
                .update({
                    next_slot_at: advanced ? advanced.toISOString() : null,
                    last_generated_at: now.toISOString(),
                    updated_at: now.toISOString(),
                })
                .eq("id", track.id)
                .eq("user_id", track.user_id);
            if (advanceError) {
                throw new Error(`advance next_slot_at [track=${track.id}]: ${advanceError.message}`);
            }
        } catch (err) {
            console.error(`[autopost] materializeDueSlots failed for track=${track.id}:`, err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "materialize", trackId: track.id });
        }
    }

    return { materialized };
}

// ── Phase 2: generate queued items ──────────────────────────────────────────

/**
 * Claims and generates 'queued' items sequentially — one AI-generation call
 * chain at a time, deliberately not parallelized (these are minutes-long
 * calls; see docs/autopost-scheduling.md). Each claim is an optimistic guard
 * (`update ... where status='queued'`); losing the race just skips the item
 * for this tick (another process's sweep already has it).
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
                const { error: successError } = await sb
                    .from("auto_post_items")
                    .update({
                        status: nextStatus,
                        post_id: postId,
                        error_message: null,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", item.id)
                    .eq("status", "generating");
                if (successError) throw new Error(`persist success item=${item.id}: ${successError.message}`);

                if ((track.consecutive_failures ?? 0) > 0) {
                    await sb
                        .from("auto_post_tracks")
                        .update({ consecutive_failures: 0, updated_at: new Date().toISOString() })
                        .eq("id", track.id);
                }
                generated += 1;
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

// ── Phase 3: publish ─────────────────────────────────────────────────────────

/**
 * Claims an 'approved' item and publishes it via the existing Zernio publish
 * path, re-reading track/account state fresh (never trusting stale data from
 * the caller). Exported so the manual approve route can publish inline when
 * the approved item's slot has already arrived. Idempotent under races: the
 * claim (`update ... where status='approved'`) means a second concurrent call
 * (sweep + manual approve landing at the same moment) just no-ops on the
 * loser side and reports whatever status the row already settled on.
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

    // Re-read track fresh — never trust anything about targets/ownership from
    // before the claim.
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

    try {
        await publishPost(item.user_id, { post_id: item.post_id, account_ids: accountIds }, credentials);
        const nowIso = new Date().toISOString();
        const { error: publishedError } = await sb
            .from("auto_post_items")
            .update({ status: "published", published_at: nowIso, error_message: null, updated_at: nowIso })
            .eq("id", item.id)
            .eq("status", "publishing");
        if (publishedError) throw new Error(`persist published: ${publishedError.message}`);
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

async function janitorStaleGeneratingItems(sb: AdminSupabase, now: Date): Promise<number> {
    const cutoffIso = new Date(now.getTime() - GENERATING_STALE_MS).toISOString();
    const { data, error } = await sb
        .from("auto_post_items")
        .update({
            status: "failed",
            error_message: "generation timed out — retry from the queue",
            updated_at: now.toISOString(),
        })
        .eq("status", "generating")
        .lt("updated_at", cutoffIso)
        .select("id");
    if (error) throw new Error(`janitorStaleGeneratingItems: ${error.message}`);
    return data?.length ?? 0;
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
        let materialized = 0;
        try {
            ({ materialized } = await materializeDueSlots(sb, now));
        } catch (err) {
            console.error("[autopost] materialize phase failed:", err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "materialize" });
        }

        let generated = 0;
        let generateFailed = 0;
        try {
            ({ generated, failed: generateFailed } = await generateQueuedItems(sb, now));
        } catch (err) {
            console.error("[autopost] generate phase failed:", err instanceof Error ? err.message : err);
            captureException(err, { job: "autopost_sweep", phase: "generate" });
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
            janitorFailed = await janitorStaleGeneratingItems(sb, now);
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
