import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, formatCost } from "@/lib/admin/utils";
import type { AdminUser, UserPost } from "@/lib/admin/types";
import { Loader2, Image as ImageIcon, Maximize2, ChevronLeft, ChevronRight } from "lucide-react";

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
    if (!post) return null;

    const currentIndex = allPosts.findIndex(p => p.id === post.id);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < allPosts.length - 1;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex-1">
                            <DialogTitle>Post Details</DialogTitle>
                            <DialogDescription>
                                Created on {new Date(post.created_at).toLocaleDateString()} at {new Date(post.created_at).toLocaleTimeString()}
                            </DialogDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => onNavigate('prev')}
                                disabled={!hasPrev}
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {currentIndex + 1} / {allPosts.length}
                            </span>
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
                </DialogHeader>

                <div className="flex-1 overflow-auto">
                    <div className="grid grid-cols-2 gap-6 mt-4">
                        {/* Left Column - Image and Costs */}
                        <div className="space-y-4">
                            {/* Image Preview */}
                            <div className="rounded-lg border overflow-hidden bg-muted/30">
                                {post.image_url ? (
                                    <img
                                        src={post.image_url}
                                        alt="Post"
                                        className="w-full h-auto object-contain"
                                    />
                                ) : (
                                    <div className="w-full h-64 flex items-center justify-center">
                                        <ImageIcon className="w-16 h-16 text-muted-foreground/50" />
                                    </div>
                                )}
                            </div>

                            {/* Cost Metrics */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="border rounded-md p-3">
                                    <p className="text-xs text-muted-foreground mb-1">Total Edits</p>
                                    <p className="text-lg font-semibold">{post.version_count}</p>
                                </div>
                                <div className="border rounded-md p-3">
                                    <p className="text-xs text-muted-foreground mb-1">Total Cost</p>
                                    <p className="text-lg font-semibold font-mono">{formatCost(post.total_cost_usd_micros)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Right Column - Prompt and Caption */}
                        <div className="space-y-4">
                            <div>
                                <h4 className="text-sm font-semibold mb-2">AI Prompt Used</h4>
                                <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md border">
                                    {post.original_prompt || <span className="italic">No prompt available</span>}
                                </div>
                            </div>

                            {post.caption && (
                                <div>
                                    <h4 className="text-sm font-semibold mb-2">Generated Caption</h4>
                                    <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md border whitespace-pre-wrap">
                                        {post.caption}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer - Post ID */}
                <div className="border-t pt-3 mt-4">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Post ID:</span>
                        <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{post.id}</code>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function UserDetailsDialog({ user, open, onOpenChange }: UserDetailsDialogProps) {
    const [selectedPost, setSelectedPost] = useState<UserPost | null>(null);
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

    if (!user) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>User Details</DialogTitle>
                    <DialogDescription>
                        {user.email} {user.brand_name && `• ${user.brand_name}`}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto mt-4 pr-4">
                    <h3 className="font-semibold text-sm mb-3">Generation History</h3>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-32">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : isError ? (
                        <div className="text-center py-12 text-sm text-destructive border rounded-lg border-dashed border-destructive/40">
                            {(error as Error).message || "Failed to load this user's posts."}
                        </div>
                    ) : !posts?.posts || posts.posts.length === 0 ? (
                        <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg border-dashed">
                            This user hasn't created any posts yet.
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Image</TableHead>
                                        <TableHead>Prompt</TableHead>
                                        <TableHead className="text-center">Edits</TableHead>
                                        <TableHead className="text-right">Total Cost</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead className="w-[100px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {posts.posts.map((post) => (
                                        <TableRow key={post.id}>
                                            <TableCell>
                                                {post.image_url ? (
                                                    <img src={post.image_url} alt="Post" className="w-16 h-16 object-cover rounded-md border" />
                                                ) : (
                                                    <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center border">
                                                        <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="max-w-[300px]">
                                                <p className="text-xs line-clamp-3 text-muted-foreground" title={post.original_prompt || undefined}>
                                                    {post.original_prompt || <span className="italic opacity-50">No prompt</span>}
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
                                                {new Date(post.created_at).toLocaleDateString()}
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 gap-1.5"
                                                    onClick={() => setSelectedPost(post)}
                                                >
                                                    <Maximize2 className="w-3.5 h-3.5" />
                                                    View
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
