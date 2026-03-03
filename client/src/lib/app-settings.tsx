import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppSettings } from "@shared/schema";

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
