import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ContentLanguageSelect } from "@/components/ui/ContentLanguageSelect";
import { GeneratingLoader } from "@/components/ui/generating-loader";
import { VoiceInputButton } from "@/components/voice-input-button";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { usePostCreator } from "@/lib/post-creator";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { SupportedLanguage } from "@shared/schema";
import {
  ChevronRight,
  Sparkles,
  Palette,
  LayoutGrid,
  ScanEye,
  Brush,
  ImagePlus,
} from "lucide-react";

interface EditPostDialogProps {
  open: boolean;
  postId: string | null;
  onOpenChange: (open: boolean) => void;
  onGenerated: (result: { version_number: number; image_url: string }) => Promise<void> | void;
}

type TextEditMode = "keep" | "improve" | "replace" | "remove";

const STEP_TITLES = [
  "Edit Goal",
  "Focus Areas",
  "Text on Image",
  "Refinement",
];

const TOTAL_STEPS = STEP_TITLES.length;

const FOCUS_AREAS = [
  { id: "subject", label: "Main Subject", icon: ScanEye },
  { id: "background", label: "Background", icon: ImagePlus },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "style", label: "Style", icon: Brush },
  { id: "composition", label: "Composition", icon: LayoutGrid },
];

export function PostEditDialog({
  open,
  postId,
  onOpenChange,
  onGenerated,
}: EditPostDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { contentLanguage, setContentLanguage } = usePostCreator();

  const [step, setStep] = useState(0);
  const [viewMode, setViewMode] = useState<"form" | "generating">("form");
  const [goalText, setGoalText] = useState("");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [focusDetails, setFocusDetails] = useState("");
  const [textEditMode, setTextEditMode] = useState<TextEditMode>("keep");
  const [replacementText, setReplacementText] = useState("");
  const [preserveLayout, setPreserveLayout] = useState(false);
  const [extraNotes, setExtraNotes] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [editLanguage, setEditLanguage] = useState<SupportedLanguage>("en");

  useEffect(() => {
    if (open) {
      setEditLanguage(contentLanguage);
    } else {
      setStep(0);
      setViewMode("form");
      setGoalText("");
      setFocusAreas([]);
      setFocusDetails("");
      setTextEditMode("keep");
      setReplacementText("");
      setPreserveLayout(false);
      setExtraNotes("");
      setProgress(0);
      setProgressMessage("");
    }
  }, [contentLanguage, open]);

  function toggleFocusArea(id: string) {
    setFocusAreas((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  const compiledEditContext = useMemo(() => ({
    goal_text: goalText.trim() || undefined,
    focus_areas: focusAreas.length > 0 ? focusAreas : undefined,
    focus_details: focusDetails.trim() || undefined,
    text_mode: textEditMode,
    replacement_text: replacementText.trim() || undefined,
    preserve_layout: preserveLayout,
    extra_notes: extraNotes.trim() || undefined,
  }), [
    goalText,
    focusAreas,
    focusDetails,
    textEditMode,
    replacementText,
    preserveLayout,
    extraNotes,
  ]);

  const compiledEditPrompt = useMemo(() => {
    const selectedAreas = focusAreas
      .map((id) => FOCUS_AREAS.find((item) => item.id === id)?.label)
      .filter(Boolean)
      .join(", ");

    const textRules: Record<TextEditMode, string> = {
      keep: "Keep the existing text exactly as it is.",
      improve: "Improve readability and visual hierarchy of the current text while preserving intent.",
      replace: replacementText.trim()
        ? `Replace current text with this new text: "${replacementText.trim()}".`
        : "Replace current text with better text aligned to the new visual direction.",
      remove: "Remove all text from the image.",
    };

    const instructions = [
      `Primary edit goal: ${goalText.trim() || "No specific goal provided."}`,
      selectedAreas ? `Focus areas: ${selectedAreas}.` : "Focus areas: No specific area selected.",
      focusDetails.trim() ? `Focus details: ${focusDetails.trim()}` : "",
      `Text instruction: ${textRules[textEditMode]}`,
      preserveLayout
        ? "Preserve original composition and element placement as much as possible."
        : "You may update composition if it improves the result.",
      extraNotes.trim() ? `Additional notes: ${extraNotes.trim()}` : "",
      editLanguage !== "en"
        ? `If text appears in the image, it must be in ${editLanguage.toUpperCase()}.`
        : "If text appears in the image, keep it in English.",
    ].filter(Boolean);

    return instructions.join("\n");
  }, [
    editLanguage,
    extraNotes,
    focusAreas,
    focusDetails,
    goalText,
    preserveLayout,
    replacementText,
    textEditMode,
  ]);

  function handleNextStep() {
    setStep((current) => Math.min(current + 1, TOTAL_STEPS - 1));
  }

  async function handleGenerateEdit() {
    if (!postId) return;

    setViewMode("generating");
    setProgress(0);
    setProgressMessage("Analyzing current image...");

    const interval = setInterval(() => {
      setProgress((value) => {
        if (value < 35) {
          setProgressMessage("Analyzing current image...");
          return value + 2;
        }
        if (value < 70) {
          setProgressMessage("Applying edit instructions...");
          return value + 1.4;
        }
        if (value < 92) {
          setProgressMessage("Rendering edited version...");
          return value + 0.8;
        }
        return value;
      });
    }, 300);

    try {
      const res = await apiRequest("POST", "/api/edit-post", {
        post_id: postId,
        edit_prompt: compiledEditPrompt,
        content_language: editLanguage,
        source: "manual",
        edit_context: compiledEditContext,
      });
      const data = await res.json();

      clearInterval(interval);
      setProgress(100);
      setProgressMessage("Done!");

      await onGenerated({
        version_number: data.version_number,
        image_url: data.image_url,
      });

      toast({
        title: t("Image edited successfully"),
        description: `${t("Created version")} v${data.version_number}`,
      });

      onOpenChange(false);
      setViewMode("form");
    } catch (err: any) {
      clearInterval(interval);
      setViewMode("form");
      toast({
        title: t("Edit failed"),
        description: err.message || t("Could not edit image"),
        variant: "destructive",
      });
    }
  }

  function renderStepContent() {
    if (step === 0) {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-base font-medium">{t("What do you want to change?")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("Describe the visual changes you want in this new version.")}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{t("Edit instructions")}</span>
            <VoiceInputButton
              onTranscription={(text) => setGoalText((prev) => (prev ? `${prev} ${text}` : text))}
            />
          </div>
          <Textarea
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            placeholder={t("Example: Keep product position, replace background with a clean studio setup, and make the design more premium.")}
            className="min-h-[150px] resize-none"
            data-testid="edit-goal-text"
          />
        </div>
      );
    }

    if (step === 1) {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-base font-medium">{t("Choose focus areas")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("Select what the AI should prioritize during editing.")}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {FOCUS_AREAS.map((item) => {
              const Icon = item.icon;
              const selected = focusAreas.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleFocusArea(item.id)}
                  className={cn(
                    "p-3 rounded-xl border-2 text-center transition-all",
                    selected ? "border-violet-400 bg-violet-400/8" : "border-border hover:border-violet-400/40"
                  )}
                  data-testid={`edit-focus-${item.id}`}
                >
                  <Icon className={cn("w-5 h-5 mx-auto mb-2", selected ? "text-pink-400" : "text-muted-foreground")} />
                  <div className="text-xs font-medium">{t(item.label)}</div>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{t("Extra focus details (optional)")}</span>
              <VoiceInputButton
                onTranscription={(text) =>
                  setFocusDetails((prev) => (prev ? `${prev} ${text}` : text))
                }
              />
            </div>
            <Textarea
              value={focusDetails}
              onChange={(e) => setFocusDetails(e.target.value)}
              placeholder={t("Add specific details for selected areas...")}
              className="min-h-[110px] resize-none"
              data-testid="edit-focus-details"
            />
          </div>
        </div>
      );
    }

    if (step === 2) {
      const textModes: Array<{ id: TextEditMode; title: string; description: string }> = [
        { id: "keep", title: "Keep Text", description: "Preserve existing text exactly" },
        { id: "improve", title: "Improve Text", description: "Keep meaning, improve readability/design" },
        { id: "replace", title: "Replace Text", description: "Provide a new text to render" },
        { id: "remove", title: "Remove Text", description: "Generate image without text" },
      ];

      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-base font-medium">{t("Text handling")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("Define how text should be treated in this edited version.")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {textModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setTextEditMode(mode.id)}
                className={cn(
                  "p-4 rounded-xl border-2 text-left transition-all",
                  textEditMode === mode.id
                    ? "border-violet-400 bg-violet-400/8"
                    : "border-border hover:border-violet-400/40"
                )}
                data-testid={`edit-text-mode-${mode.id}`}
              >
                <div className="font-medium text-sm">{t(mode.title)}</div>
                <div className="text-xs text-muted-foreground mt-1">{t(mode.description)}</div>
              </button>
            ))}
          </div>

          {textEditMode === "replace" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">{t("Replacement text")}</span>
                <VoiceInputButton
                  onTranscription={(text) =>
                    setReplacementText((prev) => (prev ? `${prev} ${text}` : text))
                  }
                />
              </div>
              <Textarea
                value={replacementText}
                onChange={(e) => setReplacementText(e.target.value)}
                placeholder={t("Type the exact text to render on the image")}
                className="min-h-[120px] resize-none"
                data-testid="edit-replacement-text"
              />
            </div>
          )}
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-base font-medium">{t("Layout & Notes")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("Fine-tune layout behavior and add optional notes.")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              onClick={() => setPreserveLayout((value) => !value)}
              className={cn(
                "p-4 rounded-xl border-2 text-left transition-all",
                preserveLayout ? "border-violet-400 bg-violet-400/8" : "border-border hover:border-violet-400/40"
              )}
              data-testid="edit-preserve-layout"
            >
              <div className="font-medium text-sm">{t("Preserve Layout")}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {preserveLayout ? t("Enabled") : t("Disabled")}
              </div>
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{t("Additional notes (optional)")}</span>
              <VoiceInputButton
                onTranscription={(text) => setExtraNotes((prev) => (prev ? `${prev} ${text}` : text))}
              />
            </div>
            <Textarea
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              placeholder={t("Any additional constraints or quality notes...")}
              className="min-h-[110px] resize-none"
              data-testid="edit-extra-notes"
            />
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (viewMode === "generating") return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-2xl w-[90vw] sm:w-full rounded-xl sm:rounded-lg max-h-[100dvh] sm:max-h-[90vh] overflow-y-auto overflow-x-hidden"
        data-testid="dialog-post-edit"
      >
        <AnimatePresence mode="wait">
          {viewMode === "form" ? (
            <motion.div
              key={`edit-step-${step}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <DialogHeader className="space-y-3 text-left pt-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <DialogTitle>{t(STEP_TITLES[step])}</DialogTitle>
                    <span className="text-xs text-muted-foreground">
                      {t("Step")} {step + 1} {t("of")} {TOTAL_STEPS}
                    </span>
                  </div>
                  <Progress value={((step + 1) / TOTAL_STEPS) * 100} className="h-2" />
                </div>
                <DialogDescription>
                  {t("Complete one choice at a time to build your edit request.")}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-6">{renderStepContent()}</div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <div className="w-[220px]">
                  <ContentLanguageSelect
                    value={editLanguage}
                    onChange={setEditLanguage}
                    label=""
                  />
                </div>

                {step < TOTAL_STEPS - 1 ? (
                  <Button onClick={handleNextStep} data-testid="button-edit-step-next">
                    {t("Next")}
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={handleGenerateEdit} data-testid="button-generate-edit">
                    <Sparkles className="w-4 h-4 mr-2" />
                    {t("Generate Edit")}
                  </Button>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="edit-generating"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="p-8 flex flex-col items-center justify-center text-center"
            >
              <div className="mb-6">
                <GeneratingLoader size={0.6} />
              </div>
              <h2 className="text-xl font-semibold mb-2">{t("Creating Your Post")}</h2>
              <p className="text-sm text-muted-foreground mb-6">{progressMessage ? t(progressMessage) : ""}</p>
              <div className="w-full max-w-sm">
                <Progress value={progress} className="h-2" data-testid="progress-bar-edit" />
                <p className="text-xs text-muted-foreground text-center mt-2">{Math.round(progress)}%</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
