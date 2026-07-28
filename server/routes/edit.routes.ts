/**
 * Edit Routes
 * Handles post editing functionality
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { createServerSupabase, createAdminSupabase } from "../supabase.js";
import {
    editPostRequestSchema,
    type SupportedLanguage,
    type TextBlock,
    type TypographyMeta,
    type GenerationParams,
} from "../../shared/schema.js";
import { checkCredits, deductCredits, recordUsageEvent, canUseQuickRemake, incrementQuickRemakeCount } from "../quota.js";
import { trackMarketingEvent } from "../integrations/marketing.js";
import {
    downloadImageAsBase64,
    formatBrandColors,
} from "../services/prompt-builder.service.js";
import { getActiveImageProvider, type ImageProvider } from "../services/image-provider.js";
import { getOpenAIApiKey } from "../middleware/auth.middleware.js";
import { config } from "../config/index.js";
import { cropToExactAspectRatio } from "../services/image-crop.service.js";
import { resolveTextBlocks, compositeTypography } from "../services/typography-compositor.service.js";
import { DEFAULT_LAYOUT_ARCHETYPE_ID, type LayoutArchetypeId } from "../services/planning-schema.service.js";

// Configurable on long-running hosts; 280s default mirrors the old Vercel kill window.
const GENERATION_SAFETY_TIMEOUT_MS = config.GENERATION_SAFETY_TIMEOUT_MS ?? 280_000;
import { generateVideo } from "../services/video-generation.service.js";
import { uploadFile } from "../storage.js";
import { getSiteOrigin, getRequestIp } from "../services/app-settings.service.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { ensureCaptionQuality } from "../services/caption-quality.service.js";
import { processImageWithThumbnail, formatBytes, applyLogoOverlay } from "../services/image-optimization.service.js";
import { processStorageCleanup } from "../services/storage-cleanup.service.js";
import { initSSE } from "../lib/sse.js";
import { getGeminiApiKey, getOpenRouterApiKey, selectImageApiKey, usesOwnApiKey } from "../middleware/auth.middleware.js";
import { aiRateLimit, DEFAULT_AI_LIMITS } from "../middleware/rate-limit.middleware.js";

const router = Router();

// Rate limiter for /api/edit-post (HARD-01) — 30 req / 5 min, admin-bypass.
const aiPaidLimiter = aiRateLimit(DEFAULT_AI_LIMITS.paid_image_video);

/**
 * Phase 23 (POL-05): LEGACY-ONLY fallback. Posts created before the
 * generation_params migration have no persisted aspect ratio, so their video
 * remakes still recover it by regex from ai_prompt_used. Every post created
 * from Phase 23 onward reads post.generation_params.aspect_ratio instead
 * (see resolveEditAspectRatio, the only caller of this function).
 */
function recoverVideoAspectRatioFromPrompt(prompt: string | null | undefined): "9:16" | "16:9" {
    const match = prompt?.match(/\b(9:16|16:9)\b/);
    return match?.[1] === "16:9" ? "16:9" : "9:16";
}

// ── Phase 23 (TYPO-06/07, POL-05) — edit-target resolution & fast-path helpers ──
// Pure, side-effect-free helpers, exported so scripts/test-edit-base-image-resolution.ts
// can pin the decision matrix with a no-network fixture test.

export interface EditTarget {
    url: string;
    isBaseImage: boolean; // true -> re-composite after edit; false -> LEGACY flattened path
    priorTypographyMeta: TypographyMeta | null;
}

/**
 * Phase 23 (TYPO-07, RESEARCH Pitfall 11). Resolve what the AI actually edits.
 * Preference order: latest version's base image -> post's base image -> LEGACY
 * (base_image_url IS NULL) latest version's flattened image -> post's
 * flattened image. The LEGACY (base_image_url IS NULL) path reproduces this
 * route's pre-Phase-23 behavior exactly: edit the already-composited image,
 * do NOT re-run the compositor (that would draw text a second time over
 * existing, already-burned-in text). 23-CONTEXT.md locks: no backfill
 * migration, no lockout.
 */
export function resolveEditTarget(
    post: { image_url: string | null; base_image_url?: string | null; typography_meta?: TypographyMeta | null },
    latestVersion: { image_url?: string | null; base_image_url?: string | null; typography_meta?: TypographyMeta | null } | undefined,
): EditTarget | null {
    if (latestVersion?.base_image_url) {
        return {
            url: latestVersion.base_image_url,
            isBaseImage: true,
            priorTypographyMeta: latestVersion.typography_meta ?? post.typography_meta ?? null,
        };
    }
    if (post.base_image_url) {
        return {
            url: post.base_image_url,
            isBaseImage: true,
            priorTypographyMeta: post.typography_meta ?? null,
        };
    }
    // LEGACY (base_image_url IS NULL): no base image was ever persisted for
    // this post, so there is nothing to re-composite over. Fall back to the
    // flattened image exactly as this route behaved before Phase 23.
    if (latestVersion?.image_url) {
        return { url: latestVersion.image_url, isBaseImage: false, priorTypographyMeta: null };
    }
    if (post.image_url) {
        return { url: post.image_url, isBaseImage: false, priorTypographyMeta: null };
    }
    return null;
}

/**
 * Phase 23 (POL-05). Effective aspect ratio for this edit, in priority order:
 * the client's explicit edit_context.aspect_ratio (remake pre-fill) -> the
 * post's persisted generation_params.aspect_ratio -> the LEGACY-ONLY
 * ai_prompt_used regex fallback.
 */
export function resolveEditAspectRatio(
    editContextAspectRatio: string | undefined,
    generationParams: GenerationParams | null | undefined,
    aiPromptUsed: string | null | undefined,
): string {
    if (editContextAspectRatio) return editContextAspectRatio;
    if (generationParams?.aspect_ratio) return generationParams.aspect_ratio;
    return recoverVideoAspectRatioFromPrompt(aiPromptUsed);
}

/**
 * Phase 23 (TYPO-07, 23-CONTEXT.md resolved question). Text-only edits become
 * a compositor-only fast path: no AI image call at all, re-render text over
 * the existing base_image_url. Anything that also changes the AI-generated
 * visual concept goes through the full edit -> crop -> compositor pipeline.
 * Requires an explicit client signal (edit_context.text_only) rather than a
 * heuristic on free-text fields, so the decision is deterministic and testable.
 */
export function isTextOnlyEdit(params: {
    textOnlyFlag: boolean | undefined;
    isVideoPost: boolean;
    target: EditTarget | null;
    source: "manual" | "quick_remake";
}): boolean {
    return (
        params.textOnlyFlag === true &&
        params.isVideoPost === false &&
        params.target !== null &&
        params.target.isBaseImage === true &&
        params.source !== "quick_remake"
    );
}

/**
 * Phase 23 (TYPO-07). Map post-edit-dialog's TextEditMode onto the
 * compositor's text_blocks, replacing the AI-image-text-edit era's
 * per-mode prompt-string lookup that used to instruct the image model.
 */
export function resolveEditTextBlocks(
    textMode: "keep" | "improve" | "replace" | "remove" | undefined,
    replacementText: string | undefined,
    priorMeta: TypographyMeta | null,
): TextBlock[] {
    if (textMode === "remove") return [];

    if (textMode === "replace") {
        const lines = (replacementText ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, 3);
        if (lines.length > 0) {
            const roles = ["highlight", "support", "cta"] as const;
            return lines.map((text, i) => ({ role: roles[i], text }));
        }
        // Empty/undefined replacement text: fall through to the prior blocks.
        return priorMeta?.text_blocks ?? [];
    }

    // "keep" / "improve" / undefined: re-typesetting IS the improvement now
    // that the compositor owns hierarchy, spacing, and contrast — there is no
    // new wording to apply, just re-render the prior blocks.
    return priorMeta?.text_blocks ?? [];
}

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
        const { post_id, edit_prompt, content_language, source, edit_context, idempotency_key } =
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

        const isVideoPost = post.content_type === "video";

        const { data: editProfile } = await supabase
            .from("profiles")
            .select("is_admin, is_affiliate, api_key, openai_api_key, image_provider, openrouter_api_key")
            .eq("id", user.id)
            .single();

        // ── Rate limit gate (HARD-01) ──
        // Attach to req so the limiter's keyGenerator/skip can read them.
        (req as any).user = user;
        (req as any).profile = editProfile;
        await new Promise<void>((resolve) => {
            aiPaidLimiter(req as any, res as any, () => {
                resolve();
            });
        });
        if (res.headersSent) {
            return;
        }

        const ownApiKey = usesOwnApiKey(editProfile);

        // ── Phase 21.1 (GATE-06) affiliate-aware GATEWAY key gate ──
        // See generate.routes.ts for the full rationale. Affiliates gate on their
        // own OpenRouter key; the legacy platform Gemini hard gate now runs only
        // for non-affiliates.
        let geminiApiKey = "";
        let openRouterApiKey = "";
        if (ownApiKey) {
            const { key, error } = await getOpenRouterApiKey(editProfile);
            if (error) {
                return res.status(400).json({ message: error });
            }
            openRouterApiKey = key;
        } else {
            const { key, error } = await getGeminiApiKey(editProfile);
            if (error) {
                return res.status(500).json({ message: error });
            }
            geminiApiKey = key;
        }

        // ── Phase 21.1 (GATE-06) — GATE-08 video carve-out ──
        // Video EDITS call generateVideo() → Veo directly, never the OpenRouter
        // gateway, so they need a Gemini key even for affiliates. Resolve it
        // non-fatally, then require it only when this post actually is a video.
        if (ownApiKey) {
            const videoKeyRes = await getGeminiApiKey(editProfile);
            geminiApiKey = videoKeyRes.error ? "" : videoKeyRes.key;
        }
        if (isVideoPost && !geminiApiKey) {
            return res.status(400).json({
                message: "Video generation requires a Gemini API key. Add yours in Settings → Gemini API key (used for video generation only).",
            });
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

        // ── Idempotency pre-flight (POL-06) ──
        // Scoped by (idempotency_key, post_id), NOT (idempotency_key, owner id):
        // post_versions has no owner-id column (ownership is an RLS join to posts).
        // post_id is already ownership-verified above — the earlier post fetch
        // scoped by id and owner and 404'd otherwise.
        const idemSb = createAdminSupabase();
        const { data: existingVersion } = await idemSb
            .from("post_versions")
            .select("*")
            .eq("idempotency_key", idempotency_key)
            .eq("post_id", post_id)
            .maybeSingle();
        if (existingVersion) {
            return res.status(200).json({ idempotent: true, version: existingVersion });
        }

        const creditStatus = !ownApiKey
            ? await checkCredits(user.id, "edit", isVideoPost)
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

        const brand = brandData;
        const styleCatalog = await getStyleCatalogPayload();
        const imageModel =
            styleCatalog.ai_models?.image_generation ||
            "gemini-3.1-flash-image-preview";

        requestContext = {
            ...(requestContext || {}),
            content_type: isVideoPost ? "video" : "image",
        };

        // Get the latest version number (or use base image)
        const { data: versions } = await supabase
            .from("post_versions")
            .select("version_number, image_url, base_image_url, typography_meta")
            .eq("post_id", post_id)
            .order("version_number", { ascending: false })
            .limit(1);

        const latestVersion = versions?.[0];
        const nextVersionNumber = (latestVersion?.version_number || 0) + 1;

        // Phase 23 (TYPO-07): resolve what actually gets edited — the
        // pre-typography base image for new posts, or the LEGACY (base_image_url
        // IS NULL) flattened image for posts created before this migration.
        const editTarget = resolveEditTarget(post, latestVersion);
        if (!editTarget) {
            return res.status(400).json({ message: "No media found to edit" });
        }
        const currentMediaUrl = editTarget.url;

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
        }, GENERATION_SAFETY_TIMEOUT_MS);

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
            // Real gateway cost (GATE-05): only the image branch's provider.edit()
            // reports a gateway cost; video edits stay undefined (off-gateway,
            // flat fallback pricing via recordUsageEvent).
            let editCostUsdMicros: number | undefined;
            // Phase 23 (TYPO-05/07): populated only for base-image posts (new
            // pipeline); stay null for video edits and LEGACY (base_image_url IS
            // NULL) posts, exactly preserving their pre-Phase-23 post_versions shape.
            let newBaseImageUrl: string | null = null;
            let newTypographyMeta: TypographyMeta | null = null;

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
Brand colors: ${formatBrandColors(brand)}. Style: ${brand.mood}.
${editLogoData ? "Include the brand logo as a subtle watermark." : ""}

${videoEditInstructions}

Generate a cinematic, visually compelling video that matches the brand identity.`;

                const videoAspectRatio = (resolveEditAspectRatio(
                    effectiveEditContext?.aspect_ratio,
                    post.generation_params,
                    post.ai_prompt_used,
                ) === "16:9" ? "16:9" : "9:16") as "9:16" | "16:9";

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
                const editAspectRatio = resolveEditAspectRatio(
                    effectiveEditContext?.aspect_ratio,
                    post.generation_params,
                    post.ai_prompt_used,
                );
                const textOnly = isTextOnlyEdit({
                    textOnlyFlag: effectiveEditContext?.text_only,
                    isVideoPost,
                    target: editTarget,
                    source,
                });

                sse.sendProgress(
                    "image_generation",
                    textOnly ? "Recomposing your text..." : "Applying edit instructions...",
                    30,
                );

                const imageResponse = await fetch(currentMediaUrl);
                if (!imageResponse.ok) {
                    throw new Error("Failed to fetch current image");
                }
                const sourceBuffer = Buffer.from(await imageResponse.arrayBuffer());
                const imageMimeType =
                    imageResponse.headers.get("content-type")?.split(";")[0] || "image/png";

                let newBaseBuffer: Buffer;

                if (textOnly) {
                    // ── Phase 23 (TYPO-07): compositor-only fast path ──
                    // Text-only edit on a base-image post: NO AI image call, NO
                    // re-crop (the base image is unchanged and already at the
                    // right ratio).
                    sse.sendProgress("typography", "Recomposing your text...", 45);
                    newBaseBuffer = sourceBuffer;
                } else {
                    // ── Full pipeline: AI edit the resolved target, then re-crop
                    // (base-image posts only) ──
                    // Phase 23 (TYPO-01/07): the image model renders NO text. Text
                    // handling is executed by the server-side compositor, not by the
                    // edit prompt. The image model is only ever told to keep the
                    // frame text-free and to preserve the negative space the
                    // overlay needs.
                    const TEXT_FREE_EDIT_RULE =
                        "CRITICAL: Do NOT render, add, keep, or recreate any text, letters, numbers, or typographic marks in the image. All on-image copy is composited server-side after this edit. Preserve calm, uncluttered negative space where a text overlay can sit.";

                    const structuredEditInstructions = [
                        `Request source: ${promptSourceLabel}.`,
                        `Primary edit goal: ${effectiveGoal}.`,
                        `Focus areas: ${selectedFocusAreas}`,
                        effectiveEditContext?.focus_details
                            ? `Focus details: ${effectiveEditContext.focus_details}`
                            : "",
                        TEXT_FREE_EDIT_RULE,
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

                    const editPrompt = `You are a PROFESSIONAL BRAND DESIGNER editing an existing social media image for "${brand.company_name}".

Brand context:
- Brand name: ${brand.company_name}
- Industry: ${brand.company_type}
- Brand colors: ${formatBrandColors(brand)}
- Style: ${brand.mood}
${editLogoData ? "- The brand's actual logo image is provided as a reference - use it if the edit requires logo changes" : ""}

Structured edit request:
${structuredEditInstructions}

Modify the image according to the request while maintaining the brand's visual identity and colors.${editLogoData ? " If the logo needs to appear or be updated, use the EXACT logo provided." : ""}`;

                    const provider: ImageProvider = await getActiveImageProvider(editProfile);
                    let openaiKeyForImage: string | undefined;
                    if (provider.name === "openai") {
                        const openaiKeyRes = await getOpenAIApiKey(editProfile);
                        if (openaiKeyRes.error) {
                            clearTimeout(safetyTimer);
                            sse.sendError({ message: openaiKeyRes.error, statusCode: 400 });
                            return;
                        }
                        openaiKeyForImage = openaiKeyRes.key;
                    }
                    // Phase 21.1 (GATE-06) — RESEARCH Pitfall 3: geminiApiKey may be ""
                    // for an affiliate, so passing it here would silently re-bill the
                    // platform.
                    const imageApiKey = selectImageApiKey({
                        providerName: provider.name,
                        geminiApiKey,
                        openRouterApiKey,
                        openaiApiKey: openaiKeyForImage,
                    });
                    const result = await provider.edit({
                        prompt: editPrompt,
                        currentImage: { mimeType: imageMimeType, data: sourceBuffer.toString("base64") },
                        apiKey: imageApiKey,
                        logoImageData: editLogoData,
                        model: imageModel,
                    });
                    editCostUsdMicros = result.costUsdMicros;

                    // LEGACY (base_image_url IS NULL): never re-crop a flattened
                    // legacy image — its text is already burned in and the crop
                    // ratio was already applied (or not) at generation time.
                    newBaseBuffer = editTarget.isBaseImage
                        ? await cropToExactAspectRatio(result.buffer, editAspectRatio)
                        : result.buffer;
                }

                let newImageBuffer: Buffer = newBaseBuffer;

                const adminSb = createAdminSupabase();

                if (editTarget.isBaseImage) {
                    // Persist the new pre-typography base image so the NEXT edit
                    // also starts clean.
                    const baseFileName = `${user.id}/base/versions/${versionId}.png`;
                    const { error: baseUploadError } = await adminSb.storage
                        .from("user_assets")
                        .upload(baseFileName, newBaseBuffer, {
                            contentType: "image/png",
                            upsert: false,
                        });
                    if (baseUploadError) {
                        console.error("Base image storage upload error:", baseUploadError);
                        throw new Error(`Upload failed: ${baseUploadError.message}`);
                    }
                    const { data: baseUrlData } = adminSb.storage.from("user_assets").getPublicUrl(baseFileName);
                    newBaseImageUrl = baseUrlData.publicUrl;

                    const blocks = resolveEditTextBlocks(
                        effectiveEditContext?.text_mode,
                        effectiveEditContext?.replacement_text,
                        editTarget.priorTypographyMeta,
                    );
                    if (blocks.length > 0) {
                        sse.sendProgress("typography", "Composing your text...", 68);
                        const composed = await compositeTypography({
                            baseImageBuffer: newBaseBuffer,
                            textBlocks: blocks,
                            layoutArchetypeId:
                                (editTarget.priorTypographyMeta?.layout_archetype_id as LayoutArchetypeId) ||
                                DEFAULT_LAYOUT_ARCHETYPE_ID,
                            aspectRatio: editAspectRatio,
                        });
                        newImageBuffer = composed.buffer;
                        newTypographyMeta = composed.meta;
                    }

                    // Logo overlay (positional only — contrast-aware treatment is
                    // Phase 26). Honour the client's explicit edit_context.use_logo/
                    // logo_position when present, else the post's persisted
                    // generation_params, else skip.
                    const effectiveUseLogo =
                        effectiveEditContext?.use_logo ?? post.generation_params?.use_logo ?? false;
                    if (effectiveUseLogo && editLogoData?.data) {
                        sse.sendProgress("logo_overlay", "Applying logo overlay...", 72);
                        try {
                            const logoBuffer = Buffer.from(editLogoData.data, "base64");
                            const effectiveLogoPosition =
                                effectiveEditContext?.logo_position ??
                                post.generation_params?.logo_position ??
                                "bottom-right";
                            newImageBuffer = await applyLogoOverlay(newImageBuffer, logoBuffer, effectiveLogoPosition);
                        } catch (logoError) {
                            console.warn("Logo overlay failed during edit, continuing without overlay:", logoError);
                        }
                    }
                }
                // LEGACY posts (editTarget.isBaseImage === false) fall through
                // with newImageBuffer === the AI-edited flattened image, exactly
                // as before Phase 23 — no crop, no compositor, no logo re-overlay.

                // ── Phase: Optimization + upload ──
                sse.sendProgress("optimization", "Optimizing image quality...", 75);

                const originalSize = newImageBuffer.length;
                const { image: optimizedImage, thumbnail } = await processImageWithThumbnail(newImageBuffer);

                console.log(`[Image Optimization] Version ${nextVersionNumber}: ${formatBytes(originalSize)} → ${formatBytes(optimizedImage.sizeBytes)} (${Math.round((1 - optimizedImage.sizeBytes / originalSize) * 100)}% reduction)`);

                const fileName = `${user.id}/generated/${versionId}.webp`;

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
                    base_image_url: newBaseImageUrl,
                    typography_meta: newTypographyMeta,
                    idempotency_key,
                })
                .select()
                .single();

            if (versionError) {
                console.error("Version insert error:", versionError);
                throw new Error("Failed to save version");
            }

            const usageEvent = await recordUsageEvent(
                user.id,
                post_id,
                "edit",
                {},
                { image_model: isVideoPost ? "veo-3.1-generate-preview" : imageModel },
                editCostUsdMicros,
                creditStatus?.estimated_cost_micros,
            );

            // ── Phase: Caption quality ──
            sse.sendProgress("caption_quality", "Polishing your caption...", 95);

            const effectiveGoalForCaption = effectiveEditContext?.goal_text || edit_prompt;
            const updatedCaption = await ensureCaptionQuality({
                apiKey: geminiApiKey,
                openRouterApiKey,
                brandName: brand.company_name,
                companyType: brand.company_type,
                contentLanguage: content_language,
                // Phase 23 (TYPO-06/07): renamed from "exact-text-edit" — the text
                // is now composited server-side, not AI-rendered/verified, so the
                // caption scenario reflects a text re-composition, not an
                // AI-rendered-text edit.
                scenarioType:
                    effectiveEditContext?.text_mode === "replace" && effectiveEditContext.replacement_text?.trim()
                        ? "text-recompose-edit"
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

            if (!ownApiKey) {
                await deductCredits(
                    user.id,
                    usageEvent.id,
                    usageEvent.cost_usd_micros,
                    usageEvent.charged_amount_micros
                );
            }

            if (source === "quick_remake" && !ownApiKey) {
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

            sse.sendComplete({
                version_id: newVersion.id,
                version_number: newVersion.version_number,
                image_url: publicUrl,
                thumbnail_url: thumbnailUrl,
                caption: updatedCaption,
            });
        } catch (error: any) {
            console.error("Edit error:", error);

            const message = String(error?.message || "An unexpected error occurred during editing");

            if (message !== "Client disconnected") {
                const lower = message.toLowerCase();
                const errorType: "video_generation" | "image_generation" | "upload" | "database" | "unknown" =
                    lower.includes("video generation error")
                        ? "video_generation"
                        : lower.includes("image generation") || lower.includes("image edit error")
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
        } finally {
            clearTimeout(safetyTimer);
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
