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
import { Loader2, CreditCard, Database, KeyRound, Link2, CheckCircle2, AlertCircle, Users, Send, X, BarChart3, Megaphone } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import {
    GHL_STANDARD_MAPPING_PREFIX,
    type AdminIntegrationsStatus,
    type AdminGHLStatus,
    type GHLCustomField,
    type AdminTelegramStatus,
    type AdminGA4Status,
    type AdminFacebookDatasetStatus,
    type GHLStandardFieldKey,
} from "@shared/schema";

const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;
const INTEGRATION_ERROR_STYLE: React.CSSProperties = {
    borderColor: "color-mix(in srgb, var(--app-error-color) 45%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--app-error-color) 12%, transparent)",
    color: "var(--app-error-color)",
};

const GHL_MAPPING_SOURCE_FIELDS: Array<{ key: string; label: string }> = [
    { key: "full_name", label: "Full Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "company_name", label: "Company Name" },
    { key: "company_type", label: "Company Type" },
    { key: "tag", label: "Tag" },
];
const GHL_MAPPING_SOURCE_FIELD_SET = new Set<string>(GHL_MAPPING_SOURCE_FIELDS.map((field) => field.key));
const GHL_STANDARD_TARGET_FIELDS: Array<{ key: GHLStandardFieldKey; label: string }> = [
    { key: "name", label: "Name" },
    { key: "firstName", label: "First Name" },
    { key: "lastName", label: "Last Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
];

type WebsiteEventSetup = {
    key: string;
    name: string;
    trigger: string;
    ga4: boolean | null;
    facebook: boolean | null;
    ghl: boolean | null;
    telegram: boolean | null;
    active: boolean;
};

function normalizeGtmContainerId(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.toUpperCase();
}

function normalizeGhlCustomFieldForUi(raw: GHLCustomField): GHLCustomField | null {
    const id = String(raw?.id ?? raw?.key ?? "").trim();
    const key = String(raw?.key ?? id).trim();
    const name = String(raw?.name ?? key ?? id).trim();
    const type = raw?.type ? String(raw.type).trim() : undefined;

    if (!id || !key || !name) {
        return null;
    }

    return { id, key, name, type };
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
    const [ghlCustomFieldMappings, setGhlCustomFieldMappings] = useState<Record<string, string>>({});

    // Telegram state
    const [telegramEnabled, setTelegramEnabled] = useState(false);
    const [telegramBotToken, setTelegramBotToken] = useState("");
    const [telegramChatIdInput, setTelegramChatIdInput] = useState("");
    const [telegramChatIds, setTelegramChatIds] = useState<string[]>([]);
    const [telegramNotifyOnNewSignup, setTelegramNotifyOnNewSignup] = useState(true);
    const [telegramConnectionStatus, setTelegramConnectionStatus] = useState<'connected' | 'disconnected' | 'error' | 'not_configured'>('not_configured');

    // GA4 state
    const [ga4Enabled, setGa4Enabled] = useState(false);
    const [ga4MeasurementId, setGa4MeasurementId] = useState("");
    const [ga4ApiSecret, setGa4ApiSecret] = useState("");
    const [ga4ConnectionStatus, setGa4ConnectionStatus] = useState<'connected' | 'disconnected' | 'error' | 'not_configured'>('not_configured');

    // Facebook Dataset state
    const [facebookEnabled, setFacebookEnabled] = useState(false);
    const [facebookDatasetId, setFacebookDatasetId] = useState("");
    const [facebookAccessToken, setFacebookAccessToken] = useState("");
    const [facebookTestEventCode, setFacebookTestEventCode] = useState("");
    const [facebookConnectionStatus, setFacebookConnectionStatus] = useState<'connected' | 'disconnected' | 'error' | 'not_configured'>('not_configured');

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
                    ga4_enabled: false,
                    ga4_configured: false,
                    facebook_dataset_enabled: false,
                    facebook_dataset_configured: false,
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

    const {
        data: ghlCustomFields = [],
        isFetching: isGhlCustomFieldsLoading,
        error: ghlCustomFieldsError,
        refetch: refetchGhlCustomFields,
    } = useQuery<GHLCustomField[]>({
        queryKey: ["/api/admin/ghl/custom-fields"],
        enabled: Boolean(ghlData?.configured),
        queryFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/ghl/custom-fields", {
                headers: { Authorization: `Bearer ${session?.access_token}` },
            });
            if (!res.ok) {
                const errorText = await res.text();
                console.error("GHL custom fields fetch failed:", errorText);
                throw new Error(errorText || "Failed to fetch custom fields");
            }
            const payload = await res.json() as { customFields?: GHLCustomField[] };
            const rawFields = Array.isArray(payload.customFields) ? payload.customFields : [];
            const deduped = new Map<string, GHLCustomField>();

            for (const field of rawFields) {
                const normalized = normalizeGhlCustomFieldForUi(field);
                if (!normalized) continue;
                deduped.set(normalized.key, normalized);
            }

            return Array.from(deduped.values())
                .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
        },
        retry: false,
    });

    const { data: ga4Data } = useQuery<AdminGA4Status>({
        queryKey: ["/api/admin/ga4"],
        queryFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/ga4", {
                headers: { Authorization: `Bearer ${session?.access_token}` },
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
    });

    const { data: facebookData } = useQuery<AdminFacebookDatasetStatus>({
        queryKey: ["/api/admin/facebook-dataset"],
        queryFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/facebook-dataset", {
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
            setGhlCustomFieldMappings(ghlData.custom_field_mappings || {});
            // Don't overwrite API key from server if it's masked - keep user's input
            // Only clear it if there's no API key configured at all
            if (!ghlData.api_key_masked && !ghlApiKey) {
                setGhlApiKey("");
            }
        }
    }, [ghlData]);

    useEffect(() => {
        if (telegramData) {
            setTelegramEnabled(telegramData.enabled);
            setTelegramChatIds(telegramData.chat_ids || []);
            setTelegramNotifyOnNewSignup(telegramData.notify_on_new_signup);
            setTelegramConnectionStatus(telegramData.connection_status);
            // Don't overwrite bot token from server if it's masked - keep user's input
            if (!telegramData.bot_token_masked && !telegramBotToken) {
                setTelegramBotToken("");
            }
        }
    }, [telegramData]);

    useEffect(() => {
        if (ga4Data) {
            setGa4Enabled(ga4Data.enabled);
            setGa4MeasurementId(ga4Data.measurement_id || "");
            setGa4ConnectionStatus(ga4Data.connection_status);
            // Don't set api secret from server - it's masked
        }
    }, [ga4Data]);

    useEffect(() => {
        if (facebookData) {
            setFacebookEnabled(facebookData.enabled);
            setFacebookDatasetId(facebookData.dataset_id || "");
            setFacebookTestEventCode(facebookData.test_event_code || "");
            setFacebookConnectionStatus(facebookData.connection_status);
            // Don't set access token from server - it's masked
        }
    }, [facebookData]);

    const normalizedGtmContainerId = useMemo(() => normalizeGtmContainerId(gtmContainerId) || "", [gtmContainerId]);
    const gtmContainerValid = normalizedGtmContainerId.length > 0 && GTM_CONTAINER_ID_REGEX.test(normalizedGtmContainerId);
    const gtmActive = gtmEnabled && gtmContainerValid;

    const ghlConfigured = Boolean(ghlData?.configured);
    const ghlActive = ghlEnabled && ghlConnectionStatus === 'connected';
    const telegramConfigured = Boolean(telegramData?.configured);
    const telegramActive = telegramEnabled && telegramConnectionStatus === "connected";
    const ga4Configured = Boolean(ga4Data?.configured);
    const ga4Active = ga4Enabled && ga4ConnectionStatus === "connected";
    const facebookConfigured = Boolean(facebookData?.configured);
    const facebookActive = facebookEnabled && facebookConnectionStatus === "connected";
    const ghlActiveForEvents = ghlEnabled && ghlConfigured;
    const telegramActiveForEvents = telegramEnabled && telegramConfigured && telegramNotifyOnNewSignup;
    const websiteEvents = useMemo<WebsiteEventSetup[]>(() => {
        const rows: WebsiteEventSetup[] = [
            {
                key: "complete_registration",
                name: "CompleteRegistration",
                trigger: t("When a new user signs up"),
                ga4: ga4Active,
                facebook: facebookActive,
                ghl: null,
                telegram: telegramActiveForEvents,
                active: ga4Active || facebookActive || telegramActiveForEvents,
            },
            {
                key: "lead",
                name: "Lead",
                trigger: t("When onboarding is completed"),
                ga4: ga4Active,
                facebook: facebookActive,
                ghl: ghlActiveForEvents,
                telegram: null,
                active: ga4Active || facebookActive || ghlActiveForEvents,
            },
            {
                key: "view_content",
                name: "ViewContent",
                trigger: t("When a user opens a post"),
                ga4: ga4Active,
                facebook: facebookActive,
                ghl: null,
                telegram: null,
                active: ga4Active || facebookActive,
            },
            {
                key: "initiate_checkout",
                name: "InitiateCheckout",
                trigger: t("When checkout is started"),
                ga4: ga4Active,
                facebook: facebookActive,
                ghl: null,
                telegram: null,
                active: ga4Active || facebookActive,
            },
            {
                key: "purchase",
                name: "Purchase",
                trigger: t("When a payment is completed"),
                ga4: ga4Active,
                facebook: facebookActive,
                ghl: null,
                telegram: null,
                active: ga4Active || facebookActive,
            },
        ];

        return rows;
    }, [facebookActive, ga4Active, ghlActiveForEvents, t, telegramActiveForEvents]);

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

            // Only include api_key if it was entered/changed by user
            if (ghlApiKey && ghlApiKey.trim().length > 0) {
                payload.api_key = ghlApiKey.trim();
            }

            // Only include location_id if present
            if (ghlLocationId && ghlLocationId.trim().length > 0) {
                payload.location_id = ghlLocationId.trim();
            }

            // Always include field mappings (can be empty object)
            payload.custom_field_mappings = Object.fromEntries(
                Object.entries(ghlCustomFieldMappings)
                    .map(([sourceKey, mappedKey]) => [sourceKey.trim(), (mappedKey || "").trim()])
                    .filter(([sourceKey, mappedKey]) =>
                        sourceKey.length > 0 &&
                        mappedKey.length > 0 &&
                        GHL_MAPPING_SOURCE_FIELD_SET.has(sourceKey)
                    )
            );

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
            // Clear the API key input after successful save (it will show masked on reload)
            setGhlApiKey("");

            await queryClient.invalidateQueries({ queryKey: ["/api/admin/ghl"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/ghl/custom-fields"] });
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
                notify_on_new_signup: telegramNotifyOnNewSignup,
                chat_ids: telegramChatIds,
            };

            // Only include bot_token if it was entered/changed by user
            if (telegramBotToken && telegramBotToken.trim().length > 0) {
                payload.bot_token = telegramBotToken.trim();
            }

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
            // Clear the bot token input after successful save (it will show masked on reload)
            setTelegramBotToken("");

            await queryClient.invalidateQueries({ queryKey: ["/api/admin/telegram"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations/status"] });
            toast({ title: t("Telegram settings saved") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to save"), description: e.message, variant: "destructive" });
        },
    });

    const testGa4Mutation = useMutation({
        mutationFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/ga4/test", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({
                    measurement_id: ga4MeasurementId || undefined,
                    api_secret: ga4ApiSecret || undefined,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.message || "Test failed");
            return result;
        },
        onSuccess: () => {
            setGa4ConnectionStatus("connected");
            toast({ title: t("Connection successful"), description: t("GA4 connection verified") });
        },
        onError: (e: any) => {
            setGa4ConnectionStatus("error");
            toast({ title: t("Connection failed"), description: e.message, variant: "destructive" });
        },
    });

    const saveGa4Mutation = useMutation({
        mutationFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const payload: Record<string, unknown> = { enabled: ga4Enabled };

            if (ga4MeasurementId && ga4MeasurementId.trim().length > 0) {
                payload.measurement_id = ga4MeasurementId.trim();
            }

            // Only include api_secret if it was entered/changed by user
            if (ga4ApiSecret && ga4ApiSecret.trim().length > 0) {
                payload.api_secret = ga4ApiSecret.trim();
            }

            const res = await fetch("/api/admin/ga4", {
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
            // Clear the API secret input after successful save (it will show masked on reload)
            setGa4ApiSecret("");

            await queryClient.invalidateQueries({ queryKey: ["/api/admin/ga4"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations/status"] });
            toast({ title: t("GA4 settings saved") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to save"), description: e.message, variant: "destructive" });
        },
    });

    const testFacebookMutation = useMutation({
        mutationFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/facebook-dataset/test", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({
                    dataset_id: facebookDatasetId || undefined,
                    access_token: facebookAccessToken || undefined,
                    test_event_code: facebookTestEventCode || undefined,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.message || "Test failed");
            return result;
        },
        onSuccess: () => {
            setFacebookConnectionStatus("connected");
            toast({ title: t("Connection successful"), description: t("Facebook Dataset connection verified") });
        },
        onError: (e: any) => {
            setFacebookConnectionStatus("error");
            toast({ title: t("Connection failed"), description: e.message, variant: "destructive" });
        },
    });

    const saveFacebookMutation = useMutation({
        mutationFn: async () => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const payload: Record<string, unknown> = { enabled: facebookEnabled };

            if (facebookDatasetId && facebookDatasetId.trim().length > 0) {
                payload.dataset_id = facebookDatasetId.trim();
            }

            // Only include access_token if it was entered/changed by user
            if (facebookAccessToken && facebookAccessToken.trim().length > 0) {
                payload.access_token = facebookAccessToken.trim();
            }

            payload.test_event_code = facebookTestEventCode || null;

            const res = await fetch("/api/admin/facebook-dataset", {
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
            // Clear the access token input after successful save (it will show masked on reload)
            setFacebookAccessToken("");

            await queryClient.invalidateQueries({ queryKey: ["/api/admin/facebook-dataset"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations/status"] });
            toast({ title: t("Facebook Dataset settings saved") });
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

    const handleGhlFieldMappingChange = (sourceField: string, targetField: string) => {
        setGhlCustomFieldMappings((current) => {
            const next = { ...current };
            if (targetField.trim()) {
                next[sourceField] = targetField.trim();
            } else {
                delete next[sourceField];
            }
            return next;
        });
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

    const handleTestGa4 = () => {
        if (!ga4MeasurementId) {
            toast({
                title: t("Measurement ID required"),
                description: t("Enter a Measurement ID before testing the connection."),
                variant: "destructive",
            });
            return;
        }
        testGa4Mutation.mutate();
    };

    const handleSaveGa4 = () => {
        if (ga4Enabled && ga4ConnectionStatus !== "connected") {
            toast({
                title: t("Test connection first"),
                description: t("Please test the connection before enabling the integration."),
                variant: "destructive",
            });
            return;
        }
        saveGa4Mutation.mutate();
    };

    const handleTestFacebook = () => {
        if (!facebookDatasetId) {
            toast({
                title: t("Dataset ID required"),
                description: t("Enter a Dataset ID before testing the connection."),
                variant: "destructive",
            });
            return;
        }
        testFacebookMutation.mutate();
    };

    const handleSaveFacebook = () => {
        if (facebookEnabled && facebookConnectionStatus !== "connected") {
            toast({
                title: t("Test connection first"),
                description: t("Please test the connection before enabling the integration."),
                variant: "destructive",
            });
            return;
        }
        saveFacebookMutation.mutate();
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
                                        placeholder={
                                            ghlData?.api_key_masked
                                                ? "••••••••••••••••"
                                                : t("Enter API key")
                                        }
                                        disabled={saveGhlMutation.isPending || testGhlMutation.isPending}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {ghlData?.api_key_masked
                                            ? t("Leave empty to keep current key, or enter new key to update")
                                            : t("Find this in GHL under Settings > API Key")}
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

                            <div className="space-y-3 rounded-md border p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium">{t("Custom Field Mapping")}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {t("Map lead fields from this app to GHL custom fields.")}
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => refetchGhlCustomFields()}
                                        disabled={isGhlCustomFieldsLoading || !ghlConfigured}
                                    >
                                        {isGhlCustomFieldsLoading ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                {t("Loading...")}
                                            </>
                                        ) : t("Refresh Fields")}
                                    </Button>
                                </div>

                                {!ghlConfigured ? (
                                    <p className="text-xs text-muted-foreground">
                                        {t("Save API key and Location ID first to load custom fields.")}
                                    </p>
                                ) : ghlCustomFieldsError ? (
                                    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                        <p className="font-medium">{t("Failed to load custom fields")}</p>
                                        <p className="text-xs mt-1">{ghlCustomFieldsError instanceof Error ? ghlCustomFieldsError.message : String(ghlCustomFieldsError)}</p>
                                        <p className="text-xs mt-1">{t("Click 'Refresh Fields' to try again or check your API credentials.")}</p>
                                    </div>
                                ) : (
                                    <>
                                        {ghlCustomFields.length === 0 && !isGhlCustomFieldsLoading ? (
                                            <p className="text-xs text-muted-foreground">
                                                {t("No custom fields found in your GHL location. Create custom fields in GHL first, then click 'Refresh Fields'.")}
                                            </p>
                                        ) : null}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {GHL_MAPPING_SOURCE_FIELDS.map((field) => (
                                                <div key={field.key} className="space-y-1">
                                                    <Label htmlFor={`ghl-map-${field.key}`} className="text-xs text-muted-foreground">
                                                        {t(field.label)}
                                                    </Label>
                                                    <select
                                                        id={`ghl-map-${field.key}`}
                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        value={ghlCustomFieldMappings[field.key] || ""}
                                                        onChange={(event) => handleGhlFieldMappingChange(field.key, event.target.value)}
                                                        disabled={saveGhlMutation.isPending || testGhlMutation.isPending || isGhlCustomFieldsLoading}
                                                    >
                                                        <option value="">{t("Not mapped")}</option>
                                                        <optgroup label={t("Standard Fields")}>
                                                            {GHL_STANDARD_TARGET_FIELDS.map((standardField) => (
                                                                <option
                                                                    key={standardField.key}
                                                                    value={`${GHL_STANDARD_MAPPING_PREFIX}${standardField.key}`}
                                                                >
                                                                    {t(standardField.label)}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                        {ghlCustomFields.length > 0 ? (
                                                            <optgroup label={t("Custom Fields")}>
                                                                {ghlCustomFields.map((customField) => {
                                                                    const fieldValue = (customField.key || customField.id).trim();
                                                                    const fieldName = customField.name.trim();
                                                                    const showKey = fieldValue && fieldValue !== fieldName;
                                                                    return (
                                                                        <option key={`${customField.id}:${fieldValue}`} value={fieldValue}>
                                                                            {showKey ? `${fieldName} (${fieldValue})` : fieldName}
                                                                        </option>
                                                                    );
                                                                })}
                                                            </optgroup>
                                                        ) : null}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
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
                            ) : ghlConfigured && !ghlEnabled ? (
                                <div className="rounded-md border px-3 py-2 text-sm flex items-center gap-2 border-border/60 text-muted-foreground">
                                    <AlertCircle className="w-4 h-4" />
                                    <span>{t("Configured - Enable integration to start sync")}</span>
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

                    {/* GA4 Integration Card */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <BarChart3 className="w-4 h-4" />
                                        {t("Google Analytics 4")}
                                    </CardTitle>
                                    <CardDescription>{t("Server-side event tracking with Measurement Protocol.")}</CardDescription>
                                </div>
                                <Switch
                                    checked={ga4Enabled}
                                    onCheckedChange={setGa4Enabled}
                                    disabled={saveGa4Mutation.isPending || !ga4Configured}
                                    aria-label={t("Toggle GA4")}
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="ga4-measurement-id">{t("Measurement ID")}</Label>
                                    <Input
                                        id="ga4-measurement-id"
                                        value={ga4MeasurementId}
                                        onChange={(e) => setGa4MeasurementId(e.target.value)}
                                        placeholder="G-XXXXXXXXXX"
                                        disabled={saveGa4Mutation.isPending || testGa4Mutation.isPending}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="ga4-api-secret">{t("API Secret")}</Label>
                                    <Input
                                        id="ga4-api-secret"
                                        type="password"
                                        value={ga4ApiSecret}
                                        onChange={(e) => setGa4ApiSecret(e.target.value)}
                                        placeholder={
                                            ga4Data?.api_secret_masked
                                                ? "••••••••••••••••"
                                                : t("Enter API secret")
                                        }
                                        disabled={saveGa4Mutation.isPending || testGa4Mutation.isPending}
                                    />
                                </div>
                            </div>

                            {ga4Active ? (
                                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{
                                    borderColor: "color-mix(in srgb, var(--app-success-color) 45%, transparent)",
                                    backgroundColor: "color-mix(in srgb, var(--app-success-color) 12%, transparent)",
                                    color: "var(--app-success-color)",
                                }}>
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>{t("Integration Active")}</span>
                                </div>
                            ) : ga4Configured ? (
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
                                    onClick={handleTestGa4}
                                    disabled={testGa4Mutation.isPending || saveGa4Mutation.isPending || !ga4MeasurementId}
                                >
                                    {testGa4Mutation.isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            {t("Testing...")}
                                        </>
                                    ) : t("Test Connection")}
                                </Button>
                                <Button onClick={handleSaveGa4} disabled={saveGa4Mutation.isPending || testGa4Mutation.isPending}>
                                    {saveGa4Mutation.isPending ? t("Saving...") : t("Save Integration")}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Facebook Dataset Integration Card */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Megaphone className="w-4 h-4" />
                                        {t("Facebook Dataset")}
                                    </CardTitle>
                                    <CardDescription>{t("Send server-side conversion events to Meta.")}</CardDescription>
                                </div>
                                <Switch
                                    checked={facebookEnabled}
                                    onCheckedChange={setFacebookEnabled}
                                    disabled={saveFacebookMutation.isPending || !facebookConfigured}
                                    aria-label={t("Toggle Facebook Dataset")}
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="facebook-dataset-id">{t("Dataset ID")}</Label>
                                    <Input
                                        id="facebook-dataset-id"
                                        value={facebookDatasetId}
                                        onChange={(e) => setFacebookDatasetId(e.target.value)}
                                        placeholder={t("Enter dataset ID")}
                                        disabled={saveFacebookMutation.isPending || testFacebookMutation.isPending}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="facebook-access-token">{t("Access Token")}</Label>
                                    <Input
                                        id="facebook-access-token"
                                        type="password"
                                        value={facebookAccessToken}
                                        onChange={(e) => setFacebookAccessToken(e.target.value)}
                                        placeholder={
                                            facebookData?.access_token_masked
                                                ? "••••••••••••••••"
                                                : t("Enter access token")
                                        }
                                        disabled={saveFacebookMutation.isPending || testFacebookMutation.isPending}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="facebook-test-event-code">{t("Test Event Code (optional)")}</Label>
                                <Input
                                    id="facebook-test-event-code"
                                    value={facebookTestEventCode}
                                    onChange={(e) => setFacebookTestEventCode(e.target.value)}
                                    placeholder={t("Enter test event code")}
                                    disabled={saveFacebookMutation.isPending || testFacebookMutation.isPending}
                                />
                            </div>

                            {facebookActive ? (
                                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{
                                    borderColor: "color-mix(in srgb, var(--app-success-color) 45%, transparent)",
                                    backgroundColor: "color-mix(in srgb, var(--app-success-color) 12%, transparent)",
                                    color: "var(--app-success-color)",
                                }}>
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>{t("Integration Active")}</span>
                                </div>
                            ) : facebookConfigured ? (
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
                                    onClick={handleTestFacebook}
                                    disabled={testFacebookMutation.isPending || saveFacebookMutation.isPending || !facebookDatasetId}
                                >
                                    {testFacebookMutation.isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            {t("Testing...")}
                                        </>
                                    ) : t("Test Connection")}
                                </Button>
                                <Button onClick={handleSaveFacebook} disabled={saveFacebookMutation.isPending || testFacebookMutation.isPending}>
                                    {saveFacebookMutation.isPending ? t("Saving...") : t("Save Integration")}
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
                                        placeholder={
                                            telegramData?.bot_token_masked
                                                ? "••••••••••••••••"
                                                : t("Enter bot token")
                                        }
                                        disabled={saveTelegramMutation.isPending || testTelegramMutation.isPending}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {telegramData?.bot_token_masked
                                            ? t("Leave empty to keep current token, or enter new token to update")
                                            : t("Create a bot with @BotFather and paste the token here.")}
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
                                    <p className="text-sm font-medium">{t("Notify on new signup")}</p>
                                    <p className="text-xs text-muted-foreground">{t("When enabled, each new user signup sends a Telegram alert.")}</p>
                                </div>
                                <Switch
                                    checked={telegramNotifyOnNewSignup}
                                    onCheckedChange={setTelegramNotifyOnNewSignup}
                                    disabled={saveTelegramMutation.isPending || testTelegramMutation.isPending}
                                    aria-label={t("Toggle notify on new signup")}
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

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Website Events")}</CardTitle>
                            <CardDescription>{t("Events configured in the platform and whether they are currently active.")}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {websiteEvents.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t("No website events configured yet.")}</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-border/60 text-left text-muted-foreground">
                                                <th className="py-2 pr-3">{t("Event")}</th>
                                                <th className="py-2 pr-3">{t("Trigger")}</th>
                                                <th className="py-2 pr-3">{t("GA4")}</th>
                                                <th className="py-2 pr-3">{t("Facebook")}</th>
                                                <th className="py-2 pr-3">{t("GHL")}</th>
                                                <th className="py-2 pr-3">{t("Telegram")}</th>
                                                <th className="py-2">{t("Status")}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {websiteEvents.map((event) => (
                                                <tr key={event.key} className="border-b border-border/40">
                                                    <td className="py-2 pr-3 font-medium">{event.name}</td>
                                                    <td className="py-2 pr-3 text-muted-foreground">{event.trigger}</td>
                                                    <td className="py-2 pr-3">
                                                        {event.ga4 === null ? (
                                                            <span className="text-muted-foreground">-</span>
                                                        ) : (
                                                            <Badge variant={event.ga4 ? "default" : "secondary"}>{event.ga4 ? t("Active") : t("Inactive")}</Badge>
                                                        )}
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                        {event.facebook === null ? (
                                                            <span className="text-muted-foreground">-</span>
                                                        ) : (
                                                            <Badge variant={event.facebook ? "default" : "secondary"}>{event.facebook ? t("Active") : t("Inactive")}</Badge>
                                                        )}
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                        {event.ghl === null ? (
                                                            <span className="text-muted-foreground">-</span>
                                                        ) : (
                                                            <Badge variant={event.ghl ? "default" : "secondary"}>{event.ghl ? t("Active") : t("Inactive")}</Badge>
                                                        )}
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                        {event.telegram === null ? (
                                                            <span className="text-muted-foreground">-</span>
                                                        ) : (
                                                            <Badge variant={event.telegram ? "default" : "secondary"}>{event.telegram ? t("Active") : t("Inactive")}</Badge>
                                                        )}
                                                    </td>
                                                    <td className="py-2">
                                                        <Badge variant={event.active ? "default" : "secondary"}>{event.active ? t("Active") : t("Inactive")}</Badge>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </CardContent>
            </Card>
        </div>
    );
}
