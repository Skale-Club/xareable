export function isVideoUrl(url?: string | null): boolean {
  if (!url) return false;

  try {
    return /\.(mp4|webm|mov|m4v|avi)$/i.test(new URL(url).pathname);
  } catch {
    return /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(url);
  }
}

export async function extractVideoThumbnailJpeg(
  videoUrl: string,
  options?: {
    maxWidth?: number;
    quality?: number;
    seekSeconds?: number;
  },
): Promise<Blob> {
  const maxWidth = options?.maxWidth ?? 1024;
  const quality = options?.quality ?? 0.82;
  const seekSeconds = options?.seekSeconds ?? 0.6;

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = videoUrl;

  await new Promise<void>((resolve, reject) => {
    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to load video metadata for thumbnail extraction."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("error", onError);
  });

  const safeSeek = Math.min(Math.max(0, seekSeconds), Math.max(0, (video.duration || 0) - 0.1));
  if (Number.isFinite(safeSeek)) {
    video.currentTime = safeSeek;
  }

  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to seek video frame for thumbnail extraction."));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
  });

  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 720;
  const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context unavailable for thumbnail extraction.");
  }

  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

  if (!blob) {
    throw new Error("Failed to encode thumbnail as JPEG.");
  }

  return blob;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to convert blob to base64."));
    reader.readAsDataURL(blob);
  });
}
