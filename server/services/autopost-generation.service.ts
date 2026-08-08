/**
 * Autopilot generation pipeline — generateAutoPost() mirrors the happy path
 * of POST /api/generate (server/routes/generate.routes.ts) exactly: key gate
 * → credits → text plan → critic re-roll loop → crop/typography/logo/
 * optimize/upload → caption quality → posts insert → usage/deduct. It is
 * NOT a copy-paste of that route — it composes the same building blocks the
 * route uses, without any SSE/HTTP/rate-limit/idempotency-preflight concerns
 * (those are request-layer, and this runs from the cron sweep with no
 * request in scope).
 *
 * The ONE deliberate behavior divergence from the interactive route: there is
 * no local-template text fallback here. generate.routes.ts falls back to
 * buildTextFallback() when the planning call fails so the interactive user
 * still gets *something*; unattended Autopilot posting must never ship
 * generic template filler with nobody reviewing it, so a text-generation
 * failure here THROWS and the item is marked 'failed' by the caller
 * (server/services/autopost.service.ts).
 */

import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "../supabase.js";
import { config } from "../config/index.js";
import { uploadFile } from "../storage.js";
import {
    POST_EXPIRATION_DAYS,
    type AutoPostItem,
    type AutoPostTrack,
    type Brand,
    type Profile,
    type GenerationParams,
    type TypographyMeta,
} from "../../shared/schema.js";
import { DEFAULT_LAYOUT_ARCHETYPE_ID } from "./planning-schema.service.js";
import {
    getGeminiApiKey,
    getOpenAIApiKey,
    getOpenRouterApiKey,
    selectImageApiKey,
    usesOwnApiKey,
} from "../middleware/auth.middleware.js";
import { createGeminiService } from "./gemini.service.js";
import { getStyleCatalogPayload } from "../routes/style-catalog.routes.js";
import { getActiveImageProvider, type ImageProviderResult } from "./image-provider.js";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { cropToExactAspectRatio } from "./image-crop.service.js";
import { resolveTextBlocks, compositeTypography } from "./typography-compositor.service.js";
import { applyLogoOverlay, processImageWithThumbnail } from "./image-optimization.service.js";
import { downloadImageAsBase64 } from "./prompt-builder.service.js";
import { ensureCaptionQuality } from "./caption-quality.service.js";
import { resolveGenerationReferenceImages } from "./style-reference.service.js";
import {
    MAX_REROLL_ATTEMPTS,
    runVisualCritic,
    shouldRerollAfter,
    selectFinalAttempt,
    computeRerollMetadata,
    type CriticAttempt,
} from "./visual-critic.service.js";
import { logVisualCritic } from "./observability.service.js";

/** Safety timeout for the whole generate call chain. Threaded (via AbortController)
 * into the image-generation and visual-critic calls, which are the only legs of
 * this pipeline that accept a signal — mirrors generate.routes.ts's scope exactly
 * (text generation isn't abortable there either). Autopilot has no interactive
 * user waiting on an SSE stream, so this is a generous fixed budget rather than
 * the route's env-tunable + critic-reroll-budget formula. */
const AUTOPOST_GENERATION_TIMEOUT_MS = 6 * 60 * 1000;

function calculatePostExpirationIso(baseDate = new Date()): string {
    const expirationDate = new Date(baseDate);
    expirationDate.setDate(expirationDate.getDate() + POST_EXPIRATION_DAYS);
    return expirationDate.toISOString();
}

export interface GenerateAutoPostParams {
    item: AutoPostItem;
    track: AutoPostTrack;
    brand: Brand;
    profile: Profile;
}

export interface GenerateAutoPostResult {
    postId: string;
}

/**
 * Generates one autopilot post for `item`/`track` and inserts it into
 * `posts` exactly like /api/generate's happy path. Throws on any failure —
 * the caller (autopost.service.ts's generateQueuedItems) marks the item
 * 'failed' and bumps the track's consecutive_failures counter. Never charges
 * credits on a failed run: checkCredits only gates the attempt, and
 * recordUsageEvent/deductCredits run exclusively after the posts insert
 * succeeds, below.
 */
export async function generateAutoPost(params: GenerateAutoPostParams): Promise<GenerateAutoPostResult> {
    const { item, track, brand, profile } = params;
    const sb = createAdminSupabase();

    // ── Key gate — exactly like generate.routes.ts's image branch (autopilot
    // v1 is image-only, so the route's video-only Gemini carve-out doesn't apply). ──
    const ownApiKey = usesOwnApiKey(profile);
    let geminiApiKey = "";
    let openRouterApiKey = "";
    if (ownApiKey) {
        const { key, error } = await getOpenRouterApiKey(profile);
        if (error) throw new Error(error);
        openRouterApiKey = key;
    } else {
        const { key, error } = await getGeminiApiKey(profile);
        if (error) throw new Error(error);
        geminiApiKey = key;
    }

    // ── Credits ──
    const creditStatus = !ownApiKey ? await checkCredits(item.user_id, "generate", false) : null;
    if (creditStatus && !creditStatus.allowed) {
        throw new Error("Insufficient credits — add credits in Billing to resume Autopilot");
    }

    const controller = new AbortController();
    const safetyTimer = setTimeout(() => controller.abort(), AUTOPOST_GENERATION_TIMEOUT_MS);

    try {
        const gp = track.generation_params ?? {};
        const postMood = gp.post_mood ?? "promo";
        const useText = gp.use_text ?? true;
        const aspectRatio = gp.aspect_ratio ?? "1:1";
        const useLogo = gp.use_logo ?? false;
        const contentLanguage = gp.content_language ?? "en";

        const styleCatalog = await getStyleCatalogPayload();
        const gemini = createGeminiService(geminiApiKey, openRouterApiKey);

        // ── Reference images: brand photos + platform style board only — no
        // user uploads exist in the unattended autopilot flow. ──
        const { data: brandPhotoRows } = await sb
            .from("brand_reference_photos")
            .select("photo_url")
            .eq("brand_id", brand.id)
            .order("position", { ascending: true });
        const brandPhotoUrls = (brandPhotoRows ?? []).map((p: { photo_url: string }) => p.photo_url);

        const referenceResolution = await resolveGenerationReferenceImages({
            userImages: [],
            brandPhotoUrls,
            brandStyleId: brand.mood,
            postMoodId: postMood,
            includeBrand: true,
            includeStyleBoard: true,
        });
        const mergedReferenceImages = referenceResolution.images;

        // ── Text generation — NO local-template fallback (see module header). ──
        let textResult;
        try {
            textResult = await gemini.generateText({
                brand,
                styleCatalog,
                referenceText: track.system_prompt,
                referenceImages: mergedReferenceImages,
                postMood,
                useText,
                aspectRatio,
                useLogo,
                contentLanguage,
                contentType: "image",
            });
        } catch (textError) {
            throw textError instanceof Error ? textError : new Error("Text generation failed");
        }

        // ── Image generation + critic re-roll loop — identical constants/helpers
        // to generate.routes.ts's image branch. ──
        const provider = await getActiveImageProvider(profile);
        let openaiKeyForImage: string | undefined;
        if (provider.name === "openai") {
            const openaiKeyRes = await getOpenAIApiKey(profile);
            if (openaiKeyRes.error) throw new Error(openaiKeyRes.error);
            openaiKeyForImage = openaiKeyRes.key;
        }
        const imageApiKey = selectImageApiKey({
            providerName: provider.name,
            geminiApiKey,
            openRouterApiKey,
            openaiApiKey: openaiKeyForImage,
        });

        const criticAttempts: CriticAttempt[] = [];
        const attemptBuffers = new Map<number, ImageProviderResult>();
        const criticLoopStartedAt = Date.now();

        for (let attempt = 1; attempt <= MAX_REROLL_ATTEMPTS + 1; attempt++) {
            let attemptResult: ImageProviderResult;
            try {
                attemptResult = await provider.generate({
                    prompt: textResult.content.image_prompt,
                    aspectRatio,
                    resolution: "1K",
                    model: styleCatalog.ai_models?.image_generation,
                    apiKey: imageApiKey,
                    referenceImages: mergedReferenceImages,
                    signal: controller.signal,
                });
            } catch (imageError) {
                throw imageError instanceof Error ? imageError : new Error("Image generation failed");
            }

            const outcome = await runVisualCritic({
                apiKey: openRouterApiKey || config.OPENROUTER_API_KEY || "",
                model: styleCatalog.ai_models?.critic,
                imageBuffer: attemptResult.buffer,
                imageMimeType: attemptResult.mimeType,
                layoutArchetypeId: textResult.content.layout_archetype_id,
                signal: controller.signal,
            });

            criticAttempts.push({ index: attempt, outcome, imageCostUsdMicros: attemptResult.costUsdMicros ?? 0 });
            attemptBuffers.set(attempt, attemptResult);

            if (!shouldRerollAfter(outcome)) break;
        }

        const criticSelection = selectFinalAttempt(criticAttempts);
        const criticDurationMs = Date.now() - criticLoopStartedAt;

        if (criticSelection.acceptedIndex === null) {
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
            throw new Error(
                "The image generator kept rendering unwanted text into every attempt. Autopilot will retry this slot on the next run.",
            );
        }

        const imageResult = attemptBuffers.get(criticSelection.acceptedIndex)!;

        // ── Crop, base upload, typography, logo overlay, optimize, upload ──
        const postId = randomUUID();
        let finalImageBuffer = imageResult.buffer;

        finalImageBuffer = await cropToExactAspectRatio(finalImageBuffer, aspectRatio);

        const baseImageUrl = await uploadFile(`${item.user_id}/base/${postId}.png`, finalImageBuffer, "image/png");

        let typographyMeta: TypographyMeta | null = null;
        if (useText) {
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
                    aspectRatio,
                });
                finalImageBuffer = composed.buffer;
                typographyMeta = composed.meta;
            }
        }

        if (useLogo && brand.logo_url) {
            try {
                const logoData = await downloadImageAsBase64(brand.logo_url);
                if (logoData?.data) {
                    const logoBuffer = Buffer.from(logoData.data, "base64");
                    finalImageBuffer = await applyLogoOverlay(finalImageBuffer, logoBuffer, undefined);
                }
            } catch (logoError) {
                // Non-fatal — mirrors generate.routes.ts exactly.
                console.warn(`[autopost-generation] Logo overlay failed for item=${item.id}, continuing without overlay:`, logoError);
            }
        }

        const { image: optimizedImage, thumbnail } = await processImageWithThumbnail(finalImageBuffer);

        const imageUrl = await uploadFile(`${item.user_id}/${postId}.webp`, optimizedImage.buffer, "image/webp");
        const thumbnailUrl = await uploadFile(`${item.user_id}/thumbnails/${postId}.webp`, thumbnail.buffer, "image/webp");

        // ── Caption quality ──
        const finalCaption = await ensureCaptionQuality({
            apiKey: geminiApiKey,
            openRouterApiKey,
            brandName: brand.company_name,
            companyType: brand.company_type,
            contentLanguage,
            scenarioType: textResult.content.creative_plan?.scenario_type,
            subjectDefinition: textResult.content.creative_plan?.subject_definition,
            offerText: textResult.content.creative_plan?.exact_text_value || undefined,
            promptContext: [
                `Mood: ${postMood}`,
                `Reference direction: ${track.system_prompt}`,
                `On-image text mode: ${useText ? "guided" : "none"}`,
                `On-image text: composited server-side (${typographyMeta ? typographyMeta.text_blocks.map((b) => b.text).join(" | ") : "none"})`,
                `Image prompt: ${textResult.content.image_prompt}`,
                textResult.content.creative_plan?.subject_definition
                    ? `Subject definition: ${textResult.content.creative_plan.subject_definition}`
                    : "",
            ].join("\n"),
            candidateCaption: textResult.content.caption,
            model: styleCatalog.ai_models?.text_generation,
            mode: "create",
            // m4 — no postId here: mirrors generate.routes.ts exactly. The
            // posts row (and its real id) doesn't exist yet at this point in
            // the pipeline — passing the pre-generated `postId` const would
            // make ensureCaptionQuality's logCaptionQuality call reference a
            // posts.id that isn't in the table yet, so the FK silently drops
            // the log row.
        });

        // ── Save to database — same insert contract as generate.routes.ts ──
        const expiresAt = calculatePostExpirationIso();
        const generationParams: GenerationParams = {
            aspect_ratio: aspectRatio,
            use_text: useText,
            use_logo: useLogo,
            post_mood: postMood,
            content_language: contentLanguage,
            content_type: "image",
        };

        const { data: post, error: insertError } = await sb
            .from("posts")
            .insert({
                id: postId,
                user_id: item.user_id,
                image_url: imageUrl,
                thumbnail_url: thumbnailUrl,
                content_type: "image",
                // Stable per item (not per attempt, per spec): guards against
                // this exact claimed item ever producing two posts. A retry
                // (POST .../items/:id/retry) reuses the same item id, so it is
                // safe UNLESS a prior attempt reached this insert and then threw
                // afterward (recordUsageEvent/deductCredits below) — exactly the
                // same latent gap generate.routes.ts's interactive path has when
                // a client resubmits with a stale idempotency_key; out of scope
                // to redesign here.
                idempotency_key: `autopost:${item.id}`,
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
                    `Autopilot track: ${track.name} (${track.id})`,
                ]
                    .filter(Boolean)
                    .join("\n"),
                base_image_url: baseImageUrl,
                typography_meta: typographyMeta,
                generation_params: generationParams,
                status: "completed",
                expires_at: expiresAt,
            })
            .select()
            .single();

        if (insertError || !post) {
            throw new Error(`Failed to save generated post: ${insertError?.message ?? "unknown error"}`);
        }

        // ── Usage + billing — only after the post row exists ──
        const textUsage = textResult.usage;
        const imageUsage = imageResult.usage;
        const acceptedAttempt = criticAttempts.find((a) => a.index === criticSelection.acceptedIndex);

        const textCostMicros = textResult.costUsdMicros;
        const imageCostMicros = imageResult.costUsdMicros;
        const acceptedCriticCostMicros = acceptedAttempt?.outcome.costUsdMicros;
        const realCostUsdMicros =
            typeof textCostMicros === "number" || typeof imageCostMicros === "number" || typeof acceptedCriticCostMicros === "number"
                ? (textCostMicros ?? 0) + (imageCostMicros ?? 0) + (acceptedCriticCostMicros ?? 0)
                : undefined;

        const rerollMeta = computeRerollMetadata(criticAttempts, criticSelection.acceptedIndex);

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

        const usageEvent = await recordUsageEvent(
            item.user_id,
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
                image_model: imageResult.model,
            },
            realCostUsdMicros,
            creditStatus?.estimated_cost_micros,
            {
                reroll_attempt_count: rerollMeta.reroll_attempt_count,
                reroll_cost_usd_micros: rerollMeta.reroll_cost_usd_micros,
                critic_outcome: criticSelection.outcome,
                critic_cost_usd_micros: acceptedCriticCostMicros ?? null,
                critic_final_scores: acceptedAttempt?.outcome.scores ?? null,
                autopost_track_id: track.id,
                autopost_item_id: item.id,
            },
        );

        if (!ownApiKey && creditStatus) {
            await deductCredits(item.user_id, usageEvent.id, usageEvent.cost_usd_micros, usageEvent.charged_amount_micros);
        }

        return { postId };
    } finally {
        clearTimeout(safetyTimer);
    }
}
