import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { AppSettings } from "@shared/schema";

const GTM_CONTAINER_ID_REGEX = /^GTM-[A-Z0-9]+$/i;
const GTM_SCRIPT_ID = "gtm-script";
const GTM_NOSCRIPT_ID = "gtm-noscript";
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_PRIMARY_COLOR = "#8b5cf6";
const DEFAULT_SECONDARY_COLOR = "#ec4899";
const DEFAULT_SUCCESS_COLOR = "#10b981";
const DEFAULT_ERROR_COLOR = "#ef4444";

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

function normalizeHexColor(value: string | null | undefined, fallback: string): string {
    if (!value) {
        return fallback;
    }
    return HEX_COLOR_REGEX.test(value.trim()) ? value.trim() : fallback;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const normalized = hex.replace("#", "");
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
}

function rgbToHslToken(r: number, g: number, b: number): string {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;

    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    const l = (max + min) / 2;

    let h = 0;
    if (delta !== 0) {
        if (max === rn) h = ((gn - bn) / delta) % 6;
        else if (max === gn) h = (bn - rn) / delta + 2;
        else h = (rn - gn) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
    }

    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function getReadableForegroundHslToken(hex: string): string {
    const { r, g, b } = hexToRgb(hex);
    const srgb = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    return luminance > 0.45 ? "0 0% 10%" : "0 0% 98%";
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

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/settings?t=${Date.now()}`, {
                cache: "no-store",
                headers: {
                    "Cache-Control": "no-cache, no-store, max-age=0",
                    Pragma: "no-cache",
                },
            });
            if (res.ok) {
                const data = await res.json() as Partial<AppSettings>;
                setSettings({
                    ...(data as AppSettings),
                    primary_color: normalizeHexColor(data.primary_color, DEFAULT_PRIMARY_COLOR),
                    secondary_color: normalizeHexColor(data.secondary_color, DEFAULT_SECONDARY_COLOR),
                    success_color: normalizeHexColor(data.success_color, DEFAULT_SUCCESS_COLOR),
                    error_color: normalizeHexColor(data.error_color, DEFAULT_ERROR_COLOR),
                });
            }
        } catch (err) {
            console.error("Failed to fetch app settings:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

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
        const root = document.documentElement;
        const primaryColor = normalizeHexColor(settings?.primary_color, DEFAULT_PRIMARY_COLOR);
        const secondaryColor = normalizeHexColor(settings?.secondary_color, DEFAULT_SECONDARY_COLOR);
        const successColor = normalizeHexColor(settings?.success_color, DEFAULT_SUCCESS_COLOR);
        const errorColor = normalizeHexColor(settings?.error_color, DEFAULT_ERROR_COLOR);
        const { r, g, b } = hexToRgb(errorColor);
        const destructiveHsl = rgbToHslToken(r, g, b);
        const destructiveForegroundHsl = getReadableForegroundHslToken(errorColor);

        root.style.setProperty("--app-primary-color", primaryColor);
        root.style.setProperty("--app-secondary-color", secondaryColor);
        root.style.setProperty("--app-success-color", successColor);
        root.style.setProperty("--app-error-color", errorColor);
        root.style.setProperty("--destructive", destructiveHsl);
        root.style.setProperty("--destructive-foreground", destructiveForegroundHsl);
    }, [settings?.primary_color, settings?.secondary_color, settings?.success_color, settings?.error_color]);

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
        primary: normalizeHexColor(settings?.primary_color, DEFAULT_PRIMARY_COLOR),
        secondary: normalizeHexColor(settings?.secondary_color, DEFAULT_SECONDARY_COLOR),
        success: normalizeHexColor(settings?.success_color, DEFAULT_SUCCESS_COLOR),
        error: normalizeHexColor(settings?.error_color, DEFAULT_ERROR_COLOR),
    };
};
