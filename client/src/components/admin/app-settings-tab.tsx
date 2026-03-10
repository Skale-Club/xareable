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
import { Settings, Palette } from "lucide-react";
import { ColorPicker } from "@/components/ui/color-picker";
import { PageLoader } from "@/components/page-loader";
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
    const { settings, refresh, applySettings } = useAppSettings();
    const [localSettings, setLocalSettings] = useState<Partial<AppSettings>>({});

    useEffect(() => {
        if (settings) {
            setLocalSettings(settings);
        }
    }, [settings]);

    useEffect(() => {
        refresh();
    }, [refresh]);

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
        onSuccess: (updatedSettings: AppSettings) => {
            setLocalSettings(updatedSettings);
            applySettings(updatedSettings);
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
        return <PageLoader />;
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
                    <CardDescription>{t("Primary, secondary, success, and error colors used across the app")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-6 items-end">
                        <div className="flex flex-col gap-2 w-24">
                            <Label className="text-center truncate text-xs" title={t("Primary Color")}>{t("Primary")}</Label>
                            <ColorPicker
                                value={localSettings.primary_color || "#8b5cf6"}
                                onChange={(color) => handleChange("primary_color", color)}
                                placeholder="#8b5cf6"
                                showHexInput={false}
                                buttonClassName="w-24 h-24"
                            />
                        </div>
                        <div className="flex flex-col gap-2 w-24">
                            <Label className="text-center truncate text-xs" title={t("Secondary Color")}>{t("Secondary")}</Label>
                            <ColorPicker
                                value={localSettings.secondary_color || "#ec4899"}
                                onChange={(color) => handleChange("secondary_color", color)}
                                placeholder="#ec4899"
                                showHexInput={false}
                                buttonClassName="w-24 h-24"
                            />
                        </div>
                        <div className="flex flex-col gap-2 w-24">
                            <Label className="text-center truncate text-xs" title={t("Success Color")}>{t("Success")}</Label>
                            <ColorPicker
                                value={localSettings.success_color || "#10b981"}
                                onChange={(color) => handleChange("success_color", color)}
                                placeholder="#10b981"
                                showHexInput={false}
                                buttonClassName="w-24 h-24"
                            />
                        </div>
                        <div className="flex flex-col gap-2 w-24">
                            <Label className="text-center truncate text-xs" title={t("Error Color")}>{t("Error")}</Label>
                            <ColorPicker
                                value={localSettings.error_color || "#ef4444"}
                                onChange={(color) => handleChange("error_color", color)}
                                placeholder="#ef4444"
                                showHexInput={false}
                                buttonClassName="w-24 h-24"
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
