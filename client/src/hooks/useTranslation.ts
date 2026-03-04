import { useLanguage } from "@/context/LanguageContext";

export function useTranslation() {
  return useLanguage();
}
