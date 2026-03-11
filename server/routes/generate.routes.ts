/**
 * Generate Routes - AI post generation
 * Handles text and image generation using Gemini AI
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { createAdminSupabase } from "../supabase.js";
import { uploadFile } from "../storage.js";
import { generateRequestSchema } from "../../shared/schema.js";
import {
    authenticateUser,
    AuthenticatedRequest,
    getGeminiApiKey,
    usesOwnApiKey,
} from "../middleware/auth.middleware.js";
import { createGeminiService } from "../services/gemini.service.js";
import { generateVideo } from "../services/video-generation.service.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { processImageWithThumbnail, formatBytes, applyLogoOverlay } from "../services/image-optimization.service.js";
import { downloadImageAsBase64 } from "../services/prompt-builder.service.js";

/**
 * Log a generation error to the database
 */
async function logGenerationError(params: {
    userId: string | null;
    errorMessage: string;
    errorType: "text_generation" | "image_generation" | "video_generation" | "upload" | "database" | "unknown";
    requestParams?: Record<string, unknown>;
}): Promise<void> {
    try {
        const supabase = createAdminSupabase();
        await supabase.from("generation_logs").insert({
            user_id: params.userId,
            status: "failed",
            error_message: params.errorMessage,
            error_type: params.errorType,
            request_params: params.requestParams || null,
        });
    } catch (logError) {
        // Don't let logging errors crash the app
        console.error("Failed to log generation error:", logError);
    }
}

function buildTextFallback(params: {
    brand: any;
    referenceText?: string;
    copyText?: string;
    postMood?: string;
    aspectRatio?: string;
    contentLanguage?: string;
    contentType?: "image" | "video";
}) {
    const isVideo = params.contentType === "video";
    const mood = String(params.postMood || "promo");
    const text = String(params.copyText || "").trim();
    const headline = (text || `${params.brand.company_name} ${mood}`)
        .split(/\s+/)
        .slice(0, 6)
        .join(" ");
    const subtext = isVideo
        ? `Cinematic ${mood} video for ${params.brand.company_name}.`
        : `Professional ${mood} visual for ${params.brand.company_name}.`;
    const image_prompt = isVideo
        ? `Create a ${params.aspectRatio || "9:16"} cinematic video for ${params.brand.company_name} (${params.brand.company_type}). Mood: ${mood}. Use brand colors ${params.brand.color_1}, ${params.brand.color_2}, ${params.brand.color_3}.`
        : `Create a ${params.aspectRatio || "1:1"} social media image for ${params.brand.company_name} (${params.brand.company_type}) in ${mood} style. ${text ? `Include text: ${text}.` : "Generate suitable on-image text."} Use brand colors ${params.brand.color_1}, ${params.brand.color_2}, ${params.brand.color_3}.`;
    const captionLanguageHint = params.contentLanguage && params.contentLanguage !== "en" ? ` (${params.contentLanguage})` : "";
    const caption = `${params.brand.company_name}${captionLanguageHint}\n\nProfessional results, clear value, and a stronger brand presence for your audience.\n\n#${String(params.brand.company_name || "").replace(/\s+/g, "")} #${mood} #marketing`;

    return {
        content: {
            headline,
            subtext,
            image_prompt,
            caption,
        },
        usage: undefined,
        model: "local-fallback",
    };
}

const router = Router();

/**
 * POST /api/generate
 * Generates a new social media post with AI
 */
router.post("/api/generate", async (req: Request, res: Response) => {
    // Authenticate user
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;

    // Get user profile
    const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin, is_affiliate, api_key")
        .eq("id", user.id)
        .single();

    // Check if user uses their own API key
    const ownApiKey = usesOwnApiKey(profile);

    // Get appropriate Gemini API key
    const { key: geminiApiKey, error: keyError } = await getGeminiApiKey(profile);
    if (keyError) {
        return res.status(400).json({ message: keyError });
    }

    // Get user's brand
    const { data: brand, error: brandError } = await supabase
        .from("brands")
        .select("*")
        .eq("user_id", user.id)
        .single();

    if (brandError || !brand) {
        return res.status(400).json({ message: "No brand profile found. Please complete onboarding." });
    }

    // Validate request body first to know the content_type
    const parseResult = generateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({
            message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ")
        });
    }

    const { reference_text, reference_images, post_mood, copy_text, aspect_ratio, use_logo, logo_position, content_language, content_type, video_resolution, video_duration } = parseResult.data;
    const isVideo = content_type === "video";

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

    // Prepare sanitized request params for error logging (exclude base64 image data)
    const sanitizedRequestParams = {
        reference_text,
        post_mood,
        copy_text,
        aspect_ratio,
        use_logo,
        logo_position,
        content_language,
        content_type,
        has_reference_images: reference_images?.length || 0,
    };

    let errorAlreadyLogged = false;

    try {
        // Get style catalog
        const styleCatalog = await getStyleCatalogPayload();

        // Create Gemini service
        const gemini = createGeminiService(geminiApiKey);

        // Extract base64 images from reference_images if provided
        const referenceImageBase64 = reference_images?.map(img => img.data);

        // Generate text content
        let textResult;
        try {
            textResult = await gemini.generateText({
                brand,
                styleCatalog,
                referenceText: reference_text,
                referenceImages: referenceImageBase64,
                postMood: post_mood,
                copyText: content_type === "video" ? undefined : copy_text,
                aspectRatio: aspect_ratio,
                useLogo: use_logo ?? false,
                logoPosition: logo_position,
                contentLanguage: content_language || "en",
                contentType: content_type || "image",
            });
        } catch (textError) {
            await logGenerationError({
                userId: user.id,
                errorMessage: textError instanceof Error ? textError.message : "Text generation failed",
                errorType: "text_generation",
                requestParams: sanitizedRequestParams,
            });
            textResult = buildTextFallback({
                brand,
                referenceText: reference_text,
                copyText: content_type === "video" ? undefined : copy_text,
                postMood: post_mood,
                aspectRatio: aspect_ratio,
                contentLanguage: content_language || "en",
                contentType: content_type || "image",
            });
        }

        // Generate image or video
        let imageResult;
        let videoResult;
        
        if (content_type === "video") {
            try {
                videoResult = await generateVideo({
                    prompt: textResult.content.image_prompt,
                    aspectRatio: aspect_ratio,
                    duration: video_duration || "8",
                    resolution: video_resolution || "720p",
                    apiKey: geminiApiKey,
                    referenceImages: reference_images,
                });
            } catch (videoError) {
                await logGenerationError({
                    userId: user.id,
                    errorMessage: videoError instanceof Error ? videoError.message : "Video generation failed",
                    errorType: "video_generation",
                    requestParams: sanitizedRequestParams,
                });
                errorAlreadyLogged = true;
                throw videoError;
            }
        } else {
            try {
                imageResult = await gemini.generateImage(
                    textResult.content.image_prompt,
                    styleCatalog.ai_models?.image_generation,
                    reference_images || []
                );
            } catch (imageError) {
                await logGenerationError({
                    userId: user.id,
                    errorMessage: imageError instanceof Error ? imageError.message : "Image generation failed",
                    errorType: "image_generation",
                    requestParams: sanitizedRequestParams,
                });
                errorAlreadyLogged = true;
                throw imageError;
            }
        }

        // Optimize image and generate thumbnail (or just upload video)
        const postId = randomUUID();
        let imageUrl: string;
        let thumbnailUrl: string | null = null;
        let finalContentType = content_type || "image";

        try {
            const sb = createAdminSupabase();
            
            if (content_type === "video" && videoResult) {
                // Upload video directly
                imageUrl = await uploadFile(
                    sb,
                    "user_assets",
                    `${user.id}/${postId}.mp4`,
                    videoResult.buffer,
                    "video/mp4"
                );
                
                // For videos, we might want a thumbnail from the first reference image, or just leave it null
                if (reference_images?.[0]) {
                    const firstRefBuffer = Buffer.from(reference_images[0].data, 'base64');
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

                // Deterministic logo placement: overlay the real brand logo file after generation.
                if ((use_logo ?? false) && brand.logo_url) {
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

                const originalSize = finalImageBuffer.length;
                const { image: optimizedImage, thumbnail } = await processImageWithThumbnail(finalImageBuffer);

                console.log(`[Image Optimization] Post ${postId}: ${formatBytes(originalSize)} → ${formatBytes(optimizedImage.sizeBytes)} (${Math.round((1 - optimizedImage.sizeBytes / originalSize) * 100)}% reduction)`);

                // Upload optimized image as WebP
                imageUrl = await uploadFile(
                    sb,
                    "user_assets",
                    `${user.id}/${postId}.webp`,
                    optimizedImage.buffer,
                    "image/webp"
                );

                // Upload thumbnail
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
            errorAlreadyLogged = true;
            throw uploadError;
        }

        // Save post to database
        const { data: post, error: insertError } = await supabase
            .from("posts")
            .insert({
                id: postId,
                user_id: user.id,
                image_url: imageUrl,
                thumbnail_url: thumbnailUrl,
                content_type: finalContentType,
                caption: textResult.content.caption,
                ai_prompt_used: textResult.content.image_prompt,
                status: "completed",
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
            errorAlreadyLogged = true;
            console.error("Failed to save post:", insertError);
            return res.status(500).json({ message: "Failed to save generated post" });
        }

        // Record usage for analytics/tokens (for all users), but deduct credits only
        // for users billed by the platform.
        const textUsage = textResult.usage;
        const imageUsage = imageResult?.usage; // Could be undefined for video
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
            }
        );

        if (!ownApiKey && creditStatus) {
            await deductCredits(
                user.id,
                usageEvent.id,
                usageEvent.cost_usd_micros,
                usageEvent.charged_amount_micros,
            );
        }

        res.json({
            post,
            image_url: imageUrl,
            thumbnail_url: post?.thumbnail_url || null,
            content_type: finalContentType,
            caption: textResult.content.caption,
            headline: textResult.content.headline,
            subtext: textResult.content.subtext,
            post_id: postId,
        });

    } catch (error) {
        console.error("Generation error:", error);
        const errorMessage = error instanceof Error ? error.message : "Generation failed";

        // Log unknown errors (errors not caught by specific handlers above)
        // Note: Specific errors are already logged in their respective catch blocks
        if (!errorAlreadyLogged && error instanceof Error) {
            // This is a fallback for any unexpected errors
            await logGenerationError({
                userId: user.id,
                errorMessage: error.message,
                errorType: "unknown",
                requestParams: sanitizedRequestParams,
            });
        }

        res.status(500).json({ message: errorMessage });
    }
});

export default router;
