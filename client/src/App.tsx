import { Suspense, lazy } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PostCreatorProvider, usePostCreator } from "@/lib/post-creator";
import { PostViewerProvider, usePostViewer } from "@/lib/post-viewer";
import { AdminModeProvider, useAdminMode } from "@/lib/admin-mode";
import { AppSettingsProvider, useAppSettings } from "@/lib/app-settings";
import { useTranslation } from "@/hooks/useTranslation";
import { LanguageProvider } from "@/context/LanguageContext";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Seo, buildPageTitle } from "@/components/seo";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { Loader2, Shield, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/page-loader";

const LandingPage = lazy(() => import("@/pages/landing"));
const PrivacyPage = lazy(() => import("@/pages/privacy"));
const TermsPage = lazy(() => import("@/pages/terms"));
const AuthPage = lazy(() => import("@/pages/auth"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const PostsPage = lazy(() => import("@/pages/posts"));
const AdminPage = lazy(() => import("@/pages/admin"));
const CreditsPage = lazy(() => import("@/pages/credits"));
const AffiliateDashboardPage = lazy(() => import("@/pages/affiliate-dashboard"));
const PostCreatorDialog = lazy(() => import("@/components/post-creator-dialog").then((mod) => ({ default: mod.PostCreatorDialog })));
const PostViewerDialog = lazy(() => import("@/components/post-viewer-dialog").then((mod) => ({ default: mod.PostViewerDialog })));

function FullScreenSuspenseFallback() {
  return <PageLoader />;
}

function ContentSuspenseFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function LazyPostCreatorDialogMount() {
  const { isOpen } = usePostCreator();

  if (!isOpen) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <PostCreatorDialog />
    </Suspense>
  );
}

function LazyPostViewerDialogMount() {
  const { viewingPost } = usePostViewer();

  if (!viewingPost) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <PostViewerDialog />
    </Suspense>
  );
}

function AdminBillingRedirect() {
  const { profile } = useAuth();
  const [, setLocation] = useLocation();

  if (profile?.is_admin) {
    setLocation("/dashboard");
    return null;
  }

  return <CreditsPage />;
}

function getPrivatePageTitle(pathname: string, appName: string) {
  if (pathname.startsWith("/settings")) {
    return buildPageTitle("Settings", appName);
  }

  if (pathname.startsWith("/billing")) {
    return buildPageTitle("Billing", appName);
  }

  if (pathname.startsWith("/credits")) {
    return buildPageTitle("Billing", appName);
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
  const { isAdminMode, setAdminMode } = useAdminMode();
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
        <PageLoader />
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
        <Suspense fallback={<FullScreenSuspenseFallback />}>
          <OnboardingPage />
        </Suspense>
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
                          setAdminMode(false);
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
                    <Suspense fallback={<ContentSuspenseFallback />}>
                      <AdminPage initialTab={adminTab} />
                    </Suspense>
                  </main>
                </div>
              </div>
            </SidebarProvider>
            <LazyPostCreatorDialogMount />
            <LazyPostViewerDialogMount />
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
                          setAdminMode(true);
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
                  <Suspense fallback={<ContentSuspenseFallback />}>
                    <Switch>
                      <Route path="/dashboard" component={PostsPage} />
                      <Route path="/posts">
                        <Redirect to="/dashboard" />
                      </Route>
                      <Route path="/settings" component={SettingsPage} />
                      <Route path="/credits">
                        <Redirect to="/billing" />
                      </Route>
                      <Route path="/billing" component={AdminBillingRedirect} />
                      <Route path="/affiliate" component={AffiliateDashboardPage} />
                      <Route path="/admin">
                        <Redirect to="/dashboard" />
                      </Route>
                      <Route>
                        <Redirect to="/dashboard" />
                      </Route>
                    </Switch>
                  </Suspense>
                </main>
              </div>
            </div>
          </SidebarProvider>
          <LazyPostCreatorDialogMount />
          <LazyPostViewerDialogMount />
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
  const searchParams = new URLSearchParams(window.location.search);
  const requestedTab = searchParams.get("tab");
  const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  const isRecoveryFlow = requestedTab === "reset" || hashParams.get("type") === "recovery";

  if (loading) {
    return (
      <>
        <Seo
          title={buildPageTitle("Sign In", appName)}
          description={description}
          path="/login"
          noindex
        />
        <PageLoader />
      </>
    );
  }

  if (user && !isRecoveryFlow) {
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
      <Suspense fallback={<FullScreenSuspenseFallback />}>
        <AuthPage />
      </Suspense>
    </>
  );
}

function AppRouter() {
  return (
    <Suspense fallback={<FullScreenSuspenseFallback />}>
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
        <Route path="/billing">
          <AppContent />
        </Route>
        <Route path="/onboarding">
          <AppContent />
        </Route>
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </Suspense>
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
