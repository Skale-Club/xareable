import { Loader2 } from "lucide-react";
import type { SupportedLanguage } from "@shared/schema";
import { getStaticTranslation } from "@/lib/translations";

interface TranslationPreloaderProps {
  language: SupportedLanguage;
}

export function TranslationPreloader({ language }: TranslationPreloaderProps) {
  const label = getStaticTranslation("Translating...", language) || "Translating...";

  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      data-testid="translation-preloader"
      role="status"
    >
      <div className="flex min-w-[170px] flex-col items-center gap-1 rounded-2xl border border-border/70 bg-card/95 px-5 py-3 shadow-xl">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
          <span className="text-base font-medium text-foreground/90">{label}</span>
        </div>
        <span className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
          Translate
        </span>
      </div>
    </div>
  );
}
