/**
 * Zernio unified social publishing API client.
 *
 * Thin typed wrapper over global `fetch` — no new npm dependency. Every
 * exported helper maps 1:1 to an endpoint documented in
 * docs/zernio-social-publishing.md ("Zernio API surface used"), which is
 * itself sourced from the official OpenAPI spec (`zernio-dev/zernio-python`,
 * `openapi.yaml` v1.0.4).
 *
 * Auth is always `Authorization: Bearer <api_key>` — callers resolve which
 * key (BYOK vs platform-global) via
 * server/services/zernio-credentials.service.ts and pass it in explicitly;
 * this module has no notion of "whose" key it is holding.
 */

/** Base URL for all Zernio REST calls — endpoints below are `${ZERNIO_API_BASE}/v1/...`. */
export const ZERNIO_API_BASE = "https://zernio.com/api";

/** Default request timeout for a single Zernio call. */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Raised for any non-2xx Zernio response. `status` is the HTTP status code;
 * `code`/`details` are best-effort extractions from the JSON error body
 * (Zernio's shape varies by endpoint, so both are optional).
 */
export class ZernioApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;

    constructor(status: number, message: string, code?: string, details?: unknown) {
        super(message);
        this.name = "ZernioApiError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export interface ZernioFetchOptions {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    /** Defaults to 30s. */
    timeoutMs?: number;
}

/** Best-effort JSON parse — tolerates an empty body (e.g. 204 responses). */
async function parseJsonBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function errorMessageFrom(body: unknown, fallback: string): string {
    if (body && typeof body === "object") {
        const anyBody = body as Record<string, unknown>;
        const message = anyBody.message ?? anyBody.error;
        if (typeof message === "string" && message.trim()) return message;
    }
    if (typeof body === "string" && body.trim()) return body;
    return fallback;
}

function errorCodeFrom(body: unknown): string | undefined {
    if (body && typeof body === "object") {
        const code = (body as Record<string, unknown>).code;
        if (typeof code === "string") return code;
    }
    return undefined;
}

/**
 * Core request helper: JSON in, JSON out, AbortController timeout, and a
 * typed `ZernioApiError` on any non-2xx response.
 */
export async function zernioFetch<T>(
    apiKey: string,
    path: string,
    opts: ZernioFetchOptions = {},
): Promise<T> {
    const { method = "GET", body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
        res = await fetch(`${ZERNIO_API_BASE}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                ...headers,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            throw new ZernioApiError(408, `Zernio request timed out after ${timeoutMs}ms`);
        }
        throw new ZernioApiError(
            0,
            `Zernio request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    } finally {
        clearTimeout(timeout);
    }

    const parsed = await parseJsonBody(res);

    if (!res.ok) {
        throw new ZernioApiError(
            res.status,
            errorMessageFrom(parsed, `Zernio request failed with status ${res.status}`),
            errorCodeFrom(parsed),
            parsed,
        );
    }

    return parsed as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface ZernioVerifyResult {
    valid: boolean;
    userId?: string;
}

/** Validate an API key. Returns `{valid:false}` on 401 rather than throwing. */
export async function verifyZernioKey(apiKey: string): Promise<ZernioVerifyResult> {
    try {
        return await zernioFetch<ZernioVerifyResult>(apiKey, "/v1/auth/verify");
    } catch (err) {
        if (err instanceof ZernioApiError && err.status === 401) {
            return { valid: false };
        }
        throw err;
    }
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export interface ZernioProfile {
    _id: string;
    name: string;
    isDefault?: boolean;
}

export interface ZernioListProfilesResponse {
    profiles: ZernioProfile[];
}

export async function listZernioProfiles(apiKey: string): Promise<ZernioListProfilesResponse> {
    return zernioFetch<ZernioListProfilesResponse>(apiKey, "/v1/profiles");
}

export interface ZernioCreateProfileResult {
    profileId: string;
}

/**
 * Create a Zernio profile. Idempotent: a 409 (name already exists) is treated
 * as success — the existing profile id is read from `details.existingProfileId`
 * and returned rather than thrown.
 */
export async function createZernioProfile(
    apiKey: string,
    name: string,
    description?: string,
): Promise<ZernioCreateProfileResult> {
    try {
        const result = await zernioFetch<{ _id: string }>(apiKey, "/v1/profiles", {
            method: "POST",
            body: { name, description },
        });
        return { profileId: result._id };
    } catch (err) {
        if (err instanceof ZernioApiError && err.status === 409) {
            const details = err.details as { existingProfileId?: string } | undefined;
            if (details?.existingProfileId) {
                return { profileId: details.existingProfileId };
            }
        }
        throw err;
    }
}

// ── Connect ───────────────────────────────────────────────────────────────────

export interface ZernioConnectUrlResponse {
    authUrl: string;
}

/**
 * Get the Zernio-hosted OAuth connect URL for a platform. Zernio redirects
 * back to `redirectUrl?connected={platform}&profileId&accountId&username`
 * once the user finishes the flow.
 */
export async function getZernioConnectUrl(
    apiKey: string,
    platform: string,
    profileId: string,
    redirectUrl: string,
): Promise<ZernioConnectUrlResponse> {
    const query = `profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`;
    return zernioFetch<ZernioConnectUrlResponse>(apiKey, `/v1/connect/${platform}?${query}`);
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export interface ZernioAccount {
    _id: string;
    platform: string;
    username?: string;
    displayName?: string;
    profilePicture?: string;
    avatarUrl?: string;
    isActive?: boolean;
    profileId?: string;
}

export interface ZernioListAccountsResponse {
    accounts: ZernioAccount[];
}

export async function listZernioAccounts(
    apiKey: string,
    profileId?: string,
): Promise<ZernioListAccountsResponse> {
    const path = profileId
        ? `/v1/accounts?profileId=${encodeURIComponent(profileId)}`
        : "/v1/accounts";
    const result = await zernioFetch<ZernioListAccountsResponse>(apiKey, path);

    // Defensive: filter client-side too, in case the server-side ?profileId
    // filter is ignored for a given account row (only rows that actually carry
    // a profileId are checked — rows without one pass through untouched).
    if (!profileId) return result;
    return {
        accounts: result.accounts.filter((a) => a.profileId == null || a.profileId === profileId),
    };
}

export async function deleteZernioAccount(apiKey: string, accountId: string): Promise<void> {
    await zernioFetch<unknown>(apiKey, `/v1/accounts/${accountId}`, { method: "DELETE" });
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export interface ZernioMediaItem {
    type: "image" | "video";
    url: string;
}

export interface ZernioPlatformTarget {
    platform: string;
    accountId: string;
    platformSpecificData?: Record<string, unknown>;
}

export interface ZernioCreatePostPayload {
    content?: string;
    mediaItems?: ZernioMediaItem[];
    platforms: ZernioPlatformTarget[];
    publishNow?: boolean;
    scheduledFor?: string;
    timezone?: string;
    metadata?: Record<string, unknown>;
}

export interface ZernioPostPlatformResult {
    platform: string;
    status?: string;
    accountId?: unknown;
    platformPostId?: string;
    platformPostUrl?: string;
    error?: string;
}

export interface ZernioPost {
    _id: string;
    status?: string;
    platforms?: ZernioPostPlatformResult[];
}

export interface ZernioCreatePostResponse {
    post?: ZernioPost;
    existingPost?: unknown;
}

/**
 * Normalize a Zernio `accountId` field, which comes back as either a plain
 * string or an expanded object (`{ _id: "..." }`) depending on endpoint.
 */
export function zernioAccountIdOf(v: unknown): string | null {
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && typeof (v as Record<string, unknown>)._id === "string") {
        return (v as Record<string, unknown>)._id as string;
    }
    return null;
}

/** Create (publish or schedule) a post. `requestId` is sent as `x-request-id` for idempotency. */
export async function createZernioPost(
    apiKey: string,
    payload: ZernioCreatePostPayload,
    requestId: string,
): Promise<ZernioCreatePostResponse> {
    return zernioFetch<ZernioCreatePostResponse>(apiKey, "/v1/posts", {
        method: "POST",
        body: payload,
        headers: { "x-request-id": requestId },
    });
}

export async function getZernioPost(apiKey: string, postId: string): Promise<ZernioCreatePostResponse> {
    return zernioFetch<ZernioCreatePostResponse>(apiKey, `/v1/posts/${postId}`);
}

export async function retryZernioPost(apiKey: string, postId: string): Promise<ZernioCreatePostResponse> {
    return zernioFetch<ZernioCreatePostResponse>(apiKey, `/v1/posts/${postId}/retry`, {
        method: "POST",
    });
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

export interface ZernioWebhook {
    _id: string;
    name: string;
    url: string;
    events: string[];
    isActive?: boolean;
}

export interface ZernioListWebhooksResponse {
    webhooks: ZernioWebhook[];
}

export async function listZernioWebhooks(apiKey: string): Promise<ZernioListWebhooksResponse> {
    return zernioFetch<ZernioListWebhooksResponse>(apiKey, "/v1/webhooks/settings");
}

export interface ZernioCreateWebhookInput {
    name: string;
    url: string;
    secret: string;
    events: string[];
}

export async function createZernioWebhook(
    apiKey: string,
    input: ZernioCreateWebhookInput,
): Promise<ZernioWebhook> {
    return zernioFetch<ZernioWebhook>(apiKey, "/v1/webhooks/settings", {
        method: "POST",
        body: input,
    });
}
