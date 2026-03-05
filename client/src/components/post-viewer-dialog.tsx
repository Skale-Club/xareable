import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Download, Calendar, Copy, Edit3, ChevronLeft, ChevronRight, Loader2, ImageIcon, VideoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePostViewer } from "@/lib/post-viewer";
import { supabase } from "@/lib/supabase";
import type { PostVersion } from "@shared/schema";
import { PostEditDialog } from "@/components/post-edit-dialog";
import { isVideoUrl } from "@/lib/media";

export function PostViewerDialog() {
    const { viewingPost, closeViewer } = usePostViewer();
    const { toast } = useToast();
    const { language, t } = useTranslation();

    const [versions, setVersions] = useState<PostVersion[]>([]);
    const [currentVersionIndex, setCurrentVersionIndex] = useState(0);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [loadingVersions, setLoadingVersions] = useState(false);

    // Load versions when post changes
    useEffect(() => {
        if (!viewingPost) {
            setVersions([]);
            setCurrentVersionIndex(0);
            setIsEditDialogOpen(false);
            return;
        }

        loadVersions();
    }, [viewingPost?.id]);

    async function loadVersions() {
        if (!viewingPost) return;

        setLoadingVersions(true);
        const sb = supabase();
        const { data } = await sb
            .from("post_versions")
            .select("*")
            .eq("post_id", viewingPost.id)
            .order("version_number", { ascending: true });

        setVersions(data || []);
        setCurrentVersionIndex((data || []).length); // Start at latest (base image)
        setLoadingVersions(false);
    }

    if (!viewingPost) return null;
    const post = viewingPost;

    // Calculate current image to display
    const currentImage = currentVersionIndex > 0 && currentVersionIndex <= versions.length
        ? versions[currentVersionIndex - 1].image_url
        : post.image_url;

    const currentVersionLabel = currentVersionIndex === 0
        ? t("Original")
        : `v${currentVersionIndex}`;
    const isCurrentVideo = post.content_type === "video" || isVideoUrl(currentImage);

    const totalVersions = versions.length + 1; // +1 for original
    const locale = language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US";

    function formatDate(dateStr: string) {
        return new Date(dateStr).toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }

    async function handleCopyCaption() {
        const caption = post.caption || "";
        if (!caption) return;

        try {
            await navigator.clipboard.writeText(caption);
            toast({ title: t("Caption copied") });
        } catch {
            toast({
                title: t("Copy failed"),
                description: t("Could not copy the caption."),
                variant: "destructive",
            });
        }
    }

    function handlePreviousVersion() {
        setCurrentVersionIndex((idx) => Math.max(0, idx - 1));
    }

    function handleNextVersion() {
        setCurrentVersionIndex((idx) => Math.min(versions.length, idx + 1));
    }

    return (
        <>
            <Dialog open={!!viewingPost} onOpenChange={(open) => !open && closeViewer()}>
                <DialogContent className="max-w-2xl h-[80vh] max-h-[80vh] p-0 overflow-hidden" data-testid="dialog-post-viewer">
                    <div className="h-full overflow-y-auto p-6">
                        <div className="flex flex-col md:flex-row gap-5 items-start">
                            <div className="md:w-1/2">
                                <div className="min-h-[28px] flex items-center justify-between mb-3">
                                    <DialogTitle className="text-left leading-none m-0">{t("Post Details")}</DialogTitle>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {formatDate(post.created_at)}
                                    </div>
                                </div>
                                {/* Image with version navigation */}
                                <div className="relative rounded-md overflow-hidden bg-muted/50">
                                    {loadingVersions ? (
                                        <div className="aspect-square w-full flex items-center justify-center">
                                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                                        </div>
                                    ) : isCurrentVideo ? (
                                        <video
                                            src={currentImage || ""}
                                            className="w-full h-auto"
                                            controls
                                            playsInline
                                            preload="metadata"
                                        />
                                    ) : (
                                        <img
                                            src={currentImage || ""}
                                            alt="Post"
                                            className="w-full h-auto"
                                        />
                                    )}
                                    <div className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-1 text-white">
                                        {isCurrentVideo ? (
                                            <VideoIcon className="w-3.5 h-3.5" />
                                        ) : (
                                            <ImageIcon className="w-3.5 h-3.5" />
                                        )}
                                    </div>

                                    {/* Version indicator */}
                                    {totalVersions > 1 && (
                                        <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                                            {currentVersionLabel}
                                        </div>
                                    )}
                                </div>

                                {/* Version navigation */}
                                {totalVersions > 1 && (
                                    <div className="mt-3 flex items-center justify-between gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handlePreviousVersion}
                                            disabled={currentVersionIndex === 0}
                                        >
                                            <ChevronLeft className="w-4 h-4" />
                                        </Button>
                                        <span className="text-xs text-muted-foreground">
                                            {currentVersionIndex + 1} / {totalVersions}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleNextVersion}
                                            disabled={currentVersionIndex === versions.length}
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </Button>
                                    </div>
                                )}

                                {/* Download button */}
                                <Button
                                    className="w-full bg-violet-600 hover:bg-violet-700 text-white mt-4"
                                    onClick={async () => {
                                        if (currentImage) {
                                            try {
                                                const response = await fetch(currentImage);
                                                const blob = await response.blob();
                                                const url = window.URL.createObjectURL(blob);
                                                const link = document.createElement("a");
                                                link.href = url;
                                                link.download = currentImage.split("/").pop() || (isCurrentVideo ? "video.mp4" : "image.png");
                                                document.body.appendChild(link);
                                                link.click();
                                                document.body.removeChild(link);
                                                window.URL.revokeObjectURL(url);
                                            } catch (error) {
                                                console.error("Download failed:", error);
                                            }
                                        }
                                    }}
                                    data-testid="button-download-selected"
                                >
                                    <Download className="w-4 h-4 mr-2" />
                                    {t("Download")}
                                </Button>

                                {!isCurrentVideo && (
                                    <Button
                                        variant="outline"
                                        className="w-full mt-3"
                                        onClick={() => setIsEditDialogOpen(true)}
                                        data-testid="button-open-edit-dialog"
                                    >
                                        <Edit3 className="w-4 h-4 mr-2" />
                                        {t("Edit Image")}
                                    </Button>
                                )}
                            </div>

                            <div className="md:w-1/2 flex flex-col h-full">
                                <div className="flex items-center justify-between min-h-[28px] mb-3">
                                    <h3 className="font-semibold text-lg text-foreground leading-none">{t("Caption")}</h3>
                                    <TooltipProvider delayDuration={0}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={handleCopyCaption}
                                                    disabled={!post.caption}
                                                    className="h-7 w-7 p-0 bg-transparent hover:bg-transparent disabled:opacity-50"
                                                    data-testid="button-copy-caption"
                                                >
                                                    <Copy className="w-3.5 h-3.5" />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="left">
                                                <p>{t("Copy the content")}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                <div className="flex-1">
                                    <div className="rounded-lg border bg-muted/40 p-4 h-full">
                                        <div className="text-sm leading-7 whitespace-pre-line break-words">
                                            {post.caption ? post.caption.trim() : t("No caption")}
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <PostEditDialog
                open={isEditDialogOpen}
                postId={post.id}
                onOpenChange={setIsEditDialogOpen}
                onGenerated={async ({ version_number }) => {
                    await loadVersions();
                    setCurrentVersionIndex(version_number);
                }}
            />
        </>
    );
}
