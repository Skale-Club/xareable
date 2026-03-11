import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/hooks/useTranslation";
import { Loader2, ImageIcon, Search, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useState, useCallback } from "react";

interface GenerationRecord {
    id: string;
    user_id: string;
    user_email: string;
    created_at: string;
    original_prompt: string | null;
    content_type: "image" | "video";
    status: "completed" | "failed";
    error_message: string | null;
    image_url: string | null;
    thumbnail_url: string | null;
    tokens_total: number | null;
}

interface GenerationsResponse {
    generations: GenerationRecord[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasMore: boolean;
    };
}

export function GenerationsTab() {
    const { t, language } = useTranslation();
    const locale = language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US";

    // Filter state
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [contentTypeFilter, setContentTypeFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    // Debounce search input
    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);
        setPage(1); // Reset to first page on search
        // Debounce the search
        setTimeout(() => {
            setDebouncedSearch(value);
        }, 300);
    }, []);

    // Build query params
    const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        status: statusFilter,
        content_type: contentTypeFilter,
        search: debouncedSearch,
    });

    const timelineQueryParams = new URLSearchParams({
        page: "1",
        limit: "100",
        status: "all",
        content_type: "all",
        search: "",
    });

    const { data, isLoading, isError, error, refetch, isFetching } = useQuery<GenerationsResponse>({
        queryKey: ["/api/admin/generations", page, statusFilter, contentTypeFilter, debouncedSearch],
        queryFn: () => adminFetch(`/api/admin/generations?${queryParams.toString()}`),
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
    });

    const {
        data: timelineData,
        isLoading: isTimelineLoading,
        isError: isTimelineError,
        error: timelineError,
        refetch: refetchTimeline,
        isFetching: isTimelineFetching,
    } = useQuery<GenerationsResponse>({
        queryKey: ["/api/admin/generations", "timeline", 100],
        queryFn: () => adminFetch(`/api/admin/generations?${timelineQueryParams.toString()}`),
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        refetchInterval: 15_000,
    });

    const records = data?.generations || [];
    const pagination = data?.pagination;
    const hasMultiplePages = Boolean(pagination && pagination.totalPages > 1);
    const timelineRecords = timelineData?.generations || [];
    const timelineBars = [...timelineRecords].reverse(); // newest on the right side
    const failedInTimeline = timelineRecords.filter((record) => record.status === "failed").length;
    const successfulInTimeline = timelineRecords.length - failedInTimeline;
    const lastFailure = timelineRecords.find((record) => record.status === "failed");

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("Generations")}</h1>
                    <p className="text-muted-foreground mt-2">
                        {t("View all generation attempts across the platform.")}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <div className="relative min-w-[220px] w-full sm:w-[280px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder={t("Search by email or prompt...")}
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            className="h-9 pl-9 bg-muted/25 border-border/60"
                        />
                    </div>
                    <div className="w-[130px]">
                        <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
                            <SelectTrigger className="h-9 bg-muted/25 border-border/60">
                                <SelectValue placeholder={t("Status")} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("All Status")}</SelectItem>
                                <SelectItem value="completed">{t("Success")}</SelectItem>
                                <SelectItem value="failed">{t("Failed")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-[130px]">
                        <Select value={contentTypeFilter} onValueChange={(value) => { setContentTypeFilter(value); setPage(1); }}>
                            <SelectTrigger className="h-9 bg-muted/25 border-border/60">
                                <SelectValue placeholder={t("Type")} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("All Types")}</SelectItem>
                                <SelectItem value="image">{t("Image")}</SelectItem>
                                <SelectItem value="video">{t("Video")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            void Promise.all([refetch(), refetchTimeline()]);
                        }}
                        disabled={isFetching || isTimelineFetching}
                        className="h-9"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isFetching || isTimelineFetching ? 'animate-spin' : ''}`} />
                        {t("Refresh")}
                    </Button>
                </div>
            </div>


            {/* Results */}
            <Card>
                <CardHeader className="space-y-2 pb-3">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-4">
                        <div className="space-y-1 min-w-0">
                            <CardTitle>{t("Recent Generations")}</CardTitle>
                            <CardDescription>
                                {pagination ? `${t("Showing")} ${((pagination.page - 1) * pagination.limit) + 1}-${Math.min(pagination.page * pagination.limit, pagination.total)} ${t("of")} ${pagination.total} ${t("results")}` : t("Loading...")}
                            </CardDescription>
                        </div>
                        <div className="min-w-0">
                            {isTimelineLoading ? (
                                <div className="py-1">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                                </div>
                            ) : isTimelineError ? (
                                <span className="text-[11px] text-destructive truncate">
                                    {(timelineError as Error).message || t("Failed to load generations.")}
                                </span>
                            ) : !timelineBars.length ? (
                                <span className="text-[11px] text-muted-foreground">{t("No generations found.")}</span>
                            ) : (
                                <div className="space-y-1.5 w-full">
                                    <div className="overflow-x-auto">
                                        <div className="flex items-end gap-0.5 min-w-max">
                                            {timelineBars.map((gen, index) => (
                                                <div
                                                    key={`timeline-${gen.id}-${index}`}
                                                    className={`w-1 h-2.5 rounded-sm ${gen.status === "failed" ? "bg-red-500/90" : "bg-green-500/90"}`}
                                                    title={`${gen.status === "failed" ? t("Failed") : t("Success")} | ${new Date(gen.created_at).toLocaleString(locale)} | ${gen.user_email}${gen.error_message ? ` | ${gen.error_message}` : ""}`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-none text-muted-foreground">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-sm bg-green-500/90" />
                                            {t("Success")}: {successfulInTimeline}
                                        </span>
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-sm bg-red-500/90" />
                                            {t("Failed")}: {failedInTimeline}
                                        </span>
                                        <span>
                                            {t("Showing")} {timelineRecords.length} {t("of")} 100
                                        </span>
                                        {lastFailure ? (
                                            <span>
                                                {t("Last error")}: {new Date(lastFailure.created_at).toLocaleString(locale)}
                                            </span>
                                        ) : (
                                            <span>{t("No recent errors")}</span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center justify-start lg:justify-end">
                            {hasMultiplePages ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                                        {t("Page")} {pagination?.page} {t("of")} {pagination?.totalPages}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1 || isFetching}
                                    >
                                        <ChevronLeft className="w-4 h-4 mr-1" />
                                        {t("Previous")}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(p => p + 1)}
                                        disabled={!pagination?.hasMore || isFetching}
                                    >
                                        {t("Next")}
                                        <ChevronRight className="w-4 h-4 ml-1" />
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : isError ? (
                        <div className="text-center py-12 text-sm text-destructive border rounded-lg border-dashed border-destructive/40">
                            {(error as Error).message || t("Failed to load generations.")}
                        </div>
                    ) : !records.length ? (
                        <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg border-dashed">
                            {t("No generations found.")}
                        </div>
                    ) : (
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead className="w-[100px]">{t("ID")}</TableHead>
                                        <TableHead>{t("Status")}</TableHead>
                                        <TableHead>{t("User")}</TableHead>
                                        <TableHead>{t("Thumbnail")}</TableHead>
                                        <TableHead>{t("Type")}</TableHead>
                                        <TableHead>{t("Prompt / Error")}</TableHead>
                                        <TableHead>{t("Tokens")}</TableHead>
                                        <TableHead>{t("Date")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {records.map((gen) => (
                                        <TableRow
                                            key={`${gen.status}-${gen.id}`}
                                            className={gen.status === 'failed' ? "bg-red-500/10 hover:bg-red-500/20" : "bg-green-500/10 hover:bg-green-500/20"}
                                        >
                                            <TableCell className="font-mono text-xs">
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="text-muted-foreground cursor-help">
                                                            {gen.id.slice(0, 8)}...
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top" className="font-mono text-xs">
                                                        {gen.id}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TableCell>
                                            <TableCell>
                                                {gen.status === 'failed' ? (
                                                    <Badge variant="destructive" className="text-[10px]">{t("Failed")}</Badge>
                                                ) : (
                                                    <Badge className="bg-green-600 hover:bg-green-700 text-[10px]">{t("Success")}</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="max-w-[150px]">
                                                <div className="text-xs truncate" title={gen.user_email}>{gen.user_email}</div>
                                            </TableCell>
                                            <TableCell>
                                                {(() => {
                                                    // For images: use thumbnail_url or fallback to image_url
                                                    // For videos: prefer thumbnail_url; fallback to an inline video preview
                                                    const previewUrl = gen.content_type === "video"
                                                        ? gen.thumbnail_url
                                                        : (gen.thumbnail_url || gen.image_url);

                                                    if (gen.content_type === "video" && !previewUrl && gen.image_url) {
                                                        return (
                                                            <video
                                                                src={gen.image_url}
                                                                className="w-16 h-16 object-cover rounded-md border bg-muted"
                                                                muted
                                                                playsInline
                                                                preload="metadata"
                                                                onLoadedData={(e) => {
                                                                    const target = e.currentTarget;
                                                                    try {
                                                                        target.currentTime = 0.1;
                                                                    } catch {
                                                                        // Some browsers block seeking before enough data; ignore.
                                                                    }
                                                                }}
                                                                onError={(e) => {
                                                                    const target = e.target as HTMLVideoElement;
                                                                    target.style.display = "none";
                                                                    target.parentElement!.innerHTML = `<div class="w-16 h-16 bg-muted rounded-md flex items-center justify-center border"><svg class="w-6 h-6 text-muted-foreground/50" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>`;
                                                                }}
                                                            />
                                                        );
                                                    }

                                                    if (!previewUrl) {
                                                        return (
                                                            <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center border">
                                                                <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <img
                                                            src={previewUrl}
                                                            alt={t("Post")}
                                                            className="w-16 h-16 object-cover rounded-md border bg-muted"
                                                            onError={(e) => {
                                                                // If thumbnail fails, try image_url as fallback
                                                                const target = e.target as HTMLImageElement;
                                                                if (gen.image_url && target.src !== gen.image_url) {
                                                                    target.src = gen.image_url;
                                                                } else {
                                                                    target.style.display = 'none';
                                                                    target.parentElement!.innerHTML = `<div class="w-16 h-16 bg-muted rounded-md flex items-center justify-center border"><svg class="w-6 h-6 text-muted-foreground/50" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>`;
                                                                }
                                                            }}
                                                        />
                                                    );
                                                })()}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[10px] capitalize">{gen.content_type}</Badge>
                                            </TableCell>
                                            <TableCell className="max-w-[300px]">
                                                {gen.status === 'failed' ? (
                                                    <div className="text-xs text-destructive mb-1 font-semibold">{t("Error")}: {gen.error_message}</div>
                                                ) : null}
                                                <p className="text-xs line-clamp-3 text-muted-foreground" title={gen.original_prompt || undefined}>
                                                    {gen.original_prompt || <span className="italic opacity-50">{t("No prompt")}</span>}
                                                </p>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground font-mono">
                                                {typeof gen.tokens_total === "number"
                                                    ? gen.tokens_total.toLocaleString(locale)
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                                {new Date(gen.created_at).toLocaleString(locale)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    {/* Pagination */}
                    {hasMultiplePages && (
                        <div className="flex items-center justify-between mt-4 pt-4 border-t">
                            <div className="text-sm text-muted-foreground">
                                {t("Page")} {pagination?.page ?? 1} {t("of")} {pagination?.totalPages ?? 1}
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1 || isFetching}
                                >
                                    <ChevronLeft className="w-4 h-4 mr-1" />
                                    {t("Previous")}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => p + 1)}
                                    disabled={!pagination?.hasMore || isFetching}
                                >
                                    {t("Next")}
                                    <ChevronRight className="w-4 h-4 ml-1" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

