/**
 * Gemini Service
 * Handles all interactions with Google Gemini AI API
 */

import { config } from "../config/index.js";
import { LANGUAGE_NAMES, LOGO_POSITION_DESCRIPTIONS } from "../../shared/config/defaults.js";
import type { Brand, StyleCatalog } from "../../shared/schema.js";

export interface GeminiTextResult {
    headline: string;
    subtext: string;
    image_prompt: string;
    caption: string;
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
    referenceImages?: string[]; // base64 encoded
    postMood: string;
    copyText?: string;
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

    constructor(apiKey?: string) {
        this.apiKey = apiKey || config.GEMINI_API_KEY || "";

        if (!this.apiKey) {
            console.warn("Gemini API key not configured");
        }
    }

    private buildLocalTextFallback(params: GenerateParams): GeminiTextResult {
        const { brand, referenceText, copyText, postMood, aspectRatio, contentType, contentLanguage } = params;
        const isVideo = contentType === "video";
        const mood = (postMood || "promo").trim();
        const vision = (referenceText || "").trim();
        const requestedText = (copyText || "").trim();

        const headlineSource = requestedText || `${brand.company_name} ${mood}`;
        const headline = headlineSource.split(/\s+/).slice(0, 6).join(" ").trim() || brand.company_name;
        const subtext = isVideo
            ? `Cinematic ${mood} video for ${brand.company_name}.`
            : `High-converting ${mood} visual for ${brand.company_name}.`;

        const image_prompt = isVideo
            ? `Create a ${aspectRatio} cinematic social video for ${brand.company_name} in the ${brand.company_type} niche. Mood: ${mood}. Visual direction: ${vision || "before and after transformation"}. Use brand colors ${brand.color_1}, ${brand.color_2}, ${brand.color_3}. Keep composition clear, premium, and ad-ready.`
            : `Create a ${aspectRatio} social media image for ${brand.company_name} (${brand.company_type}) with ${mood} mood. Visual direction: ${vision || "before and after transformation"}. Use brand colors ${brand.color_1}, ${brand.color_2}, ${brand.color_3}. ${requestedText ? `Include text: ${requestedText}.` : "Generate suitable on-image text aligned to the concept."} Keep layout clean and conversion-focused.`;

        const lang = contentLanguage !== "en" ? ` (${contentLanguage})` : "";
        const caption = `${brand.company_name}${lang}\n\nTransform your results with a professional ${mood} approach tailored for ${brand.company_type}.\n\n#${brand.company_name.replace(/\s+/g, "")} #${mood} #marketing`;

        return {
            headline,
            subtext,
            image_prompt,
            caption,
        };
    }

    private async generateCaptionOnly(params: GenerateParams, model: string): Promise<string | null> {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
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
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.6,
                        maxOutputTokens: 512,
                    },
                }),
            });

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
        const { brand, styleCatalog, referenceText, referenceImages, postMood, copyText, aspectRatio, useLogo, logoPosition, contentLanguage, contentType } = params;

        const brandStyle = styleCatalog.styles.find((item) => item.id === brand.mood);
        const selectedPostMood = styleCatalog.post_moods.find((item) => item.id === postMood);
        const brandStyleLabel = brandStyle?.label || brand.mood;
        const brandStyleDesc = brandStyle?.description ? ` (${brandStyle.description})` : "";
        const postMoodLabel = selectedPostMood?.label || postMood;
        const postMoodDesc = selectedPostMood?.description ? ` (${selectedPostMood.description})` : "";
        const isVideo = contentType === "video";

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
- Brand colors: Primary ${brand.color_1}, Secondary ${brand.color_2}, Accent ${brand.color_3}
- Brand style: ${brandStyleLabel}${brandStyleDesc}
${brand.logo_url ? `- Brand logo: The brand has a logo.` : ""}

The user wants a "${postMoodLabel}"${postMoodDesc} mood for this social media video.
${referenceText ? `User's visual direction: "${referenceText}"` : ""}
${referenceImages && referenceImages.length > 0 ? `The user has provided ${referenceImages.length} reference image(s). Analyze these images and incorporate their visual style, composition, color schemes, and design elements into the video.` : ""}
${useLogo && brand.logo_url ? `IMPORTANT: The user wants their brand logo visible in the video as a watermark/signature in the ${logoPosition ? LOGO_POSITION_DESCRIPTIONS[logoPosition] : "bottom-right corner"}. Describe the logo appearing as a subtle overlay or signature element in the video.` : ""}
Aspect ratio: ${aspectRatio}

Your task:
1. ${referenceImages && referenceImages.length > 0 ? "Analyze the provided reference images and extract key visual elements, styles, and composition patterns." : ""}
2. Write a highly descriptive, cinematic prompt for a video generation AI model (Google Veo). The prompt should describe:
   - The scene, subject, and action happening in the video
   - Camera movement (dolly, pan, tracking shot, close-up, wide shot, etc.)
   - Visual style matching the ${brandStyleLabel}${brandStyleDesc} brand aesthetic
   - The ${postMoodLabel}${postMoodDesc} mood and atmosphere
   - Lighting, color palette (using brand colors: ${brand.color_1}, ${brand.color_2}, ${brand.color_3})
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
- Brand colors: Primary ${brand.color_1}, Secondary ${brand.color_2}, Accent ${brand.color_3}
- Brand style: ${brandStyleLabel}${brandStyleDesc}
${brand.logo_url ? `- Brand logo URL: ${brand.logo_url}` : ""}

The user wants a "${postMoodLabel}"${postMoodDesc} post mood for this social media image.
${copyText ? `The text they want on the image is: "${copyText}"` : "Create engaging text for the image based on the brand context, industry, and post mood."}
${referenceText ? `User's visual direction: "${referenceText}"` : ""}
${referenceImages && referenceImages.length > 0 ? `The user has provided ${referenceImages.length} reference image(s). Analyze these images and incorporate their visual style, composition, color schemes, and design elements into your recommendations.` : ""}
${useLogo && brand.logo_url ? `IMPORTANT: A real logo file will be composited after generation. DO NOT draw or typeset a fake logo/name in the image. Keep the target corner visually clean for logo placement in the ${logoPosition ? LOGO_POSITION_DESCRIPTIONS[logoPosition] : "bottom-right corner"}.` : ""}
Aspect ratio: ${aspectRatio}

Your task:
1. ${referenceImages && referenceImages.length > 0 ? "First, analyze the provided reference images and extract key visual elements, styles, and composition patterns." : ""}
2. ${copyText ? `Analyze the provided text ("${copyText}") and split it into a short punchy "headline" (max 6 words) and a "subtext" (the supporting message).` : `Create a compelling headline (max 6 words) and subtext that promotes the brand ${brand.company_name} in the ${brand.company_type} industry, matching the ${postMoodLabel} mood.`}
3. Write a highly descriptive prompt for an image generation model that incorporates:
   - The brand colors (${brand.color_1}, ${brand.color_2}, ${brand.color_3})
   - The ${brandStyleLabel}${brandStyleDesc} brand style
   - The ${postMoodLabel}${postMoodDesc} post mood
   ${referenceImages && referenceImages.length > 0 ? "   - Visual style and elements from the reference images" : ""}
4. Write an engaging social media caption with relevant hashtags. IMPORTANT: Format the caption with proper paragraph breaks using newline characters (\\n\\n) between different ideas or sections. Each paragraph should be 1-2 sentences. Add hashtags at the end separated by a blank line.

CRITICAL: You MUST respond with ONLY valid JSON. Do not include any explanation, markdown formatting, or additional text. Your entire response must be parseable as JSON.

Response format (JSON only, no markdown):
{
  "headline": "string with max 6 words",
  "subtext": "string with supporting message",
  "image_prompt": "detailed image generation prompt",
  "caption": "engaging social media caption with \\n\\n paragraph breaks and hashtags"
}`;

        return contextPrompt;
    }

    /**
     * Generate text content (headline, subtext, image prompt, caption)
     */
    async generateText(params: GenerateParams): Promise<GeminiTextResponse> {
        if (!this.apiKey) {
            throw new Error("Gemini API key not configured");
        }

        const prompt = this.buildContextPrompt(params);
        const model = params.styleCatalog.ai_models?.text_generation || "gemini-2.5-flash";

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

        const parseGeminiJson = (text: string): GeminiTextResult => {
            // Strategy 1: Find JSON between curly braces
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as GeminiTextResult;
            }

            // Strategy 2: Try to extract JSON from markdown code blocks
            const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (codeBlockMatch) {
                return JSON.parse(codeBlockMatch[1]) as GeminiTextResult;
            }

            throw new Error("no_json_found");
        };

        const runTextCall = async (attempt: 1 | 2) => {
            const tightenedPrompt =
                attempt === 2
                    ? `${prompt}\n\nFINAL INSTRUCTION: Return ONLY valid JSON with keys headline, subtext, image_prompt, caption. No markdown, no commentary.`
                    : prompt;

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: tightenedPrompt }] }],
                    generationConfig: {
                        temperature: attempt === 1 ? 0.8 : 0.2,
                        maxOutputTokens: 2048,
                        responseMimeType: "application/json",
                    },
                }),
            });

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
                content = parseGeminiJson(text);
            } catch (parseError) {
                console.error("Gemini response (non-JSON):", { attempt, text });
                throw parseError;
            }

            return { content, usage };
        };

        try {
            const first = await runTextCall(1);
            return {
                content: first.content,
                usage: first.usage,
                model,
            };
        } catch (firstError: any) {
            try {
                const second = await runTextCall(2);
                return {
                    content: second.content,
                    usage: second.usage,
                    model,
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

    /**
     * Transcribe audio to text
     */
    async transcribeAudio(audioBase64: string, mimeType: string, model: string = "gemini-2.5-flash"): Promise<string> {
        if (!this.apiKey) {
            throw new Error("Gemini API key not configured");
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: "Transcribe this audio. Output only the transcribed text, no additional commentary." },
                            { inlineData: { mimeType, data: audioBase64 } }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 4096,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini transcription failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
}

/**
 * Create a Gemini service instance with the given API key
 */
export function createGeminiService(apiKey?: string): GeminiService {
    return new GeminiService(apiKey);
}
