/**
 * Image Generation Service
 * Handles AI image generation using Gemini
 */

import { toGeminiAspectRatio, getDimensionsForAspectRatio } from "./prompt-builder.service.js";

export interface ImageGenerationParams {
    prompt: string;
    aspectRatio: string;
    resolution?: string;
    apiKey: string;
    referenceImages?: Array<{ mimeType: string; data: string }>;
    logoImageData?: { mimeType: string; data: string } | null;
}

export interface ImageGenerationResult {
    buffer: Buffer;
    mimeType: string;
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
        apiKey,
        referenceImages = [],
        logoImageData,
    } = params;

    const geminiAspectRatio = toGeminiAspectRatio(aspectRatio);
    const imageModel = "gemini-3.1-flash-image-preview";
    const geminiImageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`;

    // Build request parts
    const imageRequestParts: any[] = [{ text: prompt }];

    // Add logo image first if available
    if (logoImageData) {
        imageRequestParts.push({
            inlineData: {
                mimeType: logoImageData.mimeType,
                data: logoImageData.data,
            },
        });
    }

    // Add reference images
    for (const img of referenceImages) {
        imageRequestParts.push({
            inlineData: { mimeType: img.mimeType, data: img.data },
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
                image_config: {
                    aspect_ratio: geminiAspectRatio,
                    image_size: resolution,
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
}): Promise<ImageGenerationResult> {
    const {
        prompt,
        currentImageBase64,
        currentImageMimeType,
        apiKey,
        logoImageData,
    } = params;

    const imageModel = "gemini-3.1-flash-image-preview";
    const geminiImageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`;

    // Build parts: prompt + current image + logo (if available)
    const editParts: any[] = [
        { text: prompt },
        { inlineData: { mimeType: currentImageMimeType, data: currentImageBase64 } },
    ];

    if (logoImageData) {
        editParts.push({
            inlineData: {
                mimeType: logoImageData.mimeType,
                data: logoImageData.data,
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
        usage,
    };
}
