import type { EditPostRequest, EditSlideRequest } from "@shared/schema";

export function buildQuickRemakeRequest(params: {
  postId: string;
  contentLanguage: string;
  mediaType: "image" | "video";
  aiPromptUsed: string;
}): EditPostRequest {
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
    edit_context: {
      goal_text: baseGoal,
      focus_areas: ["subject", "style", "composition"],
      focus_details: focusDetails,
      text_mode: "improve",
      preserve_layout: false,
      extra_notes:
        "Preserve brand consistency, subject fidelity, and the core commercial meaning. Introduce a noticeably new variation instead of a near-duplicate.",
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
