/**
 * Posts Routes - Post CRUD operations
 * Handles post retrieval and management
 */

import { Router, Request, Response } from "express";
import { postsPageResponseSchema } from "../../shared/schema.js";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { uploadFile } from "../storage.js";
import { createAdminSupabase } from "../supabase.js";

const router = Router();

const SUPPORTED_CONTENT_LANGUAGES = new Set(["en", "pt", "es"] as const);

function normalizeContentLanguage(input: unknown): "en" | "pt" | "es" {
    return typeof input === "string" && SUPPORTED_CONTENT_LANGUAGES.has(input as "en" | "pt" | "es")
        ? (input as "en" | "pt" | "es")
        : "en";
}

function extractGeminiText(data: any): string {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
        return "";
    }
    return parts
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n")
        .trim();
}

function cleanCaptionText(text: string): string {
    if (!text) return "";
    return text
        .replace(/^```(?:text|markdown)?\s*/i, "")
        .replace(/```$/i, "")
        .replace(/^caption:\s*/i, "")
        .trim();
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

async function generateCaptionRemake(params: {
    apiKey: string;
    brandName: string;
    companyType: string;
    aiPromptUsed?: string | null;
    currentCaption?: string | null;
    versionEditPrompt?: string | null;
    contentLanguage: "en" | "pt" | "es";
}): Promise<string | null> {
    try {
        const languageLabel =
            params.contentLanguage === "pt"
                ? "Portuguese"
                : params.contentLanguage === "es"
                    ? "Spanish"
                    : "English";

        const basePrompt = `Rewrite a social media caption for a generated post.
Brand: ${params.brandName}
Industry: ${params.companyType}
Current caption: ${params.currentCaption || "none"}
Generation intent: ${params.aiPromptUsed || "none"}
Current version edit context: ${params.versionEditPrompt || "none"}
Target language: ${languageLabel}

Rules:
- Keep the same core intent, but produce fresh wording
- 2 short paragraphs + hashtags
- Natural marketing tone
- The text must be fully in ${languageLabel}
- Return complete sentences only (no unfinished ending)
- Do not output JSON
- Return only the caption text`;

        const callGemini = async (prompt: string): Promise<string | null> => {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${params.apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.6,
                            maxOutputTokens: 768,
                        },
                    }),
                }
            );

            if (!response.ok) return null;
            const data = await response.json();
            const caption = cleanCaptionText(extractGeminiText(data));
            return caption || null;
        };

        const firstPass = await callGemini(basePrompt);
        if (firstPass && isAcceptableCaption(firstPass)) {
            return firstPass;
        }

        const retryPrompt = `${basePrompt}

Important retry instruction:
- Your previous output was incomplete.
- Return a complete caption that ends with proper punctuation.
- Keep 2 short paragraphs plus hashtags in ${languageLabel}.
- Include at least 3 hashtags in the final block.`;
        const secondPass = await callGemini(retryPrompt);
        if (secondPass && isAcceptableCaption(secondPass)) {
            return secondPass;
        }

        const repairSource = secondPass || firstPass || "";
        if (repairSource) {
            const repairPrompt = `Fix and complete this social media caption in ${languageLabel}.

Broken caption:
${repairSource}

Rules:
- Keep the same meaning and tone.
- Return a complete caption (no truncation).
- 2 short paragraphs + a final hashtag block.
- At least 3 hashtags.
- Return only the final caption text.`;
            const repaired = await callGemini(repairPrompt);
            if (repaired && isAcceptableCaption(repaired)) {
                return repaired;
            }
        }

        return buildCaptionFallback({
            brandName: params.brandName,
            companyType: params.companyType,
            contentLanguage: params.contentLanguage,
        });
    } catch {
        return buildCaptionFallback({
            brandName: params.brandName,
            companyType: params.companyType,
            contentLanguage: params.contentLanguage,
        });
    }
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

    const remadeCaption = await generateCaptionRemake({
        apiKey,
        brandName: brand.company_name,
        companyType: brand.company_type,
        aiPromptUsed: post.ai_prompt_used,
        currentCaption: post.caption,
        versionEditPrompt,
        contentLanguage,
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
