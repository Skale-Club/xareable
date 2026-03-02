import { useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  ArrowRight,
  ArrowLeft,
  Building2,
  Palette,
  Smile,
  Upload,
  Check,
  Sparkles,
  Briefcase,
  Zap,
  Minimize2,
  ImageIcon,
  Target,
  Key,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MOODS = [
  {
    value: "professional",
    label: "Professional",
    description: "Clean, corporate, trustworthy",
    icon: Briefcase,
  },
  {
    value: "playful",
    label: "Playful",
    description: "Fun, colorful, energetic",
    icon: Smile,
  },
  {
    value: "minimalist",
    label: "Minimalist",
    description: "Simple, elegant, refined",
    icon: Minimize2,
  },
  {
    value: "bold",
    label: "Bold",
    description: "Strong, impactful, daring",
    icon: Zap,
  },
];

const STEPS = [
  { label: "Company", icon: Building2 },
  { label: "Niche", icon: Target },
  { label: "Colors", icon: Palette },
  { label: "Mood", icon: Smile },
  { label: "Logo", icon: ImageIcon },
  { label: "API Key", icon: Key },
];

export default function OnboardingPage() {
  const { user, refreshBrand, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [colors, setColors] = useState<string[]>(["#000000", "#6B7280"]);
  const [mood, setMood] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const handleLogoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = () => setLogoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  function canAdvance() {
    switch (step) {
      case 0:
        return !!companyName.trim();
      case 1:
        return !!companyType.trim();
      case 2:
        return true;
      case 3:
        return !!mood;
      case 4:
        return true;
      case 5:
        return !!apiKey.trim();
      default:
        return false;
    }
  }

  async function handleFinish() {
    setSaving(true);
    const sb = supabase();

    // Save API key to profile
    const { error: keyError } = await sb
      .from("profiles")
      .update({ api_key: apiKey.trim() })
      .eq("id", user!.id);

    if (keyError) {
      toast({
        title: "Failed to save API key",
        description: keyError.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    // Upload logo if provided
    let logoUrl: string | null = null;
    if (logoFile && user) {
      const ext = logoFile.name.split(".").pop() || "png";
      const filePath = `${user.id}/logo.${ext}`;
      const { error: uploadError } = await sb.storage
        .from("user_assets")
        .upload(filePath, logoFile, { upsert: true });

      if (uploadError) {
        toast({
          title: "Logo upload failed",
          description: uploadError.message,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      const {
        data: { publicUrl },
      } = sb.storage.from("user_assets").getPublicUrl(filePath);
      logoUrl = publicUrl;
    }

    // Save brand
    const { error } = await sb.from("brands").insert({
      user_id: user!.id,
      company_name: companyName.trim(),
      company_type: companyType.trim(),
      color_1: colors[0],
      color_2: colors[1],
      color_3: colors[2] || null,
      color_4: colors[3] || null,
      mood,
      logo_url: logoUrl,
    });

    setSaving(false);

    if (error) {
      toast({
        title: "Failed to save brand",
        description: error.message,
        variant: "destructive",
      });
    } else {
      await refreshProfile();
      await refreshBrand();
      toast({ title: "Brand profile created!" });
    }
  }

  const slideVariants = {
    enter: (direction: number) => ({ x: direction > 0 ? 100 : -100, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({ x: direction > 0 ? -100 : 100, opacity: 0 }),
  };

  const [direction, setDirection] = useState(0);

  function goNext() {
    setDirection(1);
    setStep((s) => Math.min(s + 1, 5));
  }
  function goBack() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }

  const lastStep = STEPS.length - 1;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" data-testid="onboarding-page">
      <div className="w-full max-w-xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}>
            <Sparkles className="w-6 h-6 text-violet-800" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Set Up Your Brand</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Tell us about your brand so we can create content that matches your identity.
          </p>
        </motion.div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${i <= step
                  ? "text-white [background:linear-gradient(45deg,#8b5cf6,#f472b6,#fb923c)]"
                  : "bg-muted text-muted-foreground"
                  }`}
                data-testid={`step-indicator-${i}`}
              >
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`w-6 h-0.5 rounded-full transition-all ${i < step ? "[background:linear-gradient(45deg,#8b5cf6,#f472b6,#fb923c)]" : "bg-muted"
                    }`}
                />
              )}
            </div>
          ))}
        </div>

        <Card>
          <CardContent className="p-6 min-h-[320px] flex flex-col">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="flex-1"
              >
                {step === 0 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-violet-400/15 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-pink-400" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg">Company Name</h2>
                        <p className="text-sm text-muted-foreground">
                          What's your company called?
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="company-name">Company Name</Label>
                      <Input
                        id="company-name"
                        placeholder="e.g., Acme Inc."
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        data-testid="input-company-name"
                      />
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-violet-400/15 flex items-center justify-center">
                        <Target className="w-5 h-5 text-pink-400" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg">Industry / Niche</h2>
                        <p className="text-sm text-muted-foreground">
                          What does your business do?
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="company-type">Industry / Niche</Label>
                      <Input
                        id="company-type"
                        placeholder="e.g., E-commerce, SaaS, Restaurant"
                        value={companyType}
                        onChange={(e) => setCompanyType(e.target.value)}
                        data-testid="input-company-type"
                      />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-violet-400/15 flex items-center justify-center">
                        <Palette className="w-5 h-5 text-pink-400" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg">Brand Colors</h2>
                        <p className="text-sm text-muted-foreground">
                          Pick 2-4 colors that represent your brand.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 justify-center">
                      {colors.map((color, index) => (
                        <div key={index} className="space-y-2 text-center">
                          <Label className="text-xs font-medium text-muted-foreground">
                            {index === 0 ? "Primary" : index === 1 ? "Secondary" : `Color ${index + 1}`}
                          </Label>
                          <div className="relative mx-auto h-24 w-24">
                            <div
                              className="h-full w-full shrink-0 rounded-md border-2 border-border cursor-pointer transition-transform"
                              style={{ backgroundColor: color }}
                              data-testid={`color-swatch-${index}`}
                            />
                            {colors.length > 2 && (
                              <button
                                type="button"
                                className="absolute right-1 top-1 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/95 shadow-sm"
                                onClick={() => {
                                  setColors(colors.filter((_, i) => i !== index));
                                }}
                                data-testid={`remove-color-${index}`}
                              >
                                <span className="text-sm leading-none">x</span>
                              </button>
                            )}
                            <input
                              type="color"
                              value={color}
                              onChange={(e) => {
                                const newColors = [...colors];
                                newColors[index] = e.target.value;
                                setColors(newColors);
                              }}
                              className="absolute inset-0 z-10 h-full w-full opacity-0 cursor-pointer"
                              data-testid={`input-color-${index}`}
                            />
                          </div>
                          <div>
                            <Input
                              value={color}
                              onChange={(e) => {
                                const newColors = [...colors];
                                newColors[index] = e.target.value;
                                setColors(newColors);
                              }}
                              className="text-center text-xs font-mono w-24"
                              maxLength={7}
                            />
                          </div>
                        </div>
                      ))}
                      {colors.length < 4 && (
                        <div className="space-y-2 text-center">
                          <Label className="text-xs font-medium text-muted-foreground">Add</Label>
                          <button
                            type="button"
                            onClick={() => setColors([...colors, "#9CA3AF"])}
                            className="h-24 w-24 rounded-md mx-auto border-2 border-dashed border-border flex items-center justify-center hover:bg-muted/50 transition-colors"
                            data-testid="add-color-button"
                          >
                            <span className="text-2xl text-muted-foreground">+</span>
                          </button>
                          <div className="w-24" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-4 p-3 rounded-md bg-muted/50">
                      <div className="flex gap-1">
                        {colors.map((color, index) => (
                          <div key={index} className="w-6 h-6 rounded" style={{ backgroundColor: color }} />
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">Color preview</span>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-violet-400/15 flex items-center justify-center">
                        <Smile className="w-5 h-5 text-pink-400" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg">Brand Mood</h2>
                        <p className="text-sm text-muted-foreground">
                          How should your content feel?
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {MOODS.map(({ value, label, description, icon: Icon }) => (
                        <button
                          key={value}
                          onClick={() => setMood(value)}
                          className={`p-4 rounded-md border-2 text-left transition-all hover-elevate ${mood === value
                            ? "border-violet-400 bg-violet-400/8"
                            : "border-border"
                            }`}
                          data-testid={`mood-${value}`}
                        >
                          <Icon
                            className={`w-5 h-5 mb-2 ${mood === value ? "text-pink-400" : "text-muted-foreground"
                              }`}
                          />
                          <div className="font-medium text-sm">{label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-violet-400/15 flex items-center justify-center">
                        <Upload className="w-5 h-5 text-pink-400" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg">Upload Logo</h2>
                        <p className="text-sm text-muted-foreground">
                          Optional: Add your company logo.
                        </p>
                      </div>
                    </div>

                    {logoPreview ? (
                      <div className="text-center space-y-3">
                        <div className="w-32 h-32 mx-auto rounded-xl border-2 border-border bg-muted/50 flex items-center justify-center overflow-hidden">
                          <img
                            src={logoPreview}
                            alt="Logo preview"
                            className="max-w-full max-h-full object-contain"
                            data-testid="img-logo-preview"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setLogoFile(null);
                            setLogoPreview(null);
                          }}
                          data-testid="button-remove-logo"
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <label
                        className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-border rounded-md cursor-pointer hover-elevate transition-colors"
                        data-testid="upload-logo-zone"
                      >
                        <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                        <span className="text-sm font-medium">Click to upload</span>
                        <span className="text-xs text-muted-foreground mt-1">
                          PNG, JPG, SVG up to 5MB
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoSelect}
                          className="hidden"
                          data-testid="input-logo-file"
                        />
                      </label>
                    )}
                  </div>
                )}

                {step === 5 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-violet-400/15 flex items-center justify-center">
                        <Key className="w-5 h-5 text-pink-400" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg">Google Gemini API Key</h2>
                        <p className="text-sm text-muted-foreground">
                          Required for AI-powered content generation.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="api-key">API Key</Label>
                      <div className="relative">
                        <Input
                          id="api-key"
                          type={showKey ? "text" : "password"}
                          placeholder="AIza..."
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          className="pr-10"
                          data-testid="input-api-key"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full"
                          onClick={() => setShowKey(!showKey)}
                          data-testid="button-toggle-key"
                        >
                          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-violet-400"
                      data-testid="link-get-key"
                    >
                      Get your API key from Google AI Studio
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <Button
                variant="outline"
                onClick={goBack}
                disabled={step === 0}
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>

              {step < lastStep ? (
                <Button
                  onClick={goNext}
                  disabled={!canAdvance()}
                  data-testid="button-next"
                >
                  Next
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button
                  onClick={handleFinish}
                  disabled={saving || !canAdvance()}
                  data-testid="button-finish"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Complete Setup
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
