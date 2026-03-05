/**
 * Posts Routes - Post CRUD operations
 * Handles post retrieval and management
 */

import { Router, Request, Response } from "express";
import { postsPageResponseSchema } from "../../shared/schema.js";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";

const router = Router();

/**
 * GET /api/posts
 * Returns paginated posts for the authenticated user
 */
router.get("/api/posts", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);

    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;

    // Parse pagination parameters
    const requestedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const requestedLimit = Number.parseInt(String(req.query.limit ?? "12"), 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 12;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Helper to check for missing table errors
    const isMissingSchemaTable = (error: any, table: string) =>
        typeof error?.message === "string" &&
        error.message.includes(`Could not find the table 'public.${table}' in the schema cache`);

    // Get total count
    const { count, error: countError } = await supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

    if (countError) {
        if (isMissingSchemaTable(countError, "posts")) {
            res.json(
                postsPageResponseSchema.parse({
                    posts: [],
                    total: 0,
                    page,
                    limit,
                    totalPages: 0,
                })
            );
            return;
        }
        res.status(500).json({ message: "Failed to fetch posts count" });
        return;
    }

    // Get posts for current page
    const { data: posts, error: postsError } = await supabase
        .from("posts")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, to);

    if (postsError) {
        if (isMissingSchemaTable(postsError, "posts")) {
            res.json(
                postsPageResponseSchema.parse({
                    posts: [],
                    total: 0,
                    page,
                    limit,
                    totalPages: 0,
                })
            );
            return;
        }
        res.status(500).json({ message: "Failed to fetch posts" });
        return;
    }

    const totalPages = Math.ceil((count || 0) / limit);

    res.json(
        postsPageResponseSchema.parse({
            posts: posts || [],
            total: count || 0,
            page,
            limit,
            totalPages,
        })
    );
});

/**
 * DELETE /api/posts/:id
 * Deletes a post by ID (must belong to authenticated user)
 */
router.delete("/api/posts/:id", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);

    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;
    const { id } = req.params;

    // Verify ownership before deletion
    const { data: post, error: fetchError } = await supabase
        .from("posts")
        .select("id, user_id")
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

    // Delete the post
    const { error: deleteError } = await supabase
        .from("posts")
        .delete()
        .eq("id", id);

    if (deleteError) {
        res.status(500).json({ message: "Failed to delete post" });
        return;
    }

    res.json({ success: true, message: "Post deleted" });
});

export default router;
