/**
 * Shared validation for admin base64 file uploads (landing assets, etc.).
 *
 * Centralises three things that were previously missing or duplicated per route:
 *   1. Declared-MIME allow-listing.
 *   2. A real byte-size limit (decoded), so an admin token can't push a
 *      multi-GB blob into Storage.
 *   3. A lightweight SVG hardening pass that rejects the obvious XSS vectors
 *      (<script>, on*= handlers, javascript: hrefs, <foreignObject>) — far
 *      cheaper than shipping a full sanitizer for the handful of SVGs an admin
 *      ever uploads, and enough to stop a stored-XSS payload.
 */

export interface UploadValidationOk {
  ok: true;
  buffer: Buffer;
  contentType: string;
}

export interface UploadValidationError {
  ok: false;
  status: number;
  message: string;
}

export type UploadValidationResult = UploadValidationOk | UploadValidationError;

export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const SVG_ACTIVE_CONTENT = [
  /<script[\s>]/i,
  /\son\w+\s*=/i, // onload=, onclick=, …
  /(?:href|xlink:href)\s*=\s*["']?\s*javascript:/i,
  /<foreignObject[\s>]/i,
];

export function validateBase64Upload(
  file: unknown,
  contentType: unknown,
  allowedTypes: string[],
  maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES,
): UploadValidationResult {
  if (typeof file !== "string" || !file || typeof contentType !== "string" || !contentType) {
    return { ok: false, status: 400, message: "Missing file or contentType" };
  }

  if (!allowedTypes.includes(contentType)) {
    return {
      ok: false,
      status: 400,
      message: `Invalid file type. Allowed: ${allowedTypes.join(", ")}`,
    };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(file, "base64");
  } catch {
    return { ok: false, status: 400, message: "File is not valid base64" };
  }

  if (buffer.length === 0) {
    return { ok: false, status: 400, message: "File is empty" };
  }

  if (buffer.length > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    return { ok: false, status: 400, message: `File exceeds ${mb} MB limit` };
  }

  if (contentType === "image/svg+xml") {
    const svg = buffer.toString("utf8");
    if (SVG_ACTIVE_CONTENT.some((re) => re.test(svg))) {
      return {
        ok: false,
        status: 400,
        message: "SVG contains disallowed active content (scripts/handlers).",
      };
    }
  }

  return { ok: true, buffer, contentType };
}
