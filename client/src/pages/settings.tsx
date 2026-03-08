import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Loader2, Check, Palette, Upload, ImageIcon, X, Building2, Key, Star, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { DEFAULT_STYLE_CATALOG, type StyleCatalog } from "@shared/schema";

function isValidHex(val: string) {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(val);
}

export default function SettingsPage() {
  const { user, brand, profile, refreshProfile, refreshBrand } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [colors, setColors] = useState<string[]>([
    brand?.color_1 || "#000000",
    brand?.color_2 || "#6B7280",
  ]);
  const [savingColors, setSavingColors] = useState(false);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [savingLogo, setSavingLogo] = useState(false);

  const [companyName, setCompanyName] = useState(brand?.company_name || "");
  const [companyType, setCompanyType] = useState(brand?.company_type || "");
  const [brandStyle, setBrandStyle] = useState(brand?.mood || "");
  const [savingBrandInfo, setSavingBrandInfo] = useState(false);

  const [affiliateApiKey, setAffiliateApiKey] = useState(profile?.api_key || "");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const { data: styleCatalog } = useQuery<StyleCatalog>({
    queryKey: ["/api/style-catalog"],
  });
  const styles = styleCatalog?.styles || DEFAULT_STYLE_CATALOG.styles;
  const selectedStyleOption = styles.find((item) => item.id === brandStyle);
  const authProviders = Array.from(
    new Set(
      [
        ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : []),
        user?.app_metadata?.provider,
      ]
        .map((provider) => String(provider || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const hasPasswordProvider = authProviders.includes("email");

  useEffect(() => {
    if (brand) {
      const brandColors = [brand.color_1, brand.color_2];
      if (brand.color_3) brandColors.push(brand.color_3);
      if (brand.color_4) brandColors.push(brand.color_4);
      setColors(brandColors);
      setCompanyName(brand.company_name);
      setCompanyType(brand.company_type);
      setBrandStyle(brand.mood);
    }
  }, [brand]);

  const handleLogoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = () => setLogoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  async function handleSaveLogo() {
    if (!brand || !logoFile || !user) return;
    setSavingLogo(true);
    const sb = supabase();
    const ext = logoFile.name.split(".").pop() || "png";
    const filePath = `${user.id}/logo.${ext}`;
    const { error: uploadError } = await sb.storage
      .from("user_assets")
      .upload(filePath, logoFile, { upsert: true });

    if (uploadError) {
      toast({ title: t("Upload failed"), description: uploadError.message, variant: "destructive" });
      setSavingLogo(false);
      return;
    }

    const {
      data: { publicUrl },
    } = sb.storage.from("user_assets").getPublicUrl(filePath);
    const { error } = await sb.from("brands").update({ logo_url: publicUrl }).eq("id", brand.id);
    setSavingLogo(false);

    if (error) {
      toast({ title: t("Failed to save logo"), description: error.message, variant: "destructive" });
    } else {
      await refreshBrand();
      setLogoFile(null);
      setLogoPreview(null);
      toast({ title: t("Logo updated successfully") });
    }
  }

  async function handleSaveColors() {
    if (!brand) return;
    if (colors.some((c) => !isValidHex(c))) {
      toast({
        title: t("Invalid hex color"),
        description: t("Colors must be in #RRGGBB or #RGB format."),
        variant: "destructive",
      });
      return;
    }

    setSavingColors(true);
    const sb = supabase();
    const { error } = await sb
      .from("brands")
      .update({
        color_1: colors[0],
        color_2: colors[1],
        color_3: colors[2] || null,
        color_4: colors[3] || null,
      })
      .eq("id", brand.id);
    setSavingColors(false);

    if (error) {
      toast({ title: t("Failed to save colors"), description: error.message, variant: "destructive" });
    } else {
      await refreshBrand();
      toast({ title: t("Brand colors updated") });
    }
  }

  async function handleSaveBrandInfo() {
    if (!brand) return;
    if (!companyName.trim() || !companyType.trim() || !brandStyle.trim()) {
      toast({ title: t("All fields are required"), variant: "destructive" });
      return;
    }

    setSavingBrandInfo(true);
    const sb = supabase();
    const { error } = await sb
      .from("brands")
      .update({
        company_name: companyName.trim(),
        company_type: companyType.trim(),
        mood: brandStyle.trim(),
      })
      .eq("id", brand.id);
    setSavingBrandInfo(false);

    if (error) {
      toast({ title: t("Failed to save brand info"), description: error.message, variant: "destructive" });
    } else {
      await refreshBrand();
      toast({ title: t("Brand information updated") });
    }
  }

  function handleHexInput(val: string, index: number) {
    const trimmed = val.startsWith("#") ? val : `#${val}`;
    const newColors = [...colors];
    newColors[index] = trimmed;
    setColors(newColors);
  }

  async function handleSaveApiKey() {
    if (!user) return;
    const key = affiliateApiKey.trim();
    if (!key) {
      toast({ title: t("API Key cannot be empty"), variant: "destructive" });
      return;
    }

    setSavingApiKey(true);
    const sb = supabase();
    const { error } = await sb.from("profiles").update({ api_key: key }).eq("id", user.id);
    setSavingApiKey(false);

    if (error) {
      toast({ title: t("Failed to save API Key"), description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({ title: t("Gemini API Key saved successfully") });
    }
  }

  async function handleSetPassword() {
    if (!newPassword || !confirmPassword) {
      toast({ title: t("Please fill in all fields"), variant: "destructive" });
      return;
    }

    if (newPassword.length < 6) {
      toast({ title: t("Password must be at least 6 characters"), variant: "destructive" });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({ title: t("Passwords do not match"), variant: "destructive" });
      return;
    }

    const sb = supabase();
    setSavingPassword(true);
    const { error } = await sb.auth.updateUser({ password: newPassword });
    setSavingPassword(false);

    if (error) {
      toast({ title: t("Failed to update password"), description: error.message, variant: "destructive" });
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    toast({
      title: t("Password updated"),
      description: t("You can now sign in using email and password."),
    });
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">
              {t("Settings")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("Manage your account settings and brand configuration.")}
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                {t("Account Security")}
              </CardTitle>
              <CardDescription>
                {hasPasswordProvider
                  ? t("Change your password to keep your account secure.")
                  : t("Set a password to sign in with email/password in addition to social login.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
                <p className="font-medium">{t("Email")}: {user?.email || "-"}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("Login methods")}: {authProviders.length ? authProviders.join(", ") : t("Unknown")}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="new-password">{t("New password")}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("At least 6 characters")}
                    data-testid="input-settings-new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">{t("Confirm password")}</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("Repeat your password")}
                    onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
                    data-testid="input-settings-confirm-password"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSetPassword}
                  disabled={savingPassword}
                  data-testid="button-settings-save-password"
                >
                  {savingPassword ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 mr-2" />
                  )}
                  {hasPasswordProvider ? t("Update Password") : t("Set Password")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {profile?.is_affiliate && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-400" />
                  {t("Gemini API Key (Affiliate)")}
                </CardTitle>
                <CardDescription>
                  {t("As an affiliate, you use your own Google Gemini API key. Your generations do not cost the platform.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="affiliate-api-key">{t("Gemini API Key")}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="affiliate-api-key"
                      type={showApiKey ? "text" : "password"}
                      value={affiliateApiKey}
                      onChange={(e) => setAffiliateApiKey(e.target.value)}
                      placeholder="AIza..."
                      className="font-mono"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="shrink-0"
                    >
                      <Key className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("Get your key at")}{" "}
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      aistudio.google.com
                    </a>
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleSaveApiKey} disabled={savingApiKey}>
                    {savingApiKey ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-2" />
                    )}
                    {t("Save API Key")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="info" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="info" className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                {t("Info")}
              </TabsTrigger>
              <TabsTrigger value="colors" className="flex items-center gap-2">
                <Palette className="w-4 h-4" />
                {t("Colors")}
              </TabsTrigger>
              <TabsTrigger value="logo" className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                {t("Logo")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="mt-6">
              {brand ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{t("Company Information")}</CardTitle>
                    <CardDescription>
                      {t("Your company details used in AI-generated content")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="company-name">{t("Company Name")}</Label>
                      <Input
                        id="company-name"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder={t("e.g., Acme Inc")}
                        data-testid="input-company-name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="company-type">{t("Industry / Type")}</Label>
                      <Input
                        id="company-type"
                        value={companyType}
                        onChange={(e) => setCompanyType(e.target.value)}
                        placeholder={t("e.g., Tech Startup, Fashion Brand, Restaurant")}
                        data-testid="input-company-type"
                      />
                    </div>

                    <div className="space-y-3">
                      <Label>{t("Style")}</Label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {styles.map(({ id, label, description }) => (
                          <div
                            key={id}
                            className={`flex flex-col gap-1.5 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${brandStyle === id
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border/50 bg-card hover:border-primary/30 hover:bg-muted/30"
                              }`}
                            onClick={() => setBrandStyle(id)}
                            data-testid={`brand-style-card-${id}`}
                          >
                            <span className="font-semibold text-sm">{t(label)}</span>
                            <span className="text-xs text-muted-foreground leading-relaxed">{t(description)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={handleSaveBrandInfo}
                        disabled={savingBrandInfo || !companyName.trim() || !companyType.trim() || !brandStyle.trim()}
                        data-testid="button-save-brand-info"
                      >
                        {savingBrandInfo ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4 mr-2" />
                        )}
                        {t("Save Info")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    {t("No brand configured. Please complete onboarding first.")}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="colors" className="mt-6">
              {brand ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{t("Colors")}</CardTitle>
                    <CardDescription>
                      {t("Colors used in your AI-generated posts (2-4 colors)")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex flex-row gap-6 items-end">
                      {colors.map((color, index) => (
                        <div key={index} className="flex flex-col gap-2 w-20">
                          <Label className="text-xs font-medium text-muted-foreground">
                            {index === 0 ? t("Primary") : index === 1 ? t("Secondary") : `${t("Color")} ${index + 1}`}
                          </Label>
                          <div className="relative">
                            <ColorPicker
                              value={isValidHex(color) ? color : "#888888"}
                              onChange={(newColor) => {
                                const newColors = [...colors];
                                newColors[index] = newColor;
                                setColors(newColors);
                              }}
                              placeholder="#000000"
                              showHexInput={false}
                              buttonClassName="w-20 h-20"
                              data-testid={`color-picker-${index}`}
                            />
                            {colors.length > 2 && (
                              <button
                                type="button"
                                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background/95 shadow-sm hover:bg-muted transition-colors z-10"
                                onClick={() => setColors(colors.filter((_, i) => i !== index))}
                                data-testid={`remove-color-${index}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {colors.length < 4 && (
                        <div className="flex flex-col gap-2 w-20">
                          <Label className="text-xs font-medium text-muted-foreground">{t("Add")}</Label>
                          <button
                            type="button"
                            onClick={() => setColors([...colors, "#9CA3AF"])}
                            className="h-20 w-20 rounded-md border-2 border-dashed border-border flex items-center justify-center hover:bg-muted/50 transition-colors"
                            data-testid="add-color-button"
                          >
                            <span className="text-xl text-muted-foreground">+</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{t("Preview")}:</span>
                        <div className="flex gap-1.5">
                          {colors.map((color, index) => (
                            <div
                              key={index}
                              className="w-6 h-6 rounded-sm border border-border"
                              style={{ backgroundColor: isValidHex(color) ? color : "#888888" }}
                              title={`${t("Color")} ${index + 1}`}
                              data-testid={`preview-color-${index}`}
                            />
                          ))}
                        </div>
                      </div>
                      <Button
                        onClick={handleSaveColors}
                        disabled={savingColors}
                        data-testid="button-save-colors"
                      >
                        {savingColors ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4 mr-2" />
                        )}
                        {t("Save Colors")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    {t("No brand configured. Please complete onboarding first.")}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="logo" className="mt-6">
              {brand ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{t("Logo")}</CardTitle>
                    <CardDescription>
                      {t("Your logo used in AI-generated posts")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <Label className="text-xs font-medium text-muted-foreground block">{t("Current Logo")}</Label>
                      <div className="relative group w-32 h-32 rounded-xl border-2 border-border bg-muted/40 flex items-center justify-center overflow-hidden">
                        {logoPreview ? (
                          <img src={logoPreview} alt={t("New logo preview")} className="max-w-full max-h-full object-contain" data-testid="img-logo-new-preview" />
                        ) : brand.logo_url ? (
                          <img src={brand.logo_url} alt={t("Brand logo")} className="max-w-full max-h-full object-contain" data-testid="img-logo-current" />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
                        )}

                        {(logoPreview || brand.logo_url) && (
                          <button
                            type="button"
                            onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                            className="absolute top-2 right-2 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/95 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid="button-remove-logo"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <label className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                          <Upload className="w-5 h-5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground px-2 text-center">
                            {logoFile ? logoFile.name : t("PNG, JPG, SVG up to 5MB")}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleLogoSelect}
                            className="hidden"
                            data-testid="input-logo-file-settings"
                          />
                        </label>
                      </div>

                      {logoFile && (
                        <Button
                          onClick={handleSaveLogo}
                          disabled={savingLogo}
                          data-testid="button-save-logo"
                        >
                          {savingLogo ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4 mr-2" />
                          )}
                          {t("Save Logo")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    {t("No brand configured. Please complete onboarding first.")}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}
