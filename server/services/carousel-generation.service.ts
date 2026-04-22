/**
 * Carousel Generation Service (v1.1, Phase 6)
 * One master text call + N sequential image calls with thoughtSignature propagation.
 * Owns: storage upload + posts/post_slides DB writes (per D-16/D-17).
 * Does NOT own: route plumbing, SSE writer, credit deduction, idempotency lookup.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "../supabase.js";
import { uploadFile } from "../storage.js";
import { processImageWithThumbnail } from "./image-optimization.service.js";
import { ensureCaptionQuality } from "./caption-quality.service.js";
import type { Brand, StyleCatalog, SupportedLanguage } from "../../shared/schema.js";

// ── Constants (D-02, D-03) ───────────────────────────────────────────────────

export const SLIDE_GENERATION_DELAY_MS = 3000; // D-02
export const RATE_LIMIT_BACKOFF_MS = 15_000; // D-03
export const ALLOWED_ASPECT_RATIOS = ["1:1", "4:5"] as const;
export type CarouselAspectRatio = typeof ALLOWED_ASPECT_RATIOS[number];

const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ── Typed error hierarchy (D-14) ─────────────────────────────────────────────

export class CarouselTextPlanError extends Error {
    constructor(msg: string, public cause?: unknown) {
        super(msg);
        this.name = "CarouselTextPlanError";
    }
}

export class SlideGenerationError extends Error {
    constructor(msg: string, public slideNumber: number, public cause?: unknown) {
        super(msg);
        this.name = "SlideGenerationError";
    }
}

export class CarouselAbortedError extends Error {
    constructor(public savedSlideCount: number) {
        super(`Carousel aborted after ${savedSlideCount} slide(s)`);
        this.name = "CarouselAbortedError";
    }
}

export class CarouselFullFailureError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "CarouselFullFailureError";
    }
}

export class CarouselInvalidAspectError extends Error {
    constructor(aspect: string) {
        super(`Invalid aspect ratio for carousel: ${aspect}. Allowed: 1:1, 4:5.`);
        this.name = "CarouselInvalidAspectError";
    }
}

// ── Params / progress / result contracts (D-15) ──────────────────────────────

export interface CarouselGenerationParams {
    userId: string;
    apiKey: string; // user's Gemini key
    brand: Brand;
    styleCatalog: StyleCatalog;
    prompt: string;
    slideCount: number; // 3..8 enforced by route schema
    aspectRatio: CarouselAspectRatio; // "1:1" | "4:5"
    postMood: string;
    contentLanguage: SupportedLanguage;
    idempotencyKey: string;
    textStyleIds?: string[];
    useLogo?: boolean;
    logoPosition?: string;
    signal?: AbortSignal;
    onProgress?: (event: CarouselProgressEvent) => void;
}

export type CarouselProgressEvent =
    | { type: "text_plan_start" }
    | { type: "text_plan_complete"; captionPreview: string }
    | { type: "slide_start"; slideNumber: number }
    | { type: "slide_complete"; slideNumber: number; imageUrl: string }
    | { type: "slide_failed"; slideNumber: number; reason: string }
    | { type: "complete"; savedSlideCount: number; status: "completed" | "draft" };

export interface CarouselSlideResult {
    slideNumber: number;
    imageUrl: string;
    thumbnailUrl: string | null;
}

export interface CarouselGenerationResult {
    postId: string;
    status: "completed" | "draft";
    slideCount: number; // actual successful slides
    slides: CarouselSlideResult[];
    caption: string;
    sharedStyle: string;
    tokenTotals: {
        textInputTokens: number;
        textOutputTokens: number;
        imageInputTokens: number; // summed across N image calls
        imageOutputTokens: number;
    };
    textModel: string;
    imageModel: string;
}

// ── Internal types ───────────────────────────────────────────────────────────

interface GeminiUsageMetadata {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
}

interface CarouselTextPlan {
    shared_style: string;
    slides: Array<{ slide_number: number; image_prompt: string }>;
    caption: string;
}

interface SlideOneResult {
    buffer: Buffer;
    thoughtSignature: string | null;
    usageMetadata?: GeminiUsageMetadata;
    rawBase64: string;
    mimeType: string;
}

interface SlideNResult {
    buffer: Buffer;
    usageMetadata?: GeminiUsageMetadata;
}

// ── Prompt builder (research §Code Examples lines 368–397) ───────────────────

function buildCarouselMasterPrompt(params: CarouselGenerationParams): string {
    const { brand, postMood, aspectRatio, prompt, contentLanguage, slideCount } = params;
    return `You are an Art Director planning a ${slideCount}-slide Instagram carousel for ${brand.company_name}.

Brand: ${brand.company_name} (${brand.company_type})
Colors: ${brand.color_1}, ${brand.color_2}${brand.color_3 ? ", " + brand.color_3 : ""}
Mood: ${postMood}
Aspect ratio: ${aspectRatio}
User direction: ${prompt}
Language: ${contentLanguage}

Return ONLY valid JSON with this exact shape:
{
  "shared_style": "Dense visual style descriptor (2-3 sentences): lighting setup, color palette, composition style, mood, texture, typography direction. Must be specific enough that an image generator can reproduce the same visual feel across all slides.",
  "slides": [
    { "slide_number": 1, "image_prompt": "Self-contained image prompt for slide 1 incorporating the shared style. No text on image." }
  ],
  "caption": "Unified Instagram caption for the carousel post with hashtags."
}

Requirements:
- slide_number starts at 1
- Each image_prompt is self-contained (includes shared_style inline)
- caption is written in ${contentLanguage}
- No on-image text (CRSL-10: text rendering skipped for carousel in v1.1)
- All ${slideCount} slides must be present`;
}

// ── JSON parse strategies (mirror gemini.service.ts:652-666) ─────────────────

function parseGeminiJson(text: string): any {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch {
            // fall through to strategy 2
        }
    }
    const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1]);
    }
    if (jsonMatch) {
        // Surface the original parse error from strategy 1 if strategy 2 also
        // didn't apply.
        return JSON.parse(jsonMatch[0]);
    }
    throw new Error("no_json_found");
}

function validateCarouselTextPlan(parsed: any, expectedSlideCount: number): CarouselTextPlan {
    if (!parsed || typeof parsed !== "object") {
        throw new Error("plan is not an object");
    }
    if (typeof parsed.shared_style !== "string" || !parsed.shared_style.trim()) {
        throw new Error("plan.shared_style must be a non-empty string");
    }
    if (typeof parsed.caption !== "string" || !parsed.caption.trim()) {
        throw new Error("plan.caption must be a non-empty string");
    }
    if (!Array.isArray(parsed.slides) || parsed.slides.length !== expectedSlideCount) {
        throw new Error(
            `plan.slides must be an array of length ${expectedSlideCount} (got ${Array.isArray(parsed.slides) ? parsed.slides.length : typeof parsed.slides})`,
        );
    }
    for (const s of parsed.slides) {
        if (!s || typeof s !== "object") throw new Error("plan.slides entry is not an object");
        if (typeof s.slide_number !== "number") throw new Error("plan.slides[].slide_number must be a number");
        if (typeof s.image_prompt !== "string" || !s.image_prompt.trim()) {
            throw new Error("plan.slides[].image_prompt must be a non-empty string");
        }
    }
    return {
        shared_style: parsed.shared_style,
        slides: parsed.slides.map((s: any) => ({
            slide_number: s.slide_number,
            image_prompt: s.image_prompt,
        })),
        caption: parsed.caption,
    };
}

// ── Master text call (D-04, CRSL-02) ─────────────────────────────────────────

async function callCarouselTextPlan(
    params: CarouselGenerationParams,
    attempt: 1 | 2,
): Promise<{ plan: CarouselTextPlan; usageMetadata?: GeminiUsageMetadata }> {
    const basePrompt = buildCarouselMasterPrompt(params);
    const prompt =
        attempt === 2
            ? `${basePrompt}\n\nFINAL INSTRUCTION: Respond ONLY with a valid JSON object matching the schema described above. No prose, no markdown fences.`
            : basePrompt;

    const response = await fetch(`${GEMINI_BASE}/${TEXT_MODEL}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": params.apiKey,
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: attempt === 1 ? 0.7 : 0.2,
                maxOutputTokens: 2048,
                responseMimeType: "application/json",
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Gemini text plan HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text.trim()) {
        const finishReason = data?.candidates?.[0]?.finishReason;
        throw new Error(`Gemini text plan returned empty response (finishReason=${finishReason})`);
    }

    const parsed = parseGeminiJson(text);
    const plan = validateCarouselTextPlan(parsed, params.slideCount);
    const usageMetadata = data.usageMetadata as GeminiUsageMetadata | undefined;
    return { plan, usageMetadata };
}

// ── Slide 1 single-turn image call ───────────────────────────────────────────

async function generateSlideOne(
    params: CarouselGenerationParams,
    plan: CarouselTextPlan,
): Promise<SlideOneResult> {
    const prompt = `${plan.shared_style}\n\n${plan.slides[0].image_prompt}`;
    const response = await fetch(`${GEMINI_BASE}/${IMAGE_MODEL}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": params.apiKey,
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: params.aspectRatio, imageSize: "1K" },
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Slide 1 HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p?.inlineData?.mimeType?.startsWith("image/"));
    if (!imagePart?.inlineData?.data) {
        throw new Error("Slide 1: no image part returned");
    }

    const thoughtSignature: string | null =
        typeof imagePart.thoughtSignature === "string" && imagePart.thoughtSignature.length > 0
            ? imagePart.thoughtSignature
            : null;

    return {
        buffer: Buffer.from(imagePart.inlineData.data, "base64"),
        thoughtSignature,
        usageMetadata: data.usageMetadata as GeminiUsageMetadata | undefined,
        rawBase64: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType ?? "image/png",
    };
}

// ── Slides 2..N multi-turn with thoughtSignature (CRSL-03) ───────────────────

async function generateSlideNWithSignature(args: {
    slideIndex: number;
    plan: CarouselTextPlan;
    params: CarouselGenerationParams;
    slide1Base64: string;
    slide1MimeType: string;
    slide1ThoughtSignature: string;
}): Promise<SlideNResult> {
    const { slideIndex, plan, params, slide1Base64, slide1MimeType, slide1ThoughtSignature } = args;

    const modelPart: Record<string, unknown> = {
        inlineData: { mimeType: slide1MimeType, data: slide1Base64 },
        thoughtSignature: slide1ThoughtSignature,
    };

    const userText = `${plan.shared_style}\n\n${plan.slides[slideIndex].image_prompt}\nMatch the visual style, lighting, and color palette of the reference image exactly.`;

    const response = await fetch(`${GEMINI_BASE}/${IMAGE_MODEL}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": params.apiKey,
        },
        body: JSON.stringify({
            contents: [
                { role: "model", parts: [modelPart] },
                { role: "user", parts: [{ text: userText }] },
            ],
            generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: params.aspectRatio, imageSize: "1K" },
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Slide ${slideIndex + 1} multi-turn HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p?.inlineData?.mimeType?.startsWith("image/"));
    if (!imagePart?.inlineData?.data) {
        throw new Error(`Slide ${slideIndex + 1} multi-turn: no image part returned`);
    }

    return {
        buffer: Buffer.from(imagePart.inlineData.data, "base64"),
        usageMetadata: data.usageMetadata as GeminiUsageMetadata | undefined,
    };
}

// ── Slides 2..N single-turn fallback (D-06) ──────────────────────────────────

async function generateSlideNFallbackSingleTurn(args: {
    slideIndex: number;
    plan: CarouselTextPlan;
    params: CarouselGenerationParams;
    slide1Base64: string;
    slide1MimeType: string;
}): Promise<SlideNResult> {
    const { slideIndex, plan, params, slide1Base64, slide1MimeType } = args;
    const text = `${plan.shared_style}\n\n${plan.slides[slideIndex].image_prompt}\nReference the visual style, color palette, lighting, and composition of the attached image.`;

    const response = await fetch(`${GEMINI_BASE}/${IMAGE_MODEL}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": params.apiKey,
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        { text },
                        { inlineData: { mimeType: slide1MimeType, data: slide1Base64 } },
                    ],
                },
            ],
            generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: params.aspectRatio, imageSize: "1K" },
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Slide ${slideIndex + 1} fallback HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p?.inlineData?.mimeType?.startsWith("image/"));
    if (!imagePart?.inlineData?.data) {
        throw new Error(`Slide ${slideIndex + 1} fallback: no image part returned`);
    }

    return {
        buffer: Buffer.from(imagePart.inlineData.data, "base64"),
        usageMetadata: data.usageMetadata as GeminiUsageMetadata | undefined,
    };
}

// ── 429 / RESOURCE_EXHAUSTED single retry (D-03) ─────────────────────────────

async function runSlideWithRetry<T>(
    generateFn: () => Promise<T>,
    slideNumber: number,
): Promise<T> {
    try {
        return await generateFn();
    } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (/\b429\b|RESOURCE_EXHAUSTED/i.test(msg)) {
            console.warn(`[carousel] slide ${slideNumber} rate-limited — retrying once after ${RATE_LIMIT_BACKOFF_MS}ms`);
            await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
            try {
                return await generateFn();
            } catch (retryErr: any) {
                throw new SlideGenerationError(
                    `Slide ${slideNumber} failed after 429 retry: ${String(retryErr?.message ?? retryErr)}`,
                    slideNumber,
                    retryErr,
                );
            }
        }
        throw err;
    }
}

// ── Deterministic per-slide upload (CONTEXT §specifics line 153) ─────────────

async function uploadSlideBuffer(
    admin: SupabaseClient,
    userId: string,
    postId: string,
    slideNumber: number,
    buffer: Buffer,
): Promise<{ imageUrl: string; thumbnailUrl: string }> {
    const { image, thumbnail } = await processImageWithThumbnail(buffer);

    // Deterministic path per CONTEXT.md specifics: user_assets/{userId}/carousel/{postId}/slide-{N}.webp
    const baseFolder = `${userId}/carousel/${postId}`;
    const imagePath = `${baseFolder}/slide-${slideNumber}.webp`;
    const thumbPath = `${baseFolder}/slide-${slideNumber}-thumb.webp`;

    const { error: imgErr } = await admin.storage
        .from("user_assets")
        .upload(imagePath, image.buffer, { contentType: "image/webp", upsert: false });
    if (imgErr) {
        throw new Error(`slide ${slideNumber} image upload failed: ${imgErr.message}`);
    }
    const { data: imgPublic } = admin.storage.from("user_assets").getPublicUrl(imagePath);

    const { error: thumbErr } = await admin.storage
        .from("user_assets")
        .upload(thumbPath, thumbnail.buffer, { contentType: "image/webp", upsert: false });
    if (thumbErr) {
        throw new Error(`slide ${slideNumber} thumbnail upload failed: ${thumbErr.message}`);
    }
    const { data: thumbPublic } = admin.storage.from("user_assets").getPublicUrl(thumbPath);

    return { imageUrl: imgPublic.publicUrl, thumbnailUrl: thumbPublic.publicUrl };
}

// ── Public entrypoint ────────────────────────────────────────────────────────

export async function generateCarousel(
    params: CarouselGenerationParams,
): Promise<CarouselGenerationResult> {
    // AC-12: aspect ratio guard (synchronous, before any Gemini call)
    if (!(ALLOWED_ASPECT_RATIOS as readonly string[]).includes(params.aspectRatio)) {
        throw new CarouselInvalidAspectError(params.aspectRatio);
    }

    const postId = randomUUID();

    // ── Phase 1: master text plan (D-04) ───────────────────────────────────
    params.onProgress?.({ type: "text_plan_start" });

    let plan: CarouselTextPlan;
    let textUsage: GeminiUsageMetadata | undefined;
    try {
        const first = await callCarouselTextPlan(params, 1);
        plan = first.plan;
        textUsage = first.usageMetadata;
    } catch (firstError) {
        console.warn(
            `[carousel] master text plan attempt 1 failed — retrying with tightened prompt:`,
            String((firstError as Error)?.message ?? firstError),
        );
        try {
            const second = await callCarouselTextPlan(params, 2);
            plan = second.plan;
            textUsage = second.usageMetadata;
        } catch (secondError) {
            throw new CarouselTextPlanError(
                "Master text plan returned invalid JSON after retry",
                secondError,
            );
        }
    }

    params.onProgress?.({
        type: "text_plan_complete",
        captionPreview: plan.caption.slice(0, 80),
    });

    // ── Phase 2: sequential slide generation loop (D-01, D-02) ─────────────
    const admin = createAdminSupabase();
    const successfulSlides: CarouselSlideResult[] = [];
    let slide1Succeeded = false;
    let slide1Base64: string | null = null;
    let slide1MimeType: string | null = null;
    let slide1ThoughtSignature: string | null = null;
    let imageInputTokensTotal = 0;
    let imageOutputTokensTotal = 0;

    for (let i = 0; i < params.slideCount; i++) {
        // CRSL-06 / D-15: abort check between slides (also before slide 1 so
        // a pre-loop abort short-circuits cleanly).
        if (params.signal?.aborted) {
            break;
        }

        // D-02: 3s delay between slides — NOT before slide 1, NOT after last
        if (i > 0) {
            await new Promise((r) => setTimeout(r, SLIDE_GENERATION_DELAY_MS));
        }

        params.onProgress?.({ type: "slide_start", slideNumber: i + 1 });

        try {
            let buffer: Buffer;
            let usage: GeminiUsageMetadata | undefined;

            if (i === 0) {
                const result = await runSlideWithRetry(
                    () => generateSlideOne(params, plan),
                    1,
                );
                buffer = result.buffer;
                usage = result.usageMetadata;
                slide1Base64 = result.rawBase64;
                slide1MimeType = result.mimeType;
                slide1ThoughtSignature = result.thoughtSignature;
                slide1Succeeded = true;
            } else {
                // Slides 2..N: multi-turn first if sig present, else single-turn fallback
                if (slide1ThoughtSignature) {
                    try {
                        const result = await runSlideWithRetry(
                            () =>
                                generateSlideNWithSignature({
                                    slideIndex: i,
                                    plan,
                                    params,
                                    slide1Base64: slide1Base64!,
                                    slide1MimeType: slide1MimeType!,
                                    slide1ThoughtSignature: slide1ThoughtSignature!,
                                }),
                            i + 1,
                        );
                        buffer = result.buffer;
                        usage = result.usageMetadata;
                    } catch (multiTurnErr: any) {
                        const msg = String(multiTurnErr?.message ?? "").toLowerCase();
                        if (msg.includes("thought signature") || msg.includes("thoughtsignature")) {
                            console.warn(
                                `[carousel] thoughtSignature rejected for slide ${i + 1} — using single-turn fallback`,
                            );
                            const result = await runSlideWithRetry(
                                () =>
                                    generateSlideNFallbackSingleTurn({
                                        slideIndex: i,
                                        plan,
                                        params,
                                        slide1Base64: slide1Base64!,
                                        slide1MimeType: slide1MimeType!,
                                    }),
                                i + 1,
                            );
                            buffer = result.buffer;
                            usage = result.usageMetadata;
                        } else {
                            throw multiTurnErr;
                        }
                    }
                } else {
                    console.warn(
                        `[carousel] thoughtSignature absent for slide ${i + 1} — using single-turn fallback`,
                    );
                    const result = await runSlideWithRetry(
                        () =>
                            generateSlideNFallbackSingleTurn({
                                slideIndex: i,
                                plan,
                                params,
                                slide1Base64: slide1Base64!,
                                slide1MimeType: slide1MimeType!,
                            }),
                        i + 1,
                    );
                    buffer = result.buffer;
                    usage = result.usageMetadata;
                }
            }

            imageInputTokensTotal += usage?.promptTokenCount ?? 0;
            imageOutputTokensTotal += usage?.candidatesTokenCount ?? 0;

            const { imageUrl, thumbnailUrl } = await uploadSlideBuffer(
                admin,
                params.userId,
                postId,
                i + 1,
                buffer,
            );
            successfulSlides.push({ slideNumber: i + 1, imageUrl, thumbnailUrl });
            params.onProgress?.({ type: "slide_complete", slideNumber: i + 1, imageUrl });
        } catch (err: any) {
            const reason = String(err?.message ?? err);
            console.warn(`[carousel] slide ${i + 1} failed:`, reason);
            params.onProgress?.({ type: "slide_failed", slideNumber: i + 1, reason });
            // continue — partial-success contract absorbs this
        }
    }

    // ── Phase 3: partial-success contract (CRSL-10) ────────────────────────
    const aborted = params.signal?.aborted === true;

    if (!slide1Succeeded || successfulSlides.length === 0) {
        throw new CarouselFullFailureError(
            `Carousel generation failed: slide 1 did not complete. ${successfulSlides.length}/${params.slideCount} slides succeeded.`,
        );
    }

    const successRate = successfulSlides.length / params.slideCount;
    if (successRate < 0.5) {
        throw new CarouselFullFailureError(
            `Below 50% threshold: ${successfulSlides.length}/${params.slideCount} slides succeeded.`,
        );
    }

    const postStatus: "completed" | "draft" =
        successfulSlides.length === params.slideCount ? "completed" : "draft";

    // ── Phase 4: unified caption quality check (CRSL-09 — exactly once) ────
    const finalCaption = await ensureCaptionQuality({
        apiKey: params.apiKey,
        brandName: params.brand.company_name,
        companyType: params.brand.company_type,
        contentLanguage: params.contentLanguage,
        promptContext: params.prompt,
        candidateCaption: plan.caption,
        scenarioType: params.postMood,
        mode: "create",
    });

    // ── Phase 5: persist (D-17 service owns DB writes) ─────────────────────
    const { error: postErr } = await admin.from("posts").insert({
        id: postId,
        user_id: params.userId,
        image_url: successfulSlides[0].imageUrl, // cover = slide 1 (GLRY-01 contract)
        thumbnail_url: successfulSlides[0].thumbnailUrl,
        content_type: "carousel",
        slide_count: successfulSlides.length, // ACTUAL count (Pitfall 6)
        idempotency_key: params.idempotencyKey,
        caption: finalCaption,
        ai_prompt_used: params.prompt,
        status: postStatus,
    });
    if (postErr) {
        throw new Error(`posts insert failed: ${postErr.message}`);
    }

    const slideRows = successfulSlides.map((s) => ({
        post_id: postId,
        slide_number: s.slideNumber,
        image_url: s.imageUrl,
        thumbnail_url: s.thumbnailUrl,
    }));
    const { error: slidesErr } = await admin.from("post_slides").insert(slideRows);
    if (slidesErr) {
        throw new Error(`post_slides insert failed: ${slidesErr.message}`);
    }

    // ── Phase 6: emit `complete` + (if aborted) throw after persistence ────
    params.onProgress?.({
        type: "complete",
        savedSlideCount: successfulSlides.length,
        status: postStatus,
    });

    if (aborted) {
        throw new CarouselAbortedError(successfulSlides.length);
    }

    return {
        postId,
        status: postStatus,
        slideCount: successfulSlides.length,
        slides: successfulSlides,
        caption: finalCaption,
        sharedStyle: plan.shared_style,
        tokenTotals: {
            textInputTokens: textUsage?.promptTokenCount ?? 0,
            textOutputTokens: textUsage?.candidatesTokenCount ?? 0,
            imageInputTokens: imageInputTokensTotal,
            imageOutputTokens: imageOutputTokensTotal,
        },
        textModel: TEXT_MODEL,
        imageModel: IMAGE_MODEL,
    };
}

// ── Keep `uploadFile` referenced so future non-carousel callers of the service
// module can continue to import the helper (D-16 declares services own upload;
// the deterministic `admin.storage.from(...).upload()` path above is the
// CONTEXT.md §specifics-mandated path for per-slide naming, but the generic
// `uploadFile()` helper remains the intended one for any non-slide writes).
void uploadFile;
