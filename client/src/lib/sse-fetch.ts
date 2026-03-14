/**
 * SSE consumer for POST requests.
 * Browser EventSource only supports GET, so we use fetch() + ReadableStream.
 */

import { getAuthHeaders } from "./queryClient";

export interface SSEProgressEvent {
    phase: string;
    message: string;
    progress: number;
}

export interface SSECallbacks {
    onProgress?: (event: SSEProgressEvent) => void;
    onComplete?: (data: any) => void;
    onError?: (error: { message: string; error?: string; statusCode?: number; [key: string]: unknown }) => void;
}

/**
 * Send a POST request and consume the response as an SSE stream.
 *
 * If the server returns a non-SSE response (early JSON errors like auth/validation/credits),
 * the error is parsed from JSON and thrown.
 */
export async function fetchSSE(
    url: string,
    body: unknown,
    callbacks: SSECallbacks,
    signal?: AbortSignal,
): Promise<void> {
    const authHeaders = await getAuthHeaders();

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...authHeaders,
        },
        body: JSON.stringify(body),
        credentials: "include",
        signal,
    });

    // Non-SSE response → early JSON error (auth, validation, credits)
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
        const text = await response.text();
        let parsed: any;
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = { message: text };
        }

        const errorMessage = parsed?.message || parsed?.error || `${response.status}: ${text}`;
        const errorObj = {
            message: errorMessage,
            error: parsed?.error,
            statusCode: response.status,
            ...parsed,
        };
        callbacks.onError?.(errorObj);
        throw new Error(errorMessage);
    }

    // Read SSE stream
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE messages (delimited by double newline)
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || "";

        for (const msg of messages) {
            const trimmed = msg.trim();
            if (!trimmed || trimmed.startsWith(":")) continue; // Skip heartbeats/comments

            let eventType = "";
            let eventData = "";

            for (const line of trimmed.split("\n")) {
                if (line.startsWith("event: ")) {
                    eventType = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                    eventData += line.slice(6);
                }
            }

            if (!eventType || !eventData) continue;

            try {
                const parsed = JSON.parse(eventData);
                switch (eventType) {
                    case "progress":
                        callbacks.onProgress?.(parsed);
                        break;
                    case "complete":
                        callbacks.onComplete?.(parsed);
                        return;
                    case "error":
                        callbacks.onError?.(parsed);
                        throw new Error(parsed.message || "Generation failed");
                }
            } catch (e) {
                if (e instanceof Error && e.message !== "Generation failed" && !e.message.startsWith("Generation")) {
                    console.warn("SSE parse error:", e);
                } else {
                    throw e;
                }
            }
        }
    }
}
