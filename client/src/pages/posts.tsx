import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, ImageIcon, Calendar, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import type { Post } from "@shared/schema";

export default function PostsPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  useEffect(() => {
    if (!user) return;
    const sb = supabase();
    sb.from("posts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setPosts(data || []);
        setLoading(false);
      });
  }, [user]);

  async function handleDelete(postId: string) {
    const sb = supabase();
    await sb.from("posts").delete().eq("id", postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    if (selectedPost?.id === postId) setSelectedPost(null);
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
      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-posts-title">
            Post History
          </h1>
          <p className="text-muted-foreground mt-1">
            All your generated social media content in one place.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <Skeleton className="aspect-square w-full rounded-md mb-3" />
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold mb-1" data-testid="text-empty-posts">
              No posts yet
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Head to the dashboard to generate your first AI-powered social media post.
            </p>
          </motion.div>
        ) : (
          <>
            {selectedPost && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6"
              >
                <Card>
                  <CardContent className="p-5">
                    <div className="flex flex-col md:flex-row gap-5">
                      <div className="md:w-1/2">
                        <div className="rounded-md overflow-hidden bg-muted/50">
                          <img
                            src={selectedPost.image_url || ""}
                            alt="Post"
                            className="w-full h-auto"
                            data-testid="img-selected-post"
                          />
                        </div>
                      </div>
                      <div className="md:w-1/2 space-y-4">
                        <div>
                          <h3 className="font-semibold text-sm text-muted-foreground mb-1">
                            Caption
                          </h3>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {selectedPost.caption || "No caption"}
                          </p>
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm text-muted-foreground mb-1">
                            AI Prompt
                          </h3>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {selectedPost.ai_prompt_used || "N/A"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDate(selectedPost.created_at)}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            onClick={() => {
                              if (selectedPost.image_url) {
                                window.open(selectedPost.image_url, "_blank");
                              }
                            }}
                            data-testid="button-download-selected"
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Download
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedPost(null)}
                          >
                            Close
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {posts.map((post, i) => (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card
                    className={`cursor-pointer hover-elevate transition-all ${
                      selectedPost?.id === post.id ? "ring-2 ring-primary" : ""
                    }`}
                    onClick={() => setSelectedPost(post)}
                    data-testid={`card-post-${post.id}`}
                  >
                    <CardContent className="p-3">
                      <div className="aspect-square rounded-md overflow-hidden bg-muted/50 mb-3">
                        {post.image_url ? (
                          <img
                            src={post.image_url}
                            alt="Post"
                            className="w-full h-full object-cover"
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
          </>
        )}
      </div>
    </div>
  );
}
