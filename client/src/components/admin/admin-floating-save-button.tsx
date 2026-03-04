/**
 * AdminFloatingSaveButton - Fixed position save button for admin forms
 */

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { Loader2, Save } from "lucide-react";

interface AdminFloatingSaveButtonProps {
    /** Click handler */
    onClick: () => void;
    /** Whether the button is disabled/loading */
    disabled: boolean;
    /** Button label text */
    label: string;
}

export function AdminFloatingSaveButton({
    onClick,
    disabled,
    label,
}: AdminFloatingSaveButtonProps) {
    const { t } = useTranslation();

    return (
        <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
            <Button
                onClick={onClick}
                disabled={disabled}
                size="lg"
                className="w-[calc(100vw-2rem)] justify-center gap-2 shadow-lg sm:w-auto sm:min-w-[180px]"
            >
                {disabled ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Save className="w-4 h-4" />
                )}
                {t(label)}
            </Button>
        </div>
    );
}
