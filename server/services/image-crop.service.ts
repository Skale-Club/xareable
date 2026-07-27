/**
 * Image Crop Service
 *
 * Phase 23 (POL-04). The image model's returned frame is normalized to the
 * EXACT requested aspect ratio by a deterministic center-crop before
 * typography and logo compositing run. Ratios are parsed generically from
 * the 'W:H' string — deliberately NOT looked up in the incomplete 6-of-15
 * aspect-ratio dimension table that lives in prompt-builder.service.ts
 * (23-RESEARCH.md Pitfall 9).
 */

// @ts-ignore - sharp ESM import
import sharp from "sharp";

/**
 * Tolerance (as an absolute difference in width/height ratio) within which
 * an image is considered "already at the requested aspect ratio" and is
 * returned unchanged rather than re-encoded.
 */
export const ASPECT_RATIO_TOLERANCE = 0.005;

/**
 * Parse a "W:H" aspect ratio string into its numeric components.
 *
 * Never throws — returns `null` for anything that isn't exactly two
 * finite, positive numbers separated by a single colon.
 */
export function parseAspectRatio(
    aspectRatio: string
): { w: number; h: number } | null {
    if (typeof aspectRatio !== "string") return null;

    const parts = aspectRatio.split(":");
    if (parts.length !== 2) return null;

    const w = Number(parts[0]);
    const h = Number(parts[1]);

    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    if (w <= 0 || h <= 0) return null;

    return { w, h };
}

/**
 * Crop a buffer to exactly match the requested "W:H" aspect ratio via a
 * deterministic center-crop.
 *
 * Extreme ratios (`1:8`, `8:1`, `4:1`, `1:4`, `21:9`) may discard a large
 * share of the generated frame — the negative-space prompt instruction
 * (plan 23-05) accounts for a larger crop margin on those ratios
 * (23-RESEARCH.md Open Question 3).
 *
 * Never throws: on any parse failure, unreadable metadata, or sharp error,
 * the original buffer is returned unchanged. A crop failure must never
 * break a generation.
 */
export async function cropToExactAspectRatio(
    buffer: Buffer,
    aspectRatio: string
): Promise<Buffer> {
    const parsed = parseAspectRatio(aspectRatio);
    if (!parsed) return buffer;

    try {
        const image = sharp(buffer);
        const { width = 0, height = 0 } = await image.metadata();
        if (!width || !height) return buffer;

        const target = parsed.w / parsed.h;
        const current = width / height;

        if (Math.abs(current - target) <= ASPECT_RATIO_TOLERANCE) {
            // Already at the requested ratio — avoid a needless lossy
            // re-encode before the compositor runs.
            return buffer;
        }

        let cropWidth: number;
        let cropHeight: number;

        if (current > target) {
            // Source is too wide relative to target — crop width.
            cropWidth = Math.max(1, Math.round(height * target));
            cropHeight = height;
        } else {
            // Source is too tall relative to target — crop height.
            cropWidth = width;
            cropHeight = Math.max(1, Math.round(width / target));
        }

        cropWidth = Math.min(cropWidth, width);
        cropHeight = Math.min(cropHeight, height);

        const left = Math.max(0, Math.round((width - cropWidth) / 2));
        const top = Math.max(0, Math.round((height - cropHeight) / 2));

        // Explicit .png() — the compositor consumes this buffer next and
        // must not receive a lossy intermediate. The final WebP pass
        // happens once, later, in processImageWithThumbnail.
        return await image
            .extract({ left, top, width: cropWidth, height: cropHeight })
            .png()
            .toBuffer();
    } catch (err) {
        console.warn("[image-crop] crop failed, returning original:", err);
        return buffer;
    }
}

/**
 * Measure the width/height/ratio of an image buffer. Returns `null` on
 * unreadable metadata (never throws).
 */
export async function measureAspectRatio(
    buffer: Buffer
): Promise<{ width: number; height: number; ratio: number } | null> {
    try {
        const { width = 0, height = 0 } = await sharp(buffer).metadata();
        if (!width || !height) return null;
        return { width, height, ratio: width / height };
    } catch {
        return null;
    }
}
