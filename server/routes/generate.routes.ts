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
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { checkCredits, deductCredits, recordUsageEvent, getMarkupMultiplier } from "../quota.js";

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

    // Check credits for non-admin/affiliate users
    const creditStatus = !ownApiKey
        ? await checkCredits(user.id, "generate")
        : null;

    if (creditStatus && !creditStatus.allowed) {
        return res.status(402).json({
            error: "insufficient_credits",
            message: "Insufficient credits. Add credits to continue.",
            balance_micros: creditStatus.balance_micros,
            estimated_cost_micros: creditStatus.estimated_cost_micros,
        });
    }

    // Validate request body
    const parseResult = generateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({
            message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ")
        });
    }

    const { reference_text, reference_images, post_mood, copy_text, aspect_ratio, use_logo, logo_position, content_language } = parseResult.data;

    try {
        // Get style catalog
        const styleCatalog = await getStyleCatalogPayload();

        // Create Gemini service
        const gemini = createGeminiService(geminiApiKey);

        // Extract base64 images from reference_images if provided
        const referenceImageBase64 = reference_images?.map(img => img.data);

        // Generate text content
        const textResult = await gemini.generateText({
            brand,
            styleCatalog,
            referenceText: reference_text,
            referenceImages: referenceImageBase64,
            postMood: post_mood,
            copyText: copy_text,
            aspectRatio: aspect_ratio,
            useLogo: use_logo ?? false,
            logoPosition: logo_position,
            contentLanguage: content_language || "en",
        });

        // Generate image
        const imageBuffer = await gemini.generateImage(
            textResult.image_prompt,
            styleCatalog.ai_models?.image_generation
        );

        // Upload image to storage
        const postId = randomUUID();
        const sb = createAdminSupabase();
        const imageUrl = await uploadFile(sb, "user_assets", `${user.id}/${postId}`, imageBuffer, "image/png");

        // Save post to database
        const { data: post, error: insertError } = await supabase
            .from("posts")
            .insert({
                id: postId,
                user_id: user.id,
                image_url: imageUrl,
                caption: textResult.caption,
                ai_prompt_used: textResult.image_prompt,
                status: "completed",
            })
            .select()
            .single();

        if (insertError) {
            console.error("Failed to save post:", insertError);
            return res.status(500).json({ message: "Failed to save generated post" });
        }

        // Deduct credits and record usage for non-admin/affiliate users
        if (!ownApiKey && creditStatus) {
            // Record usage event first
            const usageEvent = await recordUsageEvent(user.id, postId, "generate");

            // Then deduct credits
            const markupMultiplier = await getMarkupMultiplier(user.id);
            await deductCredits(user.id, usageEvent.id, creditStatus.estimated_cost_micros!, markupMultiplier);
        }

        res.json({
            post,
            headline: textResult.headline,
            subtext: textResult.subtext,
        });

    } catch (error) {
        console.error("Generation error:", error);
        const errorMessage = error instanceof Error ? error.message : "Generation failed";
        res.status(500).json({ message: errorMessage });
    }
});

export default router;
