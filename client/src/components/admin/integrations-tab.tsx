/**
 * IntegrationsTab - Admin integrations overview
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin";
import { queryClient } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, CreditCard, Database, KeyRound, Link2, CheckCircle2, AlertCircle } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import type { AdminIntegrationsStatus } from "@shared/schema";

const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;

function normalizeGtmContainerId(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.toUpperCase();
}

function IntegrationStatusBadge({ active, label }: { active: boolean; label: string }) {
    return (
        <Badge
            variant={active ? "default" : "destructive"}
            className={active ? "bg-emerald-600 hover:bg-emerald-600 text-white" : ""}
        >
            {label}
        </Badge>
    );
}

function IntegrationRow({ label, active, activeLabel, inactiveLabel }: { label: string; active: boolean; activeLabel: string; inactiveLabel: string }) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
            <span className="text-sm text-muted-foreground">{label}</span>
            <IntegrationStatusBadge active={active} label={active ? activeLabel : inactiveLabel} />
        </div>
    );
}

export function IntegrationsTab() {
    const { toast } = useToast();
    const { t } = useTranslation();
    const { profile } = useAuth();
    const [gtmEnabled, setGtmEnabled] = useState(false);
    const [gtmContainerId, setGtmContainerId] = useState("");

    const { data, isLoading, error } = useQuery<AdminIntegrationsStatus>({
        queryKey: ["/api/admin/integrations/status"],
        queryFn: async () => {
            try {
                return await adminFetch<AdminIntegrationsStatus>("/api/admin/integrations/status");
            } catch {
                // Fallback: keep GTM integration functional even if the new admin endpoint
                // is unavailable on a stale server process.
                const response = await fetch("/api/settings");
                if (!response.ok) {
                    throw new Error("Integrations endpoint unavailable and fallback settings request failed.");
                }

                const settings = await response.json() as {
                    gtm_enabled?: boolean;
                    gtm_container_id?: string | null;
                };
                const fallbackContainer = normalizeGtmContainerId(settings.gtm_container_id || "") || null;
                const fallbackActive = Boolean(settings.gtm_enabled && fallbackContainer && GTM_CONTAINER_ID_REGEX.test(fallbackContainer));

                return {
                    gemini_server_key_configured: false,
                    stripe_secret_key_configured: false,
                    stripe_webhook_secret_configured: false,
                    stripe_fully_configured: false,
                    supabase_url_configured: false,
                    supabase_anon_key_configured: false,
                    supabase_service_role_key_configured: false,
                    gtm_enabled: Boolean(settings.gtm_enabled),
                    gtm_container_id: fallbackContainer,
                    gtm_active: fallbackActive,
                };
            }
        },
    });

    useEffect(() => {
        if (!data) {
            return;
        }
        setGtmEnabled(data.gtm_enabled);
        setGtmContainerId(data.gtm_container_id || "");
    }, [data]);

    const normalizedGtmContainerId = useMemo(() => normalizeGtmContainerId(gtmContainerId) || "", [gtmContainerId]);
    const gtmContainerValid = normalizedGtmContainerId.length > 0 && GTM_CONTAINER_ID_REGEX.test(normalizedGtmContainerId);
    const gtmActive = gtmEnabled && gtmContainerValid;

    const saveGtmMutation = useMutation({
        mutationFn: async () => {
            const normalizedContainerId = normalizeGtmContainerId(gtmContainerId);
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/settings", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({
                    gtm_enabled: gtmEnabled,
                    gtm_container_id: normalizedContainerId,
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations/status"] }),
                queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
            ]);
            toast({ title: t("Google Tag Manager updated") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to update"), description: e.message, variant: "destructive" });
        },
    });

    const handleSaveGtm = () => {
        if (gtmEnabled && !gtmContainerValid) {
            toast({
                title: t("Invalid GTM container ID"),
                description: t("Use a valid container ID like GTM-K4QW37F before enabling this integration."),
                variant: "destructive",
            });
            return;
        }
        saveGtmMutation.mutate();
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <Alert variant="destructive">
                <AlertTitle>{t("Integrations failed to load")}</AlertTitle>
                <AlertDescription>
                    {error?.message || t("The server rejected the request.")}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="space-y-6 pb-24">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <GradientIcon icon={Link2} className="w-5 h-5" />
                        {t("Integrations")}
                    </CardTitle>
                    <CardDescription>
                        {t("Monitor core service connectivity and required configuration in one place.")}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <CardTitle className="text-base">{t("Google Tag Manager")}</CardTitle>
                                    <CardDescription>{t("Track website events using your GTM container.")}</CardDescription>
                                </div>
                                <Switch
                                    checked={gtmEnabled}
                                    onCheckedChange={setGtmEnabled}
                                    disabled={saveGtmMutation.isPending}
                                    aria-label={t("Toggle Google Tag Manager")}
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-2">
                                <Label htmlFor="gtm-container-id">{t("Container ID")}</Label>
                                <Input
                                    id="gtm-container-id"
                                    value={gtmContainerId}
                                    onChange={(e) => setGtmContainerId(e.target.value)}
                                    placeholder="GTM-K4QW37F"
                                    disabled={saveGtmMutation.isPending}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t("Find this in GTM under Admin > Container Settings")}
                                </p>
                            </div>

                            {gtmActive ? (
                                <div className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>{t("Integration Active")}</span>
                                </div>
                            ) : (
                                <div className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    <span>{t("Integration Inactive")}</span>
                                </div>
                            )}

                            <div className="flex justify-end">
                                <Button onClick={handleSaveGtm} disabled={saveGtmMutation.isPending}>
                                    {saveGtmMutation.isPending ? t("Saving...") : t("Save Integration")}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <KeyRound className="w-4 h-4" />
                                    {t("Google Gemini")}
                                </CardTitle>
                                <CardDescription>{t("AI generation keys used by the platform")}</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <IntegrationRow
                                    label={t("Server Gemini API key")}
                                    active={data.gemini_server_key_configured}
                                    activeLabel={t("Connected")}
                                    inactiveLabel={t("Missing")}
                                />
                                <IntegrationRow
                                    label={t("Admin user API key")}
                                    active={Boolean(profile?.api_key)}
                                    activeLabel={t("Connected")}
                                    inactiveLabel={t("Missing")}
                                />
                                <div className="pt-3 text-xs text-muted-foreground">
                                    <Link href="/settings" className="underline underline-offset-2">
                                        {t("Manage your admin API key in Settings")}
                                    </Link>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <CreditCard className="w-4 h-4" />
                                    {t("Stripe")}
                                </CardTitle>
                                <CardDescription>{t("Billing and webhook processing")}</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <IntegrationRow
                                    label={t("Secret key")}
                                    active={data.stripe_secret_key_configured}
                                    activeLabel={t("Connected")}
                                    inactiveLabel={t("Missing")}
                                />
                                <IntegrationRow
                                    label={t("Webhook secret")}
                                    active={data.stripe_webhook_secret_configured}
                                    activeLabel={t("Connected")}
                                    inactiveLabel={t("Missing")}
                                />
                                <IntegrationRow
                                    label={t("Fully configured")}
                                    active={data.stripe_fully_configured}
                                    activeLabel={t("Ready")}
                                    inactiveLabel={t("Incomplete")}
                                />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Database className="w-4 h-4" />
                                    {t("Supabase")}
                                </CardTitle>
                                <CardDescription>{t("Database, auth, and storage configuration")}</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <IntegrationRow
                                    label={t("Project URL")}
                                    active={data.supabase_url_configured}
                                    activeLabel={t("Connected")}
                                    inactiveLabel={t("Missing")}
                                />
                                <IntegrationRow
                                    label={t("Anon key")}
                                    active={data.supabase_anon_key_configured}
                                    activeLabel={t("Connected")}
                                    inactiveLabel={t("Missing")}
                                />
                                <IntegrationRow
                                    label={t("Service role key")}
                                    active={data.supabase_service_role_key_configured}
                                    activeLabel={t("Connected")}
                                    inactiveLabel={t("Missing")}
                                />
                            </CardContent>
                        </Card>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
