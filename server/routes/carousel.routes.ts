/**
 * Carousel Routes - Multi-slide carousel generation + per-slide editing
 * Handles SSE-streamed carousel generation via Gemini AI with per-slide progress events.
 * Also handles POST /api/carousel/slide/edit for editing individual carousel slides.
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { createServerSupabase, createAdminSupabase } from "../supabase.js";
import { carouselRequestSchema, editSlideRequestSchema, type CarouselRequest } from "../../shared/schema.js";
import {
    authenticateUser,
    AuthenticatedRequest,
    getGeminiApiKey,
    getOpenAIApiKey,
    usesOwnApiKey,
} from "../middleware/auth.middleware.js";
import { aiRateLimit, DEFAULT_AI_LIMITS } from "../middleware/rate-limit.middleware.js";
import { getActiveImageProvider } from "../services/image-provider.js";
import {
    generateCarousel,
    CarouselFullFailureError,
    CarouselAbortedError,
    CarouselTextPlanError,
    CarouselInvalidAspectError,
    type CarouselProgressEvent,
} from "../services/carousel-generation.service.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { checkCredits, deductCredits, recordUsageEvent, canUseQuickRemake, incrementQuickRemakeCount } from "../quota.js";
import { initSSE } from "../lib/sse.js";
import { downloadImageAsBase64, LANGUAGE_NAMES } from "../services/prompt-builder.service.js";
import { processImageWithThumbnail, formatBytes } from "../services/image-optimization.service.js";
import { trackMarketingEvent } from "../integrations/marketing.js";
import { getSiteOrigin, getRequestIp } from "../services/app-settings.service.js";

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
        prompt: typeof payload.prompt === "string" ? payload.prompt.slice(0, 200) : undefined,
        slide_count: typeof payload.slide_count === "number" ? payload.slide_count : undefined,
        aspect_ratio: typeof payload.aspect_ratio === "string" ? payload.aspect_ratio : undefined,
        post_mood: typeof payload.post_mood === "string" ? payload.post_mood : undefined,
        content_language: typeof payload.content_language === "string" ? payload.content_language : undefined,
        text_style_id: typeof payload.text_style_id === "string" ? payload.text_style_id : undefined,
        text_style_ids: Array.isArray(payload.text_style_ids)
            ? payload.text_style_ids.filter((v): v is string => typeof v === "string")
            : undefined,
        use_logo: typeof payload.use_logo === "boolean" ? payload.use_logo : undefined,
        logo_position: typeof payload.logo_position === "string" ? payload.logo_position : undefined,
        idempotency_key: typeof payload.idempotency_key === "string" ? payload.idempotency_key : undefined,
    };
}

const router = Router();

// Rate limiter for /api/carousel/generate (HARD-01) — 30 req / 5 min, admin-bypass.
const aiPaidLimiter = aiRateLimit(DEFAULT_AI_LIMITS.paid_image_video);

/**
 * POST /api/carousel/generate
 * Generates a multi-slide Instagram carousel with per-slide SSE progress.
 * Idempotency: duplicate idempotency_key returns the existing post as JSON 200.
 */
router.post("/api/carousel/generate", async (req: Request, res: Response) => {
    // 1. Authenticate
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

    // 2. Fetch profile
    const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin, is_affiliate, is_business, api_key, openai_api_key, image_provider")
        .eq("id", user.id)
        .single();

    // ── Rate limit gate (HARD-01) ──
    // Attach to req so the limiter's keyGenerator/skip can read them.
    (req as any).user = user;
    (req as any).profile = profile;
    await new Promise<void>((resolve) => {
        aiPaidLimiter(req as any, res as any, () => {
            resolve();
        });
    });
    if (res.headersSent) {
        return;
    }

    const ownApiKey = usesOwnApiKey(profile);

    // 3. Resolve Gemini key
    const { key: geminiApiKey, error: keyError } = await getGeminiApiKey(profile);
    if (keyError) {
        await logGenerationError({
            userId: user.id,
            errorMessage: keyError,
            errorType: "configuration",
            requestParams: sanitizeRequestForLogging(req.body),
        });
        return res.status(400).json({ message: keyError });
    }

    // 4. Fetch brand
    const { data: brand, error: brandError } = await supabase
        .from("brands").select("*").eq("user_id", user.id).single();
    if (brandError || !brand) {
        await logGenerationError({
            userId: user.id,
            errorMessage: "No brand profile found. Please complete onboarding.",
            errorType: "configuration",
            requestParams: sanitizeRequestForLogging(req.body),
        });
        return res.status(400).json({ message: "No brand profile found. Please complete onboarding." });
    }

    // 5. Validate body with carouselRequestSchema
    const parseResult = carouselRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        const validationMessage = "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ");
        await logGenerationError({
            userId: user.id,
            errorMessage: validationMessage,
            errorType: "validation",
            requestParams: sanitizeRequestForLogging(req.body),
        });
        return res.status(400).json({ message: validationMessage });
    }
    const parsed: CarouselRequest = parseResult.data;
    const sanitizedRequestParams = sanitizeRequestForLogging(req.body);

    // 6. Idempotency pre-flight (D-01, D-02 — pessimistic SELECT before service call).
    //    Use ADMIN client so we bypass RLS for the read; scope manually via user_id equality.
    const adminSb = createAdminSupabase();
    const { data: existingPost } = await adminSb
        .from("posts")
        .select("*")
        .eq("idempotency_key", parsed.idempotency_key)
        .eq("user_id", user.id)
        .maybeSingle();
    if (existingPost) {
        // JSON 200, not SSE. Client must handle this code path.
        return res.status(200).json({
            idempotent: true,
            post: existingPost,
        });
    }

    // 7. Credit gate (pass slide_count as 4th arg for BILL-01).
    const creditStatus = !ownApiKey
        ? await checkCredits(user.id, "generate", false, parsed.slide_count)
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
    const sse = initSSE(res);
    sse.startHeartbeat();
    sse.sendProgress("auth", "Verified. Starting carousel generation...", 2);

    // AbortController + 260s safety timer (D-09). Vercel kills at 280s.
    const controller = new AbortController();
    const safetyTimer = setTimeout(() => {
        controller.abort();
    }, 260_000);

    try {
    // Progress mapping (D-05). Progress slots:
    //   auth: 2, text_plan_start: 5, text_plan_complete: 10
    //   per slide i (1-indexed): 10 + i * floor(80 / slideCount)
    //   complete: 95 (then service complete → 100 via sendComplete)
    const slideCount = parsed.slide_count;
    const perSlideStep = Math.floor(80 / slideCount);
    const mapProgress = (event: CarouselProgressEvent) => {
        if (sse.isClosed()) return;
        switch (event.type) {
            case "text_plan_start":
                sse.sendProgress("text_plan", "Crafting slide plan...", 5);
                break;
            case "text_plan_complete":
                sse.sendProgress("text_plan", "Plan ready. Generating slides...", 10);
                break;
            case "slide_start":
                sse.sendProgress(
                    `slide_${event.slideNumber}`,
                    `Generating slide ${event.slideNumber} of ${slideCount}...`,
                    10 + event.slideNumber * perSlideStep,
                );
                break;
            case "slide_complete":
                sse.sendProgress(
                    `slide_${event.slideNumber}`,
                    `Slide ${event.slideNumber} ready.`,
                    10 + event.slideNumber * perSlideStep,
                );
                break;
            case "slide_failed":
                sse.sendProgress(
                    `slide_${event.slideNumber}`,
                    `Slide ${event.slideNumber} retrying or skipped: ${event.reason.slice(0, 80)}`,
                    10 + event.slideNumber * perSlideStep,
                );
                break;
            case "complete":
                // The service emits this RIGHT before returning (or before
                // throwing CarouselAbortedError). Don't sendComplete here —
                // the route does that after billing. Just emit one last
                // progress tick for the UI.
                sse.sendProgress(
                    "finalizing",
                    event.status === "draft"
                        ? `Carousel saved as draft (${event.savedSlideCount} slide(s)).`
                        : `All ${event.savedSlideCount} slides ready. Finalizing...`,
                    95,
                );
                break;
        }
    };

    // Style catalog + key resolution already done. Call the service.
    let result: Awaited<ReturnType<typeof generateCarousel>> | null = null;
    let abortedPartial: { savedSlideCount: number } | null = null;
    try {
        const styleCatalog = await getStyleCatalogPayload();
        const imageProvider = await getActiveImageProvider(profile);
        let imageApiKey: string | undefined;
        if (imageProvider.name === "openai") {
            const openaiKeyRes = await getOpenAIApiKey(profile);
            if (openaiKeyRes.error) {
                clearTimeout(safetyTimer);
                if (!sse.isClosed()) {
                    sse.sendError({ message: openaiKeyRes.error, statusCode: 400 });
                }
                return;
            }
            imageApiKey = openaiKeyRes.key;
        }
        result = await generateCarousel({
            userId: user.id,
            apiKey: geminiApiKey,
            imageProvider,
            imageApiKey,
            brand: brand as any,
            styleCatalog,
            prompt: parsed.prompt,
            slideCount: parsed.slide_count,
            aspectRatio: parsed.aspect_ratio,
            postMood: parsed.post_mood,
            contentLanguage: parsed.content_language,
            idempotencyKey: parsed.idempotency_key,
            textStyleIds: parsed.text_style_ids,
            useLogo: parsed.use_logo,
            logoPosition: parsed.logo_position,
            signal: controller.signal,
            onProgress: mapProgress,
        });
    } catch (err) {
        if (err instanceof CarouselAbortedError) {
            if (err.savedSlideCount >= 1) {
                // Partial success via safety timer / client disconnect. The
                // service already persisted the post + slides before throwing.
                abortedPartial = { savedSlideCount: err.savedSlideCount };
                // Fall through to billing by re-fetching the saved post below.
            } else {
                await logGenerationError({
                    userId: user.id,
                    errorMessage: "Carousel aborted before slide 1 completed",
                    errorType: "image_generation",
                    requestParams: sanitizedRequestParams,
                });
                if (!sse.isClosed()) {
                    sse.sendError({
                        message: "Carousel aborted before any slide completed. No credits charged.",
                        error: "carousel_aborted",
                        statusCode: 504,
                    });
                }
                return;
            }
        } else if (err instanceof CarouselFullFailureError) {
            await logGenerationError({
                userId: user.id,
                errorMessage: err.message,
                errorType: "image_generation",
                requestParams: sanitizedRequestParams,
            });
            if (!sse.isClosed()) {
                sse.sendError({
                    message: err.message,
                    error: "carousel_full_failure",
                    statusCode: 500,
                });
            }
            return;
        } else if (err instanceof CarouselTextPlanError) {
            await logGenerationError({
                userId: user.id,
                errorMessage: err.message,
                errorType: "text_generation",
                requestParams: sanitizedRequestParams,
            });
            if (!sse.isClosed()) {
                sse.sendError({
                    message: "Unable to plan this carousel. Please try a different prompt.",
                    error: "text_plan_failed",
                    statusCode: 500,
                });
            }
            return;
        } else if (err instanceof CarouselInvalidAspectError) {
            if (!sse.isClosed()) {
                sse.sendError({
                    message: err.message,
                    error: "invalid_aspect_ratio",
                    statusCode: 400,
                });
            }
            return;
        } else {
            const message = err instanceof Error ? err.message : "Carousel generation failed";
            await logGenerationError({
                userId: user.id,
                errorMessage: message,
                errorType: "unknown",
                requestParams: sanitizedRequestParams,
            }).catch(() => {});
            if (!sse.isClosed()) {
                sse.sendError({ message, statusCode: 500 });
            }
            return;
        }
    }

    // If we fell through via abortedPartial, rehydrate the result from DB.
    if (!result && abortedPartial) {
        const { data: postRow } = await adminSb
            .from("posts")
            .select("*")
            .eq("idempotency_key", parsed.idempotency_key)
            .eq("user_id", user.id)
            .maybeSingle();
        const { data: slideRows } = await adminSb
            .from("post_slides")
            .select("slide_number, image_url, thumbnail_url")
            .eq("post_id", postRow?.id)
            .order("slide_number");
        if (!postRow || !slideRows?.length) {
            if (!sse.isClosed()) {
                sse.sendError({
                    message: "Carousel aborted but partial state could not be recovered.",
                    error: "carousel_aborted",
                    statusCode: 504,
                });
            }
            return;
        }
        // Rebuild a minimal result object shape for the billing block.
        result = {
            postId: postRow.id,
            status: postRow.status as "completed" | "draft",
            slideCount: slideRows.length,
            slides: slideRows.map((s: any) => ({
                slideNumber: s.slide_number,
                imageUrl: s.image_url,
                thumbnailUrl: s.thumbnail_url,
            })),
            caption: postRow.caption ?? "",
            sharedStyle: "",
            tokenTotals: {
                // Aborted before service returned — we don't have accurate token counts.
                // Fall back to zero totals so recordUsageEvent uses the operation-fallback
                // cost and the user is billed only the flat fallback rate for the aborted run.
                textInputTokens: 0,
                textOutputTokens: 0,
                imageInputTokens: 0,
                imageOutputTokens: 0,
            },
            textModel: "gemini-2.5-flash",
            imageModel: "gemini-3.1-flash-image-preview",
        };
    }

    if (!result) {
        if (!sse.isClosed()) {
            sse.sendError({ message: "Carousel generation produced no result", statusCode: 500 });
        }
        return;
    }

    // ── Billing (BILL-02, BILL-03). ONE recordUsageEvent call per carousel.
    const usageEvent = await recordUsageEvent(
        user.id,
        result.postId,
        "generate",
        {
            text_input_tokens: result.tokenTotals.textInputTokens,
            text_output_tokens: result.tokenTotals.textOutputTokens,
            image_input_tokens: result.tokenTotals.imageInputTokens,
            image_output_tokens: result.tokenTotals.imageOutputTokens,
        },
        {
            text_model: result.textModel,
            image_model: result.imageModel,
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

    // ── Final SSE complete event (D-03 shape) ──
    // Fetch the persisted post so the client gets the real DB row.
    const { data: finalPost } = await adminSb
        .from("posts")
        .select("*")
        .eq("id", result.postId)
        .maybeSingle();

    sse.sendComplete({
        type: "complete",
        post: finalPost,
        status: result.status,
        saved_slide_count: result.slideCount,
        image_urls: result.slides.map((s) => s.imageUrl),
        caption: result.caption,
    });
    } finally {
        clearTimeout(safetyTimer);
    }
});

/**
 * Log a slide edit error to the database
 */
async function logSlideEditError(params: {
    userId: string | null;
    errorMessage: string;
    errorType: "image_generation" | "upload" | "database" | "unknown";
    requestParams?: Record<string, unknown>;
}): Promise<void> {
    try {
        const sb = createAdminSupabase();
        const { error } = await sb.from("generation_logs").insert({
            user_id: params.userId,
            status: "failed",
            error_message: params.errorMessage || "Slide edit failed",
            error_type: params.errorType,
            request_params: params.requestParams || null,
        });
        if (error) {
            console.error("Failed to insert slide edit error log:", error);
        }
    } catch (logError) {
        console.error("Failed to log slide edit error:", logError);
    }
}

/**
 * POST /api/carousel/slide/edit
 * Edit a single carousel slide by slide_id. Streams progress via SSE.
 * - Bills 1× edit credit (no slideCount multiplier) — CRSL-EDIT-04
 * - Passes slide-1 image as additionalRefs[0] for slides 2..N — CRSL-EDIT-05
 * - Inserts a row into post_slide_versions on success — CRSL-EDIT-03
 * - Handles source: "quick_remake" by injecting post.ai_prompt_used as regeneration seed
 *
 * NOTE: This endpoint does NOT modify edit.routes.ts (per RESEARCH.md Pitfall 6).
 * NOTE: Caption regeneration is intentionally skipped for slide-level edits —
 *       the carousel caption is master-text scoped to the full post (CRSL-09).
 */
router.post("/api/carousel/slide/edit", async (req: Request, res: Response) => {
    let currentUserId: string | null = null;
    let requestContext: Record<string, unknown> | undefined;
    try {
        // 1. Auth
        const token = req.headers.authorization?.replace("Bearer ", "");
        if (!token) {
            return res.status(401).json({ message: "Authentication required" });
        }
        const supabase = createServerSupabase(token);
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return res.status(401).json({ message: "Invalid authentication" });
        }
        currentUserId = user.id;

        // 2. Validate body
        const parseResult = editSlideRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                message:
                    "Invalid request: " +
                    parseResult.error.errors.map((e) => e.message).join(", "),
            });
        }
        const { slide_id, post_id, edit_prompt, content_language, source, edit_context } =
            parseResult.data;

        // 3. Effective edit context for quick_remake (mirrors edit.routes.ts lines 94–116)
        const effectiveEditContext =
            source === "quick_remake"
                ? {
                      goal_text:
                          edit_context?.goal_text ||
                          "Create a fresh variation that preserves the same main subject, commercial meaning, and brand feel.",
                      focus_areas:
                          edit_context?.focus_areas?.length
                              ? edit_context.focus_areas
                              : ["subject", "style", "composition"],
                      focus_details:
                          edit_context?.focus_details ||
                          "Keep the main subject recognizable, preserve the offer/message, and explore a new composition without drifting away from the concept.",
                      text_mode: edit_context?.text_mode || "keep",
                      replacement_text: edit_context?.replacement_text,
                      text_style_id: edit_context?.text_style_id,
                      text_style_ids: edit_context?.text_style_ids,
                      preserve_brand_colors: edit_context?.preserve_brand_colors,
                      preserve_layout: edit_context?.preserve_layout ?? false,
                      extra_notes:
                          edit_context?.extra_notes ||
                          "Refresh the creative direction while keeping the brand identity and visible commercial intent consistent.",
                  }
                : edit_context;

        requestContext = {
            slide_id,
            post_id,
            source,
            content_language,
            has_edit_context: Boolean(effectiveEditContext),
        };

        // 4. Ownership + slide fetch (DO NOT trust client-sent slide_number — RESEARCH.md Pitfall 5)
        const { data: slide } = await supabase
            .from("post_slides")
            .select("id, post_id, slide_number, image_url, posts!inner(id, user_id, content_type, ai_prompt_used)")
            .eq("id", slide_id)
            .eq("posts.user_id", user.id)
            .single() as { data: {
                id: string;
                post_id: string;
                slide_number: number;
                image_url: string;
                posts: { id: string; user_id: string; content_type: string; ai_prompt_used: string | null };
            } | null };

        if (!slide) {
            return res.status(404).json({ message: "Slide not found or access denied" });
        }
        if (slide.post_id !== post_id) {
            return res.status(403).json({ message: "slide_id does not belong to the provided post_id" });
        }
        if (slide.posts.content_type !== "carousel") {
            return res.status(400).json({ message: "Not a carousel slide" });
        }

        // 5. Profile + key resolution
        const { data: editProfile } = await supabase
            .from("profiles")
            .select("is_admin, is_affiliate, api_key, openai_api_key, image_provider")
            .eq("id", user.id)
            .single();

        const ownApiKey = usesOwnApiKey(editProfile);
        const { key: geminiApiKey, error: geminiKeyError } = await getGeminiApiKey(editProfile);
        if (geminiKeyError) {
            return res.status(ownApiKey ? 400 : 500).json({
                message: ownApiKey
                    ? "Admin and affiliate accounts must configure their own Gemini API key in Settings before editing."
                    : geminiKeyError,
            });
        }

        // 6. Brand fetch
        const { data: brand } = await supabase
            .from("brands")
            .select("*")
            .eq("user_id", user.id)
            .single();
        if (!brand) {
            return res.status(400).json({ message: "No brand profile found" });
        }

        // 7. Credits gate — 1× edit cost, NO slideCount multiplier (CRSL-EDIT-04 / RESEARCH.md Pitfall 2)
        const creditStatus = !ownApiKey ? await checkCredits(user.id, "edit") : null;
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

        // 8. Quick remake quota gate (mirrors edit.routes.ts lines 200–209)
        if (source === "quick_remake" && !ownApiKey) {
            const quickRemakeCheck = await canUseQuickRemake(user.id);
            if (!quickRemakeCheck.allowed) {
                return res.status(402).json({
                    error: "quick_remake_limit_reached",
                    message: "You have reached your quick remake limit. Upgrade to a paid plan for unlimited quick remakes.",
                    quick_remake_remaining: 0,
                });
            }
        }

        // 9. Style catalog
        const styleCatalog = await getStyleCatalogPayload();
        const imageModel =
            styleCatalog.ai_models?.image_generation || "gemini-3.1-flash-image-preview";

        // ── Initialize SSE stream ──
        const sse = initSSE(res);
        sse.startHeartbeat();
        sse.sendProgress("auth", "Verified. Starting slide edit...", 10);

        const safetyTimer = setTimeout(async () => {
            await logSlideEditError({
                userId: currentUserId,
                errorMessage: "Slide edit timed out (exceeded maximum allowed duration)",
                errorType: "unknown",
                requestParams: requestContext,
            });
            sse.sendError({ message: "Slide edit timed out. Please try again.", statusCode: 504 });
        }, 280_000);

        try {
            // 10. Download brand logo for edit if available
            let editLogoData: { mimeType: string; data: string } | null = null;
            if (brand.logo_url) {
                editLogoData = await downloadImageAsBase64(brand.logo_url);
            }

            // 11. Fetch current slide image + slide-1 anchor for slides 2..N (CRSL-EDIT-05)
            sse.sendProgress("image_generation", "Loading slide images...", 20);

            const currentResp = await fetch(slide.image_url);
            if (!currentResp.ok) {
                throw new Error("Failed to fetch current slide image");
            }
            const currentBuf = Buffer.from(await currentResp.arrayBuffer());
            const currentBase64 = currentBuf.toString("base64");
            const currentMime =
                currentResp.headers.get("content-type")?.split(";")[0] || "image/png";

            // Slide-1 style anchor — pass as additionalRefs[0] for slides 2..N
            let slide1Ref: { mimeType: string; data: string } | undefined;
            if (slide.slide_number > 1) {
                const { data: s1 } = await supabase
                    .from("post_slides")
                    .select("image_url")
                    .eq("post_id", post_id)
                    .eq("slide_number", 1)
                    .single();
                if (s1?.image_url) {
                    const r = await fetch(s1.image_url);
                    if (r.ok) {
                        const buf = Buffer.from(await r.arrayBuffer());
                        slide1Ref = {
                            mimeType: r.headers.get("content-type")?.split(";")[0] || "image/png",
                            data: buf.toString("base64"),
                        };
                    }
                }
            }

            // 12. Build edit prompt (mirrors edit.routes.ts image branch, lines 348–413)
            const selectedFocusAreas = effectiveEditContext?.focus_areas?.length
                ? effectiveEditContext.focus_areas.join(", ")
                : "No specific focus areas provided.";
            const selectedTextStyleIds = effectiveEditContext?.text_style_ids?.length
                ? effectiveEditContext.text_style_ids
                : effectiveEditContext?.text_style_id
                    ? [effectiveEditContext.text_style_id]
                    : [];
            const selectedTextStyles =
                styleCatalog.text_styles?.filter((item: { id: string }) =>
                    selectedTextStyleIds.includes(item.id)
                ) || [];

            const effectiveGoal = effectiveEditContext?.goal_text || edit_prompt;
            const promptSourceLabel = source === "quick_remake" ? "quick_remake" : "manual";

            const languageInstruction =
                content_language !== "en"
                    ? `\n\nCRITICAL: Any text that appears in the edited image must be in ${LANGUAGE_NAMES[content_language]}.`
                    : "";

            const textEditRules: Record<string, string> = {
                keep: "Keep existing text exactly as-is.",
                improve: "Improve text readability and hierarchy while preserving meaning.",
                replace: effectiveEditContext?.replacement_text
                    ? `Replace existing text with: "${effectiveEditContext.replacement_text}".`
                    : "Replace existing text with stronger, on-brand copy.",
                remove: "Remove all text from the image.",
            };

            const structuredEditInstructions = [
                `Request source: ${promptSourceLabel}.`,
                `Primary edit goal: ${effectiveGoal}.`,
                `Focus areas: ${selectedFocusAreas}`,
                effectiveEditContext?.focus_details
                    ? `Focus details: ${effectiveEditContext.focus_details}`
                    : "",
                effectiveEditContext?.text_mode
                    ? `Text handling: ${textEditRules[effectiveEditContext.text_mode] || textEditRules.keep}`
                    : "",
                selectedTextStyles.length > 0
                    ? `Text style presets: ${selectedTextStyles.map((style: { label: string; description: string }) => `${style.label} (${style.description})`).join(", ")}. Use them as a coordinated typography system.`
                    : "",
                source === "quick_remake"
                    ? "Preserve the recognizable subject and core commercial meaning from the current image."
                    : "",
                effectiveEditContext?.preserve_brand_colors === true
                    ? "Preserve brand colors."
                    : "",
                effectiveEditContext?.preserve_brand_colors === false
                    ? "Color updates allowed, but stay on-brand."
                    : "",
                effectiveEditContext?.preserve_layout === true
                    ? "Preserve layout and element placement as much as possible."
                    : "",
                effectiveEditContext?.preserve_layout === false
                    ? "Layout can be improved if it benefits the result."
                    : "",
                effectiveEditContext?.extra_notes
                    ? `Additional notes: ${effectiveEditContext.extra_notes}`
                    : "",
                // For quick_remake: inject the original carousel prompt as regeneration seed
                source === "quick_remake" && slide.posts.ai_prompt_used
                    ? `Original carousel intent (regeneration seed): ${slide.posts.ai_prompt_used}`
                    : slide.posts.ai_prompt_used
                        ? `Original carousel generation intent context: ${slide.posts.ai_prompt_used}`
                        : "",
            ]
                .filter(Boolean)
                .join("\n");

            // Carousel-specific suffix — provides style-anchor context for slide N>1
            const carouselContextSuffix = `\n\nCarousel context: this is slide ${slide.slide_number} of a multi-slide carousel for "${brand.company_name}". Preserve the carousel's overall visual language. ${slide1Ref ? "A reference image showing slide 1 is provided — match its visual style, color palette, and typographic tone." : "This IS slide 1 — your output sets the visual language for the rest of the carousel."}`;

            // NOTE: enforceExactImageText is intentionally NOT called here.
            // Carousel slides (v1.1) do not use on-image text rendering (CRSL-10).
            // text_mode will typically be "keep"; the Text-on-Image dialog step is skipped.
            const editPrompt = `You are a PROFESSIONAL BRAND DESIGNER editing an existing social media carousel image for "${brand.company_name}".${languageInstruction}

Brand context:
- Brand name: ${brand.company_name}
- Industry: ${brand.company_type}
- Brand colors: ${brand.color_1}, ${brand.color_2}, ${brand.color_3}
- Style: ${brand.mood}
${editLogoData ? "- The brand's actual logo image is provided as a reference - use it if the edit requires logo changes" : ""}

Structured edit request:
${structuredEditInstructions}

Modify the image according to the request while maintaining the brand's visual identity and colors.${editLogoData ? " If the logo needs to appear or be updated, use the EXACT logo provided." : ""}${carouselContextSuffix}`;

            // 13. Provider edit call (never call Gemini/OpenAI directly — RESEARCH.md Pitfall 1)
            sse.sendProgress("image_generation", "Editing slide...", 35);
            const provider = await getActiveImageProvider(editProfile);
            let imageApiKey = geminiApiKey;
            if (provider.name === "openai") {
                const openaiKeyRes = await getOpenAIApiKey(editProfile);
                if (openaiKeyRes.error) {
                    clearTimeout(safetyTimer);
                    sse.sendError({ message: openaiKeyRes.error, statusCode: 400 });
                    return;
                }
                imageApiKey = openaiKeyRes.key;
            }

            const result = await provider.edit({
                prompt: editPrompt,
                currentImage: { mimeType: currentMime, data: currentBase64 },
                apiKey: imageApiKey,
                model: imageModel,
                logoImageData: editLogoData,
                // CRSL-EDIT-05: pass slide-1 as style anchor for slides 2..N only
                additionalRefs: slide1Ref ? [slide1Ref] : undefined,
            });

            // 14. Optimize + upload
            sse.sendProgress("optimization", "Optimizing slide image...", 65);

            const originalSize = result.buffer.length;
            const { image: optimizedImage, thumbnail } = await processImageWithThumbnail(result.buffer);
            console.log(`[Slide Edit Optimization] slide ${slide.slide_number}: ${formatBytes(originalSize)} → ${formatBytes(optimizedImage.sizeBytes)}`);

            // Compute next version number for this specific slide
            const adminSb = createAdminSupabase();
            const { data: existingVersions } = await adminSb
                .from("post_slide_versions")
                .select("version_number")
                .eq("post_slide_id", slide_id)
                .order("version_number", { ascending: false })
                .limit(1);
            const nextVersionNumber = (existingVersions?.[0]?.version_number || 0) + 1;
            const versionId = randomUUID();

            // Storage path: mirrors carousel-generation.service.ts convention
            const imagePath = `${user.id}/carousel/${post_id}/slide-${slide.slide_number}-v${nextVersionNumber}-${versionId}.webp`;
            const thumbnailPath = `${user.id}/thumbnails/carousel/${post_id}/slide-${slide.slide_number}-v${nextVersionNumber}-${versionId}.webp`;

            const { error: uploadError } = await adminSb.storage
                .from("user_assets")
                .upload(imagePath, optimizedImage.buffer, {
                    contentType: "image/webp",
                    upsert: false,
                });
            if (uploadError) {
                throw new Error(`Upload failed: ${uploadError.message}`);
            }
            const { data: urlData } = adminSb.storage.from("user_assets").getPublicUrl(imagePath);
            const publicUrl = urlData.publicUrl;

            let thumbnailUrl: string | null = null;
            try {
                await adminSb.storage
                    .from("user_assets")
                    .upload(thumbnailPath, thumbnail.buffer, {
                        contentType: "image/webp",
                        upsert: false,
                    });
                const { data: thumbData } = adminSb.storage
                    .from("user_assets")
                    .getPublicUrl(thumbnailPath);
                thumbnailUrl = thumbData.publicUrl;
            } catch (thumbError) {
                console.warn("Thumbnail upload failed (non-critical):", thumbError);
            }

            if (sse.isClosed()) throw new Error("Client disconnected");

            // 15. Insert post_slide_versions row (CRSL-EDIT-03)
            // Use createAdminSupabase() to bypass RLS — consistent with carousel-generation.service.ts (RESEARCH.md Pitfall 4)
            sse.sendProgress("saving", "Saving slide version...", 90);
            const { data: newVersion, error: insErr } = await adminSb
                .from("post_slide_versions")
                .insert({
                    post_slide_id: slide_id,
                    version_number: nextVersionNumber,
                    image_url: publicUrl,
                    thumbnail_url: thumbnailUrl,
                    edit_prompt: edit_prompt,
                })
                .select()
                .single();
            if (insErr || !newVersion) {
                throw new Error("Failed to save slide version");
            }

            // 16. Update post_slides.image_url to new version URL (latest-wins for gallery display)
            // Prior URL is preserved in the post_slide_versions row, maintaining full history.
            await adminSb
                .from("post_slides")
                .update({ image_url: publicUrl, thumbnail_url: thumbnailUrl })
                .eq("id", slide_id);

            // 17. Record usage + deduct credits
            const usageEvent = await recordUsageEvent(user.id, post_id, "edit", {}, {
                image_model: imageModel,
            });
            if (!ownApiKey) {
                await deductCredits(
                    user.id,
                    usageEvent.id,
                    usageEvent.cost_usd_micros,
                    usageEvent.charged_amount_micros,
                );
            }
            if (source === "quick_remake" && !ownApiKey) {
                await incrementQuickRemakeCount(user.id);
            }

            // 18. Marketing tracking
            void trackMarketingEvent({
                event_name: "edit",
                event_key: `edit:slide:${newVersion.id}`,
                event_source: "app",
                user_id: user.id,
                email: user.email || null,
                event_payload: {
                    slide_id,
                    slide_number: slide.slide_number,
                    post_id,
                    version_number: newVersion.version_number,
                    content_type: "carousel-slide",
                },
                event_source_url: req.get("referer") || getSiteOrigin(req),
                ip_address: getRequestIp(req),
                user_agent: req.get("user-agent") || null,
            }).catch((trackingError) => {
                console.error("Marketing tracking failed (slide edit):", trackingError);
            });

            // 19. SSE complete
            // Slide-level edits do not regenerate the carousel-wide caption — caption is master-text scoped (CRSL-09).
            clearTimeout(safetyTimer);
            sse.sendComplete({
                slide_version_id: newVersion.id,
                version_number: newVersion.version_number,
                image_url: publicUrl,
                thumbnail_url: thumbnailUrl,
                slide_id,
                post_id,
                slide_number: slide.slide_number,
            });
        } catch (error: any) {
            clearTimeout(safetyTimer);
            console.error("Slide edit error:", error);

            const message = String(error?.message || "An unexpected error occurred during slide editing");

            if (message !== "Client disconnected") {
                const lower = message.toLowerCase();
                const errorType: "image_generation" | "upload" | "database" | "unknown" =
                    lower.includes("image generation") || lower.includes("image edit error")
                        ? "image_generation"
                        : lower.includes("upload")
                            ? "upload"
                            : lower.includes("database") || lower.includes("save slide")
                                ? "database"
                                : "unknown";

                await logSlideEditError({
                    userId: currentUserId,
                    errorMessage: message,
                    errorType,
                    requestParams: requestContext,
                }).catch(() => {});
            }

            if (!sse.isClosed()) {
                sse.sendError({ message, statusCode: 500 });
            }
        }
    } catch (error: any) {
        // Outer catch handles pre-SSE errors (auth/validation/credits — already handled by early returns above)
        console.error("Slide edit pre-SSE error:", error);
        if (!res.headersSent) {
            return res.status(500).json({
                message: String(error?.message || "An unexpected error occurred during slide editing"),
            });
        }
    }
});

export default router;
