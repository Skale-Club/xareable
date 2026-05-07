/**
 * Cleanup Cron Service (Phase 11)
 *
 * Two scheduled jobs:
 *   1. Trash sweep — soft-deletes expired posts (sets trashed_at = now()).
 *      Runs every 6 hours.
 *   2. Purge sweep — permanently deletes posts in trash > 30 days.
 *      Storage files are removed BEFORE the DB row.
 *      Runs every 6 hours (offset).
 *
 * No HTTP endpoint is involved (TRSH-06). Both jobs use the admin Supabase
 * client (service role, bypasses RLS) since they operate cross-user.
 */

import cron from "node-cron";
import { createAdminSupabase } from "../supabase.js";
import { TRASH_RETENTION_DAYS } from "../../shared/schema.js";

/** Cap how many posts a single purge run may process to avoid unbounded batches. */
const PURGE_BATCH_LIMIT = 50;

/** Extract the storage object path from a public Supabase URL. */
function extractPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/\/user_assets\/(.+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Compute the enhancement source path: image_url with `.webp` -> `-source.webp`. */
function deriveEnhancementSourceUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (!/\.webp(\?.*)?$/i.test(imageUrl)) return null;
  return imageUrl.replace(/\.webp(\?.*)?$/i, (_m, qs) => `-source.webp${qs || ""}`);
}

/**
 * Trash sweep: set trashed_at = now() for posts whose expires_at has passed
 * and that are not already in trash.
 * @returns number of posts moved to trash
 */
export async function runTrashSweep(): Promise<number> {
  const supabase = createAdminSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("posts")
    .update({ trashed_at: now })
    .lte("expires_at", now)
    .is("trashed_at", null)
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Purge sweep: permanently delete posts that have been trashed for >= TRASH_RETENTION_DAYS.
 * Storage deletion happens BEFORE the DB row delete (orphan-prevention order).
 * @returns number of posts purged
 */
export async function runPurgeSweep(): Promise<number> {
  const supabase = createAdminSupabase();
  const cutoffMs = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, image_url, thumbnail_url, content_type")
    .not("trashed_at", "is", null)
    .lte("trashed_at", cutoff)
    .limit(PURGE_BATCH_LIMIT);

  if (error) throw error;
  if (!posts || posts.length === 0) return 0;

  let purgedCount = 0;
  const postIds = posts.map((p) => p.id);

  // Collect all storage paths up front: post primary + thumbnail + post_versions + post_slides + enhancement -source.
  const filesToDelete: string[] = [];

  // 1. Post-level images
  for (const post of posts) {
    const imgPath = extractPathFromUrl(post.image_url);
    if (imgPath) filesToDelete.push(imgPath);
    const thumbPath = extractPathFromUrl(post.thumbnail_url);
    if (thumbPath) filesToDelete.push(thumbPath);

    // 2. Enhancement source sibling file
    if (post.content_type === "enhancement") {
      const sourceUrl = deriveEnhancementSourceUrl(post.image_url);
      const sourcePath = extractPathFromUrl(sourceUrl);
      if (sourcePath) filesToDelete.push(sourcePath);
    }
  }

  // 3. Slide images for carousel posts
  const { data: slides } = await supabase
    .from("post_slides")
    .select("image_url, thumbnail_url")
    .in("post_id", postIds);
  for (const slide of slides || []) {
    const imgPath = extractPathFromUrl(slide.image_url);
    if (imgPath) filesToDelete.push(imgPath);
    const thumbPath = extractPathFromUrl(slide.thumbnail_url);
    if (thumbPath) filesToDelete.push(thumbPath);
  }

  // 4. Post versions (edited variants)
  const { data: versions } = await supabase
    .from("post_versions")
    .select("image_url, thumbnail_url")
    .in("post_id", postIds);
  for (const v of versions || []) {
    const imgPath = extractPathFromUrl(v.image_url);
    if (imgPath) filesToDelete.push(imgPath);
    const thumbPath = extractPathFromUrl(v.thumbnail_url);
    if (thumbPath) filesToDelete.push(thumbPath);
  }

  // De-duplicate
  const uniquePaths = Array.from(new Set(filesToDelete));

  // STORAGE DELETE FIRST (in chunks of 100)
  if (uniquePaths.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < uniquePaths.length; i += CHUNK) {
      const chunk = uniquePaths.slice(i, i + CHUNK);
      const { error: storageError } = await supabase.storage
        .from("user_assets")
        .remove(chunk);
      if (storageError) {
        console.error(
          `[Cron Purge] Storage delete failed for chunk ${i}-${i + chunk.length}:`,
          storageError.message,
        );
        // Abort: do not delete DB rows if storage failed (avoid orphan files).
        return purgedCount;
      }
    }
  }

  // 5. DB delete — CASCADE removes post_slides + post_versions automatically.
  const { error: deleteError } = await supabase
    .from("posts")
    .delete()
    .in("id", postIds);

  if (deleteError) {
    console.error("[Cron Purge] DB delete failed:", deleteError.message);
    return purgedCount;
  }

  // 6. Clear version_cleanup_log entries for these posts (best-effort)
  // post_slides + post_versions cascade-delete fires triggers that enqueue rows
  // into version_cleanup_log; clear them since we already removed storage above.
  // (Best-effort: failure here is non-fatal — the drain will no-op.)
  // Note: version_cleanup_log uses version_id from the deleted slide/version rows
  // which are gone after CASCADE; clean by joining on missing references is not
  // possible. Instead delete log entries created in the last 60s for safety.
  try {
    const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
    await supabase
      .from("version_cleanup_log")
      .delete()
      .gte("created_at", sixtySecAgo);
  } catch (err) {
    console.warn("[Cron Purge] version_cleanup_log cleanup skipped:", err);
  }

  purgedCount = posts.length;
  return purgedCount;
}

/**
 * Register both cron jobs. Called from server/index.ts inside httpServer.listen callback.
 * Trash sweep: every 6 hours at minute 0.
 * Purge sweep: every 6 hours at minute 30 (offset to avoid overlap).
 */
export function startCronJobs(): void {
  cron.schedule("0 */6 * * *", async () => {
    console.log("[Cron] Trash sweep starting");
    try {
      const count = await runTrashSweep();
      if (count > 0) console.log(`[Cron] Trash sweep: ${count} post(s) trashed`);
    } catch (err) {
      console.error("[Cron] Trash sweep failed:", err);
    }
  });

  cron.schedule("30 */6 * * *", async () => {
    console.log("[Cron] Purge sweep starting");
    try {
      const count = await runPurgeSweep();
      if (count > 0) console.log(`[Cron] Purge sweep: ${count} post(s) purged`);
    } catch (err) {
      console.error("[Cron] Purge sweep failed:", err);
    }
  });

  console.log("[Cron] Jobs registered: trash-sweep (every 6h), purge-sweep (every 6h +30m)");
}
