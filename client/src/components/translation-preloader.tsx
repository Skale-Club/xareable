import type { SupportedLanguage } from "@shared/schema";
import { getStaticTranslation } from "@/lib/translations";
import { PageLoader } from "@/components/page-loader";

interface TranslationPreloaderProps {
  language: SupportedLanguage;
}

export function TranslationPreloader({ language }: TranslationPreloaderProps) {
  const label = getStaticTranslation("Translating...", language) || "Translating...";

  return (
    <div aria-live="polite" role="status">
      <PageLoader
        fullscreen={false}
        label={label}
        plainLabel
        testId="translation-preloader"
      />
    </div>
  );
}
