import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { POST_EXPIRATION_DAYS, restorePhotoRequestSchema } from "../../shared/schema.js";
import { authenticateUser, AuthenticatedRequest, getGeminiApiKey, usesOwnApiKey } from "../middleware/auth.middleware.js";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { initSSE } from "../lib/sse.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { editImage } from "../services/image-generation.service.js";
import { applyLogoOverlay, formatBytes, processImageWithThumbnail } from "../services/image-optimization.service.js";
import { downloadImageAsBase64 } from "../services/prompt-builder.service.js";
import { uploadFile } from "../storage.js";
import { ensureCaptionQuality, normalizeContentLanguage } from "../services/caption-quality.service.js";
import { createAdminSupabase } from "../supabase.js";

const router = Router();

async function logRestoreError(params: {
  userId: string | null;
  errorMessage: string;
  requestParams?: Record<string, unknown>;
}) {
  try {
    const sb = createAdminSupabase();
    await sb.from("generation_logs").insert({
      user_id: params.userId,
      status: "failed",
      error_message: params.errorMessage,
      error_type: "image_generation",
      request_params: params.requestParams || null,
    });
  } catch (err) {
    console.error("Failed to log restore-photo error:", err);
  }
}

function calculatePostExpirationIso(baseDate = new Date()): string {
  const expirationDate = new Date(baseDate);
  expirationDate.setDate(expirationDate.getDate() + POST_EXPIRATION_DAYS);
  return expirationDate.toISOString();
}

const GOAL_INSTRUCTIONS: Record<string, string> = {
  appetizing: "Make the food look fresher, tastier, and more appetizing without looking fake.",
  quality: "Improve overall photo quality and perceived professionalism.",
  lighting: "Fix uneven lighting and make highlights/shadows balanced and natural.",
  colors: "Improve color fidelity and vibrancy while keeping ingredients realistic.",
  sharpness: "Increase clarity, texture definition, and edge sharpness without overprocessing.",
  "social-ready": "Prepare the image for social media performance and first-glance impact.",
};

const INTENSITY_INSTRUCTIONS: Record<string, string> = {
  subtle: "Apply subtle and conservative enhancements.",
  balanced: "Apply balanced improvements for visible but natural results.",
  strong: "Apply bold enhancements while preserving realism.",
};

router.post("/api/restore-photo", async (req: Request, res: Response) => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }

  const { user, supabase } = authResult;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_affiliate, api_key")
    .eq("id", user.id)
    .single();

  const ownApiKey = usesOwnApiKey(profile);
  const { key: geminiApiKey, error: keyError } = await getGeminiApiKey(profile);
  if (keyError) {
    await logRestoreError({ userId: user.id, errorMessage: keyError });
    return res.status(400).json({ message: keyError });
  }

  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("*")
    .eq("user_id", user.id)
    .single();
  if (brandError || !brand) {
    await logRestoreError({ userId: user.id, errorMessage: "No brand profile found. Please complete onboarding." });
    return res.status(400).json({ message: "No brand profile found. Please complete onboarding." });
  }

  const parseResult = restorePhotoRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const validationMessage = "Invalid request: " + parseResult.error.errors.map((e) => e.message).join(", ");
    await logRestoreError({ userId: user.id, errorMessage: validationMessage });
    return res.status(400).json({ message: validationMessage });
  }

  const {
    source_image,
    restore_goal,
    restore_intensity,
    keep_composition,
    remove_distractions,
    reference_text,
    aspect_ratio,
    use_logo,
    logo_position,
    content_language,
  } = parseResult.data;
  const normalizedLanguage = normalizeContentLanguage(content_language);
  const sanitizedRequestParams = {
    restore_goal,
    restore_intensity,
    keep_composition,
    remove_distractions,
    aspect_ratio,
    use_logo: Boolean(use_logo),
    logo_position: use_logo ? logo_position : null,
    reference_text: reference_text?.trim() || null,
    content_language: normalizedLanguage,
    source_image_mime: source_image?.mimeType,
  };

  const creditStatus = !ownApiKey ? await checkCredits(user.id, "generate") : null;
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
    await logRestoreError({
      userId: user.id,
      errorMessage: message,
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

  const sse = initSSE(res);
  sse.startHeartbeat();
  sse.sendProgress("auth", "Verified. Starting photo restoration...", 10);

  const safetyTimer = setTimeout(() => {
    sse.sendError({ message: "Photo restoration timed out. Please try again.", statusCode: 504 });
  }, 280_000);

  try {
    const styleCatalog = await getStyleCatalogPayload();
    const imageModel = styleCatalog.ai_models?.image_generation;

    const restorePrompt = [
      `You are a professional food and product photo retoucher for social media.`,
      `Brand: ${brand.company_name} (${brand.company_type}).`,
      `Brand colors: ${brand.color_1}, ${brand.color_2}, ${brand.color_3}.`,
      `Primary objective: ${GOAL_INSTRUCTIONS[restore_goal] || GOAL_INSTRUCTIONS.appetizing}`,
      `Restoration intensity: ${INTENSITY_INSTRUCTIONS[restore_intensity] || INTENSITY_INSTRUCTIONS.balanced}`,
      keep_composition
        ? "Preserve framing, composition, and original subject arrangement."
        : "You may improve framing and composition if it increases visual impact.",
      remove_distractions
        ? "Reduce distractions: remove noise, stains, clutter, and visual artifacts where possible."
        : "Keep scene details intact; do not remove elements unless technically required.",
      `Target aspect ratio: ${aspect_ratio}.`,
      reference_text?.trim() ? `User notes: ${reference_text.trim()}` : "",
      use_logo ? "Reserve clean space for logo placement." : "",
      "Keep the result realistic and commercially appealing.",
      "Do not add unrelated objects or new food items not present in the source image.",
    ].filter(Boolean).join("\n");

    sse.sendProgress("image_generation", "Enhancing your photo...", 45);

    let logoData: { mimeType: string; data: string } | null = null;
    if (brand.logo_url) {
      logoData = await downloadImageAsBase64(brand.logo_url);
    }

    const restored = await editImage({
      prompt: restorePrompt,
      currentImageBase64: source_image.data,
      currentImageMimeType: source_image.mimeType,
      apiKey: geminiApiKey,
      logoImageData: use_logo ? logoData : null,
      model: imageModel,
    });

    let finalBuffer = restored.buffer;
    if (use_logo && logoData?.data) {
      sse.sendProgress("logo_overlay", "Applying logo overlay...", 62);
      const logoBuffer = Buffer.from(logoData.data, "base64");
      finalBuffer = await applyLogoOverlay(
        finalBuffer,
        logoBuffer,
        (logo_position || "bottom-right") as
          | "top-left"
          | "top-center"
          | "top-right"
          | "middle-left"
          | "middle-center"
          | "middle-right"
          | "bottom-left"
          | "bottom-center"
          | "bottom-right",
      );
    }

    sse.sendProgress("optimization", "Optimizing image...", 75);
    const originalSize = finalBuffer.length;
    const { image: optimizedImage, thumbnail } = await processImageWithThumbnail(finalBuffer);
    console.log(
      `[Photo Restore] ${user.id}: ${formatBytes(originalSize)} -> ${formatBytes(optimizedImage.sizeBytes)} (${Math.round((1 - optimizedImage.sizeBytes / originalSize) * 100)}% reduction)`,
    );

    const postId = randomUUID();
    const imageUrl = await uploadFile(
      supabase,
      "user_assets",
      `${user.id}/restored/${postId}`,
      optimizedImage.buffer,
      "image/webp",
    );
    const thumbnailUrl = await uploadFile(
      supabase,
      "user_assets",
      `${user.id}/thumbnails/restored/${postId}`,
      thumbnail.buffer,
      "image/webp",
    );

    sse.sendProgress("caption_quality", "Writing caption...", 88);
    const candidateCaption =
      normalizedLanguage === "pt"
        ? "Foto restaurada e pronta para converter mais no feed. Visual mais apetitoso, limpo e profissional para destacar sua oferta."
        : normalizedLanguage === "es"
          ? "Foto restaurada y lista para convertir mejor en redes. Imagen más apetitosa, limpia y profesional para destacar tu oferta."
          : "Photo restored and optimized for stronger social performance. Cleaner, more appetizing, and ready to showcase your offer.";

    const finalCaption = await ensureCaptionQuality({
      apiKey: geminiApiKey,
      brandName: brand.company_name,
      companyType: brand.company_type,
      contentLanguage: normalizedLanguage,
      scenarioType: "photo-restoration",
      subjectDefinition: reference_text || "Restored source image",
      promptContext: restorePrompt,
      candidateCaption,
      model: styleCatalog.ai_models?.text_generation,
      mode: "create",
    });

    sse.sendProgress("saving", "Saving restored post...", 95);
    const expiresAt = calculatePostExpirationIso();
    const { data: post, error: insertError } = await supabase
      .from("posts")
      .insert({
        id: postId,
        user_id: user.id,
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        content_type: "image",
        caption: finalCaption,
        ai_prompt_used: [
          "Mode: photo_restore",
          `Goal: ${restore_goal}`,
          `Intensity: ${restore_intensity}`,
          `Keep composition: ${keep_composition ? "yes" : "no"}`,
          `Remove distractions: ${remove_distractions ? "yes" : "no"}`,
          reference_text?.trim() ? `User notes: ${reference_text.trim()}` : "",
          `Restore prompt: ${restorePrompt}`,
        ].filter(Boolean).join("\n"),
        status: "completed",
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (insertError || !post) {
      throw new Error(insertError?.message || "Failed to save restored post");
    }

    const usageEvent = await recordUsageEvent(
      user.id,
      postId,
      "generate",
      {
        image_input_tokens: restored.usage?.promptTokenCount,
        image_output_tokens: restored.usage?.candidatesTokenCount,
      },
      {
        image_model: restored.model || imageModel,
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

    clearTimeout(safetyTimer);
    sse.sendComplete({
      post,
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      content_type: "image",
      caption: finalCaption,
      headline: "Photo restored",
      subtext: "Enhanced and ready for posting",
      post_id: postId,
      expires_at: post.expires_at || expiresAt,
    });
  } catch (error) {
    clearTimeout(safetyTimer);
    console.error("Restore photo error:", error);
    const message = error instanceof Error ? error.message : "Photo restoration failed";
    await logRestoreError({
      userId: user.id,
      errorMessage: message,
      requestParams: sanitizedRequestParams,
    });
    if (!sse.isClosed()) {
      sse.sendError({ message, statusCode: 500 });
    }
  }
});

export default router;
