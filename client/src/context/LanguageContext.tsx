import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import type { SupportedLanguage } from "@shared/schema";
import { getStaticTranslation } from "@/lib/translations";

interface TranslationCache {
  [key: string]: string;
}

interface LanguageContextType {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (text: string) => string;
  isTranslating: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = "language";

function getDefaultLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "en";
  
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "pt" || stored === "es") {
    return stored;
  }
  
  return "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(getDefaultLanguage);
  const [, forceUpdate] = useState(0);
  const [activeTranslationCount, setActiveTranslationCount] = useState(0);
  const cacheRef = useRef<TranslationCache>({});
  const renderPendingRef = useRef<Set<string>>(new Set());
  const queuedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const languageRef = useRef<SupportedLanguage>(language);
  const isTranslating = activeTranslationCount > 0;

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    renderPendingRef.current = new Set();
    queuedRef.current = new Set();
    inFlightRef.current = new Set();
    cacheRef.current = {};
    
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

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

    if (currentLang === "en") {
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

    const textsToTranslate = pendingKeys.map((key) => key.slice(prefix.length));
    const translations = await fetchTranslations(textsToTranslate, currentLang);

    pendingKeys.forEach((key) => inFlightRef.current.delete(key));

    if (languageRef.current !== currentLang) {
      return;
    }

    let didUpdate = false;

    for (const key of pendingKeys) {
      const originalText = key.slice(prefix.length);
      const translation = translations[originalText] || originalText;

      if (cacheRef.current[key] !== translation) {
        cacheRef.current[key] = translation;
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
      }, 50);
    }
  }, [fetchTranslations]);

  const scheduleFlush = useCallback(() => {
    if (timeoutRef.current || queuedRef.current.size === 0) {
      return;
    }

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      void flushQueuedTranslations();
    }, 50);
  }, [flushQueuedTranslations]);

  useEffect(() => {
    if (language === "en") {
      renderPendingRef.current = new Set();
      queuedRef.current = new Set();
      inFlightRef.current = new Set();

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

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

      queuedRef.current.add(key);
      shouldSchedule = true;
    });

    renderPendingRef.current = new Set();

    if (shouldSchedule) {
      scheduleFlush();
    }
  });

  const t = useCallback(
    (text: string): string => {
      const currentLang = languageRef.current;
      
      if (currentLang === "en") return text;

      const cacheKey = `${currentLang}:${text}`;
      
      if (cacheRef.current[cacheKey]) {
        return cacheRef.current[cacheKey];
      }

      const staticTranslation = getStaticTranslation(text, currentLang);
      if (staticTranslation) {
        cacheRef.current[cacheKey] = staticTranslation;
        return staticTranslation;
      }

      if (!queuedRef.current.has(cacheKey) && !inFlightRef.current.has(cacheKey)) {
        renderPendingRef.current.add(cacheKey);
      }

      return text;
    },
    []
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isTranslating }}>
      {children}
      {isTranslating && <TranslationPreloader />}
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

function TranslationPreloader() {
  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      data-testid="translation-preloader"
      role="status"
    >
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card/90 px-4 py-3 shadow-xl">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium text-foreground/90">Translating...</span>
      </div>
    </div>
  );
}
