import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface AdminModeState {
    isAdminMode: boolean;
    setAdminMode: (value: boolean) => void;
    toggleMode: () => void;
}

const AdminModeContext = createContext<AdminModeState | null>(null);

export function AdminModeProvider({ children }: { children: ReactNode }) {
    const [isAdminMode, setAdminMode] = useState(false);

    const toggleMode = useCallback(() => {
        setAdminMode(prev => !prev);
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
