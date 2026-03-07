import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DEFAULT_STYLE_CATALOG, type StyleCatalog } from "@shared/schema";
import { trackLeadEvent } from "@/lib/marketing";

const STEPS = [
  { label: "Company", icon: Building2 },
  { label: "Niche", icon: Target },
  { label: "Colors", icon: Palette },
  { label: "Style", icon: Smile },
  { label: "Logo", icon: ImageIcon },
];

const STYLE_ICONS: Record<string, React.ElementType> = {
  professional: Briefcase,
  playful: Smile,
  minimalist: Minimize2,
  bold: Zap,
};

export default function OnboardingPage() {
  const { user, refreshBrand, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [colors, setColors] = useState<string[]>(["#000000", "#6B7280"]);
  const [brandStyle, setBrandStyle] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const { data: styleCatalog } = useQuery<StyleCatalog>({
    queryKey: ["/api/style-catalog"],
  });
  const styles = styleCatalog?.styles || DEFAULT_STYLE_CATALOG.styles;

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
        return !!brandStyle;
      case 4:
        return true;
      default:
        return false;
    }
  }

  async function handleFinish() {
    setSaving(true);
    const sb = supabase();

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
          title: t("Logo upload failed"),
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
      mood: brandStyle,
      logo_url: logoUrl,
    });

    setSaving(false);

    if (error) {
      toast({
        title: t("Failed to save brand"),
        description: error.message,
        variant: "destructive",
      });
    } else {
      await refreshProfile();
      await refreshBrand();
      toast({ title: t("Brand profile created!") });
      void trackLeadEvent({
        content_name: companyName.trim() || "Brand Setup",
        content_category: "Onboarding",
        full_name: typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : undefined,
        company_name: companyName.trim(),
        company_type: companyType.trim(),
        answers: {
          company_name: companyName.trim(),
          company_type: companyType.trim(),
          industry: companyType.trim(),
          niche: companyType.trim(),
          mood: brandStyle,
          brand_style: brandStyle,
          color_1: colors[0] || "",
          color_2: colors[1] || "",
          color_3: colors[2] || "",
          color_4: colors[3] || "",
          logo_url: logoUrl || "",
        },
      });
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
    setStep((s) => Math.min(s + 1, 4));
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
          <h1 className="text-2xl font-bold tracking-tight">{t("Set Up Your Brand")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("Tell us about your brand so we can create content that matches your identity.")}
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
                        <h2 className="font-semibold text-lg">{t("Company Name")}</h2>
                        <p className="text-sm text-muted-foreground">
                          {t("What's your company called?")}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="company-name">{t("Company Name")}</Label>
                      <Input
                        id="company-name"
                        placeholder={t("e.g., Acme Inc.")}
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
                        <h2 className="font-semibold text-lg">{t("Industry / Niche")}</h2>
                        <p className="text-sm text-muted-foreground">
                          {t("What does your business do?")}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="company-type">{t("Industry / Niche")}</Label>
                      <Input
                        id="company-type"
                        placeholder={t("e.g., E-commerce, SaaS, Restaurant")}
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
                        <h2 className="font-semibold text-lg">{t("Brand Colors")}</h2>
                        <p className="text-sm text-muted-foreground">
                          {t("Pick 2-4 colors that represent your brand.")}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 justify-center">
                      {colors.map((color, index) => (
                        <div key={index} className="space-y-2 text-center">
                          <Label className="text-xs font-medium text-muted-foreground">
                            {index === 0 ? t("Primary") : index === 1 ? t("Secondary") : `${t("Color")} ${index + 1}`}
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
                          <Label className="text-xs font-medium text-muted-foreground">{t("Add")}</Label>
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
                      <span className="text-xs text-muted-foreground">{t("Color preview")}</span>
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
                        <h2 className="font-semibold text-lg">{t("Brand Style")}</h2>
                        <p className="text-sm text-muted-foreground">
                          {t("What is your business style?")}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {styles.map(({ id, label, description }) => (
                        <div
                          key={id}
                          className={`flex flex-col gap-1.5 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${brandStyle === id
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border/50 bg-card hover:border-primary/30 hover:bg-muted/30"
                            }`}
                          onClick={() => setBrandStyle(id)}
                          data-testid={`style-${id}`}
                        >
                          <span className="font-semibold text-sm">{t(label)}</span>
                          <span className="text-xs text-muted-foreground leading-relaxed">{t(description)}</span>
                        </div>
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
                        <h2 className="font-semibold text-lg">{t("Upload Logo")}</h2>
                        <p className="text-sm text-muted-foreground">
                          {t("Optional: Add your company logo.")}
                        </p>
                      </div>
                    </div>

                    {logoPreview ? (
                      <div className="text-center space-y-3">
                        <div className="w-32 h-32 mx-auto rounded-xl border-2 border-border bg-muted/50 flex items-center justify-center overflow-hidden">
                          <img
                            src={logoPreview}
                            alt={t("Logo preview")}
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
                          {t("Remove")}
                        </Button>
                      </div>
                    ) : (
                      <label
                        className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-border rounded-md cursor-pointer hover-elevate transition-colors"
                        data-testid="upload-logo-zone"
                      >
                        <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                        <span className="text-sm font-medium">{t("Click to upload")}</span>
                        <span className="text-xs text-muted-foreground mt-1">
                          {t("PNG, JPG, SVG up to 5MB")}
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
                {t("Back")}
              </Button>

              {step < lastStep ? (
                <Button
                  onClick={goNext}
                  disabled={!canAdvance()}
                  data-testid="button-next"
                >
                  {t("Next")}
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
                  {t("Complete Setup")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
