/**
 * IntegrationsTab - Admin integrations overview
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Loader2, CreditCard, Database, KeyRound, Link2, CheckCircle2, AlertCircle, Users, Send, X } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import type { AdminIntegrationsStatus, AdminGHLStatus, AdminTelegramStatus } from "@shared/schema";

const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;
const INTEGRATION_ERROR_STYLE: React.CSSProperties = {
    borderColor: "color-mix(in srgb, var(--app-error-color) 45%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--app-error-color) 12%, transparent)",
    color: "var(--app-error-color)",
};

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
            className={`inline-flex w-28 justify-center ${active ? "text-white" : ""}`}
            style={active ? { backgroundColor: "var(--app-success-color)" } : undefined}
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

    // GHL state
    const [ghlEnabled, setGhlEnabled] = useState(false);
    const [ghlApiKey, setGhlApiKey] = useState("");
    const [ghlLocationId, setGhlLocationId] = useState("");
    const [ghlConnectionStatus, setGhlConnectionStatus] = useState<'connected' | 'disconnected' | 'error' | 'not_configured'>('not_configured');

    // Telegram state
    const [telegramEnabled, setTelegramEnabled] = useState(false);
    const [telegramBotToken, setTelegramBotToken] = useState("");
    const [telegramChatIdInput, setTelegramChatIdInput] = useState("");
    const [telegramChatIds, setTelegramChatIds] = useState<string[]>([]);
    const [telegramNotifyOnNewChat, setTelegramNotifyOnNewChat] = useState(false);
    const [telegramConnectionStatus, setTelegramConnectionStatus] = useState<'connected' | 'disconnected' | 'error' | 'not_configured'>('not_configured');

    const { data, isLoading, error } = useQuery<AdminIntegrationsStatus>({
        queryKey: ["/api/admin/integrations/status"],
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
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
                    ghl_enabled: false,
                    ghl_configured: false,
                    telegram_enabled: false,
                    telegram_configured: false,
                    gtm_enabled: Boolean(settings.gtm_enabled),
                    gtm_container_id: fallbackContainer,
                    gtm_active: fallbackActive,
                };
            }
        },
    });

    // GHL settings query
    const { data: ghlData } = useQuery<AdminGHLStatus>({
        queryKey: ["/api/admin/ghl"],
        queryFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/ghl", {
                headers: { Authorization: `Bearer ${session?.access_token}` },
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
    });

    const { data: telegramData } = useQuery<AdminTelegramStatus>({
        queryKey: ["/api/admin/telegram"],
        queryFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/telegram", {
                headers: { Authorization: `Bearer ${session?.access_token}` },
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
    });

    useEffect(() => {
        if (!data) {
            return;
        }
        setGtmEnabled(data.gtm_enabled);
        setGtmContainerId(data.gtm_container_id || "");
    }, [data]);

    useEffect(() => {
        if (ghlData) {
            setGhlEnabled(ghlData.enabled);
            setGhlLocationId(ghlData.location_id || "");
            setGhlConnectionStatus(ghlData.connection_status);
            // Don't set API key from server - it's masked
        }
    }, [ghlData]);

    useEffect(() => {
        if (telegramData) {
            setTelegramEnabled(telegramData.enabled);
            setTelegramChatIds(telegramData.chat_ids || []);
            setTelegramNotifyOnNewChat(telegramData.notify_on_new_chat);
            setTelegramConnectionStatus(telegramData.connection_status);
            // Don't set token from server - it's masked
        }
    }, [telegramData]);

    const normalizedGtmContainerId = useMemo(() => normalizeGtmContainerId(gtmContainerId) || "", [gtmContainerId]);
    const gtmContainerValid = normalizedGtmContainerId.length > 0 && GTM_CONTAINER_ID_REGEX.test(normalizedGtmContainerId);
    const gtmActive = gtmEnabled && gtmContainerValid;

    const ghlConfigured = Boolean(ghlData?.configured);
    const ghlActive = ghlEnabled && ghlConnectionStatus === 'connected';
    const telegramConfigured = Boolean(telegramData?.configured);
    const telegramActive = telegramEnabled && telegramConnectionStatus === "connected";

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
        onSuccess: async (updatedSettings) => {
            setGtmEnabled(Boolean(updatedSettings?.gtm_enabled));
            setGtmContainerId(updatedSettings?.gtm_container_id || "");
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

    // GHL test connection mutation
    const testGhlMutation = useMutation({
        mutationFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/ghl/test", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({
                    api_key: ghlApiKey || undefined,
                    location_id: ghlLocationId || undefined,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.message || "Test failed");
            return result;
        },
        onSuccess: () => {
            setGhlConnectionStatus('connected');
            toast({ title: t("Connection successful"), description: t("GHL API connection verified") });
        },
        onError: (e: any) => {
            setGhlConnectionStatus('error');
            toast({ title: t("Connection failed"), description: e.message, variant: "destructive" });
        },
    });

    // GHL save mutation
    const saveGhlMutation = useMutation({
        mutationFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const payload: Record<string, unknown> = { enabled: ghlEnabled };
            if (ghlApiKey) payload.api_key = ghlApiKey;
            if (ghlLocationId) payload.location_id = ghlLocationId;

            const res = await fetch("/api/admin/ghl", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/ghl"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations/status"] });
            toast({ title: t("GHL settings saved") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to save"), description: e.message, variant: "destructive" });
        },
    });

    const testTelegramMutation = useMutation({
        mutationFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/telegram/test", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({
                    bot_token: telegramBotToken || undefined,
                    chat_ids: telegramChatIds.length > 0 ? telegramChatIds : undefined,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.message || "Test failed");
            return result;
        },
        onSuccess: (result: any) => {
            setTelegramConnectionStatus("connected");
            toast({
                title: t("Connection successful"),
                description: result.message || t("Telegram API connection verified"),
            });
        },
        onError: (e: any) => {
            setTelegramConnectionStatus("error");
            toast({ title: t("Connection failed"), description: e.message, variant: "destructive" });
        },
    });

    const saveTelegramMutation = useMutation({
        mutationFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const payload: Record<string, unknown> = {
                enabled: telegramEnabled,
                notify_on_new_chat: telegramNotifyOnNewChat,
                chat_ids: telegramChatIds,
            };
            if (telegramBotToken) payload.bot_token = telegramBotToken;

            const res = await fetch("/api/admin/telegram", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/telegram"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations/status"] });
            toast({ title: t("Telegram settings saved") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to save"), description: e.message, variant: "destructive" });
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

    const handleTestGhl = () => {
        if (!ghlLocationId) {
            toast({
                title: t("Location ID required"),
                description: t("Enter a Location ID before testing the connection."),
                variant: "destructive",
            });
            return;
        }
        testGhlMutation.mutate();
    };

    const handleSaveGhl = () => {
        if (ghlEnabled && ghlConnectionStatus !== 'connected') {
            toast({
                title: t("Test connection first"),
                description: t("Please test the connection before enabling the integration."),
                variant: "destructive",
            });
            return;
        }
        saveGhlMutation.mutate();
    };

    const handleTestTelegram = () => {
        if (telegramChatIds.length === 0) {
            toast({
                title: t("Chat ID required"),
                description: t("Enter at least one chat ID before testing the connection."),
                variant: "destructive",
            });
            return;
        }
        testTelegramMutation.mutate();
    };

    const handleAddTelegramChatId = () => {
        const next = telegramChatIdInput.trim();
        if (!next) return;
        setTelegramChatIds((current) => (current.includes(next) ? current : [...current, next]));
        setTelegramChatIdInput("");
    };

    const handleRemoveTelegramChatId = (chatId: string) => {
        setTelegramChatIds((current) => current.filter((id) => id !== chatId));
    };

    const handleSaveTelegram = () => {
        if (telegramChatIds.length === 0) {
            toast({
                title: t("Chat ID required"),
                description: t("Enter at least one chat ID to save Telegram settings."),
                variant: "destructive",
            });
            return;
        }
        if (telegramEnabled && telegramConnectionStatus !== "connected") {
            toast({
                title: t("Test connection first"),
                description: t("Please test the connection before enabling the integration."),
                variant: "destructive",
            });
            return;
        }
        saveTelegramMutation.mutate();
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
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
                                <div
                                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                                    style={{
                                        borderColor: "color-mix(in srgb, var(--app-success-color) 45%, transparent)",
                                        backgroundColor: "color-mix(in srgb, var(--app-success-color) 12%, transparent)",
                                        color: "var(--app-success-color)",
                                    }}
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>{t("Integration Active")}</span>
                                </div>
                            ) : (
                                <div className="rounded-md border px-3 py-2 text-sm flex items-center gap-2" style={INTEGRATION_ERROR_STYLE}>
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

                    {/* GHL Integration Card */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Users className="w-4 h-4" />
                                        {t("GoHighLevel")}
                                    </CardTitle>
                                    <CardDescription>{t("Sync leads and contacts with your GHL account.")}</CardDescription>
                                </div>
                                <Switch
                                    checked={ghlEnabled}
                                    onCheckedChange={setGhlEnabled}
                                    disabled={saveGhlMutation.isPending || !ghlConfigured}
                                    aria-label={t("Toggle GoHighLevel")}
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="ghl-api-key">{t("API Key")}</Label>
                                    <Input
                                        id="ghl-api-key"
                                        type="password"
                                        value={ghlApiKey}
                                        onChange={(e) => setGhlApiKey(e.target.value)}
                                        placeholder={ghlData?.api_key_masked || t("Enter API key")}
                                        disabled={saveGhlMutation.isPending || testGhlMutation.isPending}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t("Find this in GHL under Settings > API Key")}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="ghl-location-id">{t("Location ID")}</Label>
                                    <Input
                                        id="ghl-location-id"
                                        value={ghlLocationId}
                                        onChange={(e) => setGhlLocationId(e.target.value)}
                                        placeholder="e.g., abc123xyz"
                                        disabled={saveGhlMutation.isPending || testGhlMutation.isPending}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t("Found in GHL URL or Settings > General")}
                                    </p>
                                </div>
                            </div>

                            {ghlActive ? (
                                <div
                                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                                    style={{
                                        borderColor: "color-mix(in srgb, var(--app-success-color) 45%, transparent)",
                                        backgroundColor: "color-mix(in srgb, var(--app-success-color) 12%, transparent)",
                                        color: "var(--app-success-color)",
                                    }}
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>{t("Integration Active")}</span>
                                </div>
                            ) : ghlConfigured ? (
                                <div className="rounded-md border px-3 py-2 text-sm flex items-center gap-2" style={INTEGRATION_ERROR_STYLE}>
                                    <AlertCircle className="w-4 h-4" />
                                    <span>{t("Configured - Test connection to enable")}</span>
                                </div>
                            ) : (
                                <div className="rounded-md border px-3 py-2 text-sm flex items-center gap-2" style={INTEGRATION_ERROR_STYLE}>
                                    <AlertCircle className="w-4 h-4" />
                                    <span>{t("Not Configured")}</span>
                                </div>
                            )}

                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={handleTestGhl}
                                    disabled={testGhlMutation.isPending || saveGhlMutation.isPending || !ghlLocationId}
                                >
                                    {testGhlMutation.isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            {t("Testing...")}
                                        </>
                                    ) : t("Test Connection")}
                                </Button>
                                <Button onClick={handleSaveGhl} disabled={saveGhlMutation.isPending || testGhlMutation.isPending}>
                                    {saveGhlMutation.isPending ? t("Saving...") : t("Save Integration")}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Telegram Integration Card */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Send className="w-4 h-4" />
                                        {t("Telegram")}
                                    </CardTitle>
                                    <CardDescription>{t("Send operational notifications to Telegram chats.")}</CardDescription>
                                </div>
                                <Switch
                                    checked={telegramEnabled}
                                    onCheckedChange={setTelegramEnabled}
                                    disabled={saveTelegramMutation.isPending || !telegramConfigured}
                                    aria-label={t("Toggle Telegram")}
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="telegram-bot-token">{t("Bot Token")}</Label>
                                    <Input
                                        id="telegram-bot-token"
                                        type="password"
                                        value={telegramBotToken}
                                        onChange={(e) => setTelegramBotToken(e.target.value)}
                                        placeholder={telegramData?.bot_token_masked || t("Enter bot token")}
                                        disabled={saveTelegramMutation.isPending || testTelegramMutation.isPending}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t("Create a bot with @BotFather and paste the token here.")}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="telegram-chat-ids">{t("Chat IDs")}</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="telegram-chat-ids"
                                            value={telegramChatIdInput}
                                            onChange={(e) => setTelegramChatIdInput(e.target.value)}
                                            placeholder={t("Enter one chat ID")}
                                            disabled={saveTelegramMutation.isPending || testTelegramMutation.isPending}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleAddTelegramChatId();
                                                }
                                            }}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleAddTelegramChatId}
                                            disabled={saveTelegramMutation.isPending || testTelegramMutation.isPending || !telegramChatIdInput.trim()}
                                        >
                                            {t("Add")}
                                        </Button>
                                    </div>
                                    <div className="min-h-10 rounded-md border border-border/60 p-2 flex flex-wrap gap-2">
                                        {telegramChatIds.length > 0 ? (
                                            telegramChatIds.map((chatId) => (
                                                <span key={chatId} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                                                    <span className="max-w-[180px] truncate">{chatId}</span>
                                                    <button
                                                        type="button"
                                                        className="text-muted-foreground hover:text-foreground"
                                                        onClick={() => handleRemoveTelegramChatId(chatId)}
                                                        aria-label={`${t("Delete")} ${chatId}`}
                                                        disabled={saveTelegramMutation.isPending || testTelegramMutation.isPending}
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-xs text-muted-foreground">{t("No chat IDs added yet.")}</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("You can use private, group, or channel chat IDs.")}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-md border px-3 py-2">
                                <div>
                                    <p className="text-sm font-medium">{t("Notify on new chat")}</p>
                                    <p className="text-xs text-muted-foreground">{t("When enabled, future chat events can trigger Telegram alerts.")}</p>
                                </div>
                                <Switch
                                    checked={telegramNotifyOnNewChat}
                                    onCheckedChange={setTelegramNotifyOnNewChat}
                                    disabled={saveTelegramMutation.isPending || testTelegramMutation.isPending}
                                    aria-label={t("Toggle notify on new chat")}
                                />
                            </div>

                            {telegramActive ? (
                                <div
                                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                                    style={{
                                        borderColor: "color-mix(in srgb, var(--app-success-color) 45%, transparent)",
                                        backgroundColor: "color-mix(in srgb, var(--app-success-color) 12%, transparent)",
                                        color: "var(--app-success-color)",
                                    }}
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>{t("Integration Active")}</span>
                                </div>
                            ) : telegramConfigured ? (
                                <div className="rounded-md border px-3 py-2 text-sm flex items-center gap-2" style={INTEGRATION_ERROR_STYLE}>
                                    <AlertCircle className="w-4 h-4" />
                                    <span>{t("Configured - Test connection to enable")}</span>
                                </div>
                            ) : (
                                <div className="rounded-md border px-3 py-2 text-sm flex items-center gap-2" style={INTEGRATION_ERROR_STYLE}>
                                    <AlertCircle className="w-4 h-4" />
                                    <span>{t("Not Configured")}</span>
                                </div>
                            )}

                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={handleTestTelegram}
                                    disabled={testTelegramMutation.isPending || saveTelegramMutation.isPending || telegramChatIds.length === 0}
                                >
                                    {testTelegramMutation.isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            {t("Testing...")}
                                        </>
                                    ) : t("Test Connection")}
                                </Button>
                                <Button onClick={handleSaveTelegram} disabled={saveTelegramMutation.isPending || testTelegramMutation.isPending}>
                                    {saveTelegramMutation.isPending ? t("Saving...") : t("Save Integration")}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
                        <Card className="h-full w-full min-h-[252px]">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <KeyRound className="w-4 h-4" />
                                    {t("Google Gemini")}
                                </CardTitle>
                                <CardDescription>{t("AI generation keys used by the platform")}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex h-full flex-col pt-0">
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
                            </CardContent>
                        </Card>

                        <Card className="h-full w-full min-h-[252px]">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <CreditCard className="w-4 h-4" />
                                    {t("Stripe")}
                                </CardTitle>
                                <CardDescription>{t("Billing and webhook processing")}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex h-full flex-col pt-0">
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

                        <Card className="h-full w-full min-h-[252px]">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Database className="w-4 h-4" />
                                    {t("Supabase")}
                                </CardTitle>
                                <CardDescription>{t("Database, auth, and storage configuration")}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex h-full flex-col pt-0">
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
