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
  LayoutPanelTop,
  Loader2,
  AlertTriangle,
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

/** Toggles which content types appear in the Content Type step. Flip a
 *  boolean to enable/disable a type without touching the rest of the dialog.
 *  When exactly one type is enabled, the Content Type step is hidden and
 *  contentType is pre-set to that single value (D-02). */
const CONTENT_TYPE_ENABLED = {
  image: true,
  video: false,
  carousel: true,
  enhancement: true,
} as const;

type ContentType = keyof typeof CONTENT_TYPE_ENABLED;

/** Derived: list of enabled content types in fixed display order. */
const ENABLED_CONTENT_TYPES = (Object.keys(CONTENT_TYPE_ENABLED) as ContentType[])
  .filter((key) => CONTENT_TYPE_ENABLED[key]);

/** Set to true to re-enable image resolution picker (512px/1K/2K/4K) */
const RESOLUTION_PICKER_ENABLED = false;

const IMAGE_STEPS = [
  ...(ENABLED_CONTENT_TYPES.length >= 2 ? ["Content Type"] : []),
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

const CAROUSEL_STEPS = [
  ...(ENABLED_CONTENT_TYPES.length >= 2 ? ["Content Type"] : []),
  "Slides",
  "Reference",
  "Post Mood",
  "Format / Size",
];

const ENHANCEMENT_STEPS = [
  ...(ENABLED_CONTENT_TYPES.length >= 2 ? ["Content Type"] : []),
  "Upload Photo",
  "Scenery Picker",
];

/**
 * F1 (D-02) — column count scales inversely with slide count to keep
 * thumbnails as large as possible inside the dialog body.
 * 3 → cols-3 (large), 4 → cols-4, 5-6 → cols-3 (2-row split), 7-8 → cols-4 (2-row split).
 */
function gridColsForCount(count: number): string {
  if (count <= 3) return "grid-cols-3";
  if (count === 4) return "grid-cols-4";
  if (count <= 6) return "grid-cols-3";
  return "grid-cols-4";
}

// ── F5: draft persistence (09.1 D-15..D-22) ─────────────────────────────────
const DRAFT_STORAGE_KEY = "xareable.postCreator.draft";
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // D-19: 7 days
const DRAFT_DEBOUNCE_MS = 500; // D-20

type CreatorDraft = {
  savedAt: string;
  contentType: string;
  step: number;
  referenceText: string;
  slideCount: number;
  postMood: string;
  aspectRatio: string;
  imageResolution: "512px" | "1K" | "2K" | "4K";
  videoDuration: "4" | "6" | "8";
  videoResolution: "720p" | "1080p" | "4k";
  useText: boolean;
  copyText: string;
  selectedTextStyleIds: string[];
  useLogo: boolean;
  logoPosition: string;
  contentLanguage: string;
  sceneryId: string | null;
};

function loadDraft(): CreatorDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CreatorDraft;
    if (typeof parsed?.savedAt !== "string") {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    const ageMs = Date.now() - new Date(parsed.savedAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > DRAFT_TTL_MS) {
      // D-19: silent expiry
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    // Corrupt JSON — wipe and start fresh
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch {}
    return null;
  }
}

function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch {}
}

function saveDraft(draft: Omit<CreatorDraft, "savedAt">): void {
  try {
    const payload: CreatorDraft = { ...draft, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // QuotaExceededError or storage disabled — silently no-op
  }
}
// ─────────────────────────────────────────────────────────────────────────────

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

  const [viewMode, setViewMode] = useState<ViewMode>("form");
  const [contentType, setContentType] = useState<ContentType>(
    ENABLED_CONTENT_TYPES[0] ?? "image",
  );
  const [step, setStep] = useState(0);
  const [slideCount, setSlideCount] = useState<number>(3);
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
  // Carousel result state (Task 2)
  const [carouselSlides, setCarouselSlides] = useState<Array<{
    slideNumber: number;
    imageUrl: string | null;
    failed: boolean;
  }>>([]);
  const [carouselCaption, setCarouselCaption] = useState<string>("");
  const [carouselSavedCount, setCarouselSavedCount] = useState<number>(0);
  const [carouselRequestedCount, setCarouselRequestedCount] = useState<number>(0);
  const [carouselStatus, setCarouselStatus] = useState<"completed" | "draft" | null>(null);
  const [carouselCurrentSlide, setCarouselCurrentSlide] = useState<number>(0);
  // F2 — hover preview state (D-04..D-06). Holds the URL of the currently
  // hovered result-view slide image. null when no slide is hovered.
  const [hoveredSlideUrl, setHoveredSlideUrl] = useState<string | null>(null);
  // F5 — draft banner state. Set on dialog open if a fresh draft exists.
  // Cleared by user choosing Continue or Start fresh.
  const [pendingDraft, setPendingDraft] = useState<CreatorDraft | null>(null);
  // Enhancement branch state (09-04)
  const [enhancementFile, setEnhancementFile] = useState<{
    file: File;
    preview: string;
    base64: string;
    mimeType: string;
  } | null>(null);
  const [sceneryId, setSceneryId] = useState<string | null>(null);
  const [isEnhancementDragActive, setIsEnhancementDragActive] = useState(false);
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
  /** Active scenery presets from the style catalog (D-13, D-14). Used to
   *  decide whether the Enhancement content type is offered (D-15) and to
   *  populate the Scenery Picker step in 09-04. */
  const activeSceneries = (catalog.sceneries ?? []).filter(
    (s) => s.is_active !== false,
  );
  const enhancementAvailable = activeSceneries.length > 0;
  const steps = (() => {
    if (contentType === "video") return VIDEO_STEPS;
    if (contentType === "carousel") return CAROUSEL_STEPS;
    if (contentType === "enhancement") return ENHANCEMENT_STEPS;
    return IMAGE_STEPS;
  })();
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
    if (isOpen) {
      // F5 (D-19, D-20): on open, attempt to load a fresh draft. The banner
      // (Task 2) renders based on pendingDraft. We do NOT auto-apply state —
      // user must click Continue. If no draft (or expired), banner is hidden.
      const draft = loadDraft();
      setPendingDraft(draft);
      return;
    }
    // Close path — existing reset behavior.
    setViewMode("form");
    setContentType(ENABLED_CONTENT_TYPES[0] ?? "image");
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
    setSlideCount(3);
    setCarouselSlides([]);
    setCarouselCaption("");
    setCarouselSavedCount(0);
    setCarouselRequestedCount(0);
    setCarouselStatus(null);
    setCarouselCurrentSlide(0);
    setEnhancementFile((prev) => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview);
      return null;
    });
    setSceneryId(null);
    setIsEnhancementDragActive(false);
    setPendingDraft(null);
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

  // Cleanup blob URL when enhancementFile changes (avoids memory leaks on Replace/clear).
  useEffect(() => {
    return () => {
      if (enhancementFile?.preview) URL.revokeObjectURL(enhancementFile.preview);
    };
  }, [enhancementFile]);

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

  // F5 (D-20) — debounced save. Writes to localStorage 500ms after the last
  // state change while the dialog is open in form view. Persists D-16 fields
  // only. Skips during generating/result viewMode (no point saving a frozen
  // form). NEVER persists referenceImages or enhancementFile (D-17).
  useEffect(() => {
    if (!isOpen) return;
    if (viewMode !== "form") return;
    const handle = setTimeout(() => {
      saveDraft({
        contentType,
        step,
        referenceText,
        slideCount,
        postMood,
        aspectRatio,
        imageResolution,
        videoDuration,
        videoResolution,
        useText,
        copyText,
        selectedTextStyleIds,
        useLogo,
        logoPosition,
        contentLanguage,
        sceneryId,
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [
    isOpen,
    viewMode,
    contentType,
    step,
    referenceText,
    slideCount,
    postMood,
    aspectRatio,
    imageResolution,
    videoDuration,
    videoResolution,
    useText,
    copyText,
    selectedTextStyleIds,
    useLogo,
    logoPosition,
    contentLanguage,
    sceneryId,
  ]);

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

  // F5 (D-20) — Continue draft: apply the loaded draft state and dismiss banner.
  function handleContinueDraft() {
    if (!pendingDraft) return;
    setContentType(pendingDraft.contentType as ContentType);
    setStep(pendingDraft.step);
    setReferenceText(pendingDraft.referenceText);
    setSlideCount(pendingDraft.slideCount);
    setPostMood(pendingDraft.postMood);
    setAspectRatio(pendingDraft.aspectRatio);
    setImageResolution(pendingDraft.imageResolution);
    setVideoDuration(pendingDraft.videoDuration);
    setVideoResolution(pendingDraft.videoResolution);
    setUseText(pendingDraft.useText);
    setCopyText(pendingDraft.copyText);
    setSelectedTextStyleIds(pendingDraft.selectedTextStyleIds);
    setUseLogo(pendingDraft.useLogo);
    setLogoPosition(pendingDraft.logoPosition);
    setContentLanguage(pendingDraft.contentLanguage as Parameters<typeof setContentLanguage>[0]);
    setSceneryId(pendingDraft.sceneryId);
    setPendingDraft(null);
  }

  // F5 (D-20) — Start fresh: discard draft and dismiss banner.
  function handleStartFresh() {
    clearDraft();
    setPendingDraft(null);
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

  // --- Enhancement photo upload helpers ---

  function processEnhancementFile(file: File) {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast({
        title: t("Invalid file type"),
        description: t("Please upload JPEG, PNG, or WEBP images only."),
        variant: "destructive",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t("File too large"),
        description: t("Your photo must be under 5 MB."),
        variant: "destructive",
      });
      return;
    }

    const preview = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      setEnhancementFile((prev) => {
        if (prev?.preview) URL.revokeObjectURL(prev.preview);
        return { file, preview, base64, mimeType: file.type };
      });
    };
    reader.readAsDataURL(file);
  }

  function handleEnhancementSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processEnhancementFile(file);
    e.target.value = "";
  }

  function handleEnhancementDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsEnhancementDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processEnhancementFile(file);
  }

  function handleEnhancementDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    if (!isEnhancementDragActive) setIsEnhancementDragActive(true);
  }

  function handleEnhancementDragLeave() {
    setIsEnhancementDragActive(false);
  }

  function clearEnhancementFile() {
    setEnhancementFile((prev) => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview);
      return null;
    });
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
      clearDraft(); // F5 (D-21) — successful generation: discard the draft.
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
      setContentType(ENABLED_CONTENT_TYPES[0] ?? "image");
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

  async function handleGenerateCarousel() {
    setViewMode("generating");
    setProgress(0);
    setProgressMessage(t("Starting generation..."));
    setCarouselRequestedCount(slideCount);
    // Pre-seed N pending slides so the thumbnail row renders immediately.
    setCarouselSlides(
      Array.from({ length: slideCount }, (_, i) => ({
        slideNumber: i + 1,
        imageUrl: null,
        failed: false,
      })),
    );
    setCarouselCurrentSlide(0);
    setCarouselStatus(null);
    setCarouselCaption("");
    setCarouselSavedCount(0);

    const idempotencyKey = crypto.randomUUID();
    let completePayload: any = null;

    try {
      await fetchSSE(
        "/api/carousel/generate",
        {
          prompt: referenceText.trim(),
          slide_count: slideCount,
          aspect_ratio: aspectRatio as "1:1" | "4:5",
          idempotency_key: idempotencyKey,
          content_language: contentLanguage,
          post_mood: postMood,
          text_style_ids: selectedTextStyleIds.length > 0 ? selectedTextStyleIds : undefined,
          use_logo: useLogo,
          logo_position: useLogo ? logoPosition : undefined,
        },
        {
          onProgress: (event) => {
            setProgress(event.progress);
            setProgressMessage(event.message);
            // SERVER SSE CONTRACT (verified against server/routes/carousel.routes.ts mapProgress
            // lines 227-271): per-slide events carry ONLY { phase: `slide_${N}`, message, progress }.
            // The service-level `slide_complete` event has `imageUrl` (carousel-generation.service.ts
            // line 88), but the route's mapProgress does NOT forward that field over SSE — it only
            // emits a sendProgress with phase/message/progress numbers.
            //
            // Therefore: the slide_X phase events update only the spinner state and the failed-slide
            // detection. Real slide image_urls arrive ONLY in the final `complete` payload as
            // `image_urls[]` (route lines 464-471) and are mapped onto carouselSlides AFTER fetchSSE
            // resolves (see code below this block). This is correct per D-19 and the existing
            // server contract — do NOT attempt to extract `image_url` from progress events.
            const slideMatch = event.phase.match(/^slide_(\d+)$/);
            if (slideMatch) {
              const n = parseInt(slideMatch[1], 10);
              setCarouselCurrentSlide(n);
              // Failure detection: route's mapProgress for slide_failed surfaces the message
              // "Slide N retrying or skipped: ..." (carousel.routes.ts line 253). Match those
              // tokens to flip the slot to failed state and show the AlertTriangle icon.
              if (/skipped|retrying/i.test(event.message)) {
                setCarouselSlides((prev) =>
                  prev.map((s) =>
                    s.slideNumber === n ? { ...s, failed: true } : s,
                  ),
                );
              }
            }
          },
          onComplete: (data) => {
            completePayload = data;
            setProgress(100);
            setProgressMessage(t("Done!"));
          },
        },
      );

      if (!completePayload) {
        throw new Error("Carousel generation completed without result data");
      }

      const imageUrls: string[] = completePayload.image_urls ?? [];
      const status: "completed" | "draft" = completePayload.status ?? "completed";
      const savedCount: number = completePayload.saved_slide_count ?? imageUrls.length;
      const caption: string = completePayload.caption ?? "";

      // Map image URLs back onto slides. Slides that never got an image stay failed.
      setCarouselSlides((prev) => {
        // Image URLs are in slide_number order from the server.
        const successfulNumbers = prev
          .filter((s) => !s.failed)
          .slice(0, imageUrls.length)
          .map((s) => s.slideNumber);
        return prev.map((s) => {
          const idx = successfulNumbers.indexOf(s.slideNumber);
          if (idx >= 0) return { ...s, imageUrl: imageUrls[idx], failed: false };
          return { ...s, failed: true };
        });
      });
      setCarouselCaption(caption);
      setCarouselStatus(status);
      setCarouselSavedCount(savedCount);

      markCreated();
      clearDraft(); // F5 (D-21) — successful generation: discard the draft.
      setViewMode("result");
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
      } else if (errMsg.includes("carousel_aborted") || errMsg.includes("carousel_full_failure")) {
        toast({
          title: t("Generation failed"),
          description: t("Fewer than half the slides were generated. No credits were charged."),
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

  async function handleGenerateEnhancement() {
    if (!enhancementFile || !sceneryId) return;

    setViewMode("generating");
    setProgress(0);
    setProgressMessage(t("Applying scenery and enhancing details…"));

    const idempotencyKey = crypto.randomUUID();
    let completePayload: any = null;

    try {
      await fetchSSE(
        "/api/enhance",
        {
          scenery_id: sceneryId,
          idempotency_key: idempotencyKey,
          image: {
            mimeType: enhancementFile.mimeType,
            data: enhancementFile.base64,
          },
        },
        {
          onProgress: (event) => {
            setProgress(event.progress);
            setProgressMessage(event.message);
          },
          onComplete: (data) => {
            completePayload = data;
            setProgress(100);
            setProgressMessage(t("Done!"));
          },
        },
      );

      if (!completePayload) {
        throw new Error("Enhancement completed without result data");
      }

      markCreated();
      clearDraft(); // F5 (D-21) — successful generation: discard the draft.
      const generatedPostId = completePayload.post?.id || completePayload.post_id || "";
      const generatedImageUrl = completePayload.image_url || completePayload.post?.image_url || "";
      const generatedCaption = completePayload.caption || completePayload.post?.caption || "";

      if (!generatedPostId || !generatedImageUrl) {
        throw new Error("Invalid enhance response: missing post id or image_url");
      }

      // D-20 — same handoff as Image: openViewer with the persisted post.
      closeCreator();
      setViewMode("form");
      setContentType(ENABLED_CONTENT_TYPES[0] ?? "image");
      setStep(0);
      clearEnhancementFile();
      setSceneryId(null);

      openViewer({
        id: generatedPostId,
        user_id: completePayload.post?.user_id || "",
        image_url: generatedImageUrl,
        thumbnail_url: completePayload.post?.thumbnail_url ?? null,
        content_type: completePayload.post?.content_type || "enhancement",
        slide_count: null,
        idempotency_key: idempotencyKey,
        caption: generatedCaption,
        ai_prompt_used: completePayload.post?.ai_prompt_used ?? null,
        status: completePayload.post?.status ?? "generated",
        created_at: completePayload.post?.created_at || new Date().toISOString(),
        expires_at: completePayload.post?.expires_at ?? null,
      });
    } catch (err: any) {
      setViewMode("form");
      const errMsg = String(err?.message || "");
      const errCode = (err && err.error) || "";
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
      } else if (errCode === "pre_screen_rejected") {
        toast({
          title: t("Photo not accepted"),
          description: t("This photo cannot be enhanced. Please try a clear product photo."),
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
    setContentType(ENABLED_CONTENT_TYPES[0] ?? "image");
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
    setSlideCount(3);
    setCarouselSlides([]);
    setCarouselCaption("");
    setCarouselSavedCount(0);
    setCarouselRequestedCount(0);
    setCarouselStatus(null);
    setCarouselCurrentSlide(0);
    setEnhancementFile((prev) => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview);
      return null;
    });
    setSceneryId(null);
    setIsEnhancementDragActive(false);
  }

  function resetBranchState() {
    setSlideCount(3);
    setPostMood(defaultPostMood);
    setCopyText("");
    setUseText(true);
    setSelectedTextStyleIds([]);
    setUseLogo(false);
    setLogoPosition("bottom-right");
    setAspectRatio("1:1");
    setReferenceText("");
    setReferenceImages([]);
    setCarouselSlides([]);
    setCarouselCaption("");
    setCarouselSavedCount(0);
    setCarouselRequestedCount(0);
    setCarouselStatus(null);
    setCarouselCurrentSlide(0);
    setEnhancementFile((prev) => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview);
      return null;
    });
    setSceneryId(null);
    setIsEnhancementDragActive(false);
  }

  // handleDownload is no longer needed here as it's in the global Viewer

  function renderStepContent() {
    // Content Type Selection
    if (currentStepTitle === "Content Type") {
      const isVideoLocked = !usesOwnApiKey && creditStatus && (
        creditStatus.free_generations_remaining > 0 ||
        creditStatus.denial_reason === "upgrade_required" ||
        creditStatus.balance_micros <= 0
      );
      // Effective types: hide Enhancement when no active sceneries (D-15).
      const effectiveTypes = ENABLED_CONTENT_TYPES.filter(
        (ct) => ct !== "enhancement" || enhancementAvailable,
      );
      const gridClass =
        effectiveTypes.length === 1
          ? "grid-cols-1"
          : effectiveTypes.length <= 3
            ? "grid-cols-2"
            : "grid-cols-2 sm:grid-cols-4";
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

          <div className={`grid ${gridClass} gap-4`}>
            {effectiveTypes.includes("image") && (
              <button
                type="button"
                data-testid="content-type-image"
                onClick={() => {
                  if (contentType !== "image") {
                    resetBranchState();
                    setStep(0);
                  }
                  setContentType("image");
                  const fmts = catalog.post_formats?.length ? catalog.post_formats : (DEFAULT_STYLE_CATALOG.post_formats || []);
                  setAspectRatio(fmts[0]?.value ?? "1:1");
                }}
                className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all ${contentType === "image"
                  ? "border-violet-400 bg-violet-400/10"
                  : "border-border hover:border-violet-400/40"
                  }`}
              >
                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${contentType === "image" ? "bg-violet-400/20" : "bg-muted"}`}>
                  <ImageIcon aria-hidden="true" className={`w-8 h-8 ${contentType === "image" ? "text-violet-400" : "text-muted-foreground"}`} />
                </div>
                <div className="text-center">
                  <div className="font-medium">{t("Image")}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("Static image for social media posts")}
                  </div>
                </div>
              </button>
            )}

            {effectiveTypes.includes("video") && (
              <button
                type="button"
                data-testid="content-type-video"
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
                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${contentType === "video" ? "bg-violet-400/20" : "bg-muted"}`}>
                  <VideoIcon aria-hidden="true" className={`w-8 h-8 ${contentType === "video" ? "text-violet-400" : "text-muted-foreground"}`} />
                </div>
                <div className="text-center">
                  <div className="font-medium">{t("Video")}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {isVideoLocked ? t("Upgrade to create videos") : t("AI-generated video content")}
                  </div>
                </div>
              </button>
            )}

            {effectiveTypes.includes("carousel") && (
              <button
                type="button"
                data-testid="content-type-carousel"
                onClick={() => {
                  if (contentType !== "carousel") {
                    resetBranchState();
                    setStep(0);
                  }
                  setContentType("carousel");
                  setAspectRatio("1:1");
                }}
                className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all ${contentType === "carousel"
                  ? "border-violet-400 bg-violet-400/10"
                  : "border-border hover:border-violet-400/40"
                  }`}
              >
                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${contentType === "carousel" ? "bg-violet-400/20" : "bg-muted"}`}>
                  <LayoutPanelTop aria-hidden="true" className={`w-8 h-8 ${contentType === "carousel" ? "text-violet-400" : "text-muted-foreground"}`} />
                </div>
                <div className="text-center">
                  <div className="font-medium">{t("Carousel")}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("Multi-slide Instagram carousel")}
                  </div>
                </div>
              </button>
            )}

            {effectiveTypes.includes("enhancement") && (
              <button
                type="button"
                data-testid="content-type-enhancement"
                onClick={() => {
                  if (contentType !== "enhancement") {
                    resetBranchState();
                    setStep(0);
                  }
                  setContentType("enhancement");
                  setAspectRatio("1:1");
                }}
                className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all ${contentType === "enhancement"
                  ? "border-violet-400 bg-violet-400/10"
                  : "border-border hover:border-violet-400/40"
                  }`}
              >
                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${contentType === "enhancement" ? "bg-violet-400/20" : "bg-muted"}`}>
                  <Sparkles aria-hidden="true" className={`w-8 h-8 ${contentType === "enhancement" ? "text-violet-400" : "text-muted-foreground"}`} />
                </div>
                <div className="text-center">
                  <div className="font-medium">{t("Enhancement")}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("AI-enhanced product photo")}
                  </div>
                </div>
              </button>
            )}
          </div>

          {CONTENT_TYPE_ENABLED.enhancement && !enhancementAvailable && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              {t("Photo enhancement is currently unavailable.")}
            </p>
          )}
        </div>
      );
    }

    // Upload Photo (Enhancement branch)
    if (currentStepTitle === "Upload Photo") {
      const hasFile = enhancementFile !== null;
      return (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-base font-semibold">{t("Upload your photo")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("Upload a product photo to enhance. Any aspect ratio accepted — max 5 MB.")}
            </p>
          </div>

          {!hasFile && (
            <label
              className={`relative border-2 border-dashed rounded-xl bg-muted/30 aspect-video flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground cursor-pointer transition-colors ${
                isEnhancementDragActive ? "border-violet-400 bg-violet-400/10" : "hover:bg-muted/40"
              }`}
              onDrop={handleEnhancementDrop}
              onDragOver={handleEnhancementDragOver}
              onDragLeave={handleEnhancementDragLeave}
              data-testid="enhancement-upload-zone"
            >
              <ImagePlus className="w-8 h-8" aria-hidden="true" />
              <div className="font-medium">
                {isEnhancementDragActive ? t("Drop your photo here") : t("Click to upload")}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("JPEG, PNG, WEBP · max 5 MB · Any aspect ratio accepted")}
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleEnhancementSelect}
                className="hidden"
              />
            </label>
          )}

          {hasFile && enhancementFile && (
            <div className="space-y-1">
              <div className="relative aspect-video rounded-xl overflow-hidden bg-muted/30 border border-border">
                <img
                  src={enhancementFile.preview}
                  alt={enhancementFile.file.name}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={clearEnhancementFile}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"
                  aria-label={t("Remove photo")}
                  data-testid="enhancement-remove-photo"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="text-xs text-muted-foreground truncate mt-1">
                {enhancementFile.file.name}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Scenery Picker (Enhancement branch)
    if (currentStepTitle === "Scenery Picker") {
      return (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-base font-semibold">{t("Choose a scenery")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("Select the background environment for your product.")}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[340px] overflow-y-auto pr-1">
            {activeSceneries.map((scenery) => {
              const isSelected = sceneryId === scenery.id;
              return (
                <button
                  key={scenery.id}
                  type="button"
                  onClick={() => setSceneryId(scenery.id)}
                  className={`rounded-xl border-2 overflow-hidden flex flex-col transition-all cursor-pointer text-left ${
                    isSelected
                      ? "border-violet-400 bg-violet-400/10"
                      : "border-border hover:border-violet-400/40"
                  }`}
                  data-testid={`scenery-${scenery.id}`}
                  aria-pressed={isSelected}
                >
                  <div className="aspect-video bg-muted/40 overflow-hidden relative flex items-center justify-center">
                    {scenery.preview_image_url ? (
                      <img
                        src={scenery.preview_image_url}
                        alt={scenery.label}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-muted-foreground/50" aria-hidden="true" />
                    )}
                  </div>
                  <div className="p-2 flex flex-col gap-1">
                    <div className="text-sm font-semibold truncate">{scenery.label}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1">
                      {scenery.prompt_snippet.split("\n")[0]}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // Slides (Carousel branch only)
    if (currentStepTitle === "Slides") {
      const counts = [3, 4, 5, 6, 7, 8];
      return (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-base font-semibold">{t("How many slides?")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("Choose how many slides to generate. All slides share one consistent visual style.")}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-start">
            {counts.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSlideCount(n)}
                className={`w-10 h-10 rounded-lg border text-sm font-semibold transition-all ${
                  slideCount === n
                    ? "border-violet-400 bg-violet-400/10 text-violet-400"
                    : "border-border text-muted-foreground hover:border-violet-400/40"
                }`}
                data-testid={`slide-count-${n}`}
                aria-pressed={slideCount === n}
              >
                {n}
              </button>
            ))}
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

    // Format / Size (last step for image, video, and carousel)
    const baseFormats = contentType === "video"
      ? (catalog.video_formats?.length ? catalog.video_formats : (DEFAULT_STYLE_CATALOG.video_formats || []))
      : (catalog.post_formats?.length ? catalog.post_formats : (DEFAULT_STYLE_CATALOG.post_formats || []));
    const availableFormats = contentType === "carousel"
      ? baseFormats.filter((f) => f.value === "1:1" || f.value === "4:5")
      : baseFormats;

    const isHighResVideo = videoResolution === "1080p" || videoResolution === "4k";

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {availableFormats.map(({ id, value, label, subtitle, icon }) => {
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

        {contentType === "carousel" && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-400/5 border border-violet-400/20 mt-3">
            <Info className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              {t("All slides in this carousel share the same format.")}
            </p>
          </div>
        )}

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

  const canGenerateCarousel =
    (referenceText.trim() !== "" || referenceImages.length > 0) &&
    slideCount >= 3 && slideCount <= 8 &&
    (aspectRatio === "1:1" || aspectRatio === "4:5") &&
    postMood.trim() !== "";

  const canGenerateEnhancement =
    enhancementFile !== null &&
    sceneryId !== null;

  const canGenerate = (() => {
    if (contentType === "carousel") return canGenerateCarousel;
    if (contentType === "enhancement") return canGenerateEnhancement;
    return true;
  })();

  const generateButtonLabel = contentType === "carousel"
    ? t("Generate Carousel")
    : contentType === "enhancement"
      ? t("Enhance Photo")
      : contentType === "video"
        ? t("Generate Video")
        : t("Generate Post");

  const handleGenerateClick = () => {
    if (contentType === "carousel") return handleGenerateCarousel();
    if (contentType === "enhancement") return handleGenerateEnhancement();
    return handleGenerate();
  };

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
              {pendingDraft && (
                <div
                  className="mx-6 mt-4 mb-2 flex items-center justify-between gap-3 p-3 rounded-lg bg-violet-400/5 border border-violet-400/20"
                  data-testid="draft-restore-banner"
                  role="region"
                  aria-label={t("Continue where you left off?")}
                >
                  <div className="text-sm text-foreground">
                    {t("Continue where you left off?")}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleStartFresh}
                      data-testid="draft-start-fresh"
                    >
                      {t("Start fresh")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleContinueDraft}
                      data-testid="draft-continue"
                    >
                      {t("Continue draft")}
                    </Button>
                  </div>
                </div>
              )}
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
                    <Button onClick={handleGenerateClick} disabled={!canGenerate} data-testid="button-generate">
                      <Sparkles className="w-4 h-4 mr-2" />
                      {generateButtonLabel}
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
              {contentType === "carousel" && carouselRequestedCount > 0 && (
                <>
                  <p className="text-sm text-muted-foreground text-center mb-4">
                    {t("Generating slide {n} of {total}…")
                      .replace("{n}", String(Math.max(carouselCurrentSlide, 1)))
                      .replace("{total}", String(carouselRequestedCount))}
                  </p>
                  <div className="flex gap-2 justify-center flex-wrap mb-6">
                    {carouselSlides.map((slide) => {
                      const isCurrent = slide.slideNumber === carouselCurrentSlide && !slide.imageUrl && !slide.failed;
                      const isFailed = slide.failed && !slide.imageUrl;
                      const isPending = !slide.imageUrl && !slide.failed && !isCurrent;
                      const isDone = !!slide.imageUrl;
                      const failedAriaLabel = t("Slide {n} failed").replace("{n}", String(slide.slideNumber));
                      return (
                        <div
                          key={slide.slideNumber}
                          className={`w-[72px] h-[72px] rounded-lg overflow-hidden relative bg-muted flex items-center justify-center flex-shrink-0 transition-opacity duration-300 ${
                            isCurrent ? "ring-2 ring-violet-400/60" : ""
                          } ${isFailed ? "bg-destructive/10" : ""}`}
                          aria-label={isFailed ? failedAriaLabel : undefined}
                        >
                          {isDone && slide.imageUrl && (
                            <img
                              src={slide.imageUrl}
                              className="w-full h-full object-cover"
                              alt={`Slide ${slide.slideNumber}`}
                            />
                          )}
                          {(isPending || isCurrent) && (
                            <Loader2
                              className={`w-5 h-5 animate-spin ${isCurrent ? "text-violet-400" : "text-muted-foreground"}`}
                              aria-hidden="true"
                            />
                          )}
                          {isFailed && (
                            <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
                          )}
                          <span
                            className="absolute bottom-1 left-1 text-[9px] text-white bg-black/60 px-1 rounded"
                            aria-hidden="true"
                          >
                            {slide.slideNumber}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <div className="mb-6">
                <GeneratingLoader size={0.6} />
              </div>
              <h2 className="text-xl font-semibold mb-2">
                {contentType === "enhancement"
                  ? t("Enhancing Your Photo")
                  : contentType === "carousel"
                    ? t("Creating Your Carousel")
                    : t("Creating Your Post")}
              </h2>
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

          {viewMode === "result" && contentType === "carousel" && (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-8 flex flex-col relative"
            >
              <h2 className="text-xl font-semibold mb-2 text-center">
                {t("Carousel Ready")}
              </h2>

              {carouselStatus === "draft" && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 text-xs text-orange-400 mb-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  <span>
                    {t("Only {n} of {requested} slides were generated. Your post was saved as a draft.")
                      .replace("{n}", String(carouselSavedCount))
                      .replace("{requested}", String(carouselRequestedCount))}
                  </span>
                </div>
              )}

              {(() => {
                const visibleSlides = carouselSlides.filter((s) => !!s.imageUrl);
                return (
                  <div className={`grid ${gridColsForCount(visibleSlides.length)} gap-2 mb-6`}>
                    {visibleSlides.map((s) => (
                      <div
                        key={s.slideNumber}
                        className="relative rounded-lg overflow-hidden aspect-square bg-muted cursor-zoom-in"
                        data-testid={`result-slide-${s.slideNumber}`}
                        onMouseEnter={() => setHoveredSlideUrl(s.imageUrl!)}
                        onMouseLeave={() => setHoveredSlideUrl(null)}
                        onFocus={() => setHoveredSlideUrl(s.imageUrl!)}
                        onBlur={() => setHoveredSlideUrl(null)}
                        tabIndex={0}
                        aria-label={t("Slide preview")}
                      >
                        <img
                          src={s.imageUrl!}
                          alt={`Slide ${s.slideNumber}`}
                          className="w-full h-full object-cover"
                        />
                        <div
                          className="absolute bottom-1 left-1 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded"
                          aria-hidden="true"
                        >
                          {`Slide ${s.slideNumber}`}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <AnimatePresence>
                {hoveredSlideUrl && (
                  <motion.div
                    key="hover-preview"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 z-50 rounded-xl overflow-hidden shadow-2xl ring-1 ring-border bg-card"
                    style={{ width: "min(55%, 480px)", aspectRatio: "1 / 1" }}
                    data-testid="hover-preview-overlay"
                    aria-hidden="true"
                  >
                    <img
                      src={hoveredSlideUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {t("Caption")}
              </div>
              <div className="w-full rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground select-text cursor-text max-h-[120px] overflow-y-auto whitespace-pre-wrap mb-6">
                {carouselCaption}
              </div>

              <div className="flex items-center justify-between gap-3 mt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    clearDraft(); // F5 (D-22) — Generate Another after success: discard draft
                    resetBranchState();
                    setStep(0);
                    setViewMode("form");
                    setCarouselSlides([]);
                    setCarouselCaption("");
                    setCarouselSavedCount(0);
                    setCarouselRequestedCount(0);
                    setCarouselStatus(null);
                    setCarouselCurrentSlide(0);
                    // Stay on Content Type if multiple types are enabled.
                    setContentType(ENABLED_CONTENT_TYPES[0] ?? "image");
                  }}
                  data-testid="carousel-generate-another"
                >
                  {t("Generate Another")}
                </Button>
                <Button
                  onClick={() => {
                    clearDraft(); // F5 (D-22) — Save & Close after success: discard draft
                    closeCreator();
                  }}
                  data-testid="carousel-save-close"
                >
                  {t("Save & Close")}
                </Button>
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
