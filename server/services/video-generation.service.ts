/**
 * Video Generation Service
 * Handles AI video generation using Gemini Veo 3.1
 * Docs: https://ai.google.dev/gemini-api/docs/video
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

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const VIDEO_MODEL = "veo-3.1-generate-preview";

/**
 * Generate a video using Gemini Veo 3.1 via predictLongRunning
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

    // Parse duration to integer (Veo supports 4, 6, or 8 seconds)
    const durationInt = parseInt(duration, 10);
    if (![4, 6, 8].includes(durationInt)) {
        throw new Error(`Invalid duration: ${duration}. Must be 4, 6, or 8 seconds.`);
    }

    // Build the instance object (prompt + optional images)
    const instance: Record<string, any> = {
        prompt,
    };

    // First reference image → starting frame (image-to-video)
    const firstRef = referenceImages[0] || null;
    if (firstRef) {
        instance.image = {
            inlineData: {
                mimeType: firstRef.mimeType,
                data: firstRef.data,
            },
        };
    }

    // Additional reference images → style/content context (up to 3 total)
    const additionalRefs = referenceImages.slice(1, 3);
    if (additionalRefs.length > 0) {
        instance.referenceImages = additionalRefs.map((img) => ({
            image: {
                inlineData: {
                    mimeType: img.mimeType,
                    data: img.data,
                },
            },
            referenceType: "asset",
        }));
    }

    // Build parameters object
    const parameters: Record<string, any> = {
        aspectRatio: videoAspectRatio,
        durationSeconds: durationInt,
    };

    // Only add resolution if not default 720p
    if (resolution && resolution !== "720p") {
        parameters.resolution = resolution;
    }

    // Build request body matching Veo 3.1 predictLongRunning API
    const requestBody = {
        instances: [instance],
        parameters,
    };
    const textOnlyRequestBody = {
        instances: [{ prompt }],
        parameters,
    };

    const generateUrl = `${BASE_URL}/models/${VIDEO_MODEL}:predictLongRunning`;

    async function startGeneration(body: Record<string, any>) {
        return fetch(generateUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(body),
        });
    }

    let startResponse = await startGeneration(requestBody);

    if (!startResponse.ok) {
        const rawErrorBody = await startResponse.text().catch(() => "");
        let parsedMessage = "";
        try {
            const parsed = JSON.parse(rawErrorBody);
            parsedMessage = parsed?.error?.message || "";
        } catch {
            parsedMessage = "";
        }
        const inlineDataUnsupported =
            startResponse.status === 400 &&
            /inlinedata\s+isn'?t supported/i.test(parsedMessage || rawErrorBody);

        // Some Veo deployments reject inline image inputs. Retry in text-only mode.
        if (inlineDataUnsupported && referenceImages.length > 0) {
            startResponse = await startGeneration(textOnlyRequestBody);
            if (startResponse.ok) {
                // continue with normal flow
            } else {
                const retryRawBody = await startResponse.text().catch(() => "");
                let retryParsedMessage = "";
                try {
                    const parsed = JSON.parse(retryRawBody);
                    retryParsedMessage = parsed?.error?.message || "";
                } catch {
                    retryParsedMessage = "";
                }
                const retryFallbackBody =
                    retryRawBody.trim().slice(0, 300) || startResponse.statusText || "Unknown error";
                const retryErrorMsg = retryParsedMessage || retryFallbackBody;
                throw new Error(
                    `Video Generation Error: ${startResponse.status} ${startResponse.statusText || ""} - ${retryErrorMsg}`.trim()
                );
            }
        } else {
            const fallbackBody =
                rawErrorBody.trim().slice(0, 300) || startResponse.statusText || "Unknown error";
            const errorMsg = parsedMessage || fallbackBody;
            throw new Error(
                `Video Generation Error: ${startResponse.status} ${startResponse.statusText || ""} - ${errorMsg}`.trim()
            );
        }
    }

    // Get operation from response (this is a long-running operation)
    let operationData = (await startResponse.json()) as any;
    const operationName = operationData?.name;
    if (!operationName) {
        throw new Error(
            "Video generation operation did not return a valid operation name."
        );
    }

    // Poll for operation completion
    const pollUrl = `${BASE_URL}/${operationName}`;
    const maxPolls = 90; // 6 minutes max (90 * 4s)
    const pollDelayMs = 4000;

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        if (operationData?.done) {
            break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollDelayMs));

        const pollResponse = await fetch(pollUrl, {
            headers: {
                "x-goog-api-key": apiKey,
            },
        });
        if (!pollResponse.ok) {
            const rawBody = await pollResponse.text().catch(() => "");
            let parsedMsg = "";
            try {
                const parsed = JSON.parse(rawBody);
                parsedMsg = parsed?.error?.message || "";
            } catch {
                parsedMsg = "";
            }
            const errMsg =
                parsedMsg ||
                rawBody.trim().slice(0, 300) ||
                pollResponse.statusText ||
                "Failed to check video generation status";
            throw new Error(
                `Video Generation Error: ${pollResponse.status} ${pollResponse.statusText || ""} - ${errMsg}`.trim()
            );
        }

        operationData = await pollResponse.json();
    }

    if (!operationData?.done) {
        throw new Error("Video generation timed out. Please try again.");
    }

    if (operationData?.error) {
        const errMsg =
            operationData.error.message || JSON.stringify(operationData.error);
        throw new Error(`Video Generation Error: ${errMsg}`);
    }

    // Extract video URI from completed operation
    // Docs path: response.generateVideoResponse.generatedSamples[0].video.uri
    const videoUri =
        operationData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
        operationData?.response?.generatedVideos?.[0]?.video?.uri;

    if (!videoUri) {
        console.error(
            "Video operation completed but no URI found. Response:",
            JSON.stringify(operationData, null, 2)
        );
        throw new Error("No video was returned by the AI model.");
    }

    // Download the generated video file
    const videoFileResponse = await fetch(videoUri, {
        headers: {
            "x-goog-api-key": apiKey,
        },
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
