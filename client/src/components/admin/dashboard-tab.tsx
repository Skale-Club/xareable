import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { adminFetch, formatCost } from "@/lib/admin";
import type { AdminStats } from "@/lib/admin/types";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { PageLoader } from "@/components/page-loader";
import { useTranslation } from "@/hooks/useTranslation";
import { StatCard } from "./stat-card";
import {
    Activity,
    BadgeDollarSign,
    BarChart3,
    CreditCard,
    DollarSign,
    Loader2,
    CalendarRange,
    RefreshCw,
    Sparkles,
    TrendingUp,
    Users,
} from "lucide-react";

interface GenerationRecord {
    id: string;
    user_email: string;
    created_at: string;
    original_prompt: string | null;
    content_type: "image" | "video";
    status: "completed" | "failed";
    error_message: string | null;
    tokens_total: number | null;
}

interface GenerationsResponse {
    generations: GenerationRecord[];
}

function formatTokenCount(value: number | null | undefined): string {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return "0";
    return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(numeric)));
}

function formatPercent(value: number): string {
    return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function truncateText(value: string | null | undefined, maxLength = 120): string {
    const text = (value || "").trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}...`;
}

export function DashboardTab() {
    const { t, language } = useTranslation();
    const locale = language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US";
    const [windowDays, setWindowDays] = useState(14);
    const [rangeMode, setRangeMode] = useState<"preset" | "custom">("preset");
    const [customRange, setCustomRange] = useState<DateRange | undefined>();
    const [generationStatus, setGenerationStatus] = useState<"all" | "completed" | "failed">("all");
    const [contentType, setContentType] = useState<"all" | "image" | "video">("all");
    const hasCompleteCustomRange = Boolean(customRange?.from && customRange?.to);
    const statsQuerySuffix =
        rangeMode === "custom" && customRange?.from && customRange?.to
            ? `from=${format(customRange.from, "yyyy-MM-dd")}&to=${format(customRange.to, "yyyy-MM-dd")}`
            : `days=${windowDays}`;

    const {
        data: stats,
        isLoading: statsLoading,
        error: statsError,
        refetch: refetchStats,
        isFetching: isFetchingStats,
    } = useQuery<AdminStats>({
        queryKey: [
            "/api/admin/stats",
            rangeMode,
            windowDays,
            customRange?.from ? format(customRange.from, "yyyy-MM-dd") : null,
            customRange?.to ? format(customRange.to, "yyyy-MM-dd") : null,
        ],
        queryFn: () => adminFetch(`/api/admin/stats?${statsQuerySuffix}`),
    });

    const {
        data: recentGenerations,
        isLoading: recentLoading,
        error: recentError,
        refetch: refetchRecent,
        isFetching: isFetchingRecent,
    } = useQuery<GenerationsResponse>({
        queryKey: ["/api/admin/generations", "dashboard", 6, generationStatus, contentType],
        queryFn: () =>
            adminFetch(
                `/api/admin/generations?page=1&limit=6&status=${generationStatus}&content_type=${contentType}&search=`
            ),
    });

    const isInitialLoading = statsLoading && !stats && !statsError;

    if (isInitialLoading) {
        return <PageLoader />;
    }

    const analytics = stats
        ? (stats.analytics ?? {
            windowDays,
            from: "",
            to: "",
            isCustom: false,
            users: stats.totalUsers,
            posts: stats.totalPosts,
            usageEvents: stats.totalUsageEvents,
            postingUsers: stats.postingUsers,
            costUsdMicros: stats.totalCostUsdMicros,
            chargedAmountMicros: stats.totalChargedAmountMicros,
            grossProfitMicros: stats.grossProfitMicros,
            totalTokens: stats.totalTokens,
            textInputTokens: stats.totalTextInputTokens,
            textOutputTokens: stats.totalTextOutputTokens,
            imageInputTokens: stats.totalImageInputTokens,
            imageOutputTokens: stats.totalImageOutputTokens,
            textInputCostUsdMicros: stats.totalTextInputCostUsdMicros,
            textOutputCostUsdMicros: stats.totalTextOutputCostUsdMicros,
            imageInputCostUsdMicros: stats.totalImageInputCostUsdMicros,
            imageOutputCostUsdMicros: stats.totalImageOutputCostUsdMicros,
            unattributedCostUsdMicros: stats.unattributedCostUsdMicros,
            averageRevenuePerEventMicros: stats.averageRevenuePerEventMicros,
            averageCostPerEventMicros: stats.averageCostPerEventMicros,
            textModels: stats.textModels,
            imageModels: stats.imageModels,
            daily: [],
        })
        : null;

    const chartData = (analytics?.daily || []).map((day) => ({
        ...day,
        label: new Date(`${day.date}T00:00:00`).toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
        }),
        revenueUsd: Number((day.chargedAmountMicros / 1_000_000).toFixed(4)),
        costUsd: Number((day.costUsdMicros / 1_000_000).toFixed(4)),
    }));

    const tokenBreakdown = stats
        ? [
            {
                label: "Text Input",
                value: analytics?.textInputTokens ?? 0,
                cost: analytics?.textInputCostUsdMicros ?? 0,
                color: "bg-violet-400",
            },
            {
                label: "Text Output",
                value: analytics?.textOutputTokens ?? 0,
                cost: analytics?.textOutputCostUsdMicros ?? 0,
                color: "bg-pink-400",
            },
            {
                label: "Image Input",
                value: analytics?.imageInputTokens ?? 0,
                cost: analytics?.imageInputCostUsdMicros ?? 0,
                color: "bg-cyan-400",
            },
            {
                label: "Image Output",
                value: analytics?.imageOutputTokens ?? 0,
                cost: analytics?.imageOutputCostUsdMicros ?? 0,
                color: "bg-orange-400",
            },
        ]
        : [];

    const topTextModels = (analytics?.textModels || []).slice(0, 4);
    const topImageModels = (analytics?.imageModels || []).slice(0, 4);
    const recentItems = recentGenerations?.generations || [];
    const refreshPending = isFetchingStats || isFetchingRecent;
    const customRangeLabel =
        customRange?.from && customRange?.to
            ? `${format(customRange.from, "MMM d")} - ${format(customRange.to, "MMM d")}`
            : t("Custom range");

    return (
        <div className="space-y-6 pb-10">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("Dashboard")}</h1>
                    <p className="mt-2 text-muted-foreground">
                        {t("Track growth, platform economics, token usage, and recent generation activity in one place.")}
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={() => {
                        void Promise.all([refetchStats(), refetchRecent()]);
                    }}
                    disabled={refreshPending}
                    className="self-start"
                >
                    <RefreshCw className={`mr-2 h-4 w-4 ${refreshPending ? "animate-spin" : ""}`} />
                    {t("Refresh")}
                </Button>
            </div>

            <Card>
                <CardContent className="flex flex-col gap-4 pt-6 xl:flex-row xl:items-center xl:justify-between">
                    <div className="space-y-2">
                        <p className="text-sm font-medium">{t("Analysis Window")}</p>
                            <div className="flex flex-wrap gap-2">
                                {[7, 14, 30, 90].map((days) => (
                                    <Button
                                        key={days}
                                        variant={rangeMode === "preset" && windowDays === days ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => {
                                            setRangeMode("preset");
                                            setWindowDays(days);
                                        }}
                                    >
                                        {days}d
                                    </Button>
                                ))}
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={rangeMode === "custom" ? "default" : "outline"}
                                            size="sm"
                                        >
                                            <CalendarRange className="mr-2 h-4 w-4" />
                                            {customRangeLabel}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="start" className="w-auto p-0">
                                        <div className="border-b px-4 py-3">
                                            <div className="text-sm font-medium">{t("Custom range")}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {t("Select a start and end date for the dashboard analysis.")}
                                            </div>
                                        </div>
                                        <Calendar
                                            mode="range"
                                            numberOfMonths={2}
                                            selected={customRange}
                                            onSelect={(nextRange) => {
                                                setCustomRange(nextRange);
                                                if (nextRange?.from && nextRange?.to) {
                                                    setRangeMode("custom");
                                                }
                                            }}
                                            disabled={(date) => date > new Date()}
                                            initialFocus
                                        />
                                        <div className="flex items-center justify-between border-t px-4 py-3">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setCustomRange(undefined);
                                                    setRangeMode("preset");
                                                }}
                                            >
                                                {t("Clear")}
                                            </Button>
                                            <div className="text-xs text-muted-foreground">
                                                {hasCompleteCustomRange ? t("Custom range applied") : t("Choose both dates")}
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <div className="space-y-2">
                            <p className="text-sm font-medium">{t("Recent Status")}</p>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { value: "all", label: "All" },
                                    { value: "completed", label: "Success" },
                                    { value: "failed", label: "Failed" },
                                ].map((option) => (
                                    <Button
                                        key={option.value}
                                        variant={generationStatus === option.value ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setGenerationStatus(option.value as "all" | "completed" | "failed")}
                                    >
                                        {t(option.label)}
                                    </Button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2 sm:col-span-2 xl:col-span-1">
                            <p className="text-sm font-medium">{t("Content Type")}</p>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { value: "all", label: "All Types" },
                                    { value: "image", label: "Image" },
                                    { value: "video", label: "Video" },
                                ].map((option) => (
                                    <Button
                                        key={option.value}
                                        variant={contentType === option.value ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setContentType(option.value as "all" | "image" | "video")}
                                    >
                                        {t(option.label)}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {statsError && (
                <Alert variant="destructive">
                    <AlertTitle>{t("Admin data failed to load")}</AlertTitle>
                    <AlertDescription>
                        {statsError.message || t("The server rejected the request.")}
                    </AlertDescription>
                </Alert>
            )}

            {stats && (
                <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard
                            label="Total Users"
                            value={stats.totalUsers}
                            icon={Users}
                            sub={`+${stats.newUsersToday} ${t("today")}`}
                        />
                        <StatCard
                            label="Total Posts"
                            value={stats.totalPosts}
                            icon={Sparkles}
                            sub={`+${stats.newPostsToday} ${t("today")}`}
                        />
                        <StatCard
                            label="Paid Users"
                            value={stats.activeSubscribers}
                            icon={CreditCard}
                            sub={`${formatPercent(stats.paidRate)} ${t("conversion")}`}
                        />
                        <StatCard
                            label="Revenue"
                            value={formatCost(stats.totalChargedAmountMicros)}
                            icon={BadgeDollarSign}
                            sub={`${formatCost(stats.grossProfitMicros)} ${t("gross profit")}`}
                            className="border-emerald-400/30 bg-emerald-500/5"
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm text-muted-foreground">{t("Provider Cost")}</p>
                                        <p className="mt-1 text-2xl font-semibold">{formatCost(analytics?.costUsdMicros ?? 0)}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {formatCost(analytics?.averageCostPerEventMicros ?? 0)} {t("per event")}
                                        </p>
                                    </div>
                                    <DollarSign className="h-5 w-5 text-cyan-400" />
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm text-muted-foreground">{t("Gross Profit")}</p>
                                        <p className="mt-1 text-2xl font-semibold">{formatCost(analytics?.grossProfitMicros ?? 0)}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {formatCost(analytics?.averageRevenuePerEventMicros ?? 0)} {t("revenue per event")}
                                        </p>
                                    </div>
                                    <TrendingUp className="h-5 w-5 text-emerald-400" />
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm text-muted-foreground">{t("Total Tokens")}</p>
                                        <p className="mt-1 text-2xl font-semibold">{formatTokenCount(analytics?.totalTokens ?? 0)}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {analytics?.usageEvents ?? 0} {t("events in window")}
                                        </p>
                                    </div>
                                    <Activity className="h-5 w-5 text-violet-400" />
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm text-muted-foreground">{t("Posting Users")}</p>
                                        <p className="mt-1 text-2xl font-semibold">{analytics?.postingUsers ?? 0}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {analytics?.posts ?? 0} {t("posts in window")}
                                        </p>
                                    </div>
                                    <BarChart3 className="h-5 w-5 text-pink-400" />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("Revenue vs Cost")}</CardTitle>
                                <CardDescription>
                                    {t("Daily platform economics over the selected analysis window.")}{" "}
                                    {analytics?.isCustom && analytics.from && analytics.to
                                        ? `${analytics.from} - ${analytics.to}`
                                        : `${analytics?.windowDays ?? windowDays}d`}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ChartContainer
                                    config={{
                                        revenueUsd: { label: t("Revenue"), color: "#34d399" },
                                        costUsd: { label: t("Cost"), color: "#22d3ee" },
                                    }}
                                    className="h-[300px] w-full"
                                >
                                    <AreaChart data={chartData}>
                                        <defs>
                                            <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="var(--color-revenueUsd)" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="var(--color-revenueUsd)" stopOpacity={0.02} />
                                            </linearGradient>
                                            <linearGradient id="fillCost" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="var(--color-costUsd)" stopOpacity={0.25} />
                                                <stop offset="95%" stopColor="var(--color-costUsd)" stopOpacity={0.02} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid vertical={false} />
                                        <XAxis
                                            dataKey="label"
                                            tickLine={false}
                                            axisLine={false}
                                            minTickGap={20}
                                        />
                                        <YAxis
                                            tickLine={false}
                                            axisLine={false}
                                            width={72}
                                            tickFormatter={(value) => `$${Number(value).toFixed(2)}`}
                                        />
                                        <ChartTooltip
                                            content={
                                                <ChartTooltipContent
                                                    formatter={(value, name) => (
                                                        <div className="flex w-full items-center justify-between gap-4">
                                                            <span className="text-muted-foreground">{String(name)}</span>
                                                            <span className="font-mono">{`$${Number(value).toFixed(4)}`}</span>
                                                        </div>
                                                    )}
                                                />
                                            }
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="revenueUsd"
                                            stroke="var(--color-revenueUsd)"
                                            fill="url(#fillRevenue)"
                                            strokeWidth={2}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="costUsd"
                                            stroke="var(--color-costUsd)"
                                            fill="url(#fillCost)"
                                            strokeWidth={2}
                                        />
                                    </AreaChart>
                                </ChartContainer>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t("Growth Funnel")}</CardTitle>
                                <CardDescription>{t("Quick view of onboarding, activation, and monetization health.")}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span>{t("Brand Setup")}</span>
                                        <span className="font-medium">{formatPercent(stats.brandSetupRate)}</span>
                                    </div>
                                    <Progress value={stats.brandSetupRate} className="h-2.5" />
                                    <p className="text-xs text-muted-foreground">
                                        {stats.totalBrands} / {stats.totalUsers} {t("users with brand configured")}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span>{t("Posting Activation")}</span>
                                        <span className="font-medium">{formatPercent(stats.postingRate)}</span>
                                    </div>
                                    <Progress value={stats.postingRate} className="h-2.5" />
                                    <p className="text-xs text-muted-foreground">
                                        {stats.postingUsers} {t("users already generated at least one post")}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span>{t("Paid Conversion")}</span>
                                        <span className="font-medium">{formatPercent(stats.paidRate)}</span>
                                    </div>
                                    <Progress value={stats.paidRate} className="h-2.5" />
                                    <p className="text-xs text-muted-foreground">
                                        {stats.activeSubscribers} {t("buyers")} | {stats.trialingUsers} {t("still in free tier")}
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-1">
                                    <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("Trialing")}</p>
                                        <p className="mt-1 text-xl font-semibold">{stats.trialingUsers}</p>
                                    </div>
                                    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("Low Balance")}</p>
                                        <p className="mt-1 text-xl font-semibold">{stats.quotaExhausted}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("Token Mix")}</CardTitle>
                                <CardDescription>{t("Where token consumption is happening across the platform.")}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {tokenBreakdown.map((item) => {
                                    const share = (analytics?.totalTokens ?? 0) > 0 ? (item.value / (analytics?.totalTokens ?? 0)) * 100 : 0;
                                    return (
                                        <div key={item.label} className="space-y-2">
                                            <div className="flex items-center justify-between gap-4 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
                                                    <span>{t(item.label)}</span>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-medium">{formatTokenCount(item.value)}</div>
                                                    <div className="text-xs text-muted-foreground">{formatCost(item.cost)}</div>
                                                </div>
                                            </div>
                                            <Progress value={share} className="h-2" />
                                        </div>
                                    );
                                })}
                                {(analytics?.unattributedCostUsdMicros ?? 0) > 0 && (
                                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                                        {t("Unattributed cost")}: {formatCost(analytics?.unattributedCostUsdMicros ?? 0)}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t("Models in Use")}</CardTitle>
                                <CardDescription>{t("Most active text and image models based on token volume.")}</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-5 md:grid-cols-2">
                                <div className="space-y-3">
                                    <div className="text-sm font-medium text-muted-foreground">{t("Text Models")}</div>
                                    {topTextModels.length ? topTextModels.map((model) => (
                                        <div key={`text-${model.model}`} className="rounded-xl border border-border/60 p-3">
                                            <div className="truncate text-sm font-medium">{model.model}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {formatTokenCount(model.tokens)} {t("tokens")}
                                            </div>
                                            <div className="mt-2 text-xs text-muted-foreground">
                                                {model.events} {t("events")}
                                            </div>
                                        </div>
                                    )) : (
                                        <p className="text-sm text-muted-foreground">{t("No text model usage yet.")}</p>
                                    )}
                                </div>
                                <div className="space-y-3">
                                    <div className="text-sm font-medium text-muted-foreground">{t("Image Models")}</div>
                                    {topImageModels.length ? topImageModels.map((model) => (
                                        <div key={`image-${model.model}`} className="rounded-xl border border-border/60 p-3">
                                            <div className="truncate text-sm font-medium">{model.model}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {formatTokenCount(model.tokens)} {t("tokens")}
                                            </div>
                                            <div className="mt-2 text-xs text-muted-foreground">
                                                {model.events} {t("events")}
                                            </div>
                                        </div>
                                    )) : (
                                        <p className="text-sm text-muted-foreground">{t("No image model usage yet.")}</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}

            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                        <CardTitle>{t("Recent Generations")}</CardTitle>
                        <CardDescription>
                            {t("Latest generation attempts across the platform with the selected filters.")}
                        </CardDescription>
                    </div>
                    {recentLoading || isFetchingRecent ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                </CardHeader>
                <CardContent>
                    {recentError ? (
                        <Alert variant="destructive">
                            <AlertTitle>{t("Failed to load generations.")}</AlertTitle>
                            <AlertDescription>
                                {recentError.message || t("The server rejected the request.")}
                            </AlertDescription>
                        </Alert>
                    ) : recentItems.length ? (
                        <div className="space-y-3">
                            {recentItems.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/10 p-4 lg:flex-row lg:items-start lg:justify-between"
                                >
                                    <div className="min-w-0 space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge
                                                variant="secondary"
                                                className={item.status === "failed" ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}
                                            >
                                                {t(item.status === "failed" ? "Failed" : "Success")}
                                            </Badge>
                                            <Badge variant="outline">{t(item.content_type === "video" ? "Video" : "Image")}</Badge>
                                            <span className="text-xs text-muted-foreground">{item.user_email}</span>
                                        </div>
                                        <p className="text-sm text-foreground/90">
                                            {truncateText(item.original_prompt || item.error_message || t("No prompt provided."))}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-4 text-xs text-muted-foreground">
                                        <span>
                                            {new Date(item.created_at).toLocaleString(locale)}
                                        </span>
                                        <span>
                                            {formatTokenCount(item.tokens_total)} {t("tokens")}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">{t("No generations found.")}</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
