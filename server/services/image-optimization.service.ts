/**
 * Image Optimization Service
 * Handles image compression and thumbnail generation using sharp
 * Reduces storage costs by ~70-80% through WebP conversion
 */

// @ts-ignore - sharp ESM import
import sharp from 'sharp';

// Phase 26 (POL-03): reuse Phase 23's region-contrast sampler for the
// adaptive logo overlay instead of reimplementing luminance/stdev analysis.
import { analyzeRegionContrast, type RegionContrast } from './typography-compositor.service.js';

export interface OptimizedImage {
    buffer: Buffer;
    mimeType: string;
    width: number;
    height: number;
    sizeBytes: number;
}

export interface ThumbnailOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
}

const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions = {
    maxWidth: 400,
    maxHeight: 400,
    quality: 70,
};

// Phase 26 (POL-02): 80 -> 85. Text is now composited server-side (Phase 23),
// so glyph-edge fidelity matters more than the marginal storage saving.
// Guarded by scripts/verify-webp-text-edge.ts.
const DEFAULT_IMAGE_QUALITY = 85;

/**
 * Optimize an image buffer to WebP format
 * @param inputBuffer - Raw image buffer (PNG, JPEG, etc.)
 * @param quality - WebP quality (1-100), default 85
 * @returns Optimized image with metadata
 */
export async function optimizeImage(
    inputBuffer: Buffer,
    quality: number = DEFAULT_IMAGE_QUALITY
): Promise<OptimizedImage> {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    const optimizedBuffer = await image
        .webp({ quality, effort: 4 })
        .toBuffer();

    return {
        buffer: optimizedBuffer,
        mimeType: 'image/webp',
        width: metadata.width || 0,
        height: metadata.height || 0,
        sizeBytes: optimizedBuffer.length,
    };
}

/**
 * Generate a thumbnail from an image buffer
 * @param inputBuffer - Raw image buffer
 * @param options - Thumbnail dimensions and quality
 * @returns Thumbnail image with metadata
 */
export async function generateThumbnail(
    inputBuffer: Buffer,
    options: ThumbnailOptions = {}
): Promise<OptimizedImage> {
    const { maxWidth = 400, maxHeight = 400, quality = 70 } = options;

    const thumbnail = sharp(inputBuffer);
    const metadata = await thumbnail.metadata();

    const resizedBuffer = await thumbnail
        .resize(maxWidth, maxHeight, {
            fit: 'inside',
            withoutEnlargement: true,
        })
        .webp({ quality, effort: 4 })
        .toBuffer();

    // Calculate actual dimensions after resize
    const resizedMetadata = await sharp(resizedBuffer).metadata();

    return {
        buffer: resizedBuffer,
        mimeType: 'image/webp',
        width: resizedMetadata.width || Math.min(metadata.width || maxWidth, maxWidth),
        height: resizedMetadata.height || Math.min(metadata.height || maxHeight, maxHeight),
        sizeBytes: resizedBuffer.length,
    };
}

/**
 * Optimize and generate thumbnail in parallel
 * @param inputBuffer - Raw image buffer
 * @param imageQuality - Quality for main image (1-100)
 * @param thumbnailOptions - Thumbnail settings
 * @returns Both optimized image and thumbnail
 */
export async function processImageWithThumbnail(
    inputBuffer: Buffer,
    imageQuality: number = DEFAULT_IMAGE_QUALITY,
    thumbnailOptions?: ThumbnailOptions
): Promise<{ image: OptimizedImage; thumbnail: OptimizedImage }> {
    const [image, thumbnail] = await Promise.all([
        optimizeImage(inputBuffer, imageQuality),
        generateThumbnail(inputBuffer, thumbnailOptions),
    ]);

    return { image, thumbnail };
}

/**
 * Calculate compression ratio
 * @param originalSize - Original buffer size in bytes
 * @param optimizedSize - Optimized buffer size in bytes
 * @returns Compression ratio (e.g., 0.75 = 75% reduction)
 */
export function calculateCompressionRatio(
    originalSize: number,
    optimizedSize: number
): number {
    if (originalSize === 0) return 0;
    return 1 - (optimizedSize / originalSize);
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export type LogoPosition =
    | "top-left"
    | "top-center"
    | "top-right"
    | "middle-left"
    | "middle-center"
    | "middle-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";

// Phase 26 (POL-03): tuning constants for the adaptive logo overlay's plate
// (soft backing) treatment and automatic corner selection. Hard-coded and
// commented, matching typography-compositor.service.ts's BUSY_STDEV_THRESHOLD
// documentation convention.
export const LOGO_AUTO_POSITION_CANDIDATES: LogoPosition[] = ["bottom-right", "bottom-left", "top-right", "top-left"];
// Plate padding as a fraction of the placed logo's own (resized) width.
export const LOGO_PLATE_PAD_RATIO = 0.18;
// Feather radius for the plate's soft edge; must stay well under
// LOGO_PLATE_PAD_RATIO * logoWidth so the blur has real padding to feather into.
export const LOGO_PLATE_BLUR_SIGMA = 8;
export const LOGO_PLATE_CORNER_RADIUS_RATIO = 0.14;

export interface LogoOverlayResult {
    buffer: Buffer;
    /** The position actually used (explicit if supplied, else the auto-selected winner). */
    position: LogoPosition;
    /** True only when the caller passed no position and auto corner selection ran. */
    autoSelected: boolean;
    /** Whether the SOURCE logo buffer (pre-.png()-conversion) carries an alpha channel. */
    logoHasAlpha: boolean;
    /** Whether the soft-edged plate/shadow treatment was composited behind the logo. */
    plateApplied: boolean;
}

/**
 * Resolves a LogoPosition string into the {left, top} anchor pixel coordinates
 * using the same "-"-split vertical/horizontal mapping the pre-Phase-26
 * implementation used, unchanged, so geometry stays byte-identical.
 */
function resolveLogoAnchor(
    position: LogoPosition,
    leftByHorizontal: Record<"left" | "center" | "right", number>,
    topByVertical: Record<"top" | "middle" | "bottom", number>,
): { left: number; top: number } {
    const [v, h] = position.split("-");
    const verticalKey: "top" | "middle" | "bottom" = v === "top" || v === "middle" || v === "bottom" ? v : "bottom";
    const horizontalKey: "left" | "center" | "right" = h === "left" || h === "center" || h === "right" ? h : "right";
    return { left: leftByHorizontal[horizontalKey], top: topByVertical[verticalKey] };
}

/**
 * Contrast- and alpha-aware logo overlay (POL-03). Overlays a real logo image
 * onto the generated artwork, deterministically avoiding AI "fake logo text"
 * artifacts, and additionally:
 *  - detects a no-alpha (e.g. JPEG) source logo via `hasAlpha` and always backs
 *    it with a soft-edged plate instead of compositing its opaque rectangle
 *    as a visible box;
 *  - samples the target region via `analyzeRegionContrast()` (Phase 23) and
 *    adds the same plate treatment behind an alpha logo when the region is
 *    busy/low-contrast (`scrimNeeded`);
 *  - runs automatic corner selection ONLY when the caller passed no
 *    `position` — an explicit (or inherited) position is NEVER overridden.
 *
 * Never throws: on any failure this returns the untreated base buffer, same
 * ethos as `analyzeRegionContrast` and the routes' own logo try/catch blocks.
 * See `applyLogoOverlay` below for the plain-Buffer entry point most callers use.
 */
export async function applyLogoOverlayDetailed(
    baseImageBuffer: Buffer,
    logoBuffer: Buffer,
    position?: LogoPosition,
): Promise<LogoOverlayResult> {
    try {
        const base = sharp(baseImageBuffer);
        const meta = await base.metadata();
        const baseWidth = meta.width || 0;
        const baseHeight = meta.height || 0;

        if (!baseWidth || !baseHeight) {
            return {
                buffer: baseImageBuffer,
                position: position ?? "bottom-right",
                autoSelected: false,
                logoHasAlpha: false,
                plateApplied: false,
            };
        }

        const targetLogoWidth = Math.max(64, Math.round(baseWidth * 0.14));
        const margin = Math.max(24, Math.round(Math.min(baseWidth, baseHeight) * 0.06));

        // Read hasAlpha from the ORIGINAL buffer — .png() conversion below adds
        // an alpha channel to every logo, which would make every source look
        // transparent if read afterward.
        const sourceLogoMeta = await sharp(logoBuffer).metadata();
        const logoHasAlpha = sourceLogoMeta.hasAlpha === true;

        const preparedLogo = await sharp(logoBuffer)
            .resize({
                width: targetLogoWidth,
                withoutEnlargement: true,
                fit: "inside",
            })
            .png()
            .toBuffer();

        const logoMeta = await sharp(preparedLogo).metadata();
        const logoWidth = logoMeta.width || targetLogoWidth;
        const logoHeight = logoMeta.height || targetLogoWidth;

        const centerX = Math.max(0, Math.round((baseWidth - logoWidth) / 2));
        const centerY = Math.max(0, Math.round((baseHeight - logoHeight) / 2));

        const leftByHorizontal: Record<"left" | "center" | "right", number> = {
            left: margin,
            center: centerX,
            right: Math.max(0, baseWidth - logoWidth - margin),
        };
        const topByVertical: Record<"top" | "middle" | "bottom", number> = {
            top: margin,
            middle: centerY,
            bottom: Math.max(0, baseHeight - logoHeight - margin),
        };

        let chosenPosition: LogoPosition;
        let autoSelected: boolean;
        let contrast: RegionContrast;

        if (position !== undefined) {
            // Explicit (or inherited, e.g. POL-05 remake) choice — respected
            // verbatim, never re-evaluated against other corners.
            chosenPosition = position;
            autoSelected = false;
            const anchor = resolveLogoAnchor(chosenPosition, leftByHorizontal, topByVertical);
            contrast = await analyzeRegionContrast(baseImageBuffer, {
                left: anchor.left,
                top: anchor.top,
                width: logoWidth,
                height: logoHeight,
            });
        } else {
            // No position supplied — automatic corner selection is the
            // fallback algorithm, gated strictly on absence (26-CONTEXT.md).
            autoSelected = true;
            let bestPosition: LogoPosition = LOGO_AUTO_POSITION_CANDIDATES[0];
            let bestContrast: RegionContrast | null = null;
            for (const candidate of LOGO_AUTO_POSITION_CANDIDATES) {
                const anchor = resolveLogoAnchor(candidate, leftByHorizontal, topByVertical);
                const candidateContrast = await analyzeRegionContrast(baseImageBuffer, {
                    left: anchor.left,
                    top: anchor.top,
                    width: logoWidth,
                    height: logoHeight,
                });
                const isBetter =
                    bestContrast === null ||
                    (!candidateContrast.scrimNeeded && bestContrast.scrimNeeded) ||
                    (candidateContrast.scrimNeeded === bestContrast.scrimNeeded &&
                        candidateContrast.stdev < bestContrast.stdev);
                if (isBetter) {
                    bestPosition = candidate;
                    bestContrast = candidateContrast;
                }
            }
            chosenPosition = bestPosition;
            contrast = bestContrast as RegionContrast;
        }

        const anchor = resolveLogoAnchor(chosenPosition, leftByHorizontal, topByVertical);
        const plateApplied = !logoHasAlpha || contrast.scrimNeeded;

        if (!plateApplied) {
            // Untreated path — byte-identical to the pre-Phase-26 composite.
            const composited = await base
                .composite([
                    {
                        input: preparedLogo,
                        blend: "over",
                        top: anchor.top,
                        left: anchor.left,
                    },
                ])
                .toBuffer();
            return { buffer: composited, position: chosenPosition, autoSelected, logoHasAlpha, plateApplied };
        }

        // Soft-edged plate/shadow treatment — fixes the no-alpha (JPEG) opaque-
        // box bug and backs an alpha logo on a busy/low-contrast region.
        const pad = Math.max(8, Math.round(logoWidth * LOGO_PLATE_PAD_RATIO));
        const desiredLeft = anchor.left - pad;
        const desiredTop = anchor.top - pad;
        const desiredWidth = logoWidth + pad * 2;
        const desiredHeight = logoHeight + pad * 2;

        // Clamp BEFORE rendering — sharp's composite() rejects an input larger
        // than the base image.
        const plateLeft = Math.max(0, desiredLeft);
        const plateTop = Math.max(0, desiredTop);
        const plateWidth = Math.max(1, Math.min(desiredWidth, baseWidth - plateLeft));
        const plateHeight = Math.max(1, Math.min(desiredHeight, baseHeight - plateTop));

        // Inset the rect so `.blur()` feathers into transparent padding
        // instead of clipping at the plate buffer's own edge.
        const inset = Math.ceil(LOGO_PLATE_BLUR_SIGMA * 2);
        const innerWidth = Math.max(1, plateWidth - inset * 2);
        const innerHeight = Math.max(1, plateHeight - inset * 2);
        const rx = Math.round(Math.min(plateWidth, plateHeight) * LOGO_PLATE_CORNER_RADIUS_RATIO);

        const plateSvg = Buffer.from(
            `<svg width="${plateWidth}" height="${plateHeight}"><rect x="${inset}" y="${inset}" width="${innerWidth}" height="${innerHeight}" rx="${rx}" fill="${contrast.scrimColor}" fill-opacity="${contrast.scrimAlpha}"/></svg>`,
        );
        const plate = await sharp(plateSvg).png().toBuffer();
        const softPlate = await sharp(plate).blur(LOGO_PLATE_BLUR_SIGMA).toBuffer();

        const composited = await base
            .composite([
                { input: softPlate, blend: "over", top: plateTop, left: plateLeft },
                { input: preparedLogo, blend: "over", top: anchor.top, left: anchor.left },
            ])
            .toBuffer();

        return { buffer: composited, position: chosenPosition, autoSelected, logoHasAlpha, plateApplied };
    } catch (err) {
        console.warn("[image-optimization] applyLogoOverlay failed, returning untreated base image:", err);
        return {
            buffer: baseImageBuffer,
            position: position ?? "bottom-right",
            autoSelected: false,
            logoHasAlpha: false,
            plateApplied: false,
        };
    }
}

/**
 * Plain-Buffer entry point preserving the original `applyLogoOverlay`
 * name/contract both `server/routes/generate.routes.ts` and
 * `server/routes/edit.routes.ts` assign a `Buffer` from. `position` is now
 * optional (Phase 26 / POL-03) — passing it through as possibly-undefined
 * (instead of collapsing to `"bottom-right"` before calling this function)
 * is what lets `applyLogoOverlayDetailed` distinguish an explicit user choice
 * from no choice at all, which gates automatic corner selection.
 */
export async function applyLogoOverlay(
    baseImageBuffer: Buffer,
    logoBuffer: Buffer,
    position?: LogoPosition,
): Promise<Buffer> {
    // Thin wrapper: the contrast-aware algorithm — analyzeRegionContrast(...)
    // sampling of the logo's target region, and hasAlpha detection of the
    // source logo buffer to decide whether the soft-edged plate/shadow
    // treatment is needed — lives in applyLogoOverlayDetailed(), which this
    // delegates to and unwraps to a plain Buffer.
    const result = await applyLogoOverlayDetailed(baseImageBuffer, logoBuffer, position);
    return result.buffer;
}
