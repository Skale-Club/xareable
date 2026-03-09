import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, formatCost } from "@/lib/admin/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { AdminUser, UserPost } from "@/lib/admin/types";
import { Loader2, Image as ImageIcon, Maximize2, ChevronLeft, ChevronRight, Bug, Copy, Check, VideoIcon, Sparkles, FileText, Calendar, DollarSign, Edit3 } from "lucide-react";
import { isVideoUrl } from "@/lib/media";
import { GradientIcon } from "@/components/ui/gradient-icon";

interface UserDetailsDialogProps {
    user: AdminUser | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface PostDetailDialogProps {
    post: UserPost | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    allPosts: UserPost[];
    onNavigate: (direction: 'prev' | 'next') => void;
}

function PostDetailDialog({ post, open, onOpenChange, allPosts, onNavigate }: PostDetailDialogProps) {
    const { language, t } = useTranslation();
    const [showDebug, setShowDebug] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedPostId, setCopiedPostId] = useState(false);
    if (!post) return null;

    const currentIndex = allPosts.findIndex(p => p.id === post.id);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < allPosts.length - 1;
    const locale = language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US";
    const isVideoPost = post.content_type === "video" || isVideoUrl(post.image_url);
    const debugPayload = {
        post_id: post.id,
        created_at: post.created_at,
        content_type: post.content_type,
        is_video_post: isVideoPost,
        image_url: post.image_url,
        thumbnail_url: post.thumbnail_url,
        ai_prompt_used: post.original_prompt,
        caption: post.caption,
        version_count: post.version_count,
        total_cost_usd_micros: post.total_cost_usd_micros,
    };

    async function handleCopyDebug() {
        try {
            await navigator.clipboard.writeText(JSON.stringify(debugPayload, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch {
            setCopied(false);
        }
    }

    async function handleCopyCaption() {
        const currentPost = post;
        if (!currentPost?.caption) return;
        try {
            await navigator.clipboard.writeText(currentPost.caption);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error("Copy caption failed:", error);
        }
    }

    async function handleCopyPostId() {
        const currentPost = post;
        if (!currentPost) return;
        try {
            await navigator.clipboard.writeText(currentPost.id);
            setCopiedPostId(true);
            setTimeout(() => setCopiedPostId(false), 2000);
        } catch (error) {
            console.error("Copy post ID failed:", error);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-6">
                <DialogHeader className="pb-4 border-b">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-xl flex items-center gap-2">
                                <GradientIcon icon={FileText} className="w-5 h-5" />
                                {t("Post Details")}
                            </DialogTitle>
                        </div>
                        <div className="flex items-center gap-3 pr-8">
                            <span className="text-sm text-muted-foreground font-medium bg-muted px-2 py-1 rounded-md">
                                {currentIndex + 1} / {allPosts.length}
                            </span>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => onNavigate('prev')}
                                    disabled={!hasPrev}
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => onNavigate('next')}
                                    disabled={!hasNext}
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                {showDebug ? (
                    <div className="flex-1 flex flex-col overflow-hidden mt-4">
                        <div className="flex items-center justify-between mb-4 flex-shrink-0">
                            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Bug className="w-4 h-4"/> {t("Raw JSON payload for this generation:")}</p>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={handleCopyDebug}
                                >
                                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                                    {copied ? t("Copied") : t("Copy JSON")}
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowDebug(false)}
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                    {t("Back")}
                                </Button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto border rounded-lg bg-muted/20 p-4">
                            <pre className="text-[12px] leading-relaxed font-mono text-muted-foreground">
                                {JSON.stringify(debugPayload, null, 2)}
                            </pre>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-auto pr-2 mt-4 space-y-6">
                    {/* Top Section - Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className="shadow-sm">
                            <CardContent className="p-4 flex flex-col justify-center">
                                <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {t("Date")}</p>
                                <p className="text-sm font-medium">{new Date(post.created_at).toLocaleDateString(locale)} {new Date(post.created_at).toLocaleTimeString(locale, {hour: '2-digit', minute:'2-digit'})}</p>
                            </CardContent>
                        </Card>
                        <Card className="shadow-sm">
                            <CardContent className="p-4 flex flex-col justify-center">
                                <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1.5"><Edit3 className="w-3.5 h-3.5" /> {t("Total Edits")}</p>
                                <p className="text-xl font-semibold">{post.version_count}</p>
                            </CardContent>
                        </Card>
                        <Card className="shadow-sm md:col-span-2">
                            <CardContent className="p-4 flex flex-col justify-center">
                                <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> {t("Total Cost")}</p>
                                <p className="text-xl font-semibold font-mono text-green-600 dark:text-green-500">{formatCost(post.total_cost_usd_micros)}</p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Left Column - Image Preview (smaller, 1/3 width) */}
                        <div className="md:col-span-1 space-y-3">
                            <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                                {isVideoPost ? <VideoIcon className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                                {t("Media Preview")}
                            </h4>
                            <div className="rounded-lg border overflow-hidden bg-muted/10 relative group">
                                {post.image_url ? (
                                    isVideoPost ? (
                                        <video
                                            src={post.image_url}
                                            className="w-full h-auto max-h-[300px] object-contain bg-black/5"
                                            controls
                                            playsInline
                                            preload="metadata"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center bg-black/5 p-2">
                                            <img
                                                src={post.image_url}
                                                alt={t("Post")}
                                                className="max-w-full h-auto max-h-[300px] object-contain shadow-sm rounded-md"
                                            />
                                        </div>
                                    )
                                ) : (
                                    <div className="w-full h-48 flex items-center justify-center">
                                        <ImageIcon className="w-12 h-12 text-muted-foreground/20" />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right Column - Prompts and Captions (2/3 width) */}
                        <div className="md:col-span-2 space-y-4 flex flex-col">
                            <div className="border rounded-lg overflow-hidden shadow-sm">
                                <div className="bg-muted/40 px-4 py-2.5 border-b flex items-center gap-2">
                                    <GradientIcon icon={Sparkles} className="w-4 h-4" />
                                    <h4 className="text-sm font-medium">{t("AI Prompt Used")}</h4>
                                </div>
                                <div className="p-4 bg-card text-sm text-muted-foreground leading-relaxed">
                                    {post.original_prompt || <span className="italic opacity-50">{t("No prompt available")}</span>}
                                </div>
                            </div>

                            {post.caption && (
                                <div className="border rounded-lg overflow-hidden shadow-sm flex flex-col">
                                    <div className="bg-muted/40 px-4 py-2 border-b flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <GradientIcon icon={FileText} className="w-4 h-4" />
                                            <h4 className="text-sm font-medium">{t("Generated Caption")}</h4>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 gap-1 -my-1 text-xs"
                                            onClick={handleCopyCaption}
                                        >
                                            {copied ? (
                                                <>
                                                    <Check className="w-3 h-3 text-green-600" />
                                                    {t("Copied")}
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="w-3 h-3" />
                                                    {t("Copy")}
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                    <div className="p-4 bg-card text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                                        {post.caption}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer - Post ID */}
                <div className="border-t pt-4 mt-2">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">{t("Post ID")}</span>
                            <div className="flex items-center bg-muted/50 border rounded-md px-2 py-1 gap-2">
                                <code className="text-[11px] font-mono text-muted-foreground">{post.id}</code>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 rounded-sm hover:bg-background"
                                    onClick={handleCopyPostId}
                                >
                                    {copiedPostId ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                                </Button>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs bg-muted/30"
                            onClick={() => setShowDebug(true)}
                        >
                            <Bug className="w-3.5 h-3.5" />
                            {t("Debug payload")}
                        </Button>
                    </div>
                </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

export function UserDetailsDialog({ user, open, onOpenChange }: UserDetailsDialogProps) {
    const [selectedPost, setSelectedPost] = useState<UserPost | null>(null);
    const { language, t } = useTranslation();
    const { data: posts, isLoading, isError, error } = useQuery<{ posts: UserPost[] }>({
        queryKey: ["/api/admin/users", user?.id, "posts"],
        queryFn: () => adminFetch(`/api/admin/users/${user?.id}/posts`),
        enabled: !!user?.id && open,
    });

    const handleNavigate = (direction: 'prev' | 'next') => {
        if (!selectedPost || !posts?.posts) return;

        const currentIndex = posts.posts.findIndex(p => p.id === selectedPost.id);
        const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

        if (newIndex >= 0 && newIndex < posts.posts.length) {
            setSelectedPost(posts.posts[newIndex]);
        }
    };
    const locale = language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US";

    if (!user) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{t("User Details")}</DialogTitle>
                    <DialogDescription>
                        {(user.email || t("No email"))} {user.brand_name && `| ${user.brand_name}`}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto mt-4 pr-4">
                    <h3 className="font-semibold text-sm mb-3">{t("Generation History")}</h3>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-32">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : isError ? (
                        <div className="text-center py-12 text-sm text-destructive border rounded-lg border-dashed border-destructive/40">
                            {(error as Error).message || t("Failed to load this user's posts.")}
                        </div>
                    ) : !posts?.posts || posts.posts.length === 0 ? (
                        <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg border-dashed">
                            {t("This user hasn't created any posts yet.")}
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>{t("Image")}</TableHead>
                                        <TableHead>{t("Prompt")}</TableHead>
                                        <TableHead className="text-center">{t("Edits")}</TableHead>
                                        <TableHead className="text-right">{t("Total Cost")}</TableHead>
                                        <TableHead>{t("Date")}</TableHead>
                                        <TableHead className="w-[100px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {posts.posts.map((post) => (
                                        <TableRow key={post.id}>
                                            <TableCell>
                                                {(() => {
                                                    const previewUrl = post.content_type === "video"
                                                        ? post.thumbnail_url
                                                        : post.thumbnail_url || post.image_url;
                                                    return previewUrl ? (
                                                        <img src={previewUrl} alt={t("Post")} className="w-16 h-16 object-cover rounded-md border" />
                                                    ) : (
                                                        <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center border">
                                                            <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                                                        </div>
                                                    );
                                                })()}
                                            </TableCell>
                                            <TableCell className="max-w-[300px]">
                                                <p className="text-xs line-clamp-3 text-muted-foreground" title={post.original_prompt || undefined}>
                                                    {post.original_prompt || <span className="italic opacity-50">{t("No prompt")}</span>}
                                                </p>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant="secondary" className="font-mono text-[10px]">
                                                    {post.version_count}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-xs whitespace-nowrap text-muted-foreground">
                                                {formatCost(post.total_cost_usd_micros)}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                                {new Date(post.created_at).toLocaleDateString(locale)}
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 gap-1.5"
                                                    onClick={() => setSelectedPost(post)}
                                                >
                                                    <Maximize2 className="w-3.5 h-3.5" />
                                                    {t("View")}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>
            </DialogContent>

            <PostDetailDialog
                post={selectedPost}
                open={!!selectedPost}
                onOpenChange={(open) => !open && setSelectedPost(null)}
                allPosts={posts?.posts || []}
                onNavigate={handleNavigate}
            />
        </Dialog>
    );
}
