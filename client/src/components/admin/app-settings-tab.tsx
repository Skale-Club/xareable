/**
 * AppSettingsTab - Admin app branding settings tab
 */

import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Settings, Palette } from "lucide-react";
import { ColorPicker } from "@/components/ui/color-picker";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { useAppSettings } from "@/lib/app-settings";
import { AdminFloatingSaveButton } from ".";
import type { AppSettings } from "@shared/schema";

import { GradientIcon } from "@/components/ui/gradient-icon";

export function AppSettingsTab() {
    const { toast } = useToast();
    const { t } = useTranslation();
    const { settings, refresh } = useAppSettings();
    const [localSettings, setLocalSettings] = useState<Partial<AppSettings>>({});

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
            toast({ title: t("App settings updated successfully") });
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
                        <GradientIcon icon={Settings} className="w-5 h-5" />
                        {t("App Branding")}
                    </CardTitle>
                    <CardDescription>{t("Configure the application name and branding")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="app_name">{t("App Name")}</Label>
                        <Input
                            id="app_name"
                            value={localSettings.app_name || ""}
                            onChange={(e) => handleChange("app_name", e.target.value)}
                            placeholder={t("Your app name")}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="app_tagline">{t("Tagline")}</Label>
                        <Input
                            id="app_tagline"
                            value={localSettings.app_tagline || ""}
                            onChange={(e) => handleChange("app_tagline", e.target.value)}
                            placeholder={t("AI-Powered Social Media Content Creation")}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="app_description">{t("Description")}</Label>
                        <Textarea
                            id="app_description"
                            value={localSettings.app_description || ""}
                            onChange={(e) => handleChange("app_description", e.target.value)}
                            placeholder={t("Brief description of your application")}
                            rows={2}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <GradientIcon icon={Palette} className="w-5 h-5" />
                        {t("Colors")}
                    </CardTitle>
                    <CardDescription>{t("Primary and secondary brand colors")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-row gap-6 items-end">
                        <div className="space-y-2">
                            <Label>{t("Primary Color")}</Label>
                            <ColorPicker
                                value={localSettings.primary_color || "#8b5cf6"}
                                onChange={(color) => handleChange("primary_color", color)}
                                placeholder="#8b5cf6"
                                showHexInput={false}
                                buttonClassName="w-20 h-20"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t("Secondary Color")}</Label>
                            <ColorPicker
                                value={localSettings.secondary_color || "#ec4899"}
                                onChange={(color) => handleChange("secondary_color", color)}
                                placeholder="#ec4899"
                                showHexInput={false}
                                buttonClassName="w-20 h-20"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <AdminFloatingSaveButton
                onClick={handleSave}
                disabled={updateMutation.isPending}
                label="Save Changes"
            />
        </div>
    );
}
