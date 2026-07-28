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
import { processImageWithThumbnail, applyLogoOverlay, type LogoPosition } from "./image-optimization.service.js";
import { ensureCaptionQuality } from "./caption-quality.service.js";
import { downloadImageAsBase64, formatBrandColorsProportional } from "./prompt-builder.service.js";
import type { Brand, StyleCatalog, SupportedLanguage, TextBlock } from "../../shared/schema.js";
import type { ImageProvider, ReferenceImage } from "./image-provider.js";
import { chatCompletion } from "./ai-gateway.service.js";
import { getCallRouting } from "./ai-gateway-settings.service.js";
import { config } from "../config/index.js";
import { resolveCatalogEntries, buildStyleArtDirectionBlock, buildNegativePromptBlock } from "./style-art-direction.service.js";
import type { LayoutArchetypeId } from "./planning-schema.service.js";
// Phase 25 (CRSL2-01): the carousel narrative-plan contract — dual-dialect
// structured-output schemas (never cross-wired, 25-RESEARCH.md Pitfall 4),
// the deterministic role assigner, and the inter-slide composition-variation
// check. NOTE: the real file is carousel-plan-schema.SERVICE.ts (this import
// specifier mirrors this project's established .service.js convention).
import {
    type SlideRole,
    CAROUSEL_PLAN_JSON_SCHEMA,
    CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA,
    CAROUSEL_PLAN_TOKEN_BASE,
    CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE,
    CarouselPlanSchemaError,
    validateCarouselWirePlan,
    assignSlideRoles,
    findDuplicateCompositionNotes,
} from "./carousel-plan-schema.service.js";

// ── Constants (D-02, D-03) ───────────────────────────────────────────────────

export const SLIDE_GENERATION_DELAY_MS = 3000; // D-02
export const RATE_LIMIT_BACKOFF_MS = 15_000; // D-03
export const ALLOWED_ASPECT_RATIOS = ["1:1", "4:5"] as const;
export type CarouselAspectRatio = typeof ALLOWED_ASPECT_RATIOS[number];

// ── Phase 22 (PLAN-03) established output-token scaling with slide count;
// Phase 25 (CRSL2-01) bumps the per-slide budget 350 -> 700 now that every
// slide carries a composition_note + up to 3 text_blocks + a role tag, none of
// which existed in the old minimal {slide_number, image_prompt} shape. Both
// constants are re-exported verbatim from carousel-plan-schema.service.ts (the
// single source of truth for the narrative-plan contract) so this file and
// that module can never drift apart on the token budget. 8-slide worst case:
// 1200 + 700*8 = 6800 tokens, far under the 65,536 completion ceiling of every
// structured-outputs-capable Gemini slug. slideCount is clamped to the route
// schema's own 3..8 bounds so a bad caller can never produce a negative or
// absurd ceiling.
export const CAROUSEL_TOKEN_BASE = CAROUSEL_PLAN_TOKEN_BASE;       // shared_style + caption + JSON scaffolding
export const CAROUSEL_TOKENS_PER_SLIDE = CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE;  // composition_note + up to 3 text_blocks + role per slide
export function carouselPlanMaxTokens(slideCount: number): number {
    const slides = Math.max(3, Math.min(8, Math.floor(slideCount) || 3));
    return CAROUSEL_TOKEN_BASE + CAROUSEL_TOKENS_PER_SLIDE * slides;
}

const TEXT_MODEL = "gemini-2.5-flash";
// Label only — used as the imageModel string in result metadata when the
// active provider is Gemini. Actual image generation goes through the
// provider abstraction (server/services/image-provider.ts), NOT this constant.
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
    apiKey: string; // user's Gemini key (used for text/master-plan call — NOT replaced by provider)
    imageProvider: ImageProvider; // Phase 12 — injected by route
    imageApiKey?: string; // overrides apiKey for image calls when provider != gemini
    openRouterApiKey?: string; // Phase 21.1 (GATE-06): affiliate's own OpenRouter key for text/planning calls
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
    costUsdMicrosTotal?: number; // Phase 21 GATE-05: summed gateway usage.cost (text plan + all slides); undefined when 0 (all-direct run)
}

// ── Internal types ───────────────────────────────────────────────────────────

interface GeminiUsageMetadata {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
}

// Phase 25 (CRSL2-01): field-for-field mirror of carousel-plan-schema.service.ts's
// CarouselWirePlan wire contract (shared_style + ONE carousel-level
// layout_archetype_id + per-slide role/composition_note/text_blocks + caption).
// Kept as a distinct `interface` (not `type CarouselTextPlan = CarouselWirePlan`)
// so it stays structurally interchangeable with CarouselWirePlan everywhere
// below (TypeScript structural typing — a CarouselWirePlan value satisfies this
// shape exactly) while every downstream plan.shared_style /
// plan.slides[i].image_prompt / plan.caption reference keeps compiling
// unchanged.
interface CarouselTextPlan {
    shared_style: string;
    layout_archetype_id: LayoutArchetypeId;
    slides: Array<{
        slide_number: number;
        image_prompt: string;
        role: SlideRole;
        composition_note: string;
        text_blocks: TextBlock[];
    }>;
    caption: string;
}

interface SlideOneResult {
    buffer: Buffer;
    usageMetadata?: GeminiUsageMetadata;
    rawBase64: string;
    mimeType: string;
    costUsdMicros?: number;
}

interface SlideNResult {
    buffer: Buffer;
    usageMetadata?: GeminiUsageMetadata;
    costUsdMicros?: number;
}

// ── Prompt builder (Phase 25, CRSL2-01/PLAN-05/PLAN-06) ──────────────────────
// Narrative structure + per-slide composition variation + dense aesthetic DNA
// (style catalog resolution, 60-30-10 color) — the carousel path previously
// never read the style catalog at all (25-RESEARCH.md Pitfall 1).

function buildCarouselMasterPrompt(params: CarouselGenerationParams): string {
    const { brand, styleCatalog, postMood, aspectRatio, prompt, contentLanguage, slideCount } = params;
    const entries = resolveCatalogEntries(styleCatalog, brand.mood, postMood);
    const selectedTextStyles = styleCatalog.text_styles?.filter((s) => (params.textStyleIds ?? []).includes(s.id)) ?? [];

    return `You are an Art Director planning a ${slideCount}-slide Instagram carousel for ${brand.company_name}.

Brand: ${brand.company_name} (${brand.company_type})
${formatBrandColorsProportional(brand)}
Aspect ratio: ${aspectRatio}
User direction: ${prompt}
Language: ${contentLanguage}

${buildStyleArtDirectionBlock(entries)}

NARRATIVE STRUCTURE — this carousel must tell one story across ${slideCount} slides:
- Slide 1 is the HOOK: a scroll-stopping opener that makes the swipe irresistible.
- Slides 2..${slideCount - 1} are CONTENT: each develops ONE distinct idea, benefit, step, or proof point. No slide may restate another.
- Slide ${slideCount} is the CTA: the closing ask, with a clean product or action framing.

COMPOSITION VARIATION — the single most important rule:
Every slide's "composition_note" must describe a MATERIALLY DIFFERENT framing from every other slide. Vary shot type, camera distance, and angle across the set — for example a wide establishing shot for the hook, tight macro detail crops and over-the-shoulder or overhead angles through the content slides, and a clean centered product/action framing for the CTA. Two slides sharing the same framing is a failed plan.
What stays CONSTANT across all slides: the shared_style visual language, the color palette, the lighting treatment, and the layout archetype. Only framing varies.

ON-SLIDE TEXT:
Each slide gets its own "text_blocks" — at most 3 role-tagged copy blocks (highlight = the main attention trigger, support = the secondary line, cta = a compact call to action). These are composited SERVER-SIDE by a deterministic typography engine; the image model never draws them. Therefore every "image_prompt" must describe a completely TEXT-FREE scene that deliberately leaves clear negative space for that copy. Never describe lettering, signage, typography, fonts, or written words in an image_prompt.
Pick ONE "layout_archetype_id" for the ENTIRE carousel (bottom_band, top_stack, or centered_hero) — it is applied identically to every slide. Choose bottom_band when uncertain.
${selectedTextStyles.length ? `Copy tone presets: ${selectedTextStyles.map((s) => `${s.label} (${s.description})`).join("; ")}. Let them shape the TONE and WORD CHOICE of text_blocks only.` : ""}

Requirements:
- slide_number starts at 1 and increments by 1
- Each image_prompt is self-contained (includes the shared_style inline) and is 60-160 words of flowing prose
- caption is written in ${contentLanguage}
- All ${slideCount} slides must be present

${buildNegativePromptBlock(entries)}`;
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

// ── Master text call (D-04, CRSL-02) ─────────────────────────────────────────
// Phase 25 (CRSL2-01): the previous loose, hand-rolled plan validator is
// REMOVED entirely — validateCarouselWirePlan from
// carousel-plan-schema.service.ts replaces it, and additionally guarantees the
// role field is always server-assigned (never the model's own guess).

async function callCarouselTextPlan(
    params: CarouselGenerationParams,
    attempt: 1 | 2,
): Promise<{ plan: CarouselTextPlan; usageMetadata?: GeminiUsageMetadata; costUsdMicros?: number }> {
    const basePrompt = buildCarouselMasterPrompt(params);
    const prompt =
        attempt === 2
            ? `${basePrompt}\n\nFINAL INSTRUCTION: Respond ONLY with a valid JSON object matching the schema described above. No prose, no markdown fences.`
            : basePrompt;

    // Phase 25 (CRSL2-01): the carousel plan is now as structurally demanding as the
    // single-image art-director plan, so it moves onto the SAME planning tier and the
    // SAME strict structured-output transport (mirrors gemini.service.ts:790-793).
    const textModel = params.styleCatalog.ai_models?.planning || "gemini-2.5-pro";

    const routing = await getCallRouting("planning");
    if (routing === "openrouter") {
        const orKey = params.openRouterApiKey || config.OPENROUTER_API_KEY;
        if (!orKey) {
            throw new Error(
                "OPENROUTER_API_KEY is not configured. Set it, or flip ai_gateway_routing.planning to \"direct\".",
            );
        }
        const result = await chatCompletion({
            apiKey: orKey,
            model: textModel,
            messages: [{ role: "user", content: prompt }],
            temperature: attempt === 1 ? 0.7 : 0.2,
            maxTokens: carouselPlanMaxTokens(params.slideCount),
            // OpenRouter dialect ONLY — the direct-Gemini response-schema dialect
            // constant must never appear on this branch (25-RESEARCH.md Pitfall 4).
            responseFormat: { type: "json_schema", json_schema: CAROUSEL_PLAN_JSON_SCHEMA },
        });
        const parsed = parseGeminiJson(result.text);
        const plan = validateCarouselWirePlan(parsed, result.text, attempt, params.slideCount);
        return {
            plan,
            usageMetadata: {
                promptTokenCount: result.usage?.promptTokenCount,
                candidatesTokenCount: result.usage?.candidatesTokenCount,
            },
            costUsdMicros: result.costUsdMicros,
        };
    }

    // direct — legacy path UNCHANGED aside from the strict responseSchema attachment
    // (already header-auth, POL-07 compliant). Direct-Gemini dialect ONLY — the
    // OpenRouter json_schema dialect constant must never appear on this branch.
    const response = await fetch(`${GEMINI_BASE}/${textModel}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": params.apiKey,
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: attempt === 1 ? 0.7 : 0.2,
                maxOutputTokens: carouselPlanMaxTokens(params.slideCount),
                responseMimeType: "application/json",
                responseSchema: CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA,
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
    const plan = validateCarouselWirePlan(parsed, text, attempt, params.slideCount);
    const usageMetadata = data.usageMetadata as GeminiUsageMetadata | undefined;
    return { plan, usageMetadata };
}

// ── Slide 1 single-turn image call ───────────────────────────────────────────

async function generateSlideOne(
    params: CarouselGenerationParams,
    plan: CarouselTextPlan,
): Promise<SlideOneResult> {
    const slide = plan.slides[0];
    const prompt = `${plan.shared_style}\n\n${slide.image_prompt}\n\nFraming for this slide: ${slide.composition_note}`;
    const result = await params.imageProvider.generate({
        prompt,
        aspectRatio: params.aspectRatio,
        apiKey: params.imageApiKey ?? params.apiKey,
        resolution: "1K",
    });

    const rawBase64 = result.buffer.toString("base64");
    return {
        buffer: result.buffer,
        usageMetadata: result.usage,
        rawBase64,
        mimeType: result.mimeType,
        costUsdMicros: result.costUsdMicros,
    };
}

// ── Slides 2..N: provider.edit() with slide-1 as reference (CRSL-03) ─────────
// Phase 12: provider abstraction cannot propagate Gemini-specific thought
// signatures across calls. Single-turn edit() with slide-1 buffer as
// currentImage produces equivalent style consistency for BOTH Gemini and OpenAI.

async function generateSlideN(args: {
    slideIndex: number;
    plan: CarouselTextPlan;
    params: CarouselGenerationParams;
    slide1Base64: string;
    slide1MimeType: string;
}): Promise<SlideNResult> {
    const { slideIndex, plan, params, slide1Base64, slide1MimeType } = args;
    const slide = plan.slides[slideIndex];
    const prompt = `${plan.shared_style}\n\n${slide.image_prompt}\n\nFraming for this slide: ${slide.composition_note}\n\nThe attached image is slide 1 of this carousel. Match its visual style, color palette, lighting, texture, and overall art direction EXACTLY so the set reads as one cohesive series. Do NOT copy its composition — this slide must use the different framing described above. Keep the scene completely text-free.`;
    const slide1Image: ReferenceImage = { mimeType: slide1MimeType, data: slide1Base64 };

    const result = await params.imageProvider.edit({
        prompt,
        currentImage: slide1Image,
        apiKey: params.imageApiKey ?? params.apiKey,
        aspectRatio: params.aspectRatio,
    });

    return {
        buffer: result.buffer,
        usageMetadata: result.usage,
        costUsdMicros: result.costUsdMicros,
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

// Best-effort removal of every file this run may have written under the
// deterministic carousel folder. Called on full failure / persistence failure
// so aborted runs don't leave orphaned storage objects behind.
async function removeUploadedSlideFiles(
    admin: SupabaseClient,
    userId: string,
    postId: string,
    slideCount: number,
): Promise<void> {
    const baseFolder = `${userId}/carousel/${postId}`;
    const paths: string[] = [];
    for (let n = 1; n <= slideCount; n++) {
        paths.push(`${baseFolder}/slide-${n}.webp`, `${baseFolder}/slide-${n}-thumb.webp`);
    }
    const { error } = await admin.storage.from("user_assets").remove(paths);
    if (error) {
        console.warn(`[carousel] cleanup of ${baseFolder} failed (non-critical):`, error.message);
    }
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
    let textPlanCost: number | undefined;
    try {
        const first = await callCarouselTextPlan(params, 1);
        plan = first.plan;
        textUsage = first.usageMetadata;
        textPlanCost = first.costUsdMicros;
    } catch (firstError) {
        console.warn(
            `[carousel] master text plan attempt 1 failed (${firstError instanceof CarouselPlanSchemaError ? "schema" : "transport"}) — retrying with tightened prompt:`,
            String((firstError as Error)?.message ?? firstError),
        );
        try {
            const second = await callCarouselTextPlan(params, 2);
            plan = second.plan;
            textUsage = second.usageMetadata;
            textPlanCost = second.costUsdMicros;
        } catch (secondError) {
            // CarouselPlanSchemaError (thrown by validateCarouselWirePlan) flows through
            // unchanged as `cause` so the route's error logging keeps working unchanged.
            throw new CarouselTextPlanError(
                "Master text plan returned invalid JSON after retry",
                secondError,
            );
        }
    }

    // CRSL2-01: server owns narrative typing. Whatever `role` the model emitted is
    // discarded — slide 1 is always the hook, the last slide always the CTA.
    plan = { ...plan, slides: assignSlideRoles(plan.slides) };

    // ROADMAP SC2's automated inter-slide composition-similarity check. A duplicate
    // framing is a quality signal, NOT a generation failure — log it and continue.
    const duplicateFramings = findDuplicateCompositionNotes(plan.slides);
    if (duplicateFramings.length > 0) {
        console.warn(
            `[carousel] composition variation warning: ${duplicateFramings.map((d) => `slides ${d.a}/${d.b} (${d.similarity.toFixed(2)})`).join(", ")}`,
        );
    }

    params.onProgress?.({
        type: "text_plan_complete",
        captionPreview: plan.caption.slice(0, 80),
    });

    // ── Phase 2: sequential slide generation loop (D-01, D-02) ─────────────
    const admin = createAdminSupabase();

    // Deterministic logo overlay (mirrors /api/generate): download the real
    // logo once and composite it onto every slide instead of asking the AI to
    // draw it. Failure here degrades to logo-less slides, never to a failed run.
    let logoBuffer: Buffer | null = null;
    if (params.useLogo && params.brand.logo_url) {
        try {
            const logoData = await downloadImageAsBase64(params.brand.logo_url);
            if (logoData?.data) {
                logoBuffer = Buffer.from(logoData.data, "base64");
            }
        } catch (logoErr) {
            console.warn("[carousel] logo download failed — slides will render without overlay:", logoErr);
        }
    }
    const logoPosition = (params.logoPosition || "bottom-right") as LogoPosition;

    const successfulSlides: CarouselSlideResult[] = [];
    let slide1Succeeded = false;
    let slide1Base64: string | null = null;
    let slide1MimeType: string | null = null;
    let imageInputTokensTotal = 0;
    let imageOutputTokensTotal = 0;
    let gatewayCostTotal = textPlanCost ?? 0;

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
            let usageCost: number | undefined;

            if (i === 0) {
                const result = await runSlideWithRetry(
                    () => generateSlideOne(params, plan),
                    1,
                );
                buffer = result.buffer;
                usage = result.usageMetadata;
                usageCost = result.costUsdMicros;
                slide1Base64 = result.rawBase64;
                slide1MimeType = result.mimeType;
                slide1Succeeded = true;
            } else {
                // Slides 2..N: provider.edit() with slide-1 as currentImage reference.
                // Phase 12 removed the Gemini-specific thoughtSignature multi-turn path
                // (cannot be propagated through the provider abstraction). The single-turn
                // edit() call works identically for both Gemini and OpenAI.
                const result = await runSlideWithRetry(
                    () =>
                        generateSlideN({
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
                usageCost = result.costUsdMicros;
            }

            imageInputTokensTotal += usage?.promptTokenCount ?? 0;
            imageOutputTokensTotal += usage?.candidatesTokenCount ?? 0;
            gatewayCostTotal += usageCost ?? 0;

            // slide1Base64 (the style anchor for slides 2..N) intentionally stays
            // pre-overlay so the edit model never tries to repaint the logo.
            if (logoBuffer) {
                try {
                    buffer = await applyLogoOverlay(buffer, logoBuffer, logoPosition);
                } catch (overlayErr) {
                    console.warn(`[carousel] logo overlay failed on slide ${i + 1} — using original image:`, overlayErr);
                }
            }

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
            if (i === 0) {
                // CRSL2-03: abort immediately — slides 2..N need slide1Base64/slide1MimeType, which stay null until slide 1 succeeds.
                break;
            }
            // continue — partial-success contract absorbs slide 2..N failures
        }
    }

    // ── Phase 3: partial-success contract (CRSL-10) ────────────────────────
    const aborted = params.signal?.aborted === true;

    if (!slide1Succeeded || successfulSlides.length === 0) {
        await removeUploadedSlideFiles(admin, params.userId, postId, params.slideCount);
        throw new CarouselFullFailureError(
            `Carousel generation failed: slide 1 did not complete. ${successfulSlides.length}/${params.slideCount} slides succeeded.`,
        );
    }

    const successRate = successfulSlides.length / params.slideCount;
    if (successRate < 0.5) {
        await removeUploadedSlideFiles(admin, params.userId, postId, params.slideCount);
        throw new CarouselFullFailureError(
            `Below 50% threshold: ${successfulSlides.length}/${params.slideCount} slides succeeded.`,
        );
    }

    const postStatus: "completed" | "draft" =
        successfulSlides.length === params.slideCount ? "completed" : "draft";

    // ── Phase 4: unified caption quality check (CRSL-09 — exactly once) ────
    const finalCaption = await ensureCaptionQuality({
        apiKey: params.apiKey,
        openRouterApiKey: params.openRouterApiKey,
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
        // Covers the idempotency race too: a concurrent duplicate loses on the
        // unique index here, so its freshly-uploaded slides must not linger.
        await removeUploadedSlideFiles(admin, params.userId, postId, params.slideCount);
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
        await admin.from("posts").delete().eq("id", postId);
        await removeUploadedSlideFiles(admin, params.userId, postId, params.slideCount);
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
        imageModel: params.imageProvider.name === "openai" ? "openai-responses" : IMAGE_MODEL,
        costUsdMicrosTotal: gatewayCostTotal > 0 ? gatewayCostTotal : undefined,
    };
}

// ── Keep `uploadFile` referenced so future non-carousel callers of the service
// module can continue to import the helper (D-16 declares services own upload;
// the deterministic `admin.storage.from(...).upload()` path above is the
// CONTEXT.md §specifics-mandated path for per-slide naming, but the generic
// `uploadFile()` helper remains the intended one for any non-slide writes).
void uploadFile;
