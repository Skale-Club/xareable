/**
 * Trash Routes (Phase 11)
 *
 *   GET    /api/trash             — list trashed posts for the authenticated user
 *   POST   /api/trash/:id/restore — restore: clear trashed_at, reset expires_at +30d
 *   DELETE /api/trash/:id         — force permanent delete: storage first, then DB
 *
 * Storage deletion always happens BEFORE the DB row is removed
 * (research Pitfall 1: prevents orphaned files on partial failure).
 */

import { Router, Request, Response } from "express";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { createAdminSupabase } from "../supabase.js";
import { deleteAssetsByUrl } from "../lib/r2.js";
import {
  TRASH_RETENTION_DAYS,
  trashListResponseSchema,
} from "../../shared/schema.js";

const router = Router();

/** Derive the enhancement source sibling URL (`.webp` -> `-source.webp`). */
function deriveEnhancementSourceUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (!/\.webp(\?.*)?$/i.test(imageUrl)) return null;
  return imageUrl.replace(/\.webp(\?.*)?$/i, (_m, qs) => `-source.webp${qs || ""}`);
}

/** Compute integer days remaining until permanent purge (clamped at 0). */
function daysRemaining(trashedAtIso: string): number {
  const trashedMs = new Date(trashedAtIso).getTime();
  const elapsedDays = Math.floor((Date.now() - trashedMs) / 86_400_000);
  return Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
}

// ─────────────────────────────────────────────────────────────────
// GET /api/trash
// ─────────────────────────────────────────────────────────────────
router.get("/api/trash", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }
  const { user, supabase } = authResult;

  const { data: rows, error } = await supabase
    .from("posts")
    .select("id, created_at, image_url, thumbnail_url, content_type, slide_count, caption, trashed_at")
    .eq("user_id", user.id)
    .not("trashed_at", "is", null)
    .order("trashed_at", { ascending: false });

  if (error) {
    console.error("[Trash] Failed to fetch trashed posts:", error);
    res.status(500).json({ message: "Failed to fetch trash" });
    return;
  }

  const posts = (rows || []).map((row: any) => ({
    id: row.id,
    created_at: row.created_at,
    image_url: row.thumbnail_url || row.image_url || null,
    thumbnail_url: row.thumbnail_url || null,
    content_type: row.content_type || "image",
    slide_count: typeof row.slide_count === "number" ? row.slide_count : null,
    caption: row.caption || null,
    trashed_at: row.trashed_at as string,
    days_remaining: daysRemaining(row.trashed_at as string),
  }));

  res.json(trashListResponseSchema.parse({ posts }));
});

// ─────────────────────────────────────────────────────────────────
// POST /api/trash/:id/restore
// ─────────────────────────────────────────────────────────────────
router.post("/api/trash/:id/restore", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }
  const { user, supabase } = authResult;
  const { id } = req.params;

  // Ownership + trash-state check
  const { data: post, error: fetchError } = await supabase
    .from("posts")
    .select("id, user_id, trashed_at")
    .eq("id", id)
    .single();

  if (fetchError || !post) {
    res.status(404).json({ message: "Post not found" });
    return;
  }
  if (post.user_id !== user.id) {
    res.status(403).json({ message: "Access denied" });
    return;
  }
  if (post.trashed_at == null) {
    res.status(400).json({ message: "Post is not in trash" });
    return;
  }

  // Reset both fields atomically: clear trashed_at, push expires_at to now + 30d
  const newExpiresAt = new Date(
    Date.now() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const adminSb = createAdminSupabase();
  const { error: updateError } = await adminSb
    .from("posts")
    .update({ trashed_at: null, expires_at: newExpiresAt })
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateError) {
    console.error("[Trash] Restore failed:", updateError);
    res.status(500).json({ message: "Failed to restore post" });
    return;
  }

  res.json({ success: true, id, expires_at: newExpiresAt });
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/trash/:id  — force permanent delete
// ─────────────────────────────────────────────────────────────────
router.delete("/api/trash/:id", async (req: Request, res: Response): Promise<void> => {
  const authResult = await authenticateUser(req as AuthenticatedRequest);
  if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
  }
  const { user, supabase } = authResult;
  const { id } = req.params;

  const { data: post, error: fetchError } = await supabase
    .from("posts")
    .select("id, user_id, image_url, thumbnail_url, content_type")
    .eq("id", id)
    .single();

  if (fetchError || !post) {
    res.status(404).json({ message: "Post not found" });
    return;
  }
  if (post.user_id !== user.id) {
    res.status(403).json({ message: "Access denied" });
    return;
  }

  const adminSb = createAdminSupabase();

  // Collect all asset URLs: post + slides + versions + enhancement source.
  // URLs rather than paths so R2-hosted and legacy Supabase-hosted assets in
  // the same post both get deleted from the right place.
  const filesToDelete: (string | null | undefined)[] = [
    post.image_url,
    post.thumbnail_url,
  ];

  if (post.content_type === "enhancement") {
    filesToDelete.push(deriveEnhancementSourceUrl(post.image_url));
  }

  const { data: slides } = await adminSb
    .from("post_slides")
    .select("image_url, thumbnail_url")
    .eq("post_id", id);
  for (const slide of slides || []) {
    filesToDelete.push(slide.image_url, slide.thumbnail_url);
  }

  const { data: versions } = await adminSb
    .from("post_versions")
    .select("image_url, thumbnail_url")
    .eq("post_id", id);
  for (const v of versions || []) {
    filesToDelete.push(v.image_url, v.thumbnail_url);
  }

  // STORAGE FIRST (Pitfall 1)
  const deletion = await deleteAssetsByUrl(filesToDelete);
  if (deletion.failed) {
    console.error("[Trash] Storage delete failed");
    res.status(500).json({ message: "Failed to delete files" });
    return;
  }

  // DB delete (CASCADE removes post_slides + post_versions rows)
  const { error: deleteError } = await adminSb
    .from("posts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteError) {
    console.error("[Trash] DB delete failed:", deleteError);
    res.status(500).json({ message: "Failed to delete post" });
    return;
  }

  res.json({
    success: true,
    id,
    deletedStorageObjectCount: deletion.r2 + deletion.supabase,
  });
});

export default router;
