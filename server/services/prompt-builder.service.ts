/**
 * Prompt Builder Service
 * Handles building prompts for AI image and video generation
 */

/**
 * Download an image from its public URL and return it as base64 data.
 * Used to pass images to AI models.
 */
export async function downloadImageAsBase64(
    imageUrl: string
): Promise<{ mimeType: string; data: string } | null> {
    try {
        const response = await fetch(imageUrl);
        if (!response.ok) return null;

        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const contentType = response.headers.get("content-type") || "image/png";
        // Normalize mimeType — strip charset/params if present
        const mimeType = contentType.split(";")[0].trim();

        return { mimeType, data: base64 };
    } catch (error) {
        console.error("Failed to download image:", error);
        return null;
    }
}

/**
 * Convert a structured JSON image prompt (from the text model) into a flat text prompt
 * suitable for the Gemini image generation model.
 */
export function buildImagePromptFromStructuredJson(promptObj: any): string {
    const parts: string[] = [];

    if (promptObj.subject) {
        parts.push(promptObj.subject);
    }

    if (promptObj.composition) {
        const comp = promptObj.composition;
        const compParts = [
            comp.layout,
            comp.framing,
            comp.focal_point,
            comp.camera_angle,
            comp.depth_of_field,
        ].filter(Boolean);
        if (compParts.length) parts.push(`Composition: ${compParts.join(", ")}`);
    }

    if (promptObj.visual_style) {
        const vs = promptObj.visual_style;
        const vsParts = [vs.type, vs.mood].filter(Boolean);
        if (vsParts.length) parts.push(`Style: ${vsParts.join(", ")}`);
        if (vs.lighting) {
            const lParts = [
                vs.lighting.type,
                vs.lighting.direction,
                vs.lighting.quality,
            ].filter(Boolean);
            if (lParts.length) parts.push(`Lighting: ${lParts.join(", ")}`);
        }
    }

    if (promptObj.color_specification) {
        const cs = promptObj.color_specification;
        if (cs.palette && Array.isArray(cs.palette)) {
            parts.push(`Color palette: ${cs.palette.join(", ")}`);
        }
        if (cs.dominant_color) parts.push(`Dominant color: ${cs.dominant_color}`);
        if (cs.color_harmony) parts.push(`Color harmony: ${cs.color_harmony}`);
    }

    if (
        promptObj.required_elements &&
        Array.isArray(promptObj.required_elements) &&
        promptObj.required_elements.length > 0
    ) {
        parts.push(`MUST INCLUDE these elements: ${promptObj.required_elements.join(", ")}`);
    }

    if (promptObj.text_rendering) {
        const tr = promptObj.text_rendering;
        if (tr.headline_text)
            parts.push(`Render this headline text prominently: "${tr.headline_text}"`);
        if (tr.subtext_text) parts.push(`Render this subtext: "${tr.subtext_text}"`);
        const trStyle = [
            tr.typography_style,
            tr.text_placement,
            tr.readability,
            tr.text_contrast,
        ].filter(Boolean);
        if (trStyle.length) parts.push(`Typography: ${trStyle.join(", ")}`);
    }

    if (promptObj.logo_integration) {
        const li = promptObj.logo_integration;
        const liParts = [
            li.position ? `position: ${li.position}` : null,
            li.size ? `size: ${li.size}` : null,
            li.treatment || li.integration_style,
        ].filter(Boolean);
        if (liParts.length) parts.push(`Logo placement: ${liParts.join(", ")}`);
    }

    if (promptObj.aspect_ratio) {
        parts.push(`Aspect ratio: ${promptObj.aspect_ratio}`);
    }

    if (promptObj.negative_prompt) {
        parts.push(`AVOID: ${promptObj.negative_prompt}`);
    }

    return parts.join(". ") + ".";
}

/**
 * Convert a structured JSON video prompt into a flat text prompt suitable for Veo.
 */
export function buildVideoPromptFromStructuredJson(
    videoObj: any,
    brandName: string
): string {
    const parts: string[] = [];

    if (videoObj.shot_sequence && Array.isArray(videoObj.shot_sequence)) {
        for (const shot of videoObj.shot_sequence) {
            const shotParts = [
                shot.timing,
                shot.action,
                shot.camera_movement,
                shot.subject_action,
            ].filter(Boolean);
            parts.push(shotParts.join(" — "));
        }
    }

    if (videoObj.visual_atmosphere) {
        parts.push(`Atmosphere: ${videoObj.visual_atmosphere}`);
    }

    if (videoObj.motion_quality) {
        parts.push(`Motion: ${videoObj.motion_quality}`);
    }

    if (videoObj.brand_integration) {
        parts.push(`Brand integration for ${brandName}: ${videoObj.brand_integration}`);
    }

    if (videoObj.audio_cues) {
        const ac = videoObj.audio_cues;
        if (ac.dialogue && Array.isArray(ac.dialogue) && ac.dialogue.length) {
            parts.push(`Dialogue: ${ac.dialogue.join(", ")}`);
        }
        if (
            ac.sound_effects &&
            Array.isArray(ac.sound_effects) &&
            ac.sound_effects.length
        ) {
            parts.push(`SFX: ${ac.sound_effects.join(", ")}`);
        }
        if (ac.ambient) {
            parts.push(`Ambient audio: ${ac.ambient}`);
        }
    }

    return parts.join(". ") + ".";
}

/**
 * Logo position descriptions for prompts
 */
export const LOGO_POSITION_DESCRIPTIONS: Record<string, string> = {
    "top-left": "top-left corner",
    "top-center": "top center",
    "top-right": "top-right corner",
    "middle-left": "middle-left side",
    "middle-center": "center of the image",
    "middle-right": "middle-right side",
    "bottom-left": "bottom-left corner",
    "bottom-center": "bottom center",
    "bottom-right": "bottom-right corner",
};

/**
 * Language names for prompts
 */
export const LANGUAGE_NAMES: Record<string, string> = {
    en: "English",
    pt: "Brazilian Portuguese (pt-BR)",
    es: "Spanish (es)",
};

/**
 * Aspect ratio to dimensions mapping
 */
export const ASPECT_RATIO_DIMENSIONS: Record<
    string,
    { width: number; height: number }
> = {
    "1:1": { width: 1024, height: 1024 },
    "4:5": { width: 1024, height: 1280 },
    "9:16": { width: 720, height: 1280 },
    "16:9": { width: 1280, height: 720 },
    "2:3": { width: 1024, height: 1536 },
    "1200:628": { width: 1200, height: 628 },
};

/**
 * Get dimensions for an aspect ratio
 */
export function getDimensionsForAspectRatio(aspectRatio: string): {
    width: number;
    height: number;
} {
    return ASPECT_RATIO_DIMENSIONS[aspectRatio] || { width: 1024, height: 1024 };
}

/**
 * Convert aspect ratio to Gemini API compatible value
 */
export function toGeminiAspectRatio(aspectRatio: string): string {
    return aspectRatio === "1200:628" ? "16:9" : aspectRatio;
}
