import { buildKey, putObject, IMMUTABLE_CACHE_CONTROL } from "./lib/r2.js";

/**
 * Upload a file to object storage under a random, collision-free filename.
 *
 * Backed by Cloudflare R2 (see server/lib/r2.ts); falls back to the legacy
 * Supabase `user_assets` bucket when the R2_* env block is not fully set.
 *
 * Note the historical shape of `folder`: several callers pass something that
 * looks like a filename (`{userId}/{postId}.mp4`) and the UUID is appended
 * *below* it, producing `{userId}/{postId}.mp4/{uuid}.mp4`. That is preserved
 * deliberately — the keys are unchanged by the R2 migration so existing rows
 * and the backfill stay in sync.
 *
 * @param folder - Key prefix within the bucket
 * @param file - File buffer
 * @param contentType - MIME type (e.g., "image/svg+xml", "image/png")
 * @param cacheControl - Override when the key can be overwritten in place
 * @returns Public URL of the uploaded file
 */
export async function uploadFile(
  folder: string,
  file: Buffer,
  contentType: string,
  cacheControl: string = IMMUTABLE_CACHE_CONTROL,
): Promise<string> {
  const key = buildKey(folder, contentType);
  return putObject({ key, body: file, contentType, cacheControl });
}
