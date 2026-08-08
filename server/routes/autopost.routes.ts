/**
 * Autopilot ("Autopost") routes — user-facing `/api/autopost/*` surface.
 *
 * All endpoints require auth (mirrors social.routes.ts's inline
 * `authenticateUser` house style). Reads use the user-scoped client (RLS
 * owner-SELECT policy); every write uses the service-role client, explicitly
 * re-scoped with `.eq("user_id", user.id)` on top of the `.eq("id", ...)`
 * lookup — belt-and-suspenders tenant isolation even though the admin client
 * bypasses RLS by design.
 *
 * See docs/autopost-scheduling.md for the state machine and the sweep this
 * pairs with (server/services/autopost.service.ts).
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import {
    createAutoPostTrackSchema,
    updateAutoPostTrackSchema,
    AUTO_POST_ITEM_STATUSES,
} from "../../shared/schema.js";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { createAdminSupabase } from "../supabase.js";
import { computeNextSlotAt, publishAutoPostItem } from "../services/autopost.service.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";

const router = Router();

const DEFAULT_ITEMS_LIMIT = 50;

const itemsQuerySchema = z.object({
    status: z.enum(AUTO_POST_ITEM_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** m8 — a malformed `:id` (not a UUID) hits Postgres's uuid-cast validation
 * inside the .eq("id", ...) filter and surfaces as an unhandled 500 instead
 * of a clean 404. Every handler below with a `:id` param checks this first. */
const uuidParamSchema = z.string().uuid();

/**
 * m6 — validates generation_params.post_mood (when present) against the
 * live style catalog's post_moods ids, same source post-creator-dialog.tsx
 * reads from. A free-text mood that doesn't match any catalog id would
 * silently drop the mood's art direction in generateAutoPost (resolveGenerationReferenceImages
 * just falls through to "no mood match"), so this rejects the request
 * up front instead. Returns an error message, or null when valid/absent.
 */
async function validatePostMoodId(postMood: string | undefined): Promise<string | null> {
    if (!postMood) return null;
    const catalog = await getStyleCatalogPayload();
    const validIds = new Set(catalog.post_moods.map((m) => m.id));
    return validIds.has(postMood)
        ? null
        : `Unknown post_mood "${postMood}" — must be one of the current style catalog's mood ids`;
}

/**
 * Verifies every id in `accountIds` is one of the caller's own, active
 * social_accounts rows. Returns the ids that DIDN'T verify (empty = all
 * good) — callers 400 when this is non-empty. A no-op (returns []) for an
 * empty input, since a track is allowed to have zero target accounts until
 * the owner picks some.
 */
async function verifyOwnedActiveAccountIds(
    sb: ReturnType<typeof createAdminSupabase>,
    userId: string,
    accountIds: string[],
): Promise<string[]> {
    if (accountIds.length === 0) return [];

    const { data: accounts, error } = await sb
        .from("social_accounts")
        .select("id")
        .in("id", accountIds)
        .eq("user_id", userId)
        .eq("is_active", true);
    if (error) throw new Error(`verifyOwnedActiveAccountIds: ${error.message}`);

    const foundIds = new Set((accounts ?? []).map((a: { id: string }) => a.id));
    return accountIds.filter((id) => !foundIds.has(id));
}

// ─────────────────────────────────────────────────────────────────
// GET /api/autopost/tracks
// ─────────────────────────────────────────────────────────────────
router.get("/api/autopost/tracks", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;

    const { data, error } = await supabase
        .from("auto_post_tracks")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

    if (error) {
        res.status(500).json({ message: "Failed to load tracks" });
        return;
    }

    res.json({ tracks: data ?? [] });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/autopost/tracks
// ─────────────────────────────────────────────────────────────────
router.post("/api/autopost/tracks", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;

    const parsed = createAutoPostTrackSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
        return;
    }
    const input = parsed.data;

    // m3 — an 'auto' track with zero target accounts would generate (and
    // charge for) a post every slot forever with nothing to publish to and
    // nothing to ever trip MAX_CONSECUTIVE_FAILURES (generation itself
    // succeeds fine; only publishing has no target). Reject up front.
    if (input.approval_mode === "auto" && input.account_ids.length === 0) {
        res.status(400).json({
            message: "Automatic mode requires at least one target account — select one or switch to manual approval",
        });
        return;
    }

    const postMoodError = await validatePostMoodId(input.generation_params.post_mood);
    if (postMoodError) {
        res.status(400).json({ message: postMoodError });
        return;
    }

    const sb = createAdminSupabase();

    try {
        const missingIds = await verifyOwnedActiveAccountIds(sb, user.id, input.account_ids);
        if (missingIds.length > 0) {
            res.status(400).json({
                message: "One or more selected accounts are invalid, inactive, or don't belong to you — reconnect them in Settings → Social",
                missing_account_ids: missingIds,
            });
            return;
        }
    } catch (err) {
        console.error(`[autopost] verifyOwnedActiveAccountIds failed for user=${user.id}:`, err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to verify social accounts" });
        return;
    }

    const nextSlotAt = computeNextSlotAt(
        { cadence: input.cadence, posting_times: input.posting_times, weekly_day: input.weekly_day ?? null },
        new Date(),
    );

    const { data: track, error: insertError } = await sb
        .from("auto_post_tracks")
        .insert({
            user_id: user.id,
            name: input.name,
            system_prompt: input.system_prompt,
            cadence: input.cadence,
            posting_times: input.posting_times,
            weekly_day: input.weekly_day ?? null,
            approval_mode: input.approval_mode,
            account_ids: input.account_ids,
            generation_params: input.generation_params,
            is_active: input.is_active,
            next_slot_at: nextSlotAt ? nextSlotAt.toISOString() : null,
        })
        .select()
        .single();

    if (insertError || !track) {
        console.error(`[autopost] track insert failed for user=${user.id}:`, insertError?.message);
        res.status(500).json({ message: "Failed to create track" });
        return;
    }

    res.status(201).json({ track });
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/autopost/tracks/:id
// ─────────────────────────────────────────────────────────────────
router.patch("/api/autopost/tracks/:id", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;
    const { id } = req.params;

    if (!uuidParamSchema.safeParse(id).success) {
        res.status(404).json({ message: "Track not found" });
        return;
    }

    const parsed = updateAutoPostTrackSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
        return;
    }
    const patch = parsed.data;

    const postMoodError = await validatePostMoodId(patch.generation_params?.post_mood);
    if (postMoodError) {
        res.status(400).json({ message: postMoodError });
        return;
    }

    const sb = createAdminSupabase();

    const { data: existing, error: fetchError } = await sb
        .from("auto_post_tracks")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
    if (fetchError) {
        res.status(500).json({ message: "Failed to load track" });
        return;
    }
    if (!existing) {
        res.status(404).json({ message: "Track not found" });
        return;
    }

    if (patch.account_ids) {
        try {
            const missingIds = await verifyOwnedActiveAccountIds(sb, user.id, patch.account_ids);
            if (missingIds.length > 0) {
                res.status(400).json({
                    message: "One or more selected accounts are invalid, inactive, or don't belong to you — reconnect them in Settings → Social",
                    missing_account_ids: missingIds,
                });
                return;
            }
        } catch (err) {
            console.error(`[autopost] verifyOwnedActiveAccountIds failed for user=${user.id}:`, err instanceof Error ? err.message : err);
            res.status(500).json({ message: "Failed to verify social accounts" });
            return;
        }
    }

    // Merge the patch onto the existing row to re-validate the
    // weekly_day-required-iff-weekly cross-field rule createAutoPostTrackSchema
    // enforces on create (updateAutoPostTrackSchema can't — a partial patch may
    // not include every field the rule needs).
    const mergedCadence = patch.cadence ?? existing.cadence;
    const mergedWeeklyDay = patch.weekly_day !== undefined ? patch.weekly_day : existing.weekly_day;
    if (mergedCadence === "weekly" && (mergedWeeklyDay === null || mergedWeeklyDay === undefined)) {
        res.status(400).json({ message: "weekly_day is required when cadence is 'weekly'" });
        return;
    }

    // m3 — same EFFECTIVE-config guard as create, re-checked against the
    // MERGED (patch onto existing) config: a PATCH that flips approval_mode
    // to 'auto' while account_ids stays empty (or vice versa: clears
    // account_ids while approval_mode is already 'auto') must be rejected
    // the same as create would.
    const mergedApprovalMode = patch.approval_mode ?? existing.approval_mode;
    const mergedAccountIds = patch.account_ids ?? existing.account_ids;
    if (mergedApprovalMode === "auto" && mergedAccountIds.length === 0) {
        res.status(400).json({
            message: "Automatic mode requires at least one target account — select one or switch to manual approval",
        });
        return;
    }

    const scheduleChanged = patch.cadence !== undefined || patch.posting_times !== undefined || patch.weekly_day !== undefined;
    const reactivating = patch.is_active === true && existing.is_active === false;

    const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };

    if (scheduleChanged || reactivating) {
        const mergedPostingTimes = patch.posting_times ?? existing.posting_times;
        const nextSlotAt = computeNextSlotAt(
            { cadence: mergedCadence, posting_times: mergedPostingTimes, weekly_day: mergedWeeklyDay ?? null },
            new Date(),
        );
        update.next_slot_at = nextSlotAt ? nextSlotAt.toISOString() : null;
    }

    if (reactivating) {
        update.paused_reason = null;
        update.consecutive_failures = 0;
    }

    const { data: updated, error: updateError } = await sb
        .from("auto_post_tracks")
        .update(update)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single();

    if (updateError || !updated) {
        console.error(`[autopost] track update failed for id=${id}:`, updateError?.message);
        res.status(500).json({ message: "Failed to update track" });
        return;
    }

    res.json({ track: updated });
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/autopost/tracks/:id
// ─────────────────────────────────────────────────────────────────
router.delete("/api/autopost/tracks/:id", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;
    const { id } = req.params;

    if (!uuidParamSchema.safeParse(id).success) {
        res.status(404).json({ message: "Track not found" });
        return;
    }

    const sb = createAdminSupabase();

    // Cascade removes auto_post_items (FK ON DELETE CASCADE); generated posts
    // themselves are untouched — post_id there is ON DELETE SET NULL, and the
    // post row lives in public.posts, not this table.
    const { data: deleted, error } = await sb
        .from("auto_post_tracks")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();

    if (error) {
        res.status(500).json({ message: "Failed to delete track" });
        return;
    }
    if (!deleted) {
        res.status(404).json({ message: "Track not found" });
        return;
    }

    res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/autopost/items?status=&limit=
// ─────────────────────────────────────────────────────────────────
router.get("/api/autopost/items", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;

    const parsedQuery = itemsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
        res.status(400).json({ message: "Invalid query", errors: parsedQuery.error.errors });
        return;
    }
    const { status, limit } = parsedQuery.data;

    let query = supabase
        .from("auto_post_items")
        .select("*, post:posts(image_url, thumbnail_url, caption), track:auto_post_tracks(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit ?? DEFAULT_ITEMS_LIMIT);

    if (status) {
        query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
        res.status(500).json({ message: "Failed to load items" });
        return;
    }

    res.json({ items: data ?? [] });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/autopost/items/:id/approve
// ─────────────────────────────────────────────────────────────────
router.post("/api/autopost/items/:id/approve", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;
    const { id } = req.params;

    if (!uuidParamSchema.safeParse(id).success) {
        res.status(404).json({ message: "Item not found" });
        return;
    }

    const sb = createAdminSupabase();

    const { data: claimed, error: claimError } = await sb
        .from("auto_post_items")
        .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("status", "awaiting_approval")
        .select("*")
        .maybeSingle();

    if (claimError) {
        res.status(500).json({ message: "Failed to approve item" });
        return;
    }
    if (!claimed) {
        res.status(409).json({ message: "Item is not awaiting approval — it may have already been handled" });
        return;
    }

    let responseItem = claimed;

    // If the slot's publish time has already arrived, publish inline instead
    // of waiting up to 5 minutes for the next sweep tick.
    if (new Date(claimed.scheduled_for).getTime() <= Date.now()) {
        try {
            await publishAutoPostItem(claimed.id);
            const { data: refreshed } = await sb.from("auto_post_items").select("*").eq("id", claimed.id).maybeSingle();
            if (refreshed) responseItem = refreshed;
        } catch (err) {
            // Publish failure here just leaves the item 'approved' (or 'failed',
            // publishAutoPostItem sets that itself) — the approve call still
            // succeeded, so log and return whatever the current row says rather
            // than fail the whole request.
            console.error(`[autopost] inline publish failed for item=${claimed.id}:`, err instanceof Error ? err.message : err);
            const { data: refreshed } = await sb.from("auto_post_items").select("*").eq("id", claimed.id).maybeSingle();
            if (refreshed) responseItem = refreshed;
        }
    }

    res.json({ item: responseItem });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/autopost/items/:id/reject
// ─────────────────────────────────────────────────────────────────
router.post("/api/autopost/items/:id/reject", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;
    const { id } = req.params;

    if (!uuidParamSchema.safeParse(id).success) {
        res.status(404).json({ message: "Item not found" });
        return;
    }

    const sb = createAdminSupabase();

    const { data: updated, error: updateError } = await sb
        .from("auto_post_items")
        .update({ status: "rejected", rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id)
        .in("status", ["awaiting_approval", "approved"])
        .select("*")
        .maybeSingle();

    if (updateError) {
        res.status(500).json({ message: "Failed to reject item" });
        return;
    }
    if (!updated) {
        res.status(409).json({ message: "Only items awaiting approval or already approved can be rejected" });
        return;
    }

    res.json({ item: updated });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/autopost/items/:id/retry
// ─────────────────────────────────────────────────────────────────
router.post("/api/autopost/items/:id/retry", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user } = authResult;
    const { id } = req.params;

    if (!uuidParamSchema.safeParse(id).success) {
        res.status(404).json({ message: "Item not found" });
        return;
    }

    const sb = createAdminSupabase();

    // C1 — a failed item that already has post_id set (generation succeeded;
    // it failed later at publish, or a lost claim race still persisted
    // post_id post-hoc — see M2) must NOT go back to 'queued'. Re-running the
    // full paid generation pipeline would burn a second paid generation AND
    // collide with the posts insert's idempotency_key ("autopost:<item.id>")
    // on a 23505 unique violation, permanently dead-ending the item every
    // time it's retried. The post already exists, so retry only decides where
    // it re-enters the state machine:
    //   - 'approved' when a human already approved it (approved_at set — the
    //     common publish-failure case) or the track is auto mode;
    //   - 'awaiting_approval' for a manual-mode item that was never approved
    //     (the M2 orphan path: the janitor failed it before approval). The
    //     history row's thumbnail is no substitute for the approval queue's
    //     full preview, so a manual-mode owner must still review it before
    //     it can publish.
    const { data: current, error: fetchError } = await sb
        .from("auto_post_items")
        .select("id, post_id, approved_at, auto_post_tracks(approval_mode)")
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("status", "failed")
        .maybeSingle();
    if (fetchError) {
        res.status(500).json({ message: "Failed to retry item" });
        return;
    }
    if (!current) {
        res.status(409).json({ message: "Item is not in a failed state" });
        return;
    }

    const nowIso = new Date().toISOString();
    const trackRel = current.auto_post_tracks as { approval_mode: string } | { approval_mode: string }[] | null;
    const approvalMode = Array.isArray(trackRel) ? trackRel[0]?.approval_mode : trackRel?.approval_mode;
    const humanApproved = Boolean(current.approved_at) || approvalMode === "auto";
    const retryUpdate = current.post_id
        ? humanApproved
            ? { status: "approved", approved_at: current.approved_at ?? nowIso, error_message: null, updated_at: nowIso }
            : { status: "awaiting_approval", error_message: null, updated_at: nowIso }
        : { status: "queued", error_message: null, updated_at: nowIso };

    const { data: updated, error } = await sb
        .from("auto_post_items")
        .update(retryUpdate)
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("status", "failed")
        .select("*")
        .maybeSingle();

    if (error) {
        res.status(500).json({ message: "Failed to retry item" });
        return;
    }
    if (!updated) {
        // Lost a race against another writer since the read above (e.g. the
        // sweep's janitor) — the item is no longer 'failed'.
        res.status(409).json({ message: "Item is not in a failed state" });
        return;
    }

    res.json({ item: updated });
});

export default router;
