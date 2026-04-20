/**
 * Edit Routes
 * Handles post editing functionality
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { createServerSupabase, createAdminSupabase } from "../supabase.js";
import { editPostRequestSchema, type SupportedLanguage } from "../../shared/schema.js";
import { checkCredits, deductCredits, recordUsageEvent, canUseQuickRemake, incrementQuickRemakeCount } from "../quota.js";
import { trackMarketingEvent } from "../integrations/marketing.js";
import {
    downloadImageAsBase64,
    LANGUAGE_NAMES,
} from "../services/prompt-builder.service.js";
import { editImage } from "../services/image-generation.service.js";
import { generateVideo } from "../services/video-generation.service.js";
import { uploadFile } from "../storage.js";
import { getSiteOrigin, getRequestIp } from "../services/app-settings.service.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { ensureCaptionQuality } from "../services/caption-quality.service.js";
import { enforceExactImageText } from "../services/text-rendering.service.js";
import { processImageWithThumbnail, formatBytes } from "../services/image-optimization.service.js";
import { processStorageCleanup } from "../services/storage-cleanup.service.js";
import { initSSE } from "../lib/sse.js";

const router = Router();

async function logEditError(params: {
    userId: string | null;
    errorMessage: string;
    errorType: "video_generation" | "image_generation" | "upload" | "database" | "unknown";
    requestParams?: Record<string, unknown>;
}): Promise<void> {
    try {
        const sb = createAdminSupabase();
        const { error } = await sb.from("generation_logs").insert({
            user_id: params.userId,
            status: "failed",
            error_message: params.errorMessage || "Edit failed",
            error_type: params.errorType,
            request_params: params.requestParams || null,
        });
        if (error) {
            console.error("Failed to insert edit error log:", error);
        } else {
            console.info("Edit error logged to generation_logs");
        }
    } catch (logError) {
        console.error("Failed to log edit error:", logError);
    }
}

/**
 * POST /api/edit-post - Edit an existing post
 */
router.post("/api/edit-post", async (req, res) => {
    let currentUserId: string | null = null;
    let requestContext: Record<string, unknown> | undefined;
    try {
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

        const parseResult = editPostRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                message:
                    "Invalid request: " +
                    parseResult.error.errors.map((e) => e.message).join(", "),
            });
        }
        const { post_id, edit_prompt, content_language, source, edit_context } =
            parseResult.data;
        const effectiveEditContext = source === "quick_remake"
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
                text_mode: edit_context?.text_mode || "improve",
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
            post_id,
            source,
            content_language,
            has_edit_context: Boolean(effectiveEditContext),
        };

        // Verify post ownership
        const { data: post } = await supabase
            .from("posts")
            .select("*")
            .eq("id", post_id)
            .eq("user_id", user.id)
            .single();

        if (!post) {
            return res.status(404).json({ message: "Post not found or access denied" });
        }

        const { data: editProfile } = await supabase
            .from("profiles")
            .select("is_admin, is_affiliate, api_key")
            .eq("id", user.id)
            .single();

        const usesOwnApiKey =
            editProfile?.is_admin === true || editProfile?.is_affiliate === true;

        if (usesOwnApiKey && !editProfile?.api_key) {
            return res.status(400).json({
                message:
                    "Admin and affiliate accounts must configure their own Gemini API key in Settings before editing.",
            });
        }

        let geminiApiKey: string;
        if (usesOwnApiKey) {
            if (!editProfile?.api_key) {
                return res.status(400).json({
                    message:
                        "Affiliate accounts must configure their Gemini API key in Settings before editing.",
                });
            }
            geminiApiKey = editProfile.api_key;
        } else {
            const serverKey = process.env.GEMINI_API_KEY;
            if (!serverKey) {
                return res
                    .status(500)
                    .json({ message: "Gemini API key not configured on the server." });
            }
            geminiApiKey = serverKey;
        }

        // Get brand
        const { data: brandData } = await supabase
            .from("brands")
            .select("*")
            .eq("user_id", user.id)
            .single();

        if (!brandData) {
            return res.status(400).json({ message: "No brand profile found" });
        }

        const creditStatus = !usesOwnApiKey
            ? await checkCredits(user.id, "edit")
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
                usage_budget_remaining_micros:
                    creditStatus.usage_budget_remaining_micros ?? null,
                additional_usage_this_month_micros:
                    creditStatus.additional_usage_this_month_micros ?? null,
            });
        }

        if (source === "quick_remake" && !usesOwnApiKey) {
            const quickRemakeCheck = await canUseQuickRemake(user.id);
            if (!quickRemakeCheck.allowed) {
                return res.status(402).json({
                    error: "quick_remake_limit_reached",
                    message: "You have reached your quick remake limit. Upgrade to a paid plan for unlimited quick remakes.",
                    quick_remake_remaining: 0,
                });
            }
        }

        const brand = brandData;
        const styleCatalog = await getStyleCatalogPayload();
        const imageModel =
            styleCatalog.ai_models?.image_generation ||
            "gemini-3.1-flash-image-preview";

        const isVideoPost = post.content_type === "video";
        requestContext = {
            ...(requestContext || {}),
            content_type: isVideoPost ? "video" : "image",
        };

        // Get the latest version number (or use base image)
        const { data: versions } = await supabase
            .from("post_versions")
            .select("version_number, image_url")
            .eq("post_id", post_id)
            .order("version_number", { ascending: false })
            .limit(1);

        const latestVersion = versions?.[0];
        const currentMediaUrl = latestVersion?.image_url || post.image_url;
        const nextVersionNumber = (latestVersion?.version_number || 0) + 1;

        if (!currentMediaUrl) {
            return res.status(400).json({ message: "No media found to edit" });
        }

        // ── Initialize SSE stream ──
        const sse = initSSE(res);
        sse.startHeartbeat();
        sse.sendProgress("auth", "Verified. Starting edit...", 10);

        const safetyTimer = setTimeout(async () => {
            await logEditError({
                userId: currentUserId,
                errorMessage: "Edit timed out (exceeded maximum allowed duration)",
                errorType: "unknown",
                requestParams: requestContext,
            });
            sse.sendError({ message: "Edit timed out. Please try again.", statusCode: 504 });
        }, 280_000);

        try {
            // Download brand logo for edit if available
            let editLogoData: { mimeType: string; data: string } | null = null;
            if (brand.logo_url) {
                editLogoData = await downloadImageAsBase64(brand.logo_url);
            }

            const selectedFocusAreas = effectiveEditContext?.focus_areas?.length
                ? effectiveEditContext.focus_areas.join(", ")
                : "No specific focus areas provided.";
            const selectedTextStyleIds = effectiveEditContext?.text_style_ids?.length
                ? effectiveEditContext.text_style_ids
                : effectiveEditContext?.text_style_id
                    ? [effectiveEditContext.text_style_id]
                    : [];
            const selectedTextStyles = styleCatalog.text_styles?.filter(
                (item) => selectedTextStyleIds.includes(item.id)
            ) || [];

            const effectiveGoal = effectiveEditContext?.goal_text || edit_prompt;
            const promptSourceLabel = source === "quick_remake" ? "quick_remake" : "manual";

            let publicUrl: string;
            let thumbnailUrl: string | null = null;
            const versionId = randomUUID();

            if (isVideoPost) {
                // ── Phase: Video generation ──
                sse.sendProgress("video_generation", "Generating new video version...", 30);

                const videoEditInstructions = [
                    `Request source: ${promptSourceLabel}.`,
                    `Primary edit goal: ${effectiveGoal}.`,
                    `Focus areas: ${selectedFocusAreas}`,
                    effectiveEditContext?.focus_details
                        ? `Focus details: ${effectiveEditContext.focus_details}`
                        : "",
                    source === "quick_remake"
                        ? "Create a noticeably fresh variation, but do not change the core subject, brand promise, or main offer."
                        : "",
                    effectiveEditContext?.preserve_layout === true
                        ? "Preserve the overall scene composition and movement."
                        : "",
                    effectiveEditContext?.extra_notes
                        ? `Additional notes: ${effectiveEditContext.extra_notes}`
                        : "",
                    post.ai_prompt_used
                        ? `Original generation intent: ${post.ai_prompt_used}`
                        : "",
                ]
                    .filter(Boolean)
                    .join("\n");

                const videoPrompt = `Create a new variation of a social media video for "${brand.company_name}" (${brand.company_type}).
Brand colors: ${brand.color_1}, ${brand.color_2}, ${brand.color_3}. Style: ${brand.mood}.
${editLogoData ? "Include the brand logo as a subtle watermark." : ""}

${videoEditInstructions}

Generate a cinematic, visually compelling video that matches the brand identity.`;

                const videoAspectRatio = post.aspect_ratio || "9:16";

                const videoResult = await generateVideo({
                    prompt: videoPrompt,
                    aspectRatio: videoAspectRatio,
                    duration: "8",
                    resolution: "720p",
                    apiKey: geminiApiKey,
                });

                sse.sendProgress("optimization", "Uploading video...", 75);

                const adminSb = createAdminSupabase();
                publicUrl = await uploadFile(
                    adminSb,
                    "user_assets",
                    `${user.id}/${versionId}.mp4`,
                    videoResult.buffer,
                    "video/mp4"
                );
            } else {
                // ── Phase: Image edit ──
                sse.sendProgress("image_generation", "Applying edit instructions...", 30);

                const imageResponse = await fetch(currentMediaUrl);
                if (!imageResponse.ok) {
                    throw new Error("Failed to fetch current image");
                }
                const imageBuffer = await imageResponse.arrayBuffer();
                const imageBase64 = Buffer.from(imageBuffer).toString("base64");
                const imageMimeType =
                    imageResponse.headers.get("content-type")?.split(";")[0] || "image/png";

                const languageInstruction =
                    content_language !== "en"
                        ? `\n\nCRITICAL: Any text that appears in the edited image must be in ${LANGUAGE_NAMES[content_language]}.`
                        : "";

                const textEditRules: Record<string, string> = {
                    keep: "Keep existing text exactly as-is.",
                    improve:
                        "Improve text readability and hierarchy while preserving meaning.",
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
                        ? `Text style presets: ${selectedTextStyles.map((style) => `${style.label} (${style.description})`).join(", ")}. Use them as a coordinated typography system for highlight and supporting text.`
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
                    post.ai_prompt_used
                        ? `Original generation intent context: ${post.ai_prompt_used}`
                        : "",
                ]
                    .filter(Boolean)
                    .join("\n");

                const editPrompt = `You are a PROFESSIONAL BRAND DESIGNER editing an existing social media image for "${brand.company_name}".${languageInstruction}

Brand context:
- Brand name: ${brand.company_name}
- Industry: ${brand.company_type}
- Brand colors: ${brand.color_1}, ${brand.color_2}, ${brand.color_3}
- Style: ${brand.mood}
${editLogoData ? "- The brand's actual logo image is provided as a reference - use it if the edit requires logo changes" : ""}

Structured edit request:
${structuredEditInstructions}

Modify the image according to the request while maintaining the brand's visual identity and colors.${editLogoData ? " If the logo needs to appear or be updated, use the EXACT logo provided." : ""}`;

                const result = await editImage({
                    prompt: editPrompt,
                    currentImageBase64: imageBase64,
                    currentImageMimeType: imageMimeType,
                    apiKey: geminiApiKey,
                    logoImageData: editLogoData,
                    model: imageModel,
                });

                let newImageBuffer = result.buffer;

                if (
                    effectiveEditContext?.text_mode === "replace" &&
                    effectiveEditContext.replacement_text?.trim()
                ) {
                    sse.sendProgress("text_verification", "Verifying text accuracy...", 60);
                    try {
                        const repairResult = await enforceExactImageText({
                            apiKey: geminiApiKey,
                            imageBuffer: newImageBuffer,
                            imageMimeType: result.mimeType || "image/png",
                            expectedText: effectiveEditContext.replacement_text,
                            textStyles: selectedTextStyles,
                            brandName: brand.company_name,
                            companyType: brand.company_type,
                            contentLanguage: content_language,
                            subjectDefinition: effectiveGoal,
                            repairContext: structuredEditInstructions,
                            imageModel,
                            verificationModel: styleCatalog.ai_models?.text_generation,
                            logoImageData: editLogoData,
                            maxRepairPasses: 2,
                        });
                        newImageBuffer = repairResult.buffer;
                    } catch (repairError) {
                        console.warn("Exact text repair failed during edit, continuing with initial edited image:", repairError);
                    }
                }

                // ── Phase: Optimization + upload ──
                sse.sendProgress("optimization", "Optimizing image quality...", 75);

                const originalSize = newImageBuffer.length;
                const { image: optimizedImage, thumbnail } = await processImageWithThumbnail(newImageBuffer);

                console.log(`[Image Optimization] Version ${nextVersionNumber}: ${formatBytes(originalSize)} → ${formatBytes(optimizedImage.sizeBytes)} (${Math.round((1 - optimizedImage.sizeBytes / originalSize) * 100)}% reduction)`);

                const fileName = `${user.id}/generated/${versionId}.webp`;

                const adminSb = createAdminSupabase();

                const { error: uploadError } = await adminSb.storage
                    .from("user_assets")
                    .upload(fileName, optimizedImage.buffer, {
                        contentType: "image/webp",
                        upsert: false,
                    });

                if (uploadError) {
                    console.error("Storage upload error:", uploadError);
                    throw new Error(`Upload failed: ${uploadError.message}`);
                }

                const { data: urlData } = adminSb.storage.from("user_assets").getPublicUrl(fileName);
                publicUrl = urlData.publicUrl;

                const thumbnailFileName = `${user.id}/thumbnails/versions/${versionId}.webp`;

                try {
                    await adminSb.storage
                        .from("user_assets")
                        .upload(thumbnailFileName, thumbnail.buffer, {
                            contentType: "image/webp",
                            upsert: false,
                        });

                    const { data: thumbData } = adminSb.storage
                        .from("user_assets")
                        .getPublicUrl(thumbnailFileName);
                    thumbnailUrl = thumbData.publicUrl;
                } catch (thumbError) {
                    console.warn("Thumbnail upload failed (non-critical):", thumbError);
                }
            }

            if (sse.isClosed()) throw new Error("Client disconnected");

            // ── Phase: Save version ──
            sse.sendProgress("saving", "Saving new version...", 90);

            const { data: newVersion, error: versionError } = await supabase
                .from("post_versions")
                .insert({
                    post_id: post_id,
                    version_number: nextVersionNumber,
                    image_url: publicUrl,
                    thumbnail_url: thumbnailUrl,
                    edit_prompt: edit_prompt,
                })
                .select()
                .single();

            if (versionError) {
                console.error("Version insert error:", versionError);
                throw new Error("Failed to save version");
            }

            const usageEvent = await recordUsageEvent(user.id, post_id, "edit", {}, {
                image_model: isVideoPost ? "veo-3.1-generate-preview" : imageModel,
            });

            // ── Phase: Caption quality ──
            sse.sendProgress("caption_quality", "Polishing your caption...", 95);

            const effectiveGoalForCaption = effectiveEditContext?.goal_text || edit_prompt;
            const updatedCaption = await ensureCaptionQuality({
                apiKey: geminiApiKey,
                brandName: brand.company_name,
                companyType: brand.company_type,
                contentLanguage: content_language,
                scenarioType:
                    effectiveEditContext?.text_mode === "replace" && effectiveEditContext.replacement_text?.trim()
                        ? "exact-text-edit"
                        : source === "quick_remake"
                            ? "quick-remake"
                            : "edited-creative",
                subjectDefinition: effectiveGoalForCaption,
                offerText: effectiveEditContext?.replacement_text || undefined,
                promptContext: [
                    `Edit source: ${source === "quick_remake" ? "quick_remake" : "manual"}`,
                    `Edit goal: ${effectiveGoalForCaption}`,
                    `Focus areas: ${effectiveEditContext?.focus_areas?.length ? effectiveEditContext.focus_areas.join(", ") : "No specific focus areas provided."}`,
                    selectedTextStyles.length > 0
                        ? `Text styles: ${selectedTextStyles.map((style) => style.label).join(", ")}`
                        : "Text styles: none",
                    effectiveEditContext?.focus_details ? `Focus details: ${effectiveEditContext.focus_details}` : "",
                    post.ai_prompt_used ? `Original intent: ${post.ai_prompt_used}` : "Original intent: none",
                ].join("\n"),
                model: styleCatalog.ai_models?.text_generation,
                mode: "edit",
            });

            const adminSupabase = createAdminSupabase();
            const { data: updatedPost, error: updateCaptionError } = await adminSupabase
                .from("posts")
                .update({ caption: updatedCaption })
                .eq("id", post_id)
                .eq("user_id", user.id)
                .select("id")
                .single();
            if (updateCaptionError || !updatedPost?.id) {
                throw new Error("Failed to persist updated caption after edit");
            }

            if (!usesOwnApiKey) {
                await deductCredits(
                    user.id,
                    usageEvent.id,
                    usageEvent.cost_usd_micros,
                    usageEvent.charged_amount_micros
                );
            }

            if (source === "quick_remake" && !usesOwnApiKey) {
                await incrementQuickRemakeCount(user.id);
            }

            void trackMarketingEvent({
                event_name: "edit",
                event_key: `edit:${newVersion.id}`,
                event_source: "app",
                user_id: user.id,
                email: user.email || null,
                event_payload: {
                    post_id,
                    version_id: newVersion.id,
                    version_number: newVersion.version_number,
                    content_language,
                    content_type: isVideoPost ? "video" : "image",
                },
                event_source_url: req.get("referer") || getSiteOrigin(req),
                ip_address: getRequestIp(req),
                user_agent: req.get("user-agent") || null,
            }).catch((trackingError) => {
                console.error("Marketing tracking failed (edit):", trackingError);
            });

            void processStorageCleanup(10).catch((cleanupError) => {
                console.warn("Storage cleanup failed (non-critical):", cleanupError);
            });

            clearTimeout(safetyTimer);
            sse.sendComplete({
                version_id: newVersion.id,
                version_number: newVersion.version_number,
                image_url: publicUrl,
                thumbnail_url: thumbnailUrl,
                caption: updatedCaption,
            });
        } catch (error: any) {
            clearTimeout(safetyTimer);
            console.error("Edit error:", error);

            const message = String(error?.message || "An unexpected error occurred during editing");

            if (message !== "Client disconnected") {
                const lower = message.toLowerCase();
                const errorType: "video_generation" | "image_generation" | "upload" | "database" | "unknown" =
                    lower.includes("video generation error")
                        ? "video_generation"
                        : lower.includes("image generation")
                            ? "image_generation"
                            : lower.includes("upload")
                                ? "upload"
                                : lower.includes("database")
                                    ? "database"
                                    : "unknown";

                await logEditError({
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
        // This outer catch handles errors before SSE was initialized (auth, validation, credits)
        // Those are already handled by the early returns above, so this is a safety net
        console.error("Edit pre-SSE error:", error);
        if (!res.headersSent) {
            return res.status(500).json({
                message: String(error?.message || "An unexpected error occurred during editing"),
            });
        }
    }
});

export default router;
