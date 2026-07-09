/**
 * Zernio Integration Service
 *
 * Thin wrapper over the Zernio social-publishing API (https://zernio.com/api/v1).
 * Zernio is the publishing engine for the FB/IG Publishing & Scheduling feature:
 * OAuth-as-a-service (hosted consent), multi-platform publish, scheduling, and
 * webhooks. All calls are server-to-server; the key never reaches the browser.
 *
 * Key resolution (BYOK vs platform) lives in auth.middleware.ts#resolveZernioKey.
 * This module only takes a resolved key + does HTTP.
 *
 * NOTE: docs.zernio.com is currently blocked by the environment egress policy,
 * so response shapes marked `TODO(doc)` are best-effort and must be confirmed
 * against the live docs / a sandbox before P003 (OAuth) and P007 (webhooks).
 * Mirrors the ghl.ts client shape (timeout + retry + mask + testConnection).
 */

const ZERNIO_API_BASE = "https://zernio.com/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000;

export type ZernioPlatform = "facebook" | "instagram";

/**
 * Result of a Zernio connection test.
 */
export interface ZernioTestResult {
    success: boolean;
    error?: string;
}

/**
 * A connected social account as returned by Zernio (GET /accounts).
 * TODO(doc): confirm exact field names against the live docs.
 */
export interface ZernioAccount {
    id: string;
    platform: ZernioPlatform | string;
    name?: string | null;
    avatarUrl?: string | null;
    profileId?: string | null;
}

/**
 * A post as returned by Zernio (POST /posts, GET /posts/:id).
 * TODO(doc): confirm exact field names.
 */
export interface ZernioPost {
    id: string;
    status?: string;
    scheduledFor?: string | null;
    [key: string]: unknown;
}

/**
 * Target for a publish/schedule request: which connected account on which platform.
 */
export interface ZernioPostTarget {
    platform: ZernioPlatform;
    accountId: string;
}

export interface CreateZernioPostInput {
    content: string;
    platforms: ZernioPostTarget[];
    /** Zernio media ids from uploadMedia(), in order. */
    mediaIds?: string[];
    /** When set, Zernio schedules the post; otherwise publishNow controls timing. */
    scheduledFor?: string;
    timezone?: string;
    publishNow?: boolean;
}

/**
 * Mask a Zernio API key for display (same shape as maskGHLApiKey).
 */
export function maskZernioApiKey(apiKey: string | null | undefined): string | null {
    if (!apiKey) return null;
    if (apiKey.length < 12) return "********";
    return `${apiKey.substring(0, 4)}${"*".repeat(8)}${apiKey.substring(apiKey.length - 4)}`;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

/**
 * Make an authenticated request to the Zernio API with timeout + retry.
 * Bearer auth: `Authorization: Bearer <apiKey>`.
 */
async function zernioRequest<T>(
    apiKey: string,
    method: string,
    path: string,
    body?: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null; status: number }> {
    const url = `${ZERNIO_API_BASE}${path}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            await delay(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            clearTimeout(timeout);

            const responseText = await response.text();
            let data: T | null = null;
            if (responseText) {
                try {
                    data = JSON.parse(responseText) as T;
                } catch {
                    // Response wasn't JSON
                }
            }

            if (!response.ok) {
                const errorMessage =
                    ((data as Record<string, unknown> | null)?.message as string) ||
                    ((data as Record<string, unknown> | null)?.error as string) ||
                    response.statusText ||
                    "Unknown error";

                if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
                    continue;
                }
                return { data: null, error: errorMessage, status: response.status };
            }

            return { data, error: null, status: response.status };
        } catch (err) {
            clearTimeout(timeout);

            const isTimeout = err instanceof Error && err.name === "AbortError";
            const errorMessage = isTimeout
                ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
                : err instanceof Error
                    ? err.message
                    : "Network error";

            if (attempt < MAX_RETRIES) {
                continue;
            }
            return { data: null, error: errorMessage, status: 0 };
        }
    }

    return { data: null, error: "Max retries exceeded", status: 0 };
}

/**
 * Test a Zernio API key by listing profiles (lightweight authenticated call).
 * TODO(doc): confirm the cheapest always-available authenticated endpoint.
 */
export async function testZernioConnection(apiKey: string): Promise<ZernioTestResult> {
    const result = await zernioRequest<unknown>(apiKey, "GET", "/profiles");
    if (result.error) {
        return { success: false, error: result.error };
    }
    return { success: true };
}

/**
 * Create a Zernio Profile (one per Xareable user). Returns the profile id.
 * POST /v1/profiles { name }
 * TODO(doc): confirm the id field name in the response.
 */
export async function createZernioProfile(
    apiKey: string,
    name: string,
): Promise<{ profileId: string | null; error: string | null }> {
    const result = await zernioRequest<{ id?: string; profileId?: string }>(
        apiKey,
        "POST",
        "/profiles",
        { name },
    );
    if (result.error) {
        return { profileId: null, error: result.error };
    }
    const profileId = result.data?.id || result.data?.profileId || null;
    return { profileId, error: null };
}

/**
 * Request a hosted-OAuth URL for connecting a platform under a profile.
 * GET /v1/connect/{platform}?profileId=&redirectUrl=
 * The backend hands the returned URL to the frontend, which redirects the user.
 * TODO(doc): confirm whether this returns { url } JSON or a 302 redirect.
 */
export async function getZernioConnectUrl(
    apiKey: string,
    platform: ZernioPlatform,
    profileId: string,
    redirectUrl: string,
): Promise<{ url: string | null; error: string | null }> {
    const qs = new URLSearchParams({ profileId, redirectUrl }).toString();
    const result = await zernioRequest<{ url?: string; connectUrl?: string }>(
        apiKey,
        "GET",
        `/connect/${platform}?${qs}`,
    );
    if (result.error) {
        return { url: null, error: result.error };
    }
    const url = result.data?.url || result.data?.connectUrl || null;
    return { url, error: null };
}

/**
 * List the connected accounts under a profile. GET /v1/accounts?profileId=
 * TODO(doc): confirm the array wrapper + field names.
 */
export async function listZernioAccounts(
    apiKey: string,
    profileId: string,
): Promise<{ accounts: ZernioAccount[]; error: string | null }> {
    const qs = new URLSearchParams({ profileId }).toString();
    const result = await zernioRequest<{ accounts?: ZernioAccount[] } | ZernioAccount[]>(
        apiKey,
        "GET",
        `/accounts?${qs}`,
    );
    if (result.error) {
        return { accounts: [], error: result.error };
    }
    const raw = Array.isArray(result.data)
        ? result.data
        : result.data?.accounts ?? [];
    return { accounts: raw, error: null };
}

/**
 * Upload media (by public URL or raw bytes). POST /v1/media → media id.
 * TODO(doc): confirm URL-ingestion support vs multipart byte upload.
 */
export async function uploadZernioMedia(
    apiKey: string,
    mediaUrl: string,
): Promise<{ mediaId: string | null; error: string | null }> {
    const result = await zernioRequest<{ id?: string; mediaId?: string }>(
        apiKey,
        "POST",
        "/media",
        { url: mediaUrl },
    );
    if (result.error) {
        return { mediaId: null, error: result.error };
    }
    const mediaId = result.data?.id || result.data?.mediaId || null;
    return { mediaId, error: null };
}

/**
 * Create/schedule a post. POST /v1/posts
 * TODO(doc): confirm the platforms/media payload shape.
 */
export async function createZernioPost(
    apiKey: string,
    input: CreateZernioPostInput,
): Promise<{ post: ZernioPost | null; error: string | null }> {
    const body: Record<string, unknown> = {
        content: input.content,
        platforms: input.platforms.map((t) => ({ platform: t.platform, accountId: t.accountId })),
    };
    if (input.mediaIds?.length) body.media = input.mediaIds;
    if (input.scheduledFor) {
        body.scheduledFor = input.scheduledFor;
        if (input.timezone) body.timezone = input.timezone;
    } else {
        body.publishNow = input.publishNow ?? true;
    }

    const result = await zernioRequest<ZernioPost>(apiKey, "POST", "/posts", body);
    if (result.error) {
        return { post: null, error: result.error };
    }
    return { post: result.data, error: null };
}

/**
 * Fetch a post's current state. GET /v1/posts/:id
 */
export async function getZernioPost(
    apiKey: string,
    postId: string,
): Promise<{ post: ZernioPost | null; error: string | null }> {
    const result = await zernioRequest<ZernioPost>(apiKey, "GET", `/posts/${postId}`);
    if (result.error) {
        return { post: null, error: result.error };
    }
    return { post: result.data, error: null };
}

/**
 * Delete/cancel a post. DELETE /v1/posts/:id
 */
export async function deleteZernioPost(
    apiKey: string,
    postId: string,
): Promise<{ success: boolean; error: string | null }> {
    const result = await zernioRequest<unknown>(apiKey, "DELETE", `/posts/${postId}`);
    if (result.error) {
        return { success: false, error: result.error };
    }
    return { success: true, error: null };
}

export const zernioService = {
    testConnection: testZernioConnection,
    createProfile: createZernioProfile,
    getConnectUrl: getZernioConnectUrl,
    listAccounts: listZernioAccounts,
    uploadMedia: uploadZernioMedia,
    createPost: createZernioPost,
    getPost: getZernioPost,
    deletePost: deleteZernioPost,
    maskApiKey: maskZernioApiKey,
};

export default zernioService;
