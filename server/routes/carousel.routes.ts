/**
 * Carousel Routes - Multi-slide carousel generation
 * Handles SSE-streamed carousel generation via Gemini AI with per-slide progress events.
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase.js";
import { carouselRequestSchema, type CarouselRequest } from "../../shared/schema.js";
import {
    authenticateUser,
    AuthenticatedRequest,
    getGeminiApiKey,
    usesOwnApiKey,
} from "../middleware/auth.middleware.js";
import {
    generateCarousel,
    CarouselFullFailureError,
    CarouselAbortedError,
    CarouselTextPlanError,
    CarouselInvalidAspectError,
    type CarouselProgressEvent,
} from "../services/carousel-generation.service.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { initSSE } from "../lib/sse.js";

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
        .select("is_admin, is_affiliate, is_business, api_key")
        .eq("id", user.id)
        .single();

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
        result = await generateCarousel({
            userId: user.id,
            apiKey: geminiApiKey,
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
        clearTimeout(safetyTimer);
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

    clearTimeout(safetyTimer);

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
});

export default router;
