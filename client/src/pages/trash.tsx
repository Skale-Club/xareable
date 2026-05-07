import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Trash2, RotateCcw, ImageIcon, VideoIcon, LayoutPanelTop, Sparkles } from "lucide-react";
import { PageLoader } from "@/components/page-loader";
import { trashListResponseSchema, type TrashedPost, type TrashListResponse } from "@shared/schema";

function ContentTypeBadge({ contentType, slideCount }: { contentType: TrashedPost["content_type"]; slideCount: number | null }) {
  const base = "absolute top-2 left-2 z-20 rounded-full bg-black/70 px-2 py-1 text-white flex items-center gap-1 text-xs";
  switch (contentType) {
    case "image":
      return <div className={base}><ImageIcon className="w-3.5 h-3.5" aria-hidden="true" /></div>;
    case "video":
      return <div className={base}><VideoIcon className="w-3.5 h-3.5" aria-hidden="true" /></div>;
    case "carousel":
      return (
        <div className={base}>
          <LayoutPanelTop className="w-3.5 h-3.5" aria-hidden="true" />
          {slideCount ? <span>{slideCount}</span> : null}
        </div>
      );
    case "enhancement":
      return <div className={base}><Sparkles className="w-3.5 h-3.5" aria-hidden="true" /></div>;
  }
}

export default function TrashPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<TrashListResponse>({
    queryKey: ["/api/trash"],
    enabled: !!user,
  });

  const posts: TrashedPost[] = data?.posts ?? [];

  async function handleRestore(id: string) {
    setBusyId(id);
    try {
      await apiRequest("POST", `/api/trash/${id}/restore`);
      toast({ title: t("Post restored"), description: t("It is back in your gallery.") });
      await queryClient.invalidateQueries({ queryKey: ["/api/trash"] });
      await queryClient.invalidateQueries({ queryKey: ["posts"] });
    } catch (err) {
      console.error("Restore failed:", err);
      toast({
        title: t("Failed to restore"),
        description: err instanceof Error ? err.message : t("Please try again."),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    setBusyId(id);
    try {
      await apiRequest("DELETE", `/api/trash/${id}`);
      toast({ title: t("Post permanently deleted") });
      await queryClient.invalidateQueries({ queryKey: ["/api/trash"] });
    } catch (err) {
      console.error("Delete forever failed:", err);
      toast({
        title: t("Failed to delete"),
        description: err instanceof Error ? err.message : t("Please try again."),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) return <PageLoader />;

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">{t("Trash")}</h1>
        <p className="text-destructive">{t("Failed to load trash.")}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{t("Trash")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("Posts here will be permanently deleted after 30 days. Restore them to keep them.")}
        </p>
      </header>

      {posts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Trash2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>{t("Trash is empty.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="trash-grid">
          {posts.map((post) => (
            <Card key={post.id} className="overflow-hidden relative" data-testid={`trash-card-${post.id}`}>
              <div className="relative aspect-square bg-muted">
                <ContentTypeBadge contentType={post.content_type} slideCount={post.slide_count} />
                <div
                  className="absolute top-2 right-2 z-20 rounded-full bg-black/70 px-2 py-1 text-white text-xs"
                  data-testid={`days-remaining-${post.id}`}
                >
                  {t("{n} days left").replace("{n}", String(post.days_remaining))}
                </div>
                {post.image_url ? (
                  <img
                    src={post.image_url}
                    alt={post.caption || "Trashed post"}
                    className="w-full h-full object-cover opacity-70"
                  />
                ) : null}
              </div>
              <CardContent className="p-3 space-y-2">
                {post.caption ? (
                  <p className="text-xs text-muted-foreground line-clamp-2">{post.caption}</p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={busyId === post.id}
                    onClick={() => handleRestore(post.id)}
                    data-testid={`restore-${post.id}`}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    {t("Restore")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    disabled={busyId === post.id}
                    onClick={() => setPendingDeleteId(post.id)}
                    data-testid={`delete-forever-${post.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    {t("Delete Forever")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this post forever?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This action cannot be undone. The image and all its versions will be permanently removed.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>{t("Delete Forever")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Suppress unused-import warnings if types are tree-shaken
void trashListResponseSchema;
