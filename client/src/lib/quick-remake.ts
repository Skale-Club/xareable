import type { EditPostRequest, EditSlideRequest, GenerationParams } from "@shared/schema";

export function buildQuickRemakeRequest(params: {
  postId: string;
  contentLanguage: string;
  mediaType: "image" | "video";
  aiPromptUsed: string;
  generationParams?: GenerationParams | null;
}): EditPostRequest & { idempotency_key: string } {
  // Phase 26 (POL-06): the return type is widened via intersection (not the
  // EditPostRequest type itself) so this file type-checks both BEFORE plan
  // 26-06 adds the field below to the server-side schema (where it's an
  // extra, unknown-to-the-type field) AND AFTER (where the intersection
  // becomes redundant but still valid). Once 26-06 lands, this intersection
  // may be collapsed back to plain EditPostRequest.
  const baseGoal = params.mediaType === "video"
    ? "Create a fresh video variation that preserves the same main subject, offer, and brand feel."
    : "Create a fresh image variation that preserves the same main subject, offer, and brand feel.";

  const focusDetails = params.mediaType === "video"
    ? "Keep the core subject, story, and commercial intent recognizable while refreshing the motion language, framing, and atmosphere."
    : "Keep the core subject and visible commercial message recognizable while refreshing the composition, styling, and visual rhythm.";

  return {
    post_id: params.postId,
    edit_prompt: `${baseGoal}\nOriginal generation intent:\n${params.aiPromptUsed}`,
    content_language: params.contentLanguage as EditPostRequest["content_language"],
    source: "quick_remake",
    // Phase 26 (POL-06): one fresh key per built request. The builder is called
    // once per user-initiated remake, so key lifetime == submit lifetime.
    idempotency_key: crypto.randomUUID(),
    edit_context: {
      goal_text: baseGoal,
      focus_areas: ["subject", "style", "composition"],
      focus_details: focusDetails,
      text_mode: "improve",
      preserve_layout: false,
      extra_notes:
        "Preserve brand consistency, subject fidelity, and the core commercial meaning. Introduce a noticeably new variation instead of a near-duplicate.",
      // Phase 23 (POL-05): reuse the post's ORIGINAL generation parameters instead
      // of letting the server fall back to defaults or the ai_prompt_used regex.
      aspect_ratio: params.generationParams?.aspect_ratio,
      use_logo: params.generationParams?.use_logo,
      logo_position: params.generationParams?.logo_position,
      // text_only is never set for quick remake — a remake always regenerates the
      // visual concept, so it must take the full pipeline (server also hard-guards
      // this via isTextOnlyEdit's source !== "quick_remake" condition).
    },
  };
}

export function buildCarouselSlideQuickRemakeRequest(params: {
  slideId: string;
  postId: string;
  contentLanguage: string;
  aiPromptUsed: string;
}): EditSlideRequest {
  const baseGoal =
    "Create a fresh variation of this slide that preserves the same subject, offer, and the carousel's visual language.";
  const focusDetails =
    "Keep the slide's commercial intent and recognizable subject intact while refreshing composition, styling, and visual rhythm. Stay consistent with the rest of the carousel.";

  return {
    slide_id: params.slideId,
    post_id: params.postId,
    edit_prompt: `${baseGoal}\nOriginal carousel intent:\n${params.aiPromptUsed}`,
    content_language: params.contentLanguage as EditSlideRequest["content_language"],
    source: "quick_remake",
    edit_context: {
      goal_text: baseGoal,
      focus_areas: ["subject", "style", "composition"],
      focus_details: focusDetails,
      preserve_layout: false,
      extra_notes:
        "Preserve carousel-wide brand consistency, subject fidelity, and commercial meaning. Produce a noticeably new variation — not a near-duplicate. Do NOT add or change on-image text.",
      // text_mode intentionally omitted — server defaults to no-op for carousel slides (CRSL-10).
    },
  };
}
