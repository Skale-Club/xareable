/**
 * Zernio social publishing — payload building, publish orchestration, status
 * refresh (poll + webhook), and the cron sweep.
 *
 * Pairs with server/lib/zernio.ts (REST client) and
 * server/services/zernio-credentials.service.ts (credential resolution).
 * See docs/zernio-social-publishing.md ("Media mapping", "Server design",
 * "Cron") for the contract this file implements.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "../supabase.js";
import { captureException } from "../lib/observability.js";
import { ValidationError, NotFoundError } from "../utils/errors.js";
import {
    createZernioPost,
    getZernioPost,
    zernioAccountIdOf,
    ZernioApiError,
    type ZernioCreatePostPayload,
    type ZernioMediaItem,
    type ZernioPlatformTarget,
} from "../lib/zernio.js";
import { resolveZernioCredentials, type ZernioCredentials } from "./zernio-credentials.service.js";
import { resolvePublicationStatus, type PublicationStatus } from "./publication-status.service.js";
import type {
    InstagramPublishOptions,
    PostPublication,
    SocialPublishRequest,
} from "../../shared/schema.js";

// ── Local types (subsets of posts/post_slides/social_accounts columns) ─────

export interface PublishSourcePost {
    id: string;
    user_id: string;
    content_type: "image" | "video" | "carousel" | "enhancement";
    image_url: string | null;
    caption: string | null;
}

export interface PublishSourceSlide {
    slide_number: number;
    image_url: string;
}

export interface PublishTargetAccount {
    id: string;
    zernio_account_id: string;
    platform: string;
}

export type BuildPostPayloadOptions = Pick<
    SocialPublishRequest,
    "caption" | "scheduled_for" | "instagram_options"
>;

/**
 * The two Zernio webhook payload shapes documented in
 * docs/zernio-social-publishing.md ("Webhooks"): a post-level event
 * (`post.published` / `post.failed` / `post.partial`) carries a `platforms[]`
 * breakdown; a platform-level event (`post.platform.published` /
 * `post.platform.failed`) carries the same envelope PLUS top-level
 * `platform`/`account`/etc. fields describing the single platform the event
 * concerns. Note the webhook's `publishedUrl` field name differs from the
 * REST `GET /v1/posts/:id` response's `platformPostUrl`.
 */
export interface ZernioWebhookPlatformEntry {
    platform: string;
    status?: string;
    accountId?: unknown;
    platformPostId?: string;
    publishedUrl?: string;
    error?: string;
}

export interface ZernioWebhookPostPayload {
    event: string;
    post: {
        id: string;
        status?: string;
        publishedAt?: string;
        platforms?: ZernioWebhookPlatformEntry[];
        metadata?: Record<string, unknown>;
    };
}

export interface ZernioWebhookPostPlatformPayload extends ZernioWebhookPostPayload {
    /**
     * Per the spec (WebhookPayloadPostPlatform) this is an OBJECT
     * `{ name, status, platformPostId, publishedUrl, error }` describing the
     * single platform that transitioned; `account` is
     * `{ accountId, platform, username }`. A plain-string `platform` is
     * tolerated defensively.
     */
    platform: { name: string; status?: string; platformPostId?: string; publishedUrl?: string; error?: string } | string;
    account?: unknown;
}

// ── Media mapping (docs/zernio-social-publishing.md "Media mapping") ───────

const MAX_CAROUSEL_SLIDES = 10;

function buildMediaItems(post: PublishSourcePost, slides: PublishSourceSlide[]): ZernioMediaItem[] {
    switch (post.content_type) {
        case "image":
        case "enhancement": {
            if (!post.image_url) {
                throw new ValidationError("This post has no image to publish");
            }
            return [{ type: "image", url: post.image_url }];
        }
        case "carousel": {
            const ordered = [...slides].sort((a, b) => a.slide_number - b.slide_number);
            if (ordered.length === 0) {
                throw new ValidationError("This carousel post has no slides to publish");
            }
            if (ordered.length > MAX_CAROUSEL_SLIDES) {
                throw new ValidationError(
                    `Carousel posts can publish at most ${MAX_CAROUSEL_SLIDES} slides (Instagram/Facebook limit); this post has ${ordered.length}`,
                );
            }
            return ordered.map((slide) => ({ type: "image", url: slide.image_url }));
        }
        case "video": {
            // Video posts store their media in image_url (house convention).
            if (!post.image_url) {
                throw new ValidationError("This post has no video to publish");
            }
            return [{ type: "video", url: post.image_url }];
        }
        default: {
            throw new ValidationError(`Unsupported content_type for publishing: ${post.content_type}`);
        }
    }
}

function buildPlatformSpecificData(
    platform: string,
    instagramOptions: InstagramPublishOptions | undefined,
): Record<string, unknown> {
    if (platform !== "instagram") return {};

    const mapped: Record<string, unknown> = {};
    if (instagramOptions?.content_type === "story") mapped.contentType = "story";
    if (instagramOptions?.first_comment !== undefined) mapped.firstComment = instagramOptions.first_comment;
    if (instagramOptions?.share_to_feed !== undefined) mapped.shareToFeed = instagramOptions.share_to_feed;

    // isAiGenerated is always set — Xareable media is always AI-generated and
    // Meta requires the self-disclosure label. User options never override it.
    return { isAiGenerated: true, ...mapped };
}

/** True when a schedule request should publish immediately: none given, or <= 60s from now. */
function isEffectivelyNow(scheduledFor: string | undefined): boolean {
    if (!scheduledFor) return true;
    const ms = Date.parse(scheduledFor);
    if (!Number.isFinite(ms)) return true;
    return ms <= Date.now() + 60_000;
}

/**
 * Build the Zernio `POST /v1/posts` payload for a publish request. Pure
 * (no I/O) except for throwing a `ValidationError` (statusCode 400) on an
 * invalid slide count or missing media — callers should call this AFTER
 * loading the post/slides/accounts so validation happens before any Zernio
 * API call.
 */
export function buildZernioPostPayload(
    post: PublishSourcePost,
    slides: PublishSourceSlide[],
    targets: PublishTargetAccount[],
    opts: BuildPostPayloadOptions = {},
): ZernioCreatePostPayload {
    const mediaItems = buildMediaItems(post, slides);
    const content = opts.caption ?? post.caption ?? "";

    const platforms: ZernioPlatformTarget[] = targets.map((target) => ({
        platform: target.platform,
        accountId: target.zernio_account_id,
        platformSpecificData: buildPlatformSpecificData(target.platform, opts.instagram_options),
    }));

    const timing = isEffectivelyNow(opts.scheduled_for)
        ? { publishNow: true as const }
        : { scheduledFor: opts.scheduled_for as string };

    return {
        content,
        mediaItems,
        platforms,
        timezone: "UTC",
        metadata: {
            source: "xareable",
            xareable_post_id: post.id,
            xareable_user_id: post.user_id,
        },
        ...timing,
    };
}

// ── Status mapping shared by publish / refresh / webhook ───────────────────

function initialStatusFromZernio(platformStatus: string | undefined, postLevelStatus: string | undefined): PublicationStatus {
    return resolvePublicationStatus("pending", platformStatus, postLevelStatus);
}

// ── Publish ──────────────────────────────────────────────────────────────

/**
 * Load the post + (if carousel) its slides + the requested social_accounts,
 * enforce ownership on every one of them, call Zernio once, and insert one
 * `post_publications` row per target. ZernioApiError from `createZernioPost`
 * is intentionally left uncaught — callers map it via `mapZernioError`.
 */
export async function publishPost(
    userId: string,
    req: SocialPublishRequest,
    credentials: ZernioCredentials,
): Promise<PostPublication[]> {
    const sb = createAdminSupabase();

    const { data: post, error: postError } = await sb
        .from("posts")
        .select("id, user_id, content_type, image_url, caption")
        .eq("id", req.post_id)
        .eq("user_id", userId)
        .is("trashed_at", null)
        .maybeSingle();
    if (postError) throw new Error(`publishPost(${req.post_id}) [load post]: ${postError.message}`);
    if (!post) throw new NotFoundError("Post");

    let slides: PublishSourceSlide[] = [];
    if (post.content_type === "carousel") {
        const { data: slideRows, error: slidesError } = await sb
            .from("post_slides")
            .select("slide_number, image_url")
            .eq("post_id", post.id)
            .order("slide_number", { ascending: true });
        if (slidesError) throw new Error(`publishPost(${req.post_id}) [load slides]: ${slidesError.message}`);
        slides = slideRows || [];
    }

    // connection_mode must match the mode the credentials resolved to — after
    // a BYOK↔global switch, stale cached accounts from the OTHER mode belong
    // to a different Zernio workspace and would 403 (or worse, publish through
    // the wrong workspace) if sent with these credentials.
    const { data: accounts, error: accountsError } = await sb
        .from("social_accounts")
        .select("id, zernio_account_id, platform")
        .in("id", req.account_ids)
        .eq("user_id", userId)
        .eq("is_active", true)
        .eq("connection_mode", credentials.mode);
    if (accountsError) throw new Error(`publishPost(${req.post_id}) [load accounts]: ${accountsError.message}`);

    const foundIds = new Set((accounts || []).map((a) => a.id as string));
    const missingIds = req.account_ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new ValidationError(
            "One or more selected accounts are invalid, inactive, or don't belong to you — reconnect them in Settings → Social",
            { missing_account_ids: missingIds },
        );
    }

    const targets = (accounts || []) as PublishTargetAccount[];
    const payload = buildZernioPostPayload(post as PublishSourcePost, slides, targets, {
        caption: req.caption,
        scheduled_for: req.scheduled_for,
        instagram_options: req.instagram_options,
    });

    const requestId = randomUUID();
    const response = await createZernioPost(credentials.apiKey, payload, requestId);

    const zernioPost = response.post;
    const zernioPostId = zernioPost?._id ?? null;
    const isPublishNow = payload.publishNow === true;

    const rowsToInsert = targets.map((account) => {
        const platformEntry = zernioPost?.platforms?.find(
            (p) => p.platform === account.platform && zernioAccountIdOf(p.accountId) === account.zernio_account_id,
        );

        const status: PublicationStatus = isPublishNow
            ? initialStatusFromZernio(platformEntry?.status, zernioPost?.status)
            : "scheduled";

        return {
            user_id: userId,
            post_id: post.id,
            social_account_id: account.id,
            platform: account.platform,
            mode: credentials.mode,
            zernio_post_id: zernioPostId,
            status,
            platform_post_id: platformEntry?.platformPostId ?? null,
            platform_post_url: platformEntry?.platformPostUrl ?? null,
            // REST responses carry the failure text in `errorMessage`; `error`
            // is the webhook-payload field name, kept as fallback.
            error_message: platformEntry?.errorMessage ?? platformEntry?.error ?? null,
            scheduled_for: req.scheduled_for ?? null,
            published_at: status === "published" ? new Date().toISOString() : null,
        };
    });

    const { data: inserted, error: insertError } = await sb
        .from("post_publications")
        .insert(rowsToInsert)
        .select("*");
    if (insertError) {
        // Zernio already created the post (we have zernioPostId) — the content
        // may already be LIVE on the connected platform(s), but Xareable has no
        // `post_publications` row to show for it. The 24h dedup 409 on Zernio's
        // side is the only backstop against a duplicate publish if the caller
        // (or the user, seeing a 500) retries. Report loudly instead of
        // swallowing this: captureException with everything needed to find and
        // reconcile the orphaned Zernio post, and make the thrown error's
        // MESSAGE say so explicitly — this is surfaced to the route's error
        // response, so the user sees it too.
        const targetAccountIds = targets.map((t) => t.id);
        captureException(insertError, {
            job: "publish_post_insert_after_zernio_success",
            userId,
            postId: post.id,
            zernioPostId,
            targetAccountIds,
        });
        throw new Error(
            `publishPost(${req.post_id}): Zernio publish succeeded (zernio_post_id=${zernioPostId ?? "unknown"}) ` +
                `but recording it in Xareable failed: ${insertError.message}. The content may already be LIVE on ` +
                `the connected platform(s) — check Zernio or the platform directly before retrying to avoid a duplicate publish.`,
        );
    }

    return (inserted || []) as PostPublication[];
}

/** { statusCode, message } mapping for the errors Zernio can throw on a publish/retry call. */
export interface MappedZernioError {
    statusCode: number;
    message: string;
}

export function mapZernioError(err: unknown): MappedZernioError {
    if (err instanceof ZernioApiError) {
        switch (err.status) {
            case 402:
                return { statusCode: 402, message: "Zernio payment required — check your Zernio plan/billing." };
            case 409:
                return {
                    statusCode: 409,
                    message: "This exact content was already published to that account in the last 24 hours.",
                };
            case 429:
                return { statusCode: 429, message: "Zernio rate limit reached — try again shortly." };
            default:
                return { statusCode: 502, message: err.message || "Zernio request failed" };
        }
    }
    return { statusCode: 502, message: err instanceof Error ? err.message : "Zernio request failed" };
}

// ── Status refresh (poll + webhook share this) ──────────────────────────

/**
 * A row that has been refreshed this many times without resolving to a
 * terminal state (published/failed) is given up on: transitioned to
 * `status='failed'` with an explanatory `error_message` and excluded from
 * future sweep selection. The sweep runs every 15 minutes, so 20 attempts is
 * roughly 5 hours of trying — long enough to ride out a Zernio outage or a
 * delayed webhook, short enough that a row whose credentials can never
 * resolve (removed/rotated key, BYOK<->global switch) doesn't occupy the
 * sweep forever.
 */
export const MAX_REFRESH_ATTEMPTS = 20;

const SWEEP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — beyond this a row is abandoned, not just stale
const SWEEP_LOOKAHEAD_MS = 5 * 60 * 1000; // 5 minutes — how early a `scheduled` row becomes worth polling
const SWEEP_QUIET_MS = 60_000; // 60 seconds — don't re-touch a row we (or a webhook) just updated

export interface SweepCutoffs {
    nowIso: string;
    pending: { createdAfter: string; updatedBefore: string };
    scheduled: { dueBy: string; abandonedAfter: string; updatedBefore: string };
}

/**
 * Pure. Computes the ISO-timestamp cutoffs the two sweep queries filter on,
 * given a point in time. Split out so both the DB queries and
 * `shouldPollPublication` (and the standalone test script) share one
 * definition of "recent enough to matter".
 */
export function computeSweepCutoffs(now: number = Date.now()): SweepCutoffs {
    return {
        nowIso: new Date(now).toISOString(),
        pending: {
            createdAfter: new Date(now - SWEEP_LOOKBACK_MS).toISOString(),
            updatedBefore: new Date(now - SWEEP_QUIET_MS).toISOString(),
        },
        scheduled: {
            dueBy: new Date(now + SWEEP_LOOKAHEAD_MS).toISOString(),
            abandonedAfter: new Date(now - SWEEP_LOOKBACK_MS).toISOString(),
            updatedBefore: new Date(now - SWEEP_QUIET_MS).toISOString(),
        },
    };
}

export interface SweepableRow {
    id?: string;
    status: string;
    created_at: string;
    updated_at: string;
    scheduled_for: string | null;
    refresh_attempts: number;
}

/**
 * Pure. The sweep's row-selection decision, expressed once so it can be
 * asserted directly (scripts/test-publication-refresh-selection.ts) AND
 * applied in-process as a defensive final filter after the two DB queries
 * below (belt-and-braces against clock skew or a PostgREST filter not being
 * exactly what we intended).
 *
 * A row is worth polling when:
 *   - it hasn't exhausted MAX_REFRESH_ATTEMPTS, AND
 *   - it wasn't touched in the last SWEEP_QUIET_MS, AND
 *   - it's `pending` and still within the 7-day creation window (a
 *     publish-now attempt in flight — nothing meaningful can happen before
 *     that, and nothing useful can be learned 7 days after), OR
 *   - it's `scheduled` and its relevant time (scheduled_for, falling back to
 *     created_at if scheduled_for is unexpectedly null) has arrived within
 *     the look-ahead window and hasn't gone stale beyond the 7-day
 *     abandon window.
 */
export function shouldPollPublication(row: SweepableRow, now: number = Date.now()): boolean {
    if (row.refresh_attempts >= MAX_REFRESH_ATTEMPTS) return false;

    const updatedAtMs = Date.parse(row.updated_at);
    if (Number.isFinite(updatedAtMs) && now - updatedAtMs < SWEEP_QUIET_MS) return false;

    if (row.status === "pending") {
        const createdAtMs = Date.parse(row.created_at);
        // Malformed created_at should never happen; don't silently drop the row.
        return !Number.isFinite(createdAtMs) || now - createdAtMs <= SWEEP_LOOKBACK_MS;
    }

    if (row.status === "scheduled") {
        // Defensive: a scheduled row should always carry scheduled_for. If
        // it's somehow null, fall back to the created_at window (same rule
        // as pending) so the row is never silently ignored forever.
        const relevantAtMs = row.scheduled_for != null ? Date.parse(row.scheduled_for) : Date.parse(row.created_at);
        if (!Number.isFinite(relevantAtMs)) return true;
        const isDue = relevantAtMs <= now + SWEEP_LOOKAHEAD_MS;
        const isAbandoned = relevantAtMs < now - SWEEP_LOOKBACK_MS;
        return isDue && !isAbandoned;
    }

    return false;
}

async function loadAccountZernioIds(
    sb: SupabaseClient,
    rows: Pick<PostPublication, "social_account_id">[],
): Promise<Map<string, string>> {
    const ids = Array.from(
        new Set(rows.map((r) => r.social_account_id).filter((v): v is string => !!v)),
    );
    const map = new Map<string, string>();
    if (ids.length === 0) return map;

    const { data } = await sb.from("social_accounts").select("id, zernio_account_id").in("id", ids);
    for (const row of data || []) map.set(row.id, row.zernio_account_id);
    return map;
}

interface NormalizedPlatformMatch {
    status?: string;
    platformPostId?: string | null;
    platformPostUrl?: string | null;
    error?: string | null;
}

/**
 * `countsAsRefreshAttempt` distinguishes the two callers: `refreshPublications`
 * (sweep + lazy on-demand refresh) is a POLL attempt and should bump
 * `refresh_attempts`/`last_refresh_at` — including when it's a no-op (no
 * matching platform entry) or a deliberate skip (missing/mismatched
 * credentials), which is exactly what stops those rows from being
 * re-selected forever. `applyWebhookEvent` is a push notification, not a
 * poll — it must NOT consume attempt budget, or a healthy stream of webhook
 * updates for a slow-moving post could itself trip the cap.
 */
async function updatePublicationRow(
    sb: SupabaseClient,
    row: PostPublication,
    match: NormalizedPlatformMatch | undefined,
    postLevelStatus: string | undefined,
    opts: { countsAsRefreshAttempt?: boolean } = {},
): Promise<void> {
    const countsAsRefreshAttempt = opts.countsAsRefreshAttempt ?? true;
    let nextStatus = resolvePublicationStatus(row.status as PublicationStatus, match?.status, postLevelStatus);

    const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        status: nextStatus,
    };

    if (countsAsRefreshAttempt) {
        const nextAttempts = (row.refresh_attempts ?? 0) + 1;
        update.refresh_attempts = nextAttempts;
        update.last_refresh_at = new Date().toISOString();

        // MAX_REFRESH_ATTEMPTS cap: if the row is STILL not resolved after
        // using up all its retries, stop re-selecting it and surface a real
        // terminal state instead of leaving it pending/scheduled forever.
        if ((nextStatus === "pending" || nextStatus === "scheduled") && nextAttempts >= MAX_REFRESH_ATTEMPTS) {
            nextStatus = "failed";
            update.status = "failed";
            update.error_message =
                `Publication status could not be confirmed after ${MAX_REFRESH_ATTEMPTS} refresh attempts. ` +
                "The content may or may not have published — check the platform directly, then retry from Xareable if needed.";
        }
    }

    if (match) {
        update.platform_post_id = match.platformPostId ?? row.platform_post_id ?? null;
        update.platform_post_url = match.platformPostUrl ?? row.platform_post_url ?? null;
        // Never null-overwrite an error message another path (e.g. a webhook)
        // already recorded — only replace it with a real new message, or clear
        // it once the row reaches published.
        if (match.error != null) {
            update.error_message = match.error;
        } else if (nextStatus === "published") {
            update.error_message = null;
        }
    }
    if (nextStatus === "published" && !row.published_at) {
        update.published_at = new Date().toISOString();
    }

    const { error } = await sb.from("post_publications").update(update).eq("id", row.id);
    if (error) {
        console.error(`[social-publish] failed to update publication ${row.id}: ${error.message}`);
    }
}

/**
 * Poll Zernio for the current status of a batch of `post_publications` rows
 * (grouped by user + zernio_post_id so each user's credentials are resolved
 * once) and write back status/platform_post_id/platform_post_url/error_message/
 * published_at. Tolerates per-post failures — logs and continues so one bad
 * post/expired credential set never blocks the rest of the batch.
 */
export async function refreshPublications(rows: PostPublication[]): Promise<void> {
    const sb = createAdminSupabase();

    const groups = new Map<string, PostPublication[]>();
    const unpollable: PostPublication[] = [];
    for (const row of rows) {
        if (!row.zernio_post_id) {
            // No zernio_post_id means there is nothing to poll Zernio for
            // (should only happen if a publish's Zernio response was
            // malformed). Still bump the attempt counter — otherwise this row
            // would match the sweep's staleness filter on every tick forever,
            // the same starvation pattern the credential/mode-mismatch skips
            // below guard against.
            unpollable.push(row);
            continue;
        }
        const key = `${row.user_id}::${row.zernio_post_id}`;
        const list = groups.get(key);
        if (list) list.push(row);
        else groups.set(key, [row]);
    }
    if (unpollable.length > 0) {
        await Promise.all(unpollable.map((row) => updatePublicationRow(sb, row, undefined, undefined)));
    }

    for (const [key, groupRows] of Array.from(groups.entries())) {
        const [userId, zernioPostId] = key.split("::");
        // Tracks which rows in this group have already had an update call
        // issued this pass (real match update OR a bump-only skip), so the
        // catch-all in the `catch` block below never double-bumps a row that
        // was already handled earlier in the try block.
        const handledIds = new Set<string>();
        const bump = async (row: PostPublication): Promise<void> => {
            if (handledIds.has(row.id)) return;
            handledIds.add(row.id);
            await updatePublicationRow(sb, row, undefined, undefined);
        };

        try {
            const credentials = await resolveZernioCredentials(userId);
            if (!credentials) {
                console.warn(
                    `[social-publish] refreshPublications: no credentials for user=${userId}; skipping zernio_post_id=${zernioPostId}`,
                );
                // Bump every row's attempt counter even on skip — this is what
                // stops a permanently-missing credential set from matching the
                // sweep's `updated_at < now-60s` filter forever.
                await Promise.all(groupRows.map(bump));
                continue;
            }

            // A row's recorded `mode` can diverge from the CURRENTLY resolved
            // credentials' mode after the user switches BYOK<->global — those
            // rows belong to a Zernio workspace this credential set never knew
            // about, so calling Zernio for them would poll the wrong (or no)
            // post. Skip the Zernio call for mismatched rows, record the
            // attempt, and let MAX_REFRESH_ATTEMPTS terminate them.
            const pollable = groupRows.filter((row) => row.mode === credentials.mode);
            const modeMismatched = groupRows.filter((row) => row.mode !== credentials.mode);
            if (modeMismatched.length > 0) {
                console.warn(
                    `[social-publish] refreshPublications: mode mismatch for user=${userId} zernio_post_id=${zernioPostId} ` +
                        `— ${modeMismatched.length} row(s) recorded mode differs from the currently resolved mode='${credentials.mode}'; ` +
                        "skipping Zernio call for them (stale BYOK<->global switch)",
                );
                await Promise.all(modeMismatched.map(bump));
            }
            if (pollable.length === 0) continue;

            const { post: zernioPost } = await getZernioPost(credentials.apiKey, zernioPostId);
            if (!zernioPost) {
                // Zernio has no record of this post (e.g. purged) — still bump
                // so this can't loop forever without reaching a terminal state.
                await Promise.all(pollable.map(bump));
                continue;
            }

            const accountsById = await loadAccountZernioIds(sb, pollable);

            for (const row of pollable) {
                const accountZernioId = row.social_account_id ? accountsById.get(row.social_account_id) : undefined;
                const platformEntry = zernioPost.platforms?.find(
                    (p) =>
                        p.platform === row.platform &&
                        (!accountZernioId || zernioAccountIdOf(p.accountId) === accountZernioId),
                );

                handledIds.add(row.id);
                await updatePublicationRow(
                    sb,
                    row,
                    platformEntry
                        ? {
                              status: platformEntry.status,
                              platformPostId: platformEntry.platformPostId ?? null,
                              platformPostUrl: platformEntry.platformPostUrl ?? null,
                              // REST field is `errorMessage`; `error` kept as fallback.
                              error: platformEntry.errorMessage ?? platformEntry.error ?? null,
                          }
                        : undefined,
                    zernioPost.status,
                );
            }
        } catch (err) {
            console.error(
                `[social-publish] refreshPublications failed for user=${userId} zernio_post_id=${zernioPostId}:`,
                err instanceof Error ? err.message : err,
            );
            captureException(err, { job: "refresh_publications", userId, zernioPostId });
            // A per-group exception (network error, Zernio 5xx, etc.) still
            // counts as an attempt for every row this pass hasn't already
            // handled — otherwise a persistently-erroring zernio_post_id would
            // occupy the sweep forever exactly like the missing-credentials case.
            await Promise.all(groupRows.filter((row) => !handledIds.has(row.id)).map(bump)).catch(() => {});
        }
    }
}

/**
 * Cron sweep (every 15 min): refresh post_publications stuck in pending/scheduled
 * that are recent enough to matter and haven't been touched in the last minute.
 * Webhooks are the primary status path; this is the safety net.
 *
 * Relevance is anchored on the time that actually matters, NOT on
 * `created_at` alone — a `scheduled` row created 10 days out but due to
 * publish today must still be polled. PostgREST can't express
 * `coalesce(scheduled_for, created_at)` in a filter cleanly, so this runs as
 * TWO queries (pending / scheduled) merged and deduped by id in JS, ordered
 * by `updated_at` ascending (least-recently-touched first) so a batch of
 * rows that can never resolve doesn't crowd out fresh ones — see
 * `shouldPollPublication` above for the shared selection rule, applied here
 * again as a defensive final filter.
 */
export async function runPublicationStatusSweep(): Promise<number> {
    const sb = createAdminSupabase();
    const now = Date.now();
    const cutoffs = computeSweepCutoffs(now);

    // Query A — pending: a publish-now attempt still in flight.
    const { data: pendingRows, error: pendingError } = await sb
        .from("post_publications")
        .select("*")
        .eq("status", "pending")
        .gt("created_at", cutoffs.pending.createdAfter)
        .lt("updated_at", cutoffs.pending.updatedBefore)
        .lt("refresh_attempts", MAX_REFRESH_ATTEMPTS)
        .order("updated_at", { ascending: true })
        .limit(50);
    if (pendingError) throw pendingError;

    // Query B — scheduled: `scheduled_for` has arrived (small look-ahead) and
    // hasn't gone stale (7-day abandon window). The second `or()` branch
    // defensively covers a `scheduled` row with a NULL `scheduled_for`
    // (should never happen) by falling back to the created_at window, so
    // such a row is not silently excluded forever.
    const { data: scheduledRows, error: scheduledError } = await sb
        .from("post_publications")
        .select("*")
        .eq("status", "scheduled")
        .lt("updated_at", cutoffs.scheduled.updatedBefore)
        .lt("refresh_attempts", MAX_REFRESH_ATTEMPTS)
        .or(
            `and(scheduled_for.not.is.null,scheduled_for.lte.${cutoffs.scheduled.dueBy},scheduled_for.gt.${cutoffs.scheduled.abandonedAfter}),` +
                `and(scheduled_for.is.null,created_at.gt.${cutoffs.pending.createdAfter})`,
        )
        .order("updated_at", { ascending: true })
        .limit(50);
    if (scheduledError) throw scheduledError;

    const merged = new Map<string, PostPublication>();
    for (const row of [...(pendingRows || []), ...(scheduledRows || [])] as PostPublication[]) {
        merged.set(row.id, row);
    }

    const rows = Array.from(merged.values())
        .filter((row) => shouldPollPublication(row as unknown as SweepableRow, now))
        .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
        .slice(0, 50);

    if (rows.length === 0) return 0;

    await refreshPublications(rows);
    return rows.length;
}

// ── Webhook ──────────────────────────────────────────────────────────────

/**
 * Apply a verified Zernio webhook event to matching post_publications rows.
 * `userId` is null for the global-webhook path (payload carries no
 * per-user identity there) — safe to scope by `zernio_post_id` alone since
 * those ids are Zernio-side unique. Unknown/malformed payloads and events
 * that match no row are no-ops (Zernio disables a webhook after 10
 * consecutive delivery failures, so this function NEVER throws).
 */
export async function applyWebhookEvent(userId: string | null, payload: unknown): Promise<void> {
    try {
        if (!payload || typeof payload !== "object") return;
        const body = payload as Record<string, any>;
        const post = body.post as Record<string, any> | undefined;
        const postId = typeof post?.id === "string" ? post.id : undefined;
        if (!postId) return;

        const sb = createAdminSupabase();
        let query = sb.from("post_publications").select("*").eq("zernio_post_id", postId);
        if (userId) query = query.eq("user_id", userId);

        const { data: rows, error } = await query;
        if (error) {
            console.error(`[social-publish] applyWebhookEvent: load failed for zernio_post_id=${postId}:`, error.message);
            return;
        }
        if (!rows || rows.length === 0) return;

        const entries: ZernioWebhookPlatformEntry[] = Array.isArray(post?.platforms) ? post.platforms : [];

        // `post.platform.*` variant: per the spec, `platform` is an OBJECT
        // `{ name, status, platformPostId, publishedUrl, error }` naming the
        // single platform that transitioned, and `account` is
        // `{ accountId, platform, username }`. The `post.platforms[]` array is
        // ALSO present on these events, but the top-level block is the
        // authoritative terminal transition — so it is normalized and put
        // FIRST, winning the per-row `find()` below over the array snapshot.
        // A plain-string `platform` is tolerated defensively.
        let topLevelEntry: ZernioWebhookPlatformEntry | null = null;
        const rawPlatform = body.platform;
        const rawAccount = body.account as Record<string, any> | undefined;
        const topLevelAccountId =
            rawAccount && typeof rawAccount === "object"
                ? (rawAccount.accountId ?? rawAccount._id ?? rawAccount)
                : rawAccount;
        if (rawPlatform && typeof rawPlatform === "object" && typeof rawPlatform.name === "string") {
            topLevelEntry = {
                platform: rawPlatform.name,
                accountId: topLevelAccountId,
                status: typeof rawPlatform.status === "string" ? rawPlatform.status : undefined,
                platformPostId:
                    typeof rawPlatform.platformPostId === "string" ? rawPlatform.platformPostId : undefined,
                publishedUrl: typeof rawPlatform.publishedUrl === "string" ? rawPlatform.publishedUrl : undefined,
                error: typeof rawPlatform.error === "string" ? rawPlatform.error : undefined,
            };
        } else if (typeof rawPlatform === "string") {
            topLevelEntry = {
                platform: rawPlatform,
                accountId: topLevelAccountId,
                status: typeof post?.status === "string" ? post.status : undefined,
                platformPostId: typeof body.platformPostId === "string" ? body.platformPostId : undefined,
                publishedUrl: typeof body.publishedUrl === "string" ? body.publishedUrl : undefined,
                error: typeof body.error === "string" ? body.error : undefined,
            };
        }
        const effectiveEntries = topLevelEntry ? [topLevelEntry, ...entries] : entries;

        const accountsById = await loadAccountZernioIds(sb, rows as PostPublication[]);

        for (const row of rows as PostPublication[]) {
            const accountZernioId = row.social_account_id ? accountsById.get(row.social_account_id) : undefined;
            const entry = effectiveEntries.find(
                (e) => e.platform === row.platform && (!accountZernioId || zernioAccountIdOf(e.accountId) === accountZernioId),
            );

            await updatePublicationRow(
                sb,
                row,
                entry
                    ? {
                          status: entry.status,
                          platformPostId: entry.platformPostId ?? null,
                          platformPostUrl: entry.publishedUrl ?? null,
                          error: entry.error ?? null,
                      }
                    : undefined,
                typeof post?.status === "string" ? post.status : undefined,
                // A webhook delivery is a push, not a poll — it must not
                // consume refresh_attempts budget (see updatePublicationRow's
                // doc comment).
                { countsAsRefreshAttempt: false },
            );
        }
    } catch (err) {
        // Never throw — an unrecognized/malformed payload must still 200 so
        // Zernio doesn't disable the webhook after repeated failures.
        console.error("[social-publish] applyWebhookEvent failed:", err instanceof Error ? err.message : err);
        captureException(err, { job: "apply_webhook_event" });
    }
}
