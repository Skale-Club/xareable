import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import type { SupportedLanguage } from "@shared/schema";
import { TranslationPreloader } from "@/components/translation-preloader";
import { getStaticTranslation } from "@/lib/translations";

type TranslationCache = Record<string, string>;

interface LanguageContextType {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (text: string) => string;
  tDynamic: (text: string) => string;
  isTranslating: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = "language";
const ENGLISH_LANGUAGE: SupportedLanguage = "en";
const FLUSH_DELAY_MS = 50;
const TRANSLATION_BATCH_MAX_ITEMS = 60;
const TRANSLATION_BATCH_MAX_CHARS = 4000;
const RETRY_COOLDOWN_MS = 15_000;

function normalizeForComparison(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isAcronymToken(text: string): boolean {
  const compact = text.trim();
  return /^[A-Z0-9_-]+$/.test(compact) && compact.length <= 6;
}

function isLikelyUntranslatedSource(
  sourceText: string,
  translatedText: string,
  targetLanguage: SupportedLanguage
): boolean {
  if (targetLanguage === ENGLISH_LANGUAGE) {
    return false;
  }

  const source = sourceText.trim();
  const translated = translatedText.trim();
  if (!source || !translated) {
    return false;
  }

  if (!/[A-Za-z]/.test(source)) {
    return false;
  }

  if (isAcronymToken(source)) {
    return false;
  }

  return normalizeForComparison(source) === normalizeForComparison(translated);
}

function getDefaultLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return ENGLISH_LANGUAGE;
  
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "pt" || stored === "es") {
    return stored;
  }
  
  return ENGLISH_LANGUAGE;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(getDefaultLanguage);
  const [, forceUpdate] = useState(0);
  const [activeTranslationCount, setActiveTranslationCount] = useState(0);
  const [showPreloader, setShowPreloader] = useState(false);
  const cacheRef = useRef<TranslationCache>({});
  const renderPendingRef = useRef<Set<string>>(new Set());
  const queuedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const preloaderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const languageRef = useRef<SupportedLanguage>(language);
  const retryAfterRef = useRef<Map<string, number>>(new Map());
  const isTranslating = activeTranslationCount > 0;

  const clearPendingTranslations = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (preloaderTimeoutRef.current) {
      clearTimeout(preloaderTimeoutRef.current);
      preloaderTimeoutRef.current = null;
    }
    renderPendingRef.current = new Set();
    queuedRef.current = new Set();
    inFlightRef.current = new Set();
    retryAfterRef.current = new Map();
  }, []);

  const resetTranslations = useCallback(() => {
    clearPendingTranslations();
    cacheRef.current = {};
    setShowPreloader(false);
  }, [clearPendingTranslations]);

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    if (languageRef.current === lang) {
      return;
    }

    // Update ref immediately so the same render cycle uses the new language.
    languageRef.current = lang;
    resetTranslations();
    setActiveTranslationCount(0);
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, [resetTranslations]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const fetchTranslations = useCallback(async (texts: string[], targetLang: SupportedLanguage) => {
    setActiveTranslationCount((current) => current + 1);

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, targetLanguage: targetLang }),
      });

      if (!response.ok) {
        throw new Error("Translation failed");
      }

      const data = await response.json();
      return data.translations as Record<string, string>;
    } catch (error) {
      console.error("Translation error:", error);
      return {};
    } finally {
      setActiveTranslationCount((current) => Math.max(0, current - 1));
    }
  }, []);

  const flushQueuedTranslations = useCallback(async () => {
    const currentLang = languageRef.current;

    if (currentLang === ENGLISH_LANGUAGE) {
      queuedRef.current = new Set();
      inFlightRef.current = new Set();
      return;
    }

    const prefix = `${currentLang}:`;
    const pendingKeys = Array.from(queuedRef.current).filter((key) => key.startsWith(prefix));

    if (pendingKeys.length === 0) {
      return;
    }

    pendingKeys.forEach((key) => {
      queuedRef.current.delete(key);
      inFlightRef.current.add(key);
    });

    const allTexts = pendingKeys.map((key) => key.slice(prefix.length));
    const textBatches: string[][] = [];
    let currentBatch: string[] = [];
    let currentChars = 0;

    for (const text of allTexts) {
      const textLength = text.length;
      const reachesItemLimit = currentBatch.length >= TRANSLATION_BATCH_MAX_ITEMS;
      const reachesCharLimit =
        currentBatch.length > 0 && currentChars + textLength > TRANSLATION_BATCH_MAX_CHARS;

      if (reachesItemLimit || reachesCharLimit) {
        textBatches.push(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }

      currentBatch.push(text);
      currentChars += textLength;
    }

    if (currentBatch.length > 0) {
      textBatches.push(currentBatch);
    }

    const translations: Record<string, string> = {};
    for (const batch of textBatches) {
      const batchTranslations = await fetchTranslations(batch, currentLang);
      Object.assign(translations, batchTranslations);
    }

    pendingKeys.forEach((key) => inFlightRef.current.delete(key));

    if (languageRef.current !== currentLang) {
      return;
    }

    let didUpdate = false;

    for (const key of pendingKeys) {
      const originalText = key.slice(prefix.length);
      const translation = translations[originalText];
      if (!translation || translation.trim().length === 0) {
        // Keep cache untouched when translation is missing so fallback/static can still work
        // and future flushes can retry instead of freezing the English source text.
        retryAfterRef.current.set(key, Date.now() + RETRY_COOLDOWN_MS);
        continue;
      }

      if (isLikelyUntranslatedSource(originalText, translation, currentLang)) {
        // Ignore source-equal responses for non-English targets.
        retryAfterRef.current.set(key, Date.now() + RETRY_COOLDOWN_MS);
        continue;
      }

      if (cacheRef.current[key] !== translation) {
        cacheRef.current[key] = translation;
        retryAfterRef.current.delete(key);
        didUpdate = true;
      }
    }

    if (didUpdate) {
      forceUpdate((value) => value + 1);
    }

    if (queuedRef.current.size > 0 && !timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        void flushQueuedTranslations();
      }, FLUSH_DELAY_MS);
    }
  }, [fetchTranslations]);

  const scheduleFlush = useCallback(() => {
    if (timeoutRef.current || queuedRef.current.size === 0) {
      return;
    }

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      void flushQueuedTranslations();
    }, FLUSH_DELAY_MS);
  }, [flushQueuedTranslations]);

  useEffect(() => {
    if (language === ENGLISH_LANGUAGE) {
      clearPendingTranslations();
      return;
    }

    if (renderPendingRef.current.size === 0) {
      return;
    }

    let shouldSchedule = false;

    renderPendingRef.current.forEach((key) => {
      if (cacheRef.current[key] || queuedRef.current.has(key) || inFlightRef.current.has(key)) {
        return;
      }

      const retryAfter = retryAfterRef.current.get(key);
      if (retryAfter && retryAfter > Date.now()) {
        return;
      }

      queuedRef.current.add(key);
      shouldSchedule = true;
    });

    renderPendingRef.current = new Set();

    if (shouldSchedule) {
      scheduleFlush();
    }
  });

  useEffect(() => {
    if (!isTranslating) {
      if (preloaderTimeoutRef.current) {
        clearTimeout(preloaderTimeoutRef.current);
        preloaderTimeoutRef.current = null;
      }
      setShowPreloader(false);
      return;
    }

    if (!preloaderTimeoutRef.current) {
      preloaderTimeoutRef.current = setTimeout(() => {
        preloaderTimeoutRef.current = null;
        setShowPreloader(true);
      }, 250);
    }
  }, [isTranslating]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (preloaderTimeoutRef.current) {
        clearTimeout(preloaderTimeoutRef.current);
      }
    };
  }, []);

  const translateText = useCallback(
    (text: string, useStaticDictionary: boolean): string => {
      const currentLang = languageRef.current;
      if (currentLang === ENGLISH_LANGUAGE) return text;

      const cacheKey = `${currentLang}:${text}`;

      if (useStaticDictionary) {
        const staticTranslation = getStaticTranslation(text, currentLang);
        if (staticTranslation) {
          if (!queuedRef.current.has(cacheKey) && !inFlightRef.current.has(cacheKey)) {
            // Keep static text as instant fallback, but always fetch a runtime translation
            // so we can replace ASCII-only legacy entries with proper diacritics.
            renderPendingRef.current.add(cacheKey);
          }
          return staticTranslation;
        }
      }

      if (cacheRef.current[cacheKey]) {
        return cacheRef.current[cacheKey];
      }

      const retryAfter = retryAfterRef.current.get(cacheKey);
      if (retryAfter && retryAfter > Date.now()) {
        return text;
      }

      if (!queuedRef.current.has(cacheKey) && !inFlightRef.current.has(cacheKey)) {
        renderPendingRef.current.add(cacheKey);
      }

      return text;
    },
    []
  );

  const t = useCallback((text: string) => translateText(text, true), [translateText]);
  const tDynamic = useCallback((text: string) => translateText(text, false), [translateText]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, tDynamic, isTranslating }}>
      {children}
      {showPreloader && <TranslationPreloader language={language} />}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
