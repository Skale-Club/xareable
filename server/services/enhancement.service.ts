/**
 * Enhancement Service (v1.1, Phase 6)
 * Pre-screens raw uploads, strips EXIF + normalizes to 1:1 square, then runs
 * a scenery-composed edit call against gemini-3.1-flash-image-preview.
 * Owns: storage upload ({postId}-source.webp + {postId}.webp) + posts row write (D-16/D-17).
 * Does NOT own: route plumbing, SSE writer, credit deduction, idempotency lookup.
 */

import { randomUUID } from "node:crypto";
// @ts-ignore - sharp ESM
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "../supabase.js";
import { getStyleCatalogPayload } from "../routes/style-catalog.routes.js";
import type { Scenery, SupportedLanguage } from "../../shared/schema.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ── Locked English rejection copy (research Pattern 5 lines 217–222) ─────────

export const REJECTION_MESSAGES = {
    face_or_person:
        "Upload must be a product photo. Images containing people or faces are not supported.",
    screenshot_or_text_heavy:
        "Upload must be a product photo. Screenshots and documents are not supported.",
    explicit_content: "This image cannot be processed.",
    non_product:
        "Upload must show a physical product. Please upload a product photo.",
} as const;
export type RejectionCategory = keyof typeof REJECTION_MESSAGES;
export type PreScreenConfidence = "high" | "medium" | "low";

// ── Pre-screen prompt (research Pattern 5 lines 197–213, verbatim) ───────────

const PRE_SCREEN_PROMPT = `You are a product photo validator for a product enhancement service.
Analyze this image and classify it. Your ONLY job is to protect the service from unsuitable uploads.

REJECT if:
- The image contains a recognizable human face as the primary or prominent subject (face_or_person)
- The image is a screenshot, app UI, document, chart, or text-heavy graphic (screenshot_or_text_heavy)
- The image contains explicit/adult content (explicit_content)
- The image is clearly not a product (e.g., a landscape, abstract art, meme) with nothing that could be enhanced as a commercial product (non_product)

ACCEPT if:
- The image shows a physical product, food item, packaged good, cosmetic, electronic device, or similar commercial subject — even if imperfectly photographed.

When in doubt about whether something is a product, choose rejection_category: "none" (accept it).
Respond with: rejection_category, confidence, reason.`;

// ── Typed error hierarchy (D-14) ─────────────────────────────────────────────

export class PreScreenUnavailableError extends Error {
    constructor() {
        super(
            "We couldn't validate the image right now — please try again in a moment.",
        );
        this.name = "PreScreenUnavailableError";
    }
}

export class PreScreenRejectedError extends Error {
    constructor(
        public category: RejectionCategory,
        public confidence: PreScreenConfidence,
    ) {
        super(REJECTION_MESSAGES[category]);
        this.name = "PreScreenRejectedError";
    }
}

export class SceneryNotFoundError extends Error {
    constructor(id: string) {
        super(`Scenery preset not found: ${id}`);
        this.name = "SceneryNotFoundError";
    }
}

export class EnhancementGenerationError extends Error {
    constructor(msg: string, public cause?: unknown) {
        super(msg);
        this.name = "EnhancementGenerationError";
    }
}

export class EnhancementAbortedError extends Error {
    constructor(public stage: string) {
        super(`Enhancement aborted at stage: ${stage}`);
        this.name = "EnhancementAbortedError";
    }
}

// ── Params / progress / result contracts (D-15) ──────────────────────────────

export interface EnhancementParams {
    userId: string;
    apiKey: string;
    sceneryId: string;
    idempotencyKey: string;
    contentLanguage: SupportedLanguage;
    image: { mimeType: string; data: string }; // base64 + mimeType from the route
    signal?: AbortSignal;
    onProgress?: (event: EnhancementProgressEvent) => void;
}

export type EnhancementProgressEvent =
    | { type: "pre_screen_start" }
    | { type: "pre_screen_passed" }
    | { type: "pre_screen_rejected"; category: RejectionCategory }
    | { type: "normalize_start" }
    | { type: "normalize_complete" }
    | { type: "enhance_start" }
    | { type: "complete"; imageUrl: string; postId: string };

export interface EnhancementResult {
    postId: string;
    imageUrl: string; // result {postId}.webp public URL
    sourceImageUrl: string; // {postId}-source.webp public URL
    scenery: Scenery;
    caption: string; // F4 — generated Instagram caption (no longer null/scenery-label-stub)
    tokenTotals: {
        textInputTokens: number; // pre-screen + caption prompt tokens
        textOutputTokens: number; // pre-screen + caption completion tokens
        imageInputTokens: number; // edit-call prompt tokens
        imageOutputTokens: number; // edit-call candidate tokens
    };
    textModel: string; // "gemini-2.5-flash"
    imageModel: string; // "gemini-3.1-flash-image-preview"
}

// ── Internal types ───────────────────────────────────────────────────────────

interface GeminiUsageMetadata {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
}

interface PreScreenResult {
    rejection_category: RejectionCategory | "none";
    confidence: PreScreenConfidence;
    reason: string;
    usageMetadata?: GeminiUsageMetadata;
}

// ── Scenery resolution (reads platform_settings via cache) ───────────────────

async function resolveScenery(sceneryId: string): Promise<Scenery> {
    const catalog = await getStyleCatalogPayload();
    const scenery = catalog.sceneries?.find(
        (s) => s.id === sceneryId && s.is_active !== false,
    );
    if (!scenery) throw new SceneryNotFoundError(sceneryId);
    return scenery;
}

// ── Pre-screen call (D-05/D-07/D-08, ENHC-06) ────────────────────────────────

async function runPreScreen({
    imageMimeType,
    imageBase64,
    apiKey,
}: {
    imageMimeType: string;
    imageBase64: string;
    apiKey: string;
}): Promise<PreScreenResult> {
    const url = `${GEMINI_BASE}/${TEXT_MODEL}:generateContent`;
    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                inlineData: {
                                    mimeType: imageMimeType,
                                    data: imageBase64,
                                },
                            },
                            { text: PRE_SCREEN_PROMPT },
                        ],
                    },
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseJsonSchema: {
                        type: "object",
                        properties: {
                            rejection_category: {
                                type: "string",
                                enum: [
                                    "none",
                                    "face_or_person",
                                    "screenshot_or_text_heavy",
                                    "explicit_content",
                                    "non_product",
                                ],
                            },
                            confidence: {
                                type: "string",
                                enum: ["high", "medium", "low"],
                            },
                            reason: { type: "string" },
                        },
                        required: ["rejection_category", "confidence", "reason"],
                    },
                },
            }),
        });
    } catch {
        // Network failure — D-05 fail-closed
        throw new PreScreenUnavailableError();
    }

    if (!response.ok) {
        // HTTP non-2xx (including 5xx per AC-2) — D-05 fail-closed
        throw new PreScreenUnavailableError();
    }

    let data: any;
    try {
        data = await response.json();
    } catch {
        throw new PreScreenUnavailableError();
    }

    const usageMetadata = data?.usageMetadata as GeminiUsageMetadata | undefined;

    // Extract JSON text from candidates. Gemini with responseMimeType:
    // "application/json" returns the JSON as a text part.
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts.find((p: any) => typeof p?.text === "string");
    if (!textPart?.text) {
        throw new PreScreenUnavailableError();
    }

    let parsed: any;
    try {
        parsed = JSON.parse(textPart.text);
    } catch {
        // Try to extract the first JSON object if Gemini wrapped it
        const match = textPart.text.match(/\{[\s\S]*\}/);
        if (!match) throw new PreScreenUnavailableError();
        try {
            parsed = JSON.parse(match[0]);
        } catch {
            throw new PreScreenUnavailableError();
        }
    }

    if (
        !parsed ||
        typeof parsed.rejection_category !== "string" ||
        typeof parsed.confidence !== "string" ||
        typeof parsed.reason !== "string"
    ) {
        throw new PreScreenUnavailableError();
    }

    const allowedCategories = [
        "none",
        "face_or_person",
        "screenshot_or_text_heavy",
        "explicit_content",
        "non_product",
    ];
    const allowedConfidences = ["high", "medium", "low"];
    if (
        !allowedCategories.includes(parsed.rejection_category) ||
        !allowedConfidences.includes(parsed.confidence)
    ) {
        throw new PreScreenUnavailableError();
    }

    return {
        rejection_category: parsed.rejection_category,
        confidence: parsed.confidence,
        reason: parsed.reason,
        usageMetadata,
    };
}

// ── EXIF strip + square normalize (ENHC-03, ENHC-05) ─────────────────────────

async function stripExifAndNormalize(
    inputBuffer: Buffer,
): Promise<{ sourceBuffer: Buffer; squareBuffer: Buffer; squareSize: number }> {
    // Step A: apply EXIF orientation + strip metadata (source archive).
    // sharp's toBuffer() strips all metadata by default; autoOrient() removes
    // the Orientation tag after applying it.
    const sourceBuffer = await sharp(inputBuffer)
        .rotate()
        .webp({ quality: 90 })
        .toBuffer();

    // Step B: normalize to square for the image-model input.
    const meta = await sharp(inputBuffer).rotate().metadata();
    const squareSize = Math.max(meta.width ?? 1024, meta.height ?? 1024);
    const squareBuffer = await sharp(inputBuffer)
        .rotate()
        .resize(squareSize, squareSize, {
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .png()
        .toBuffer();

    return { sourceBuffer, squareBuffer, squareSize };
}

// ── Enhancement prompt builder (ENHC-04, research §enhancementPrompt) ────────

function buildEnhancementPrompt(scenery: Scenery): string {
    return `You are a professional product photographer and AI retoucher.

Task: Place this product in a new background scene while preserving it exactly.

Scenery: ${scenery.prompt_snippet}

CRITICAL preservation rules:
- The product's shape, silhouette, color, proportions, branding, and surface texture must remain identical.
- Do NOT alter, resize, rotate, or stylize the product itself.
- Do NOT add text, logos, or overlays.
- The product is the hero subject; the scenery is the background context only.
- If the product has a label, keep the label legible and unmodified.
- Output: 1:1 square image with the product centered and naturally lit within the scenery.`;
}

// ── Enhancement image-model call (mirrors editImage in image-generation.service) ─

async function callEnhancementImageModel({
    prompt,
    normalizedBase64,
    apiKey,
}: {
    prompt: string;
    normalizedBase64: string;
    apiKey: string;
}): Promise<{ buffer: Buffer; mimeType: string; usageMetadata?: GeminiUsageMetadata }> {
    const url = `${GEMINI_BASE}/${IMAGE_MODEL}:generateContent`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: "image/png",
                                data: normalizedBase64,
                            },
                        },
                    ],
                },
            ],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
    });

    if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        const msg = errBody?.error?.message || `Image model returned ${response.status}`;
        throw new EnhancementGenerationError(`enhancement image call failed: ${msg}`);
    }

    const data = await response.json();
    const usageMetadata = data?.usageMetadata as GeminiUsageMetadata | undefined;
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find(
        (p: any) => p?.inlineData?.mimeType?.startsWith("image/"),
    );
    if (!imagePart?.inlineData?.data) {
        throw new EnhancementGenerationError(
            "enhancement image call returned no image part",
        );
    }

    return {
        buffer: Buffer.from(imagePart.inlineData.data, "base64"),
        mimeType: imagePart.inlineData.mimeType || "image/png",
        usageMetadata,
    };
}

// ── Caption generation (F4 — D-10/D-11/D-12) ─────────────────────────────────
// Mirrors carousel-generation.service.ts caption pattern: same TEXT_MODEL,
// same JSON response shape, same usageMetadata extraction. Used to replace
// the original ENHC-08 stub (which left caption empty).

interface CaptionResult {
    caption: string;
    usageMetadata?: GeminiUsageMetadata;
}

async function generateEnhancementCaption({
    scenery,
    contentLanguage,
    apiKey,
}: {
    scenery: Scenery;
    contentLanguage: SupportedLanguage;
    apiKey: string;
}): Promise<CaptionResult> {
    const prompt = `You are an Instagram copywriter for a product photography service.

Write a single Instagram caption (1-2 sentences) for a product photo that has just been placed in this scenery: "${scenery.label}".

Scenery context: ${scenery.prompt_snippet}

Requirements:
- 1-2 sentences, conversational tone, Instagram-ready
- Mention the visual mood or atmosphere implied by the scenery (do NOT name a specific product — the AI doesn't know what the product is)
- Include 2-4 relevant lowercase hashtags at the end (e.g. #productphotography)
- Caption is written in ${contentLanguage}
- No emojis at the start; up to 2 emojis sprinkled naturally is fine
- Do not include quotation marks around the caption

Return ONLY valid JSON with this exact shape:
{
  "caption": "Your Instagram-ready caption with hashtags here."
}`;

    const response = await fetch(`${GEMINI_BASE}/${TEXT_MODEL}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.8,
                maxOutputTokens: 512,
                responseMimeType: "application/json",
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new EnhancementGenerationError(
            `caption generation HTTP ${response.status}: ${errText}`,
        );
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text.trim()) {
        throw new EnhancementGenerationError(
            "caption generation returned empty response",
        );
    }

    // Parse strategy: try direct JSON match first, then fenced code block.
    let parsed: any;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            parsed = JSON.parse(jsonMatch[0]);
        } catch {
            const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (codeBlockMatch) {
                parsed = JSON.parse(codeBlockMatch[1]);
            } else {
                throw new EnhancementGenerationError(
                    "caption generation returned unparsable JSON",
                );
            }
        }
    } else {
        throw new EnhancementGenerationError(
            "caption generation returned no JSON",
        );
    }

    if (typeof parsed?.caption !== "string" || !parsed.caption.trim()) {
        throw new EnhancementGenerationError(
            "caption generation returned empty caption field",
        );
    }

    return {
        caption: parsed.caption.trim(),
        usageMetadata: data.usageMetadata as GeminiUsageMetadata | undefined,
    };
}

// ── Storage uploads (D-16 deterministic paths) ───────────────────────────────

async function uploadEnhancementArtifacts({
    admin,
    userId,
    postId,
    sourceBuffer,
    resultBuffer,
}: {
    admin: SupabaseClient;
    userId: string;
    postId: string;
    sourceBuffer: Buffer;
    resultBuffer: Buffer;
}): Promise<{ imageUrl: string; sourceImageUrl: string }> {
    const sourcePath = `${userId}/enhancement/${postId}-source.webp`;
    const resultPath = `${userId}/enhancement/${postId}.webp`;

    const up1 = await admin.storage.from("user_assets").upload(sourcePath, sourceBuffer, {
        contentType: "image/webp",
        upsert: false,
    });
    if (up1.error) {
        throw new EnhancementGenerationError(
            `source upload failed: ${up1.error.message}`,
        );
    }

    const up2 = await admin.storage.from("user_assets").upload(resultPath, resultBuffer, {
        contentType: "image/webp",
        upsert: false,
    });
    if (up2.error) {
        throw new EnhancementGenerationError(
            `result upload failed: ${up2.error.message}`,
        );
    }

    const sourceUrl = admin.storage.from("user_assets").getPublicUrl(sourcePath).data.publicUrl;
    const resultUrl = admin.storage.from("user_assets").getPublicUrl(resultPath).data.publicUrl;
    return { sourceImageUrl: sourceUrl, imageUrl: resultUrl };
}

// ── Entrypoint ───────────────────────────────────────────────────────────────

export async function enhanceProductPhoto(
    params: EnhancementParams,
): Promise<EnhancementResult> {
    const postId = randomUUID();

    // Resolve scenery BEFORE any Gemini calls (fail fast per AC-9).
    const scenery = await resolveScenery(params.sceneryId);

    // ── Stage 1: pre-screen (D-05/D-07/D-08, ENHC-06) ──────────────────────
    params.onProgress?.({ type: "pre_screen_start" });
    if (params.signal?.aborted) {
        throw new EnhancementAbortedError("pre_screen");
    }

    let preScreen: PreScreenResult;
    try {
        preScreen = await runPreScreen({
            imageMimeType: params.image.mimeType,
            imageBase64: params.image.data,
            apiKey: params.apiKey,
        });
    } catch (err) {
        // D-05: fail-closed on pre-screen infra failure. Normalize any
        // unexpected error to PreScreenUnavailableError.
        if (err instanceof PreScreenUnavailableError) throw err;
        throw new PreScreenUnavailableError();
    }

    // D-07 gate: reject only on high/medium confidence.
    if (
        preScreen.rejection_category !== "none" &&
        (preScreen.confidence === "high" || preScreen.confidence === "medium")
    ) {
        const category = preScreen.rejection_category as RejectionCategory;
        params.onProgress?.({ type: "pre_screen_rejected", category });
        throw new PreScreenRejectedError(category, preScreen.confidence);
    }
    // Accept path: category === "none" OR confidence === "low"
    params.onProgress?.({ type: "pre_screen_passed" });

    // ── Stage 2: normalize + EXIF strip (ENHC-03, ENHC-05) ─────────────────
    if (params.signal?.aborted) {
        throw new EnhancementAbortedError("normalize");
    }
    params.onProgress?.({ type: "normalize_start" });
    const inputBuffer = Buffer.from(params.image.data, "base64");
    const { sourceBuffer, squareBuffer } = await stripExifAndNormalize(inputBuffer);
    params.onProgress?.({ type: "normalize_complete" });

    // ── Stage 3: image-model edit call (ENHC-04) ───────────────────────────
    if (params.signal?.aborted) {
        throw new EnhancementAbortedError("enhance");
    }
    params.onProgress?.({ type: "enhance_start" });
    const prompt = buildEnhancementPrompt(scenery);
    const edit = await callEnhancementImageModel({
        prompt,
        normalizedBase64: squareBuffer.toString("base64"),
        apiKey: params.apiKey,
    });

    // Post-call re-squaring defense (research Open Question 3). The editing
    // model *may* return a non-square buffer; re-square with contain + white
    // background so stored result.webp dimensions are guaranteed 1:1.
    let resultPreEncodeBuffer = edit.buffer;
    try {
        const resultMeta = await sharp(edit.buffer).metadata();
        if (
            typeof resultMeta.width === "number" &&
            typeof resultMeta.height === "number" &&
            resultMeta.width !== resultMeta.height
        ) {
            console.warn(
                "[enhancement] result was non-square; re-squaring before upload",
            );
            const size = Math.max(resultMeta.width, resultMeta.height);
            resultPreEncodeBuffer = await sharp(edit.buffer)
                .resize(size, size, {
                    fit: "contain",
                    background: { r: 255, g: 255, b: 255, alpha: 1 },
                })
                .toBuffer();
        }
    } catch {
        // If metadata read fails, fall through to the encode step and let
        // sharp surface the error there if the buffer is unreadable.
    }

    // Re-encode result as WebP, strip any lingering metadata
    const resultWebp = await sharp(resultPreEncodeBuffer)
        .rotate()
        .webp({ quality: 90 })
        .toBuffer();

    // ── Stage 3.5: caption generation (F4 — D-10/D-11) ─────────────────────
    if (params.signal?.aborted) {
        throw new EnhancementAbortedError("caption");
    }
    const captionResult = await generateEnhancementCaption({
        scenery,
        contentLanguage: params.contentLanguage,
        apiKey: params.apiKey,
    });

    // ── Stage 4: upload + DB insert (D-16, D-17) ───────────────────────────
    const admin = createAdminSupabase();
    const { imageUrl, sourceImageUrl } = await uploadEnhancementArtifacts({
        admin,
        userId: params.userId,
        postId,
        sourceBuffer,
        resultBuffer: resultWebp,
    });

    const { error: postErr } = await admin.from("posts").insert({
        id: postId,
        user_id: params.userId,
        image_url: imageUrl,
        thumbnail_url: null, // ENHC v1.1 — no separate thumbnail
        content_type: "enhancement",
        slide_count: null,
        idempotency_key: params.idempotencyKey,
        caption: captionResult.caption, // F4: real caption — re-spec'd ENHC-08
        ai_prompt_used: prompt,
        status: "completed",
    });
    if (postErr) {
        throw new EnhancementGenerationError(
            `posts insert failed: ${postErr.message}`,
        );
    }

    params.onProgress?.({ type: "complete", imageUrl, postId });

    return {
        postId,
        imageUrl,
        sourceImageUrl,
        scenery,
        caption: captionResult.caption, // F4
        tokenTotals: {
            textInputTokens:
                (preScreen.usageMetadata?.promptTokenCount ?? 0) +
                (captionResult.usageMetadata?.promptTokenCount ?? 0),
            textOutputTokens:
                (preScreen.usageMetadata?.candidatesTokenCount ?? 0) +
                (captionResult.usageMetadata?.candidatesTokenCount ?? 0),
            imageInputTokens: edit.usageMetadata?.promptTokenCount ?? 0,
            imageOutputTokens: edit.usageMetadata?.candidatesTokenCount ?? 0,
        },
        textModel: TEXT_MODEL,
        imageModel: IMAGE_MODEL,
    };
}
