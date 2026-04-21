/**
 * Enhancement Service (v1.1, Phase 6)
 * Pre-screens raw uploads, strips EXIF + normalizes to 1:1 square, then runs
 * a scenery-composed edit call against gemini-3.1-flash-image-preview.
 * Owns: storage upload ({postId}-source.webp + {postId}.webp) + posts row write (D-16/D-17).
 * Does NOT own: route plumbing, SSE writer, credit deduction, idempotency lookup.
 */

import { randomUUID } from "node:crypto";
// @ts-ignore - sharp ESM
import sharp from "sharp";
import { createAdminSupabase } from "../supabase.js";
import { getStyleCatalogPayload } from "../routes/style-catalog.routes.js";
import type { Scenery, SupportedLanguage } from "../../shared/schema.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ── Locked English rejection copy (research Pattern 5 lines 217–222) ─────────

export const REJECTION_MESSAGES = {
    face_or_person:
        "Upload must be a product photo. Images containing people or faces are not supported.",
    screenshot_or_text_heavy:
        "Upload must be a product photo. Screenshots and documents are not supported.",
    explicit_content: "This image cannot be processed.",
    non_product:
        "Upload must show a physical product. Please upload a product photo.",
} as const;
export type RejectionCategory = keyof typeof REJECTION_MESSAGES;
export type PreScreenConfidence = "high" | "medium" | "low";

// ── Typed error hierarchy (D-14) ─────────────────────────────────────────────

export class PreScreenUnavailableError extends Error {
    constructor() {
        super(
            "We couldn't validate the image right now — please try again in a moment.",
        );
        this.name = "PreScreenUnavailableError";
    }
}

export class PreScreenRejectedError extends Error {
    constructor(
        public category: RejectionCategory,
        public confidence: PreScreenConfidence,
    ) {
        super(REJECTION_MESSAGES[category]);
        this.name = "PreScreenRejectedError";
    }
}

export class SceneryNotFoundError extends Error {
    constructor(id: string) {
        super(`Scenery preset not found: ${id}`);
        this.name = "SceneryNotFoundError";
    }
}

export class EnhancementGenerationError extends Error {
    constructor(msg: string, public cause?: unknown) {
        super(msg);
        this.name = "EnhancementGenerationError";
    }
}

export class EnhancementAbortedError extends Error {
    constructor(public stage: string) {
        super(`Enhancement aborted at stage: ${stage}`);
        this.name = "EnhancementAbortedError";
    }
}

// ── Params / progress / result contracts (D-15) ──────────────────────────────

export interface EnhancementParams {
    userId: string;
    apiKey: string;
    sceneryId: string;
    idempotencyKey: string;
    contentLanguage: SupportedLanguage;
    image: { mimeType: string; data: string }; // base64 + mimeType from the route
    signal?: AbortSignal;
    onProgress?: (event: EnhancementProgressEvent) => void;
}

export type EnhancementProgressEvent =
    | { type: "pre_screen_start" }
    | { type: "pre_screen_passed" }
    | { type: "pre_screen_rejected"; category: RejectionCategory }
    | { type: "normalize_start" }
    | { type: "normalize_complete" }
    | { type: "enhance_start" }
    | { type: "complete"; imageUrl: string; postId: string };

export interface EnhancementResult {
    postId: string;
    imageUrl: string; // result {postId}.webp public URL
    sourceImageUrl: string; // {postId}-source.webp public URL
    scenery: Scenery;
    tokenTotals: {
        textInputTokens: number; // pre-screen prompt tokens
        textOutputTokens: number; // pre-screen completion tokens
        imageInputTokens: number; // edit-call prompt tokens
        imageOutputTokens: number; // edit-call candidate tokens
    };
    textModel: string; // "gemini-2.5-flash"
    imageModel: string; // "gemini-3.1-flash-image-preview"
}

// ── Entrypoint stub (Task 2 will replace this) ───────────────────────────────

export async function enhanceProductPhoto(
    params: EnhancementParams,
): Promise<EnhancementResult> {
    void params;
    void TEXT_MODEL;
    void IMAGE_MODEL;
    void GEMINI_BASE;
    void sharp;
    void createAdminSupabase;
    void getStyleCatalogPayload;
    void randomUUID;
    throw new Error("not implemented yet");
}
