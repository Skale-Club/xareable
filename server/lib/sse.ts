/**
 * Server-Sent Events (SSE) helper.
 * Keeps Vercel serverless functions alive by streaming progress events
 * instead of buffering the entire response.
 */

import type { Response } from "express";

export interface SSEWriter {
    sendProgress(phase: string, message: string, progress: number): void;
    sendComplete(data: unknown): void;
    sendError(params: { message: string; error?: string; statusCode?: number; [key: string]: unknown }): void;
    startHeartbeat(intervalMs?: number): void;
    stopHeartbeat(): void;
    isClosed(): boolean;
}

export function initSSE(res: Response): SSEWriter {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    let closed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    res.on("close", () => {
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
    });

    function write(event: string, data: unknown): void {
        if (closed) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    return {
        sendProgress(phase, message, progress) {
            write("progress", { phase, message, progress });
        },
        sendComplete(data) {
            write("complete", data);
            if (!closed) res.end();
            closed = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
        },
        sendError(params) {
            write("error", params);
            if (!closed) res.end();
            closed = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
        },
        startHeartbeat(intervalMs = 10_000) {
            heartbeatTimer = setInterval(() => {
                if (closed) {
                    if (heartbeatTimer) clearInterval(heartbeatTimer);
                    return;
                }
                res.write(":\n\n");
            }, intervalMs);
        },
        stopHeartbeat() {
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
        },
        isClosed() {
            return closed;
        },
    };
}
