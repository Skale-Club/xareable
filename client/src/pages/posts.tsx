import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { usePostCreator } from "@/lib/post-creator";
import { usePostViewer } from "@/lib/post-viewer";
import { supabase } from "@/lib/supabase";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageIcon, Trash2, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import type { PostGalleryItem } from "@shared/schema";

const POSTS_PER_PAGE = 12;

export default function PostsPage() {
  const { user } = useAuth();
  const { openCreator, createdVersion } = usePostCreator();
  const { openViewer, viewingPost } = usePostViewer();
  const { t } = useTranslation();
  const [posts, setPosts] = useState<PostGalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

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

        const [{ count, error: countError }, { data: postRows, error: postsError }] = await Promise.all([
          sb
            .from("posts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),
          sb
            .from("posts")
            .select("id, created_at, image_url, caption")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .range(from, to),
        ]);

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
            image_url: latestVersion?.image_url || post.image_url,
            original_image_url: post.image_url,
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

  async function handleDelete(postId: string) {
    const sb = supabase();
    await sb.from("posts").delete().eq("id", postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    setTotalCount((prev) => Math.max(0, prev - 1));
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
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

          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <Skeleton className="aspect-square w-full rounded-md mb-3" />
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}

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
                          alt="Post"
                          className="w-full h-full object-contain"
                          loading="lazy"
                          style={{ imageRendering: "crisp-edges" }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
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
            {t("Page")} {currentPage} {t("of")} {totalPages} • {totalCount} {t("posts total")}
          </p>
        )}
      </div>
    </div>
  );
}
