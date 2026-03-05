import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { usePostCreator } from "@/lib/post-creator";
import { usePostViewer } from "@/lib/post-viewer";
import { supabase } from "@/lib/supabase";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageIcon, Trash2, Plus, ChevronLeft, ChevronRight, VideoIcon } from "lucide-react";
import { motion } from "framer-motion";
import { PageLoader } from "@/components/page-loader";
import type { PostGalleryItem } from "@shared/schema";
import { blobToBase64, extractVideoThumbnailJpeg, isVideoUrl } from "@/lib/media";

const POSTS_PER_PAGE = 12;

export default function PostsPage() {
  const { user } = useAuth();
  const { openCreator, createdVersion } = usePostCreator();
  const { openViewer, viewingPost } = usePostViewer();
  const { language, t } = useTranslation();
  const [posts, setPosts] = useState<PostGalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const thumbnailBackfillInFlight = useRef<Set<string>>(new Set());

  const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);
  const isMissingColumnError = (error: any) =>
    typeof error?.message === "string" &&
    error.message.toLowerCase().includes("column") &&
    error.message.toLowerCase().includes("does not exist");

  useEffect(() => {
    if (!user) {
      setPosts([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    const sb = supabase();

    (async () => {
      try {
        const from = (currentPage - 1) * POSTS_PER_PAGE;
        const to = from + POSTS_PER_PAGE - 1;

        const [{ count, error: countError }, postsQueryResult] = await Promise.all([
          sb
            .from("posts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),
          sb
            .from("posts")
            .select("id, created_at, image_url, thumbnail_url, content_type, caption")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .range(from, to),
        ]);

        let postRows = postsQueryResult.data;
        let postsError = postsQueryResult.error;

        if (postsError && isMissingColumnError(postsError)) {
          const fallback = await sb
            .from("posts")
            .select("id, created_at, image_url, caption")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .range(from, to);
          postRows = fallback.data as any;
          postsError = fallback.error as any;
        }

        if (countError) {
          throw countError;
        }

        if (postsError) {
          throw postsError;
        }

        const postIds = (postRows || []).map((post) => post.id);
        let versionsByPost: Record<string, Array<{ image_url: string; version_number: number }>> = {};

        if (postIds.length > 0) {
          const { data: versionRows, error: versionsError } = await sb
            .from("post_versions")
            .select("post_id, image_url, version_number")
            .in("post_id", postIds);

          if (!versionsError && versionRows) {
            versionsByPost = versionRows.reduce((acc: Record<string, Array<{ image_url: string; version_number: number }>>, row) => {
              if (!row.post_id) {
                return acc;
              }

              if (!acc[row.post_id]) {
                acc[row.post_id] = [];
              }

              acc[row.post_id].push({
                image_url: row.image_url,
                version_number: row.version_number,
              });
              return acc;
            }, {});
          }
        }

        const galleryPosts: PostGalleryItem[] = (postRows || []).map((post) => {
          const postVersions = versionsByPost[post.id] || [];
          const latestVersion = postVersions.reduce((latest, version) => {
            if (!latest || version.version_number > latest.version_number) {
              return version;
            }

            return latest;
          }, null as { image_url: string; version_number: number } | null);

          return {
            id: post.id,
            created_at: post.created_at,
            image_url:
              (post.content_type === "video" || isVideoUrl(post.image_url))
                ? post.thumbnail_url || null
                : latestVersion?.image_url || post.image_url,
            original_image_url: post.image_url,
            thumbnail_url: post.thumbnail_url || null,
            content_type:
              post.content_type === "video" || isVideoUrl(post.image_url)
                ? "video"
                : "image",
            caption: post.caption,
            version_count: postVersions.length,
          };
        });

        if (!isMounted) {
          return;
        }

        setTotalCount(count || 0);
        setPosts(galleryPosts);
      } catch {
        if (!isMounted) {
          return;
        }

        setPosts([]);
        setTotalCount(0);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [user, createdVersion, currentPage]);

  useEffect(() => {
    let cancelled = false;

    const missingVideoThumbs = posts.filter(
      (post) => post.content_type === "video" && !post.thumbnail_url && !!post.original_image_url,
    );

    if (missingVideoThumbs.length === 0) {
      return;
    }

    void (async () => {
      for (const post of missingVideoThumbs) {
        if (cancelled) break;
        if (thumbnailBackfillInFlight.current.has(post.id)) continue;

        thumbnailBackfillInFlight.current.add(post.id);
        try {
          const thumbnailBlob = await extractVideoThumbnailJpeg(post.original_image_url!);
          const base64 = await blobToBase64(thumbnailBlob);
          const response = await apiRequest("POST", `/api/posts/${post.id}/thumbnail`, {
            file: base64,
            contentType: "image/jpeg",
          });
          const payload = await response.json() as { thumbnail_url?: string };
          if (!cancelled && payload.thumbnail_url) {
            setPosts((current) =>
              current.map((item) =>
                item.id === post.id
                  ? {
                    ...item,
                    thumbnail_url: payload.thumbnail_url || null,
                    image_url: payload.thumbnail_url || null,
                  }
                  : item,
              ),
            );
          }
        } catch (error) {
          console.warn("Video thumbnail backfill failed:", error);
        } finally {
          thumbnailBackfillInFlight.current.delete(post.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [posts]);

  async function handleDelete(postId: string) {
    const sb = supabase();
    await sb.from("posts").delete().eq("id", postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    setTotalCount((prev) => Math.max(0, prev - 1));
  }

  function formatDate(dateStr: string) {
    const locale = language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US";

    return new Date(dateStr).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="flex-1 overflow-auto" data-testid="posts-page">
      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-posts-title">
            {t("Dashboard")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("Your generated social media posts live here. Start a new one from the first tile.")}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => openCreator()}
            className="h-full min-h-[240px] rounded-xl border-2 border-dashed border-border hover:border-violet-400/70 hover:bg-violet-400/5 transition-all p-5 text-left"
            data-testid="card-create-post"
          >
            <div className="h-full flex flex-col justify-between">
              <div className="w-12 h-12 rounded-xl bg-violet-400/15 flex items-center justify-center">
                <Plus className="w-6 h-6 text-pink-400" />
              </div>
              <div>
                <p className="font-semibold text-base">{t("Create New Post")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("Open the guided popup and build one post at a time.")}
                </p>
              </div>
            </div>
          </motion.button>

          {loading && <PageLoader fullscreen={false} />}

          {!loading &&
            posts.map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.2) }}
              >
                <Card
                  className={`cursor-pointer hover-elevate transition-all ${viewingPost?.id === post.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => openViewer({
                    id: post.id,
                    user_id: user?.id || "",
                    image_url: post.original_image_url,
                    thumbnail_url: post.thumbnail_url || null,
                    content_type: post.content_type,
                    caption: post.caption,
                    ai_prompt_used: null,
                    status: "generated",
                    created_at: post.created_at,
                  })}
                  data-testid={`card-post-${post.id}`}
                >
                  <CardContent className="p-3">
                    <div className="relative aspect-square rounded-md overflow-hidden bg-muted/50 mb-3 border border-border/50">
                      {post.image_url ? (
                        <img
                          src={post.image_url}
                          alt={t("Post")}
                          className="w-full h-full object-contain"
                          loading="lazy"
                          style={{ imageRendering: "crisp-edges" }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-1 text-white">
                        {post.content_type === "video" ? (
                          <VideoIcon className="w-3.5 h-3.5" />
                        ) : (
                          <ImageIcon className="w-3.5 h-3.5" />
                        )}
                      </div>
                      {post.version_count > 0 && (
                        <div className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                          V{post.version_count}
                        </div>
                      )}
                    </div>
                    <p className="text-sm line-clamp-2 mb-2">
                      {post.caption || t("No caption")}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(post.created_at)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(post.id);
                        }}
                        data-testid={`button-delete-${post.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              {t("Previous")}
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((page) => {
                  if (page === 1 || page === totalPages) return true;
                  if (Math.abs(page - currentPage) <= 1) return true;
                  return false;
                })
                .map((page, index, arr) => (
                  <span key={page}>
                    {index > 0 && arr[index - 1] !== page - 1 && (
                      <span className="px-2 text-muted-foreground">...</span>
                    )}
                    <Button
                      variant={currentPage === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                      className="w-9 h-9 p-0"
                    >
                      {page}
                    </Button>
                  </span>
                ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="gap-1"
            >
              {t("Next")}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {!loading && totalCount > 0 && totalPages > 1 && (
          <p className="text-center text-sm text-muted-foreground mt-4">
            {t("Page")} {currentPage} {t("of")} {totalPages} | {totalCount} {t("posts total")}
          </p>
        )}
      </div>
    </div>
  );
}
