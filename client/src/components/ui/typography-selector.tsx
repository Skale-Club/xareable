import { useTranslation } from "@/hooks/useTranslation";
import { TextStylePickerSheet } from "@/components/text-style-picker-sheet";
import { GoogleFontsPickerSheet } from "@/components/google-fonts-picker-sheet";
import { type TextStyle } from "@shared/schema";
import { Plus, X, Type } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectedCustomFont {
  family: string;
  category: string;
}

interface TypographySelectorProps {
  availableStyles: TextStyle[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  maxSelections?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customFont?: SelectedCustomFont | null;
  onCustomFontChange?: (font: SelectedCustomFont | null) => void;
  googleFontsOpen?: boolean;
  onGoogleFontsOpenChange?: (open: boolean) => void;
  title?: string;
  className?: string;
}

export function TypographySelector({
  availableStyles,
  selectedIds,
  onChange,
  maxSelections = 3,
  open,
  onOpenChange,
  customFont,
  onCustomFontChange,
  googleFontsOpen = false,
  onGoogleFontsOpenChange,
  title = "Font styles",
  className,
}: TypographySelectorProps) {
  const { t } = useTranslation();
  const selectedTextStyles = availableStyles.filter((style) =>
    selectedIds.includes(style.id)
  );

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-2 sm:gap-3", className)}>
        <div className="flex items-center gap-3 mr-1">
          <span className="text-sm font-medium text-foreground whitespace-nowrap">
            {t(title)}
          </span>

          <TextStylePickerSheet
            open={open}
            onOpenChange={onOpenChange}
            styles={availableStyles}
            selectedIds={selectedIds}
            onSelectionChange={onChange}
            maxSelections={maxSelections}
            title={t("Choose Typography")}
            trigger={
              <button
                type="button"
                onClick={() => onOpenChange(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-400/5 text-violet-400 transition-all hover:border-violet-400/50 hover:bg-violet-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
                aria-label={t("Add Typography Style")}
              >
                <Plus className="h-5 w-5" />
              </button>
            }
          />

          {onGoogleFontsOpenChange && (
            <button
              type="button"
              onClick={() => onGoogleFontsOpenChange(true)}
              className={cn(
                "flex h-10 shrink-0 items-center justify-center rounded-xl border px-3 gap-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40",
                customFont
                  ? "border-violet-400 bg-violet-400/10 text-violet-400"
                  : "border-border bg-card/40 text-muted-foreground hover:border-violet-400/40 hover:text-foreground"
              )}
              aria-label={t("Custom Font")}
            >
              <Type className="h-4 w-4" />
              <span className="hidden sm:inline">{t("Custom")}</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-transparent rounded-xl">
          {selectedTextStyles.map((style) => (
            <div
              key={style.id}
              className="group relative flex h-10 items-center gap-3 overflow-hidden rounded-xl border border-border bg-card/40 pl-3 pr-2 shadow-sm transition-all hover:border-violet-400/40 hover:bg-violet-400/5"
            >
              <div className="flex flex-col justify-center min-w-[3rem]">
                <span
                  className="truncate text-[13px] leading-tight text-foreground"
                  style={{ fontFamily: style.preview.font_family, fontWeight: 700 }}
                >
                  {style.label}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  const newSelection = selectedIds.filter((id) => id !== style.id);
                  onChange(newSelection);
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-border/40 text-muted-foreground opacity-60 transition-all hover:bg-destructive hover:text-destructive-foreground hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                aria-label={`Remove ${style.label}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {customFont && (
            <div className="group relative flex h-10 items-center gap-3 overflow-hidden rounded-xl border border-violet-400/30 bg-violet-400/5 pl-3 pr-2 shadow-sm transition-all">
              <div className="flex flex-col justify-center min-w-[3rem]">
                <span
                  className="truncate text-[13px] leading-tight text-violet-400"
                  style={{ fontFamily: `'${customFont.family}', sans-serif`, fontWeight: 400 }}
                >
                  {customFont.family}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {customFont.category}
                </span>
              </div>

              {onCustomFontChange && (
                <button
                  type="button"
                  onClick={() => onCustomFontChange(null)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-border/40 text-muted-foreground opacity-60 transition-all hover:bg-destructive hover:text-destructive-foreground hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                  aria-label={`Remove ${customFont.family}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {!selectedTextStyles.length && !customFont && (
            <div className="h-10" aria-hidden="true" />
          )}
        </div>
      </div>

      {onGoogleFontsOpenChange && (
        <GoogleFontsPickerSheet
          open={googleFontsOpen}
          onOpenChange={onGoogleFontsOpenChange}
          selectedFontFamily={customFont?.family}
          onSelect={(font) => {
            onCustomFontChange?.(font);
            onGoogleFontsOpenChange(false);
          }}
        />
      )}
    </>
  );
}
