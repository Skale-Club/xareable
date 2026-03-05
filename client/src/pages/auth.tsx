import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Loader2, Sparkles, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { useAppName, useAppSettings } from "@/lib/app-settings";
import { useQuery } from "@tanstack/react-query";
import type { LandingContent } from "@shared/schema";
import { Seo } from "@/components/seo";
import { Logo } from "@/components/logo";
import {
  captureAffiliateRefFromCurrentUrl,
  getStoredAffiliateRef,
} from "@/lib/affiliate-ref";

const GOOGLE_FAVICON_URL = "https://upload.wikimedia.org/wikipedia/commons/3/3c/Google_Favicon_2025.svg";

export default function AuthPage() {
  const appName = useAppName();
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const termsHref = settings?.terms_url || "/terms";
  const privacyHref = settings?.privacy_url || "/privacy";
  const termsExternal = /^https?:\/\//i.test(termsHref);
  const privacyExternal = /^https?:\/\//i.test(privacyHref);

  const searchParams = new URLSearchParams(window.location.search);
  const initialTab = searchParams.get("tab") === "signup" ? "signup" : "signin";
  const [activeTab, setActiveTab] = useState(initialTab);

  const { data: content } = useQuery<LandingContent>({
    queryKey: ["/api/landing/content"],
    queryFn: () => fetch("/api/landing/content").then(res => res.json()),
  });
  const authFaviconUrl = content?.icon_url || settings?.favicon_url || "/favicon.png";

  useEffect(() => {
    captureAffiliateRefFromCurrentUrl();
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "signup") setActiveTab("signup");
  }, []);

  async function handleSignIn() {
    if (!email || !password) {
      toast({ title: t("Please fill in all fields"), variant: "destructive" });
      return;
    }
    setLoading(true);
    const sb = supabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast({ title: t("Sign in failed"), description: error.message, variant: "destructive" });
    } else {
      setLocation("/dashboard");
    }
  }

  async function handleSignUp() {
    if (!email || !password) {
      toast({ title: t("Please fill in all fields"), variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: t("Password must be at least 6 characters"), variant: "destructive" });
      return;
    }
    setLoading(true);
    const sb = supabase();
    const { error } = await sb.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      toast({ title: t("Sign up failed"), description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("Account created!"), description: t("You are now signed in.") });
      setLocation("/dashboard");
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    const sb = supabase();
    const ref = getStoredAffiliateRef();
    const redirectTo = ref
      ? `${window.location.origin}/dashboard?ref=${encodeURIComponent(ref)}`
      : `${window.location.origin}/dashboard`;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });
    setGoogleLoading(false);
    if (error) {
      toast({ title: t("Google sign in failed"), description: error.message, variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="auth-page">
      <Seo
        title={t(activeTab === "signin" ? "Sign In" : "Sign Up")}
        favicon={authFaviconUrl}
      />
      <div className="absolute top-4 right-4 flex items-center gap-3">
        <Link href="/">
          <div className="hidden md:inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors" data-testid="link-back-home-desktop">
            <ArrowLeft className="w-4 h-4" />
            {t("Back to home")}
          </div>
        </Link>
        <LanguageToggle />
      </div>
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/3 w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-primary/3 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <img
              src={authFaviconUrl}
              alt={appName ? `${appName} favicon` : "Favicon"}
              className="w-12 h-12 rounded-xl object-contain"
              data-testid="auth-favicon"
            />
          </div>
          <Logo
            logoUrl={content?.logo_url || settings?.logo_url}
            altLogoUrl={content?.alt_logo_url}
            imageClassName="h-[34px] w-auto"
            containerClassName="flex justify-center mb-4"
            fallbackIconClassName="w-[34px] h-[34px] rounded-xl mx-auto shadow-md"
            fallbackSparklesClassName="w-4 h-4"
            showFallbackText={false}
          />
          <p className="text-sm text-muted-foreground mt-1">
            {t("AI-powered social media content creation")}
          </p>
        </div>

        <Card className="border-b-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <CardHeader className="pb-0">
              <TabsList className="w-full">
                <TabsTrigger value="signin" className="flex-1" data-testid="tab-signin">
                  {t("Sign In")}
                </TabsTrigger>
                <TabsTrigger value="signup" className="flex-1" data-testid="tab-signup">
                  {t("Sign Up")}
                </TabsTrigger>
              </TabsList>
            </CardHeader>

            <TabsContent value="signin">
              <CardContent className="pt-6">
                <CardTitle className="text-lg mb-1">{t("Welcome back")}</CardTitle>
                <CardDescription className="mb-5">
                  {t("Sign in to your account to continue")}
                </CardDescription>
                <div className="space-y-4">
                  <Button
                    variant="outline"
                    onClick={handleGoogleSignIn}
                    className="w-full"
                    disabled={googleLoading}
                    data-testid="button-google-signin"
                  >
                    {googleLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <img
                        src={GOOGLE_FAVICON_URL}
                        alt="Google"
                        className="w-4 h-4 mr-2 object-contain"
                        loading="lazy"
                      />
                    )}
                    {t("Continue with Google")}
                  </Button>
                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">{t("or")}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">{t("Email")}</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder={t("you@example.com")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      data-testid="input-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">{t("Password")}</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder={t("Enter your password")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                      data-testid="input-password"
                    />
                  </div>
                  <Button
                    onClick={handleSignIn}
                    className="w-full"
                    disabled={loading}
                    data-testid="button-signin"
                  >
                    {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("Sign In")}
                  </Button>
                </div>
              </CardContent>
            </TabsContent>

            <TabsContent value="signup">
              <CardContent className="pt-6">
                <CardTitle className="text-lg mb-1">{t("Create your account")}</CardTitle>
                <CardDescription className="mb-5">
                  {t("Get started with AI-powered content creation")}
                </CardDescription>
                <div className="space-y-4">
                  <Button
                    variant="outline"
                    onClick={handleGoogleSignIn}
                    className="w-full"
                    disabled={googleLoading}
                    data-testid="button-google-signup"
                  >
                    {googleLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <img
                        src={GOOGLE_FAVICON_URL}
                        alt="Google"
                        className="w-4 h-4 mr-2 object-contain"
                        loading="lazy"
                      />
                    )}
                    {t("Continue with Google")}
                  </Button>
                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">{t("or")}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">{t("Email")}</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder={t("you@example.com")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      data-testid="input-signup-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">{t("Password")}</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder={t("At least 6 characters")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSignUp()}
                      data-testid="input-signup-password"
                    />
                  </div>
                  <Button
                    onClick={handleSignUp}
                    className="w-full"
                    disabled={loading}
                    data-testid="button-signup"
                  >
                    {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("Create Account")}
                  </Button>
                </div>
              </CardContent>
            </TabsContent>
          </Tabs>
        </Card>

        <div className="mt-5 text-center md:hidden">
          <Link href="/">
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors" data-testid="link-back-home-mobile">
              <ArrowLeft className="w-4 h-4" />
              {t("Back to home")}
            </div>
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t("By continuing, you agree to our")}{" "}
          <a
            href={termsHref}
            className="underline underline-offset-2 transition-colors hover:text-foreground"
            target={termsExternal ? "_blank" : undefined}
            rel={termsExternal ? "noreferrer noopener" : undefined}
          >
            {t("Terms of Service")}
          </a>{" "}
          {t("and")}{" "}
          <a
            href={privacyHref}
            className="underline underline-offset-2 transition-colors hover:text-foreground"
            target={privacyExternal ? "_blank" : undefined}
            rel={privacyExternal ? "noreferrer noopener" : undefined}
          >
            {t("Privacy Policy")}
          </a>
          .
        </p>
      </motion.div>
    </div>
  );
}

