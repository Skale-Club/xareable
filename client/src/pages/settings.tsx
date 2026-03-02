import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Key, ExternalLink, Eye, EyeOff, Check, Shield, Palette, Upload, ImageIcon, X, Building2, Briefcase, Smile, Minimize2, Zap } from "lucide-react";
import { useCallback } from "react";
import { motion } from "framer-motion";

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

function isValidHex(val: string) {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(val);
}

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.length === 3 ? c[0] + c[0] : c.slice(0, 2), 16);
  const g = parseInt(c.length === 3 ? c[1] + c[1] : c.slice(2, 4), 16);
  const b = parseInt(c.length === 3 ? c[2] + c[2] : c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

export default function SettingsPage() {
  const { profile, user, brand, refreshProfile, refreshBrand } = useAuth();
  const [apiKey, setApiKey] = useState(profile?.api_key || "");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

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
  const [mood, setMood] = useState(brand?.mood || "");
  const [savingBrandInfo, setSavingBrandInfo] = useState(false);

  useEffect(() => {
    if (brand) {
      const brandColors = [brand.color_1, brand.color_2];
      if (brand.color_3) brandColors.push(brand.color_3);
      if (brand.color_4) brandColors.push(brand.color_4);
      setColors(brandColors);
      setCompanyName(brand.company_name);
      setCompanyType(brand.company_type);
      setMood(brand.mood);
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
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setSavingLogo(false);
      return;
    }

    const { data: { publicUrl } } = sb.storage.from("user_assets").getPublicUrl(filePath);
    const { error } = await sb.from("brands").update({ logo_url: publicUrl }).eq("id", brand.id);
    setSavingLogo(false);

    if (error) {
      toast({ title: "Failed to save logo", description: error.message, variant: "destructive" });
    } else {
      await refreshBrand();
      setLogoFile(null);
      setLogoPreview(null);
      toast({ title: "Logo updated successfully" });
    }
  }

  async function handleSave() {
    if (!apiKey.trim()) {
      toast({ title: "Please enter your API key", variant: "destructive" });
      return;
    }
    setSaving(true);
    const sb = supabase();
    const { error } = await sb
      .from("profiles")
      .update({ api_key: apiKey.trim() })
      .eq("id", user!.id);
    setSaving(false);

    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({ title: "API key saved successfully" });
    }
  }

  async function handleSaveColors() {
    if (!brand) return;
    if (colors.some(c => !isValidHex(c))) {
      toast({ title: "Invalid hex color", description: "Colors must be in #RRGGBB or #RGB format.", variant: "destructive" });
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
      toast({ title: "Failed to save colors", description: error.message, variant: "destructive" });
    } else {
      await refreshBrand();
      toast({ title: "Brand colors updated" });
    }
  }

  async function handleSaveBrandInfo() {
    if (!brand) return;
    if (!companyName.trim() || !companyType.trim() || !mood.trim()) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    setSavingBrandInfo(true);
    const sb = supabase();
    const { error } = await sb
      .from("brands")
      .update({
        company_name: companyName.trim(),
        company_type: companyType.trim(),
        mood: mood.trim(),
      })
      .eq("id", brand.id);
    setSavingBrandInfo(false);

    if (error) {
      toast({ title: "Failed to save brand info", description: error.message, variant: "destructive" });
    } else {
      await refreshBrand();
      toast({ title: "Brand information updated" });
    }
  }

  function handleHexInput(val: string, index: number) {
    const trimmed = val.startsWith("#") ? val : `#${val}`;
    const newColors = [...colors];
    newColors[index] = trimmed;
    setColors(newColors);
  }

  const isFirstTime = !profile?.api_key;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {isFirstTime && (
            <div className="rounded-md bg-violet-400/10 border border-violet-400/20 p-4">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-pink-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-sm">Setup Required</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    To generate AI content, you need to add your Google Gemini API key first.
                    Your key is stored securely and only used to make API calls on your behalf.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">
              Settings
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage your account settings and brand configuration.
            </p>
          </div>

          <Tabs defaultValue="info" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="info" className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Info
              </TabsTrigger>
              <TabsTrigger value="colors" className="flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Colors
              </TabsTrigger>
              <TabsTrigger value="logo" className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Logo
              </TabsTrigger>
              <TabsTrigger value="api" className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                API Key
              </TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="mt-6">
              {brand ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Company Information</CardTitle>
                    <CardDescription>
                      Your company details used in AI-generated content
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="company-name">Company Name</Label>
                      <Input
                        id="company-name"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="e.g., Acme Inc"
                        data-testid="input-company-name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="company-type">Industry / Type</Label>
                      <Input
                        id="company-type"
                        value={companyType}
                        onChange={(e) => setCompanyType(e.target.value)}
                        placeholder="e.g., Tech Startup, Fashion Brand, Restaurant"
                        data-testid="input-company-type"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mood">Mood</Label>
                      <Select value={mood} onValueChange={setMood}>
                        <SelectTrigger id="mood" data-testid="select-mood" className="h-auto py-2.5">
                          <SelectValue placeholder="Select a mood">
                            {mood && (
                              <div className="flex flex-col gap-0.5 text-left">
                                <span className="font-medium text-sm capitalize">{MOODS.find(m => m.value === mood)?.label}</span>
                                <span className="text-xs text-muted-foreground">{MOODS.find(m => m.value === mood)?.description}</span>
                              </div>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="max-w-md">
                          {MOODS.map(({ value, label, description }) => (
                            <SelectItem key={value} value={value} className="py-3">
                              <div className="flex flex-col gap-1">
                                <span className="font-medium text-sm">{label}</span>
                                <span className="text-xs text-muted-foreground leading-relaxed">{description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={handleSaveBrandInfo}
                        disabled={savingBrandInfo || !companyName.trim() || !companyType.trim() || !mood.trim()}
                        data-testid="button-save-brand-info"
                      >
                        {savingBrandInfo ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4 mr-2" />
                        )}
                        Save Info
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No brand configured. Please complete onboarding first.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="colors" className="mt-6">
              {brand ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Colors</CardTitle>
                    <CardDescription>
                      Colors used in your AI-generated posts (2-4 colors)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex flex-row gap-4 items-end">
                      {colors.map((color, index) => (
                        <div key={index} className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground">
                            {index === 0 ? "Primary" : index === 1 ? "Secondary" : `Color ${index + 1}`}
                          </Label>
                          <div className="relative h-20 w-20">
                            <div
                              className="h-full w-full shrink-0 rounded-md border-2 border-border cursor-pointer transition-transform hover:scale-105"
                              style={{ backgroundColor: isValidHex(color) ? color : "#888888" }}
                              data-testid={`color-swatch-${index}`}
                            />
                            {colors.length > 2 && (
                              <button
                                type="button"
                                className="absolute right-1 top-1 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background/95 shadow-sm"
                                onClick={() => setColors(colors.filter((_, i) => i !== index))}
                                data-testid={`remove-color-${index}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                            <input
                              type="color"
                              value={isValidHex(color) ? color : "#888888"}
                              onChange={(e) => {
                                const newColors = [...colors];
                                newColors[index] = e.target.value;
                                setColors(newColors);
                              }}
                              className="absolute inset-0 z-10 h-full w-full opacity-0 cursor-pointer"
                              data-testid={`input-color-picker-${index}`}
                            />
                          </div>
                          <div>
                            <Input
                              value={color}
                              onChange={(e) => handleHexInput(e.target.value, index)}
                              className="text-center text-xs font-mono h-7 w-20"
                              maxLength={7}
                              placeholder="#000000"
                              data-testid={`input-color-hex-${index}`}
                            />
                          </div>
                        </div>
                      ))}
                      {colors.length < 4 && (
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground">Add</Label>
                          <button
                            type="button"
                            onClick={() => setColors([...colors, "#9CA3AF"])}
                            className="h-20 w-20 rounded-md border-2 border-dashed border-border flex items-center justify-center hover:bg-muted/50 transition-colors"
                            data-testid="add-color-button"
                          >
                            <span className="text-xl text-muted-foreground">+</span>
                          </button>
                          <div className="h-7" />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Preview:</span>
                        <div className="flex gap-1.5">
                          {colors.map((color, index) => (
                            <div
                              key={index}
                              className="w-6 h-6 rounded-sm border border-border"
                              style={{ backgroundColor: isValidHex(color) ? color : "#888888" }}
                              title={`Color ${index + 1}`}
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
                        Save Colors
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No brand configured. Please complete onboarding first.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="logo" className="mt-6">
              {brand ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Logo</CardTitle>
                    <CardDescription>
                      Your logo used in AI-generated posts
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <Label className="text-xs font-medium text-muted-foreground block">Current Logo</Label>
                      <div className="relative group w-32 h-32 rounded-xl border-2 border-border bg-muted/40 flex items-center justify-center overflow-hidden">
                        {logoPreview ? (
                          <img src={logoPreview} alt="New logo preview" className="max-w-full max-h-full object-contain" data-testid="img-logo-new-preview" />
                        ) : brand.logo_url ? (
                          <img src={brand.logo_url} alt="Brand logo" className="max-w-full max-h-full object-contain" data-testid="img-logo-current" />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
                        )}

                        {/* Remove button - shows on hover or when new logo is selected */}
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

                        {/* Upload overlay - shows on hover */}
                        <label className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                          <Upload className="w-5 h-5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground px-2 text-center">
                            {logoFile ? logoFile.name : "PNG, JPG, SVG up to 5MB"}
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

                      {/* Save button - only shows when a new file is selected */}
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
                          Save Logo
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No brand configured. Please complete onboarding first.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="api" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Google Gemini API Key</CardTitle>
                  <CardDescription>
                    Used for AI-powered content and image generation
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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

                  <div className="flex items-center justify-between gap-3 flex-wrap">
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
                    <Button
                      onClick={handleSave}
                      disabled={saving || !apiKey.trim()}
                      data-testid="button-save-key"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4 mr-2" />
                      )}
                      Save Key
                    </Button>
                  </div>

                  {profile?.api_key && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      API key is configured
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}
