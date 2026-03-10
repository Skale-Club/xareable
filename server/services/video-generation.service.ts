/**
 * Video Generation Service
 * Handles AI video generation using Gemini Veo
 */

export interface VideoGenerationParams {
    prompt: string;
    aspectRatio: string;
    duration?: string;
    resolution?: string;
    apiKey: string;
    referenceImages?: Array<{ mimeType: string; data: string }>;
}

export interface VideoGenerationResult {
    buffer: Buffer;
    mimeType: string;
}

/**
 * Generate a video using Gemini Veo
 */
export async function generateVideo(
    params: VideoGenerationParams
): Promise<VideoGenerationResult> {
    const {
        prompt,
        aspectRatio,
        duration = "8",
        resolution = "720p",
        apiKey,
        referenceImages = [],
    } = params;

    // Map aspect ratio to Veo-supported values
    const videoAspectRatio = aspectRatio === "9:16" ? "9:16" : "16:9";
    const videoModel = "veo-3.1-generate-preview";
    const generateVideoUrl = `https://generativelanguage.googleapis.com/v1beta/models/${videoModel}:generateVideos`;

    const firstVideoRef = referenceImages[0] || null;
    const additionalVideoRefs = referenceImages.slice(1, 3); // Veo supports up to 3 reference images total

    // Build request body matching Gemini API documentation
    const videoRequestBody: Record<string, unknown> = {
        prompt,
    };

    // Build config object
    const videoConfig: Record<string, any> = {
        aspectRatio: videoAspectRatio,
        durationSeconds: duration,
        resolution,
    };

    // First reference image → starting frame (image-to-video)
    if (firstVideoRef) {
        videoRequestBody.image = {
            imageBytes: firstVideoRef.data,
            mimeType: firstVideoRef.mimeType,
        };
    }

    // Add additional reference images for style/content context (Veo 3.1 feature)
    if (additionalVideoRefs.length > 0) {
        videoConfig.referenceImages = additionalVideoRefs.map((img) => ({
            image: {
                imageBytes: img.data,
                mimeType: img.mimeType,
            },
            referenceType: "asset",
        }));
    }

    videoRequestBody.config = videoConfig;

    const startVideoResponse = await fetch(generateVideoUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(videoRequestBody),
    });

    if (!startVideoResponse.ok) {
        const errorData = await startVideoResponse.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to start video generation";
        throw new Error(`Video Generation Error: ${errorMsg}`);
    }

    // Get operation from response (this is a long-running operation)
    let operationData = (await startVideoResponse.json()) as any;
    const operationName = operationData?.name;
    if (!operationName) {
        throw new Error(
            "Video generation operation did not return a valid operation name."
        );
    }

    // Poll for operation completion
    const getOperationUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}`;
    const maxPolls = 90; // 6 minutes max (90 * 4s)
    const pollDelayMs = 4000;

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        if (operationData?.done) {
            break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollDelayMs));

        const operationResponse = await fetch(getOperationUrl, {
            headers: { "x-goog-api-key": apiKey },
        });
        if (!operationResponse.ok) {
            const operationErr = await operationResponse.json().catch(() => null);
            const operationErrMsg =
                operationErr?.error?.message || "Failed to check video generation status";
            throw new Error(`Video Generation Error: ${operationErrMsg}`);
        }

        operationData = await operationResponse.json();
    }

    if (!operationData?.done) {
        throw new Error("Video generation timed out. Please try again.");
    }

    if (operationData?.error) {
        const errMsg =
            operationData.error.message || JSON.stringify(operationData.error);
        throw new Error(`Video Generation Error: ${errMsg}`);
    }

    // Extract video URI from response - try multiple possible paths based on API response structure
    const videoUri =
        operationData?.response?.generatedVideos?.[0]?.video?.uri ||
        operationData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video
            ?.uri;

    if (!videoUri) {
        console.error(
            "Video operation completed but no URI found. Response:",
            JSON.stringify(operationData, null, 2)
        );
        throw new Error("No video was returned by the AI model.");
    }

    // Download the generated video file
    const videoFileResponse = await fetch(videoUri, {
        headers: { "x-goog-api-key": apiKey },
    });
    if (!videoFileResponse.ok) {
        const errText = await videoFileResponse.text().catch(() => "");
        console.error("Video download error:", errText);
        throw new Error("Video generated, but downloading the file failed.");
    }

    return {
        buffer: Buffer.from(await videoFileResponse.arrayBuffer()),
        mimeType: "video/mp4",
    };
}
