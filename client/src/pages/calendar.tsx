/**
 * Content Calendar (Project P001 — Zernio)
 *
 * Month grid of the user's scheduled / published posts. Data comes from
 * GET /api/social/scheduled?from&to. Gated by publishing_mode (same as the rest
 * of the publishing feature).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    addMonths,
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    startOfMonth,
    startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

interface ScheduledPost {
    id: string;
    caption: string | null;
    scheduled_for: string | null;
    published_at: string | null;
    status: string;
}

const STATUS_STYLES: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    pending_approval: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
    scheduled: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
    publishing: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    published: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    failed: "bg-red-500/15 text-red-600 dark:text-red-300",
    canceled: "bg-muted text-muted-foreground line-through",
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function CalendarPage() {
    const { profile } = useAuth();
    const mode = (profile as any)?.publishing_mode ?? "disabled";
    const [month, setMonth] = useState(() => startOfMonth(new Date()));

    const rangeStart = useMemo(() => startOfWeek(startOfMonth(month)), [month]);
    const rangeEnd = useMemo(() => endOfWeek(endOfMonth(month)), [month]);

    const query = useQuery<{ scheduled_posts: ScheduledPost[] }>({
        queryKey: [`/api/social/scheduled?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`],
        enabled: mode !== "disabled",
    });

    const days = useMemo(
        () => eachDayOfInterval({ start: rangeStart, end: rangeEnd }),
        [rangeStart, rangeEnd],
    );

    const postsByDay = useMemo(() => {
        const map = new Map<string, ScheduledPost[]>();
        for (const p of query.data?.scheduled_posts ?? []) {
            const when = p.scheduled_for || p.published_at;
            if (!when) continue;
            const key = format(new Date(when), "yyyy-MM-dd");
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(p);
        }
        return map;
    }, [query.data]);

    if (mode === "disabled") {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div className="max-w-md">
                    <h1 className="text-lg font-semibold">Calendário indisponível</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        A publicação em redes sociais não está habilitada para a sua conta.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-semibold">Calendário</h1>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => setMonth((m) => addMonths(m, -1))} data-testid="btn-prev-month">
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm font-medium w-36 text-center capitalize">
                        {format(month, "MMMM yyyy")}
                    </span>
                    <Button variant="outline" size="icon" onClick={() => setMonth((m) => addMonths(m, 1))} data-testid="btn-next-month">
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {query.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                </div>
            ) : (
                <div className="grid grid-cols-7 gap-px rounded-lg border bg-border overflow-hidden">
                    {WEEKDAYS.map((d) => (
                        <div key={d} className="bg-background px-2 py-1 text-xs font-medium text-muted-foreground text-center">
                            {d}
                        </div>
                    ))}
                    {days.map((day) => {
                        const key = format(day, "yyyy-MM-dd");
                        const dayPosts = postsByDay.get(key) ?? [];
                        const muted = !isSameMonth(day, month);
                        return (
                            <div
                                key={key}
                                className={`bg-background min-h-24 p-1.5 flex flex-col gap-1 ${muted ? "opacity-40" : ""}`}
                                data-testid={`calendar-day-${key}`}
                            >
                                <span
                                    className={`text-xs ${isSameDay(day, new Date()) ? "font-bold text-primary" : "text-muted-foreground"}`}
                                >
                                    {format(day, "d")}
                                </span>
                                {dayPosts.slice(0, 3).map((p) => (
                                    <div
                                        key={p.id}
                                        className={`text-[11px] leading-tight rounded px-1 py-0.5 truncate ${STATUS_STYLES[p.status] ?? STATUS_STYLES.draft}`}
                                        title={p.caption ?? p.status}
                                    >
                                        {p.caption?.slice(0, 24) || p.status}
                                    </div>
                                ))}
                                {dayPosts.length > 3 && (
                                    <span className="text-[10px] text-muted-foreground">+{dayPosts.length - 3}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
