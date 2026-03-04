/**
 * PricingTab - Admin pricing settings tab
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin";
import { queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Banknote, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { AdminFloatingSaveButton } from ".";
import type { MarkupSettings } from "@shared/schema";

import { GradientIcon } from "@/components/ui/gradient-icon";

export function PricingTab() {
    const { toast } = useToast();
    const { t } = useTranslation();
    const [form, setForm] = useState<MarkupSettings | null>(null);

    const { data, isLoading, error } = useQuery<MarkupSettings>({
        queryKey: ["/api/admin/markup-settings"],
        queryFn: () => adminFetch("/api/admin/markup-settings"),
    });

    useEffect(() => {
        if (data) {
            setForm(data);
        }
    }, [data]);

    const updateMutation = useMutation({
        mutationFn: async (payload: MarkupSettings) => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/markup-settings", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json() as Promise<MarkupSettings>;
        },
        onSuccess: (next) => {
            setForm(next);
            queryClient.invalidateQueries({ queryKey: ["/api/admin/markup-settings"] });
            toast({ title: t("Pricing settings updated") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to update pricing"), description: e.message, variant: "destructive" });
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertTitle>{t("Pricing settings failed to load")}</AlertTitle>
                <AlertDescription>
                    {error.message || t("The server rejected the request.")}
                </AlertDescription>
            </Alert>
        );
    }

    if (!form) {
        return (
            <Alert variant="destructive">
                <AlertTitle>{t("Pricing settings unavailable")}</AlertTitle>
                <AlertDescription>
                    {t("The server returned no pricing payload.")}
                </AlertDescription>
            </Alert>
        );
    }

    const setField = <K extends keyof MarkupSettings>(field: K, value: MarkupSettings[K]) => {
        setForm((current) => current ? { ...current, [field]: value } : current);
    };

    return (
        <div className="space-y-6 pb-24">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <GradientIcon icon={Banknote} className="w-5 h-5" />
                        {t("Pay-Per-Use Pricing")}
                    </CardTitle>
                    <CardDescription>{t("Control global markup and recharge defaults for the credits model.")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="regularMultiplier">{t("Regular User Markup")}</Label>
                            <Input
                                id="regularMultiplier"
                                type="number"
                                step="0.1"
                                min="1"
                                value={form.regularMultiplier}
                                onChange={(e) => setField("regularMultiplier", Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="affiliateMultiplier">{t("Affiliate Customer Markup")}</Label>
                            <Input
                                id="affiliateMultiplier"
                                type="number"
                                step="0.1"
                                min="1"
                                value={form.affiliateMultiplier}
                                onChange={(e) => setField("affiliateMultiplier", Number(e.target.value))}
                            />
                        </div>
                    </div>
                    <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                        {`${t("Example: if Gemini costs")} $0.01, ${t("regular users pay")} $${(0.01 * form.regularMultiplier).toFixed(3)} ${t("and referred users pay")} $${(0.01 * form.affiliateMultiplier).toFixed(3)}.`}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <GradientIcon icon={Wallet} className="w-5 h-5" />
                        {t("Recharge Defaults")}
                    </CardTitle>
                    <CardDescription>{t("Minimum purchase and suggested auto-recharge defaults.")}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                        <Label htmlFor="minRechargeMicros">{t("Minimum Top-Up (USD)")}</Label>
                        <Input
                            id="minRechargeMicros"
                            type="number"
                            min="1"
                            value={form.minRechargeMicros / 1_000_000}
                            onChange={(e) => setField("minRechargeMicros", Math.round(Number(e.target.value) * 1_000_000))}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="defaultAutoRechargeThresholdMicros">{t("Default Threshold (USD)")}</Label>
                        <Input
                            id="defaultAutoRechargeThresholdMicros"
                            type="number"
                            min="0"
                            value={form.defaultAutoRechargeThresholdMicros / 1_000_000}
                            onChange={(e) => setField("defaultAutoRechargeThresholdMicros", Math.round(Number(e.target.value) * 1_000_000))}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="defaultAutoRechargeAmountMicros">{t("Default Auto Top-Up (USD)")}</Label>
                        <Input
                            id="defaultAutoRechargeAmountMicros"
                            type="number"
                            min="0"
                            value={form.defaultAutoRechargeAmountMicros / 1_000_000}
                            onChange={(e) => setField("defaultAutoRechargeAmountMicros", Math.round(Number(e.target.value) * 1_000_000))}
                        />
                    </div>
                </CardContent>
            </Card>

            <AdminFloatingSaveButton
                onClick={() => updateMutation.mutate(form)}
                disabled={updateMutation.isPending}
                label="Save Pricing"
            />
        </div>
    );
}
