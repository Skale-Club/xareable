import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { fetchSSE } from "@/lib/sse-fetch";
import { useAuth } from "@/lib/auth";
import { usePostCreator } from "@/lib/post-creator";
import { usePostViewer } from "@/lib/post-viewer";
import { AddCreditsModal } from "@/components/add-credits-modal";
import { UpgradePlanModal } from "@/components/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GeneratingLoader } from "@/components/ui/generating-loader";
import { ContentLanguageSelect } from "@/components/ui/ContentLanguageSelect";
import { TextStylePickerSheet } from "@/components/text-style-picker-sheet";
import { TypographySelector } from "@/components/ui/typography-selector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { VoiceInputButton } from "@/components/voice-input-button";
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Square,
  RectangleHorizontal,
  RectangleVertical,
  Megaphone,
  Plus,
  Info,
  Droplets,
  Flame,
  ImagePlus,
  X,
  ImageIcon,
  VideoIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DEFAULT_STYLE_CATALOG,
  MAX_FEATURED_POST_MOODS_PER_STYLE,
  type CreditStatus,
  type GenerateResponse,
  type StyleCatalog,
  type TextRenderMode,
} from "@shared/schema";
import { blobToBase64, createImagePreviewWebp, extractVideoThumbnailWebp } from "@/lib/media";

const POST_MOOD_ICONS: Record<string, React.ElementType> = {
  promo: Megaphone,
  info: Info,
  clean: Droplets,
  vibrant: Flame,
};

const FORMAT_ICONS: Record<string, React.ElementType> = {
  Square,
  RectangleVertical,
  RectangleHorizontal,
};

const LOGO_POSITIONS = [
  { value: "top-left", label: "Top Left" },
  { value: "top-center", label: "Top Center" },
  { value: "top-right", label: "Top Right" },
  { value: "middle-left", label: "Middle Left" },
  { value: "middle-center", label: "Center" },
  { value: "middle-right", label: "Middle Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-center", label: "Bottom Center" },
  { value: "bottom-right", label: "Bottom Right" },
];

/** Set to true to re-enable video generation in the creator wizard */
const VIDEO_ENABLED = false;
/** Set to true to re-enable image resolution picker (512px/1K/2K/4K) */
const RESOLUTION_PICKER_ENABLED = false;

const IMAGE_STEPS = [
  ...(VIDEO_ENABLED ? ["Content Type"] : []),
  "Reference",
  "Post Mood",
  "Text on Image",
  "Logo Placement",
  "Format / Size",
];

const VIDEO_STEPS = [
  "Content Type",
  "Reference",
  "Post Mood",
  "Logo Placement",
  "Format / Size",
];

type ViewMode = "form" | "generating" | "result";

const EXACT_TEXT_PATTERN = /(?:[$€£¥]|\br\$\b|\busd\b|\beur\b|\bgbp\b|\d+[.,]\d{2}|\d+%|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{2}:\d{2}\b)/i;

function detectTextRenderMode(text: string): TextRenderMode {
  const normalized = text.trim();
  if (!normalized) return "auto";
  return EXACT_TEXT_PATTERN.test(normalized) ? "exact" : "guided";
}

export function PostCreatorDialog() {
  const { brand, profile } = useAuth();
  const { isOpen, closeCreator, markCreated, contentLanguage, setContentLanguage } = usePostCreator();
  const { openViewer } = usePostViewer();
  const { toast } = useToast();
  const { t } = useTranslation();
  const usesOwnApiKey = profile?.is_admin === true || profile?.is_affiliate === true;

  const [viewMode, setViewMode] = useState<"form" | "generating">("form");
  const [contentType, setContentType] = useState<"image" | "video">("image");
  const [step, setStep] = useState(0);
  const [referenceText, setReferenceText] = useState("");
  const [referenceImages, setReferenceImages] = useState<Array<{
    id: string;
    file: File;
    preview: string;
    base64: string;
  }>>([]);
  const [postMood, setPostMood] = useState(DEFAULT_STYLE_CATALOG.post_moods[0]?.id || "promo");
  const [copyText, setCopyText] = useState("");
  const [useText, setUseText] = useState(true);
  const [selectedTextStyleIds, setSelectedTextStyleIds] = useState<string[]>([]);
  const [isTextStylePickerOpen, setIsTextStylePickerOpen] = useState(false);
  const [useLogo, setUseLogo] = useState(false);
  const [logoPosition, setLogoPosition] = useState<string>("bottom-right");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageResolution, setImageResolution] = useState<"512px" | "1K" | "2K" | "4K">("1K");
  const [videoDuration, setVideoDuration] = useState<"4" | "6" | "8">("8");
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [isAddCreditsOpen, setIsAddCreditsOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isOthersOpen, setIsOthersOpen] = useState(false);
  // Result state handled structurally via PostViewerDialog
  const { data: creditStatus } = useQuery<CreditStatus>({
    queryKey: ["/api/credits/check?operation=generate"],
    enabled: isOpen && !usesOwnApiKey,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: styleCatalog } = useQuery<StyleCatalog>({
    queryKey: ["/api/style-catalog"],
    enabled: isOpen,
  });
  const catalog = styleCatalog || DEFAULT_STYLE_CATALOG;
  const steps = contentType === "video" ? VIDEO_STEPS : IMAGE_STEPS;
  const totalSteps = steps.length;
  const currentStepTitle = steps[step] || steps[0];
  const allPostMoods = catalog.post_moods;
  const styleFilteredPostMoods = catalog.post_moods.filter(
    (item) => !brand?.mood || item.style_ids.includes(brand.mood),
  );
  const featuredPostMoodsSource = styleFilteredPostMoods.length > 0
    ? styleFilteredPostMoods
    : allPostMoods;
  const featuredPostMoods = featuredPostMoodsSource.slice(0, MAX_FEATURED_POST_MOODS_PER_STYLE);
  const extraPostMoodIds = new Set(featuredPostMoods.map((item) => item.id));
  const extraPostMoods = allPostMoods.filter((item) => !extraPostMoodIds.has(item.id));
  const defaultPostMood = featuredPostMoods[0]?.id || allPostMoods[0]?.id || DEFAULT_STYLE_CATALOG.post_moods[0]?.id || "promo";
  const availableTextStyles = catalog.text_styles?.length ? catalog.text_styles : (DEFAULT_STYLE_CATALOG.text_styles || []);
  const isSelectedInFeaturedPostMoods = featuredPostMoods.some((item) => item.id === postMood);
  const isSelectedInExtraPostMoods = extraPostMoods.some((item) => item.id === postMood);
  const selectedPostMood = allPostMoods.find((item) => item.id === postMood);
  const normalizedCopyText = copyText.trim();
  const selectedTextMode = detectTextRenderMode(normalizedCopyText);
  const selectedTextStyles = availableTextStyles.filter((style) => selectedTextStyleIds.includes(style.id));

  useEffect(() => {
    if (!isOpen) {
      setViewMode("form");
      setContentType("image");
      setStep(0);
      setReferenceImages([]);
      setReferenceText("");
      setPostMood(defaultPostMood);
      setCopyText("");
      setUseText(true);
      setSelectedTextStyleIds([]);
      setUseLogo(false);
      setLogoPosition("bottom-right");
      setAspectRatio("1:1");
      setImageResolution("1K");
      setVideoDuration("8");
      setVideoResolution("720p");
      setProgress(0);
      setProgressMessage("");
      setIsOthersOpen(false);
      setIsTextStylePickerOpen(false);
    }
  }, [defaultPostMood, isOpen]);

  useEffect(() => {
    if (!allPostMoods.some((item) => item.id === postMood) || !isSelectedInFeaturedPostMoods) {
      setPostMood(defaultPostMood);
    }
  }, [allPostMoods, defaultPostMood]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const validSelection = selectedTextStyleIds.filter((id) =>
      availableTextStyles.some((item) => item.id === id)
    );
    if (validSelection.length !== selectedTextStyleIds.length) {
      setSelectedTextStyleIds(validSelection);
    }
  }, [availableTextStyles, selectedTextStyleIds]);

  useEffect(() => {
    if (!isOpen || viewMode !== "form" || usesOwnApiKey || !creditStatus) {
      return;
    }

    if (!creditStatus.allowed && creditStatus.free_generations_remaining === 0) {
      closeCreator();
      if (creditStatus.denial_reason === "upgrade_required") {
        setIsUpgradeOpen(true);
      } else {
        setIsAddCreditsOpen(true);
        toast({
          title: t("Insufficient Credits"),
          description: t("Your balance is not enough to complete this request. Please add credits and try again."),
          variant: "destructive",
        });
      }
    }
  }, [closeCreator, creditStatus, isOpen, t, toast, usesOwnApiKey, viewMode]);

  function handleOpenChange(open: boolean) {
    if (viewMode === "generating" && !open) return;
    if (!open) closeCreator();
  }

  function handleNextStep() {
    setIsOthersOpen(false);
    setStep((current) => Math.min(current + 1, totalSteps - 1));
  }

  function handlePreviousStep() {
    setIsOthersOpen(false);
    setStep((current) => Math.max(current - 1, 0));
  }

  function handleSelectPostMood(nextPostMood: string) {
    setPostMood(nextPostMood);
    setIsOthersOpen(false);
  }

  function processReferenceFile(file: File) {
      // Validation: file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: t("Invalid file type"),
          description: t("Please upload image files only (PNG, JPG, WebP)"),
          variant: "destructive"
        });
        return;
      }

      // Validation: file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: t("File too large"),
          description: t("Images must be under 5MB"),
          variant: "destructive"
        });
        return;
      }

      // Validation: max count
      if (referenceImages.length >= 4) {
        toast({
          title: t("Maximum reached"),
          description: t("You can upload up to 4 reference images"),
          variant: "destructive"
        });
        return;
      }

      // Generate preview and base64
      const reader = new FileReader();
      reader.onload = () => {
        const preview = reader.result as string;

        // Create separate reader for base64 (needed for API)
        const base64Reader = new FileReader();
        base64Reader.onload = () => {
          const base64Full = base64Reader.result as string;
          const base64 = base64Full.split(',')[1]; // Remove data URL prefix

          setReferenceImages(prev => {
            if (prev.length >= 4) {
              return prev;
            }
            return [...prev, {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              file,
              preview,
              base64
            }];
          });
        };
        base64Reader.readAsDataURL(file);
      };
      reader.readAsDataURL(file);
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    files.forEach(processReferenceFile);

    // Reset input to allow re-selecting same file
    e.target.value = '';
  }

  function handleReferenceDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsReferenceDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    files.forEach(processReferenceFile);
  }

  function handleReferenceDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    if (!isReferenceDragActive) {
      setIsReferenceDragActive(true);
    }
  }

  function handleReferenceDragLeave() {
    setIsReferenceDragActive(false);
  }

  function handleRemoveImage(imageId: string) {
    setReferenceImages(prev => prev.filter(img => img.id !== imageId));
  }

  async function handleGenerate() {
    setViewMode("generating");
    setProgress(0);
    setProgressMessage(t("Starting generation..."));

    try {
      const isVideo = contentType === "video";
      const normalizedText = !isVideo && useText ? normalizedCopyText : "";
      const textMode = !isVideo && useText ? detectTextRenderMode(normalizedText) : undefined;

      let resultData: any = null;

      await fetchSSE("/api/generate", {
        reference_text: referenceText.trim() || undefined,
        reference_images: referenceImages.length > 0
          ? referenceImages.map(img => ({
            mimeType: img.file.type,
            data: img.base64
          }))
          : undefined,
        post_mood: postMood,
        use_text: !isVideo ? useText : false,
        copy_text: normalizedText || undefined,
        text_mode: textMode,
        text_style_id: !isVideo && useText && selectedTextStyleIds.length > 0 ? selectedTextStyleIds[0] : undefined,
        text_style_ids: !isVideo && useText && selectedTextStyleIds.length > 0 ? selectedTextStyleIds : undefined,
        aspect_ratio: aspectRatio,
        use_logo: useLogo,
        logo_position: useLogo ? logoPosition : undefined,
        content_language: contentLanguage,
        content_type: contentType,
        image_resolution: !isVideo ? imageResolution : undefined,
        video_resolution: isVideo ? videoResolution : undefined,
        video_duration: isVideo ? videoDuration : undefined,
      }, {
        onProgress: (event) => {
          setProgress(event.progress);
          setProgressMessage(t(event.message));
        },
        onComplete: (data) => {
          resultData = data;
          setProgress(100);
          setProgressMessage(t("Done!"));
        },
      });

      if (!resultData) {
        throw new Error("Generation completed without result data");
      }

      markCreated();
      const generatedPostId = resultData.post_id || resultData.post?.id || "";
      const generatedImageUrl = resultData.image_url || resultData.post?.image_url || "";
      const generatedCaption = resultData.caption || resultData.post?.caption || "";
      const generatedContentType = resultData.content_type || resultData.post?.content_type || contentType;
      let generatedThumbnailUrl = resultData.thumbnail_url || resultData.post?.thumbnail_url || null;

      if (!generatedPostId || !generatedImageUrl) {
        throw new Error("Invalid generate response: missing post_id or image_url");
      }

      if (generatedPostId && generatedImageUrl && !generatedThumbnailUrl) {
        try {
          const previewBlob = generatedContentType === "video"
            ? await extractVideoThumbnailWebp(generatedImageUrl)
            : await createImagePreviewWebp(generatedImageUrl);
          const base64 = await blobToBase64(previewBlob);
          const previewResponse = await apiRequest("POST", `/api/posts/${generatedPostId}/thumbnail`, {
            file: base64,
            contentType: "image/webp",
          });
          const previewPayload = await previewResponse.json() as { thumbnail_url?: string };
          generatedThumbnailUrl = previewPayload.thumbnail_url || null;
        } catch (thumbnailError) {
          console.warn("Preview generation failed:", thumbnailError);
        }
      }

      closeCreator();
      setViewMode("form");
      setContentType("image");
      setStep(0);
      setReferenceImages([]);
      setReferenceText("");
      setPostMood(defaultPostMood);
      setCopyText("");
      setSelectedTextStyleIds([]);
      setAspectRatio("1:1");

      openViewer({
        id: generatedPostId,
        user_id: "",
        image_url: generatedImageUrl,
        thumbnail_url: generatedThumbnailUrl,
        content_type: generatedContentType,
        slide_count: null,
        idempotency_key: null,
        caption: generatedCaption,
        ai_prompt_used: null,
        status: "generated",
        created_at: new Date().toISOString(),
        expires_at: resultData.expires_at || resultData.post?.expires_at || null,
      });
    } catch (err: any) {
      setViewMode("form");
      const errMsg = String(err?.message || "");
      if (errMsg.includes("upgrade_required")) {
        closeCreator();
        setIsUpgradeOpen(true);
      } else if (errMsg.includes("insufficient_credits")) {
        setIsAddCreditsOpen(true);
        toast({
          title: t("Generation failed"),
          description: err.message || t("Something went wrong. Please try again."),
          variant: "destructive",
        });
      } else {
        toast({
          title: t("Generation failed"),
          description: err.message || t("Something went wrong. Please try again."),
          variant: "destructive",
        });
      }
    }
  }

  function handleCreateAnother() {
    setViewMode("form");
    setContentType("image");
    setStep(0);
    setReferenceImages([]);
    setReferenceText("");
    setPostMood(defaultPostMood);
    setCopyText("");
    setSelectedTextStyleIds([]);
    setUseLogo(false);
    setLogoPosition("bottom-right");
    setAspectRatio("1:1");
    setProgress(0);
    setProgressMessage("");
    setIsOthersOpen(false);
  }

  // handleDownload is no longer needed here as it's in the global Viewer

  function renderStepContent() {
    // Content Type Selection (Image vs Video)
    if (currentStepTitle === "Content Type") {
      const isVideoLocked = !usesOwnApiKey && creditStatus && (
        creditStatus.free_generations_remaining > 0 ||
        creditStatus.denial_reason === "upgrade_required" ||
        creditStatus.balance_micros <= 0
      );
      return (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-base font-medium">
              {t("Choose what to create")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("Select the type of content you want to generate with AI.")}
            </p>
          </div>

          <div className={`grid ${VIDEO_ENABLED ? "grid-cols-2" : "grid-cols-1"} gap-4`}>
            <button
              type="button"
              onClick={() => {
                setContentType("image");
                const fmts = catalog.post_formats?.length ? catalog.post_formats : (DEFAULT_STYLE_CATALOG.post_formats || []);
                setAspectRatio(fmts[0]?.value ?? "1:1");
              }}
              className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all ${contentType === "image"
                ? "border-violet-400 bg-violet-400/10"
                : "border-border hover:border-violet-400/40"
                }`}
            >
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${contentType === "image" ? "bg-violet-400/20" : "bg-muted"
                }`}>
                <ImageIcon className={`w-8 h-8 ${contentType === "image" ? "text-violet-400" : "text-muted-foreground"
                  }`} />
              </div>
              <div className="text-center">
                <div className="font-medium">{t("Image")}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("Static image for social media posts")}
                </div>
              </div>
            </button>

            {VIDEO_ENABLED && (
            <button
              type="button"
              onClick={() => {
                if (isVideoLocked) {
                  setIsUpgradeOpen(true);
                } else {
                  setContentType("video");
                  setCopyText("");
                  setUseText(false);
                  const fmts = catalog.video_formats?.length ? catalog.video_formats : (DEFAULT_STYLE_CATALOG.video_formats || []);
                  setAspectRatio(fmts[0]?.value ?? "9:16");
                }
              }}
              className={`relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all ${contentType === "video"
                ? "border-violet-400 bg-violet-400/10"
                : "border-border hover:border-violet-400/40"
                } ${isVideoLocked ? "opacity-60" : ""}`}
            >
              {isVideoLocked && (
                <span className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                  {t("Upgrade")}
                </span>
              )}
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${contentType === "video" ? "bg-violet-400/20" : "bg-muted"
                }`}>
                <VideoIcon className={`w-8 h-8 ${contentType === "video" ? "text-violet-400" : "text-muted-foreground"
                  }`} />
              </div>
              <div className="text-center">
                <div className="font-medium">{t("Video")}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {isVideoLocked ? t("Upgrade to create videos") : t("AI-generated video content")}
                </div>
              </div>
            </button>
            )}
          </div>
        </div>
      );
    }

    // Reference Material
    if (currentStepTitle === "Reference") {
      return (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-base font-medium">
              {t("Describe your idea")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("Share business style, colors, post mood, and specific elements. Short and sweet works great.")}
            </p>
          </div>

          {/* Image upload + voice — aligned at bottom */}
          {(() => {
            const count = referenceImages.length;
            const hasAdd = count < 4;
            const totalItems = count + (hasAdd ? 1 : 0);
            const size = totalItems <= 1 ? "w-24 h-24" : totalItems <= 3 ? "w-[100px] h-[100px]" : "w-[80px] h-[80px]";
            return (
              <div className="flex items-end gap-2">
                <div className={count === 4 ? "grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-0" : "flex flex-wrap gap-2 min-w-0"}>
                  {referenceImages.map((img) => (
                    <div
                      key={img.id}
                      className={`relative ${size} rounded-lg border-2 border-border overflow-hidden group flex-shrink-0 transition-all`}
                    >
                      <img
                        src={img.preview}
                        alt="Reference"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(img.id)}
                          className="w-7 h-7 rounded-full bg-destructive flex items-center justify-center"
                        >
                          <X className="w-4 h-4 text-white" />
                        </button>
                      </div>
                      <div className="absolute bottom-1 left-1 right-1 text-[9px] text-white bg-black/70 rounded px-1 py-0.5 truncate">
                        {img.file.name}
                      </div>
                    </div>
                  ))}

                  {count < 4 && (
                    <label
                      className={`${size} flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-all flex-shrink-0 ${isReferenceDragActive
                        ? "border-violet-400 bg-violet-400/10"
                        : "border-border hover:border-violet-400/40 hover:bg-violet-400/5"
                      }`}
                      onDrop={handleReferenceDrop}
                      onDragOver={handleReferenceDragOver}
                      onDragLeave={handleReferenceDragLeave}
                    >
                      <ImagePlus className="w-6 h-6 text-muted-foreground mb-1" />
                      <span className="text-[10px] font-medium leading-tight text-center">{t("Add Reference")}</span>
                      <span className="text-[9px] text-muted-foreground mt-0.5">{t("Up to 5MB")}</span>
                      <span className="text-[9px] text-muted-foreground">{t("Optional")}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleImageSelect}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                <div className="ml-auto flex-shrink-0">
                  <VoiceInputButton
                    onTranscription={(text) => setReferenceText(prev => prev ? `${prev} ${text}` : text)}
                  />
                </div>
              </div>
            );
          })()}

          {/* Text description */}
          <Textarea
            placeholder={t("For example: modern style, bold colors, confident mood, product in focus, clean background.")}
            value={referenceText}
            onChange={(e) => setReferenceText(e.target.value)}
            rows={4}
            data-testid="input-reference"
          />
        </div>
      );
    }

    // Post Mood
    if (currentStepTitle === "Post Mood") {
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
            {featuredPostMoods.map(({ id, label, description }) => {
              const Icon = POST_MOOD_ICONS[id] || Sparkles;
              return (
                <button
                  key={id}
                  onClick={() => handleSelectPostMood(id)}
                  className={`w-[calc(33.333%-0.4rem)] sm:w-[calc(20%-0.6rem)] max-w-[120px] aspect-square p-2 rounded-xl border-2 flex flex-col items-center justify-center text-center transition-all ${postMood === id
                    ? "border-violet-400 bg-violet-400/8"
                    : "border-border hover:border-violet-400/40"
                    }`}
                  data-testid={`post-mood-${id}`}
                >
                  <Icon
                    className={`w-6 h-6 mb-1 ${postMood === id ? "text-pink-400" : "text-muted-foreground"
                      }`}
                  />
                  <div className="font-medium text-xs">{t(label)}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">{t(description)}</div>
                </button>
              );
            })}
            <Popover open={isOthersOpen} onOpenChange={setIsOthersOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={extraPostMoods.length === 0}
                  className={`w-[calc(33.333%-0.4rem)] sm:w-[calc(20%-0.6rem)] max-w-[120px] aspect-square p-2 rounded-xl border-2 flex flex-col items-center justify-center text-center transition-all ${(isOthersOpen || isSelectedInExtraPostMoods)
                    ? "border-violet-400 bg-violet-400/8"
                    : "border-border hover:border-violet-400/40"
                    } ${extraPostMoods.length === 0 ? "cursor-not-allowed opacity-60" : ""}`}
                  data-testid="post-mood-others"
                >
                  <Plus
                    className={`w-6 h-6 mb-1 ${(isOthersOpen || isSelectedInExtraPostMoods) ? "text-pink-400" : "text-muted-foreground"
                      }`}
                  />
                  <div className="font-medium text-xs">{t("Others")}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    {isSelectedInExtraPostMoods && selectedPostMood
                      ? t(selectedPostMood.label)
                      : extraPostMoods.length > 0
                        ? t("See extra moods")
                        : t("No extras yet")}
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(22rem,calc(100vw-2rem))] p-3"
              >
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium">{t("Other Post Moods")}</div>
                  </div>
                  <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {extraPostMoods.map(({ id, label, description }) => {
                      const Icon = POST_MOOD_ICONS[id] || Sparkles;
                      return (
                        <button
                          key={`extra-${id}`}
                          onClick={() => handleSelectPostMood(id)}
                          className={`rounded-lg border p-2 text-left transition-all ${postMood === id
                            ? "border-violet-400 bg-violet-400/8"
                            : "border-border hover:border-violet-400/40"
                            }`}
                          data-testid={`post-mood-extra-${id}`}
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <Icon
                              className={`h-4 w-4 ${postMood === id ? "text-pink-400" : "text-muted-foreground"
                                }`}
                            />
                            <span className="text-xs font-medium">{t(label)}</span>
                          </div>
                          <div className="text-[10px] leading-tight text-muted-foreground">{t(description)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      );
    }

    // Text on Image (image only, skipped for video)
    if (currentStepTitle === "Text on Image") {
      return (
        <div className="space-y-4">
          {/* Toggle buttons for text/no text */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setUseText(true)}
              className={`p-4 rounded-xl border-2 text-center transition-all ${useText
                ? "border-violet-400 bg-violet-400/8"
                : "border-border hover:border-violet-400/40"
                }`}
            >
              <div className="font-medium text-sm">{t("With Text")}</div>
              <div className="text-xs text-muted-foreground mt-1">{t("Add headline & subtext")}</div>
            </button>
            <button
              onClick={() => {
                setUseText(false);
                setCopyText("");
              }}
              className={`p-4 rounded-xl border-2 text-center transition-all ${!useText
                ? "border-violet-400 bg-violet-400/8"
                : "border-border hover:border-violet-400/40"
                }`}
            >
              <div className="font-medium text-sm">{t("No Text")}</div>
              <div className="text-xs text-muted-foreground mt-1">{t("Image only")}</div>
            </button>
          </div>

      {useText && (
        <>
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <Label className="text-sm font-medium text-foreground">{t("Your text")}</Label>
                <VoiceInputButton
                  onTranscription={(text) => setCopyText((prev) => (prev ? `${prev} ${text}` : text))}
                />
              </div>
              <Textarea
                placeholder={t("Example: 'Big Sale Tomorrow! Don't miss out - 50% off everything.'")}
                value={copyText}
                onChange={(e) => setCopyText(e.target.value)}
                className="text-base border-border focus-visible:ring-violet-400/50 bg-background/50 backdrop-blur-sm"
                rows={3}
                data-testid="input-copy-text"
              />
            </div>
          </div>
          <div className="pt-3">
            <TypographySelector
              availableStyles={availableTextStyles}
              selectedIds={selectedTextStyleIds}
              onChange={setSelectedTextStyleIds}
              open={isTextStylePickerOpen}
              onOpenChange={setIsTextStylePickerOpen}
            />
          </div>
        </>
      )}
        </div>
      );
    }

    // Logo Placement (image only, skipped for video)
    if (currentStepTitle === "Logo Placement") {
      return (
        <div className="space-y-4">
          {/* Toggle buttons for logo/no logo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setUseLogo(true)}
              className={`p-4 rounded-xl border-2 text-center transition-all ${useLogo
                ? "border-violet-400 bg-violet-400/8"
                : "border-border hover:border-violet-400/40"
                }`}
            >
              <div className="font-medium text-sm">{t("Include Logo")}</div>
              <div className="text-xs text-muted-foreground mt-1">{t("Add brand logo to post")}</div>
            </button>
            <button
              onClick={() => setUseLogo(false)}
              className={`p-4 rounded-xl border-2 text-center transition-all ${!useLogo
                ? "border-violet-400 bg-violet-400/8"
                : "border-border hover:border-violet-400/40"
                }`}
            >
              <div className="font-medium text-sm">{t("No Logo")}</div>
              <div className="text-xs text-muted-foreground mt-1">{t("Skip logo placement")}</div>
            </button>
          </div>

          {useLogo && (
            <div className="space-y-3">
              <Label className="text-sm text-muted-foreground">{t("Select logo position")}</Label>
              <div className="grid grid-cols-3 gap-1 sm:gap-1.5 w-full mx-auto">
                {LOGO_POSITIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setLogoPosition(value)}
                    className={`py-1.5 px-0.5 sm:px-2 rounded border flex items-center justify-center text-[9px] sm:text-[10px] tracking-tighter sm:tracking-normal font-medium whitespace-nowrap transition-all ${logoPosition === value
                      ? "border-violet-400 bg-violet-400/8 text-violet-400"
                      : "border-border hover:border-violet-400/40 text-muted-foreground"
                      }`}
                    data-testid={`logo-position-${value}`}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-400/5 border border-violet-400/20">
                <Info className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {t("Your brand logo will be placed in the selected position on the generated image.")}
                </p>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Format / Size (last step for both image and video)
    const formats = contentType === "video"
      ? (catalog.video_formats?.length ? catalog.video_formats : (DEFAULT_STYLE_CATALOG.video_formats || []))
      : (catalog.post_formats?.length ? catalog.post_formats : (DEFAULT_STYLE_CATALOG.post_formats || []));

    const isHighResVideo = videoResolution === "1080p" || videoResolution === "4k";

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {formats.map(({ id, value, label, subtitle, icon }) => {
            const Icon = FORMAT_ICONS[icon] || Square;
            return (
              <button
                key={id || value}
                onClick={() => setAspectRatio(value)}
                className={`p-4 rounded-xl border-2 text-center transition-all ${aspectRatio === value
                  ? "border-violet-400 bg-violet-400/10"
                  : "border-border hover:border-violet-400/40"
                  }`}
                data-testid={`format-${value.replace(":", "x")}`}
              >
                <Icon
                  className={`w-6 h-6 mx-auto mb-2 ${aspectRatio === value ? "text-pink-400" : "text-muted-foreground"
                    }`}
                />
                <div className="font-medium text-sm">{t(label)}</div>
                <div className="text-xs text-muted-foreground">{t(subtitle)}</div>
                <div className="text-xs text-muted-foreground mt-1 font-mono">{value}</div>
              </button>
            )
          })}
        </div>

        {RESOLUTION_PICKER_ENABLED && contentType === "image" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("Resolution")}</p>
            <div className="flex flex-wrap gap-2">
              {(["512px", "1K", "2K", "4K"] as const).map((res) => {
                const isResLocked = !usesOwnApiKey && (res === "2K" || res === "4K") && creditStatus && (
                  creditStatus.free_generations_remaining > 0 ||
                  creditStatus.denial_reason === "upgrade_required" ||
                  creditStatus.balance_micros <= 0
                );
                return (
                  <button
                    key={res}
                    onClick={() => {
                      if (isResLocked) {
                        setIsUpgradeOpen(true);
                      } else {
                        setImageResolution(res);
                      }
                    }}
                    className={`relative px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${imageResolution === res
                      ? "border-violet-400 bg-violet-400/10 text-violet-400"
                      : "border-border text-muted-foreground hover:border-violet-400/40"
                      } ${isResLocked ? "opacity-50" : ""}`}
                  >
                    {res}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {contentType === "video" && (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("Duration")}</p>
              <div className="flex flex-wrap gap-2">
                {(["4", "6", "8"] as const).map((dur) => {
                  const disabled = isHighResVideo && dur !== "8";
                  return (
                    <button
                      key={dur}
                      onClick={() => !disabled && setVideoDuration(dur)}
                      disabled={disabled}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${videoDuration === dur
                        ? "border-violet-400 bg-violet-400/10 text-violet-400"
                        : disabled
                          ? "border-border text-muted-foreground/30 cursor-not-allowed"
                          : "border-border text-muted-foreground hover:border-violet-400/40"
                        }`}
                    >
                      {dur}s
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("Resolution")}</p>
              <div className="flex flex-wrap gap-2">
                {(["720p", "1080p", "4k"] as const).map((res) => (
                  <button
                    key={res}
                    onClick={() => {
                      setVideoResolution(res);
                      if (res === "1080p" || res === "4k") setVideoDuration("8");
                    }}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${videoResolution === res
                      ? "border-violet-400 bg-violet-400/10 text-violet-400"
                      : "border-border text-muted-foreground hover:border-violet-400/40"
                      }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
              {isHighResVideo && (
                <p className="text-xs text-muted-foreground">{t("High resolution requires 8s duration.")}</p>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-2xl w-[calc(100vw-2rem)] rounded-xl sm:rounded-lg max-h-[100dvh] sm:max-h-[90vh] overflow-y-auto overflow-x-hidden" data-testid="dialog-post-creator">
        <AnimatePresence mode="wait">
          {viewMode === "form" && (
            <motion.div
              key={`step-${step}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <DialogHeader className="space-y-3 text-left pt-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <DialogTitle>{t(currentStepTitle)}</DialogTitle>
                    <span className="text-xs text-muted-foreground">
                      {t("Step")} {step + 1} {t("of")} {totalSteps}
                    </span>
                  </div>
                  <Progress value={((step + 1) / totalSteps) * 100} className="h-2" />
                </div>
                <DialogDescription className="sr-only">
                  {t("Complete one choice at a time to build your post.")}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-6">{renderStepContent()}</div>

              <div className="mt-6 flex items-center justify-between gap-3">
                {step > 0 ? (
                  <Button
                    variant="ghost"
                    onClick={handlePreviousStep}
                    data-testid="button-step-back"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    {t("Back")}
                  </Button>
                ) : (
                  <div className="w-[180px]">
                    <ContentLanguageSelect
                      value={contentLanguage}
                      onChange={setContentLanguage}
                      label=""
                    />
                  </div>
                )}

                {step < totalSteps - 1 ? (
                  <Button onClick={handleNextStep} data-testid="button-step-next">
                    {t("Next")}
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                ) : (
                  <div className="flex flex-col items-end gap-3">
                    {creditStatus && creditStatus.free_generations_remaining > 0 && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Info className="w-4 h-4" />
                        <span>
                          {`${creditStatus.free_generations_remaining} ${t("free generation remaining")}`}
                        </span>
                      </div>
                    )}
                    <Button onClick={handleGenerate} data-testid="button-generate">
                      <Sparkles className="w-4 h-4 mr-2" />
                      {contentType === "video" ? t("Generate Video") : t("Generate Post")}
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {viewMode === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="p-8 flex flex-col items-center justify-center text-center"
            >
              <div className="mb-6">
                <GeneratingLoader size={0.6} />
              </div>
              <h2 className="text-xl font-semibold mb-2">{t("Creating Your Post")}</h2>
              <p className="text-sm text-muted-foreground mb-6" data-testid="text-progress-message">
                {progressMessage ? t(progressMessage) : ""}
              </p>
              <div className="w-full max-w-sm">
                <Progress value={progress} className="h-2" data-testid="progress-bar" />
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {Math.round(progress)}%
                </p>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </DialogContent>
      <AddCreditsModal open={isAddCreditsOpen} onOpenChange={setIsAddCreditsOpen} />
      <UpgradePlanModal open={isUpgradeOpen} onOpenChange={setIsUpgradeOpen} />
    </Dialog>
  );
}
