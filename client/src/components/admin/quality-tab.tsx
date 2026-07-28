/**
 * Quality Tab (Phase 26 — POL-09)
 * Admin dashboard surfacing user feedback (posts.feedback, Phase 26-08)
 * alongside the visual-critic (Phase 24) and model-fallback (Phase 21)
 * signals that have been logged all along. Backed entirely by
 * GET /api/admin/quality (server/routes/admin-quality.routes.ts).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/hooks/useTranslation";
import { ThumbsUp, ThumbsDown, Gauge, GitMerge } from "lucide-react";

interface FeedbackTally {
    up: number;
    down: number;
    rated: number;
    total_posts: number;
}

interface CriticAggregate {
    total: number;
    by_outcome: Record<string, number>;
    text_free_compliance_rate: number | null;
    reroll_events: number;
    total_reroll_cost_usd_micros: number;
}

interface FallbackAggregate {
    total: number;
    by_call_class: Record<string, number>;
}

interface AdminQualityResponse {
    window_days: number;
    feedback: FeedbackTally;
    critic: CriticAggregate;
    fallback: FallbackAggregate;
}

const WINDOW_OPTIONS = [7, 30, 90];

/** The four known visual_critic outcomes (server/services/observability.service.ts). Any other value is rendered verbatim, never dropped. */
const KNOWN_CRITIC_OUTCOMES = ["pass", "soft_fail_accepted_best", "hard_fail_all_attempts", "critic_unavailable"];

const CRITIC_OUTCOME_LABELS: Record<string, string> = {
    pass: "Pass",
    soft_fail_accepted_best: "Soft fail (best kept)",
    hard_fail_all_attempts: "Hard fail (all attempts)",
    critic_unavailable: "Critic unavailable",
};

function formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return `${(value * 100).toFixed(1)}%`;
}

function formatRatio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
    if (!denominator || denominator <= 0) return null;
    if (numerator === null || numerator === undefined) return null;
    return numerator / denominator;
}

function formatUsdFromMicros(micros: number | null | undefined): string {
    const value = Number(micros ?? 0);
    if (!Number.isFinite(value)) return "—";
    return `$${(value / 1_000_000).toFixed(4)}`;
}

export function QualityTab() {
    const { t } = useTranslation();
    const [windowDays, setWindowDays] = useState(30);

    const { data, isLoading, isError, error } = useQuery<AdminQualityResponse>({
        queryKey: ["/api/admin/quality", windowDays],
        queryFn: () => adminFetch(`/api/admin/quality?days=${windowDays}`),
        staleTime: 0,
    });

    const feedback = data?.feedback;
    const critic = data?.critic;
    const fallback = data?.fallback;

    const positiveRate = formatRatio(feedback?.up, feedback ? feedback.rated : null);
    const participationRate = formatRatio(feedback?.rated, feedback?.total_posts);

    const hasAnyData = Boolean(
        (feedback && (feedback.rated > 0 || feedback.total_posts > 0)) ||
        (critic && critic.total > 0) ||
        (fallback && fallback.total > 0)
    );

    const outcomeKeys = critic
        ? Array.from(new Set([...KNOWN_CRITIC_OUTCOMES, ...Object.keys(critic.by_outcome)]))
        : [];
    const outcomeRows = outcomeKeys.map((outcome) => ({
        outcome,
        count: critic?.by_outcome[outcome] || 0,
    }));

    const callClassRows = fallback ? Object.entries(fallback.by_call_class) : [];

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("Quality")}</h1>
                    <p className="text-muted-foreground mt-2">
                        {t("User feedback, visual critic outcomes, and model fallback rates in one place.")}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {WINDOW_OPTIONS.map((days) => (
                        <Button
                            key={days}
                            variant={windowDays === days ? "default" : "outline"}
                            size="sm"
                            onClick={() => setWindowDays(days)}
                            data-testid={`button-quality-window-${days}`}
                        >
                            {days}d
                        </Button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div className="grid gap-4 md:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                        <Card key={i}>
                            <CardHeader>
                                <Skeleton className="h-5 w-32" />
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-2/3" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : isError ? (
                <div className="text-center py-12 text-sm text-destructive border rounded-lg border-dashed border-destructive/40">
                    {(error as Error)?.message || t("Failed to load quality data.")}
                </div>
            ) : !hasAnyData ? (
                <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg border-dashed" data-testid="text-quality-empty">
                    {t("No quality data in this window yet")}
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-3">
                    {/* Card 1: user feedback */}
                    <Card data-testid="card-quality-feedback">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <ThumbsUp className="w-4 h-4" />
                                {t("User feedback")}
                            </CardTitle>
                            <CardDescription>{t("Thumbs up/down votes on generated posts")}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                    <ThumbsUp className="w-3.5 h-3.5" />
                                    {t("Helpful")}
                                </span>
                                <span className="font-mono font-medium">{feedback?.up ?? 0}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                    <ThumbsDown className="w-3.5 h-3.5" />
                                    {t("Not helpful")}
                                </span>
                                <span className="font-mono font-medium">{feedback?.down ?? 0}</span>
                            </div>
                            <div className="flex items-center justify-between border-t pt-2">
                                <span className="text-muted-foreground">{t("Positive rate")}</span>
                                <span className="font-mono font-medium">{formatPercent(positiveRate)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">{t("Participation")}</span>
                                <span className="font-mono font-medium">
                                    {feedback ? `${feedback.rated} / ${feedback.total_posts}` : "—"} ({formatPercent(participationRate)})
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Card 2: visual critic */}
                    <Card data-testid="card-quality-critic">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Gauge className="w-4 h-4" />
                                {t("Visual critic")}
                            </CardTitle>
                            <CardDescription>{t("Composition, legibility, and color-harmony scoring outcomes")}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("Outcome")}</TableHead>
                                        <TableHead className="text-right">{t("Count")}</TableHead>
                                        <TableHead className="text-right">%</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {outcomeRows.map(({ outcome, count }) => (
                                        <TableRow key={outcome}>
                                            <TableCell className="text-xs">
                                                {CRITIC_OUTCOME_LABELS[outcome] ? t(CRITIC_OUTCOME_LABELS[outcome]) : outcome}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-xs">{count}</TableCell>
                                            <TableCell className="text-right font-mono text-xs">
                                                {critic && critic.total > 0 ? formatPercent(count / critic.total) : "—"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <div className="space-y-1.5 border-t pt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">{t("Text-free compliance")}</span>
                                    <span className="font-mono font-medium">{formatPercent(critic?.text_free_compliance_rate)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">{t("Re-roll events")}</span>
                                    <span className="font-mono font-medium">{critic?.reroll_events ?? 0}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">{t("Re-roll cost")}</span>
                                    <span className="font-mono font-medium">{formatUsdFromMicros(critic?.total_reroll_cost_usd_micros)}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Card 3: model fallbacks */}
                    <Card data-testid="card-quality-fallback">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <GitMerge className="w-4 h-4" />
                                {t("Model fallbacks")}
                            </CardTitle>
                            <CardDescription>{t("How often the gateway fell back to a secondary model")}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-center justify-between border-b pb-2">
                                <span className="text-muted-foreground">{t("Total fallbacks")}</span>
                                <span className="font-mono font-medium">{fallback?.total ?? 0}</span>
                            </div>
                            {callClassRows.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">{t("No quality data in this window yet")}</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t("Call class")}</TableHead>
                                            <TableHead className="text-right">{t("Count")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {callClassRows.map(([callClass, count]) => (
                                            <TableRow key={callClass}>
                                                <TableCell className="text-xs">{callClass}</TableCell>
                                                <TableCell className="text-right font-mono text-xs">{count}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
