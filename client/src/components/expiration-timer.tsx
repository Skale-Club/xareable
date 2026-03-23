/**
 * Expiration Timer Component
 * Shows a countdown timer for post expiration
 */

import { useState, useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

interface ExpirationTimerProps {
    expiresAt: string | null;
    className?: string;
    showIcon?: boolean;
    compact?: boolean;
}

interface TimeRemaining {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    totalMs: number;
}

function calculateTimeRemaining(expiresAt: string): TimeRemaining {
    const now = new Date().getTime();
    const expires = new Date(expiresAt).getTime();
    const totalMs = expires - now;

    if (totalMs <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0 };
    }

    const seconds = Math.floor((totalMs / 1000) % 60);
    const minutes = Math.floor((totalMs / (1000 * 60)) % 60);
    const hours = Math.floor((totalMs / (1000 * 60 * 60)) % 24);
    const days = Math.floor(totalMs / (1000 * 60 * 60 * 24));

    return { days, hours, minutes, seconds, totalMs };
}

export function ExpirationTimer({
    expiresAt,
    className,
    showIcon = true,
    compact = false
}: ExpirationTimerProps) {
    const { t } = useTranslation();
    const [timeRemaining, setTimeRemaining] = useState<TimeRemaining | null>(
        expiresAt ? calculateTimeRemaining(expiresAt) : null
    );

    useEffect(() => {
        if (!expiresAt) {
            setTimeRemaining(null);
            return;
        }

        // Initial calculation
        setTimeRemaining(calculateTimeRemaining(expiresAt));

        // Update every minute (no need for seconds precision)
        const interval = setInterval(() => {
            setTimeRemaining(calculateTimeRemaining(expiresAt));
        }, 60000);

        return () => clearInterval(interval);
    }, [expiresAt]);

    if (!expiresAt || !timeRemaining) {
        return null;
    }

    // Already expired
    if (timeRemaining.totalMs <= 0) {
        return (
            <div className={cn("text-red-500 flex items-center gap-1", className)}>
                {showIcon && <AlertTriangle className="w-3 h-3" />}
                <span className="text-xs font-medium">{t("Expired")}</span>
            </div>
        );
    }

    // Less than 3 days - show warning state
    const isUrgent = timeRemaining.days < 3;

    // Format the time remaining
    const formatTime = () => {
        if (compact) {
            if (timeRemaining.days > 0) {
                return `${timeRemaining.days}d ${timeRemaining.hours}h`;
            }
            if (timeRemaining.hours > 0) {
                return `${timeRemaining.hours}h ${timeRemaining.minutes}m`;
            }
            return `${timeRemaining.minutes}m`;
        }

        const parts: string[] = [];
        if (timeRemaining.days > 0) {
            parts.push(`${timeRemaining.days}${t("d")}`);
        }
        if (timeRemaining.hours > 0 || timeRemaining.days > 0) {
            parts.push(`${timeRemaining.hours}${t("h")}`);
        }
        parts.push(`${timeRemaining.minutes}${t("m")}`);
        return parts.join(" ");
    };

    return (
        <div
            className={cn(
                "flex items-center gap-1",
                isUrgent ? "text-orange-500" : "text-muted-foreground",
                className
            )}
            title={t("Expires in")}
        >
            {showIcon && <Clock className="w-3 h-3" />}
            <span className="text-xs font-medium">{formatTime()}</span>
        </div>
    );
}

/**
 * Expiration Badge Component
 * Shows expiration status as a badge overlay on post cards
 */
export function ExpirationBadge({
    expiresAt,
    className
}: {
    expiresAt: string | null;
    className?: string;
}) {
    const { t } = useTranslation();
    const [timeRemaining, setTimeRemaining] = useState<TimeRemaining | null>(
        expiresAt ? calculateTimeRemaining(expiresAt) : null
    );

    useEffect(() => {
        if (!expiresAt) {
            setTimeRemaining(null);
            return;
        }

        setTimeRemaining(calculateTimeRemaining(expiresAt));

        const interval = setInterval(() => {
            setTimeRemaining(calculateTimeRemaining(expiresAt));
        }, 60000);

        return () => clearInterval(interval);
    }, [expiresAt]);

    if (!expiresAt || !timeRemaining || timeRemaining.totalMs <= 0) {
        return null;
    }

    // Only show badge if less than 7 days remaining
    if (timeRemaining.days >= 7) {
        return null;
    }

    const isUrgent = timeRemaining.days < 3;

    const formatTime = () => {
        if (timeRemaining.days > 0) {
            return `${timeRemaining.days}d`;
        }
        if (timeRemaining.hours > 0) {
            return `${timeRemaining.hours}h`;
        }
        return `${timeRemaining.minutes}m`;
    };

    return (
        <div
            className={cn(
                "absolute bottom-2 left-2 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white flex items-center gap-1",
                isUrgent ? "bg-red-500/90" : "bg-orange-500/90",
                className
            )}
        >
            <Clock className="w-3 h-3" />
            {formatTime()}
        </div>
    );
}

/**
 * Simple badge component for inline use
 */
export function ExpirationBadgeInline({
    expiresAt,
    className
}: {
    expiresAt: string | null;
    className?: string;
}) {
    const { t } = useTranslation();
    const [timeRemaining, setTimeRemaining] = useState<TimeRemaining | null>(
        expiresAt ? calculateTimeRemaining(expiresAt) : null
    );

    useEffect(() => {
        if (!expiresAt) {
            setTimeRemaining(null);
            return;
        }

        setTimeRemaining(calculateTimeRemaining(expiresAt));

        const interval = setInterval(() => {
            setTimeRemaining(calculateTimeRemaining(expiresAt));
        }, 60000);

        return () => clearInterval(interval);
    }, [expiresAt]);

    if (!expiresAt || !timeRemaining || timeRemaining.totalMs <= 0) {
        return null;
    }

    // Only show badge if less than 7 days remaining
    if (timeRemaining.days >= 7) {
        return null;
    }

    const isUrgent = timeRemaining.days < 3;

    const formatTime = () => {
        if (timeRemaining.days > 0) {
            return `${timeRemaining.days}${t("d")} ${timeRemaining.hours}${t("h")}`;
        }
        if (timeRemaining.hours > 0) {
            return `${timeRemaining.hours}${t("h")} ${timeRemaining.minutes}${t("m")}`;
        }
        return `${timeRemaining.minutes}${t("m")}`;
    };

    return (
        <span
            className={cn(
                "text-xs font-medium flex items-center gap-1",
                isUrgent ? "text-red-500" : "text-orange-500",
                className
            )}
        >
            <Clock className="w-3 h-3" />
            {t("Expires in")} {formatTime()}
        </span>
    );
}

export default ExpirationTimer;
