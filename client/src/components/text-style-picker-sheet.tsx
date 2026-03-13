import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { TextStyle } from "@shared/schema";
import type { ReactNode } from "react";

interface TextStylePickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  styles: TextStyle[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  maxSelections?: number;
  title: string;
  trigger: ReactNode;
}

export function TextStylePickerSheet({
  open,
  onOpenChange,
  styles,
  selectedIds,
  onSelectionChange,
  maxSelections = 3,
  title,
  trigger,
}: TextStylePickerSheetProps) {
  const { t } = useTranslation();

  function toggleStyle(styleId: string) {
    if (selectedIds.includes(styleId)) {
      onSelectionChange(selectedIds.filter((id) => id !== styleId));
      return;
    }

    if (selectedIds.length >= maxSelections) {
      onSelectionChange([...selectedIds.slice(1), styleId]);
      return;
    }

    onSelectionChange([...selectedIds, styleId]);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] p-3"
      >
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">{t(title)}</div>
          </div>
          <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {styles.map((style) => {
              const selected = selectedIds.includes(style.id);
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => toggleStyle(style.id)}
                  className={cn(
                    "rounded-lg border p-2 text-left transition-all",
                    selected
                      ? "border-violet-400 bg-violet-400/8"
                      : "border-border hover:border-violet-400/40"
                  )}
                  data-testid={`text-style-sheet-${style.id}`}
                >
                  <div
                    className="truncate text-sm leading-none"
                    style={{ fontFamily: style.preview.font_family }}
                  >
                    {style.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
