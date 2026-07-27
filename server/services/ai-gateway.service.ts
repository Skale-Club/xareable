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
}

export interface ChatCompletionResult {
  text: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number };
  costUsdMicros?: number;
  modelUsed: string;
}

/** GATE-01: chat/planning/caption/pre-screen calls. Fallback chain read from ai_model_fallbacks.text unless the caller passes its own. */
export async function chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  const fallbacks = params.fallbackModels ?? (await getFallbackChain("text"));
  const client = getOpenRouterClient(params.apiKey);

  const { result, modelUsed } = await callWithFallback(params.model, fallbacks, "text", async (model) => {
    const response = await client.chat.completions.create({
      model: normalizeOpenRouterModelSlug(model),
      messages: params.messages as any,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      response_format: params.responseFormat as any,
    });
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
