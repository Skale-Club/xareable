/**
 * Translations barrel — assembles all locale dictionaries and exports the
 * public `translations` object + `getStaticTranslation` helper.
 *
 * Adding a new language:
 *   1. Create `./xx.ts` exporting `export const xx: Record<string, string> = { ... }`
 *   2. Add it to the `translations` object below and extend SupportedLanguage in shared/schema.ts
 *
 * Adding strings to an existing language:
 *   - Edit `./pt.ts` or `./es.ts` directly.
 *   - English is the implicit source language (en dict stays empty).
 */

import type { SupportedLanguage } from "@shared/schema";
import { normalizeTranslationKey } from "@shared/utils";
import { pt } from "./pt";
import { es } from "./es";

type TranslationDictionary = Record<SupportedLanguage, Record<string, string>>;

export const translations: TranslationDictionary = {
  en: {},
  pt,
  es,
};

// ── Normalised lookup table (built once at module load) ──────────────────────

const normalizedTranslations: TranslationDictionary = {
  en: {},
  pt: {},
  es: {},
};

for (const language of Object.keys(translations) as SupportedLanguage[]) {
  if (language === "en") continue;

  for (const [sourceText, translatedText] of Object.entries(translations[language])) {
    const normalizedKey = normalizeTranslationKey(sourceText);
    if (!normalizedTranslations[language][normalizedKey]) {
      normalizedTranslations[language][normalizedKey] = translatedText;
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getStaticTranslation(
  text: string,
  targetLanguage: SupportedLanguage
): string | null {
  if (targetLanguage === "en") return text;

  const directTranslation = translations[targetLanguage]?.[text];
  if (directTranslation) return directTranslation;

  const normalizedKey = normalizeTranslationKey(text);
  return normalizedTranslations[targetLanguage]?.[normalizedKey] || null;
}
