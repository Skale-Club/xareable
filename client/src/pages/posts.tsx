import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { usePostCreator } from "@/lib/post-creator";
import { usePostViewer } from "@/lib/post-viewer";
import { supabase } from "@/lib/supabase";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ImageIcon, Trash2, Plus, ChevronLeft, ChevronRight, VideoIcon, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import { PageLoader } from "@/components/page-loader";
import type { PostGalleryItem } from "@shared/schema";
import { blobToBase64, createImagePreviewWebp, extractVideoThumbnailWebp, isVideoUrl } from "@/lib/media";
import { QuickRemakeGeneratingState } from "@/components/quick-remake-generating-state";

const POSTS_PER_PAGE = 12;
const MAX_BACKFILL_RETRIES = 2;

type GalleryPost = PostGalleryItem & {
  preview_source_url?: string | null;
  preview_version_number?: number | null;
};

export default function PostsPage() {
  const { user } = useAuth();
  const { openCreator, createdVersion } = usePostCreator();
  const { openViewer, viewingPost } = usePostViewer();
  const { toast } = useToast();
  const { language, t } = useTranslation();
  const [posts, setPosts] = useState<GalleryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [remakingPostId, setRemakingPostId] = useState<string | null>(null);
  const [quickRemakeProgress, setQuickRemakeProgress] = useState(0);
  const [quickRemakeMessage, setQuickRemakeMessage] = useState("");
  const [pendingQuickRemakePostId, setPendingQuickRemakePostId] = useState<string | null>(null);
  const [pendingDeletePostId, setPendingDeletePostId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [localVideoThumbUrls, setLocalVideoThumbUrls] = useState<Record<string, string>>({});
  const localVideoThumbUrlsRef = useRef<Record<string, string>>({});
  const thumbnailBackfillInFlight = useRef<Set<string>>(new Set());
  const thumbnailBackfillFailCount = useRef<Record<string, number>>({});

  const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

  // ── Fetch posts + versions ──
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
            .select("id, created_at, image_url, thumbnail_url, content_type, caption, ai_prompt_used")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .range(from, to),
        ]);

        if (countError) throw countError;
        if (postsQueryResult.error) throw postsQueryResult.error;

        const postRows = postsQueryResult.data || [];
        const postIds = postRows.map((post) => post.id);
        let versionsByPost: Record<
          string,
          Array<{ image_url: string; thumbnail_url: string | null; version_number: number }>
        > = {};

        if (postIds.length > 0) {
          const { data: versionRows, error: versionsError } = await sb
            .from("post_versions")
            .select("post_id, image_url, thumbnail_url, version_number")
            .in("post_id", postIds);

          if (!versionsError && versionRows) {
            versionsByPost = versionRows.reduce((
              acc: Record<string, Array<{ image_url: string; thumbnail_url: string | null; version_number: number }>>,
              row,
            ) => {
              if (!row.post_id) return acc;
              if (!acc[row.post_id]) acc[row.post_id] = [];
              acc[row.post_id].push({
                image_url: row.image_url,
                thumbnail_url: row.thumbnail_url || null,
                version_number: row.version_number,
              });
              return acc;
            }, {});
          }
        }

        const galleryPosts: GalleryPost[] = postRows.map((post) => {
          const postVersions = versionsByPost[post.id] || [];
          const latestVersion = postVersions.reduce((latest, version) => {
            if (!latest || version.version_number > latest.version_number) {
              return version;
            }

            return latest;
          }, null as { image_url: string; thumbnail_url: string | null; version_number: number } | null);

          const isVideoPost = post.content_type === "video" || isVideoUrl(post.image_url);

          // Card preview: always show the latest version's image when available.
          // For videos: prefer thumbnail (since we can't render video inline in a grid).
          // For images: prefer the latest version's full image, fall back to thumbnails, then original.
          let cardPreviewUrl: string | null;
          if (isVideoPost) {
            cardPreviewUrl = latestVersion?.thumbnail_url || post.thumbnail_url || null;
          } else if (latestVersion) {
            cardPreviewUrl = latestVersion.thumbnail_url || latestVersion.image_url || post.thumbnail_url || post.image_url;
          } else {
            cardPreviewUrl = post.thumbnail_url || post.image_url;
          }

          const previewSourceUrl = isVideoPost
            ? latestVersion?.image_url || post.image_url || null
            : post.image_url || null;

          return {
            id: post.id,
            created_at: post.created_at,
            image_url: cardPreviewUrl,
            original_image_url: post.image_url,
            thumbnail_url: isVideoPost
              ? (latestVersion?.thumbnail_url || null)
              : (post.thumbnail_url || null),
            preview_source_url: previewSourceUrl,
            preview_version_number: isVideoPost ? (latestVersion?.version_number || null) : null,
            content_type: isVideoPost ? "video" : "image",
            caption: post.caption,
            ai_prompt_used: post.ai_prompt_used,
            version_count: postVersions.length,
          };
        });

        if (!isMounted) return;

        setTotalCount(count || 0);
        setPosts(galleryPosts);
      } catch (error) {
        if (!isMounted) return;

        console.error("Failed to load posts:", error);
        setPosts([]);
        setTotalCount(0);
        toast({
          title: t("Failed to load posts"),
          description: t("Please try refreshing the page."),
          variant: "destructive",
        });
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [user, createdVersion, currentPage, refreshTick]);

  useEffect(() => {
    localVideoThumbUrlsRef.current = localVideoThumbUrls;
  }, [localVideoThumbUrls]);

  useEffect(() => {
    function handleCaptionUpdated(event: Event) {
      const customEvent = event as CustomEvent<{ postId?: string; caption?: string | null }>;
      const postId = customEvent.detail?.postId;
      if (!postId) return;
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? { ...post, caption: customEvent.detail?.caption ?? post.caption }
            : post,
        ),
      );
    }

    function handleVersionChanged() {
      setRefreshTick((v) => v + 1);
    }

    window.addEventListener("post:caption-updated", handleCaptionUpdated as EventListener);
    window.addEventListener("post:version-deleted", handleVersionChanged);
    window.addEventListener("post:version-created", handleVersionChanged);
    return () => {
      window.removeEventListener("post:caption-updated", handleCaptionUpdated as EventListener);
      window.removeEventListener("post:version-deleted", handleVersionChanged);
      window.removeEventListener("post:version-created", handleVersionChanged);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of Object.values(localVideoThumbUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  // ── Thumbnail backfill (with retry limit to prevent infinite loops) ──
  useEffect(() => {
    let cancelled = false;

    const missingPreviews = posts.filter((post) => {
      if (post.thumbnail_url) return false;
      // Skip if max retries exceeded
      if ((thumbnailBackfillFailCount.current[post.id] || 0) >= MAX_BACKFILL_RETRIES) return false;
      if (post.content_type === "video") {
        return !!post.preview_source_url;
      }
      return !!post.original_image_url;
    });

    if (missingPreviews.length === 0) return;

    void (async () => {
      for (const post of missingPreviews) {
        if (cancelled) break;
        if (thumbnailBackfillInFlight.current.has(post.id)) continue;

        thumbnailBackfillInFlight.current.add(post.id);
        try {
          const sourceUrl = post.content_type === "video"
            ? post.preview_source_url
            : post.original_image_url;
          if (!sourceUrl) continue;

          const previewBlob = post.content_type === "video"
            ? await extractVideoThumbnailWebp(sourceUrl)
            : await createImagePreviewWebp(sourceUrl);

          if (post.content_type === "video") {
            const localUrl = URL.createObjectURL(previewBlob);
            setLocalVideoThumbUrls((current) => {
              const previous = current[post.id];
              if (previous) URL.revokeObjectURL(previous);
              return { ...current, [post.id]: localUrl };
            });
          }

          const base64 = await blobToBase64(previewBlob);
          const response = await apiRequest("POST", `/api/posts/${post.id}/thumbnail`, {
            file: base64,
            contentType: "image/webp",
            ...(post.content_type === "video" && post.preview_version_number
              ? { version_number: post.preview_version_number }
              : {}),
          });
          const payload = await response.json() as { thumbnail_url?: string };
          if (!cancelled && payload.thumbnail_url) {
            setPosts((current) =>
              current.map((item) =>
                item.id === post.id
                  ? {
                    ...item,
                    thumbnail_url: payload.thumbnail_url || null,
                    image_url:
                      item.content_type === "video"
                        ? (payload.thumbnail_url || item.image_url)
                        : (item.version_count > 0 ? item.image_url : (payload.thumbnail_url || item.image_url)),
                  }
                  : item,
              ),
            );

            if (post.content_type === "video") {
              setLocalVideoThumbUrls((current) => {
                const previous = current[post.id];
                if (previous) URL.revokeObjectURL(previous);
                const next = { ...current };
                delete next[post.id];
                return next;
              });
            }
          }
        } catch (error) {
          console.warn("Preview backfill failed:", error);
          thumbnailBackfillFailCount.current[post.id] =
            (thumbnailBackfillFailCount.current[post.id] || 0) + 1;
        } finally {
          thumbnailBackfillInFlight.current.delete(post.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [posts]);

  // ── Delete post via API (cleans up storage files server-side) ──
  async function handleDelete(postId: string) {
    setIsDeleting(true);
    try {
      await apiRequest("DELETE", `/api/posts/${postId}`);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setTotalCount((prev) => Math.max(0, prev - 1));
      setPendingDeletePostId(null);
    } catch (error) {
      console.error("Delete failed:", error);
      toast({
        title: t("Delete failed"),
        description: t("Could not delete this post."),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDeletePostId || isDeleting) return;
    await handleDelete(pendingDeletePostId);
  }

  async function handleQuickRemake(postId: string) {
    if (remakingPostId) return;

    const sb = supabase();
    const targetPost = posts.find((item) => item.id === postId);
    const isVideoPost = targetPost?.content_type === "video";
    setRemakingPostId(postId);
    setQuickRemakeProgress(0);
    setQuickRemakeMessage("Creating a new variation...");
    const progressInterval = setInterval(() => {
      setQuickRemakeProgress((value) => {
        if (value < 30) {
          setQuickRemakeMessage("Analyzing current design...");
          return value + 2;
        }
        if (value < 65) {
          setQuickRemakeMessage("Applying new creative variation...");
          return value + 1.5;
        }
        if (value < 92) {
          setQuickRemakeMessage(isVideoPost ? "Rendering your remade video..." : "Rendering your remade image...");
          return value + 0.8;
        }
        return value;
      });
    }, 300);

    try {
      const { data, error } = await sb
        .from("posts")
        .select("ai_prompt_used")
        .eq("id", postId)
        .single();

      if (error) {
        throw error;
      }

      const aiPromptUsed = data?.ai_prompt_used as string | null;
      if (!aiPromptUsed) {
        throw new Error(t("This post has no saved generation prompt."));
      }

      const remixPrompt = `Create a new variation of this image while preserving the same core message, brand consistency, and visual direction. Original generation intent: ${aiPromptUsed}`;

      const response = await apiRequest("POST", "/api/edit-post", {
        post_id: postId,
        edit_prompt: remixPrompt,
        content_language: language,
        source: "quick_remake",
      });
      const payload = await response.json() as {
        version_number?: number;
        image_url?: string;
        thumbnail_url?: string | null;
      };

      if (
        isVideoPost &&
        postId &&
        typeof payload.version_number === "number" &&
        payload.version_number > 0 &&
        payload.image_url &&
        !payload.thumbnail_url
      ) {
        try {
          const previewBlob = await extractVideoThumbnailWebp(payload.image_url);
          const previewBase64 = await blobToBase64(previewBlob);
          await apiRequest("POST", `/api/posts/${postId}/thumbnail`, {
            file: previewBase64,
            contentType: "image/webp",
            version_number: payload.version_number,
          });
        } catch (previewError) {
          console.warn("Video version thumbnail generation failed:", previewError);
        }
      }

      setQuickRemakeProgress(100);
      setQuickRemakeMessage("Done!");
      const selectedPost = posts.find((item) => item.id === postId);
      if (selectedPost) {
        openViewer({
          id: selectedPost.id,
          user_id: user?.id || "",
          image_url: selectedPost.original_image_url,
          thumbnail_url: selectedPost.thumbnail_url || null,
          content_type: selectedPost.content_type,
          caption: selectedPost.caption,
          ai_prompt_used: aiPromptUsed,
          status: "generated",
          created_at: selectedPost.created_at,
        });
      }
      setRefreshTick((value) => value + 1);
    } catch (error) {
      console.error("Quick remake failed:", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("Could not remake this post right now.");
      toast({
        title: t("Quick Remake failed"),
        description: message,
        variant: "destructive",
      });
    } finally {
      clearInterval(progressInterval);
      setRemakingPostId(null);
    }
  }

  async function handleConfirmQuickRemake() {
    if (!pendingQuickRemakePostId || remakingPostId) return;
    const targetPostId = pendingQuickRemakePostId;
    setPendingQuickRemakePostId(null);
    await handleQuickRemake(targetPostId);
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
      <div className="w-full mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-posts-title">
            {t("Dashboard")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("Your generated social media posts live here. Start a new one from the first tile.")}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
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
                  className={`group cursor-pointer hover-elevate transition-all ${viewingPost?.id === post.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => openViewer({
                    id: post.id,
                    user_id: user?.id || "",
                    image_url: post.original_image_url,
                    thumbnail_url: post.thumbnail_url || null,
                    content_type: post.content_type,
                    caption: post.caption,
                    ai_prompt_used: post.ai_prompt_used || null,
                    status: "generated",
                    created_at: post.created_at,
                  })}
                  data-testid={`card-post-${post.id}`}
                >
                  <CardContent className="p-3">
                    <div className="relative aspect-square rounded-md overflow-hidden bg-muted/50 mb-3 border border-border/50">
                      {post.content_type === "video" ? (
                        post.thumbnail_url || localVideoThumbUrls[post.id] || post.image_url ? (
                          <img
                            src={post.thumbnail_url || localVideoThumbUrls[post.id] || post.image_url || ""}
                            alt={t("Post")}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )
                      ) : post.image_url ? (
                        <img
                          src={post.image_url}
                          alt={t("Post")}
                          className="w-full h-full object-cover"
                          loading="lazy"
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
                          V{post.version_count + 1}
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
                      <div className="flex items-center gap-1">
                        <TooltipProvider delayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingQuickRemakePostId(post.id);
                                }}
                                disabled={remakingPostId === post.id}
                                data-testid={`button-quick-remake-${post.id}`}
                              >
                                <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>{t("Quick Remake")}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider delayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDeletePostId(post.id);
                                }}
                                data-testid={`button-delete-${post.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>{t("Delete")}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
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

      <AlertDialog open={!!pendingDeletePostId} onOpenChange={(open) => !open && !isDeleting && setPendingDeletePostId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete post?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This action cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-post"
            >
              {isDeleting ? t("Deleting...") : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingQuickRemakePostId} onOpenChange={(open) => !open && !remakingPostId && setPendingQuickRemakePostId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Quick remake this post?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("A new version will be generated and the current one will be kept.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!remakingPostId}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmQuickRemake();
              }}
              disabled={!!remakingPostId}
              data-testid="button-confirm-quick-remake"
            >
              {remakingPostId ? t("Creating...") : t("Quick Remake")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!remakingPostId}>
        <DialogContent className="max-w-2xl h-[80vh] max-h-[80vh] p-0 overflow-hidden" data-testid="dialog-quick-remake-generating">
          <div className="relative h-full">
            <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-6">
              <QuickRemakeGeneratingState
                progress={quickRemakeProgress}
                message={quickRemakeMessage}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
