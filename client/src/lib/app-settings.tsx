import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppSettings } from "@shared/schema";

interface AppSettingsContextType {
    settings: AppSettings | null;
    loading: boolean;
    refresh: () => Promise<void>;
}

const defaultSettings: AppSettings = {
    id: "",
    app_name: "Xareable",
    app_tagline: "AI-Powered Social Media Content Creation",
    app_description: null,
    logo_url: null,
    favicon_url: null,
    primary_color: "#8b5cf6",
    secondary_color: "#ec4899",
    meta_title: "Xareable - AI Social Media Content Creator",
    meta_description: "Create stunning social media images and captions with AI, tailored to your brand identity.",
    og_image_url: null,
    terms_url: null,
    privacy_url: null,
    created_at: "",
    updated_at: "",
    updated_by: null,
};

const AppSettingsContext = createContext<AppSettingsContextType>({
    settings: defaultSettings,
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

    return (
        <AppSettingsContext.Provider value={{
            settings: settings ?? defaultSettings,
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
    return settings?.app_name ?? "Xareable";
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
        primary: settings?.primary_color ?? "#8b5cf6",
        secondary: settings?.secondary_color ?? "#ec4899",
    };
};
