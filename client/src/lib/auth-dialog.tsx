import { createContext, useContext, useState, type ReactNode } from "react";

export type AuthDialogTab = "signin" | "signup" | "reset";

interface AuthDialogState {
  isOpen: boolean;
  initialTab: AuthDialogTab;
  redirectPath: string;
  openDialog: (tab?: AuthDialogTab, redirectPath?: string) => void;
  closeDialog: () => void;
}

const AuthDialogContext = createContext<AuthDialogState | null>(null);

export function AuthDialogProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<AuthDialogTab>("signin");
  const [redirectPath, setRedirectPath] = useState<string>("/dashboard");

  function openDialog(tab: AuthDialogTab = "signin", redirect?: string) {
    setInitialTab(tab);
    setRedirectPath(redirect || "/dashboard");
    setIsOpen(true);
  }

  function closeDialog() {
    setIsOpen(false);
  }

  return (
    <AuthDialogContext.Provider
      value={{ isOpen, initialTab, redirectPath, openDialog, closeDialog }}
    >
      {children}
    </AuthDialogContext.Provider>
  );
}

export function useAuthDialog() {
  const context = useContext(AuthDialogContext);
  if (!context) {
    throw new Error("useAuthDialog must be used within AuthDialogProvider");
  }
  return context;
}
