/**
 * Gemini Service
 * Handles all interactions with Google Gemini AI API
 */

import { config } from "../config/index.js";
import { LANGUAGE_NAMES, LOGO_POSITION_DESCRIPTIONS } from "../../shared/config/defaults.js";
import type { Brand, StyleCatalog, TextBlock, TextRenderMode, TextStyle } from "../../shared/schema.js";
import { buildImagePromptFromStructuredJson, formatBrandColors, formatBrandColorsLabeled } from "./prompt-builder.service.js";
import { chatCompletion, toOpenRouterInputReference, type ChatMessageContent } from "./ai-gateway.service.js";
import { getCallRouting } from "./ai-gateway-settings.service.js";
import {
    PLANNING_MAX_OUTPUT_TOKENS,
    PLANNING_JSON_SCHEMA,
    PLANNING_GEMINI_RESPONSE_SCHEMA,
    PlanningSchemaError,
    validatePlanningWireResult,
    isPlanningSchemaError,
} from "./planning-schema.service.js";
import { logPlanningSchemaFailure } from "./observability.service.js";

export interface GeminiStructuredImagePrompt {
    subject?: string;
    composition?: {
        layout?: string;
        framing?: string;
        focal_point?: string;
        camera_angle?: string;
        depth_of_field?: string;
    };
    visual_style?: {
        type?: string;
        mood?: string;
        lighting?: {
            type?: string;
            direction?: string;
            quality?: string;
        };
    };
    color_specification?: {
        palette?: string[];
        dominant_color?: string;
        color_harmony?: string;
    };
    required_elements?: string[];
    text_rendering?: {
        headline_text?: string;
        subtext_text?: string;
        typography_style?: string;
        text_placement?: string;
        readability?: string;
        text_contrast?: string;
    };
    logo_integration?: {
        position?: string;
        size?: string;
        treatment?: string;
        integration_style?: string;
    };
    aspect_ratio?: string;
    negative_prompt?: string;
}

export interface GeminiCreativePlan {
    scenario_type: string;
    subject_definition: string;
    preservation_notes: string;
    exact_text_required: boolean;
    exact_text_value: string;
    visual_constraints: string[];
    negative_constraints: string[];
    structured_image_prompt?: GeminiStructuredImagePrompt | null;
}

export interface GeminiTextResult {
    headline: string;
    subtext: string;
    image_prompt: string;
    caption: string;
    creative_plan: GeminiCreativePlan;
}

export interface GeminiUsageMetadata {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
}

export interface GeminiTextResponse {
    content: GeminiTextResult;
    usage?: GeminiUsageMetadata;
    model: string;
    costUsdMicros?: number; // Phase 21 GATE-05: OpenRouter usage.cost in micros (gateway path only)
}

export interface GeminiImageResponse {
    buffer: Buffer;
    usage?: GeminiUsageMetadata;
    model: string;
}

export interface GenerateParams {
    brand: Brand;
    styleCatalog: StyleCatalog;
    referenceText?: string;
    // Phase 22 (PLAN-01): full {mimeType,data} objects, not bare base64. The
    // mimeType is REQUIRED to build both transports' multimodal parts. Matches
    // generate.routes.ts's mergedReferenceImages shape exactly — the call site
    // no longer strips it.
    referenceImages?: Array<{ mimeType: string; data: string }>;
    postMood: string;
    useText: boolean;
    copyText?: string;
    textBlocks?: TextBlock[];
    textMode?: TextRenderMode;
    textStyleId?: string;
    textStyleIds?: string[];
    aspectRatio: string;
    useLogo: boolean;
    logoPosition?: string;
    contentLanguage: string;
    contentType?: "image" | "video";
}

/**
 * Gemini API service for text and image generation
 */
export class GeminiService {
    private apiKey: string;
    private openRouterApiKey: string;

    constructor(apiKey?: string, openRouterApiKey?: string) {
        // Phase 12.3: env fallback removed — caller must pass a key resolved via
        // getGeminiApiKey() or the platform_settings path. The env config field
        // is kept for legacy GeminiService instantiations only.
        this.apiKey = apiKey || "";
        // Phase 21.1 (GATE-06): the OpenRouter key for THIS request. Affiliates
        // get their own (profiles.openrouter_api_key) so OpenRouter bills their
        // account; everyone else gets "" and falls back to the platform env key.
        this.openRouterApiKey = openRouterApiKey || "";

        if (!this.apiKey && !this.openRouterApiKey) {
            console.warn("GeminiService instantiated with no API key — caller must resolve via getGeminiApiKey()/getOpenRouterApiKey()");
        }
    }

    private getSelectedTextStyles(params: GenerateParams): TextStyle[] {
        const requestedIds = params.textStyleIds?.length
            ? params.textStyleIds
            : params.textStyleId
                ? [params.textStyleId]
                : [];

        if (requestedIds.length === 0) {
            return [];
        }

        return params.styleCatalog.text_styles?.filter((item) => requestedIds.includes(item.id)) || [];
    }

    private getRequestedText(params: GenerateParams): string {
        const blockText = params.textBlocks?.map((block) => `[${block.role.toUpperCase()}] ${block.text}`).join("\n").trim();
        return blockText || (params.copyText || "").trim();
    }

    private getPlainRequestedText(params: GenerateParams): string {
        const blockText = params.textBlocks?.map((block) => block.text.trim()).filter(Boolean).join(" ").trim();
        return blockText || (params.copyText || "").trim();
    }

    private getTextByRole(params: GenerateParams, role: TextBlock["role"]): string {
        return params.textBlocks?.find((block) => block.role === role)?.text?.trim() || "";
    }

    private buildTextHierarchyInstruction(params: GenerateParams): string {
        if (!params.useText || !params.textBlocks?.length) {
            return "";
        }

        const hierarchy = params.textBlocks
            .map((block) => `${block.role.toUpperCase()}: "${block.text}"`)
            .join(" | ");

        return `Text hierarchy: ${hierarchy}. Treat HIGHLIGHT as the main attention trigger, SUPPORT as the secondary line, and CTA as the smallest reinforcing element if present. Build clean hierarchy and avoid visual competition between roles.`;
    }

    private buildTextModeInstruction(params: GenerateParams): string {
        if (params.contentType === "video") {
            return "";
        }

        if (!params.useText) {
            return "CRITICAL: Do not place any visible headline, subtext, price, CTA, or typographic copy inside the image. Keep the image fully text-free.";
        }

        const requestedText = this.getRequestedText(params);
        const mode = params.textMode || (requestedText ? "guided" : "auto");

        if (mode === "exact" && requestedText) {
            if (params.textBlocks?.length) {
                return `CRITICAL: Render these on-image text blocks EXACTLY as provided. Preserve wording, numbers, punctuation, capitalization, and order. ${params.textBlocks
                    .map((block) => `${block.role.toUpperCase()}: "${block.text}"`)
                    .join(" ")}`;
            }
            return `CRITICAL: Render the on-image text EXACTLY as provided: "${requestedText}". Preserve numbers, currency symbols, punctuation, capitalization, and wording. Do not paraphrase, translate, shorten, or change the numeric value.`;
        }

        if (mode === "guided" && requestedText) {
            if (params.textBlocks?.length) {
                return `Use the provided text hierarchy as the on-image copy system. Keep HIGHLIGHT text dominant, SUPPORT text secondary, and CTA text compact if present. Preserve the commercial meaning and improve only layout, spacing, and hierarchy.`;
            }
            return `Use the provided text as the primary on-image copy: "${requestedText}". You may improve line breaks and visual hierarchy, but preserve the meaning and commercial offer.`;
        }

        if (requestedText) {
            return `Use this text as the main on-image copy direction: "${requestedText}".`;
        }

        return "Generate suitable on-image text aligned to the concept, brand, and post mood.";
    }

    private buildTextStyleInstruction(textStyles: TextStyle[]): string {
        if (textStyles.length === 0) return "";

        const styleSummary = textStyles
            .map((style) => `${style.label} (${style.description})`)
            .join(", ");
        const typographyDirections = textStyles
            .map((style) => style.prompt_hints.typography)
            .filter(Boolean)
            .join("; ");
        const layoutDirections = textStyles
            .map((style) => style.prompt_hints.layout)
            .filter(Boolean)
            .join("; ");
        const emphasisDirections = textStyles
            .map((style) => style.prompt_hints.emphasis)
            .filter(Boolean)
            .join("; ");
        const avoid = textStyles
            .flatMap((style) => style.prompt_hints.avoid)
            .filter(Boolean);
        const avoidInstruction = avoid.length
            ? ` Avoid: ${Array.from(new Set(avoid)).join(", ")}.`
            : "";

        return `Selected text styles: ${styleSummary}. Treat them as a typography pairing system. Typography directions: ${typographyDirections}. Layout directions: ${layoutDirections}. Emphasis rules: ${emphasisDirections}.${avoidInstruction}`;
    }

    private classifyScenario(params: GenerateParams): string {
        const reference = `${params.referenceText || ""} ${this.getRequestedText(params)}`.toLowerCase();
        if (/(plate|meal|dish|restaurant|lunch|dinner|food|burger|pizza|prato|almoco|comida)/.test(reference)) {
            return "food-offer";
        }
        if (/(product|packaging|bottle|jar|perfume|cosmetic|device|box|package)/.test(reference)) {
            return "product-promo";
        }
        if (!params.useText) {
            return "image-only";
        }
        if (params.textMode === "exact") {
            return "exact-text-promo";
        }
        return "brand-promo";
    }

    private buildDefaultCreativePlan(
        params: GenerateParams,
        headline: string,
        subtext: string
    ): GeminiCreativePlan {
        const selectedTextStyles = this.getSelectedTextStyles(params);
        const requestedText = this.getRequestedText(params);
        const plainRequestedText = this.getPlainRequestedText(params);
        const exactTextRequired = params.useText && params.textMode === "exact" && Boolean(plainRequestedText);
        const highlightText = this.getTextByRole(params, "highlight");
        const supportText = this.getTextByRole(params, "support");
        const subjectDefinition = params.referenceText?.trim()
            || (params.referenceImages?.length
                ? "Preserve the primary subject shown in the reference image."
                : `${params.brand.company_type} social media subject for ${params.brand.company_name}`);
        const negativeConstraints = [
            params.referenceImages?.length
                ? "Do not replace the referenced subject with a different concept."
                : "",
            exactTextRequired
                ? "Do not change the wording, numbers, punctuation, or currency in the exact text."
                : "",
            !params.useText
                ? "Do not place visible promotional text in the image."
                : "",
            params.useLogo
                ? "Do not invent or typeset a fake logo."
                : "",
        ].filter(Boolean);

        const structuredImagePrompt: GeminiStructuredImagePrompt = {
            subject: subjectDefinition,
            composition: {
                layout: params.referenceImages?.length
                    ? "preserve the subject identity and commercial framing from the references"
                    : "clean commercial composition centered on the main subject",
                framing: "social-media-ready framing with a clear focal point",
                focal_point: "the main food, product, or offer subject",
                camera_angle: "natural ad-style angle",
                depth_of_field: "moderate depth for subject clarity",
            },
            visual_style: {
                type: params.brand.mood,
                mood: params.postMood,
                lighting: {
                    type: "clean commercial lighting",
                    direction: "subject-forward lighting",
                    quality: "crisp and readable",
                },
            },
            color_specification: {
                palette: [params.brand.color_1, params.brand.color_2, params.brand.color_3, params.brand.color_4].filter(Boolean) as string[],
                dominant_color: params.brand.color_1,
                color_harmony: "brand-aligned commercial palette",
            },
            required_elements: [
                params.referenceImages?.length ? "preserved subject identity from reference" : "",
                params.useText && headline ? "clear promotional typography" : "",
                params.useLogo ? "reserved clean zone for real logo overlay" : "",
            ].filter(Boolean),
            text_rendering: params.useText
                ? {
                    headline_text: highlightText || (exactTextRequired ? requestedText : headline),
                    subtext_text: supportText || (exactTextRequired ? "" : subtext),
                    typography_style: selectedTextStyles.map((style) => style.prompt_hints.typography).filter(Boolean).join("; ") || "high-contrast commercial typography",
                    text_placement: selectedTextStyles.map((style) => style.prompt_hints.layout).filter(Boolean).join("; ") || "clear hierarchy with readable placement",
                    readability: "high readability at social card size",
                    text_contrast: "high contrast against the background",
                }
                : undefined,
            logo_integration: params.useLogo
                ? {
                    position: params.logoPosition || "bottom-right",
                    size: "small but legible",
                    treatment: "keep the placement zone visually clean for the real logo overlay",
                }
                : undefined,
            aspect_ratio: params.aspectRatio,
            negative_prompt: negativeConstraints.join(" "),
        };

        return {
            scenario_type: this.classifyScenario(params),
            subject_definition: subjectDefinition,
            preservation_notes: params.referenceImages?.length
                ? "Preserve the recognizable identity of the referenced subject."
                : "Maintain a clear commercial subject hierarchy.",
            exact_text_required: exactTextRequired,
            exact_text_value: exactTextRequired ? plainRequestedText : "",
            visual_constraints: [
                params.useText ? "Keep the text readable and commercially clear." : "Keep the image text-free.",
                params.useLogo ? "Preserve a clean zone for the real logo overlay." : "No logo overlay required.",
            ],
            negative_constraints: negativeConstraints,
            structured_image_prompt: structuredImagePrompt,
        };
    }

    private normalizeGeminiTextResult(raw: any, params: GenerateParams): GeminiTextResult {
        const headline = String(raw?.headline || "").trim();
        const subtext = String(raw?.subtext || "").trim();
        const fallbackPlan = this.buildDefaultCreativePlan(params, headline, subtext);
        const rawPlan = raw?.creative_plan && typeof raw.creative_plan === "object" ? raw.creative_plan : {};
        const structuredImagePrompt =
            rawPlan?.structured_image_prompt && typeof rawPlan.structured_image_prompt === "object"
                ? rawPlan.structured_image_prompt as GeminiStructuredImagePrompt
                : fallbackPlan.structured_image_prompt;

        const creativePlan: GeminiCreativePlan = {
            scenario_type: String(rawPlan?.scenario_type || fallbackPlan.scenario_type).trim() || fallbackPlan.scenario_type,
            subject_definition: String(rawPlan?.subject_definition || fallbackPlan.subject_definition).trim() || fallbackPlan.subject_definition,
            preservation_notes: String(rawPlan?.preservation_notes || fallbackPlan.preservation_notes).trim() || fallbackPlan.preservation_notes,
            exact_text_required: rawPlan?.exact_text_required === true || fallbackPlan.exact_text_required,
            exact_text_value: String(rawPlan?.exact_text_value || fallbackPlan.exact_text_value || "").trim(),
            visual_constraints: Array.isArray(rawPlan?.visual_constraints)
                ? rawPlan.visual_constraints.map((item: unknown) => String(item).trim()).filter(Boolean)
                : fallbackPlan.visual_constraints,
            negative_constraints: Array.isArray(rawPlan?.negative_constraints)
                ? rawPlan.negative_constraints.map((item: unknown) => String(item).trim()).filter(Boolean)
                : fallbackPlan.negative_constraints,
            structured_image_prompt: structuredImagePrompt,
        };

        const flattenedPrompt = structuredImagePrompt
            ? buildImagePromptFromStructuredJson(structuredImagePrompt)
            : "";
        const imagePrompt = String(raw?.image_prompt || flattenedPrompt || "").trim();
        const fallback = this.buildLocalTextFallback(params);

        return {
            headline: headline || fallback.headline,
            subtext: subtext || fallback.subtext,
            image_prompt: imagePrompt || fallback.image_prompt,
            caption: String(raw?.caption || "").trim() || fallback.caption,
            creative_plan: creativePlan,
        };
    }

    private buildLocalTextFallback(params: GenerateParams): GeminiTextResult {
        const { brand, referenceText, copyText, postMood, aspectRatio, contentType, contentLanguage, useText } = params;
        const isVideo = contentType === "video";
        const mood = (postMood || "promo").trim();
        const vision = (referenceText || "").trim();
        const requestedText = this.getRequestedText(params);
        const selectedTextStyles = this.getSelectedTextStyles(params);
        const highlightText = this.getTextByRole(params, "highlight");
        const supportText = this.getTextByRole(params, "support");
        const textStyleInstruction = this.buildTextStyleInstruction(selectedTextStyles);
        const textModeInstruction = this.buildTextModeInstruction(params);
        const textHierarchyInstruction = this.buildTextHierarchyInstruction(params);

        const headlineSource = useText ? (highlightText || requestedText || `${brand.company_name} ${mood}`) : "";
        const headline = headlineSource.split(/\s+/).slice(0, 6).join(" ").trim();
        const subtext = isVideo
            ? `Cinematic ${mood} video for ${brand.company_name}.`
            : useText
                ? (supportText || `High-converting ${mood} visual for ${brand.company_name}.`)
                : "";

        const image_prompt = isVideo
            ? `Create a ${aspectRatio} cinematic social video for ${brand.company_name} in the ${brand.company_type} niche. Mood: ${mood}. Visual direction: ${vision || "before and after transformation"}. Use brand colors ${formatBrandColors(brand)}. Keep composition clear, premium, and ad-ready.`
            : `Create a ${aspectRatio} social media image for ${brand.company_name} (${brand.company_type}) with ${mood} mood. Visual direction: ${vision || "before and after transformation"}. Preserve the primary subject from the reference if one is provided. Use brand colors ${formatBrandColors(brand)}. ${textModeInstruction} ${textHierarchyInstruction} ${textStyleInstruction} Keep layout clean, commercial, and conversion-focused.`;

        const lang = contentLanguage !== "en" ? ` (${contentLanguage})` : "";
        const caption = `${brand.company_name}${lang}\n\nTransform your results with a professional ${mood} approach tailored for ${brand.company_type}.\n\n#${brand.company_name.replace(/\s+/g, "")} #${mood} #marketing`;
        const creativePlan = this.buildDefaultCreativePlan(params, headline, subtext);
        const flattenedPrompt = creativePlan.structured_image_prompt
            ? buildImagePromptFromStructuredJson(creativePlan.structured_image_prompt)
            : "";

        return {
            headline,
            subtext,
            image_prompt: flattenedPrompt || image_prompt,
            caption,
            creative_plan: creativePlan,
        };
    }

    private async generateCaptionOnly(params: GenerateParams, model: string): Promise<string | null> {
        const languageLabel = LANGUAGE_NAMES[params.contentLanguage] || "English";
        const prompt = `Write a concise, engaging social media caption for:
- Brand: ${params.brand.company_name}
- Industry: ${params.brand.company_type}
- Mood: ${params.postMood}
- Direction: ${params.referenceText || "general promotional post"}

Requirements:
- Language: ${languageLabel}
- 2 short paragraphs + hashtags
- Do not copy the user direction verbatim; rewrite naturally
- No JSON, plain text only`;

        try {
            const routing = await getCallRouting("planning");
            const captionOrKey = this.openRouterApiKey || config.OPENROUTER_API_KEY;
            if (routing === "openrouter" && captionOrKey) {
                const result = await chatCompletion({
                    apiKey: captionOrKey,
                    model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.6,
                    maxTokens: 512,
                });
                return result.text.trim() || null;
            }

            // direct path — header auth (POL-07), body unchanged
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.6, maxOutputTokens: 512 },
                    }),
                },
            );
            if (!response.ok) return null;
            const data = await response.json();
            const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
            return text || null;
        } catch {
            return null;
        }
    }

    /**
     * Build the context prompt for text generation
     */
    buildContextPrompt(params: GenerateParams): string {
        const { brand, styleCatalog, referenceText, referenceImages, postMood, aspectRatio, useLogo, logoPosition, contentLanguage, contentType, useText } = params;

        const brandStyle = styleCatalog.styles.find((item) => item.id === brand.mood);
        const selectedPostMood = styleCatalog.post_moods.find((item) => item.id === postMood);
        const selectedTextStyles = this.getSelectedTextStyles(params);
        const brandStyleLabel = brandStyle?.label || brand.mood;
        const brandStyleDesc = brandStyle?.description ? ` (${brandStyle.description})` : "";
        const postMoodLabel = selectedPostMood?.label || postMood;
        const postMoodDesc = selectedPostMood?.description ? ` (${selectedPostMood.description})` : "";
        const isVideo = contentType === "video";
        const requestedText = this.getRequestedText(params);
        const plainRequestedText = this.getPlainRequestedText(params);
        const highlightText = this.getTextByRole(params, "highlight");
        const supportText = this.getTextByRole(params, "support");
        const ctaText = this.getTextByRole(params, "cta");
        const textModeInstruction = this.buildTextModeInstruction(params);
        const textStyleInstruction = this.buildTextStyleInstruction(selectedTextStyles);
        const textHierarchyInstruction = this.buildTextHierarchyInstruction(params);
        const referenceFidelityInstruction = referenceImages && referenceImages.length > 0
            ? `\nCRITICAL REFERENCE FIDELITY: Preserve the primary subject from the reference images. If the references depict a specific meal, product, package, or object, keep it recognizable and do not replace it with a different concept.`
            : "";

        const languageInstruction = contentLanguage !== "en"
            ? isVideo
                ? `\n\nCRITICAL: Generate ALL text content (caption and hashtags) in ${LANGUAGE_NAMES[contentLanguage]}. Any spoken dialogue in the video prompt must be in ${LANGUAGE_NAMES[contentLanguage]}.`
                : `\n\nCRITICAL: Generate ALL text content (headline, subtext, caption, and hashtags) in ${LANGUAGE_NAMES[contentLanguage]}. The image text must be in ${LANGUAGE_NAMES[contentLanguage]}.`
            : "";

        if (isVideo) {
            return `You are an expert Video Director and Social Media Strategist.
${languageInstruction}

Context about the brand:
- Brand name: ${brand.company_name}
- Industry/Niche: ${brand.company_type}
- Brand colors: ${formatBrandColorsLabeled(brand)}
- Brand style: ${brandStyleLabel}${brandStyleDesc}
${brand.logo_url ? `- Brand logo: The brand has a logo.` : ""}

The user wants a "${postMoodLabel}"${postMoodDesc} mood for this social media video.
${referenceText ? `User's visual direction: "${referenceText}"` : ""}
${referenceImages && referenceImages.length > 0 ? `The user has provided ${referenceImages.length} reference image(s). Analyze these images and incorporate their visual style, composition, color schemes, and design elements into the video.` : ""}
${referenceFidelityInstruction}
${useLogo && brand.logo_url ? `IMPORTANT: The user wants their brand logo visible in the video as a watermark/signature in the ${logoPosition ? LOGO_POSITION_DESCRIPTIONS[logoPosition] : "bottom-right corner"}. Describe the logo appearing as a subtle overlay or signature element in the video.` : ""}
Aspect ratio: ${aspectRatio}

Your task:
1. ${referenceImages && referenceImages.length > 0 ? "Analyze the provided reference images and extract key visual elements, styles, and composition patterns." : ""}
2. Write a highly descriptive, cinematic prompt for a video generation AI model (Google Veo). The prompt should describe:
   - The scene, subject, and action happening in the video
   - Camera movement (dolly, pan, tracking shot, close-up, wide shot, etc.)
   - Visual style matching the ${brandStyleLabel}${brandStyleDesc} brand aesthetic
   - The ${postMoodLabel}${postMoodDesc} mood and atmosphere
   - Lighting, color palette (using brand colors: ${formatBrandColors(brand)})
   - Any dialogue, sound effects, or ambient audio cues
${useLogo && brand.logo_url ? `   - The brand logo appearing as a subtle watermark or signature element in the ${logoPosition ? LOGO_POSITION_DESCRIPTIONS[logoPosition] : "bottom-right corner"}` : ""}
   Keep it under 300 words. Be specific and cinematic.
3. Write an engaging social media caption with relevant hashtags. IMPORTANT: Format the caption with proper paragraph breaks using newline characters (\\n\\n) between different ideas or sections. Each paragraph should be 1-2 sentences. Add hashtags at the end separated by a blank line.

CRITICAL: You MUST respond with ONLY valid JSON. Do not include any explanation, markdown formatting, or additional text. Your entire response must be parseable as JSON.

Response format (JSON only, no markdown):
{
  "headline": "",
  "subtext": "",
  "image_prompt": "detailed cinematic video generation prompt for Veo",
  "caption": "engaging social media caption with \\n\\n paragraph breaks and hashtags"
}`;
        }

        const contextPrompt = `You are an expert Art Director and Social Media Strategist.
${languageInstruction}

Context about the brand:
- Brand name: ${brand.company_name}
- Industry/Niche: ${brand.company_type}
- Brand colors: ${formatBrandColorsLabeled(brand)}
- Brand style: ${brandStyleLabel}${brandStyleDesc}
${brand.logo_url ? `- Brand logo URL: ${brand.logo_url}` : ""}

The user wants a "${postMoodLabel}"${postMoodDesc} post mood for this social media image.
${useText
                ? (requestedText
                    ? `Requested on-image text system:\n${params.textBlocks?.length
                        ? params.textBlocks.map((block) => `- ${block.role.toUpperCase()}: "${block.text}"`).join("\n")
                        : `- PRIMARY COPY: "${requestedText}"`}`
                    : "Create engaging text for the image based on the brand context, industry, and post mood.")
                : "The user explicitly wants NO text on the image."}
${referenceText ? `User's visual direction: "${referenceText}"` : ""}
${referenceImages && referenceImages.length > 0 ? `The user has provided ${referenceImages.length} reference image(s). Analyze these images and incorporate their visual style, composition, color schemes, and design elements into your recommendations.` : ""}
${referenceFidelityInstruction}
${textModeInstruction ? `\n${textModeInstruction}` : ""}
${textHierarchyInstruction ? `\n${textHierarchyInstruction}` : ""}
${textStyleInstruction ? `\n${textStyleInstruction}` : ""}
${useLogo && brand.logo_url ? `IMPORTANT: A real logo file will be composited after generation. DO NOT draw or typeset a fake logo/name in the image. Keep the target corner visually clean for logo placement in the ${logoPosition ? LOGO_POSITION_DESCRIPTIONS[logoPosition] : "bottom-right corner"}.` : ""}
Aspect ratio: ${aspectRatio}

Your task:
1. ${referenceImages && referenceImages.length > 0 ? "First, analyze the provided reference images and extract key visual elements, styles, and composition patterns." : ""}
2. ${useText
                ? (requestedText
                    ? `Use the requested copy system to build a clean visual hierarchy. Headline should follow the highlight role when present (${highlightText || "not provided"}). Subtext should follow the support role when present (${supportText || "not provided"}). CTA should remain compact (${ctaText || "not provided"}). If no roles are provided, analyze the provided text ("${plainRequestedText}") and split it into a short punchy "headline" (max 6 words) and a "subtext" (the supporting message).`
                    : `Create a compelling headline (max 6 words) and subtext that promotes the brand ${brand.company_name} in the ${brand.company_type} industry, matching the ${postMoodLabel} mood.`)
                : "Return empty strings for both headline and subtext."}
3. Build a structured creative plan for the image generation model. The structured image prompt must incorporate:
   - The brand colors (${formatBrandColors(brand)})
   - The ${brandStyleLabel}${brandStyleDesc} brand style
   - The ${postMoodLabel}${postMoodDesc} post mood
   ${referenceImages && referenceImages.length > 0 ? "   - Visual style and subject identity from the reference images" : ""}
   ${selectedTextStyles.length > 0 ? `- The selected text style directions: ${selectedTextStyles.map((style) => style.label).join(", ")}` : ""}
   ${!useText ? "- The final image must remain text-free" : "- The text rendering rules above must be respected"}
4. Optionally provide a flattened image_prompt string, but prioritize the creative_plan.structured_image_prompt object.
5. Write an engaging social media caption with relevant hashtags. IMPORTANT: Format the caption with proper paragraph breaks using newline characters (\\n\\n) between different ideas or sections. Each paragraph should be 1-2 sentences. Add hashtags at the end separated by a blank line.

CRITICAL: You MUST respond with ONLY valid JSON. Do not include any explanation, markdown formatting, or additional text. Your entire response must be parseable as JSON.

Response format (JSON only, no markdown):
{
  "headline": "string with max 6 words",
  "subtext": "string with supporting message",
  "image_prompt": "optional flattened image prompt string",
  "caption": "engaging social media caption with \\n\\n paragraph breaks and hashtags",
  "creative_plan": {
    "scenario_type": "short classification such as food-offer, product-promo, image-only, exact-text-promo",
    "subject_definition": "what must remain recognizable in the final image",
    "preservation_notes": "short note on what must not drift from the reference",
    "exact_text_required": true,
    "exact_text_value": "the exact visible promotional text when applicable, otherwise empty string",
    "visual_constraints": ["array of important visual constraints"],
    "negative_constraints": ["array of failure modes to avoid"],
    "structured_image_prompt": {
      "subject": "core subject statement",
      "composition": {
        "layout": "layout guidance",
        "framing": "framing guidance",
        "focal_point": "main focal point",
        "camera_angle": "camera angle",
        "depth_of_field": "depth guidance"
      },
      "visual_style": {
        "type": "brand style",
        "mood": "post mood",
        "lighting": {
          "type": "lighting type",
          "direction": "lighting direction",
          "quality": "lighting quality"
        }
      },
      "color_specification": {
        "palette": ["brand palette values"],
        "dominant_color": "dominant color",
        "color_harmony": "harmony note"
      },
      "required_elements": ["must-have elements"],
      "text_rendering": {
        "headline_text": "headline or exact text",
        "subtext_text": "support text or empty string",
        "typography_style": "typography direction",
        "text_placement": "placement guidance",
        "readability": "readability rule",
        "text_contrast": "contrast rule"
      },
      "logo_integration": {
        "position": "logo position",
        "size": "logo size guidance",
        "treatment": "keep the zone clean for real logo overlay"
      },
      "aspect_ratio": "target aspect ratio",
      "negative_prompt": "concise avoid list"
    }
  }
}`;

        return contextPrompt;
    }

    /**
     * PLAN-01 (OpenRouter transport): the planning call's multimodal `content`.
     * Reuses toOpenRouterInputReference() — its {type:"image_url", image_url:{url}}
     * output is exactly the OpenAI-compatible vision content-part shape OpenRouter's
     * chat completions endpoint expects. Returns a PLAIN STRING when there are no
     * reference images so text-only planning calls keep a byte-identical request
     * body to Phase 21's.
     */
    private buildPlanningContentParts(prompt: string, referenceImages?: Array<{ mimeType: string; data: string }>): ChatMessageContent {
        const images = (referenceImages ?? []).filter((img) => img?.mimeType && img?.data);
        if (images.length === 0) return prompt;
        return [
            { type: "text", text: prompt },
            ...images.map(toOpenRouterInputReference),
        ];
    }

    /**
     * PLAN-01 (direct-Gemini GATE-07 rollback transport): the planning call's
     * contents[0].parts. Mirrors generateImage()'s existing inlineData pattern.
     */
    private buildPlanningGeminiParts(prompt: string, referenceImages?: Array<{ mimeType: string; data: string }>): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> {
        const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
            { text: prompt },
        ];
        for (const image of referenceImages ?? []) {
            if (!image?.mimeType || !image?.data) continue;
            parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
        }
        return parts;
    }

    /**
     * Generate text content (headline, subtext, image prompt, caption)
     */
    async generateText(params: GenerateParams): Promise<GeminiTextResponse> {
        const routing = await getCallRouting("planning");
        // Phase 21.1 (GATE-06) — GATE-07 rollback limitation, accepted & documented:
        // affiliates now bring an OpenRouter key for all gateway work. Their
        // Settings Gemini key field is retained but scoped to video generation
        // only, so many affiliates will leave profiles.api_key empty. Flipping
        // ai_gateway_routing.planning to "direct" during an incident therefore
        // throws here for any affiliate WITHOUT a Gemini key and degrades to
        // buildTextFallback(). This is an emergency, short-lived state by design.
        // If a "direct" rollback must persist with active affiliates, ask them to
        // fill in the Settings Gemini key field (or backfill profiles.api_key via
        // direct DB access).
        if (routing === "direct" && !this.apiKey) {
            throw new Error("Gemini API key not configured");
        }

        const prompt = this.buildContextPrompt(params);
        // PLAN-03: the single-image art-director planning call gets its OWN
        // admin-configurable higher-tier slug. text_generation is NOT repointed —
        // it is shared by generateCaptionOnly, callCarouselTextPlan,
        // ensureCaptionQuality and enforceExactImageText's verification model, none
        // of which should inherit a Pro-tier price.
        //
        // The video planning call keeps text_generation: its prompt returns a
        // DIFFERENT (creative_plan-free) JSON shape and the video pipeline is FROZEN
        // this milestone (GATE-08) — no cost or behavior change is in scope for it.
        const isVideoPlanning = params.contentType === "video";
        const model = isVideoPlanning
            ? (params.styleCatalog.ai_models?.text_generation || "gemini-2.5-flash")
            : (params.styleCatalog.ai_models?.planning || "gemini-2.5-pro");

        // PLAN-02: strict structured output for the single-image art-director call.
        // The FROZEN video planning call keeps the loose json_object shape — its
        // prompt returns a different, creative_plan-free JSON body that this schema
        // does not describe, and GATE-08 keeps the video pipeline out of scope.
        const planningResponseFormat: { type: "json_object" } | { type: "json_schema"; json_schema: Record<string, unknown> } =
            isVideoPlanning
                ? { type: "json_object" }
                : { type: "json_schema", json_schema: PLANNING_JSON_SCHEMA };

        // Last raw model text seen, for the schema-failure log payload (Task 2).
        let lastRawResponseText = "";

        const parseGeminiJson = (text: string): any => {
            // Strategy 1: Find JSON between curly braces
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            // Strategy 2: Try to extract JSON from markdown code blocks
            const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (codeBlockMatch) {
                return JSON.parse(codeBlockMatch[1]);
            }

            throw new Error("no_json_found");
        };

        const runTextCall = async (attempt: 1 | 2): Promise<{ content: GeminiTextResult; usage?: GeminiUsageMetadata; costUsdMicros?: number }> => {
            const tightenedPrompt =
                attempt === 2
                    ? `${prompt}\n\nFINAL INSTRUCTION: Return ONLY valid JSON with keys headline, subtext, image_prompt, caption, creative_plan. No markdown, no commentary.`
                    : prompt;

            if (routing === "openrouter") {
                const orKey = this.openRouterApiKey || config.OPENROUTER_API_KEY;
                if (!orKey) {
                    throw new Error("OPENROUTER_API_KEY is not configured. Set it, or flip ai_gateway_routing.planning to \"direct\".");
                }
                const result = await chatCompletion({
                    apiKey: orKey,
                    model, // bare "gemini-2.5-flash" is fine — the gateway normalizes to google/gemini-2.5-flash
                    messages: [{ role: "user", content: this.buildPlanningContentParts(tightenedPrompt, params.referenceImages) }],
                    temperature: attempt === 1 ? 0.8 : 0.2,
                    // PLAN-03: 4096 (2x the prior 2048). The enriched planning schema
                    // (creative_plan + structured_image_prompt + text_blocks +
                    // layout_archetype_id + a 120-200 word dense image_prompt) does not
                    // fit in 2048 output tokens. Far below the 65,536 completion ceiling
                    // of every structured-outputs-capable Gemini slug.
                    maxTokens: PLANNING_MAX_OUTPUT_TOKENS,
                    responseFormat: planningResponseFormat,
                });
                let content: GeminiTextResult;
                try {
                    lastRawResponseText = result.text;
                    const parsed = parseGeminiJson(result.text);
                    // PLAN-02: validate BEFORE normalizing. normalizeGeminiTextResult is
                    // defensive by design and would happily paper over a schema-invalid
                    // payload with local defaults — exactly the silent degradation this
                    // requirement removes.
                    if (!isVideoPlanning) {
                        validatePlanningWireResult(parsed, result.text, attempt);
                    }
                    content = this.normalizeGeminiTextResult(parsed, params);
                } catch (parseError) {
                    console.error("Planning call failed schema validation (gateway):", {
                        attempt,
                        model,
                        kind: isPlanningSchemaError(parseError) ? "schema" : "transport",
                        preview: result.text.slice(0, 500),
                    });
                    throw parseError;
                }
                return {
                    content,
                    usage: {
                        promptTokenCount: result.usage?.promptTokenCount,
                        candidatesTokenCount: result.usage?.candidatesTokenCount,
                    } as GeminiUsageMetadata,
                    costUsdMicros: result.costUsdMicros,
                };
            }

            // ── "direct" — legacy Gemini path retained for GATE-07 rollback.
            // Identical to the pre-Phase-21 implementation. Auth uses the
            // x-goog-api-key header, not a query-string key (POL-07, already applied).
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": this.apiKey,
                    },
                    body: JSON.stringify({
                        contents: [{ parts: this.buildPlanningGeminiParts(tightenedPrompt, params.referenceImages) }],
                        generationConfig: {
                            temperature: attempt === 1 ? 0.8 : 0.2,
                            maxOutputTokens: PLANNING_MAX_OUTPUT_TOKENS,
                            responseMimeType: "application/json",
                            // PLAN-02 / 22-RESEARCH Pattern 3: Google's dialect uses
                            // UPPERCASE Type strings and `nullable: true` — this is a
                            // SEPARATE literal, never OpenRouter's json_schema object.
                            ...(isVideoPlanning ? {} : { responseSchema: PLANNING_GEMINI_RESPONSE_SCHEMA }),
                        },
                    }),
                },
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gemini text generation failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

            if (!text.trim()) {
                const finishReason = data.candidates?.[0]?.finishReason;
                const safetyRatings = data.candidates?.[0]?.safetyRatings || [];
                console.error("Gemini returned empty response:", { finishReason, safetyRatings, attempt });
                throw new Error(`Gemini blocked the request. Reason: ${finishReason || "Unknown"}. Try different wording or images.`);
            }

            const usage = data.usageMetadata as GeminiUsageMetadata | undefined;
            let content: GeminiTextResult;
            try {
                lastRawResponseText = text;
                const parsed = parseGeminiJson(text);
                if (!isVideoPlanning) {
                    validatePlanningWireResult(parsed, text, attempt);
                }
                content = this.normalizeGeminiTextResult(parsed, params);
            } catch (parseError) {
                console.error("Planning call failed schema validation (direct):", {
                    attempt,
                    model,
                    kind: isPlanningSchemaError(parseError) ? "schema" : "transport",
                    preview: text.slice(0, 500),
                });
                throw parseError;
            }

            return { content, usage, costUsdMicros: undefined };
        };

        try {
            const first = await runTextCall(1);
            return {
                content: first.content,
                usage: first.usage,
                model,
                costUsdMicros: first.costUsdMicros,
            };
        } catch (firstError: any) {
            try {
                const second = await runTextCall(2);
                return {
                    content: second.content,
                    usage: second.usage,
                    model,
                    costUsdMicros: second.costUsdMicros,
                };
            } catch (secondError) {
                console.error("Gemini text generation fallback activated:", {
                    firstError: String(firstError?.message || firstError),
                    secondError: String((secondError as any)?.message || secondError),
                });
                const fallback = this.buildLocalTextFallback(params);
                const aiCaption = await this.generateCaptionOnly(params, model);
                if (aiCaption) {
                    fallback.caption = aiCaption;
                }
                return {
                    content: fallback,
                    usage: undefined,
                    model: `${model} (local-fallback)`,
                };
            }
        }
    }

    /**
     * Generate image from prompt
     */
    async generateImage(
        imagePrompt: string,
        model: string = "gemini-3.1-flash-image-preview",
        referenceImages: Array<{ mimeType: string; data: string }> = []
    ): Promise<GeminiImageResponse> {
        if (!this.apiKey) {
            throw new Error("Gemini API key not configured");
        }

        const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
            { text: imagePrompt },
        ];

        for (const image of referenceImages) {
            if (!image?.mimeType || !image?.data) continue;
            parts.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.data,
                },
            });
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": this.apiKey,
                },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        responseModalities: ["IMAGE", "TEXT"],
                    },
                }),
            }
        );

        if (!response.ok) {
            const rawError = await response.text();
            let parsedMessage = "";
            try {
                const parsed = JSON.parse(rawError);
                parsedMessage = parsed?.error?.message || "";
            } catch {
                parsedMessage = "";
            }
            throw new Error(
                `Gemini image generation failed: ${response.status} - ${parsedMessage || rawError}`
            );
        }

        const data = await response.json();

        // Extract base64 image from response
        const imagePart = data.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);
        if (!imagePart?.inlineData?.data) {
            throw new Error("No image data in Gemini response");
        }

        const usage = data.usageMetadata as GeminiUsageMetadata | undefined;

        return {
            buffer: Buffer.from(imagePart.inlineData.data, "base64"),
            usage,
            model,
        };
    }

}

/**
 * Create a Gemini service instance with the given API key
 */
export function createGeminiService(apiKey?: string, openRouterApiKey?: string): GeminiService {
    return new GeminiService(apiKey, openRouterApiKey);
}
