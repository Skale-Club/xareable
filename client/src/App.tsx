import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PostCreatorProvider } from "@/lib/post-creator";
import { PostViewerProvider } from "@/lib/post-viewer";
import { AdminModeProvider, useAdminMode } from "@/lib/admin-mode";
import { AppSettingsProvider, useAppSettings } from "@/lib/app-settings";
import { useTranslation } from "@/hooks/useTranslation";
import { LanguageProvider } from "@/context/LanguageContext";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { PostCreatorDialog } from "@/components/post-creator-dialog";
import { PostViewerDialog } from "@/components/post-viewer-dialog";
import { Seo, buildPageTitle } from "@/components/seo";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { Loader2, Shield, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";

import LandingPage from "@/pages/landing";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import AuthPage from "@/pages/auth";
import SettingsPage from "@/pages/settings";
import OnboardingPage from "@/pages/onboarding";
import PostsPage from "@/pages/posts";
import AdminPage from "@/pages/admin";
import CreditsPage from "@/pages/credits";
import AffiliateDashboardPage from "@/pages/affiliate-dashboard";
import NotFound from "@/pages/not-found";

function getPrivatePageTitle(pathname: string, appName: string) {
  if (pathname.startsWith("/settings")) {
    return buildPageTitle("Settings", appName);
  }

  if (pathname.startsWith("/credits")) {
    return buildPageTitle("Credits", appName);
  }

  if (pathname.startsWith("/affiliate")) {
    return buildPageTitle("Affiliate", appName);
  }

  if (pathname.startsWith("/admin")) {
    return buildPageTitle("Admin", appName);
  }

  if (pathname.startsWith("/onboarding")) {
    return buildPageTitle("Onboarding", appName);
  }

  return buildPageTitle("Dashboard", appName);
}

function AppContent() {
  const { user, profile, brand, loading } = useAuth();
  const { isAdminMode, toggleMode } = useAdminMode();
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const appName = settings?.app_name || "";
  const privateDescription =
    settings?.app_description ||
    settings?.meta_description ||
    undefined;

  if (loading) {
    return (
      <>
        <Seo
          title={getPrivatePageTitle(location, appName)}
          description={privateDescription}
          path={location}
          noindex
        />
	          <div className="min-h-screen flex items-center justify-center bg-background">
	          <div className="flex flex-col items-center gap-3">
	            <Loader2 className="w-8 h-8 animate-spin text-primary" />
	            <p className="text-sm text-muted-foreground">{t("Loading...")}</p>
	          </div>
	        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Seo
          title={buildPageTitle("Authentication Required", appName)}
          description={privateDescription}
          path={location}
          noindex
        />
        <Redirect to={`/login?redirect=${encodeURIComponent(location)}`} />
      </>
    );
  }

  if (!brand) {
    return (
      <>
        <Seo
          title={buildPageTitle("Onboarding", appName)}
          description={privateDescription}
          path={location}
          noindex
        />
        <OnboardingPage />
      </>
    );
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  // If in admin mode and user is admin, show admin page
  if (isAdminMode && profile?.is_admin && location.startsWith("/admin")) {
    // Extract the tab from the URL
    const adminTabSegment = location.split("/")[2] || "users";
    const adminTab = adminTabSegment === "styles" ? "post-creation" : adminTabSegment;

    return (
      <>
        <Seo
          title={buildPageTitle("Admin", appName)}
          description={privateDescription}
          path={location}
          noindex
        />
        <PostCreatorProvider>
          <PostViewerProvider>
            <SidebarProvider style={style as React.CSSProperties}>
	              <div className="flex h-screen w-full">
	                <AppSidebar />
	                <div className="flex flex-col flex-1 min-w-0">
	                  <header className="flex items-center justify-between gap-2 p-2 border-b h-12 flex-shrink-0">
	                    <SidebarTrigger data-testid="button-sidebar-toggle" />
	                    <div className="flex items-center gap-2">
	                      <LanguageToggle />
	                      <Button
	                        variant="outline"
	                        size="sm"
	                        onClick={() => {
	                          toggleMode();
	                          setLocation("/dashboard");
	                        }}
	                        className="gap-2"
	                        data-testid="btn-exit-admin"
	                      >
	                        <ShieldOff className="w-4 h-4" />
	                        <span>{t("Exit Admin")}</span>
	                      </Button>
	                    </div>
	                  </header>
	                  <main className="flex-1 overflow-hidden flex flex-col">
	                    <AdminPage initialTab={adminTab} />
                  </main>
                </div>
              </div>
            </SidebarProvider>
            <PostCreatorDialog />
            <PostViewerDialog />
          </PostViewerProvider>
        </PostCreatorProvider>
      </>
    );
  }

  // User mode - show regular dashboard
  return (
    <>
      <Seo
        title={getPrivatePageTitle(location, appName)}
        description={privateDescription}
        path={location}
        noindex
      />
      <PostCreatorProvider>
        <PostViewerProvider>
          <SidebarProvider style={style as React.CSSProperties}>
	            <div className="flex h-screen w-full">
	              <AppSidebar />
	              <div className="flex flex-col flex-1 min-w-0">
	                <header className="flex items-center justify-between gap-2 p-2 border-b h-12 flex-shrink-0">
	                  <SidebarTrigger data-testid="button-sidebar-toggle" />
	                  <div className="flex items-center gap-2">
	                    <LanguageToggle />
	                    {profile?.is_admin && (
	                      <Button
	                        variant="outline"
	                        size="sm"
	                        onClick={() => {
	                          toggleMode();
	                          setLocation("/admin/users");
	                        }}
	                        className="gap-2"
	                        data-testid="btn-admin-panel"
	                      >
	                        <Shield className="w-4 h-4" />
	                        <span>{t("Admin Panel")}</span>
	                      </Button>
	                    )}
	                  </div>
	                </header>
	                <main className="flex-1 overflow-hidden flex flex-col">
	                  <Switch>
                    <Route path="/dashboard" component={PostsPage} />
                    <Route path="/posts">
                      <Redirect to="/dashboard" />
                    </Route>
                    <Route path="/settings" component={SettingsPage} />
                    <Route path="/credits" component={CreditsPage} />
                    <Route path="/affiliate" component={AffiliateDashboardPage} />
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
    </>
  );
}

function AuthGuardedLogin() {
  const { user, loading } = useAuth();
  const { settings } = useAppSettings();
  const appName = settings?.app_name || "";
  const description =
    settings?.app_description ||
    settings?.meta_description ||
    undefined;

  if (loading) {
    return (
      <>
        <Seo
          title={buildPageTitle("Sign In", appName)}
          description={description}
          path="/login"
          noindex
        />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </>
    );
  }

  if (user) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <>
      <Seo
        title={buildPageTitle("Sign In", appName)}
        description={description}
        path="/login"
        noindex
      />
      <AuthPage />
    </>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/terms" component={TermsPage} />
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
      <Route path="/admin/:tab">
        <AppContent />
      </Route>
      <Route path="/affiliate">
        <AppContent />
      </Route>
      <Route path="/credits">
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
        <LanguageProvider>
          <AuthProvider>
            <AppSettingsProvider>
              <AdminModeProvider>
                <AppRouter />
              </AdminModeProvider>
              <Toaster />
            </AppSettingsProvider>
          </AuthProvider>
        </LanguageProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
