import { useLanguage } from "@/context/LanguageContext";
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, type SupportedLanguage } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { LanguageFlagIcon } from "@/components/ui/LanguageFlagIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface LanguageToggleProps {
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm" | "lg" | "icon";
  showLabel?: boolean;
}

export function LanguageToggle({ 
  variant = "ghost", 
  size = "sm",
  showLabel = false 
}: LanguageToggleProps) {
  const { language, setLanguage } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className="gap-1.5 h-8 border-0" data-testid="language-toggle">
          {showLabel && (
            <span className="hidden sm:inline">{LANGUAGE_NAMES[language]}</span>
          )}
          <LanguageFlagIcon language={language} className="h-4 w-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onSelect={() => setLanguage(lang as SupportedLanguage)}
            className={`gap-2 ${language === lang ? "bg-accent" : ""}`}
            data-testid={`language-option-${lang}`}
          >
            <LanguageFlagIcon
              language={lang as SupportedLanguage}
              className="h-4 w-4 shrink-0"
            />
            <span>{LANGUAGE_NAMES[lang as SupportedLanguage]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
