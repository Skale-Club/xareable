import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { usePostCreator } from "@/lib/post-creator";
import { usePostViewer } from "@/lib/post-viewer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { VoiceInputButton } from "@/components/voice-input-button";
import {
  Loader2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Square,
  RectangleHorizontal,
  RectangleVertical,
  Megaphone,
  Download,
  Plus,
  Info,
  Droplets,
  Flame,
  ImagePlus,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { GenerateResponse } from "@shared/schema";

const POST_STYLES = [
  { value: "promo", label: "Promo", description: "Sales & offers", icon: Megaphone },
  { value: "info", label: "Info", description: "Educational", icon: Info },
  { value: "clean", label: "Clean", description: "Minimal design", icon: Droplets },
  { value: "vibrant", label: "Vibrant", description: "Eye-catching", icon: Flame },
];

const FORMATS = [
  { value: "1:1", label: "Square", subtitle: "Instagram Post", icon: Square },
  { value: "4:5", label: "Portrait", subtitle: "Instagram Feed", icon: RectangleVertical },
  { value: "9:16", label: "Story", subtitle: "Instagram/TikTok", icon: RectangleVertical },
  { value: "16:9", label: "Landscape", subtitle: "YouTube/LinkedIn", icon: RectangleHorizontal },
  { value: "2:3", label: "Pinterest", subtitle: "Pin Post", icon: RectangleVertical },
  { value: "1200:628", label: "Facebook", subtitle: "Link Preview", icon: RectangleHorizontal },
];

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

const STEP_TITLES = [
  "Reference Material",
  "Post Style",
  "Text on Image",
  "Logo Placement",
  "Format / Size",
];

const TOTAL_STEPS = STEP_TITLES.length;

type ViewMode = "form" | "generating" | "result";

export function PostCreatorDialog() {
  const { isOpen, closeCreator, markCreated } = usePostCreator();
  const { openViewer } = usePostViewer();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<"form" | "generating">("form");
  const [step, setStep] = useState(0);
  const [referenceText, setReferenceText] = useState("");
  const [referenceImages, setReferenceImages] = useState<Array<{
    id: string;
    file: File;
    preview: string;
    base64: string;
  }>>([]);
  const [postProfile, setPostProfile] = useState("promo");
  const [copyText, setCopyText] = useState("");
  const [useText, setUseText] = useState(true);
  const [useLogo, setUseLogo] = useState(false);
  const [logoPosition, setLogoPosition] = useState<string>("bottom-right");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  // Result state handled structurally via PostViewerDialog

  useEffect(() => {
    if (!isOpen) {
      setViewMode("form");
      setStep(0);
      setReferenceImages([]);
      setReferenceText("");
      setPostProfile("promo");
      setCopyText("");
      setUseText(true);
      setUseLogo(false);
      setLogoPosition("bottom-right");
      setAspectRatio("1:1");
      setProgress(0);
      setProgressMessage("");
    }
  }, [isOpen]);

  function handleOpenChange(open: boolean) {
    if (viewMode === "generating" && !open) return;
    if (!open) closeCreator();
  }

  function handleNextStep() {
    setStep((current) => Math.min(current + 1, TOTAL_STEPS - 1));
  }

  function handlePreviousStep() {
    setStep((current) => Math.max(current - 1, 0));
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);

    files.forEach(async (file) => {
      // Validation: file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file type",
          description: "Please upload image files only (PNG, JPG, WebP)",
          variant: "destructive"
        });
        return;
      }

      // Validation: file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Images must be under 5MB",
          variant: "destructive"
        });
        return;
      }

      // Validation: max count
      if (referenceImages.length >= 4) {
        toast({
          title: "Maximum reached",
          description: "You can upload up to 4 reference images",
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

          setReferenceImages(prev => [...prev, {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file,
            preview,
            base64
          }]);
        };
        base64Reader.readAsDataURL(file);
      };
      reader.readAsDataURL(file);
    });

    // Reset input to allow re-selecting same file
    e.target.value = '';
  }

  function handleRemoveImage(imageId: string) {
    setReferenceImages(prev => prev.filter(img => img.id !== imageId));
  }

  async function handleGenerate() {

    setViewMode("generating");
    setProgress(0);
    setProgressMessage("Analyzing your brand context...");

    const interval = setInterval(() => {
      setProgress((value) => {
        if (value < 30) {
          setProgressMessage("Analyzing your brand context...");
          return value + 2;
        }
        if (value < 60) {
          setProgressMessage("Crafting the perfect design prompt...");
          return value + 1.5;
        }
        if (value < 85) {
          setProgressMessage("Generating your image...");
          return value + 0.8;
        }
        if (value < 95) {
          setProgressMessage("Finishing touches...");
          return value + 0.3;
        }
        return value;
      });
    }, 300);

    try {
      const res = await apiRequest("POST", "/api/generate", {
        reference_text: referenceText.trim() || undefined,
        reference_images: referenceImages.length > 0
          ? referenceImages.map(img => ({
            mimeType: img.file.type,
            data: img.base64
          }))
          : undefined,
        post_profile: postProfile,
        copy_text: copyText.trim(),
        aspect_ratio: aspectRatio,
        use_logo: useLogo,
        logo_position: useLogo ? logoPosition : undefined,
      });
      const data: GenerateResponse = await res.json();
      clearInterval(interval);
      setProgress(100);
      setProgressMessage("Done!");
      markCreated();

      closeCreator();
      setViewMode("form"); // reset creator back to step 0 locally
      setStep(0);
      setReferenceImages([]);
      setReferenceText("");
      setPostProfile("promo");
      setCopyText("");
      setAspectRatio("1:1");

      openViewer({
        id: data.post_id,
        user_id: "",
        image_url: data.image_url,
        caption: data.caption,
        ai_prompt_used: null,
        status: "generated",
        created_at: new Date().toISOString()
      });
    } catch (err: any) {
      clearInterval(interval);
      setViewMode("form");
      toast({
        title: "Generation failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    }
  }

  function handleCreateAnother() {
    setViewMode("form");
    setStep(0);
    setReferenceImages([]);
    setReferenceText("");
    setPostProfile("promo");
    setCopyText("");
    setUseLogo(false);
    setLogoPosition("bottom-right");
    setAspectRatio("1:1");
    setProgress(0);
    setProgressMessage("");
  }

  // handleDownload is no longer needed here as it's in the global Viewer

  function renderStepContent() {
    if (step === 0) {
      return (
        <div className="space-y-5">
          {/* Clear header */}
          <div className="space-y-2">
            <Label className="text-base font-medium">
              Guide the AI (Optional)
            </Label>
            <p className="text-sm text-muted-foreground">
              Upload reference images or describe what you want. This helps the AI understand your vision.
            </p>
          </div>

          {/* Image upload grid */}
          <div className="grid grid-cols-4 gap-3">
            {referenceImages.map((img) => (
              <div
                key={img.id}
                className="relative aspect-square rounded-lg border-2 border-border overflow-hidden group"
              >
                <img
                  src={img.preview}
                  alt="Reference"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRemoveImage(img.id)}
                    className="gap-1"
                  >
                    <X className="w-4 h-4" />
                    Remove
                  </Button>
                </div>
                <div className="absolute bottom-2 left-2 right-2 text-xs text-white bg-black/70 rounded px-2 py-1 truncate">
                  {img.file.name}
                </div>
              </div>
            ))}

            {referenceImages.length < 4 && (
              <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-violet-400/40 hover:bg-violet-400/5 transition-all">
                <ImagePlus className="w-8 h-8 text-muted-foreground mb-2" />
                <span className="text-sm font-medium">Add Reference</span>
                <span className="text-xs text-muted-foreground mt-1">Up to 5MB</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Text description - always visible */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Describe your vision</span>
              <VoiceInputButton
                onTranscription={(text) => setReferenceText(prev => prev ? `${prev} ${text}` : text)}
              />
            </div>
            <Textarea
              placeholder="Describe your vision: style, colors, mood, specific elements..."
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
              className="resize-none"
              rows={4}
              data-testid="input-reference"
            />
          </div>
        </div>
      );
    }

    if (step === 1) {
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {POST_STYLES.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setPostProfile(value)}
              className={`aspect-square p-2 rounded-xl border-2 flex flex-col items-center justify-center text-center transition-all ${postProfile === value
                ? "border-violet-400 bg-violet-400/8"
                : "border-border hover:border-violet-400/40"
                }`}
              data-testid={`style-${value}`}
            >
              <Icon
                className={`w-6 h-6 mb-1 ${postProfile === value ? "text-pink-400" : "text-muted-foreground"
                  }`}
              />
              <div className="font-medium text-xs">{label}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{description}</div>
            </button>
          ))}
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="space-y-4">
          {/* Toggle buttons for text/no text */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setUseText(true)}
              className={`p-4 rounded-xl border-2 text-center transition-all ${useText
                ? "border-violet-400 bg-violet-400/8"
                : "border-border hover:border-violet-400/40"
                }`}
            >
              <div className="font-medium text-sm">With Text</div>
              <div className="text-xs text-muted-foreground mt-1">Add headline & subtext</div>
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
              <div className="font-medium text-sm">No Text</div>
              <div className="text-xs text-muted-foreground mt-1">Image only</div>
            </button>
          </div>

          {useText && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Your text</span>
                  <VoiceInputButton
                    onTranscription={(text) => setCopyText(prev => prev ? `${prev} ${text}` : text)}
                  />
                </div>
                <Textarea
                  placeholder="Example: 'Big Sale Tomorrow! Don't miss out - 50% off everything.'"
                  value={copyText}
                  onChange={(e) => setCopyText(e.target.value)}
                  className="resize-none text-base"
                  rows={6}
                  data-testid="input-copy-text"
                />
              </div>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-400/5 border border-violet-400/20">
                <Info className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Leave empty if you want the AI to create the text based on your brand and reference material.
                </p>
              </div>
            </>
          )}
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="space-y-4">
          {/* Toggle buttons for logo/no logo */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setUseLogo(true)}
              className={`p-4 rounded-xl border-2 text-center transition-all ${useLogo
                ? "border-violet-400 bg-violet-400/8"
                : "border-border hover:border-violet-400/40"
                }`}
            >
              <div className="font-medium text-sm">Include Logo</div>
              <div className="text-xs text-muted-foreground mt-1">Add brand logo to post</div>
            </button>
            <button
              onClick={() => setUseLogo(false)}
              className={`p-4 rounded-xl border-2 text-center transition-all ${!useLogo
                ? "border-violet-400 bg-violet-400/8"
                : "border-border hover:border-violet-400/40"
                }`}
            >
              <div className="font-medium text-sm">No Logo</div>
              <div className="text-xs text-muted-foreground mt-1">Skip logo placement</div>
            </button>
          </div>

          {useLogo && (
            <div className="space-y-3">
              <Label className="text-sm text-muted-foreground">Select logo position</Label>
              <div className="grid grid-cols-3 gap-1.5 max-w-xs mx-auto">
                {LOGO_POSITIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setLogoPosition(value)}
                    className={`py-1.5 px-2 rounded border flex items-center justify-center text-[10px] font-medium transition-all ${logoPosition === value
                      ? "border-violet-400 bg-violet-400/8 text-violet-400"
                      : "border-border hover:border-violet-400/40 text-muted-foreground"
                      }`}
                    data-testid={`logo-position-${value}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-400/5 border border-violet-400/20">
                <Info className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Your brand logo will be placed in the selected position on the generated image.
                </p>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {FORMATS.map(({ value, label, subtitle, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setAspectRatio(value)}
            className={`p-4 rounded-xl border-2 text-center transition-all ${aspectRatio === value
              ? "border-violet-400 bg-violet-400/8"
              : "border-border hover:border-violet-400/40"
              }`}
            data-testid={`format-${value.replace(":", "x")}`}
          >
            <Icon
              className={`w-6 h-6 mx-auto mb-2 ${aspectRatio === value ? "text-pink-400" : "text-muted-foreground"
                }`}
            />
            <div className="font-medium text-sm">{label}</div>
            <div className="text-xs text-muted-foreground">{subtitle}</div>
            <div className="text-xs text-muted-foreground mt-1 font-mono">{value}</div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden" data-testid="dialog-post-creator">
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
                    <DialogTitle>{STEP_TITLES[step]}</DialogTitle>
                    <span className="text-xs text-muted-foreground">
                      Step {step + 1} of {TOTAL_STEPS}
                    </span>
                  </div>
                  <Progress value={((step + 1) / TOTAL_STEPS) * 100} className="h-2" />
                </div>
                <DialogDescription>
                  Complete one choice at a time to build your post.
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
                    Back
                  </Button>
                ) : (
                  <div />
                )}

                {step < TOTAL_STEPS - 1 ? (
                  <Button onClick={handleNextStep} data-testid="button-step-next">
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={handleGenerate} data-testid="button-generate">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Post
                  </Button>
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
              <div className="w-20 h-20 rounded-2xl bg-violet-400/15 flex items-center justify-center mb-6">
                <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Creating Your Post</h2>
              <p className="text-sm text-muted-foreground mb-6" data-testid="text-progress-message">
                {progressMessage}
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
    </Dialog>
  );
}
