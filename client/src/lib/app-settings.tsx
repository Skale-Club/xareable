import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppSettings } from "@shared/schema";

const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;
const GTM_SCRIPT_ID = "gtm-script";
const GTM_NOSCRIPT_ID = "gtm-noscript";

function normalizeGtmContainerId(value: string | null | undefined): string | null {
    const trimmed = value?.trim() || "";
    if (!trimmed) {
        return null;
    }
    return trimmed.toUpperCase();
}

function removeGtmElements() {
    document.getElementById(GTM_SCRIPT_ID)?.remove();
    document.getElementById(GTM_NOSCRIPT_ID)?.remove();
}

interface AppSettingsContextType {
    settings: AppSettings | null;
    loading: boolean;
    refresh: () => Promise<void>;
}

const AppSettingsContext = createContext<AppSettingsContextType>({
    settings: null,
    loading: true,
    refresh: async () => { },
});

export function AppSettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchSettings = async () => {
        try {
            const res = await fetch("/api/settings");
            if (res.ok) {
                const data = await res.json();
                setSettings(data);
            }
        } catch (err) {
            console.error("Failed to fetch app settings:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    useEffect(() => {
        if (!settings?.favicon_url) {
            return;
        }

        const favicon = document.querySelector('link[rel="icon"]');
        if (favicon) {
            favicon.setAttribute("href", settings.favicon_url);
        }
    }, [settings?.favicon_url]);

    useEffect(() => {
        const containerId = normalizeGtmContainerId(settings?.gtm_container_id);
        const shouldEnable = Boolean(settings?.gtm_enabled && containerId && GTM_CONTAINER_ID_REGEX.test(containerId));

        if (!shouldEnable || !containerId) {
            removeGtmElements();
            return;
        }

        const existingScript = document.getElementById(GTM_SCRIPT_ID) as HTMLScriptElement | null;
        if (existingScript?.dataset.gtmId === containerId) {
            return;
        }

        removeGtmElements();

        const windowWithDataLayer = window as typeof window & {
            dataLayer?: Array<Record<string, unknown>>;
        };
        windowWithDataLayer.dataLayer = windowWithDataLayer.dataLayer || [];
        windowWithDataLayer.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

        const script = document.createElement("script");
        script.id = GTM_SCRIPT_ID;
        script.async = true;
        script.dataset.gtmId = containerId;
        script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
        document.head.appendChild(script);

        const noscript = document.createElement("noscript");
        noscript.id = GTM_NOSCRIPT_ID;
        noscript.dataset.gtmId = containerId;

        const iframe = document.createElement("iframe");
        iframe.src = `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(containerId)}`;
        iframe.height = "0";
        iframe.width = "0";
        iframe.style.display = "none";
        iframe.style.visibility = "hidden";

        noscript.appendChild(iframe);
        document.body.prepend(noscript);
    }, [settings?.gtm_enabled, settings?.gtm_container_id]);

    return (
        <AppSettingsContext.Provider value={{
            settings,
            loading,
            refresh: fetchSettings
        }}>
            {children}
        </AppSettingsContext.Provider>
    );
}

export const useAppSettings = () => useContext(AppSettingsContext);

// Convenience hook for just the app name
export const useAppName = () => {
    const { settings } = useAppSettings();
    return settings?.app_name || "";
};

// Convenience hook for just the logo URL
export const useAppLogo = () => {
    const { settings } = useAppSettings();
    return settings?.logo_url;
};

// Convenience hook for brand colors
export const useAppColors = () => {
    const { settings } = useAppSettings();
    return {
        primary: settings?.primary_color || "#8b5cf6",
        secondary: settings?.secondary_color || "#ec4899",
    };
};
