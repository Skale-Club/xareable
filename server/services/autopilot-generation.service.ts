/**
 * Autopilot generation service (Project P002)
 *
 * A focused, server-side generation path for the Content Autopilot. It composes
 * the same building blocks as POST /api/generate (Gemini text → image provider →
 * optimize → upload → posts row → credit accounting) but WITHOUT the HTTP/SSE
 * layer, for the simple autopilot case: a branded image + caption from the
 * plan's brief + the current rotating theme. Image-only in v1.
 *
 * It deliberately does NOT refactor the large /api/generate handler (that stays
 * the source of truth for the interactive flow); it reuses the shared services.
 */

import { randomUUID } from "crypto";
import { createAdminSupabase } from "../supabase.js";
import { uploadFile } from "../storage.js";
import { POST_EXPIRATION_DAYS } from "../../shared/schema.js";
import {
    getGeminiApiKey,
    getOpenAIApiKey,
    usesOwnApiKey,
} from "../middleware/auth.middleware.js";
import { createGeminiService } from "./gemini.service.js";
import { getActiveImageProvider, type ImageProvider } from "./image-provider.js";
import { processImageWithThumbnail } from "./image-optimization.service.js";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { getStyleCatalogPayload } from "../routes/style-catalog.routes.js";

export type AutopilotGenerationResult =
    | {
        ok: true;
        postId: string;
        imageUrl: string;
        thumbnailUrl: string | null;
        caption: string;
        chargedMicros: number;
    }
    | { ok: false; reason: "no_brand" | "config" | "insufficient_credits" | "error"; message: string };

interface GeneratePlanPostInput {
    userId: string;
    /** Direction: the plan's free-text brief. */
    brief?: string | null;
    /** The single theme selected for this run (from the rotating list). */
    theme?: string | null;
    contentLanguage?: string;
}

/**
 * Generate one branded image + caption for a content plan and persist it as a
 * `posts` row (so it shows up in the user's library). Charges credits exactly
 * like the interactive flow. Returns the created post + the amount charged.
 */
export async function generatePlanPost(input: GeneratePlanPostInput): Promise<AutopilotGenerationResult> {
    const sb = createAdminSupabase();

    const { data: profile } = await sb
        .from("profiles")
        .select("is_admin, is_affiliate, api_key, openai_api_key, image_provider")
        .eq("id", input.userId)
        .single();

    const ownApiKey = usesOwnApiKey(profile);
    const { key: geminiApiKey, error: keyError } = await getGeminiApiKey(profile);
    if (keyError) return { ok: false, reason: "config", message: keyError };

    const { data: brand } = await sb
        .from("brands")
        .select("*")
        .eq("user_id", input.userId)
        .single();
    if (!brand) return { ok: false, reason: "no_brand", message: "No brand profile found" };

    // Global credit gate (per-plan budget is enforced by the caller/cron).
    const creditStatus = !ownApiKey ? await checkCredits(input.userId, "generate", false) : null;
    if (creditStatus && !creditStatus.allowed) {
        return { ok: false, reason: "insufficient_credits", message: creditStatus.denial_reason || "insufficient_credits" };
    }

    try {
        const styleCatalog = await getStyleCatalogPayload();
        const gemini = createGeminiService(geminiApiKey);

        const referenceText = [input.brief?.trim(), input.theme?.trim() ? `Theme: ${input.theme.trim()}` : ""]
            .filter(Boolean)
            .join("\n\n") || `On-brand social post for ${brand.company_name}`;

        const textResult = await gemini.generateText({
            brand,
            styleCatalog,
            referenceText,
            referenceImages: [],
            postMood: "promo",
            useText: false,
            aspectRatio: "1:1",
            useLogo: false,
            contentLanguage: input.contentLanguage || "en",
            contentType: "image",
        } as any);

        // Image generation (respects the user's provider preference).
        const provider: ImageProvider = await getActiveImageProvider(profile);
        let imageApiKey = geminiApiKey;
        if (provider.name === "openai") {
            const openaiKeyRes = await getOpenAIApiKey(profile);
            if (openaiKeyRes.error) return { ok: false, reason: "config", message: openaiKeyRes.error };
            imageApiKey = openaiKeyRes.key;
        }
        const imageResult = await provider.generate({
            prompt: textResult.content.image_prompt,
            aspectRatio: "1:1",
            resolution: "1K",
            model: styleCatalog.ai_models?.image_generation,
            apiKey: imageApiKey,
            referenceImages: [],
        } as any);

        const postId = randomUUID();
        const { image: optimizedImage, thumbnail } = await processImageWithThumbnail(imageResult.buffer);

        const imageUrl = await uploadFile(sb, "user_assets", `${input.userId}`, optimizedImage.buffer, "image/webp");
        const thumbnailUrl = await uploadFile(sb, "user_assets", `${input.userId}/thumbnails`, thumbnail.buffer, "image/webp");

        const expiresAt = new Date(Date.now() + POST_EXPIRATION_DAYS * 86_400_000).toISOString();
        const caption = textResult.content.caption;

        const { error: insertError } = await sb.from("posts").insert({
            id: postId,
            user_id: input.userId,
            image_url: imageUrl,
            thumbnail_url: thumbnailUrl,
            content_type: "image",
            caption,
            ai_prompt_used: `[autopilot] ${textResult.content.image_prompt}`,
            status: "completed",
            expires_at: expiresAt,
        });
        if (insertError) return { ok: false, reason: "error", message: insertError.message };

        // Usage + credit accounting (mirrors the interactive flow).
        const usageEvent = await recordUsageEvent(
            input.userId,
            postId,
            "generate",
            {
                text_input_tokens: textResult.usage?.promptTokenCount,
                text_output_tokens: textResult.usage?.candidatesTokenCount,
                image_input_tokens: imageResult.usage?.promptTokenCount,
                image_output_tokens: imageResult.usage?.candidatesTokenCount,
            },
            { text_model: textResult.model, image_model: imageResult.model },
        );

        let chargedMicros = 0;
        if (!ownApiKey && creditStatus) {
            await deductCredits(input.userId, usageEvent.id, usageEvent.cost_usd_micros, usageEvent.charged_amount_micros);
            chargedMicros = usageEvent.charged_amount_micros;
        }

        return { ok: true, postId, imageUrl, thumbnailUrl, caption, chargedMicros };
    } catch (err) {
        return { ok: false, reason: "error", message: err instanceof Error ? err.message : "generation failed" };
    }
}
