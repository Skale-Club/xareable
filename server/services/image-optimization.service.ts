/**
 * Image Optimization Service
 * Handles image compression and thumbnail generation using sharp
 * Reduces storage costs by ~70-80% through WebP conversion
 */

// @ts-ignore - sharp ESM import
import sharp from 'sharp';

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

const DEFAULT_IMAGE_QUALITY = 80;

/**
 * Optimize an image buffer to WebP format
 * @param inputBuffer - Raw image buffer (PNG, JPEG, etc.)
 * @param quality - WebP quality (1-100), default 80
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

type LogoPosition =
    | "top-left"
    | "top-center"
    | "top-right"
    | "middle-left"
    | "middle-center"
    | "middle-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";

/**
 * Overlay a real logo image onto the generated artwork at an exact anchor position.
 * This is deterministic and avoids AI "fake logo text" artifacts.
 */
export async function applyLogoOverlay(
    baseImageBuffer: Buffer,
    logoBuffer: Buffer,
    position: LogoPosition = "bottom-right"
): Promise<Buffer> {
    const base = sharp(baseImageBuffer);
    const meta = await base.metadata();
    const baseWidth = meta.width || 0;
    const baseHeight = meta.height || 0;

    if (!baseWidth || !baseHeight) {
        return baseImageBuffer;
    }

    const targetLogoWidth = Math.max(80, Math.round(baseWidth * 0.18));
    const margin = Math.max(12, Math.round(Math.min(baseWidth, baseHeight) * 0.03));

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

    const [verticalKey, horizontalKey] = (() => {
        const [v, h] = position.split("-");
        if (v === "top" || v === "middle" || v === "bottom") {
            const mappedH = h === "left" || h === "center" || h === "right" ? h : "right";
            return [v, mappedH] as const;
        }
        return ["bottom", "right"] as const;
    })();

    const composited = await base
        .composite([
            {
                input: preparedLogo,
                blend: "over",
                top: topByVertical[verticalKey],
                left: leftByHorizontal[horizontalKey],
            },
        ])
        .toBuffer();

    return composited;
}
