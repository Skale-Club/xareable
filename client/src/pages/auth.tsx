import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Loader2, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { useAppName, useAppSettings } from "@/lib/app-settings";
import { useQuery } from "@tanstack/react-query";
import type { LandingContent } from "@shared/schema";
import { Seo } from "@/components/seo";
import { Logo } from "@/components/logo";
import { PageLoader } from "@/components/page-loader";
import {
  captureAffiliateRefFromCurrentUrl,
  getStoredAffiliateRef,
} from "@/lib/affiliate-ref";

const GOOGLE_FAVICON_URL = "https://upload.wikimedia.org/wikipedia/commons/3/3c/Google_Favicon_2025.svg";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthTab = "signin" | "signup" | "reset";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return EMAIL_REGEX.test(normalizeEmail(email));
}

function getSafeRedirectPath(rawPath: string | null) {
  if (!rawPath || !rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return "/dashboard";
  }
  return rawPath;
}

function hasRecoveryHash(hash: string) {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return params.get("type") === "recovery";
}

export default function AuthPage() {
  const appName = useAppName();
  const { settings, loading: settingsLoading } = useAppSettings();
  const { t } = useTranslation();
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState("");
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [signInLoading, setSignInLoading] = useState(false);
  const [signUpLoading, setSignUpLoading] = useState(false);
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const termsHref = settings?.terms_url || "/terms";
  const privacyHref = settings?.privacy_url || "/privacy";
  const termsExternal = /^https?:\/\//i.test(termsHref);
  const privacyExternal = /^https?:\/\//i.test(privacyHref);

  const searchParams = new URLSearchParams(window.location.search);
  const requestedTab = searchParams.get("tab");
  const initialTab: AuthTab =
    requestedTab === "signup" || requestedTab === "reset" ? requestedTab : "signin";
  const redirectPath = getSafeRedirectPath(searchParams.get("redirect"));
  const [activeTab, setActiveTab] = useState(initialTab);

  const {
    data: content,
    isPending: isLandingContentPending,
    isFetching: isLandingContentFetching,
  } = useQuery<LandingContent>({
    queryKey: ["/api/landing/content"],
    queryFn: () => fetch("/api/landing/content").then(res => res.json()),
  });
  const authFaviconUrl = content?.icon_url || settings?.favicon_url || "/favicon.png";

  useEffect(() => {
    captureAffiliateRefFromCurrentUrl();
    const sb = supabase();
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "signup" || tab === "reset") {
      setActiveTab(tab);
    }

    if (hasRecoveryHash(window.location.hash)) {
      setIsRecoveryFlow(true);
      setActiveTab("reset");
    }

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryFlow(true);
        setActiveTab("reset");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const isInitialSiteLoad =
    (settingsLoading && !settings) ||
    (!content && (isLandingContentPending || isLandingContentFetching));

  if (isInitialSiteLoad) {
    return <PageLoader />;
  }

  async function handleSignIn() {
    const email = normalizeEmail(signInEmail);
    if (!email || !signInPassword) {
      toast({ title: t("Please fill in all fields"), variant: "destructive" });
      return;
    }
    if (!isValidEmail(email)) {
      toast({ title: t("Please enter a valid email"), variant: "destructive" });
      return;
    }
    setSignInLoading(true);
    const sb = supabase();
    const { error } = await sb.auth.signInWithPassword({ email, password: signInPassword });
    setSignInLoading(false);
    if (error) {
      toast({ title: t("Sign in failed"), description: error.message, variant: "destructive" });
    } else {
      setLocation(redirectPath);
    }
  }

  async function handleSignUp() {
    const email = normalizeEmail(signUpEmail);
    if (!email || !signUpPassword || !signUpConfirmPassword) {
      toast({ title: t("Please fill in all fields"), variant: "destructive" });
      return;
    }
    if (!isValidEmail(email)) {
      toast({ title: t("Please enter a valid email"), variant: "destructive" });
      return;
    }
    if (signUpPassword.length < 6) {
      toast({ title: t("Password must be at least 6 characters"), variant: "destructive" });
      return;
    }
    if (signUpPassword !== signUpConfirmPassword) {
      toast({ title: t("Passwords do not match"), variant: "destructive" });
      return;
    }
    setSignUpLoading(true);
    const sb = supabase();
    const { data, error } = await sb.auth.signUp({
      email,
      password: signUpPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    setSignUpLoading(false);
    if (error) {
      toast({ title: t("Sign up failed"), description: error.message, variant: "destructive" });
      return;
    }

    if (data.session) {
      toast({ title: t("Account created!"), description: t("You are now signed in.") });
      setLocation(redirectPath);
    } else {
      setSignInEmail(email);
      setSignInPassword("");
      setSignUpPassword("");
      setSignUpConfirmPassword("");
      setActiveTab("signin");
      toast({
        title: t("Check your email"),
        description: t("We sent a confirmation link to finish your account setup."),
      });
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    const sb = supabase();
    const ref = getStoredAffiliateRef();
    const oauthRedirectUrl = new URL(`${window.location.origin}${redirectPath}`);
    if (ref) {
      oauthRedirectUrl.searchParams.set("ref", ref);
    }

    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthRedirectUrl.toString(),
      },
    });
    setGoogleLoading(false);
    if (error) {
      toast({ title: t("Google sign in failed"), description: error.message, variant: "destructive" });
    }
  }

  async function handleForgotPassword() {
    const email = normalizeEmail(forgotPasswordEmail || signInEmail);
    if (!email) {
      toast({ title: t("Please enter your email"), variant: "destructive" });
      return;
    }
    if (!isValidEmail(email)) {
      toast({ title: t("Please enter a valid email"), variant: "destructive" });
      return;
    }

    setForgotPasswordLoading(true);
    const sb = supabase();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login?tab=reset`,
    });
    setForgotPasswordLoading(false);

    if (error) {
      toast({
        title: t("Could not send reset email"),
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setSignInEmail(email);
    setForgotPasswordOpen(false);
    toast({
      title: t("Reset link sent"),
      description: t("If this email exists, you will receive instructions in a few minutes."),
    });
  }

  async function handleResetPassword() {
    if (!resetPassword || !resetPasswordConfirm) {
      toast({ title: t("Please fill in all fields"), variant: "destructive" });
      return;
    }
    if (resetPassword.length < 6) {
      toast({ title: t("Password must be at least 6 characters"), variant: "destructive" });
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      toast({ title: t("Passwords do not match"), variant: "destructive" });
      return;
    }

    setResetPasswordLoading(true);
    const sb = supabase();
    const {
      data: { session },
    } = await sb.auth.getSession();

    if (!session) {
      setResetPasswordLoading(false);
      toast({
        title: t("Recovery link expired"),
        description: t("Request another password reset email and use the latest link."),
        variant: "destructive",
      });
      return;
    }

    const { error } = await sb.auth.updateUser({ password: resetPassword });
    setResetPasswordLoading(false);

    if (error) {
      toast({
        title: t("Could not update password"),
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setResetPassword("");
    setResetPasswordConfirm("");
    setIsRecoveryFlow(false);
    toast({
      title: t("Password updated"),
      description: t("Your password was changed successfully."),
    });
    setLocation(redirectPath);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="auth-page">
      <Seo
        title={t(activeTab === "signup" ? "Sign Up" : activeTab === "reset" ? "Reset Password" : "Sign In")}
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
          {activeTab === "reset" ? (
            <CardContent className="pt-6">
              <CardTitle className="text-lg mb-1">{t("Reset your password")}</CardTitle>
              <CardDescription className="mb-5">
                {isRecoveryFlow
                  ? t("Set a new password to recover your account.")
                  : t("Enter your new password to continue.")}
              </CardDescription>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-password">{t("New password")}</Label>
                  <Input
                    id="reset-password"
                    type="password"
                    placeholder={t("At least 6 characters")}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    data-testid="input-reset-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-password-confirm">{t("Confirm new password")}</Label>
                  <Input
                    id="reset-password-confirm"
                    type="password"
                    placeholder={t("Repeat your new password")}
                    value={resetPasswordConfirm}
                    onChange={(e) => setResetPasswordConfirm(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleResetPassword()}
                    data-testid="input-reset-password-confirm"
                  />
                </div>
                <Button
                  onClick={handleResetPassword}
                  className="w-full"
                  disabled={resetPasswordLoading}
                  data-testid="button-reset-password"
                >
                  {resetPasswordLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {t("Update password")}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setActiveTab("signin");
                    setIsRecoveryFlow(false);
                  }}
                  data-testid="button-back-signin"
                >
                  {t("Back to sign in")}
                </Button>
              </div>
            </CardContent>
          ) : (
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AuthTab)}>
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
                        value={signInEmail}
                        onChange={(e) => setSignInEmail(e.target.value)}
                        data-testid="input-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="signin-password">{t("Password")}</Label>
                        <button
                          type="button"
                          onClick={() => {
                            setForgotPasswordEmail(normalizeEmail(signInEmail));
                            setForgotPasswordOpen(true);
                          }}
                          className="text-xs text-primary hover:underline"
                          data-testid="button-forgot-password"
                        >
                          {t("Forgot password?")}
                        </button>
                      </div>
                      <Input
                        id="signin-password"
                        type="password"
                        placeholder={t("Enter your password")}
                        value={signInPassword}
                        onChange={(e) => setSignInPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                        data-testid="input-password"
                      />
                    </div>
                    <Button
                      onClick={handleSignIn}
                      className="w-full"
                      disabled={signInLoading}
                      data-testid="button-signin"
                    >
                      {signInLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
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
                        value={signUpEmail}
                        onChange={(e) => setSignUpEmail(e.target.value)}
                        data-testid="input-signup-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">{t("Password")}</Label>
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder={t("At least 6 characters")}
                        value={signUpPassword}
                        onChange={(e) => setSignUpPassword(e.target.value)}
                        data-testid="input-signup-password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password-confirm">{t("Confirm password")}</Label>
                      <Input
                        id="signup-password-confirm"
                        type="password"
                        placeholder={t("Repeat your password")}
                        value={signUpConfirmPassword}
                        onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSignUp()}
                        data-testid="input-signup-password-confirm"
                      />
                    </div>
                    <Button
                      onClick={handleSignUp}
                      className="w-full"
                      disabled={signUpLoading}
                      data-testid="button-signup"
                    >
                      {signUpLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {t("Create Account")}
                    </Button>
                  </div>
                </CardContent>
              </TabsContent>
            </Tabs>
          )}
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

      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Forgot your password?")}</DialogTitle>
            <DialogDescription>
              {t("Enter your email and we will send a password reset link.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="forgot-password-email">{t("Email")}</Label>
            <Input
              id="forgot-password-email"
              type="email"
              placeholder={t("you@example.com")}
              value={forgotPasswordEmail}
              onChange={(e) => setForgotPasswordEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleForgotPassword()}
              data-testid="input-forgot-password-email"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={handleForgotPassword}
              disabled={forgotPasswordLoading}
              data-testid="button-send-reset-link"
            >
              {forgotPasswordLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("Send reset link")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

