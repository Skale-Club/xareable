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
import { Banknote, Wallet } from "lucide-react";
import { PageLoader } from "@/components/page-loader";
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
        return <PageLoader />;
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
                        {t("Token Pricing")}
                    </CardTitle>
                    <CardDescription>{t("Set raw provider cost and customer sell price per 1M tokens.")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-4">
                        <div className="space-y-2">
                            <Label htmlFor="textInputCostPerMillion">{t("Text Input Cost /1M")}</Label>
                            <Input
                                id="textInputCostPerMillion"
                                type="number"
                                step="0.001"
                                min="0"
                                value={form.textInputCostPerMillion}
                                onChange={(e) => setField("textInputCostPerMillion", Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="textInputSellPerMillion">{t("Text Input Sell /1M")}</Label>
                            <Input
                                id="textInputSellPerMillion"
                                type="number"
                                step="0.001"
                                min="0"
                                value={form.textInputSellPerMillion}
                                onChange={(e) => setField("textInputSellPerMillion", Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="textOutputCostPerMillion">{t("Text Output Cost /1M")}</Label>
                            <Input
                                id="textOutputCostPerMillion"
                                type="number"
                                step="0.001"
                                min="0"
                                value={form.textOutputCostPerMillion}
                                onChange={(e) => setField("textOutputCostPerMillion", Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="textOutputSellPerMillion">{t("Text Output Sell /1M")}</Label>
                            <Input
                                id="textOutputSellPerMillion"
                                type="number"
                                step="0.001"
                                min="0"
                                value={form.textOutputSellPerMillion}
                                onChange={(e) => setField("textOutputSellPerMillion", Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="imageInputCostPerMillion">{t("Image Input Cost /1M")}</Label>
                            <Input
                                id="imageInputCostPerMillion"
                                type="number"
                                step="0.001"
                                min="0"
                                value={form.imageInputCostPerMillion}
                                onChange={(e) => setField("imageInputCostPerMillion", Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="imageInputSellPerMillion">{t("Image Input Sell /1M")}</Label>
                            <Input
                                id="imageInputSellPerMillion"
                                type="number"
                                step="0.001"
                                min="0"
                                value={form.imageInputSellPerMillion}
                                onChange={(e) => setField("imageInputSellPerMillion", Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="imageOutputCostPerMillion">{t("Image Output Cost /1M")}</Label>
                            <Input
                                id="imageOutputCostPerMillion"
                                type="number"
                                step="0.001"
                                min="0"
                                value={form.imageOutputCostPerMillion}
                                onChange={(e) => setField("imageOutputCostPerMillion", Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="imageOutputSellPerMillion">{t("Image Output Sell /1M")}</Label>
                            <Input
                                id="imageOutputSellPerMillion"
                                type="number"
                                step="0.001"
                                min="0"
                                value={form.imageOutputSellPerMillion}
                                onChange={(e) => setField("imageOutputSellPerMillion", Number(e.target.value))}
                            />
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="defaultAffiliateCommissionPercent">{t("Default Affiliate Commission %")}</Label>
                            <Input
                                id="defaultAffiliateCommissionPercent"
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                value={form.defaultAffiliateCommissionPercent}
                                onChange={(e) => setField("defaultAffiliateCommissionPercent", Number(e.target.value))}
                            />
                        </div>
                    </div>
                    <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                        {t("Gross profit per event is calculated from sell price minus raw provider cost.")}
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
