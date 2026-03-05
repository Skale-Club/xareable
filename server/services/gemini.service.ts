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

    /**
     * Build the context prompt for text generation
     */
    buildContextPrompt(params: GenerateParams): string {
        const { brand, styleCatalog, referenceText, referenceImages, postMood, copyText, aspectRatio, useLogo, logoPosition, contentLanguage } = params;

        const brandStyle = styleCatalog.styles.find((item) => item.id === brand.mood);
        const selectedPostMood = styleCatalog.post_moods.find((item) => item.id === postMood);
        const brandStyleLabel = brandStyle?.label || brand.mood;
        const brandStyleDesc = brandStyle?.description ? ` (${brandStyle.description})` : "";
        const postMoodLabel = selectedPostMood?.label || postMood;
        const postMoodDesc = selectedPostMood?.description ? ` (${selectedPostMood.description})` : "";

        const languageInstruction = contentLanguage !== "en"
            ? `\n\nCRITICAL: Generate ALL text content (headline, subtext, caption, and hashtags) in ${LANGUAGE_NAMES[contentLanguage]}. The image text must be in ${LANGUAGE_NAMES[contentLanguage]}.`
            : "";

        const contextPrompt = `You are an expert Art Director and Social Media Strategist.
${languageInstruction}

Context about the brand:
- Brand name: ${brand.company_name}
- Industry/Niche: ${brand.company_type}
- Brand colors: Primary ${brand.color_1}, Secondary ${brand.color_2}, Accent ${brand.color_3}
- Brand style: ${brandStyleLabel}${brandStyleDesc}
${brand.logo_url ? `- Brand logo URL: ${brand.logo_url}` : ""}

The user wants a "${postMoodLabel}"${postMoodDesc} post mood for this social media image.
${copyText ? `The text they want on the image is: "${copyText}"` : "Create an engaging text for the image based on the brand context."}
${referenceText ? `User's visual direction: "${referenceText}"` : ""}
${referenceImages && referenceImages.length > 0 ? `The user has provided ${referenceImages.length} reference image(s). Analyze these images and incorporate their visual style, composition, color schemes, and design elements into your recommendations.` : ""}
${useLogo && brand.logo_url ? `IMPORTANT: The user wants their brand logo included in the ${logoPosition ? LOGO_POSITION_DESCRIPTIONS[logoPosition] : "bottom-right corner"} of the image. Make sure to describe the logo placement in your image prompt.` : ""}
Aspect ratio: ${aspectRatio}

Your task:
1. ${referenceImages && referenceImages.length > 0 ? "First, analyze the provided reference images and extract key visual elements, styles, and composition patterns." : ""}
2. Analyze the text and split it into a short punchy "headline" (max 6 words) and a "subtext" (the supporting message).
3. Write a highly descriptive prompt for an image generation model that incorporates:
   - The brand colors (${brand.color_1}, ${brand.color_2}, ${brand.color_3})
   - The ${brandStyleLabel}${brandStyleDesc} brand style
   - The ${postMoodLabel}${postMoodDesc} post mood
   ${referenceImages && referenceImages.length > 0 ? "   - Visual style and elements from the reference images" : ""}
4. Write an engaging social media caption with relevant hashtags. IMPORTANT: Format the caption with proper paragraph breaks using newline characters (\\n\\n) between different ideas or sections. Each paragraph should be 1-2 sentences. Add hashtags at the end separated by a blank line.

Output JSON exactly like this (no markdown, just raw JSON):
{
  "headline": "...",
  "subtext": "...",
  "image_prompt": "...",
  "caption": "..."
}`;

        return contextPrompt;
    }

    /**
     * Generate text content (headline, subtext, image prompt, caption)
     */
    async generateText(params: GenerateParams): Promise<GeminiTextResult> {
        if (!this.apiKey) {
            throw new Error("Gemini API key not configured");
        }

        const prompt = this.buildContextPrompt(params);
        const model = params.styleCatalog.ai_models?.text_generation || "gemini-2.5-flash";

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.8,
                        maxOutputTokens: 2048,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini text generation failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Failed to parse JSON from Gemini response");
        }

        return JSON.parse(jsonMatch[0]) as GeminiTextResult;
    }

    /**
     * Generate image from prompt
     */
    async generateImage(imagePrompt: string, model: string = "gemini-3.1-flash-image-preview"): Promise<Buffer> {
        if (!this.apiKey) {
            throw new Error("Gemini API key not configured");
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: imagePrompt }] }],
                    generationConfig: {
                        responseModalities: ["IMAGE", "TEXT"],
                        responseMimeType: "image/png",
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini image generation failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        // Extract base64 image from response
        const imagePart = data.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);
        if (!imagePart?.inlineData?.data) {
            throw new Error("No image data in Gemini response");
        }

        return Buffer.from(imagePart.inlineData.data, "base64");
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
