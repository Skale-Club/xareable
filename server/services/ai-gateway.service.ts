/**
 * AI Gateway Service (Phase 21 — GATE-01, GATE-03, GATE-04)
 * Single shared entrypoint for OpenRouter-routed chat completions and
 * transcription. Image calls (GATE-02) are added to this same file by
 * Plan 21-05, since OpenRouter's dedicated Image API cannot be reached via
 * the openai SDK and needs a separate raw-fetch implementation.
 *
 * Call sites (gemini.service.ts, carousel-generation.service.ts,
 * caption-quality.service.ts, enhancement.service.ts, transcribe.routes.ts)
 * branch on getCallRouting(callClass) THEMSELVES — this file only
 * implements the OpenRouter side of that branch. The "direct" (legacy
 * Gemini) side stays in each call site's own file, unchanged in shape,
 * fixed only for POL-07 header compliance where needed.
 */

import OpenAI from "openai";
import { createAdminSupabase } from "../supabase.js";
import { getFallbackChain, type FallbackCallClass } from "./ai-gateway-settings.service.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_ATTRIBUTION_HEADERS = {
  "HTTP-Referer": "https://xareable.com",
  "X-Title": "Xareable",
};

/**
 * Bare Gemini model names (no "/") default to the google/ provider prefix
 * OpenRouter expects (e.g. "gemini-2.5-flash" -> "google/gemini-2.5-flash").
 * Already-prefixed slugs (e.g. "openai/gpt-4o") pass through unchanged. This
 * keeps existing style_catalog.ai_models values (today stored bare, e.g.
 * "gemini-2.5-flash") working without a data migration — see
 * 21-RESEARCH.md's flagged model-slug-format gap.
 */
export function normalizeOpenRouterModelSlug(model: string): string {
  if (!model) return model;
  return model.includes("/") ? model : `google/${model}`;
}

let cachedClient: { key: string; client: OpenAI } | null = null;
function getOpenRouterClient(apiKey: string): OpenAI {
  if (cachedClient && cachedClient.key === apiKey) return cachedClient.client;
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: OPENROUTER_ATTRIBUTION_HEADERS,
  });
  cachedClient = { key: apiKey, client };
  return client;
}

/** GATE-04: best-effort log of a fallback engagement. NEVER throws — mirrors observability.service.ts's contract (logging must not break generation). */
async function logModelFallback(params: {
  callClass: string;
  fromModel: string;
  toModel: string;
  reason: string;
}): Promise<void> {
  try {
    const admin = createAdminSupabase();
    await admin.from("generation_logs").insert({
      status: "ok",
      error_message: "",
      event_kind: "model_fallback",
      outcome: "fallback_used",
      metadata: {
        call_class: params.callClass,
        from_model: params.fromModel,
        to_model: params.toModel,
        reason: params.reason,
      },
    });
  } catch {
    // Best-effort: swallow. Logging must never break the generation flow.
  }
}

/**
 * GATE-04: one pass through [primary, ...fallbacks], first success wins.
 * Matches the existing single-retry style (no exponential backoff, no
 * circuit breaker) — CONTEXT.md's locked design is explicitly "one pass."
 */
export async function callWithFallback<T>(
  primaryModel: string,
  fallbackModels: string[],
  callClass: FallbackCallClass,
  callFn: (model: string) => Promise<T>,
): Promise<{ result: T; modelUsed: string }> {
  const slugs = [primaryModel, ...fallbackModels].filter(Boolean);
  let lastError: unknown;
  for (let i = 0; i < slugs.length; i++) {
    try {
      const result = await callFn(slugs[i]);
      if (i > 0) {
        void logModelFallback({
          callClass,
          fromModel: slugs[0],
          toModel: slugs[i],
          reason: String((lastError as any)?.message ?? lastError),
        });
      }
      return { result, modelUsed: slugs[i] };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      const isFallbackWorthy = /\b(404|410|5\d\d|model_not_found)\b/i.test(msg);
      if (!isFallbackWorthy || i === slugs.length - 1) throw err;
      lastError = err;
    }
  }
  throw lastError; // unreachable if slugs.length > 0
}

export type ChatMessageContent = string | Array<{ type: string; [key: string]: unknown }>;

export interface ChatCompletionParams {
  apiKey: string;
  model: string;
  fallbackModels?: string[];
  messages: Array<{ role: "user" | "system"; content: ChatMessageContent }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: Record<string, unknown> };
  /**
   * Phase 24 (CRIT-01): fallback-chain + model_fallback-log call class.
   * Defaults to "text" — every pre-Phase-24 caller (planning, caption, carousel
   * plan, enhancement pre-screen/caption) keeps its exact current behavior.
   * The visual critic passes "critic" so it gets its OWN ai_model_fallbacks
   * chain instead of silently inheriting the text chain (24-RESEARCH Pitfall 1).
   */
  callClass?: FallbackCallClass;
  /**
   * Phase 24 (CRIT-04): REAL cancellation. Threaded into the openai SDK's
   * RequestOptions second argument, which wires it to the underlying fetch().
   * This is NOT the cooperative between-stages check used by
   * carousel.routes.ts / enhance.routes.ts — a fired timer genuinely aborts
   * the in-flight HTTP request.
   */
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  text: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number };
  costUsdMicros?: number;
  modelUsed: string;
}

/**
 * GATE-01: chat/planning/caption/pre-screen/critic calls. Fallback chain is
 * read from `ai_model_fallbacks[callClass]` (default `"text"`) unless the
 * caller passes its own `fallbackModels`.
 *
 * Phase 24 (CRIT-04) note: an `AbortError` raised by a fired `params.signal`
 * deliberately does NOT match `callWithFallback`'s
 * `/\b(404|410|5\d\d|model_not_found)\b/i` trigger regex, so an abort
 * re-throws immediately instead of burning the remaining fallback models.
 */
export async function chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  const callClass = params.callClass ?? "text";
  const fallbacks = params.fallbackModels ?? (await getFallbackChain(callClass));
  const client = getOpenRouterClient(params.apiKey);

  const { result, modelUsed } = await callWithFallback(params.model, fallbacks, callClass, async (model) => {
    const response = await client.chat.completions.create(
      {
        model: normalizeOpenRouterModelSlug(model),
        messages: params.messages as any,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        response_format: params.responseFormat as any,
      },
      { signal: params.signal },
    );
    const choice = response.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (!text.trim()) {
      throw new Error(
        `OpenRouter chat completion returned empty content (finish_reason=${choice?.finish_reason || "unknown"})`,
      );
    }
    // `usage.cost` is an OpenRouter-specific extension not present in the
    // openai SDK's published response types — read defensively via `any`.
    const usage = (response as any).usage;
    return {
      text,
      usage: {
        promptTokenCount: usage?.prompt_tokens,
        candidatesTokenCount: usage?.completion_tokens,
      },
      costUsdMicros: typeof usage?.cost === "number" ? Math.round(usage.cost * 1_000_000) : undefined,
    };
  });

  return { ...result, modelUsed };
}

export interface TranscribeParams {
  apiKey: string;
  model: string;
  fallbackModels?: string[];
  audioBase64: string;
  mimeType: string;
}

export interface TranscribeResult {
  text: string;
  costUsdMicros?: number;
  modelUsed: string;
}

function mimeToAudioFormat(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  const parts = base.split("/");
  return parts[1] || "webm";
}

/**
 * GATE-03: audio transcription via the gateway.
 *
 * Deliberate design choice (see 21-RESEARCH.md Open Question 2 — both
 * options are documented as valid): implemented via chatCompletion()'s
 * multimodal `input_audio` content part, NOT the openai SDK's separate
 * `audio.transcriptions.create()` (whisper-only) endpoint. This preserves
 * admin-configurability of the SAME multimodal model already used today
 * (a Gemini model via style_catalog.ai_models.audio_transcription per
 * GATE-04's "no hardcoded slugs" requirement) — a whisper-only endpoint
 * would reject non-whisper model slugs.
 */
export async function transcribe(params: TranscribeParams): Promise<TranscribeResult> {
  const fallbacks = params.fallbackModels ?? (await getFallbackChain("transcription"));
  const client = getOpenRouterClient(params.apiKey);

  const { result, modelUsed } = await callWithFallback(params.model, fallbacks, "transcription", async (model) => {
    const response = await client.chat.completions.create({
      model: normalizeOpenRouterModelSlug(model),
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this audio. Output only the transcribed text, no additional commentary." },
            {
              type: "input_audio",
              input_audio: { data: params.audioBase64, format: mimeToAudioFormat(params.mimeType) },
            },
          ],
        } as any,
      ],
    });
    const choice = response.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
    if (!text) {
      throw new Error(
        `OpenRouter transcription returned empty content (finish_reason=${choice?.finish_reason || "unknown"})`,
      );
    }
    const usage = (response as any).usage;
    return {
      text,
      costUsdMicros: typeof usage?.cost === "number" ? Math.round(usage.cost * 1_000_000) : undefined,
    };
  });

  return { text: result.text, costUsdMicros: result.costUsdMicros, modelUsed };
}

// ── GATE-02: dedicated Image API (raw fetch — the openai SDK cannot reach it) ──

export interface GatewayReferenceImage {
  mimeType: string; // e.g. "image/png"
  data: string;     // base64, no data: prefix (matches image-provider.ts ReferenceImage)
}

/**
 * Adapter: codebase ReferenceImage ({ mimeType, data }) → OpenRouter
 * input_references entry ({ type: "image_url", image_url: { url } }).
 * A naive pass-through of the bare shape would be silently ignored or
 * 400-rejected by OpenRouter, producing reference-less generations that
 * look like model quality bugs — see 21-RESEARCH.md "input_references
 * shape mismatch" pitfall. Guarded by scripts/test-openrouter-image-adapter.ts.
 */
export function toOpenRouterInputReference(ref: GatewayReferenceImage) {
  return {
    type: "image_url" as const,
    image_url: { url: `data:${ref.mimeType};base64,${ref.data}` },
  };
}

export interface GatewayImageParams {
  apiKey: string;
  model: string;
  fallbackModels?: string[];
  prompt: string;
  aspectRatio?: string;   // top-level aspect_ratio (e.g. "4:5") — omit for edits (output follows input refs)
  resolution?: string;    // top-level resolution (e.g. "1K", "2K")
  referenceImages?: GatewayReferenceImage[];
  /** Phase 24 (CRIT-04): real cancellation, threaded into callImageApi's fetch(). */
  signal?: AbortSignal;
}

export interface GatewayImageResult {
  buffer: Buffer;
  mimeType: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number };
  costUsdMicros?: number;
  modelUsed: string;
}

async function callImageApi(params: GatewayImageParams, model: string): Promise<Omit<GatewayImageResult, "modelUsed">> {
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${params.apiKey}`,
      ...OPENROUTER_ATTRIBUTION_HEADERS,
    },
    body: JSON.stringify({
      model: normalizeOpenRouterModelSlug(model),
      prompt: params.prompt,
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.referenceImages?.length
        ? { input_references: params.referenceImages.map(toOpenRouterInputReference) }
        : {}),
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // OpenRouter error shape: { error: { code, message, metadata } } — include
    // the HTTP status in the thrown message so callWithFallback's
    // /404|410|5\d\d|model_not_found/ trigger regex can match it.
    throw new Error(
      `OpenRouter image call failed: ${response.status} - ${body?.error?.message ?? "unknown error"}`,
    );
  }

  const data = await response.json();
  const image = data?.data?.[0];
  if (!image?.b64_json) {
    throw new Error("OpenRouter image response contained no image data");
  }
  return {
    buffer: Buffer.from(image.b64_json, "base64"),
    mimeType: image.media_type || "image/png",
    usage: {
      promptTokenCount: data?.usage?.prompt_tokens,
      candidatesTokenCount: data?.usage?.completion_tokens,
    },
    costUsdMicros: typeof data?.usage?.cost === "number" ? Math.round(data.usage.cost * 1_000_000) : undefined,
  };
}

/** GATE-02: text-to-image (input_references optional — brand refs / logo). */
export async function generateImage(params: GatewayImageParams): Promise<GatewayImageResult> {
  const fallbacks = params.fallbackModels ?? (await getFallbackChain("image"));
  const { result, modelUsed } = await callWithFallback(params.model, fallbacks, "image", (model) =>
    callImageApi(params, model),
  );
  return { ...result, modelUsed };
}

/**
 * GATE-02: image-to-image edit. Same endpoint as generation — the current
 * image travels as input_references[0] (there is no separate /edit path on
 * OpenRouter's Image API; the generate/edit split is purely this codebase's
 * application-level ImageProvider distinction).
 */
export async function editImage(params: GatewayImageParams & { currentImage: GatewayReferenceImage }): Promise<GatewayImageResult> {
  const refs = [params.currentImage, ...(params.referenceImages ?? [])];
  return generateImage({ ...params, referenceImages: refs });
}
