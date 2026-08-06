/**
 * Browser → R2 direct upload via a server-signed PUT.
 *
 * Replaces `supabase.storage.from("user_assets").upload(...)`. The Supabase
 * client could pick its own path because RLS constrained writes to the caller's
 * own `{userId}/` prefix; R2 has no RLS, so the server owns the key and the
 * client only declares a *kind*. See server/routes/uploads.routes.ts.
 *
 * The bytes go straight to Cloudflare — they never transit the app container.
 */

import { apiRequest } from "./queryClient";

export type UploadKind =
  | "brand-logo"
  | "brand-reference"
  | "scenery-preview"
  | "style-board";

/** Mirrors the server allow-list. SVG is intentionally absent. */
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type SignResponse =
  | {
      mode: "presign";
      uploadUrl: string;
      headers: Record<string, string>;
      key: string;
      publicUrl: string;
      expiresIn: number;
    }
  | { mode: "proxy"; uploadPath: string };

/** Read a File as bare base64 (no `data:` prefix). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export interface UploadOptions {
  kind: UploadKind;
  file: File;
  /** Required when kind === "scenery-preview". */
  sceneryId?: string;
  /** Both required when kind === "style-board". */
  scope?: string;
  styleId?: string;
}

/**
 * Upload a file and return its public CDN URL.
 * Throws with a human-readable message on validation or transport failure —
 * callers surface it through their existing toast.
 */
export async function uploadViaPresign({
  kind,
  file,
  ...extras
}: UploadOptions): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(
      `Unsupported file type${file.type ? ` (${file.type})` : ""}. Use PNG, JPEG, WebP or GIF.`,
    );
  }
  if (file.size === 0) {
    throw new Error("File is empty");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("File exceeds the 5 MB limit");
  }

  const signRes = await apiRequest("POST", "/api/uploads/sign", {
    kind,
    contentType: file.type,
    // Signed into the URL — the PUT below must match it exactly, which the
    // browser guarantees since it derives Content-Length from the same File.
    contentLength: file.size,
    ...extras,
  });
  const signed: SignResponse = await signRes.json();

  // Storage is not on R2 (local dev, or the rollback path) — the server takes
  // the bytes itself and writes them to whichever backend is live.
  if (signed.mode === "proxy") {
    const res = await apiRequest("POST", signed.uploadPath, {
      kind,
      contentType: file.type,
      data: await toBase64(file),
      ...extras,
    });
    const { publicUrl } = (await res.json()) as { publicUrl: string };
    return publicUrl;
  }

  const putRes = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: signed.headers,
    body: file,
  });

  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }

  return signed.publicUrl;
}
