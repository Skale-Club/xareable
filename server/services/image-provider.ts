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
