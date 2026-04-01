import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, type SupportedLanguage } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { LanguageFlagIcon } from "@/components/ui/LanguageFlagIcon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

interface ContentLanguageSelectProps {
  value: SupportedLanguage;
  onChange: (value: SupportedLanguage) => void;
  label?: string;
  showTooltip?: boolean;
}

export function ContentLanguageSelect({
  value,
  onChange,
  label = "Content Language",
  showTooltip = true,
}: ContentLanguageSelectProps) {
  const { language } = useLanguage();

  const tooltipText = language === "pt" 
    ? "Selecione o idioma do conteúdo que será gerado para o post."
    : language === "es"
    ? "Seleccione el idioma del contenido que se generará para la publicación."
    : "Select the language of the content that will be generated for the post.";
  return (
    <div className={label ? "space-y-2.5" : ""}>
      {(label || showTooltip) && (
        <div className="flex items-center gap-2">
          {label && (
            <Label className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </Label>
          )}
          {showTooltip && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help hover:text-muted-foreground transition-colors" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs">
                  <p>{tooltipText}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
      <Select value={value} onValueChange={(next) => onChange(next as SupportedLanguage)}>
        <SelectTrigger
          className="border-border/60 bg-background/40 text-sm"
          data-testid="content-language-select"
        >
          <div className="flex items-center gap-2 text-sm text-foreground/90">
            <LanguageFlagIcon language={value} className="h-3.5 w-3.5 shrink-0 opacity-90" />
            <span className="truncate">{LANGUAGE_NAMES[value]}</span>
          </div>
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem
              key={lang}
              value={lang}
              data-testid={`content-language-option-${lang}`}
            >
              <span className="flex items-center gap-2 text-sm">
                <LanguageFlagIcon
                  language={lang as SupportedLanguage}
                  className="h-3.5 w-3.5 shrink-0 opacity-80"
                />
                <span>{LANGUAGE_NAMES[lang as SupportedLanguage]}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
