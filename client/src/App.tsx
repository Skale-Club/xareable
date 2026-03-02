import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PostCreatorProvider } from "@/lib/post-creator";
import { PostViewerProvider } from "@/lib/post-viewer";
import { AdminModeProvider, useAdminMode } from "@/lib/admin-mode";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { PostCreatorDialog } from "@/components/post-creator-dialog";
import { PostViewerDialog } from "@/components/post-viewer-dialog";
import { Loader2 } from "lucide-react";

import LandingPage from "@/pages/landing";
import AuthPage from "@/pages/auth";
import SettingsPage from "@/pages/settings";
import OnboardingPage from "@/pages/onboarding";
import PostsPage from "@/pages/posts";
import AdminPage from "@/pages/admin";
import NotFound from "@/pages/not-found";

function AppContent() {
  const { user, profile, brand, loading } = useAuth();
  const { isAdminMode } = useAdminMode();
  const [location] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to={`/login?redirect=${encodeURIComponent(location)}`} />;
  }

  if (!brand || !profile?.api_key) {
    return <OnboardingPage />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  // If in admin mode and user is admin, show admin page
  if (isAdminMode && profile?.is_admin) {
    return (
      <PostCreatorProvider>
        <PostViewerProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center gap-2 p-2 border-b h-12 flex-shrink-0">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                </header>
                <main className="flex-1 overflow-hidden flex flex-col">
                  <AdminPage />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <PostCreatorDialog />
          <PostViewerDialog />
        </PostViewerProvider>
      </PostCreatorProvider>
    );
  }

  // User mode - show regular dashboard
  return (
    <PostCreatorProvider>
      <PostViewerProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <header className="flex items-center gap-2 p-2 border-b h-12 flex-shrink-0">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
              </header>
              <main className="flex-1 overflow-hidden flex flex-col">
                <Switch>
                  <Route path="/dashboard" component={PostsPage} />
                  <Route path="/posts">
                    <Redirect to="/dashboard" />
                  </Route>
                  <Route path="/settings" component={SettingsPage} />
                  <Route path="/admin">
                    <Redirect to="/dashboard" />
                  </Route>
                  <Route>
                    <Redirect to="/dashboard" />
                  </Route>
                </Switch>
              </main>
            </div>
          </div>
        </SidebarProvider>
        <PostCreatorDialog />
        <PostViewerDialog />
      </PostViewerProvider>
    </PostCreatorProvider>
  );
}

function AuthGuardedLogin() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Redirect to="/dashboard" />;
  }

  return <AuthPage />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={AuthGuardedLogin} />
      <Route path="/dashboard">
        <AppContent />
      </Route>
      <Route path="/posts">
        <AppContent />
      </Route>
      <Route path="/settings">
        <AppContent />
      </Route>
      <Route path="/admin">
        <AppContent />
      </Route>
      <Route path="/onboarding">
        <AppContent />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AdminModeProvider>
            <AppRouter />
          </AdminModeProvider>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
