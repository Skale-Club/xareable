/**
 * Generate Routes - AI post generation
 * Handles text and image generation using Gemini AI
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { createAdminSupabase } from "../supabase.js";
import { uploadFile } from "../storage.js";
import { generateRequestSchema, POST_EXPIRATION_DAYS, type TextBlock, type TextRenderMode } from "../../shared/schema.js";
import {
    authenticateUser,
    AuthenticatedRequest,
    getGeminiApiKey,
    getOpenRouterApiKey,
    selectImageApiKey,
    usesOwnApiKey,
} from "../middleware/auth.middleware.js";
import { aiRateLimit, DEFAULT_AI_LIMITS } from "../middleware/rate-limit.middleware.js";
import { createGeminiService } from "../services/gemini.service.js";
import { isPlanningSchemaError, DEFAULT_LAYOUT_ARCHETYPE_ID } from "../services/planning-schema.service.js";
import { ensureCaptionQuality } from "../services/caption-quality.service.js";
import { getActiveImageProvider, type ImageProvider } from "../services/image-provider.js";
import { getOpenAIApiKey } from "../middleware/auth.middleware.js";
import { cropToExactAspectRatio, measureAspectRatio } from "../services/image-crop.service.js";
import { resolveTextBlocks, compositeTypography } from "../services/typography-compositor.service.js";
import type { TypographyMeta, GenerationParams } from "../../shared/schema.js";
import { generateVideo } from "../services/video-generation.service.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { processImageWithThumbnail, formatBytes, applyLogoOverlay } from "../services/image-optimization.service.js";
import { downloadImageAsBase64, formatBrandColors } from "../services/prompt-builder.service.js";
import { initSSE } from "../lib/sse.js";
import { config } from "../config/index.js";
import {
    MAX_REROLL_ATTEMPTS,
    runVisualCritic,
    selectFinalAttempt,
    shouldRerollAfter,
    computeRerollMetadata,
    type CriticAttempt,
} from "../services/visual-critic.service.js";
import { logVisualCritic } from "../services/observability.service.js";
import type { ImageProviderResult } from "../services/image-provider.js";

// Phase 24 (CRIT-04). The 280s base is the carried-over Vercel kill-window
// assumption, NOT a Coolify constraint — production has been on a long-running
// host since 2026-05-30, so the base stays env-tunable and the critic budget is
// added on top rather than carved out of it.
// Both constants below are ESTIMATES pending real Coolify latency data; tune them
// from generation_logs' visual_critic duration_ms after the first week of traffic.
const CRITIC_CALL_LATENCY_ESTIMATE_MS = 15_000;
const IMAGE_GEN_CALL_LATENCY_ESTIMATE_MS = 25_000;
// New work this phase adds: one critic call per attempt (always) + up to
// MAX_REROLL_ATTEMPTS EXTRA image-gen calls (attempt 1's is already in the base).
const CRITIC_REROLL_BUDGET_MS =
    (MAX_REROLL_ATTEMPTS + 1) * CRITIC_CALL_LATENCY_ESTIMATE_MS +
    MAX_REROLL_ATTEMPTS * IMAGE_GEN_CALL_LATENCY_ESTIMATE_MS; // 95_000
const GENERATION_SAFETY_TIMEOUT_MS = (config.GENERATION_SAFETY_TIMEOUT_MS ?? 280_000) +
    CRITIC_REROLL_BUDGET_MS; // ~375s

/**
 * Log a generation error to the database
 */
async function logGenerationError(params: {
    userId: string | null;
    errorMessage: string;
    errorType:
        | "auth"
        | "validation"
        | "configuration"
        | "credits"
        | "text_generation"
        | "image_generation"
        | "video_generation"
        | "upload"
        | "database"
        | "unknown";
    requestParams?: Record<string, unknown>;
}): Promise<void> {
    try {
        const supabase = createAdminSupabase();
        const { error } = await supabase.from("generation_logs").insert({
            user_id: params.userId,
            status: "failed",
            error_message: params.errorMessage,
            error_type: params.errorType,
            request_params: params.requestParams || null,
        });
        if (error) {
            console.error("Failed to insert generation error log:", error);
        }
    } catch (logError) {
        // Don't let logging errors crash the app
        console.error("Failed to log generation error:", logError);
    }
}

function sanitizeRequestForLogging(body: unknown): Record<string, unknown> {
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return {
        reference_text: typeof payload.reference_text === "string" ? payload.reference_text : undefined,
        post_mood: typeof payload.post_mood === "string" ? payload.post_mood : undefined,
        use_text: typeof payload.use_text === "boolean" ? payload.use_text : undefined,
        copy_text: typeof payload.copy_text === "string" ? payload.copy_text : undefined,
        text_mode: typeof payload.text_mode === "string" ? payload.text_mode : undefined,
        text_style_id: typeof payload.text_style_id === "string" ? payload.text_style_id : undefined,
        text_blocks_count: Array.isArray(payload.text_blocks) ? payload.text_blocks.length : 0,
        text_style_ids: Array.isArray(payload.text_style_ids)
            ? payload.text_style_ids.filter((value): value is string => typeof value === "string")
            : undefined,
        aspect_ratio: typeof payload.aspect_ratio === "string" ? payload.aspect_ratio : undefined,
        use_logo: typeof payload.use_logo === "boolean" ? payload.use_logo : undefined,
        logo_position: typeof payload.logo_position === "string" ? payload.logo_position : undefined,
        content_language: typeof payload.content_language === "string" ? payload.content_language : undefined,
        content_type: typeof payload.content_type === "string" ? payload.content_type : undefined,
        image_resolution: typeof payload.image_resolution === "string" ? payload.image_resolution : undefined,
        video_resolution: typeof payload.video_resolution === "string" ? payload.video_resolution : undefined,
        video_duration: typeof payload.video_duration === "string" ? payload.video_duration : undefined,
        has_reference_images: Array.isArray(payload.reference_images) ? payload.reference_images.length : 0,
    };
}

function buildTextFallback(params: {
    brand: any;
    referenceText?: string;
    useText: boolean;
    copyText?: string;
    textBlocks?: TextBlock[];
    textMode?: TextRenderMode;
    textStyleId?: string;
    textStyleIds?: string[];
    postMood?: string;
    aspectRatio?: string;
    contentLanguage?: string;
    contentType?: "image" | "video";
}) {
    const isVideo = params.contentType === "video";
    const mood = String(params.postMood || "promo");
    const text = (params.textBlocks?.map((block) => `[${block.role.toUpperCase()}] ${block.text}`).join("\n") || String(params.copyText || "")).trim();
    const plainText = (params.textBlocks?.map((block) => block.text).join("\n") || String(params.copyText || "")).trim();
    const highlightText = params.textBlocks?.find((block) => block.role === "highlight")?.text?.trim() || "";
    const supportText = params.textBlocks?.find((block) => block.role === "support")?.text?.trim() || "";
    const exactTextRequired = params.useText && params.textMode === "exact" && Boolean(plainText);
    const headline = (params.useText ? ((highlightText || text) || `${params.brand.company_name} ${mood}`) : "")
        .split(/\s+/)
        .slice(0, 6)
        .join(" ");
    const subtext = isVideo
        ? `Cinematic ${mood} video for ${params.brand.company_name}.`
        : params.useText
            ? (supportText || `Professional ${mood} visual for ${params.brand.company_name}.`)
            : "";
    const image_prompt = isVideo
        ? `Create a ${params.aspectRatio || "9:16"} cinematic video for ${params.brand.company_name} (${params.brand.company_type}). Mood: ${mood}. Use brand colors ${formatBrandColors(params.brand)}.`
        : `Create a ${params.aspectRatio || "1:1"} social media image for ${params.brand.company_name} (${params.brand.company_type}) in ${mood} style. ${params.useText ? (text ? `Include this exact text direction: ${text}.` : "Generate suitable on-image text.") : "Do not place any text inside the image."} Use brand colors ${formatBrandColors(params.brand)}.`;
    const captionLanguageHint = params.contentLanguage && params.contentLanguage !== "en" ? ` (${params.contentLanguage})` : "";
    const caption = `${params.brand.company_name}${captionLanguageHint}\n\nProfessional results, clear value, and a stronger brand presence for your audience.\n\n#${String(params.brand.company_name || "").replace(/\s+/g, "")} #${mood} #marketing`;

    return {
        content: {
            headline,
            subtext,
            image_prompt,
            caption,
            creative_plan: {
                scenario_type: exactTextRequired ? "exact-text-promo" : (isVideo ? "video" : "brand-promo"),
                subject_definition: params.referenceText || `${params.brand.company_type} social visual for ${params.brand.company_name}`,
                preservation_notes: params.referenceText
                    ? "Preserve the main subject and commercial meaning from the user direction."
                    : "Maintain a clear commercial subject hierarchy.",
                exact_text_required: exactTextRequired,
                exact_text_value: exactTextRequired ? plainText : "",
                visual_constraints: [
                    params.useText ? "Keep the promotional text readable." : "Keep the image text-free.",
                ],
                negative_constraints: [
                    exactTextRequired ? "Do not change the exact promotional text." : "",
                ].filter(Boolean),
                structured_image_prompt: null,
            },
            text_blocks: (params.textBlocks ?? []).slice(0, 3),
            layout_archetype_id: DEFAULT_LAYOUT_ARCHETYPE_ID,
        },
        usage: undefined,
        model: "local-fallback",
        costUsdMicros: undefined,
    };
}

function calculatePostExpirationIso(baseDate = new Date()): string {
    const expirationDate = new Date(baseDate);
    expirationDate.setDate(expirationDate.getDate() + POST_EXPIRATION_DAYS);
    return expirationDate.toISOString();
}

async function fetchBrandReferenceImagesAsBase64(
    photoUrls: string[]
): Promise<Array<{ mimeType: string; data: string }>> {
    // Parallel best-effort downloads; failed fetches are dropped, order preserved.
    const results = await Promise.all(
        photoUrls.map(async (url) => {
            try {
                const response = await fetch(url);
                if (!response.ok) return null;
                const contentType = response.headers.get("content-type") || "image/jpeg";
                const mimeType = contentType.split(";")[0].trim();
                const arrayBuffer = await response.arrayBuffer();
                return { mimeType, data: Buffer.from(arrayBuffer).toString("base64") };
            } catch {
                return null;
            }
        })
    );
    return results.filter((img): img is { mimeType: string; data: string } => img !== null);
}

const router = Router();

// Rate limiter for /api/generate (HARD-01) — 30 req / 5 min, admin-bypass.
const aiPaidLimiter = aiRateLimit(DEFAULT_AI_LIMITS.paid_image_video);

/**
 * POST /api/generate
 * Generates a new social media post with AI
 */
router.post("/api/generate", async (req: Request, res: Response) => {
    // Authenticate user
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        await logGenerationError({
            userId: null,
            errorMessage: authResult.message,
            errorType: "auth",
            requestParams: sanitizeRequestForLogging(req.body),
        });
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;

    // Get user profile
    const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin, is_affiliate, api_key, openai_api_key, image_provider, openrouter_api_key")
        .eq("id", user.id)
        .single();

    // Check if user uses their own API key
    const ownApiKey = usesOwnApiKey(profile);

    // ── Phase 21.1 (GATE-06) affiliate-aware GATEWAY key gate ──
    // A BARE getGeminiApiKey() hard gate here would 400 every affiliate who
    // configured only an OpenRouter key (their Settings Gemini field is now
    // video-only and optional). Affiliates gate on their own OpenRouter key;
    // non-affiliates keep the platform Gemini gate verbatim. openRouterApiKey
    // stays "" for non-affiliates on purpose: every gateway call site already
    // falls back to config.OPENROUTER_API_KEY when it is empty.
    let geminiApiKey = "";
    let openRouterApiKey = "";
    if (ownApiKey) {
        const { key, error } = await getOpenRouterApiKey(profile);
        if (error) {
            await logGenerationError({
                userId: user.id,
                errorMessage: error,
                errorType: "configuration",
                requestParams: sanitizeRequestForLogging(req.body),
            });
            return res.status(400).json({ message: error });
        }
        openRouterApiKey = key;
    } else {
        const { key, error } = await getGeminiApiKey(profile);
        if (error) {
            await logGenerationError({
                userId: user.id,
                errorMessage: error,
                errorType: "configuration",
                requestParams: sanitizeRequestForLogging(req.body),
            });
            return res.status(400).json({ message: error });
        }
        geminiApiKey = key;
    }

    // ── Phase 21.1 (GATE-06) — GATE-08 video carve-out ──
    // generateVideo() is a DIRECT-GOOGLE call (Veo), never an OpenRouter gateway
    // call, so it needs a Gemini key even for affiliates — who keep a Settings
    // field for exactly this ("Gemini API key (used for video generation only)").
    // Resolve it NON-FATALLY: a missing Gemini key must not block an affiliate's
    // image/caption work, which is fully OpenRouter-backed. The isVideo guard
    // below enforces it.
    if (ownApiKey) {
        const videoKeyRes = await getGeminiApiKey(profile);
        geminiApiKey = videoKeyRes.error ? "" : videoKeyRes.key;
    }

    // Get user's brand
    const { data: brand, error: brandError } = await supabase
        .from("brands")
        .select("*")
        .eq("user_id", user.id)
        .single();

    if (brandError || !brand) {
        await logGenerationError({
            userId: user.id,
            errorMessage: "No brand profile found. Please complete onboarding.",
            errorType: "configuration",
            requestParams: sanitizeRequestForLogging(req.body),
        });
        return res.status(400).json({ message: "No brand profile found. Please complete onboarding." });
    }

    // ── Rate limit gate (HARD-01) ──
    // Attach to req so the limiter's keyGenerator/skip can read them.
    (req as any).user = user;
    (req as any).profile = profile;
    await new Promise<void>((resolve) => {
        aiPaidLimiter(req as any, res as any, () => {
            // express-rate-limit calls next() with no err on pass, and writes
            // the 429 response itself when over the limit.
            resolve();
        });
    });
    // express-rate-limit writes the 429 response inside its handler. If the
    // response is already finished, do not continue.
    if (res.headersSent) {
        return;
    }

    // Validate request body first to know the content_type
    const parseResult = generateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        const validationMessage =
            "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ");
        await logGenerationError({
            userId: user.id,
            errorMessage: validationMessage,
            errorType: "validation",
            requestParams: sanitizeRequestForLogging(req.body),
        });
        return res.status(400).json({
            message: validationMessage
        });
    }

    const {
        reference_text,
        reference_images,
        use_brand_references,
        post_mood,
        use_text,
        copy_text,
        text_mode,
        text_style_id,
        text_blocks,
        text_style_ids,
        aspect_ratio,
        use_logo,
        logo_position,
        content_language,
        content_type,
        image_resolution,
        video_resolution,
        video_duration,
    } = parseResult.data;
    const isVideo = content_type === "video";
    // /api/generate only handles image/video in v1.1; carousel and enhancement
    // have dedicated routes (Phase 7). Narrow the shared 4-value enum down to
    // the 2-value pipeline input this route supports.
    const pipelineContentType: "image" | "video" = isVideo ? "video" : "image";

    // Prepare sanitized request params for error logging (exclude base64 image data)
    const sanitizedRequestParams = {
        reference_text,
        post_mood,
        use_text,
        copy_text,
        text_mode,
        text_style_id,
        text_blocks_count: text_blocks?.length || 0,
        text_style_ids,
        aspect_ratio,
        use_logo,
        logo_position,
        content_language,
        content_type,
        has_reference_images: reference_images?.length || 0,
    };

    // Phase 21.1 (GATE-06): video is the GATE-08-frozen direct-Google path — it
    // cannot run on an OpenRouter key. Fail here with an actionable message
    // instead of handing generateVideo an empty key mid-stream.
    if (isVideo && !geminiApiKey) {
        await logGenerationError({
            userId: user.id,
            errorMessage: "Video generation requires a Gemini API key.",
            errorType: "configuration",
            requestParams: sanitizedRequestParams,
        });
        return res.status(400).json({
            message: "Video generation requires a Gemini API key. Add yours in Settings → Gemini API key (used for video generation only).",
        });
    }

    // Check credits for non-admin/affiliate users
    const creditStatus = !ownApiKey
        ? await checkCredits(user.id, "generate", isVideo)
        : null;

    if (creditStatus && !creditStatus.allowed) {
        const denialReason = creditStatus.denial_reason || null;
        const isBudgetReached = denialReason === "usage_budget_reached";
        const isUpgradeRequired = denialReason === "upgrade_required";
        const isSubscriptionMissing = denialReason === "inactive_subscription";
        const error = isBudgetReached
            ? "usage_budget_reached"
            : isUpgradeRequired
                ? "upgrade_required"
                : isSubscriptionMissing
                    ? "subscription_required"
                    : "insufficient_credits";
        const message = isBudgetReached
            ? "Additional usage budget reached. Increase your budget in Billing to continue."
            : isUpgradeRequired
                ? "Your free generations have been used. Upgrade to a paid plan to continue."
                : isSubscriptionMissing
                    ? "An active subscription is required to continue."
                    : "Insufficient credits. Add credits to continue.";
        await logGenerationError({
            userId: user.id,
            errorMessage: message,
            errorType: "credits",
            requestParams: sanitizedRequestParams,
        });
        return res.status(402).json({
            error,
            message,
            balance_micros: creditStatus.balance_micros,
            estimated_cost_micros: creditStatus.estimated_cost_micros,
            usage_budget_micros: creditStatus.usage_budget_micros ?? null,
            usage_budget_remaining_micros: creditStatus.usage_budget_remaining_micros ?? null,
            additional_usage_this_month_micros: creditStatus.additional_usage_this_month_micros ?? null,
        });
    }

    // ── Initialize SSE stream ──
    // Early errors (auth, validation, credits) already returned JSON above.
    // From this point on, all responses go through SSE.
    const sse = initSSE(res);
    sse.startHeartbeat();
    sse.sendProgress("auth", "Verified. Starting generation...", 5);

    // Phase 24 (CRIT-04): a real AbortController, not the cooperative-only pattern
    // used by carousel/enhance — controller.signal is threaded into the gateway's
    // actual fetch()/SDK calls, so this genuinely cancels in-flight work.
    const controller = new AbortController();
    const safetyTimer = setTimeout(async () => {
        controller.abort();
        // Emit the user-facing 504 BEFORE the DB round-trip. SSEWriter.sendError is
        // first-write-wins, and controller.abort() rejects the in-flight call within
        // milliseconds — so if we awaited logGenerationError first, the outer catch's
        // generic 500 (carrying a raw "operation was aborted" message) would reach the
        // client first and this friendlier message would be silently dropped.
        sse.sendError({ message: "Generation timed out. Please try again.", statusCode: 504 });
        await logGenerationError({
            userId: user.id,
            errorMessage: "Generation timed out (exceeded maximum allowed duration)",
            errorType: "unknown",
            requestParams: sanitizedRequestParams,
        }).catch(() => {});
    }, GENERATION_SAFETY_TIMEOUT_MS);

    try {
        // Get style catalog
        const styleCatalog = await getStyleCatalogPayload();
        const selectedTextStyles = styleCatalog.text_styles?.filter((item) =>
            (text_style_ids?.length ? text_style_ids : (text_style_id ? [text_style_id] : [])).includes(item.id)
        ) || [];

        // Create Gemini service
        const gemini = createGeminiService(geminiApiKey, openRouterApiKey);

        // Build final reference image list: user images fill first, brand fills remainder (≤ 4 total)
        const userRefImages: Array<{ mimeType: string; data: string }> = (reference_images || []).map(img => ({
            mimeType: img.mimeType,
            data: img.data,
        }));

        let mergedReferenceImages = userRefImages;

        if (!isVideo && use_brand_references !== false && userRefImages.length < 4) {
            const slotsRemaining = 4 - userRefImages.length;
            const { data: brandPhotos } = await supabase
                .from("brand_reference_photos")
                .select("photo_url")
                .eq("brand_id", brand.id)
                .order("position", { ascending: true })
                .limit(slotsRemaining);

            if (brandPhotos && brandPhotos.length > 0) {
                const brandImgs = await fetchBrandReferenceImagesAsBase64(
                    brandPhotos.map((p: { photo_url: string }) => p.photo_url)
                );
                mergedReferenceImages = [...userRefImages, ...brandImgs];
            }
        }

        // ── Phase: Text generation ──
        sse.sendProgress("text_generation", "Crafting the perfect design prompt...", 15);

        let textResult;
        try {
            textResult = await gemini.generateText({
                brand,
                styleCatalog,
                referenceText: reference_text,
                // Phase 22 (PLAN-01): pass the FULL {mimeType,data} objects. Until now
                // .map(img => img.data) stripped the mimeType here and the bytes never
                // reached either planning-call request body — the model only read a
                // sentence stating N images existed.
                referenceImages: mergedReferenceImages,
                postMood: post_mood,
                useText: content_type === "video" ? false : use_text,
                copyText: content_type === "video" || !use_text ? undefined : copy_text,
                textBlocks: content_type === "video" || !use_text ? undefined : text_blocks,
                textMode: content_type === "video" || !use_text ? undefined : text_mode,
                textStyleId: content_type === "video" || !use_text ? undefined : text_style_id,
                textStyleIds: content_type === "video" || !use_text ? undefined : text_style_ids,
                aspectRatio: aspect_ratio,
                useLogo: use_logo ?? false,
                logoPosition: logo_position,
                contentLanguage: content_language || "en",
                contentType: pipelineContentType,
            });
        } catch (textError) {
            // PLAN-02: a schema-validation failure already exhausted both planning
            // attempts inside generateText() and was logged there with
            // event_kind='planning_schema_failure'. It must NOT be absorbed by
            // buildTextFallback()'s generic template — surface it. The outer catch
            // (below) turns this into sse.sendError(...) for the user, and because
            // deductCredits() only runs after a successful post insert, the user is
            // never charged for a failed plan.
            if (isPlanningSchemaError(textError)) {
                await logGenerationError({
                    userId: user.id,
                    errorMessage: textError instanceof Error ? textError.message : "Planning schema validation failed",
                    errorType: "text_generation",
                    requestParams: sanitizedRequestParams,
                });
                throw textError;
            }
            await logGenerationError({
                userId: user.id,
                errorMessage: textError instanceof Error ? textError.message : "Text generation failed",
                errorType: "text_generation",
                requestParams: sanitizedRequestParams,
            });
            textResult = buildTextFallback({
                brand,
                referenceText: reference_text,
                useText: content_type === "video" ? false : use_text,
                copyText: content_type === "video" || !use_text ? undefined : copy_text,
                textBlocks: content_type === "video" || !use_text ? undefined : text_blocks,
                textMode: content_type === "video" || !use_text ? undefined : text_mode,
                textStyleId: content_type === "video" || !use_text ? undefined : text_style_id,
                textStyleIds: content_type === "video" || !use_text ? undefined : text_style_ids,
                postMood: post_mood,
                aspectRatio: aspect_ratio,
                contentLanguage: content_language || "en",
                contentType: pipelineContentType,
            });
        }

        if (sse.isClosed()) throw new Error("Client disconnected");

        // ── Phase: Image / Video generation ──
        let imageResult: ImageProviderResult | undefined;
        let videoResult;
        // Phase 24 (CRIT-02/03/05)
        const criticAttempts: CriticAttempt[] = [];
        const attemptBuffers = new Map<number, ImageProviderResult>();
        let criticSelection: ReturnType<typeof selectFinalAttempt> | undefined;
        let criticLoopStartedAt = 0;
        let criticDurationMs = 0;

        if (content_type === "video") {
            sse.sendProgress("video_generation", "Generating your video...", 40);
            try {
                videoResult = await generateVideo({
                    prompt: textResult.content.image_prompt,
                    aspectRatio: aspect_ratio,
                    duration: video_duration || "8",
                    resolution: video_resolution || "720p",
                    apiKey: geminiApiKey,
                    referenceImages: mergedReferenceImages,
                });
            } catch (videoError) {
                await logGenerationError({
                    userId: user.id,
                    errorMessage: videoError instanceof Error ? videoError.message : "Video generation failed",
                    errorType: "video_generation",
                    requestParams: sanitizedRequestParams,
                });
                throw videoError;
            }
        } else {
            sse.sendProgress("image_generation", "Generating your image...", 40);
            // ── Resolve provider + key ONCE, outside the loop ──
            const provider: ImageProvider = await getActiveImageProvider(profile);
            let openaiKeyForImage: string | undefined;
            if (provider.name === "openai") {
                const openaiKeyRes = await getOpenAIApiKey(profile);
                if (openaiKeyRes.error) {
                    sse.sendError({ message: openaiKeyRes.error, statusCode: 400 });
                    clearTimeout(safetyTimer);
                    return;
                }
                openaiKeyForImage = openaiKeyRes.key;
            }
            // Phase 21.1 (GATE-06): affiliates' image calls must carry THEIR
            // OpenRouter key, not geminiApiKey (which is "" for an affiliate
            // with no video key and would silently fall back to the platform
            // key — RESEARCH Pitfall 3).
            const imageApiKey = selectImageApiKey({
                providerName: provider.name,
                geminiApiKey,
                openRouterApiKey,
                openaiApiKey: openaiKeyForImage,
            });

            // ── Phase 24 (CRIT-01/CRIT-02): bounded sequential re-roll loop ──
            // Runs BEFORE Phase 23's crop/typography/logo pipeline: the critic scores
            // the raw base image, which is the artifact its rubric describes.
            // Every attempt uses the IDENTICAL prompt — 24-CONTEXT.md locks blind
            // sequential retry; no critic-feedback injection into the retry prompt.
            criticLoopStartedAt = Date.now();
            for (let attempt = 1; attempt <= MAX_REROLL_ATTEMPTS + 1; attempt++) {
                if (attempt > 1) {
                    sse.sendProgress("image_generation", `Regenerating for better quality (attempt ${attempt} of ${MAX_REROLL_ATTEMPTS + 1})...`, 40);
                }
                let attemptResult: ImageProviderResult;
                try {
                    attemptResult = await provider.generate({
                        prompt: textResult.content.image_prompt,
                        aspectRatio: aspect_ratio,
                        resolution: image_resolution || "1K",
                        model: styleCatalog.ai_models?.image_generation,
                        apiKey: imageApiKey,
                        referenceImages: mergedReferenceImages,
                        signal: controller.signal, // CRIT-04
                    });
                } catch (imageError) {
                    await logGenerationError({
                        userId: user.id,
                        errorMessage: imageError instanceof Error ? imageError.message : "Image generation failed",
                        errorType: "image_generation",
                        requestParams: sanitizedRequestParams,
                    });
                    throw imageError;
                }

                sse.sendProgress("visual_critic", "Reviewing image quality...", 50);
                const outcome = await runVisualCritic({
                    apiKey: openRouterApiKey || config.OPENROUTER_API_KEY || "",
                    model: styleCatalog.ai_models?.critic,
                    imageBuffer: attemptResult.buffer,
                    imageMimeType: attemptResult.mimeType,
                    layoutArchetypeId: textResult.content.layout_archetype_id,
                    signal: controller.signal, // CRIT-04
                });

                criticAttempts.push({ index: attempt, outcome, imageCostUsdMicros: attemptResult.costUsdMicros ?? 0 });
                attemptBuffers.set(attempt, attemptResult);

                if (!shouldRerollAfter(outcome)) break;
            }

            criticSelection = selectFinalAttempt(criticAttempts);
            criticDurationMs = Date.now() - criticLoopStartedAt;

            if (criticSelection.acceptedIndex === null) {
                // Every attempt contained unwanted rendered text — the ONE genuinely
                // failing path. Never accepted as "best of 3" (24-CONTEXT.md, locked).
                // postId is null: no post row exists, and generation_logs.post_id is a
                // real FK to posts(id).
                const hardFailMeta = computeRerollMetadata(criticAttempts, null);
                await logVisualCritic({
                    postId: null,
                    outcome: "hard_fail_all_attempts",
                    attemptCount: criticAttempts.length,
                    textFreeCompliant: false,
                    finalScores: null,
                    rerollAttemptCount: hardFailMeta.reroll_attempt_count,
                    rerollCostUsdMicros: hardFailMeta.reroll_cost_usd_micros,
                    durationMs: criticDurationMs,
                });
                throw new Error("The image generator kept rendering unwanted text into every attempt. Please try again, or rephrase your prompt.");
            }

            imageResult = attemptBuffers.get(criticSelection.acceptedIndex);
        }

        if (sse.isClosed()) throw new Error("Client disconnected");

        // ── Phase: Crop, composite typography, logo overlay, optimize, upload ──
        const postId = randomUUID();
        let imageUrl: string;
        let thumbnailUrl: string | null = null;
        let finalContentType = content_type || "image";
        let baseImageUrl: string | null = null;
        let typographyMeta: TypographyMeta | null = null;

        try {
            const sb = createAdminSupabase();

            if (content_type === "video" && videoResult) {
                sse.sendProgress("optimization", "Uploading video...", 75);
                imageUrl = await uploadFile(
                    sb,
                    "user_assets",
                    `${user.id}/${postId}.mp4`,
                    videoResult.buffer,
                    "video/mp4"
                );

                if (mergedReferenceImages[0]) {
                    const firstRefBuffer = Buffer.from(mergedReferenceImages[0].data, 'base64');
                    try {
                        const { thumbnail } = await processImageWithThumbnail(firstRefBuffer);
                        thumbnailUrl = await uploadFile(
                            sb,
                            "user_assets",
                            `${user.id}/thumbnails/${postId}.webp`,
                            thumbnail.buffer,
                            "image/webp"
                        );
                    } catch (e) {
                        console.warn("Failed to generate thumbnail for video from reference image", e);
                    }
                }
            } else if (imageResult) {
                let finalImageBuffer = imageResult.buffer;

                // ── Phase 23 (POL-04): normalize to the EXACT requested aspect ratio ──
                // toGeminiAspectRatio() coerces unsupported ratios (e.g. 1200:628 → 16:9)
                // before generation; nothing corrected the output until now.
                sse.sendProgress("optimization", "Framing to your aspect ratio...", 62);
                const preCropMeasurement = await measureAspectRatio(finalImageBuffer);
                finalImageBuffer = await cropToExactAspectRatio(finalImageBuffer, aspect_ratio);
                const postCropMeasurement = await measureAspectRatio(finalImageBuffer);
                console.log(`[Aspect Crop] Post ${postId}: ${preCropMeasurement?.width ?? "?"}x${preCropMeasurement?.height ?? "?"} → ${postCropMeasurement?.width ?? "?"}x${postCropMeasurement?.height ?? "?"} (requested ${aspect_ratio})`);

                // ── Phase 23 (TYPO-05): persist the pre-typography base image ──
                // This is what edit/remake operates on, so no edit ever re-renders text over
                // already-composited text (TYPO-07). Uploaded even when use_text is false so
                // the edit path has a uniform contract for every post created from here on.
                baseImageUrl = await uploadFile(
                    sb,
                    "user_assets",
                    `${user.id}/base/${postId}.png`,
                    finalImageBuffer,
                    "image/png",
                );

                // ── Phase 23 (TYPO-02/03): deterministic typography ──
                if (use_text) {
                    sse.sendProgress("typography", "Composing your text...", 68);
                    const blocks = resolveTextBlocks({
                        textBlocks: textResult.content.text_blocks,
                        headline: textResult.content.headline,
                        subtext: textResult.content.subtext,
                    });
                    if (blocks.length > 0) {
                        const composed = await compositeTypography({
                            baseImageBuffer: finalImageBuffer,
                            textBlocks: blocks,
                            layoutArchetypeId: textResult.content.layout_archetype_id || DEFAULT_LAYOUT_ARCHETYPE_ID,
                            aspectRatio: aspect_ratio,
                        });
                        finalImageBuffer = composed.buffer;
                        typographyMeta = composed.meta;
                    }
                }

                // Deterministic logo placement
                if ((use_logo ?? false) && brand.logo_url) {
                    sse.sendProgress("logo_overlay", "Applying logo overlay...", 75);
                    try {
                        const logoData = await downloadImageAsBase64(brand.logo_url);
                        if (logoData?.data) {
                            const logoBuffer = Buffer.from(logoData.data, "base64");
                            finalImageBuffer = await applyLogoOverlay(
                                finalImageBuffer,
                                logoBuffer,
                                (
                                    logo_position ||
                                    "bottom-right"
                                ) as
                                    | "top-left"
                                    | "top-center"
                                    | "top-right"
                                    | "middle-left"
                                    | "middle-center"
                                    | "middle-right"
                                    | "bottom-left"
                                    | "bottom-center"
                                    | "bottom-right"
                            );
                        }
                    } catch (logoError) {
                        console.warn("Logo overlay failed, continuing without overlay:", logoError);
                    }
                }

                sse.sendProgress("optimization", "Optimizing image quality...", 80);

                const originalSize = finalImageBuffer.length;
                const { image: optimizedImage, thumbnail } = await processImageWithThumbnail(finalImageBuffer);

                console.log(`[Image Optimization] Post ${postId}: ${formatBytes(originalSize)} → ${formatBytes(optimizedImage.sizeBytes)} (${Math.round((1 - optimizedImage.sizeBytes / originalSize) * 100)}% reduction)`);

                imageUrl = await uploadFile(
                    sb,
                    "user_assets",
                    `${user.id}/${postId}.webp`,
                    optimizedImage.buffer,
                    "image/webp"
                );

                thumbnailUrl = await uploadFile(
                    sb,
                    "user_assets",
                    `${user.id}/thumbnails/${postId}.webp`,
                    thumbnail.buffer,
                    "image/webp"
                );
            } else {
                throw new Error("No image or video result produced.");
            }
        } catch (uploadError) {
            await logGenerationError({
                userId: user.id,
                errorMessage: uploadError instanceof Error ? uploadError.message : "Image upload failed",
                errorType: "upload",
                requestParams: sanitizedRequestParams,
            });
            throw uploadError;
        }

        if (sse.isClosed()) throw new Error("Client disconnected");

        // ── Phase: Caption quality ──
        sse.sendProgress("caption_quality", "Polishing your caption...", 88);

        const finalCaption = await ensureCaptionQuality({
            apiKey: geminiApiKey,
            openRouterApiKey,
            brandName: brand.company_name,
            companyType: brand.company_type,
            contentLanguage: content_language || "en",
            scenarioType: textResult.content.creative_plan?.scenario_type,
            subjectDefinition: textResult.content.creative_plan?.subject_definition,
            offerText:
                textResult.content.creative_plan?.exact_text_value ||
                text_blocks?.map((block) => block.text.trim()).filter(Boolean).join("\n") ||
                copy_text ||
                undefined,
            promptContext: [
                `Mood: ${post_mood}`,
                `Reference direction: ${reference_text || "none"}`,
                `On-image text mode: ${content_type === "video" ? "none" : (text_mode || (use_text ? "guided" : "none"))}`,
                `On-image text: composited server-side (${typographyMeta ? typographyMeta.text_blocks.map(b => b.text).join(" | ") : "none"})`,
                `Image prompt: ${textResult.content.image_prompt}`,
                textResult.content.creative_plan?.subject_definition
                    ? `Subject definition: ${textResult.content.creative_plan.subject_definition}`
                    : "",
            ].join("\n"),
            candidateCaption: textResult.content.caption,
            model: styleCatalog.ai_models?.text_generation,
            mode: "create",
        });

        // ── Phase: Save to database ──
        sse.sendProgress("saving", "Saving to your library...", 95);
        const expiresAt = calculatePostExpirationIso();

        // ── Phase 23 (POL-05): persist the real generation parameters ──
        // Edit/remake reads these back instead of regex-guessing ai_prompt_used
        // (replaces edit.routes.ts's recoverVideoAspectRatioFromPrompt heuristic).
        const generationParams: GenerationParams = {
            aspect_ratio,
            image_resolution,
            video_resolution,
            video_duration,
            use_text,
            text_mode,
            text_style_ids,
            use_logo: use_logo ?? false,
            logo_position,
            post_mood,
            content_language: content_language || "en",
            content_type: finalContentType as GenerationParams["content_type"],
        };

        const { data: post, error: insertError } = await supabase
            .from("posts")
            .insert({
                id: postId,
                user_id: user.id,
                image_url: imageUrl,
                thumbnail_url: thumbnailUrl,
                content_type: finalContentType,
                caption: finalCaption,
                ai_prompt_used: [
                    `Image prompt: ${textResult.content.image_prompt}`,
                    textResult.content.creative_plan?.scenario_type
                        ? `Scenario: ${textResult.content.creative_plan.scenario_type}`
                        : "",
                    textResult.content.creative_plan?.subject_definition
                        ? `Subject: ${textResult.content.creative_plan.subject_definition}`
                        : "",
                    textResult.content.creative_plan?.exact_text_value
                        ? `Exact text: ${textResult.content.creative_plan.exact_text_value}`
                        : "",
                    textResult.content.creative_plan?.visual_constraints?.length
                        ? `Visual constraints: ${textResult.content.creative_plan.visual_constraints.join("; ")}`
                        : "",
                    textResult.content.creative_plan?.negative_constraints?.length
                        ? `Avoid: ${textResult.content.creative_plan.negative_constraints.join("; ")}`
                        : "",
                ].filter(Boolean).join("\n"),
                base_image_url: baseImageUrl,
                typography_meta: typographyMeta,
                generation_params: generationParams,
                status: "completed",
                expires_at: expiresAt,
            })
            .select()
            .single();

        if (insertError) {
            await logGenerationError({
                userId: user.id,
                errorMessage: `Database insert failed: ${insertError.message}`,
                errorType: "database",
                requestParams: sanitizedRequestParams,
            });
            console.error("Failed to save post:", insertError);
            throw new Error("Failed to save generated post");
        }

        // Record usage
        const textUsage = textResult.usage;
        const imageUsage = imageResult?.usage;

        // Phase 24 (CRIT-03): the critic attempt actually accepted into imageResult
        // above (undefined for video, which never enters the critic loop).
        const acceptedAttempt = criticSelection?.acceptedIndex != null
            ? criticAttempts.find((a) => a.index === criticSelection!.acceptedIndex)
            : undefined;

        // Real gateway cost (GATE-05): sum text + image OpenRouter costs when
        // either leg reported one; leave undefined (not 0) when neither did so
        // token-table pricing still applies to direct-path runs. Video runs
        // never pass a partial real cost — video stays on flat fallback pricing.
        const textCostMicros = textResult.costUsdMicros;
        const imageCostMicros = imageResult?.costUsdMicros;
        // Phase 24 (CRIT-03): the charge covers the FINAL ACCEPTED attempt only —
        // its image call plus its critic call. Discarded attempts are platform-side
        // and go to metadata (below), NEVER into this expression.
        const acceptedCriticCostMicros = acceptedAttempt?.outcome.costUsdMicros;
        const realCostUsdMicros =
            typeof textCostMicros === "number" || typeof imageCostMicros === "number" || typeof acceptedCriticCostMicros === "number"
                ? (textCostMicros ?? 0) + (imageCostMicros ?? 0) + (acceptedCriticCostMicros ?? 0)
                : undefined;
        const gatewayRealCost = content_type === "video" ? undefined : realCostUsdMicros;

        // Phase 24 (CRIT-03): discarded-attempt cost — platform-side, informational
        // only, threaded into recordUsageEvent's extraMetadata (8th arg) below. It
        // never touches realCostUsdMicros/gatewayRealCost above.
        const rerollMeta = computeRerollMetadata(criticAttempts, criticSelection?.acceptedIndex ?? null);

        // Phase 24 (CRIT-05): success-path critic log, emitted BEFORE recordUsageEvent
        // so the row lands even if the usage-event call throws. The post row is
        // confirmed inserted by now, so the post_id FK resolves. The hard-fail path
        // (unwanted text in every attempt) already logged its own row above, before
        // this line was ever reached — video never enters the critic loop at all.
        if (criticSelection && content_type !== "video") {
            await logVisualCritic({
                postId,
                outcome: criticSelection.outcome,
                attemptCount: criticAttempts.length,
                textFreeCompliant: true, // unreachable otherwise: acceptedIndex is never a hard-fail attempt
                finalScores: acceptedAttempt?.outcome.scores ?? null,
                rerollAttemptCount: rerollMeta.reroll_attempt_count,
                rerollCostUsdMicros: rerollMeta.reroll_cost_usd_micros,
                durationMs: criticDurationMs,
            });
        }

        const usageEvent = await recordUsageEvent(
            user.id,
            postId,
            "generate",
            {
                text_input_tokens: textUsage?.promptTokenCount,
                text_output_tokens: textUsage?.candidatesTokenCount,
                image_input_tokens: imageUsage?.promptTokenCount,
                image_output_tokens: imageUsage?.candidatesTokenCount,
            },
            {
                text_model: textResult.model,
                image_model: imageResult?.model || "veo-3.1-generate-preview",
            },
            gatewayRealCost,
            creditStatus?.estimated_cost_micros,
            content_type === "video" ? undefined : {
                reroll_attempt_count: rerollMeta.reroll_attempt_count,
                reroll_cost_usd_micros: rerollMeta.reroll_cost_usd_micros,   // platform-side, NOT charged
                critic_outcome: criticSelection?.outcome ?? null,
                critic_cost_usd_micros: acceptedCriticCostMicros ?? null,     // accepted attempt only, IS part of the charge above
                critic_final_scores: acceptedAttempt?.outcome.scores ?? null,
            },
        );

        if (!ownApiKey && creditStatus) {
            await deductCredits(
                user.id,
                usageEvent.id,
                usageEvent.cost_usd_micros,
                usageEvent.charged_amount_micros,
            );
        }

        sse.sendComplete({
            post,
            image_url: imageUrl,
            thumbnail_url: post?.thumbnail_url || null,
            base_image_url: post?.base_image_url || null,
            typography_meta: post?.typography_meta || null,
            content_type: finalContentType,
            caption: finalCaption,
            headline: textResult.content.headline,
            subtext: textResult.content.subtext,
            post_id: postId,
            expires_at: post.expires_at || expiresAt,
        });

    } catch (error) {
        console.error("Generation error:", error);

        // Phase 24 (CRIT-04): when the safety timer fired it OWNS the user-facing failure —
        // it already aborted the controller, sent the 504, and wrote its own generation_logs
        // row. The rejection arriving here is a CONSEQUENCE of that abort, not a new failure:
        // handling it again duplicates the error row and (because sendError is
        // first-write-wins) would race a generic 500 carrying a raw "operation was aborted"
        // message ahead of the timeout message. Return early — the finally block below still
        // runs and clears the timer.
        if (controller.signal.aborted) {
            return;
        }

        const errorMessage = error instanceof Error ? error.message : "Generation failed";

        // Log the error (specific phase errors are already logged in their catch blocks)
        if (error instanceof Error && error.message !== "Client disconnected") {
            await logGenerationError({
                userId: user.id,
                errorMessage: error.message,
                errorType: "unknown",
                requestParams: sanitizedRequestParams,
            }).catch(() => {});
        }

        if (!sse.isClosed()) {
            sse.sendError({ message: errorMessage, statusCode: 500 });
        }
    } finally {
        clearTimeout(safetyTimer);
    }
});

export default router;
