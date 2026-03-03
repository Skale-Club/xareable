import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upload a file to Supabase Storage
 * @param supabase - Supabase client
 * @param bucket - Storage bucket name
 * @param folder - Folder path within bucket
 * @param file - File buffer
 * @param contentType - MIME type (e.g., "image/svg+xml", "image/png")
 * @returns Public URL of uploaded file
 */
export async function uploadFile(
  supabase: SupabaseClient,
  bucket: string,
  folder: string,
  file: Buffer,
  contentType: string
): Promise<string> {
  const ext = contentType.includes("svg") ? "svg" : contentType.split("/")[1] || "png";
  const fileName = `${folder}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, file, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(fileName);

  return publicUrl;
}
