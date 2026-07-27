/**
 * Image Provider Abstraction (Phase 12 — PROV-01)
 * Pluggable image-generation backend. Default: Gemini.
 */

import { generateImage, editImage } from "./image-generation.service.js";

// ── Canonical types (provider-agnostic) ───────────────────────────────────

export interface ReferenceImage {
  mimeType: string;  // e.g. "image/png", "image/webp", "image/jpeg"
  data: string;      // base64-encoded (no data: prefix)
}

export interface ImageGenerationInput {
  prompt: string;
  aspectRatio: string;      // "1:1" | "4:5" | "9:16" | "16:9"
  apiKey: string;
  resolution?: string;
  model?: string;
  referenceImages?: ReferenceImage[];
  logoImageData?: ReferenceImage | null;
}

export interface ImageEditInput {
  prompt: string;
  currentImage: ReferenceImage;          // base image being edited
  apiKey: string;
  model?: string;
  logoImageData?: ReferenceImage | null;
  additionalRefs?: ReferenceImage[];     // extra refs (carousel style consistency)
  aspectRatio?: string;                  // pin output ratio (carousel slides 2..N)
}

export interface ImageProviderResult {
  buffer: Buffer;
  mimeType: string;
  model?: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  costUsdMicros?: number; // Phase 21 GATE-05: OpenRouter usage.cost in micros; undefined on direct-Gemini/OpenAI paths
}

export interface ImageProvider {
  readonly name: "gemini" | "openai" | "openrouter";
  generate(input: ImageGenerationInput): Promise<ImageProviderResult>;
  edit(input: ImageEditInput): Promise<ImageProviderResult>;
}

// ── GeminiImageProvider (default, thin wrapper) ───────────────────────────

export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini" as const;

  async generate(input: ImageGenerationInput): Promise<ImageProviderResult> {
    const result = await generateImage({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      model: input.model,
      apiKey: input.apiKey,
      referenceImages: input.referenceImages,
      logoImageData: input.logoImageData ?? null,
    });
    return {
      buffer: result.buffer,
      mimeType: result.mimeType,
      model: result.model,
      usage: result.usage,
    };
  }

  async edit(input: ImageEditInput): Promise<ImageProviderResult> {
    const result = await editImage({
      prompt: input.prompt,
      currentImageBase64: input.currentImage.data,
      currentImageMimeType: input.currentImage.mimeType,
      apiKey: input.apiKey,
      logoImageData: input.logoImageData ?? null,
      model: input.model,
      aspectRatio: input.aspectRatio,
    });
    return {
      buffer: result.buffer,
      mimeType: result.mimeType,
      model: result.model,
      usage: result.usage,
    };
  }
}

// ── OpenAI provider (Responses API + image_generation tool) ───────────────
// NOTE: We use Responses API, NOT images.edit — confirmed SDK bug #1844 rejects
// gpt-image-2 from images.edit. See 12-RESEARCH.md Pitfall 1.

import OpenAI from "openai";
// @ts-ignore - sharp ESM import (mirror pattern from image-generation.service.ts)
import sharp from "sharp";

/**
 * Mainline OpenAI Responses model that supports the image_generation tool.
 * gpt-image-2 is the UNDERLYING image engine — it is NOT set in the top-level
 * `model` field. See 12-RESEARCH.md Open Question 1.
 * `gpt-5.5` per CONTEXT.md D-03 (locked decision) and OpenAI documentation examples.
 */
export const OPENAI_RESPONSES_MODEL = "gpt-5.5";

/**
 * Convert a canonical ReferenceImage to an OpenAI Responses-API
 * `input_image` content block (PROV-03).
 */
export function toOpenAIInputImage(ref: ReferenceImage) {
  return {
    type: "input_image" as const,
    image_url: `data:${ref.mimeType};base64,${ref.data}`,
  };
}

/**
 * Convert an aspect ratio to a natural-language hint to inject into the
 * prompt. The Responses API image_generation tool has NO `size` parameter,
 * so the only way to influence aspect ratio is via the prompt text
 * (see 12-RESEARCH.md Critical Finding).
 */
export function aspectRatioToOpenAISizeHint(ratio: string): string {
  const map: Record<string, string> = {
    "1:1": "square (1:1)",
    "4:5": "portrait (4:5, slightly taller than wide)",
    "9:16": "portrait (9:16, tall mobile format)",
    "16:9": "landscape (16:9, wide format)",
  };
  return map[ratio] ?? ratio;
}

/**
 * Minimal shape of the OpenAI Responses API response we depend on.
 * The SDK's actual return type is a discriminated union across many output
 * item kinds; we narrow to just the fields extractResponseImage needs.
 */
interface OpenAIResponseLike {
  output?: ReadonlyArray<{ type?: string; result?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Extract the first image_generation_call result from a Responses API
 * response (PROV-02; see Pitfall 2 — never blindly index output[0]).
 *
 * Accepts the wide SDK return type via unknown + internal narrowing so
 * call sites don't need to cast.
 */
export function extractResponseImage(response: unknown): ImageProviderResult {
  const r = response as OpenAIResponseLike;
  const output = r?.output ?? [];
  const imageCalls = output.filter((item) => item?.type === "image_generation_call");
  if (imageCalls.length === 0) {
    throw new Error(
      "OpenAI Responses API returned no image_generation_call in output"
    );
  }
  const base64 = imageCalls[0]?.result;
  if (!base64) {
    throw new Error("OpenAI image_generation_call result is empty");
  }
  return {
    buffer: Buffer.from(base64, "base64"),
    mimeType: "image/png",
    model: OPENAI_RESPONSES_MODEL,
    usage: {
      promptTokenCount: r?.usage?.input_tokens,
      candidatesTokenCount: r?.usage?.output_tokens,
    },
  };
}

/**
 * Normalize a reference image to PNG base64 (OpenAI prefers PNG; see Pitfall 6).
 * Re-encodes only when MIME is not already PNG/JPEG/WEBP.
 */
async function normalizeForOpenAI(ref: ReferenceImage): Promise<ReferenceImage> {
  const mt = ref.mimeType.split(";")[0].trim().toLowerCase();
  if (mt === "image/png" || mt === "image/jpeg" || mt === "image/webp") {
    return { mimeType: mt, data: ref.data };
  }
  const png = await sharp(Buffer.from(ref.data, "base64")).png().toBuffer();
  return { mimeType: "image/png", data: png.toString("base64") };
}

export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai" as const;

  async generate(input: ImageGenerationInput): Promise<ImageProviderResult> {
    if (!input.apiKey) {
      throw new Error("OpenAI API key is required");
    }
    const client = new OpenAI({ apiKey: input.apiKey });

    const sizeHint = aspectRatioToOpenAISizeHint(input.aspectRatio);
    const fullPrompt = `${input.prompt}\n\nImage format: ${sizeHint} aspect ratio.`;

    const inputContent: any[] = [{ type: "input_text", text: fullPrompt }];

    if (input.logoImageData) {
      inputContent.push(toOpenAIInputImage(await normalizeForOpenAI(input.logoImageData)));
    }
    for (const ref of input.referenceImages ?? []) {
      inputContent.push(toOpenAIInputImage(await normalizeForOpenAI(ref)));
    }

    try {
      const response = await client.responses.create({
        model: OPENAI_RESPONSES_MODEL,
        input: [{ role: "user", content: inputContent }],
        tools: [{ type: "image_generation", quality: "medium" }],
      } as any);
      return extractResponseImage(response);
    } catch (err: any) {
      const msg = err?.error?.message || err?.message || "OpenAI generation failed";
      throw new Error(`Image Generation Error: ${msg}`);
    }
  }

  async edit(input: ImageEditInput): Promise<ImageProviderResult> {
    if (!input.apiKey) {
      throw new Error("OpenAI API key is required");
    }
    const client = new OpenAI({ apiKey: input.apiKey });

    const current = await normalizeForOpenAI(input.currentImage);
    // The Responses image tool has no size parameter — the aspect ratio can
    // only be steered through the prompt (same approach as generate()).
    const editPrompt = input.aspectRatio
      ? `${input.prompt}\n\nImage format: ${aspectRatioToOpenAISizeHint(input.aspectRatio)} aspect ratio.`
      : input.prompt;
    const inputContent: any[] = [
      { type: "input_text", text: editPrompt },
      toOpenAIInputImage(current),
    ];
    if (input.logoImageData) {
      inputContent.push(toOpenAIInputImage(await normalizeForOpenAI(input.logoImageData)));
    }
    for (const ref of input.additionalRefs ?? []) {
      inputContent.push(toOpenAIInputImage(await normalizeForOpenAI(ref)));
    }

    try {
      const response = await client.responses.create({
        model: OPENAI_RESPONSES_MODEL,
        input: [{ role: "user", content: inputContent }],
        tools: [{ type: "image_generation", quality: "medium", action: "edit" }],
      } as any);
      return extractResponseImage(response);
    } catch (err: any) {
      const msg = err?.error?.message || err?.message || "OpenAI edit failed";
      throw new Error(`Image Edit Error: ${msg}`);
    }
  }
}

// ── OpenRouterImageProvider (Phase 21 — GATE-02) ──────────────────────────
// Thin wrapper over ai-gateway.service.ts's Image API functions, same
// pattern as GeminiImageProvider wrapping image-generation.service.ts.
// Uses the PLATFORM OpenRouter key (config.OPENROUTER_API_KEY), ignoring
// input.apiKey (which call sites still populate with a Gemini/OpenAI key).
// Affiliate BYO OpenRouter keys land in Phase 21.1 (GATE-06).

import { generateImage as gatewayGenerateImage, editImage as gatewayEditImage } from "./ai-gateway.service.js";
import { config } from "../config/index.js";

const DEFAULT_OPENROUTER_IMAGE_MODEL = "google/gemini-3.1-flash-image";

function requireOpenRouterKey(): string {
  const key = config.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Set it in the environment, or flip ai_gateway_routing.image to \"direct\" to use the legacy Gemini path.",
    );
  }
  return key;
}

export class OpenRouterImageProvider implements ImageProvider {
  readonly name = "openrouter" as const;

  async generate(input: ImageGenerationInput): Promise<ImageProviderResult> {
    const refs: ReferenceImage[] = [
      ...(input.logoImageData ? [input.logoImageData] : []),
      ...(input.referenceImages ?? []),
    ];
    const result = await gatewayGenerateImage({
      apiKey: requireOpenRouterKey(),
      model: input.model || DEFAULT_OPENROUTER_IMAGE_MODEL,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      referenceImages: refs,
    });
    return {
      buffer: result.buffer,
      mimeType: result.mimeType,
      model: result.modelUsed,
      usage: result.usage,
      costUsdMicros: result.costUsdMicros,
    };
  }

  async edit(input: ImageEditInput): Promise<ImageProviderResult> {
    const extraRefs: ReferenceImage[] = [
      ...(input.logoImageData ? [input.logoImageData] : []),
      ...(input.additionalRefs ?? []),
    ];
    const result = await gatewayEditImage({
      apiKey: requireOpenRouterKey(),
      model: input.model || DEFAULT_OPENROUTER_IMAGE_MODEL,
      prompt: input.prompt,
      currentImage: input.currentImage,
      referenceImages: extraRefs,
    });
    return {
      buffer: result.buffer,
      mimeType: result.mimeType,
      model: result.modelUsed,
      usage: result.usage,
      costUsdMicros: result.costUsdMicros,
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────
import { getCallRouting } from "./ai-gateway-settings.service.js";

export type ImageProviderName = "gemini" | "openai" | "openrouter";

/**
 * Profile fields needed for per-user provider preference resolution (Phase 12.1).
 * Admin/affiliate users may override the global default via profiles.image_provider.
 */
type ProfileForProvider = {
  is_admin?: boolean | null;
  is_affiliate?: boolean | null;
  image_provider?: "gemini" | "openai" | null;
} | null | undefined;

/**
 * Phase 21 (GATE-04): the gemini/openai image_provider toggle is RETIRED.
 * Resolution now returns "openrouter" unconditionally, unless the
 * ai_gateway_routing.image rollback switch (GATE-07) is set to "direct" —
 * in which case the retained legacy GeminiImageProvider path is used.
 * profiles.image_provider + platform_settings.image_provider are retained
 * dead (additive-deprecation precedent from Phase 12.1→12.3) and NO LONGER
 * read here. The `profile` param is kept for signature compatibility and
 * for Phase 21.1's affiliate BYOK key resolution.
 */
export async function resolveImageProviderName(_profile?: ProfileForProvider): Promise<ImageProviderName> {
  const routing = await getCallRouting("image");
  return routing === "direct" ? "gemini" : "openrouter";
}

/**
 * Returns the concrete ImageProvider instance for the given profile (PROV-04 + Phase 12.1).
 * Phase 21 (GATE-02/GATE-07): routes through OpenRouter by default; falls back
 * to the legacy GeminiImageProvider path when ai_gateway_routing.image is
 * flipped to "direct" (emergency rollback, no deploy required).
 */
export async function getActiveImageProvider(profile?: ProfileForProvider): Promise<ImageProvider> {
  const name = await resolveImageProviderName(profile);
  return name === "gemini" ? new GeminiImageProvider() : new OpenRouterImageProvider();
}

/**
 * Read-only accessor for the configured provider name (admin UI / verify script).
 * Without a profile argument, returns the global default.
 */
export async function getActiveImageProviderName(profile?: ProfileForProvider): Promise<ImageProviderName> {
  return resolveImageProviderName(profile);
}
