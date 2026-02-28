import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Sparkles,
  Download,
  Plus,
  Square,
  RectangleHorizontal,
  RectangleVertical,
  Megaphone,
  Info,
  Droplets,
  Flame,
  ImageIcon,
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
  {
    value: "1:1",
    label: "Square",
    subtitle: "Feed Post",
    icon: Square,
    aspectClass: "aspect-square w-12",
  },
  {
    value: "16:9",
    label: "Banner",
    subtitle: "Cover Image",
    icon: RectangleHorizontal,
    aspectClass: "aspect-video w-16",
  },
  {
    value: "9:16",
    label: "Portrait",
    subtitle: "Stories / Reels",
    icon: RectangleVertical,
    aspectClass: "aspect-[9/16] w-8",
  },
];

type ViewMode = "form" | "generating" | "result";

export default function DashboardPage() {
  const { brand } = useAuth();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>("form");
  const [useReference, setUseReference] = useState(false);
  const [referenceText, setReferenceText] = useState("");
  const [postProfile, setPostProfile] = useState("promo");
  const [copyText, setCopyText] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);

  async function handleGenerate() {
    if (!copyText.trim()) {
      toast({ title: "Please enter your text", variant: "destructive" });
      return;
    }

    setViewMode("generating");
    setProgress(0);
    setProgressMessage("Analyzing your brand context...");

    const interval = setInterval(() => {
      setProgress((p) => {
        if (p < 30) {
          setProgressMessage("Analyzing your brand context...");
          return p + 2;
        } else if (p < 60) {
          setProgressMessage("Crafting the perfect design prompt...");
          return p + 1.5;
        } else if (p < 85) {
          setProgressMessage("Generating your image...");
          return p + 0.8;
        } else if (p < 95) {
          setProgressMessage("Finishing touches...");
          return p + 0.3;
        }
        return p;
      });
    }, 300);

    try {
      const res = await apiRequest("POST", "/api/generate", {
        reference_text: useReference ? referenceText : undefined,
        post_profile: postProfile,
        copy_text: copyText.trim(),
        aspect_ratio: aspectRatio,
      });
      const data: GenerateResponse = await res.json();
      clearInterval(interval);
      setProgress(100);
      setProgressMessage("Done!");
      setTimeout(() => {
        setResult(data);
        setViewMode("result");
      }, 500);
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
    setCopyText("");
    setReferenceText("");
    setUseReference(false);
    setResult(null);
    setProgress(0);
  }

  async function handleDownload() {
    if (!result?.image_url) return;
    try {
      const response = await fetch(result.image_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `social-post-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(result.image_url, "_blank");
    }
  }

  return (
    <div className="flex-1 overflow-auto" data-testid="dashboard-page">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">
            Create New Post
          </h1>
          <p className="text-muted-foreground mt-1">
            Generate AI-powered social media content for{" "}
            <span className="font-medium text-foreground">{brand?.company_name}</span>.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {viewMode === "form" && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-muted-foreground" />
                    Reference Material
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="reference-toggle" className="text-sm">
                      Include a visual reference or description?
                    </Label>
                    <Switch
                      id="reference-toggle"
                      checked={useReference}
                      onCheckedChange={setUseReference}
                      data-testid="switch-reference"
                    />
                  </div>
                  {useReference && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                    >
                      <Textarea
                        placeholder="Describe the visual style you're going for, or any specific elements you want included..."
                        value={referenceText}
                        onChange={(e) => setReferenceText(e.target.value)}
                        className="resize-none"
                        rows={3}
                        data-testid="input-reference"
                      />
                    </motion.div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Post Style</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {POST_STYLES.map(({ value, label, description, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setPostProfile(value)}
                        className={`p-3 rounded-md border-2 text-left transition-all hover-elevate ${
                          postProfile === value
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                        data-testid={`style-${value}`}
                      >
                        <Icon
                          className={`w-5 h-5 mb-1.5 ${
                            postProfile === value ? "text-primary" : "text-muted-foreground"
                          }`}
                        />
                        <div className="font-medium text-sm">{label}</div>
                        <div className="text-xs text-muted-foreground">{description}</div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Text on Image</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="Type what you want on the design, e.g., 'Big Sale Tomorrow! Don't miss out — 50% off everything.'"
                    value={copyText}
                    onChange={(e) => setCopyText(e.target.value)}
                    className="resize-none text-base"
                    rows={4}
                    data-testid="input-copy-text"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    The AI will split this into a headline and subtext automatically.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Format / Size</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-3">
                    {FORMATS.map(({ value, label, subtitle, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setAspectRatio(value)}
                        className={`p-4 rounded-md border-2 text-center transition-all hover-elevate ${
                          aspectRatio === value
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                        data-testid={`format-${value.replace(":", "x")}`}
                      >
                        <Icon
                          className={`w-6 h-6 mx-auto mb-2 ${
                            aspectRatio === value ? "text-primary" : "text-muted-foreground"
                          }`}
                        />
                        <div className="font-medium text-sm">{label}</div>
                        <div className="text-xs text-muted-foreground">{subtitle}</div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Button
                onClick={handleGenerate}
                className="w-full"
                size="lg"
                disabled={!copyText.trim()}
                data-testid="button-generate"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Post
              </Button>
            </motion.div>
          )}

          {viewMode === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
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

          {viewMode === "result" && result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5"
            >
              <Card>
                <CardContent className="p-4">
                  <div className="rounded-md overflow-hidden bg-muted/50">
                    <img
                      src={result.image_url}
                      alt="Generated social media post"
                      className="w-full h-auto"
                      data-testid="img-generated-post"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Caption</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="text-caption">
                    {result.caption}
                  </p>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleCreateAnother}
                  data-testid="button-create-another"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Another
                </Button>
                <Button
                  size="lg"
                  onClick={handleDownload}
                  data-testid="button-download"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
