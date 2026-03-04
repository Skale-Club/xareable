/**
 * StatCard - Dashboard stat card with optional click-to-filter
 */

import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
    /** Card label/title */
    label: string;
    /** Value to display */
    value: string | number;
    /** Icon to show */
    icon: LucideIcon;
    /** Subtitle/description */
    sub: string;
    /** Whether the card is loading */
    loading?: boolean;
    /** Click handler (makes card clickable) */
    onClick?: () => void;
    /** Whether this card is currently selected/active */
    active?: boolean;
    /** Test ID for the card */
    testId?: string;
}

export function StatCard({
    label,
    value,
    icon: Icon,
    sub,
    loading = false,
    onClick,
    active = false,
    testId,
}: StatCardProps) {
    const clickable = !!onClick;

    return (
        <Card
            data-testid={testId}
            onClick={onClick}
            className={clickable ? `cursor-pointer transition-all ${active ? "ring-2 ring-violet-400" : "hover:ring-1 hover:ring-border"}` : ""}
        >
            <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="text-3xl font-bold mt-1">
                            {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : value}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-violet-400/15 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-pink-400" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
