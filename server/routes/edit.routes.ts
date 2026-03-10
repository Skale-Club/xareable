/**
 * Edit Routes
 * Handles post editing functionality
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { createServerSupabase, createAdminSupabase } from "../supabase.js";
import { editPostRequestSchema, type SupportedLanguage } from "../../shared/schema.js";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { trackMarketingEvent } from "../integrations/marketing.js";
import {
    downloadImageAsBase64,
    LANGUAGE_NAMES,
} from "../services/prompt-builder.service.js";
import { editImage } from "../services/image-generation.service.js";
import { getSiteOrigin, getRequestIp } from "../services/app-settings.service.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";

const router = Router();

/**
 * POST /api/edit-post - Edit an existing post
 */
router.post("/api/edit-post", async (req, res) => {
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
                        "Como afiliado, configure sua Gemini API Key nas configurações antes de editar.",
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
            const isSubscriptionMissing = denialReason === "inactive_subscription";
            return res.status(402).json({
                error: isBudgetReached
                    ? "usage_budget_reached"
                    : isSubscriptionMissing
                        ? "subscription_required"
                        : "insufficient_credits",
                message: isBudgetReached
                    ? "Additional usage budget reached. Increase your budget in Billing to continue."
                    : isSubscriptionMissing
                        ? "An active subscription is required to continue."
                        : "Insufficient credits. Add credits to continue.",
                balance_micros: creditStatus.balance_micros,
                estimated_cost_micros: creditStatus.estimated_cost_micros,
                usage_budget_micros: creditStatus.usage_budget_micros ?? null,
                usage_budget_remaining_micros:
                    creditStatus.usage_budget_remaining_micros ?? null,
                additional_usage_this_month_micros:
                    creditStatus.additional_usage_this_month_micros ?? null,
            });
        }

        const brand = brandData;

        // Get the latest version number (or use base image)
        const { data: versions } = await supabase
            .from("post_versions")
            .select("version_number, image_url")
            .eq("post_id", post_id)
            .order("version_number", { ascending: false })
            .limit(1);

        const latestVersion = versions?.[0];
        const currentImageUrl = latestVersion?.image_url || post.image_url;
        const nextVersionNumber = (latestVersion?.version_number || 0) + 1;

        if (!currentImageUrl) {
            return res.status(400).json({ message: "No image found to edit" });
        }

        // Fetch the current image and detect its content type
        const imageResponse = await fetch(currentImageUrl);
        if (!imageResponse.ok) {
            return res.status(500).json({ message: "Failed to fetch current image" });
        }
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString("base64");
        const imageMimeType =
            imageResponse.headers.get("content-type")?.split(";")[0] || "image/png";

        // Build edit prompt
        const languageInstruction =
            content_language !== "en"
                ? `\n\nCRITICAL: Any text that appears in the edited image must be in ${LANGUAGE_NAMES[content_language]}.`
                : "";

        // Download brand logo for edit if available
        let editLogoData: { mimeType: string; data: string } | null = null;
        if (brand.logo_url) {
            editLogoData = await downloadImageAsBase64(brand.logo_url);
        }

        const textEditRules: Record<string, string> = {
            keep: "Keep existing text exactly as-is.",
            improve:
                "Improve text readability and hierarchy while preserving meaning.",
            replace: edit_context?.replacement_text
                ? `Replace existing text with: "${edit_context.replacement_text}".`
                : "Replace existing text with stronger, on-brand copy.",
            remove: "Remove all text from the image.",
        };

        const selectedFocusAreas = edit_context?.focus_areas?.length
            ? edit_context.focus_areas.join(", ")
            : "No specific focus areas provided.";

        const effectiveGoal = edit_context?.goal_text || edit_prompt;
        const promptSourceLabel = source === "quick_remake" ? "quick_remake" : "manual";

        const structuredEditInstructions = [
            `Request source: ${promptSourceLabel}.`,
            `Primary edit goal: ${effectiveGoal}.`,
            `Focus areas: ${selectedFocusAreas}`,
            edit_context?.focus_details
                ? `Focus details: ${edit_context.focus_details}`
                : "",
            edit_context?.text_mode
                ? `Text handling: ${textEditRules[edit_context.text_mode] || textEditRules.keep}`
                : "",
            edit_context?.preserve_brand_colors === true
                ? "Preserve brand colors."
                : "",
            edit_context?.preserve_brand_colors === false
                ? "Color updates allowed, but stay on-brand."
                : "",
            edit_context?.preserve_layout === true
                ? "Preserve layout and element placement as much as possible."
                : "",
            edit_context?.preserve_layout === false
                ? "Layout can be improved if it benefits the result."
                : "",
            edit_context?.extra_notes
                ? `Additional notes: ${edit_context.extra_notes}`
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

        // Edit the image using the service
        const result = await editImage({
            prompt: editPrompt,
            currentImageBase64: imageBase64,
            currentImageMimeType: imageMimeType,
            apiKey: geminiApiKey,
            logoImageData: editLogoData,
        });

        const newImageBuffer = result.buffer;
        const fileName = `${user.id}/generated/${randomUUID()}.png`;

        const { error: uploadError } = await supabase.storage
            .from("user_assets")
            .upload(fileName, newImageBuffer, {
                contentType: "image/png",
                upsert: false,
            });

        if (uploadError) {
            console.error("Storage upload error:", uploadError);
            return res
                .status(500)
                .json({ message: `Upload failed: ${uploadError.message}` });
        }

        const {
            data: { publicUrl },
        } = supabase.storage.from("user_assets").getPublicUrl(fileName);

        // Insert new version
        const { data: newVersion, error: versionError } = await supabase
            .from("post_versions")
            .insert({
                post_id: post_id,
                version_number: nextVersionNumber,
                image_url: publicUrl,
                edit_prompt: edit_prompt,
            })
            .select()
            .single();

        if (versionError) {
            console.error("Version insert error:", versionError);
            return res.status(500).json({ message: "Failed to save version" });
        }

        const usageEvent = await recordUsageEvent(user.id, post_id, "edit", {
            image_input_tokens: result.usage?.promptTokenCount,
            image_output_tokens: result.usage?.candidatesTokenCount,
        });

        if (!usesOwnApiKey) {
            await deductCredits(
                user.id,
                usageEvent.id,
                usageEvent.cost_usd_micros,
                usageEvent.charged_amount_micros
            );
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
            },
            event_source_url: req.get("referer") || getSiteOrigin(req),
            ip_address: getRequestIp(req),
            user_agent: req.get("user-agent") || null,
        }).catch((trackingError) => {
            console.error("Marketing tracking failed (edit):", trackingError);
        });

        return res.json({
            version_id: newVersion.id,
            version_number: newVersion.version_number,
            image_url: publicUrl,
        });
    } catch (error: any) {
        console.error("Edit error:", error);
        return res.status(500).json({
            message: error.message || "An unexpected error occurred during editing",
        });
    }
});

export default router;
