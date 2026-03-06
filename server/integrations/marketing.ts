import { createHash, randomUUID } from "crypto";
import { createAdminSupabase } from "../supabase.js";

const REQUEST_TIMEOUT_MS = 15_000;

export type MarketingDeliveryStatus = "queued" | "sent" | "failed" | "skipped";

/**
 * Standard marketing event names following Facebook Conversions API conventions
 */
export type MarketingEventName =
  | "PageView"
  | "ViewContent"
  | "Lead"
  | "CompleteRegistration"
  | "Purchase"
  | "Subscribe"
  | "AddToCart"
  | "InitiateCheckout"
  | "Search"
  | "generate"
  | "edit"
  | "transcribe"
  | "signup";

/**
 * Extended user data for better Facebook Conversions API matching
 * All personally identifiable information will be SHA256 hashed before sending
 */
export interface MarketingUserData {
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zip?: string | null;
  external_id?: string | null;
  fbc?: string | null;  // Facebook Click ID (fb.clickID)
  fbp?: string | null;  // Facebook Browser ID (fbp cookie)
}

export interface TrackMarketingEventInput {
  event_name: string;
  event_key?: string | null;
  event_source?: string;
  user_id?: string | null;
  email?: string | null;
  /** Extended user data for better matching */
  user_data?: MarketingUserData;
  event_payload?: Record<string, unknown>;
  event_source_url?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  send_only?: "ga4" | "facebook_dataset";
  /** Currency for Purchase events (ISO 3-letter code) */
  currency?: string | null;
  /** Value for Purchase events */
  value?: number | null;
}

export interface TrackMarketingEventResult {
  id: string | null;
  duplicate: boolean;
  ga4_status: MarketingDeliveryStatus;
  facebook_status: MarketingDeliveryStatus;
}

interface Ga4Config {
  enabled: boolean;
  measurement_id: string | null;
  api_secret: string | null;
}

interface FacebookDatasetConfig {
  enabled: boolean;
  dataset_id: string | null;
  access_token: string | null;
  test_event_code: string | null;
}

function safeString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function parseGa4Config(raw: any): Ga4Config {
  return {
    enabled: Boolean(raw?.enabled),
    measurement_id: safeString(raw?.location_id),
    api_secret: safeString(raw?.api_key),
  };
}

function parseFacebookDatasetConfig(raw: any): FacebookDatasetConfig {
  const metadata = normalizePayload(raw?.custom_field_mappings);
  return {
    enabled: Boolean(raw?.enabled),
    dataset_id: safeString(raw?.location_id),
    access_token: safeString(raw?.api_key),
    test_event_code: safeString(metadata.test_event_code),
  };
}

function normalizeGa4ParamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function toGa4Primitive(value: unknown): string | number | boolean {
  if (typeof value === "string") return value.slice(0, 100);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return JSON.stringify(value).slice(0, 100);
}

function hashForMeta(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function buildGa4EventParams(
  input: TrackMarketingEventInput,
): Record<string, string | number | boolean> {
  const payload = normalizePayload(input.event_payload);
  const params: Record<string, string | number | boolean> = {
    event_source: input.event_source || "app",
  };

  if (input.event_key) {
    params.event_key = input.event_key;
  }

  for (const [rawKey, rawValue] of Object.entries(payload)) {
    if (rawValue === undefined) continue;
    const key = normalizeGa4ParamName(rawKey);
    if (!key) continue;
    params[key] = toGa4Primitive(rawValue);
  }

  return params;
}

async function sendGa4Event(
  config: Ga4Config,
  input: TrackMarketingEventInput,
): Promise<{ status: MarketingDeliveryStatus; response: unknown }> {
  if (!config.enabled || !config.measurement_id || !config.api_secret) {
    return { status: "skipped", response: { reason: "integration_not_configured" } };
  }

  const url =
    `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(config.measurement_id)}` +
    `&api_secret=${encodeURIComponent(config.api_secret)}`;

  const body = {
    client_id: input.user_id ? `${input.user_id}.server` : randomUUID(),
    user_id: input.user_id || undefined,
    events: [
      {
        name: input.event_name,
        params: buildGa4EventParams(input),
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 204 || response.ok) {
      return { status: "sent", response: { status: response.status } };
    }

    const raw = await response.text().catch(() => "");
    return {
      status: "failed",
      response: { status: response.status, body: raw || "ga4_request_failed" },
    };
  } catch (error: unknown) {
    clearTimeout(timeout);
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const message = isTimeout ? "GA4 request timed out" : (error instanceof Error ? error.message : "ga4_request_failed");
    return {
      status: "failed",
      response: { message },
    };
  }
}

/**
 * Normalize phone number by removing all non-digit characters
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Build Facebook user_data object with SHA256 hashed fields
 * Following Meta Conversions API best practices for matching
 */
function buildFacebookUserData(
  input: TrackMarketingEventInput,
): Record<string, unknown> {
  const userData: Record<string, unknown> = {};

  // Get extended user data if provided
  const ext = input.user_data || {};

  // Email - primary identifier (SHA256 hashed)
  const email = safeString(input.email || ext.email);
  if (email) {
    userData.em = hashForMeta(email);
  }

  // Phone - secondary identifier (SHA256 hashed, normalized)
  const phone = normalizePhone(ext.phone);
  if (phone) {
    userData.ph = hashForMeta(phone);
  }

  // Name fields (SHA256 hashed)
  const firstName = safeString(ext.first_name);
  if (firstName) {
    userData.fn = hashForMeta(firstName);
  }
  const lastName = safeString(ext.last_name);
  if (lastName) {
    userData.ln = hashForMeta(lastName);
  }

  // Location fields (lowercase before hashing)
  const city = safeString(ext.city);
  if (city) {
    userData.ct = hashForMeta(city);
  }
  const state = safeString(ext.state);
  if (state) {
    userData.st = hashForMeta(state);
  }
  const country = safeString(ext.country);
  if (country) {
    // Country should be ISO 2-letter code
    userData.country = country.toLowerCase().substring(0, 2);
  }
  const zip = safeString(ext.zip);
  if (zip) {
    userData.zp = hashForMeta(zip);
  }

  // External ID (user_id, SHA256 hashed)
  const externalId = safeString(input.user_id || ext.external_id);
  if (externalId) {
    userData.external_id = hashForMeta(externalId);
  }

  // Facebook Click ID (fbc) - from URL parameter fbclid
  const fbc = safeString(ext.fbc);
  if (fbc) {
    userData.fbc = fbc;
  }

  // Facebook Browser ID (fbp) - from cookie _fbp
  const fbp = safeString(ext.fbp);
  if (fbp) {
    userData.fbp = fbp;
  }

  // Client IP and User Agent (not hashed)
  if (input.ip_address) {
    userData.client_ip_address = input.ip_address;
  }
  if (input.user_agent) {
    userData.client_user_agent = input.user_agent;
  }

  return userData;
}

/**
 * Build custom_data for Facebook events with value/currency support
 */
function buildFacebookCustomData(
  input: TrackMarketingEventInput,
): Record<string, unknown> {
  const payload = normalizePayload(input.event_payload);
  const customData: Record<string, unknown> = { ...payload };

  // Add value and currency for purchase/subscription events
  if (input.value !== undefined && input.value !== null) {
    customData.value = input.value;
  }
  if (input.currency) {
    customData.currency = input.currency.toUpperCase();
  }

  return customData;
}

async function sendFacebookDatasetEvent(
  config: FacebookDatasetConfig,
  input: TrackMarketingEventInput,
): Promise<{ status: MarketingDeliveryStatus; response: unknown }> {
  if (!config.enabled || !config.dataset_id || !config.access_token) {
    return { status: "skipped", response: { reason: "integration_not_configured" } };
  }

  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(config.dataset_id)}/events`;

  const userData = buildFacebookUserData(input);
  const customData = buildFacebookCustomData(input);

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: input.event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.event_key || randomUUID(),
        action_source: "website",
        event_source_url: input.event_source_url || undefined,
        user_data: userData,
        custom_data: customData,
      },
    ],
    access_token: config.access_token,
  };

  if (config.test_event_code) {
    body.test_event_code = config.test_event_code;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const raw = await response.text().catch(() => "");
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      // keep raw text
    }

    if (response.ok) {
      return { status: "sent", response: parsed };
    }

    return {
      status: "failed",
      response: { status: response.status, body: parsed },
    };
  } catch (error: unknown) {
    clearTimeout(timeout);
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const message = isTimeout ? "Facebook request timed out" : (error instanceof Error ? error.message : "facebook_dataset_request_failed");
    return {
      status: "failed",
      response: { message },
    };
  }
}

export async function trackMarketingEvent(
  input: TrackMarketingEventInput,
): Promise<TrackMarketingEventResult> {
  const normalizedInput: TrackMarketingEventInput = {
    event_name: safeString(input.event_name) || "unknown_event",
    event_key: safeString(input.event_key),
    event_source: safeString(input.event_source) || "app",
    user_id: safeString(input.user_id),
    email: safeString(input.email),
    user_data: input.user_data,
    event_payload: normalizePayload(input.event_payload),
    event_source_url: safeString(input.event_source_url),
    ip_address: safeString(input.ip_address),
    user_agent: safeString(input.user_agent),
    send_only: input.send_only,
    currency: safeString(input.currency),
    value: input.value,
  };

  const sb = createAdminSupabase();

  const seedInsert = await sb
    .from("marketing_events")
    .insert({
      event_key: normalizedInput.event_key || null,
      event_name: normalizedInput.event_name,
      event_source: normalizedInput.event_source,
      user_id: normalizedInput.user_id || null,
      email: normalizedInput.email || null,
      event_payload: normalizedInput.event_payload || {},
      ga4_status: "queued",
      facebook_status: "queued",
    })
    .select("id")
    .single();

  if (seedInsert.error) {
    if (seedInsert.error.code === "23505" && normalizedInput.event_key) {
      const { data: existing } = await sb
        .from("marketing_events")
        .select("id, ga4_status, facebook_status")
        .eq("event_key", normalizedInput.event_key)
        .maybeSingle();

      return {
        id: existing?.id || null,
        duplicate: true,
        ga4_status: (existing?.ga4_status as MarketingDeliveryStatus) || "skipped",
        facebook_status: (existing?.facebook_status as MarketingDeliveryStatus) || "skipped",
      };
    }

    throw new Error(seedInsert.error.message || "Failed to create marketing event");
  }

  const eventId = seedInsert.data.id as string;

  const { data: integrationRows } = await sb
    .from("integration_settings")
    .select("integration_type, enabled, api_key, location_id, custom_field_mappings")
    .in("integration_type", ["ga4", "facebook_dataset", "facebook"]);

  const byType = Object.fromEntries((integrationRows || []).map((row: any) => [row.integration_type, row]));
  const ga4Config = parseGa4Config(byType.ga4);
  const facebookConfig = parseFacebookDatasetConfig(byType.facebook_dataset || byType.facebook);

  const ga4Result =
    normalizedInput.send_only && normalizedInput.send_only !== "ga4"
      ? { status: "skipped" as MarketingDeliveryStatus, response: { reason: "send_only_filter" } }
      : await sendGa4Event(ga4Config, normalizedInput);

  const facebookResult =
    normalizedInput.send_only && normalizedInput.send_only !== "facebook_dataset"
      ? { status: "skipped" as MarketingDeliveryStatus, response: { reason: "send_only_filter" } }
      : await sendFacebookDatasetEvent(facebookConfig, normalizedInput);

  const updateResult = await sb
    .from("marketing_events")
    .update({
      ga4_status: ga4Result.status,
      ga4_response: ga4Result.response,
      facebook_status: facebookResult.status,
      facebook_response: facebookResult.response,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message || "Failed to finalize marketing event");
  }

  return {
    id: eventId,
    duplicate: false,
    ga4_status: ga4Result.status,
    facebook_status: facebookResult.status,
  };
}
