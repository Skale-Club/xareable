/**
 * GoHighLevel (GHL) Integration Service
 * 
 * Provides API wrapper methods for interacting with GHL's REST API.
 * Handles contact sync, custom fields, and connection testing.
 */

import type { GHLContactPayload, GHLCustomField, GHLContactResponse } from "../../shared/schema.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000;

/**
 * GHL API client configuration
 */
export interface GHLConfig {
    apiKey: string;
    locationId: string;
}

/**
 * Result of a contact sync operation
 */
export interface GHLContactSyncResult {
    success: boolean;
    contactId?: string;
    error?: string;
    created: boolean; // true if created, false if updated
}

/**
 * Result of a connection test
 */
export interface GHLTestResult {
    success: boolean;
    error?: string;
    locationName?: string;
}

/**
 * Mask an API key for display
 */
export function maskGHLApiKey(apiKey: string | null | undefined): string | null {
    if (!apiKey) return null;
    if (apiKey.length < 12) return "********";
    return `${apiKey.substring(0, 4)}${"*".repeat(8)}${apiKey.substring(apiKey.length - 4)}`;
}

function coerceString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeGHLCustomField(raw: unknown): GHLCustomField | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Record<string, unknown>;
    const id = coerceString(candidate.id)
        || coerceString(candidate._id)
        || coerceString(candidate.customFieldId)
        || coerceString(candidate.fieldId)
        || coerceString(candidate.fieldKey)
        || coerceString(candidate.key);
    const key = coerceString(candidate.key)
        || coerceString(candidate.fieldKey)
        || coerceString(candidate.slug)
        || id;
    const name = coerceString(candidate.name)
        || coerceString(candidate.label)
        || coerceString(candidate.title)
        || key
        || id;
    const type = coerceString(candidate.type)
        || coerceString(candidate.dataType)
        || coerceString(candidate.fieldType)
        || undefined;
    if (!id || !key || !name) {
        return null;
    }
    return {
        id,
        key,
        name,
        type,
    };
}

function extractCustomFieldArray(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const obj = payload as Record<string, unknown>;
    const listCandidates = [
        obj.customFields,
        obj.fields,
        obj.contactFields,
        obj.items,
        obj.data,
    ];
    for (const candidate of listCandidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }
    return [];
}
/**
 * Delay helper for retry backoff
 */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether an HTTP status is retryable (server error or rate limit)
 */
function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

/**
 * Make an authenticated request to the GHL API with timeout and retry
 */
async function ghlRequest<T>(
    config: GHLConfig,
    method: string,
    path: string,
    body?: Record<string, unknown>
): Promise<{ data: T | null; error: string | null; status: number }> {
    const url = `${GHL_API_BASE}${path}`;

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
                    "Authorization": `Bearer ${config.apiKey}`,
                    "Content-Type": "application/json",
                    "Version": GHL_API_VERSION,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            clearTimeout(timeout);

            const responseText = await response.text();
            let data: T | null = null;

            if (responseText) {
                try {
                    data = JSON.parse(responseText);
                } catch {
                    // Response wasn't JSON
                }
            }

            if (!response.ok) {
                const errorMessage = (data as Record<string, unknown>)?.message as string || response.statusText || "Unknown error";

                // Retry on server errors / rate limiting, but not on 4xx client errors
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
                : (err instanceof Error ? err.message : "Network error");

            // Retry on timeout or network errors
            if (attempt < MAX_RETRIES) {
                continue;
            }

            return { data: null, error: errorMessage, status: 0 };
        }
    }

    return { data: null, error: "Max retries exceeded", status: 0 };
}

/**
 * Test the GHL API connection by fetching location info
 */
export async function testGHLConnection(config: GHLConfig): Promise<GHLTestResult> {
    // Try to fetch contacts with a limit of 1 to verify credentials
    const result = await ghlRequest<{ contacts?: unknown[] }>(
        config,
        "GET",
        `/contacts/?locationId=${config.locationId}&limit=1`
    );

    if (result.error) {
        return { success: false, error: result.error };
    }

    return { success: true };
}

/**
 * Get all custom fields available in the GHL location
 */
export async function getGHLCustomFields(config: GHLConfig): Promise<{
    fields: GHLCustomField[];
    error: string | null;
}> {
    // Try multiple GHL API endpoints (API versions vary)
    const endpoints = [
        `/locations/${config.locationId}/customFields`,  // v2 style
        `/customFields?locationId=${config.locationId}`,  // v1 style with query param
        `/customFields/?locationId=${config.locationId}`, // v1 style with trailing slash
    ];

    let lastError = "Failed to fetch custom fields from all known endpoints";

    for (const endpoint of endpoints) {
        const result = await ghlRequest<unknown>(
            config,
            "GET",
            endpoint
        );

        // If successful (non-404), process the response
        if (!result.error || result.status !== 404) {
            if (result.error) {
                lastError = result.error;
                continue;
            }

            const rawFields = extractCustomFieldArray(result.data);
            const normalized = rawFields
                .map(normalizeGHLCustomField)
                .filter((field): field is GHLCustomField => Boolean(field));

            // Keep only one entry per key and make UI ordering deterministic.
            const dedupedByKey = new Map<string, GHLCustomField>();
            for (const field of normalized) {
                dedupedByKey.set(field.key, field);
            }
            const fields = Array.from(dedupedByKey.values())
                .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

            return { fields, error: null };
        }

        lastError = result.error || "Not found";
    }

    return { fields: [], error: lastError };
}

/**
 * Search for a contact by email address
 */
export async function searchGHLContactByEmail(
    config: GHLConfig,
    email: string
): Promise<{ contactId: string | null; error: string | null }> {
    const result = await ghlRequest<{ contacts: { id: string }[] }>(
        config,
        "GET",
        `/contacts/search?locationId=${config.locationId}&email=${encodeURIComponent(email)}`
    );

    if (result.error) {
        return { contactId: null, error: result.error };
    }

    const contactId = result.data?.contacts?.[0]?.id || null;
    return { contactId, error: null };
}

/**
 * Search for a contact by phone number
 */
export async function searchGHLContactByPhone(
    config: GHLConfig,
    phone: string
): Promise<{ contactId: string | null; error: string | null }> {
    const result = await ghlRequest<{ contacts: { id: string }[] }>(
        config,
        "GET",
        `/contacts/search?locationId=${config.locationId}&phone=${encodeURIComponent(phone)}`
    );

    if (result.error) {
        return { contactId: null, error: result.error };
    }

    const contactId = result.data?.contacts?.[0]?.id || null;
    return { contactId, error: null };
}

/**
 * Create a new contact in GHL
 */
export async function createGHLContact(
    config: GHLConfig,
    payload: GHLContactPayload
): Promise<GHLContactSyncResult> {
    const body = {
        locationId: config.locationId,
        ...payload,
        source: payload.source || "My Social Autopilot",
    };

    const result = await ghlRequest<GHLContactResponse>(
        config,
        "POST",
        "/contacts/",
        body as Record<string, unknown>
    );

    if (result.error) {
        return { success: false, error: result.error, created: false };
    }

    return {
        success: true,
        contactId: result.data?.contact?.id,
        created: true,
    };
}

/**
 * Update an existing contact in GHL
 */
export async function updateGHLContact(
    config: GHLConfig,
    contactId: string,
    payload: Partial<GHLContactPayload>
): Promise<GHLContactSyncResult> {
    const result = await ghlRequest<GHLContactResponse>(
        config,
        "PUT",
        `/contacts/${contactId}`,
        payload as Record<string, unknown>
    );

    if (result.error) {
        return { success: false, error: result.error, created: false };
    }

    return {
        success: true,
        contactId: result.data?.contact?.id || contactId,
        created: false,
    };
}

/**
 * Get or create a contact in GHL
 * 
 * Strategy:
 * 1. Search by email (if provided)
 * 2. Search by phone (if provided and no email match)
 * 3. Create new contact (if no match found)
 */
export async function getOrCreateGHLContact(
    config: GHLConfig,
    payload: GHLContactPayload
): Promise<GHLContactSyncResult> {
    let existingContactId: string | null = null;

    // Step 1: Search by email
    if (payload.email) {
        const emailResult = await searchGHLContactByEmail(config, payload.email);
        if (emailResult.error) {
            return { success: false, error: emailResult.error, created: false };
        }
        existingContactId = emailResult.contactId;
    }

    // Step 2: Search by phone if no email match
    if (!existingContactId && payload.phone) {
        const phoneResult = await searchGHLContactByPhone(config, payload.phone);
        if (phoneResult.error) {
            return { success: false, error: phoneResult.error, created: false };
        }
        existingContactId = phoneResult.contactId;
    }

    // Step 3: Update existing or create new
    if (existingContactId) {
        return updateGHLContact(config, existingContactId, payload);
    } else {
        return createGHLContact(config, payload);
    }
}

/**
 * Build a GHL contact payload from form answers
 * 
 * @param answers - Record of field ID to answer value
 * @param fieldMappings - Mapping of field ID to GHL field key
 * @param defaultValues - Optional default values for standard fields
 */
export function buildGHLContactPayload(
    answers: Record<string, string>,
    fieldMappings: Record<string, string>,
    defaultValues?: {
        email?: string;
        phone?: string;
        firstName?: string;
        lastName?: string;
        name?: string;
    }
): GHLContactPayload {
    const customFields: Record<string, string> = {};

    // Map answers to custom fields based on field mappings
    for (const [fieldId, answer] of Object.entries(answers)) {
        const ghlFieldKey = fieldMappings[fieldId];
        if (ghlFieldKey && answer) {
            customFields[ghlFieldKey] = answer;
        }
    }

    return {
        email: defaultValues?.email,
        phone: defaultValues?.phone,
        firstName: defaultValues?.firstName,
        lastName: defaultValues?.lastName,
        name: defaultValues?.name,
        customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
        source: "My Social Autopilot",
    };
}

// Export all functions as a service object for convenience
export const ghlService = {
    testConnection: testGHLConnection,
    getCustomFields: getGHLCustomFields,
    getOrCreateContact: getOrCreateGHLContact,
    searchByEmail: searchGHLContactByEmail,
    searchByPhone: searchGHLContactByPhone,
    createContact: createGHLContact,
    updateContact: updateGHLContact,
    buildContactPayload: buildGHLContactPayload,
    maskApiKey: maskGHLApiKey,
};

export default ghlService;
