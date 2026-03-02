import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { usePostCreator } from "@/lib/post-creator";
import { usePostViewer } from "@/lib/post-viewer";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, ImageIcon, Calendar, Trash2, Plus } from "lucide-react";
import { motion } from "framer-motion";
import type { Post } from "@shared/schema";

export default function PostsPage() {
  const { user } = useAuth();
  const { openCreator, createdVersion } = usePostCreator();
  const { openViewer, viewingPost } = usePostViewer();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const sb = supabase();
    sb.from("posts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setPosts(data || []);
        setLoading(false);
      });
  }, [user, createdVersion]);

  async function handleDelete(postId: string) {
    const sb = supabase();
    await sb.from("posts").delete().eq("id", postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
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
            My Posts
          </h1>
          <p className="text-muted-foreground mt-1">
            Your generated social media posts live here. Start a new one from the first tile.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => openCreator()}
            className="h-full rounded-xl border-2 border-dashed border-border hover:border-violet-400/70 hover:bg-violet-400/5 transition-all p-5 text-left"
            data-testid="card-create-post"
          >
            <div className="h-full flex flex-col justify-between">
              <div className="w-12 h-12 rounded-xl bg-violet-400/15 flex items-center justify-center">
                <Plus className="w-6 h-6 text-pink-400" />
              </div>
              <div>
                <p className="font-semibold text-base">Create New Post</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Open the guided popup and build one post at a time.
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
                  className={`cursor-pointer hover-elevate transition-all ${viewingPost?.id === post.id ? "ring-2 ring-primary" : ""
                    }`}
                  onClick={() => openViewer(post)}
                  data-testid={`card-post-${post.id}`}
                >
                  <CardContent className="p-3">
                    <div className="aspect-square rounded-md overflow-hidden bg-muted/50 mb-3 border border-border/50">
                      {post.image_url ? (
                        <img
                          src={post.image_url}
                          alt="Post"
                          className="w-full h-full object-contain"
                          loading="lazy"
                          style={{ imageRendering: 'crisp-edges' }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <p className="text-sm line-clamp-2 mb-2">
                      {post.caption || "No caption"}
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
                          handleDelete(post.id);
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
      </div>
    </div>
  );
}
