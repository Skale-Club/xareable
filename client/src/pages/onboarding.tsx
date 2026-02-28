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
  { label: "Colors", icon: Palette },
  { label: "Mood", icon: Smile },
  { label: "Logo", icon: ImageIcon },
];

export default function OnboardingPage() {
  const { user, refreshBrand } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [color1, setColor1] = useState("#2563EB");
  const [color2, setColor2] = useState("#7C3AED");
  const [color3, setColor3] = useState("#F59E0B");
  const [mood, setMood] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

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
        return companyName.trim() && companyType.trim();
      case 1:
        return true;
      case 2:
        return !!mood;
      case 3:
        return true;
      default:
        return false;
    }
  }

  async function handleFinish() {
    setSaving(true);
    const sb = supabase();

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

    const { error } = await sb.from("brands").insert({
      user_id: user!.id,
      company_name: companyName.trim(),
      company_type: companyType.trim(),
      color_1: color1,
      color_2: color2,
      color_3: color3,
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
    setStep((s) => Math.min(s + 1, 3));
  }
  function goBack() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" data-testid="onboarding-page">
      <div className="w-full max-w-xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-6 h-6 text-primary-foreground" />
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
                className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
                data-testid={`step-indicator-${i}`}
              >
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`w-10 h-0.5 rounded-full transition-colors ${
                    i < step ? "bg-primary" : "bg-muted"
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
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg">Company Info</h2>
                        <p className="text-sm text-muted-foreground">
                          What's your business about?
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

                {step === 1 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Palette className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg">Brand Colors</h2>
                        <p className="text-sm text-muted-foreground">
                          Pick three colors that represent your brand.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: "Primary", value: color1, set: setColor1 },
                        { label: "Secondary", value: color2, set: setColor2 },
                        { label: "Accent", value: color3, set: setColor3 },
                      ].map(({ label, value, set }) => (
                        <div key={label} className="space-y-2 text-center">
                          <Label className="text-xs font-medium text-muted-foreground">
                            {label}
                          </Label>
                          <div className="relative mx-auto">
                            <div
                              className="w-16 h-16 rounded-xl mx-auto border-2 border-border cursor-pointer transition-transform"
                              style={{ backgroundColor: value }}
                              data-testid={`color-swatch-${label.toLowerCase()}`}
                            />
                            <input
                              type="color"
                              value={value}
                              onChange={(e) => set(e.target.value)}
                              className="absolute inset-0 w-16 h-16 mx-auto opacity-0 cursor-pointer"
                              data-testid={`input-color-${label.toLowerCase()}`}
                            />
                          </div>
                          <Input
                            value={value}
                            onChange={(e) => set(e.target.value)}
                            className="text-center text-xs font-mono"
                            maxLength={7}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-4 p-3 rounded-md bg-muted/50">
                      <div className="flex gap-1">
                        <div className="w-6 h-6 rounded" style={{ backgroundColor: color1 }} />
                        <div className="w-6 h-6 rounded" style={{ backgroundColor: color2 }} />
                        <div className="w-6 h-6 rounded" style={{ backgroundColor: color3 }} />
                      </div>
                      <span className="text-xs text-muted-foreground">Color preview</span>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Smile className="w-5 h-5 text-primary" />
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
                          className={`p-4 rounded-md border-2 text-left transition-all hover-elevate ${
                            mood === value
                              ? "border-primary bg-primary/5"
                              : "border-border"
                          }`}
                          data-testid={`mood-${value}`}
                        >
                          <Icon
                            className={`w-5 h-5 mb-2 ${
                              mood === value ? "text-primary" : "text-muted-foreground"
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

                {step === 3 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Upload className="w-5 h-5 text-primary" />
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

              {step < 3 ? (
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
                  disabled={saving}
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
