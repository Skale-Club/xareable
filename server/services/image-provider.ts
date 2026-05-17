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
}

export interface ImageProviderResult {
  buffer: Buffer;
  mimeType: string;
  model?: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export interface ImageProvider {
  readonly name: "gemini" | "openai";
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
 * Extract the first image_generation_call result from a Responses API
 * response (PROV-02; see Pitfall 2 — never blindly index output[0]).
 */
export function extractResponseImage(response: any): ImageProviderResult {
  const output: any[] = response?.output ?? [];
  const imageCalls = output.filter(
    (item: any) => item?.type === "image_generation_call"
  );
  if (imageCalls.length === 0) {
    throw new Error(
      "OpenAI Responses API returned no image_generation_call in output"
    );
  }
  const base64: string | undefined = imageCalls[0]?.result;
  if (!base64) {
    throw new Error("OpenAI image_generation_call result is empty");
  }
  return {
    buffer: Buffer.from(base64, "base64"),
    mimeType: "image/png",
    model: OPENAI_RESPONSES_MODEL,
    usage: {
      promptTokenCount: response?.usage?.input_tokens,
      candidatesTokenCount: response?.usage?.output_tokens,
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
    const inputContent: any[] = [
      { type: "input_text", text: input.prompt },
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

// ── Factory ───────────────────────────────────────────────────────────────
import { getPlatformSetting } from "./app-settings.service.js";

export type ImageProviderName = "gemini" | "openai";

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
 * Resolve the active image provider name for a given profile.
 *
 * Resolution order (Phase 12.1):
 *   1. If profile is admin/affiliate AND has profile.image_provider set → use it
 *   2. Otherwise fall back to platform_settings.image_provider (global default)
 *   3. Default to 'gemini' when the global row is missing/unrecognized
 *
 * No caching: settings change rarely and admins expect immediate effect on toggle.
 */
export async function resolveImageProviderName(profile?: ProfileForProvider): Promise<ImageProviderName> {
  // Per-user override (admin/affiliate only)
  if (profile && (profile.is_admin === true || profile.is_affiliate === true) && profile.image_provider) {
    return profile.image_provider === "openai" ? "openai" : "gemini";
  }
  // Global fallback
  const raw = await getPlatformSetting("image_provider");
  return raw === "openai" ? "openai" : "gemini";
}

/**
 * Returns the concrete ImageProvider instance for the given profile (PROV-04 + Phase 12.1).
 * Accepts an optional profile so admin/affiliate users can override the global default.
 * When called with no profile, falls back to the global platform_settings.image_provider.
 */
export async function getActiveImageProvider(profile?: ProfileForProvider): Promise<ImageProvider> {
  const name = await resolveImageProviderName(profile);
  return name === "openai" ? new OpenAIImageProvider() : new GeminiImageProvider();
}

/**
 * Read-only accessor for the configured provider name (admin UI / verify script).
 * Without a profile argument, returns the global default.
 */
export async function getActiveImageProviderName(profile?: ProfileForProvider): Promise<ImageProviderName> {
  return resolveImageProviderName(profile);
}
