/**
 * Enhance Routes - Single-image product photo enhancement
 * Handles SSE-streamed enhancement via Gemini AI with pre-screen safety gate.
 * Mirrors carousel.routes.ts structure exactly, adapted for enhancement-specific
 * progress events and the simpler single-image result contract (D-04).
 * ENHC-08: No logo overlay, no caption post-processing.
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase.js";
import { enhanceRequestSchema, type EnhanceRequest } from "../../shared/schema.js";
import {
    authenticateUser,
    AuthenticatedRequest,
    getGeminiApiKey,
    usesOwnApiKey,
} from "../middleware/auth.middleware.js";
import {
    enhanceProductPhoto,
    PreScreenRejectedError,
    PreScreenUnavailableError,
    SceneryNotFoundError,
    EnhancementGenerationError,
    EnhancementAbortedError,
    type EnhancementProgressEvent,
} from "../services/enhancement.service.js";
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
    const image = payload.image && typeof payload.image === "object" ? (payload.image as Record<string, unknown>) : {};
    return {
        scenery_id: typeof payload.scenery_id === "string" ? payload.scenery_id : undefined,
        idempotency_key: typeof payload.idempotency_key === "string" ? payload.idempotency_key : undefined,
        image_mime_type: typeof image.mimeType === "string" ? image.mimeType : undefined,
        image_size_bytes: typeof image.data === "string" ? Buffer.byteLength(image.data, "base64") : undefined,
    };
}

const router = Router();

/**
 * POST /api/enhance
 * Enhances a single product photo with a scenery preset via Gemini AI.
 * Pre-SSE gating: auth → profile → key → brand → validate → 5 MB guard → idempotency → credits.
 * SSE pipeline: initSSE → heartbeat → AbortController → enhanceProductPhoto → billing → sendComplete.
 * ENHC-08: No logo overlay, no caption post-processing.
 */
router.post("/api/enhance", async (req: Request, res: Response) => {
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

    // 5. Validate body with enhanceRequestSchema
    const parseResult = enhanceRequestSchema.safeParse(req.body);
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
    const parsed: EnhanceRequest = parseResult.data;
    const sanitizedRequestParams = sanitizeRequestForLogging(req.body);

    // 6. 5 MB guard (D-15): After Zod parse succeeds, BEFORE idempotency check.
    const imageSizeBytes = Buffer.byteLength(parsed.image.data, "base64");
    if (imageSizeBytes > 5 * 1024 * 1024) {
        return res.status(400).json({
            error: "image_too_large",
            message: "Image must be 5 MB or smaller. Please compress or resize before uploading.",
        });
    }

    // 7. Idempotency pre-flight (D-01, D-02 — pessimistic SELECT before service call).
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

    // 8. Credit gate (D-13: enhancement passes undefined for slideCount → 1× single-image cost).
    const creditStatus = !ownApiKey
        ? await checkCredits(user.id, "generate", false, undefined)
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
    sse.sendProgress("auth", "Verified. Starting enhancement...", 2);

    // AbortController + 260s safety timer (D-09). Vercel kills at 280s.
    const controller = new AbortController();
    const safetyTimer = setTimeout(() => {
        controller.abort();
    }, 260_000);

    // Progress mapping (D-05 for enhancement):
    //   pre_screen_start → 5%, pre_screen_passed → 20%
    //   normalize_start → 35%, normalize_complete → 45%
    //   enhance_start → 55%, complete → 95% (billing + sendComplete follow)
    const mapProgress = (event: EnhancementProgressEvent) => {
        if (sse.isClosed()) return;
        switch (event.type) {
            case "pre_screen_start":
                sse.sendProgress("pre_screen", "Checking image suitability...", 5);
                break;
            case "pre_screen_passed":
                sse.sendProgress("pre_screen", "Image approved. Preparing for enhancement...", 20);
                break;
            case "pre_screen_rejected":
                // Service throws PreScreenRejectedError after emitting this event.
                // The catch block handles billing skipping and sendError.
                break;
            case "normalize_start":
                sse.sendProgress("normalize", "Normalizing image...", 35);
                break;
            case "normalize_complete":
                sse.sendProgress("normalize", "Image ready.", 45);
                break;
            case "enhance_start":
                sse.sendProgress("enhance", "Generating enhanced product photo...", 55);
                break;
            case "complete":
                // Service emits this just before returning. Emit a finalizing
                // progress tick; the route sends sendComplete after billing.
                sse.sendProgress("finalizing", "Enhancement complete. Saving...", 95);
                break;
        }
    };

    let result: Awaited<ReturnType<typeof enhanceProductPhoto>> | null = null;
    try {
        result = await enhanceProductPhoto({
            userId: user.id,
            apiKey: geminiApiKey,
            sceneryId: parsed.scenery_id,
            idempotencyKey: parsed.idempotency_key,
            contentLanguage: "en",
            image: parsed.image,
            signal: controller.signal,
            onProgress: mapProgress,
        });
    } catch (err) {
        clearTimeout(safetyTimer);
        if (err instanceof PreScreenRejectedError) {
            // Post-SSE error (pre-screen happens inside the service after SSE opens — D-08).
            // No billing.
            await logGenerationError({
                userId: user.id,
                errorMessage: err.message,
                errorType: "image_generation",
                requestParams: sanitizedRequestParams,
            });
            if (!sse.isClosed()) {
                sse.sendError({
                    message: err.message,
                    error: "pre_screen_rejected",
                    statusCode: 422,
                });
            }
            return;
        } else if (err instanceof PreScreenUnavailableError) {
            await logGenerationError({
                userId: user.id,
                errorMessage: err.message,
                errorType: "image_generation",
                requestParams: sanitizedRequestParams,
            });
            if (!sse.isClosed()) {
                sse.sendError({
                    message: "We couldn't validate the image right now. Please try again in a moment.",
                    error: "pre_screen_unavailable",
                    statusCode: 503,
                });
            }
            return;
        } else if (err instanceof EnhancementAbortedError) {
            await logGenerationError({
                userId: user.id,
                errorMessage: `Enhancement aborted at stage: ${err.stage}`,
                errorType: "image_generation",
                requestParams: sanitizedRequestParams,
            });
            if (!sse.isClosed()) {
                sse.sendError({
                    message: "Enhancement timed out or was interrupted. No credits charged.",
                    error: "enhancement_aborted",
                    statusCode: 504,
                });
            }
            return;
        } else if (err instanceof SceneryNotFoundError) {
            if (!sse.isClosed()) {
                sse.sendError({
                    message: err.message,
                    error: "scenery_not_found",
                    statusCode: 400,
                });
            }
            return;
        } else if (err instanceof EnhancementGenerationError) {
            await logGenerationError({
                userId: user.id,
                errorMessage: err.message,
                errorType: "image_generation",
                requestParams: sanitizedRequestParams,
            });
            if (!sse.isClosed()) {
                sse.sendError({
                    message: "Enhancement generation failed. Please try again.",
                    error: "enhancement_failed",
                    statusCode: 500,
                });
            }
            return;
        } else {
            const message = err instanceof Error ? err.message : "Enhancement failed";
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

    if (!result) {
        if (!sse.isClosed()) {
            sse.sendError({ message: "Enhancement produced no result", statusCode: 500 });
        }
        return;
    }

    // ── Billing (D-13): ONE recordUsageEvent call, ONE deductCredits call.
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

    // Fetch persisted post for the client payload.
    const adminSb2 = createAdminSupabase();
    const { data: finalPost } = await adminSb2
        .from("posts")
        .select("*")
        .eq("id", result.postId)
        .maybeSingle();

    // F4: real caption from generateEnhancementCaption (re-spec'd ENHC-08)
    sse.sendComplete({
        type: "complete",
        post: finalPost,
        image_url: result.imageUrl,
        caption: result.caption,
    });
});

export default router;
