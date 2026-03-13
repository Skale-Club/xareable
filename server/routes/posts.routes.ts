/**
 * Posts Routes - Post CRUD operations
 * Handles post retrieval and management
 */

import { Router, Request, Response } from "express";
import { postsPageResponseSchema } from "../../shared/schema.js";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";
import {
    ensureCaptionQuality,
    normalizeContentLanguage,
} from "../services/caption-quality.service.js";
import { uploadFile } from "../storage.js";
import { createAdminSupabase } from "../supabase.js";

const router = Router();

function extractPromptField(prompt: string | null | undefined, fieldLabel: string): string | null {
    if (!prompt) return null;
    const match = prompt.match(new RegExp(`^${fieldLabel}:\\s*(.+)$`, "im"));
    return match?.[1]?.trim() || null;
}

function looksTruncatedCaption(text: string): boolean {
    if (!text) return true;
    const normalized = text.trim();
    if (normalized.length < 40) return true;
    if (/[,:;\-\/]\s*$/.test(normalized)) return true;
    if (/\b(como|com|and|or|with|de|do|da|dos|das|e|y|con|para|por)\s*$/i.test(normalized)) return true;
    if (/#\w[\w-]*\s*$/.test(normalized)) return false;
    if (!/[.!?…]$/.test(normalized)) return true;
    return false;
}

function hasHashtags(text: string): boolean {
    return /(^|\s)#\w[\w-]*/.test(text);
}

function isAcceptableCaption(text: string): boolean {
    const normalized = text.trim();
    if (normalized.length < 80) return false;
    if (looksTruncatedCaption(normalized)) return false;
    if (!hasHashtags(normalized)) return false;
    return true;
}

function buildCaptionFallback(params: {
    brandName: string;
    companyType: string;
    contentLanguage: "en" | "pt" | "es";
}): string {
    const brandTag = String(params.brandName || "Brand").replace(/\s+/g, "");
    if (params.contentLanguage === "pt") {
        return `Na ${params.brandName}, transformamos estratégia em resultado real para ${params.companyType}. Conteúdo com clareza, consistência e foco em conversão.\n\nPronto para elevar sua presença digital com mais impacto e previsibilidade?\n\n#${brandTag} #marketingdigital #crescimento #marca`;
    }
    if (params.contentLanguage === "es") {
        return `En ${params.brandName}, convertimos estrategia en resultados reales para ${params.companyType}. Contenido con claridad, consistencia y foco en conversión.\n\n¿Listo para elevar tu presencia digital con más impacto y previsibilidad?\n\n#${brandTag} #marketingdigital #crecimiento #marca`;
    }
    return `At ${params.brandName}, we turn strategy into measurable results for ${params.companyType}. Content with clarity, consistency, and conversion focus.\n\nReady to elevate your digital presence with stronger impact and predictable growth?\n\n#${brandTag} #marketing #growth #brand`;
}

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
                    totalCount: 0,
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
        .select("id, created_at, image_url, thumbnail_url, content_type, caption")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, to);

    if (postsError) {
        if (isMissingSchemaTable(postsError, "posts")) {
            res.json(
                postsPageResponseSchema.parse({
                    posts: [],
                    totalCount: 0,
                })
            );
            return;
        }
        res.status(500).json({ message: "Failed to fetch posts" });
        return;
    }

    const galleryPosts = (posts || []).map((post: any) => ({
        id: post.id,
        created_at: post.created_at,
        image_url: post.thumbnail_url || post.image_url || null,
        original_image_url: post.image_url || null,
        thumbnail_url: post.thumbnail_url || null,
        content_type: post.content_type === "video" ? "video" : "image",
        caption: post.caption || null,
        version_count: 0,
    }));

    res.json(
        postsPageResponseSchema.parse({
            posts: galleryPosts,
            totalCount: count || 0,
        })
    );
});

/**
 * POST /api/posts/:id/thumbnail
 * Upload or replace a lightweight preview image (WebP/JPEG/PNG) for a post.
 * Optional `version_number` updates `post_versions.thumbnail_url` for edited variants.
 */
router.post("/api/posts/:id/thumbnail", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);

    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;
    const adminSupabase = createAdminSupabase();
    const { id: postId } = req.params;
    const fileValue = typeof req.body?.file === "string" ? req.body.file.trim() : "";
    const contentTypeValue = typeof req.body?.contentType === "string" ? req.body.contentType.trim().toLowerCase() : "";
    const requestedVersion = Number(req.body?.version_number);
    const versionNumber =
        Number.isInteger(requestedVersion) && requestedVersion > 0
            ? requestedVersion
            : null;

    if (!fileValue || !contentTypeValue) {
        res.status(400).json({ message: "Missing file or contentType" });
        return;
    }

    const allowedContentTypes = new Set(["image/webp", "image/jpeg", "image/jpg", "image/png"]);
    if (!allowedContentTypes.has(contentTypeValue)) {
        res.status(400).json({ message: "Unsupported preview contentType" });
        return;
    }

    const base64Payload = fileValue.includes(",") ? fileValue.split(",")[1] || "" : fileValue;
    let fileBuffer: Buffer;
    try {
        fileBuffer = Buffer.from(base64Payload, "base64");
    } catch {
        res.status(400).json({ message: "Invalid base64 file payload" });
        return;
    }

    if (!fileBuffer || fileBuffer.length === 0) {
        res.status(400).json({ message: "Invalid empty file payload" });
        return;
    }

    if (fileBuffer.length > 8 * 1024 * 1024) {
        res.status(413).json({ message: "Preview image too large" });
        return;
    }

    const { data: post, error: postError } = await supabase
        .from("posts")
        .select("id, user_id")
        .eq("id", postId)
        .single();

    if (postError || !post) {
        res.status(404).json({ message: "Post not found" });
        return;
    }

    if (post.user_id !== user.id) {
        res.status(403).json({ message: "Access denied" });
        return;
    }

    let publicUrl: string;
    try {
        publicUrl = await uploadFile(
            adminSupabase,
            "user_assets",
            `${user.id}/thumbnails/${postId}`,
            fileBuffer,
            contentTypeValue,
        );
    } catch (error) {
        console.error("Thumbnail upload failed:", error);
        res.status(500).json({ message: "Failed to upload thumbnail" });
        return;
    }

    if (versionNumber === null) {
        const { error: updatePostError } = await adminSupabase
            .from("posts")
            .update({ thumbnail_url: publicUrl })
            .eq("id", postId)
            .eq("user_id", user.id);

        if (updatePostError) {
            res.status(500).json({ message: "Failed to update post thumbnail" });
            return;
        }
    } else {
        const { error: updateVersionError } = await adminSupabase
            .from("post_versions")
            .update({ thumbnail_url: publicUrl })
            .eq("post_id", postId)
            .eq("version_number", versionNumber);

        if (updateVersionError) {
            const message = String(updateVersionError.message || "").toLowerCase();
            const isMissingColumn =
                message.includes("column") &&
                message.includes("thumbnail_url") &&
                message.includes("does not exist");
            const isMissingTable = message.includes("could not find the table 'public.post_versions'");

            if (!isMissingColumn && !isMissingTable) {
                res.status(500).json({ message: "Failed to update version thumbnail" });
                return;
            }
        }

        // Keep gallery preview aligned with the most recent generated version thumbnail.
        const { error: updatePostPreviewError } = await adminSupabase
            .from("posts")
            .update({ thumbnail_url: publicUrl })
            .eq("id", postId)
            .eq("user_id", user.id);

        if (updatePostPreviewError) {
            res.status(500).json({ message: "Failed to update post preview thumbnail" });
            return;
        }
    }

    res.json({ thumbnail_url: publicUrl });
});

/**
 * POST /api/posts/:id/remake-caption
 * Regenerates only the caption for an existing post.
 */
router.post("/api/posts/:id/remake-caption", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);

    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;
    const { id: postId } = req.params;
    const contentLanguage = normalizeContentLanguage(req.body?.content_language);
    const requestedVersion = Number(req.body?.version_number);
    const versionNumber = Number.isInteger(requestedVersion) && requestedVersion > 0 ? requestedVersion : null;

    const [{ data: post, error: postError }, { data: brand }, { data: profile }] = await Promise.all([
        supabase
            .from("posts")
            .select("id, user_id, caption, ai_prompt_used")
            .eq("id", postId)
            .single(),
        supabase
            .from("brands")
            .select("company_name, company_type")
            .eq("user_id", user.id)
            .single(),
        supabase
            .from("profiles")
            .select("is_admin, is_affiliate, api_key")
            .eq("id", user.id)
            .single(),
    ]);

    if (postError || !post) {
        res.status(404).json({ message: "Post not found" });
        return;
    }
    if (post.user_id !== user.id) {
        res.status(403).json({ message: "Access denied" });
        return;
    }
    if (!brand) {
        res.status(400).json({ message: "Brand profile not found" });
        return;
    }

    let versionEditPrompt: string | null = null;
    if (versionNumber !== null) {
        const { data: version } = await supabase
            .from("post_versions")
            .select("edit_prompt")
            .eq("post_id", postId)
            .eq("version_number", versionNumber)
            .single();
        versionEditPrompt = version?.edit_prompt || null;
    }

    const usesOwnApiKey = profile?.is_admin === true || profile?.is_affiliate === true;
    const apiKey = usesOwnApiKey ? profile?.api_key : process.env.GEMINI_API_KEY;
    if (!apiKey) {
        res.status(400).json({ message: "Gemini API key not configured" });
        return;
    }

    const subjectDefinition = extractPromptField(post.ai_prompt_used, "Subject") || versionEditPrompt || undefined;
    const offerText = extractPromptField(post.ai_prompt_used, "Exact text") || undefined;
    const scenarioType = extractPromptField(post.ai_prompt_used, "Scenario") || "caption-remake";

    const remadeCaption = await ensureCaptionQuality({
        apiKey,
        brandName: brand.company_name,
        companyType: brand.company_type,
        contentLanguage,
        scenarioType,
        subjectDefinition,
        offerText,
        promptContext: [
            "Goal: Refresh the caption while preserving the visible subject, offer, and brand tone.",
            `Generation intent: ${post.ai_prompt_used || "none"}`,
            `Current version edit context: ${versionEditPrompt || "none"}`,
            versionNumber !== null ? `Visible version: v${versionNumber}` : "Visible version: original",
        ].join("\n"),
        candidateCaption: post.caption,
        mode: "remake",
        forceRewrite: true,
    });

    if (!remadeCaption) {
        res.status(500).json({ message: "Could not remake caption right now" });
        return;
    }

    const adminSupabase = createAdminSupabase();
    const { data: updatedPost, error: updateError } = await adminSupabase
        .from("posts")
        .update({ caption: remadeCaption })
        .eq("id", postId)
        .eq("user_id", user.id)
        .select("id")
        .single();

    if (updateError || !updatedPost?.id) {
        console.error("Failed to persist remade caption:", updateError);
        res.status(500).json({ message: "Failed to save remade caption" });
        return;
    }

    res.json({ caption: remadeCaption });
});

/**
 * DELETE /api/posts/:id/versions/:versionNumber
 * Deletes a single version from a post (must belong to authenticated user).
 * - versionNumber=0 means "original": the post's own image is replaced by V1 (promoted),
 *   and V1 is removed from post_versions. Remaining versions are re-numbered.
 * - versionNumber>=1 means a specific version from post_versions.
 * Storage files (image + thumbnail) are cleaned up.
 */
router.delete("/api/posts/:id/versions/:versionNumber", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);

    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;
    const postId = req.params.id as string;
    const versionNumber = parseInt(req.params.versionNumber as string, 10);

    if (isNaN(versionNumber) || versionNumber < 0) {
        res.status(400).json({ message: "Invalid version number" });
        return;
    }

    // Verify post ownership
    const { data: post, error: postError } = await supabase
        .from("posts")
        .select("id, user_id, image_url, thumbnail_url")
        .eq("id", postId)
        .single();

    if (postError || !post) {
        res.status(404).json({ message: "Post not found" });
        return;
    }

    if (post.user_id !== user.id) {
        res.status(403).json({ message: "Access denied" });
        return;
    }

    const extractPathFromUrl = (url: string | null): string | null => {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            const match = urlObj.pathname.match(/\/user_assets\/(.+)$/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    };

    const filesToDelete: string[] = [];

    // Use admin client for mutations — no UPDATE RLS policy on posts or post_versions
    const adminSb = createAdminSupabase();

    if (versionNumber === 0) {
        // Deleting the original: promote V1 to become the new original
        const { data: v1, error: v1Error } = await supabase
            .from("post_versions")
            .select("id, image_url, thumbnail_url")
            .eq("post_id", postId)
            .eq("version_number", 1)
            .single();

        if (v1Error || !v1) {
            res.status(400).json({ message: "Cannot delete the original when there are no other versions" });
            return;
        }

        console.log(`[Delete Original] Post ${postId}: replacing original (${post.image_url}) with V1 (${v1.image_url})`);

        // Collect old original files for cleanup
        const origImgPath = extractPathFromUrl(post.image_url);
        if (origImgPath) filesToDelete.push(origImgPath);
        const origThumbPath = extractPathFromUrl(post.thumbnail_url);
        if (origThumbPath) filesToDelete.push(origThumbPath);

        // Promote V1: update the post's image_url/thumbnail_url to V1's values
        const { error: updateError } = await adminSb
            .from("posts")
            .update({
                image_url: v1.image_url,
                thumbnail_url: v1.thumbnail_url || null,
            })
            .eq("id", postId);

        if (updateError) {
            console.error(`[Delete Original] Failed to promote:`, updateError);
            res.status(500).json({ message: "Failed to promote version" });
            return;
        }

        // Delete V1 from post_versions (it's now the original)
        const { error: v1DeleteError } = await adminSb.from("post_versions").delete().eq("id", v1.id);
        if (v1DeleteError) {
            console.error(`[Delete Original] Failed to delete V1 from versions:`, v1DeleteError);
        }

        console.log(`[Delete Original] Post ${postId}: done. V1 promoted, old original files queued for cleanup.`);
    } else {
        // Deleting a specific version from post_versions
        const { data: targetVersion, error: versionError } = await supabase
            .from("post_versions")
            .select("id, image_url, thumbnail_url")
            .eq("post_id", postId)
            .eq("version_number", versionNumber)
            .single();

        if (versionError || !targetVersion) {
            res.status(404).json({ message: "Version not found" });
            return;
        }

        const { error: deleteError } = await supabase
            .from("post_versions")
            .delete()
            .eq("id", targetVersion.id);

        if (deleteError) {
            res.status(500).json({ message: "Failed to delete version" });
            return;
        }

        const imgPath = extractPathFromUrl(targetVersion.image_url);
        if (imgPath) filesToDelete.push(imgPath);
        const thumbPath = extractPathFromUrl(targetVersion.thumbnail_url);
        if (thumbPath) filesToDelete.push(thumbPath);
    }

    // Clean up storage files
    if (filesToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
            .from("user_assets")
            .remove(filesToDelete);
        if (storageError) {
            console.warn(`[Storage Cleanup] Failed to delete version files:`, storageError.message);
        }
    }

    // Re-number remaining versions sequentially (1, 2, 3…)
    // Use negative temp values first to avoid unique constraint violations on (post_id, version_number).
    const { data: remainingVersions } = await adminSb
        .from("post_versions")
        .select("id, version_number")
        .eq("post_id", postId)
        .order("version_number", { ascending: true });

    if (remainingVersions && remainingVersions.length > 0) {
        const needsRenumber = remainingVersions.some((v, i) => v.version_number !== i + 1);
        if (needsRenumber) {
            // Step 1: set to negative temp values to avoid unique index conflicts
            for (let i = 0; i < remainingVersions.length; i++) {
                await adminSb
                    .from("post_versions")
                    .update({ version_number: -(i + 1) })
                    .eq("id", remainingVersions[i].id);
            }
            // Step 2: set to final sequential values
            for (let i = 0; i < remainingVersions.length; i++) {
                await adminSb
                    .from("post_versions")
                    .update({ version_number: i + 1 })
                    .eq("id", remainingVersions[i].id);
            }
        }
    }

    res.json({ success: true, message: "Version deleted", remaining_count: remainingVersions?.length || 0 });
});

/**
 * DELETE /api/posts/:id
 * Deletes a post by ID (must belong to authenticated user)
 * Also deletes associated images from storage
 */
router.delete("/api/posts/:id", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);

    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user, supabase } = authResult;
    const { id } = req.params;

    // Verify ownership before deletion and get image URLs
    const { data: post, error: fetchError } = await supabase
        .from("posts")
        .select("id, user_id, image_url, thumbnail_url")
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

    // Get all version image URLs before deletion
    const { data: versions } = await supabase
        .from("post_versions")
        .select("image_url, thumbnail_url")
        .eq("post_id", id);

    // Collect all file paths to delete from storage
    const filesToDelete: string[] = [];

    // Helper to extract path from URL
    const extractPathFromUrl = (url: string | null): string | null => {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            // Path format: /storage/v1/object/public/user_assets/{path}
            const match = urlObj.pathname.match(/\/user_assets\/(.+)$/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    };

    // Add post images
    const postImagePath = extractPathFromUrl(post.image_url);
    if (postImagePath) filesToDelete.push(postImagePath);
    const postThumbnailPath = extractPathFromUrl(post.thumbnail_url);
    if (postThumbnailPath) filesToDelete.push(postThumbnailPath);

    // Add version images
    for (const version of versions || []) {
        const versionImagePath = extractPathFromUrl(version.image_url);
        if (versionImagePath) filesToDelete.push(versionImagePath);
        const versionThumbnailPath = extractPathFromUrl(version.thumbnail_url);
        if (versionThumbnailPath) filesToDelete.push(versionThumbnailPath);
    }

    // Delete the post (cascade will delete versions)
    const { error: deleteError } = await supabase
        .from("posts")
        .delete()
        .eq("id", id);

    if (deleteError) {
        res.status(500).json({ message: "Failed to delete post" });
        return;
    }

    // Delete files from storage (non-blocking, don't fail if this errors)
    if (filesToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
            .from("user_assets")
            .remove(filesToDelete);

        if (storageError) {
            console.warn(`[Storage Cleanup] Failed to delete some files for post ${id}:`, storageError.message);
        } else {
            console.log(`[Storage Cleanup] Deleted ${filesToDelete.length} files for post ${id}`);
        }
    }

    res.json({ success: true, message: "Post deleted" });
});

export default router;
