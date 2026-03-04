/**
 * SeoTab - Admin SEO settings tab
 */

import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, Image } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { useAppSettings } from "@/lib/app-settings";
import { AdminFloatingSaveButton, ImageUploadField } from ".";
import type { AppSettings } from "@shared/schema";

import { GradientIcon } from "@/components/ui/gradient-icon";

export function SeoTab() {
    const { toast } = useToast();
    const { t } = useTranslation();
    const { settings, refresh } = useAppSettings();
    const [localSettings, setLocalSettings] = useState<Partial<AppSettings>>({});
    const [uploadingOgImage, setUploadingOgImage] = useState(false);

    useEffect(() => {
        if (settings) {
            setLocalSettings(settings);
        }
    }, [settings]);

    const updateMutation = useMutation({
        mutationFn: async (data: Partial<AppSettings>) => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/settings", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: () => {
            refresh();
            queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
            toast({ title: t("SEO settings updated successfully") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to update"), description: e.message, variant: "destructive" });
        },
    });

    const handleSave = () => {
        updateMutation.mutate(localSettings);
    };

    const handleChange = (field: keyof AppSettings, value: string) => {
        setLocalSettings(prev => ({ ...prev, [field]: value }));
    };

    const handleOgImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
        if (!validTypes.includes(file.type)) {
            toast({ title: t("Invalid file type"), description: t("Only PNG, JPEG, and WEBP are supported"), variant: "destructive" });
            return;
        }

        setUploadingOgImage(true);
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64 = (reader.result as string).split(",")[1];
                const sb = supabase();
                const { data: { session } } = await sb.auth.getSession();

                const res = await fetch("/api/admin/settings/upload-og-image", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session?.access_token}`,
                    },
                    body: JSON.stringify({ file: base64, contentType: file.type }),
                });

                if (!res.ok) throw new Error(await res.text());
                const { og_image_url } = await res.json();
                setLocalSettings(prev => ({ ...prev, og_image_url }));
                refresh();
                queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
                toast({ title: t("OG image uploaded successfully") });
            } catch (error: any) {
                toast({ title: t("Upload failed"), description: error.message, variant: "destructive" });
            } finally {
                setUploadingOgImage(false);
            }
        };
        reader.readAsDataURL(file);
    };

    if (!settings) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-24">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <GradientIcon icon={Sparkles} className="w-5 h-5" />
                        {t("Meta Tags")}
                    </CardTitle>
                    <CardDescription>{t("Basic SEO metadata for search engines")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="meta_title">{t("Meta Title")}</Label>
                        <Input
                            id="meta_title"
                            value={localSettings.meta_title || ""}
                            onChange={(e) => handleChange("meta_title", e.target.value)}
                            placeholder={t("Your page title")}
                        />
                        <p className="text-xs text-muted-foreground">{t("The title that appears in search results and browser tabs")}</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="meta_description">{t("Meta Description")}</Label>
                        <Textarea
                            id="meta_description"
                            value={localSettings.meta_description || ""}
                            onChange={(e) => handleChange("meta_description", e.target.value)}
                            placeholder={t("Create stunning social media images and captions with AI...")}
                            rows={3}
                        />
                        <p className="text-xs text-muted-foreground">{t("A brief description that appears in search results (150-160 characters recommended)")}</p>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <GradientIcon icon={Image} className="w-5 h-5" />
                            {t("Open Graph & Social")}
                        </CardTitle>
                        <CardDescription>{t("How your site appears when shared on social media")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <ImageUploadField
                            value={localSettings.og_image_url ?? undefined}
                            onChange={handleOgImageUpload}
                            uploading={uploadingOgImage}
                            acceptedTypes={["image/png", "image/jpeg", "image/jpg", "image/webp"]}
                            label="OG Image"
                            description="Image displayed when your site is shared on Facebook, LinkedIn, etc. Recommended size: 1200x630."
                            previewHeight="h-48"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t("Legal Links")}</CardTitle>
                        <CardDescription>{t("Terms and Privacy policy URLs (also used for SEO compliance)")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="seo_terms_url">{t("Terms of Service URL")}</Label>
                            <Input
                                id="seo_terms_url"
                                value={localSettings.terms_url || ""}
                                onChange={(e) => handleChange("terms_url", e.target.value)}
                                placeholder="https://example.com/terms"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="seo_privacy_url">{t("Privacy Policy URL")}</Label>
                            <Input
                                id="seo_privacy_url"
                                value={localSettings.privacy_url || ""}
                                onChange={(e) => handleChange("privacy_url", e.target.value)}
                                placeholder="https://example.com/privacy"
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <AdminFloatingSaveButton
                onClick={handleSave}
                disabled={updateMutation.isPending}
                label="Save SEO Settings"
            />
        </div>
    );
}
