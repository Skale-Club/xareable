import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

const ADMIN_MODE_STORAGE_KEY = "adminMode";

interface AdminModeState {
    isAdminMode: boolean;
    setAdminMode: (value: boolean) => void;
    toggleMode: () => void;
}

const AdminModeContext = createContext<AdminModeState | null>(null);

function getInitialAdminMode(): boolean {
    // Check sessionStorage for persisted admin mode
    if (typeof window !== "undefined") {
        const stored = sessionStorage.getItem(ADMIN_MODE_STORAGE_KEY);
        if (stored !== null) {
            return stored === "true";
        }
        // Also check if the URL starts with /admin to auto-enable admin mode
        if (window.location.pathname.startsWith("/admin")) {
            return true;
        }
    }
    return false;
}

export function AdminModeProvider({ children }: { children: ReactNode }) {
    const [isAdminMode, setAdminModeState] = useState(getInitialAdminMode);

    // Persist admin mode to sessionStorage
    const setAdminMode = useCallback((value: boolean) => {
        setAdminModeState(value);
        sessionStorage.setItem(ADMIN_MODE_STORAGE_KEY, String(value));
    }, []);

    const toggleMode = useCallback(() => {
        setAdminModeState(prev => {
            const newValue = !prev;
            sessionStorage.setItem(ADMIN_MODE_STORAGE_KEY, String(newValue));
            return newValue;
        });
    }, []);

    // Sync admin mode with URL changes (for browser back/forward navigation)
    useEffect(() => {
        const handleStorageChange = () => {
            const stored = sessionStorage.getItem(ADMIN_MODE_STORAGE_KEY);
            if (stored !== null) {
                setAdminModeState(stored === "true");
            }
        };

        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, []);

    return (
        <AdminModeContext.Provider value={{ isAdminMode, setAdminMode, toggleMode }}>
            {children}
        </AdminModeContext.Provider>
    );
}

export function useAdminMode() {
    const context = useContext(AdminModeContext);
    if (!context) throw new Error("useAdminMode must be used within AdminModeProvider");
    return context;
}
