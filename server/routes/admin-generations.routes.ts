/**
 * Admin Generations Routes (extracted from admin.routes.ts — SEED-004)
 * GET /api/admin/generations — list all generation attempts (posts + edits + failed logs)
 */

import { Router } from "express";
import { createAdminSupabase } from "../supabase.js";
import { requireAdminGuard } from "../middleware/auth.middleware.js";

const router = Router();

// Local copy of the shared helper (originally in admin.routes.ts top-level utils).
function toSafeNumber(value: unknown): number {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
}

/**
 * GET /api/admin/generations
 * List all generation attempts (success and failures).
 * Query params:
 *   - page: number (default 1)
 *   - limit: number (default 20, max 100)
 *   - status: 'all' | 'completed' | 'failed' (default 'all')
 *   - content_type: 'all' | 'image' | 'video' (default 'all')
 *   - search: string (searches user email and prompt)
 */
router.get("/api/admin/generations", async (req, res) => {
    const admin = await requireAdminGuard(req, res);
    if (!admin) return;

    const sb = createAdminSupabase();

    const isMissingSchemaTable = (error: any, table: string) =>
        typeof error?.message === "string" &&
        error.message.includes(
            `Could not find the table 'public.${table}' in the schema cache`
        );

    const isMissingColumn = (error: any, column: string) => {
        const message = String(error?.message || "").toLowerCase();
        return (
            message.includes("column") &&
            message.includes(column.toLowerCase()) &&
            message.includes("does not exist")
        );
    };

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const statusFilter = (req.query.status as string) || "all";
    const contentTypeFilter = (req.query.content_type as string) || "all";
    const searchQuery = ((req.query.search as string) || "").toLowerCase().trim();

    try {
        const fetchLimit = 500;

        const logsResult = await sb
            .from("generation_logs")
            .select("id, user_id, created_at, error_message, request_params, error_type, status")
            .order("created_at", { ascending: false })
            .limit(fetchLimit);

        if (logsResult.error && !isMissingSchemaTable(logsResult.error, "generation_logs")) {
            console.error("Failed to load generation logs:", logsResult.error);
            return res.status(500).json({ message: logsResult.error.message || "Failed to load generations" });
        }

        let postsResult: any = await sb
            .from("posts")
            .select("id, user_id, created_at, image_url, thumbnail_url, content_type, ai_prompt_used, caption")
            .order("created_at", { ascending: false })
            .limit(fetchLimit);

        if (
            postsResult.error &&
            (isMissingColumn(postsResult.error, "thumbnail_url") ||
                isMissingColumn(postsResult.error, "content_type"))
        ) {
            postsResult = await sb
                .from("posts")
                .select("id, user_id, created_at, image_url, ai_prompt_used, caption")
                .order("created_at", { ascending: false })
                .limit(fetchLimit);
        }

        if (postsResult.error) {
            console.error("Failed to load successful posts for generations:", postsResult.error);
            return res.status(500).json({ message: postsResult.error.message || "Failed to load generations" });
        }

        let versionsResult: any = await sb
            .from("post_versions")
            .select("id, post_id, version_number, image_url, thumbnail_url, edit_prompt, created_at")
            .order("created_at", { ascending: false })
            .limit(fetchLimit);

        if (versionsResult.error && isMissingColumn(versionsResult.error, "thumbnail_url")) {
            versionsResult = await sb
                .from("post_versions")
                .select("id, post_id, version_number, image_url, edit_prompt, created_at")
                .order("created_at", { ascending: false })
                .limit(fetchLimit);
        }

        if (versionsResult.error && !isMissingSchemaTable(versionsResult.error, "post_versions")) {
            console.error("Failed to load post versions for generations:", versionsResult.error);
            return res.status(500).json({ message: versionsResult.error.message || "Failed to load generations" });
        }

        const postMetaById: Record<
            string,
            { user_id: string; content_type?: string | null; ai_prompt_used?: string | null }
        > = Object.fromEntries(
            (postsResult.data || []).map((post: any) => [
                post.id,
                { user_id: post.user_id, content_type: post.content_type, ai_prompt_used: post.ai_prompt_used },
            ])
        );

        const versionPostIds: string[] = Array.from(
            new Set(
                (versionsResult.data || [])
                    .map((v: any) => (typeof v.post_id === "string" ? v.post_id : null))
                    .filter((id: string | null): id is string => Boolean(id))
            )
        );
        const missingVersionPostIds = versionPostIds.filter((postId) => !postMetaById[postId]);

        if (missingVersionPostIds.length > 0) {
            const { data: versionPosts, error: versionPostsError } = await sb
                .from("posts")
                .select("id, user_id, content_type, ai_prompt_used")
                .in("id", missingVersionPostIds);

            if (versionPostsError) {
                console.error("Failed to load parent posts for post versions:", versionPostsError);
                return res.status(500).json({ message: versionPostsError.message || "Failed to load generations" });
            }

            for (const post of versionPosts || []) {
                postMetaById[post.id] = {
                    user_id: post.user_id,
                    content_type: post.content_type,
                    ai_prompt_used: post.ai_prompt_used,
                };
            }
        }

        const usagePostIds = Array.from(
            new Set([...(postsResult.data || []).map((post: any) => post.id), ...versionPostIds].filter(Boolean))
        );

        type UsageEventRow = {
            post_id: string | null;
            event_type: string | null;
            created_at: string | null;
            text_input_tokens: number | null;
            text_output_tokens: number | null;
            image_input_tokens: number | null;
            image_output_tokens: number | null;
        };

        const usageByPostId: Record<string, UsageEventRow[]> = {};
        if (usagePostIds.length > 0) {
            const { data: usageRows, error: usageError } = await sb
                .from("usage_events")
                .select("post_id, event_type, created_at, text_input_tokens, text_output_tokens, image_input_tokens, image_output_tokens")
                .in("post_id", usagePostIds);

            if (usageError && !isMissingSchemaTable(usageError, "usage_events")) {
                console.error("Failed to load usage events for generations:", usageError);
                return res.status(500).json({ message: usageError.message || "Failed to load generations" });
            }

            for (const row of (usageRows || []) as UsageEventRow[]) {
                if (!row.post_id) continue;
                if (!usageByPostId[row.post_id]) usageByPostId[row.post_id] = [];
                usageByPostId[row.post_id].push(row);
            }
        }

        const getRowTokensTotal = (row: UsageEventRow | null | undefined): number | null => {
            if (!row) return null;
            const total =
                toSafeNumber(row.text_input_tokens) +
                toSafeNumber(row.text_output_tokens) +
                toSafeNumber(row.image_input_tokens) +
                toSafeNumber(row.image_output_tokens);
            return total > 0 ? total : null;
        };

        const pickClosestUsageEvent = (
            events: UsageEventRow[],
            targetCreatedAt: string | null | undefined,
            preferredType: "generate" | "edit"
        ): UsageEventRow | null => {
            if (!events.length) return null;
            const typedEvents = events.filter((e) => e.event_type === preferredType);
            const source = typedEvents.length > 0 ? typedEvents : events;
            if (!targetCreatedAt) return source[0] || null;
            const targetMs = Date.parse(targetCreatedAt);
            if (!Number.isFinite(targetMs)) return source[0] || null;
            let best: UsageEventRow | null = null;
            let bestDiff = Number.POSITIVE_INFINITY;
            for (const event of source) {
                const eventMs = Date.parse(event.created_at || "");
                if (!Number.isFinite(eventMs)) continue;
                const diff = Math.abs(eventMs - targetMs);
                if (diff < bestDiff) { bestDiff = diff; best = event; }
            }
            return best || source[0] || null;
        };

        const userIds = Array.from(
            new Set(
                [
                    ...(logsResult.data || []).map((l: any) => l.user_id),
                    ...(postsResult.data || []).map((p: any) => p.user_id),
                    ...Object.values(postMetaById).map((p: any) => p?.user_id),
                ].filter(Boolean)
            )
        );
        let profilesMap: Record<string, string> = {};
        if (userIds.length > 0) {
            const { data: profiles } = await sb.from("profiles").select("id, email").in("id", userIds);
            profilesMap = Object.fromEntries((profiles || []).map((p) => [p.id, p.email]));
        }

        const extractLogMeta = (log: any) => {
            let contentType = "image";
            let prompt = null as string | null;
            if (log.request_params) {
                if (log.request_params.content_type) contentType = log.request_params.content_type;
                if (log.request_params.copy_text) prompt = log.request_params.copy_text;
                else if (log.request_params.reference_text) prompt = log.request_params.reference_text;
            }
            return { contentType, prompt };
        };

        const dedupedLogsMap = new Map<string, any>();
        for (const log of logsResult.data || []) {
            const { contentType, prompt } = extractLogMeta(log);
            const createdSecond = typeof log.created_at === "string" ? log.created_at.slice(0, 19) : "";
            const dedupeKey = [log.user_id || "", createdSecond, contentType || "", String(log.error_message || "").trim(), String(prompt || "").trim()].join("|");
            const existing = dedupedLogsMap.get(dedupeKey);
            if (!existing) { dedupedLogsMap.set(dedupeKey, log); continue; }
            if (String(existing.error_type || "") === "unknown" && String(log.error_type || "") !== "unknown") {
                dedupedLogsMap.set(dedupeKey, log);
            }
        }

        const formattedLogs = Array.from(dedupedLogsMap.values()).map((log: any) => {
            const { contentType, prompt } = extractLogMeta(log);
            return {
                id: log.id, user_id: log.user_id,
                user_email: profilesMap[log.user_id] || "Unknown User",
                created_at: log.created_at, original_prompt: prompt,
                content_type: contentType, status: "failed" as const,
                error_message: log.error_message,
                image_url: null as string | null, thumbnail_url: null as string | null,
                tokens_total: null as number | null,
            };
        });

        const formattedPosts = (postsResult.data || []).map((post: any) => {
            const isVideoByUrl = typeof post.image_url === "string" && /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(post.image_url);
            const usageEvent = pickClosestUsageEvent(usageByPostId[post.id] || [], post.created_at, "generate");
            return {
                id: post.id, user_id: post.user_id,
                user_email: profilesMap[post.user_id] || "Unknown User",
                created_at: post.created_at, original_prompt: post.ai_prompt_used,
                content_type: post.content_type === "video" || isVideoByUrl ? "video" : "image",
                status: "completed" as const, error_message: null as string | null,
                image_url: post.image_url,
                thumbnail_url: post.content_type === "video" || isVideoByUrl ? post.thumbnail_url : (post.thumbnail_url || post.image_url),
                tokens_total: getRowTokensTotal(usageEvent),
            };
        });

        const formattedVersions = (versionsResult.data || []).map((version: any) => {
            const parentPost = postMetaById[version.post_id];
            const isVideoByUrl = typeof version.image_url === "string" && /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(version.image_url);
            const isVideo = parentPost?.content_type === "video" || isVideoByUrl;
            const usageEvent = pickClosestUsageEvent(usageByPostId[version.post_id] || [], version.created_at, "edit");
            return {
                id: version.id, user_id: parentPost?.user_id || null,
                user_email: parentPost?.user_id ? profilesMap[parentPost.user_id] || "Unknown User" : "Unknown User",
                created_at: version.created_at,
                original_prompt: version.edit_prompt || parentPost?.ai_prompt_used || null,
                content_type: isVideo ? "video" : "image",
                status: "completed" as const, error_message: null as string | null,
                image_url: version.image_url || null,
                thumbnail_url: isVideo ? (version.thumbnail_url || null) : (version.thumbnail_url || version.image_url || null),
                tokens_total: getRowTokensTotal(usageEvent),
            };
        });

        let allGenerations = [...formattedLogs, ...formattedPosts, ...formattedVersions].sort((a, b) => {
            const aTime = Date.parse(a.created_at || "");
            const bTime = Date.parse(b.created_at || "");
            return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
        });

        if (statusFilter !== "all") allGenerations = allGenerations.filter((g) => g.status === statusFilter);
        if (contentTypeFilter !== "all") allGenerations = allGenerations.filter((g) => g.content_type === contentTypeFilter);
        if (searchQuery) {
            allGenerations = allGenerations.filter(
                (g) =>
                    g.user_email.toLowerCase().includes(searchQuery) ||
                    (g.original_prompt && g.original_prompt.toLowerCase().includes(searchQuery)) ||
                    (g.error_message && g.error_message.toLowerCase().includes(searchQuery))
            );
        }

        const total = allGenerations.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        res.json({
            generations: allGenerations.slice(offset, offset + limit),
            pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
        });
    } catch (err: any) {
        console.error("Failed to load generations:", err);
        res.status(500).json({ message: err?.message || "Failed to load generations" });
    }
});

export default router;
