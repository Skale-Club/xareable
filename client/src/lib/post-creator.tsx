import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SupportedLanguage } from "@shared/schema";
import { useLanguage } from "@/context/LanguageContext";

interface PostCreatorState {
  isOpen: boolean;
  createdVersion: number;
  contentLanguage: SupportedLanguage;
  setContentLanguage: (lang: SupportedLanguage) => void;
  openCreator: (reset?: boolean) => void;
  closeCreator: () => void;
  markCreated: () => void;
}

const PostCreatorContext = createContext<PostCreatorState | null>(null);

export function PostCreatorProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [createdVersion, setCreatedVersion] = useState(0);
  const [contentLanguage, setContentLanguage] = useState<SupportedLanguage>(language);

  useEffect(() => {
    if (!isOpen) {
      setContentLanguage(language);
    }
  }, [isOpen, language]);

  function openCreator() {
    setContentLanguage(language);
    setIsOpen(true);
  }

  function closeCreator() {
    setIsOpen(false);
  }

  function markCreated() {
    setCreatedVersion((value) => value + 1);
  }

  return (
    <PostCreatorContext.Provider
      value={{ 
        isOpen, 
        createdVersion, 
        contentLanguage,
        setContentLanguage,
        openCreator, 
        closeCreator, 
        markCreated 
      }}
    >
      {children}
    </PostCreatorContext.Provider>
  );
}

export function usePostCreator() {
  const context = useContext(PostCreatorContext);
  if (!context) {
    throw new Error("usePostCreator must be used within PostCreatorProvider");
  }
  return context;
}
