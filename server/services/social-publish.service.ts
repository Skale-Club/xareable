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
    platform: string;
    account?: unknown;
    platformPostId?: string;
    publishedUrl?: string;
    error?: string;
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

type PublicationStatus = "pending" | "scheduled" | "published" | "failed";

/** Normalize a Zernio (platform- or post-level) status string to our enum. `draft` is a post-level-only value. */
function mapKnownStatus(status: string | undefined): PublicationStatus | null {
    switch (status) {
        case "published":
            return "published";
        case "failed":
            return "failed";
        case "scheduled":
            return "scheduled";
        case "pending":
        case "publishing":
            return "pending";
        case "draft":
            return "pending";
        default:
            return null;
    }
}

function resolveRowStatus(
    currentStatus: PublicationStatus,
    platformStatus: string | undefined,
    postLevelStatus: string | undefined,
): PublicationStatus {
    return mapKnownStatus(platformStatus) ?? mapKnownStatus(postLevelStatus) ?? currentStatus;
}

function initialStatusFromZernio(platformStatus: string | undefined, postLevelStatus: string | undefined): PublicationStatus {
    return mapKnownStatus(platformStatus) ?? mapKnownStatus(postLevelStatus) ?? "pending";
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

    const { data: accounts, error: accountsError } = await sb
        .from("social_accounts")
        .select("id, zernio_account_id, platform")
        .in("id", req.account_ids)
        .eq("user_id", userId)
        .eq("is_active", true);
    if (accountsError) throw new Error(`publishPost(${req.post_id}) [load accounts]: ${accountsError.message}`);

    const foundIds = new Set((accounts || []).map((a) => a.id as string));
    const missingIds = req.account_ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new ValidationError(
            "One or more selected accounts are invalid, inactive, or don't belong to you",
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
            error_message: platformEntry?.error ?? null,
            scheduled_for: req.scheduled_for ?? null,
            published_at: status === "published" ? new Date().toISOString() : null,
        };
    });

    const { data: inserted, error: insertError } = await sb
        .from("post_publications")
        .insert(rowsToInsert)
        .select("*");
    if (insertError) throw new Error(`publishPost(${req.post_id}) [insert publications]: ${insertError.message}`);

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

async function updatePublicationRow(
    sb: SupabaseClient,
    row: PostPublication,
    match: NormalizedPlatformMatch | undefined,
    postLevelStatus: string | undefined,
): Promise<void> {
    const nextStatus = resolveRowStatus(row.status as PublicationStatus, match?.status, postLevelStatus);

    const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        status: nextStatus,
    };
    if (match) {
        update.platform_post_id = match.platformPostId ?? row.platform_post_id ?? null;
        update.platform_post_url = match.platformPostUrl ?? row.platform_post_url ?? null;
        update.error_message = match.error ?? null;
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
    for (const row of rows) {
        if (!row.zernio_post_id) continue;
        const key = `${row.user_id} ${row.zernio_post_id}`;
        const list = groups.get(key);
        if (list) list.push(row);
        else groups.set(key, [row]);
    }

    for (const [key, groupRows] of Array.from(groups.entries())) {
        const [userId, zernioPostId] = key.split(" ");
        try {
            const credentials = await resolveZernioCredentials(userId);
            if (!credentials) {
                console.warn(
                    `[social-publish] refreshPublications: no credentials for user=${userId}; skipping zernio_post_id=${zernioPostId}`,
                );
                continue;
            }

            const { post: zernioPost } = await getZernioPost(credentials.apiKey, zernioPostId);
            if (!zernioPost) continue;

            const accountsById = await loadAccountZernioIds(sb, groupRows);

            for (const row of groupRows) {
                const accountZernioId = row.social_account_id ? accountsById.get(row.social_account_id) : undefined;
                const platformEntry = zernioPost.platforms?.find(
                    (p) =>
                        p.platform === row.platform &&
                        (!accountZernioId || zernioAccountIdOf(p.accountId) === accountZernioId),
                );

                await updatePublicationRow(
                    sb,
                    row,
                    platformEntry
                        ? {
                              status: platformEntry.status,
                              platformPostId: platformEntry.platformPostId ?? null,
                              platformPostUrl: platformEntry.platformPostUrl ?? null,
                              error: platformEntry.error ?? null,
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
        }
    }
}

/**
 * Cron sweep (every 15 min): refresh post_publications stuck in pending/scheduled
 * that are recent enough to matter and haven't been touched in the last minute.
 * Webhooks are the primary status path; this is the safety net.
 */
export async function runPublicationStatusSweep(): Promise<number> {
    const sb = createAdminSupabase();
    const cutoffCreated = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const cutoffUpdated = new Date(Date.now() - 60_000).toISOString();

    const { data: rows, error } = await sb
        .from("post_publications")
        .select("*")
        .in("status", ["pending", "scheduled"])
        .gt("created_at", cutoffCreated)
        .lt("updated_at", cutoffUpdated)
        .limit(50);

    if (error) throw error;
    if (!rows || rows.length === 0) return 0;

    await refreshPublications(rows as PostPublication[]);
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

        // `post.platform.*` variant: no platforms[] array, just top-level
        // platform/account/etc. describing the single platform this event concerns.
        const topLevelEntry: ZernioWebhookPlatformEntry | null =
            entries.length === 0 && typeof body.platform === "string"
                ? {
                      platform: body.platform,
                      accountId: body.account,
                      status: typeof post?.status === "string" ? post.status : undefined,
                      platformPostId: typeof body.platformPostId === "string" ? body.platformPostId : undefined,
                      publishedUrl: typeof body.publishedUrl === "string" ? body.publishedUrl : undefined,
                      error: typeof body.error === "string" ? body.error : undefined,
                  }
                : null;
        const effectiveEntries = entries.length > 0 ? entries : topLevelEntry ? [topLevelEntry] : [];

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
            );
        }
    } catch (err) {
        // Never throw — an unrecognized/malformed payload must still 200 so
        // Zernio doesn't disable the webhook after repeated failures.
        console.error("[social-publish] applyWebhookEvent failed:", err instanceof Error ? err.message : err);
        captureException(err, { job: "apply_webhook_event" });
    }
}
