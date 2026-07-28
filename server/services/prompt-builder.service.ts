/**
 * Prompt Builder Service
 * Handles building prompts for AI image and video generation
 */

// @ts-ignore - sharp ESM import
import sharp from "sharp";

const GEMINI_SUPPORTED_IMAGE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
]);

export async function normalizeImageForGeminiInput(params: {
    buffer: Buffer;
    mimeType: string;
}): Promise<{ mimeType: string; data: string }> {
    const normalizedMimeType = params.mimeType.split(";")[0].trim().toLowerCase();

    if (GEMINI_SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
        return {
            mimeType: normalizedMimeType === "image/jpg" ? "image/jpeg" : normalizedMimeType,
            data: params.buffer.toString("base64"),
        };
    }

    const pngBuffer = await sharp(params.buffer, {
        density: normalizedMimeType === "image/svg+xml" ? 300 : undefined,
    })
        .png()
        .toBuffer();

    return {
        mimeType: "image/png",
        data: pngBuffer.toString("base64"),
    };
}

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
 * FALLBACK-ONLY (Phase 22, PLAN-04). Mechanical flattening of a structured JSON image
 * prompt into a flat text prompt.
 *
 * This is NO LONGER the source of the image prompt. Under strict json_schema mode the
 * planning model emits a required, dense natural-language `image_prompt` and that field
 * wins by construction: normalizeGeminiTextResult only invokes this flattening when the
 * model produced no prompt at all (the transport-failure local-template path). Do NOT
 * reintroduce it as a primary or `||`-preferred path — its label-fragment output
 * ("Composition: ..., Lighting: ...") is exactly the mechanical concatenation PLAN-04
 * removes. Its function body is intentionally unchanged.
 *
 * Phase 23 (TYPO-01): the legacy structured-prompt typography sub-object's flattening
 * branch was removed entirely — this function must never emit text-rendering direction.
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

interface BrandColorFields {
    color_1?: string | null;
    color_2?: string | null;
    color_3?: string | null;
    color_4?: string | null;
}

/**
 * Join the brand's configured colors (1-4) into a prompt-safe list.
 * color_3/color_4 are nullable — skipping empty slots prevents a literal
 * "null" from leaking into AI prompts.
 */
export function formatBrandColors(brand: BrandColorFields): string {
    return [brand.color_1, brand.color_2, brand.color_3, brand.color_4]
        .filter((color): color is string => Boolean(color && color.trim()))
        .join(", ");
}

/**
 * Same as formatBrandColors but with role labels (Primary/Secondary/Accent),
 * for prompts that describe the palette hierarchy.
 */
export function formatBrandColorsLabeled(brand: BrandColorFields): string {
    const labels = ["Primary", "Secondary", "Accent", "Accent 2"];
    return [brand.color_1, brand.color_2, brand.color_3, brand.color_4]
        .map((color, index) => (color && color.trim() ? `${labels[index]} ${color}` : null))
        .filter(Boolean)
        .join(", ");
}

// ── Phase 25 (PLAN-06) — 60-30-10 proportional color injection ─────────────

/** Coarse hue-band vocabulary used by approximateColorName. Upper-bound
 *  thresholds in degrees; the first band whose threshold exceeds the hue wins. */
const HUE_NAME_BANDS: Array<[number, string]> = [
    [15, "red"],
    [40, "orange"],
    [55, "amber"],
    [65, "yellow"],
    [90, "lime"],
    [150, "green"],
    [180, "teal"],
    [200, "cyan"],
    [250, "blue"],
    [265, "indigo"],
    [290, "violet"],
    [320, "magenta"],
    [345, "pink"],
    [360, "red"],
];

function nameForHue(hueDegrees: number): string {
    for (const [maxHue, name] of HUE_NAME_BANDS) {
        if (hueDegrees < maxHue) return name;
    }
    return "red";
}

/** Coarse plain-English name for a hex color. AI image models respond far
 *  better to descriptive color names than to raw hex codes (25-RESEARCH.md
 *  State of the Art), so every injected hex is paired with one. Never throws —
 *  unparseable input degrades to the generic word "colour". */
export function approximateColorName(hex: string): string {
    try {
        if (!hex || typeof hex !== "string") return "colour";

        let clean = hex.trim().replace(/^#/, "");
        if (clean.length === 3) {
            clean = clean.split("").map((ch) => ch + ch).join("");
        }
        if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "colour";

        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lightness = (max + min) / 2;
        const delta = max - min;
        const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

        let hue = 0;
        if (delta !== 0) {
            if (max === r) hue = 60 * (((g - b) / delta) % 6);
            else if (max === g) hue = 60 * ((b - r) / delta + 2);
            else hue = 60 * ((r - g) / delta + 4);
        }
        if (hue < 0) hue += 360;

        if (Number.isNaN(lightness) || Number.isNaN(saturation) || Number.isNaN(hue)) {
            return "colour";
        }

        // Near-neutral (grey/black/white) bands, independent of hue.
        if (saturation < 0.12) {
            if (lightness < 0.12) return "near-black";
            if (lightness > 0.92) return "white";
            if (lightness > 0.8) return "off-white";
            const isWarm = hue < 60 || hue >= 300;
            if (lightness < 0.35) return "charcoal";
            return isWarm ? "warm grey" : "cool grey";
        }

        const hueName = nameForHue(hue);
        if (lightness < 0.15) return "near-black";
        if (lightness < 0.3) return `deep ${hueName}`;
        if (lightness > 0.92) return "off-white";
        if (lightness > 0.78) return `pale ${hueName}`;
        if (lightness > 0.62) return `soft ${hueName}`;
        return hueName;
    } catch {
        return "colour";
    }
}

/**
 * Phase 25 (PLAN-06). Expresses the brand palette as a 60-30-10 design rule
 * instead of a flat join. Locked mapping (25-CONTEXT.md): color_1 = 60%
 * dominant, color_2 = 30% secondary, color_4 = 10% accent. color_3 is
 * deliberately OUTSIDE the split; when present (and not needed to fill an
 * absent accent slot) it is mentioned by name as a supporting/tertiary tone.
 *
 * Degrades gracefully — color_3/color_4 are nullable in brandSchema:
 * - accent slot = color_4 when present, else color_3 is promoted into it,
 *   else the accent clause (and any tertiary mention) is omitted entirely.
 * - color_2 absent → only the dominant-color statement is returned.
 * - never emits the literal "null", "undefined", "NaN", or an empty "()".
 */
export function formatBrandColorsProportional(brand: BrandColorFields): string {
    const color1 = brand.color_1 && brand.color_1.trim() ? brand.color_1.trim() : null;
    const color2 = brand.color_2 && brand.color_2.trim() ? brand.color_2.trim() : null;
    const color3 = brand.color_3 && brand.color_3.trim() ? brand.color_3.trim() : null;
    const color4 = brand.color_4 && brand.color_4.trim() ? brand.color_4.trim() : null;

    if (!color1) return "";

    const dominantClause = `60% ${approximateColorName(color1)} (${color1}) as the dominant field tone`;

    if (!color2) {
        return `Apply a 60-30-10 color balance: ${dominantClause}.`;
    }

    const secondaryClause = `30% ${approximateColorName(color2)} (${color2}) as the supporting secondary tone`;

    // Accent slot: color_4 (the locked 10% accent) when present, else color_3
    // is promoted into the accent role. color_3 is never both the accent AND
    // the trailing tertiary mention.
    const accentColor = color4 || color3;
    const accentIsColor4 = Boolean(color4);
    const tertiaryColor = accentIsColor4 ? color3 : null;

    if (!accentColor) {
        return `Apply a 60-30-10 color balance: ${dominantClause}, and ${secondaryClause}.`;
    }

    const accentClause = `10% ${approximateColorName(accentColor)} (${accentColor}) reserved for the sharpest accent details`;
    const base = `Apply a 60-30-10 color balance: ${dominantClause}, ${secondaryClause}, and ${accentClause}.`;

    if (!tertiaryColor) return base;

    return `${base} ${approximateColorName(tertiaryColor)} may also appear sparingly as a tertiary supporting tone.`;
}
