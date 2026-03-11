import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function formatTokenCount(value: number | null | undefined): string {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return "0";
    return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(numeric)));
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
    const mediaPreviewUrl = post.thumbnail_url || post.image_url;
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
        total_charged_amount_micros: post.total_charged_amount_micros,
        total_tokens: post.total_tokens,
        text_input_tokens: post.text_input_tokens,
        text_output_tokens: post.text_output_tokens,
        image_input_tokens: post.image_input_tokens,
        image_output_tokens: post.image_output_tokens,
        text_input_cost_usd_micros: post.text_input_cost_usd_micros,
        text_output_cost_usd_micros: post.text_output_cost_usd_micros,
        image_input_cost_usd_micros: post.image_input_cost_usd_micros,
        image_output_cost_usd_micros: post.image_output_cost_usd_micros,
        unattributed_cost_usd_micros: post.unattributed_cost_usd_micros,
        text_models: post.text_models,
        image_models: post.image_models,
        usage_events: post.usage_events,
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
                        <Card className="shadow-sm">
                            <CardContent className="p-4 flex flex-col justify-center">
                                <p className="text-xs text-muted-foreground font-medium mb-1">{t("Total Tokens")}</p>
                                <p className="text-xl font-semibold font-mono">{formatTokenCount(post.total_tokens)}</p>
                            </CardContent>
                        </Card>
                        <Card className="shadow-sm">
                            <CardContent className="p-4 flex flex-col justify-center">
                                <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> {t("Total Cost")}</p>
                                <p className="text-xl font-semibold font-mono text-green-600 dark:text-green-500">{formatCost(post.total_cost_usd_micros)}</p>
                                <p className="text-[11px] text-muted-foreground">{t("Billed")} {formatCost(post.total_charged_amount_micros)}</p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="shadow-sm">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">{t("Token and Cost Breakdown")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                <div className="rounded-md border p-3">
                                    <p className="text-muted-foreground">{t("Text input")}</p>
                                    <p className="mt-1 font-mono">{formatTokenCount(post.text_input_tokens)} {t("tokens")} | {formatCost(post.text_input_cost_usd_micros)}</p>
                                </div>
                                <div className="rounded-md border p-3">
                                    <p className="text-muted-foreground">{t("Text output")}</p>
                                    <p className="mt-1 font-mono">{formatTokenCount(post.text_output_tokens)} {t("tokens")} | {formatCost(post.text_output_cost_usd_micros)}</p>
                                </div>
                                <div className="rounded-md border p-3">
                                    <p className="text-muted-foreground">{t("Image input")}</p>
                                    <p className="mt-1 font-mono">{formatTokenCount(post.image_input_tokens)} {t("tokens")} | {formatCost(post.image_input_cost_usd_micros)}</p>
                                </div>
                                <div className="rounded-md border p-3">
                                    <p className="text-muted-foreground">{t("Image output")}</p>
                                    <p className="mt-1 font-mono">{formatTokenCount(post.image_output_tokens)} {t("tokens")} | {formatCost(post.image_output_cost_usd_micros)}</p>
                                </div>
                            </div>
                            {post.unattributed_cost_usd_micros > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    {t("Fallback / legacy cost")}: {formatCost(post.unattributed_cost_usd_micros)}
                                </p>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                <div className="rounded-md border p-3">
                                    <p className="text-muted-foreground mb-1">{t("Text models")}</p>
                                    <p className="font-mono break-words">{post.text_models.length ? post.text_models.join(", ") : "-"}</p>
                                </div>
                                <div className="rounded-md border p-3">
                                    <p className="text-muted-foreground mb-1">{t("Image models")}</p>
                                    <p className="font-mono break-words">{post.image_models.length ? post.image_models.join(", ") : "-"}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Left Column - Image Preview (smaller, 1/3 width) */}
                        <div className="md:col-span-1 space-y-3">
                            <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                                {isVideoPost ? <VideoIcon className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                                {t("Media Preview")}
                            </h4>
                            <div className="rounded-lg border overflow-hidden bg-muted/10 relative group">
                                {mediaPreviewUrl ? (
                                    <div className="flex items-center justify-center bg-black/5 p-2">
                                        <img
                                            src={mediaPreviewUrl}
                                            alt={t("Post")}
                                            className="max-w-full h-auto max-h-[300px] object-contain shadow-sm rounded-md"
                                        />
                                    </div>
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

                            {post.usage_events.length > 0 && (
                                <div className="border rounded-lg overflow-hidden shadow-sm">
                                    <div className="bg-muted/40 px-4 py-2 border-b">
                                        <h4 className="text-sm font-medium">{t("Usage events by post")}</h4>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead className="bg-muted/20">
                                                <tr className="text-left text-muted-foreground">
                                                    <th className="px-3 py-2 font-medium">{t("Event")}</th>
                                                    <th className="px-3 py-2 font-medium text-right">{t("Tokens")}</th>
                                                    <th className="px-3 py-2 font-medium text-right">{t("Cost")}</th>
                                                    <th className="px-3 py-2 font-medium">{t("Models")}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {post.usage_events.map((event) => (
                                                    <tr key={event.id} className="border-t">
                                                        <td className="px-3 py-2">
                                                            <div className="font-medium">{event.event_type || "-"}</div>
                                                            <div className="text-[10px] text-muted-foreground">
                                                                {event.created_at ? new Date(event.created_at).toLocaleString(locale) : "-"}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-mono">
                                                            {formatTokenCount(event.total_tokens)}
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-mono">
                                                            {formatCost(event.total_cost_usd_micros)}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="text-[10px] text-muted-foreground">
                                                                T: {event.text_model || "-"}
                                                            </div>
                                                            <div className="text-[10px] text-muted-foreground">
                                                                I: {event.image_model || "-"}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
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
    const postList = posts?.posts || [];
    const userSpendTotals = postList.reduce(
        (acc, post) => {
            acc.totalTokens += post.total_tokens || 0;
            acc.totalCostUsdMicros += post.total_cost_usd_micros || 0;
            acc.textInputTokens += post.text_input_tokens || 0;
            acc.textOutputTokens += post.text_output_tokens || 0;
            acc.imageInputTokens += post.image_input_tokens || 0;
            acc.imageOutputTokens += post.image_output_tokens || 0;
            post.text_models.forEach((model) => acc.textModels.add(model));
            post.image_models.forEach((model) => acc.imageModels.add(model));
            return acc;
        },
        {
            totalTokens: 0,
            totalCostUsdMicros: 0,
            textInputTokens: 0,
            textOutputTokens: 0,
            imageInputTokens: 0,
            imageOutputTokens: 0,
            textModels: new Set<string>(),
            imageModels: new Set<string>(),
        }
    );

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
                    {!isLoading && !isError && postList.length > 0 && (
                        <div className="grid gap-3 grid-cols-1 md:grid-cols-3 mb-4">
                            <Card className="shadow-sm">
                                <CardContent className="p-3">
                                    <p className="text-[11px] text-muted-foreground">{t("User total tokens")}</p>
                                    <p className="text-base font-semibold font-mono">{formatTokenCount(userSpendTotals.totalTokens)}</p>
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        TI {formatTokenCount(userSpendTotals.textInputTokens)} | TO {formatTokenCount(userSpendTotals.textOutputTokens)}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                        II {formatTokenCount(userSpendTotals.imageInputTokens)} | IO {formatTokenCount(userSpendTotals.imageOutputTokens)}
                                    </p>
                                </CardContent>
                            </Card>
                            <Card className="shadow-sm">
                                <CardContent className="p-3">
                                    <p className="text-[11px] text-muted-foreground">{t("User total cost")}</p>
                                    <p className="text-base font-semibold font-mono text-green-600 dark:text-green-500">
                                        {formatCost(userSpendTotals.totalCostUsdMicros)}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        {postList.length} {t("posts")}
                                    </p>
                                </CardContent>
                            </Card>
                            <Card className="shadow-sm">
                                <CardContent className="p-3 space-y-1">
                                    <p className="text-[11px] text-muted-foreground">{t("Models used")}</p>
                                    <p className="text-[11px] font-mono break-words">
                                        T: {Array.from(userSpendTotals.textModels).sort().join(", ") || "-"}
                                    </p>
                                    <p className="text-[11px] font-mono break-words">
                                        I: {Array.from(userSpendTotals.imageModels).sort().join(", ") || "-"}
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                    {isLoading ? (
                        <div className="flex items-center justify-center h-32">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : isError ? (
                        <div className="text-center py-12 text-sm text-destructive border rounded-lg border-dashed border-destructive/40">
                            {(error as Error).message || t("Failed to load this user's posts.")}
                        </div>
                    ) : postList.length === 0 ? (
                        <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg border-dashed">
                            {t("This user hasn't created any posts yet.")}
                        </div>
                    ) : (
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>{t("Status")}</TableHead>
                                        <TableHead>{t("Image")}</TableHead>
                                        <TableHead>{t("Prompt / Error")}</TableHead>
                                        <TableHead className="text-center">{t("Edits")}</TableHead>
                                        <TableHead className="text-right">{t("Token Breakdown")}</TableHead>
                                        <TableHead className="text-right">{t("Total Cost")}</TableHead>
                                        <TableHead>{t("Models")}</TableHead>
                                        <TableHead>{t("Date")}</TableHead>
                                        <TableHead className="w-[100px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {postList.map((post) => (
                                        <TableRow key={post.id} className={post.status === 'failed' ? "bg-red-500/10 hover:bg-red-500/20" : "bg-green-500/10 hover:bg-green-500/20"}>
                                            <TableCell>
                                                {post.status === 'failed' ? (
                                                    <Badge variant="destructive" className="text-[10px]">Failed</Badge>
                                                ) : (
                                                    <Badge className="bg-green-600 hover:bg-green-700 text-[10px]">Success</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {(() => {
                                                    const previewUrl = post.content_type === "video"
                                                        ? post.thumbnail_url
                                                        : post.thumbnail_url || post.image_url;
                                                    return previewUrl ? (
                                                        <img src={previewUrl} alt={t("Post")} className="w-16 h-16 object-cover rounded-md border bg-background" />
                                                    ) : (
                                                        <div className="w-16 h-16 bg-background rounded-md flex items-center justify-center border">
                                                            <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                                                        </div>
                                                    );
                                                })()}
                                            </TableCell>
                                            <TableCell className="max-w-[300px]">
                                                {post.status === 'failed' ? (
                                                    <div className="text-xs text-destructive mb-1 font-semibold">{t("Error")}: {post.error_message}</div>
                                                ) : null}
                                                <p className="text-xs line-clamp-3 text-muted-foreground" title={post.original_prompt || undefined}>
                                                    {post.original_prompt || <span className="italic opacity-50">{t("No prompt")}</span>}
                                                </p>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant="secondary" className="font-mono text-[10px]">
                                                    {post.version_count}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                                                <div>{formatTokenCount(post.total_tokens)}</div>
                                                <div>TI {formatTokenCount(post.text_input_tokens)} | TO {formatTokenCount(post.text_output_tokens)}</div>
                                                <div>II {formatTokenCount(post.image_input_tokens)} | IO {formatTokenCount(post.image_output_tokens)}</div>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-xs whitespace-nowrap text-muted-foreground">
                                                {formatCost(post.total_cost_usd_micros)}
                                            </TableCell>
                                            <TableCell className="text-[11px] text-muted-foreground max-w-[220px]">
                                                <div className="truncate" title={post.text_models.join(", ") || undefined}>
                                                    T: {post.text_models.join(", ") || "-"}
                                                </div>
                                                <div className="truncate" title={post.image_models.join(", ") || undefined}>
                                                    I: {post.image_models.join(", ") || "-"}
                                                </div>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                                {new Date(post.created_at).toLocaleDateString(locale)}
                                            </TableCell>
                                            <TableCell>
                                                {post.status !== 'failed' && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 gap-1.5"
                                                        onClick={() => setSelectedPost(post)}
                                                    >
                                                        <Maximize2 className="w-3.5 h-3.5" />
                                                        {t("View")}
                                                    </Button>
                                                )}
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
