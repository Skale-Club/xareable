/**
 * Image Generation Service
 * Handles AI image generation using Gemini
 */

// @ts-ignore - sharp ESM import
import sharp from "sharp";
import { toGeminiAspectRatio } from "./prompt-builder.service.js";

const GEMINI_SUPPORTED_IMAGE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
]);

async function normalizeInlineImageForGemini(params: {
    mimeType: string;
    data: string;
}): Promise<{ mimeType: string; data: string }> {
    const normalizedMimeType = params.mimeType.split(";")[0].trim().toLowerCase();

    if (GEMINI_SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
        return {
            mimeType: normalizedMimeType === "image/jpg" ? "image/jpeg" : normalizedMimeType,
            data: params.data,
        };
    }

    const sourceBuffer = Buffer.from(params.data, "base64");
    const convertedPng = await sharp(sourceBuffer, {
        density: normalizedMimeType === "image/svg+xml" ? 300 : undefined,
    })
        .png()
        .toBuffer();

    return {
        mimeType: "image/png",
        data: convertedPng.toString("base64"),
    };
}

export interface ImageGenerationParams {
    prompt: string;
    aspectRatio: string;
    resolution?: string;
    model?: string;
    apiKey: string;
    referenceImages?: Array<{ mimeType: string; data: string }>;
    logoImageData?: { mimeType: string; data: string } | null;
}

export interface ImageGenerationResult {
    buffer: Buffer;
    mimeType: string;
    model?: string;
    usage?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
    };
}

/**
 * Generate an image using Gemini
 */
export async function generateImage(
    params: ImageGenerationParams
): Promise<ImageGenerationResult> {
    const {
        prompt,
        aspectRatio,
        resolution = "1K",
        model = "gemini-3.1-flash-image-preview",
        apiKey,
        referenceImages = [],
        logoImageData,
    } = params;

    const geminiAspectRatio = toGeminiAspectRatio(aspectRatio);
    const imageModel = model;
    const geminiImageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`;
    const imageSize = resolution === "512px" ? "1K" : resolution;

    // Build request parts
    const imageRequestParts: any[] = [{ text: prompt }];

    // Add logo image first if available
    if (logoImageData) {
        const normalizedLogo = await normalizeInlineImageForGemini(logoImageData);
        imageRequestParts.push({
            inlineData: {
                mimeType: normalizedLogo.mimeType,
                data: normalizedLogo.data,
            },
        });
    }

    // Add reference images
    for (const img of referenceImages) {
        const normalizedReference = await normalizeInlineImageForGemini(img);
        imageRequestParts.push({
            inlineData: {
                mimeType: normalizedReference.mimeType,
                data: normalizedReference.data,
            },
        });
    }

    const imageResponse = await fetch(geminiImageUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
            contents: [{ parts: imageRequestParts }],
            generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                    aspectRatio: geminiAspectRatio,
                    imageSize,
                },
            },
        }),
    });

    if (!imageResponse.ok) {
        const errorData = await imageResponse.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to generate image";
        throw new Error(`Image Generation Error: ${errorMsg}`);
    }

    const imageData = await imageResponse.json();
    const usage = imageData.usageMetadata as
        | { promptTokenCount?: number; candidatesTokenCount?: number }
        | undefined;
    const candidates = imageData.candidates?.[0]?.content?.parts;

    if (!candidates) {
        throw new Error("No image generated. The model may not support image output.");
    }

    const imagePart = candidates.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("image/")
    );

    if (!imagePart?.inlineData?.data) {
        throw new Error(
            "No image was returned by the AI. Try a different prompt or check your API key permissions."
        );
    }

    return {
        buffer: Buffer.from(imagePart.inlineData.data, "base64"),
        mimeType: imagePart.inlineData.mimeType || "image/png",
        model: imageModel,
        usage,
    };
}

/**
 * Edit an existing image using Gemini
 */
export async function editImage(params: {
    prompt: string;
    currentImageBase64: string;
    currentImageMimeType: string;
    apiKey: string;
    logoImageData?: { mimeType: string; data: string } | null;
    model?: string;
}): Promise<ImageGenerationResult> {
    const {
        prompt,
        currentImageBase64,
        currentImageMimeType,
        apiKey,
        logoImageData,
        model = "gemini-3.1-flash-image-preview",
    } = params;

    const imageModel = model;
    const geminiImageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`;

    // Build parts: prompt + current image + logo (if available)
    const normalizedCurrentImage = await normalizeInlineImageForGemini({
        mimeType: currentImageMimeType,
        data: currentImageBase64,
    });

    const editParts: any[] = [
        { text: prompt },
        {
            inlineData: {
                mimeType: normalizedCurrentImage.mimeType,
                data: normalizedCurrentImage.data,
            },
        },
    ];

    if (logoImageData) {
        const normalizedLogo = await normalizeInlineImageForGemini(logoImageData);
        editParts.push({
            inlineData: {
                mimeType: normalizedLogo.mimeType,
                data: normalizedLogo.data,
            },
        });
    }

    const editResponse = await fetch(geminiImageUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
            contents: [{ parts: editParts }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
            },
        }),
    });

    if (!editResponse.ok) {
        const errorData = await editResponse.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to edit image";
        throw new Error(`Image Edit Error: ${errorMsg}`);
    }

    const editData = await editResponse.json();
    const usage = editData.usageMetadata as
        | { promptTokenCount?: number; candidatesTokenCount?: number }
        | undefined;
    const candidates = editData.candidates?.[0]?.content?.parts;

    if (!candidates) {
        throw new Error("No edited image generated");
    }

    const imagePart = candidates.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("image/")
    );

    if (!imagePart?.inlineData?.data) {
        throw new Error("No image was returned by the AI");
    }

    return {
        buffer: Buffer.from(imagePart.inlineData.data, "base64"),
        mimeType: imagePart.inlineData.mimeType || "image/png",
        model: imageModel,
        usage,
    };
}
