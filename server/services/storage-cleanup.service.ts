/**
 * Storage Cleanup Service
 * Handles deletion of orphaned files from object storage
 * Works in conjunction with the version_cleanup_log table
 *
 * Backend-agnostic since the R2 migration: `deleteAssetsByUrl` routes each URL
 * to whichever store actually holds it, so a batch that mixes freshly written
 * R2 assets with not-yet-backfilled Supabase assets cleans up correctly.
 */

import { createAdminSupabase } from "../supabase.js";
import { deleteAssetsByUrl } from "../lib/r2.js";

interface CleanupItem {
    id: string;
    image_url: string;
    thumbnail_url: string | null;
}

/**
 * Process pending storage cleanup items
 * Should be called periodically or after version creation
 */
export async function processStorageCleanup(batchSize: number = 50): Promise<number> {
    const supabase = createAdminSupabase();

    // Get pending cleanup items
    const { data: pendingItems, error: fetchError } = await supabase
        .rpc("get_pending_storage_cleanup", { limit_count: batchSize });

    if (fetchError) {
        console.error("[Storage Cleanup] Failed to fetch pending items:", fetchError.message);
        return 0;
    }

    if (!pendingItems || pendingItems.length === 0) {
        return 0;
    }

    let cleanedCount = 0;

    for (const item of pendingItems as CleanupItem[]) {
        const result = await deleteAssetsByUrl([item.image_url, item.thumbnail_url]);

        // Don't mark as cleaned if a delete actually failed — the row stays
        // pending and the next sweep retries it.
        if (result.failed) {
            console.warn(`[Storage Cleanup] Deletion failed for item ${item.id}, will retry`);
            continue;
        }

        await supabase.rpc("mark_storage_cleaned", { p_id: item.id });

        // Rows whose URLs were all unparseable still get marked clean — there is
        // nothing left to delete and retrying forever would wedge the queue.
        if (result.r2 + result.supabase > 0) {
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(`[Storage Cleanup] Cleaned up ${cleanedCount} version files`);
    }

    return cleanedCount;
}

/**
 * Delete files associated with a version when it's pushed out of the limit
 * This is called from the edit route after a new version is created
 */
export async function cleanupOldVersionFiles(
    imageUrl: string,
    thumbnailUrl: string | null
): Promise<boolean> {
    const result = await deleteAssetsByUrl([imageUrl, thumbnailUrl]);

    if (result.failed) {
        console.warn("[Storage Cleanup] Failed to delete old version files");
        return false;
    }

    const deleted = result.r2 + result.supabase;
    if (deleted > 0) {
        console.log(`[Storage Cleanup] Deleted ${deleted} old version files`);
    }
    return true;
}
