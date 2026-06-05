import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { useAuthDialog, type AuthDialogTab } from "@/lib/auth-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Loader2 } from "lucide-react";
import { useAppName, useAppSettings } from "@/lib/app-settings";
import { useQuery } from "@tanstack/react-query";
import type { LandingContent } from "@shared/schema";
import { Logo } from "@/components/logo";
import {
  captureAffiliateRefFromCurrentUrl,
  getStoredAffiliateRef,
} from "@/lib/affiliate-ref";

const GOOGLE_FAVICON_URL = "https://upload.wikimedia.org/wikipedia/commons/3/3c/Google_Favicon_2025.svg";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return EMAIL_REGEX.test(normalizeEmail(email));
}

function hasRecoveryHash(hash: string) {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return params.get("type") === "recovery";
}

export function AuthDialog() {
  const { isOpen, initialTab, redirectPath, closeDialog } = useAuthDialog();
  const appName = useAppName();
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signinStep, setSigninStep] = useState<1 | 2>(1);
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState("");
  const [signupStep, setSignupStep] = useState<1 | 2>(1);
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
  const [activeTab, setActiveTab] = useState<AuthDialogTab>(initialTab);

  const termsHref = settings?.terms_url || "/terms";
  const privacyHref = settings?.privacy_url || "/privacy";
  const termsExternal = /^https?:\/\//i.test(termsHref);
  const privacyExternal = /^https?:\/\//i.test(privacyHref);

  const { data: content } = useQuery<LandingContent>({
    queryKey: ["/api/landing/content"],
    queryFn: () => fetch("/api/landing/content").then((res) => res.json()),
    enabled: isOpen,
  });
  const authFaviconUrl = content?.icon_url || settings?.favicon_url || "/favicon.png";

  useEffect(() => {
    if (isOpen) {
      captureAffiliateRefFromCurrentUrl();
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;

    if (hasRecoveryHash(window.location.hash)) {
      setIsRecoveryFlow(true);
      setActiveTab("reset");
    }

    const sb = supabase();
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryFlow(true);
        setActiveTab("reset");
      }
    });

    return () => subscription.unsubscribe();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSignInEmail("");
      setSignInPassword("");
      setSigninStep(1);
      setSignUpEmail("");
      setSignUpPassword("");
      setSignUpConfirmPassword("");
      setSignupStep(1);
      setForgotPasswordEmail("");
      setResetPassword("");
      setResetPasswordConfirm("");
      setIsRecoveryFlow(false);
    }
  }, [isOpen]);

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
      return;
    }
    closeDialog();
    setLocation(redirectPath);
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
      closeDialog();
      setLocation(redirectPath);
      return;
    }

    setSignInEmail(email);
    setSignInPassword("");
    setSigninStep(1);
    setSignUpPassword("");
    setSignUpConfirmPassword("");
    setSignupStep(1);
    setActiveTab("signin");
    toast({
      title: t("Check your email"),
      description: t("We sent a confirmation link to finish your account setup."),
    });
  }

  function handleContinueToPassword() {
    const email = normalizeEmail(signUpEmail);
    if (!email) {
      toast({ title: t("Please enter your email"), variant: "destructive" });
      return;
    }
    if (!isValidEmail(email)) {
      toast({ title: t("Please enter a valid email"), variant: "destructive" });
      return;
    }
    setSignupStep(2);
  }

  function handleSigninContinue() {
    const email = normalizeEmail(signInEmail);
    if (!email) {
      toast({ title: t("Please enter your email"), variant: "destructive" });
      return;
    }
    if (!isValidEmail(email)) {
      toast({ title: t("Please enter a valid email"), variant: "destructive" });
      return;
    }
    setSigninStep(2);
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
    closeDialog();
    setLocation(redirectPath);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto p-0 gap-0"
        data-testid="auth-dialog"
      >
        <div className="p-6">
          <div className="text-center mb-6">
            <div className="flex justify-center mb-3">
              <img
                src={authFaviconUrl}
                alt={appName ? `${appName} favicon` : "Favicon"}
                className="w-10 h-10 rounded-xl object-contain"
                data-testid="auth-dialog-favicon"
              />
            </div>
            <Logo
              logoUrl={content?.logo_url || settings?.logo_url}
              altLogoUrl={content?.alt_logo_url}
              imageClassName="h-[28px] w-auto"
              containerClassName="flex justify-center mb-2"
              fallbackIconClassName="w-[28px] h-[28px] rounded-xl mx-auto shadow-md"
              fallbackSparklesClassName="w-3.5 h-3.5"
              showFallbackText={false}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("AI-powered social media content creation")}
            </p>
          </div>

          {activeTab === "reset" ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">{t("Reset your password")}</h3>
                <p className="text-sm text-muted-foreground">
                  {isRecoveryFlow
                    ? t("Set a new password to recover your account.")
                    : t("Enter your new password to continue.")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dialog-reset-password">{t("New password")}</Label>
                <Input
                  id="dialog-reset-password"
                  type="password"
                  placeholder={t("At least 6 characters")}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dialog-reset-password-confirm">{t("Confirm new password")}</Label>
                <Input
                  id="dialog-reset-password-confirm"
                  type="password"
                  placeholder={t("Repeat your new password")}
                  value={resetPasswordConfirm}
                  onChange={(e) => setResetPasswordConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleResetPassword()}
                />
              </div>
              <Button
                onClick={handleResetPassword}
                className="w-full"
                disabled={resetPasswordLoading}
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
              >
                {t("Back to sign in")}
              </Button>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(value) => {
              const next = value as AuthDialogTab;
              setActiveTab(next);
              if (next === "signup") {
                setSignupStep(1);
              }
              if (next === "signin") {
                setSigninStep(1);
              }
            }}>
              <TabsList className="w-full">
                <TabsTrigger value="signin" className="flex-1" data-testid="dialog-tab-signin">
                  {t("Sign In")}
                </TabsTrigger>
                <TabsTrigger value="signup" className="flex-1" data-testid="dialog-tab-signup">
                  {t("Sign Up")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-4 mt-4">
                {signinStep === 1 ? (
                  <>
                    <div>
                      <h3 className="text-lg font-semibold mb-1">{t("Welcome back")}</h3>
                      <p className="text-sm text-muted-foreground">
                        {t("Sign in to your account to continue")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleGoogleSignIn}
                      className="w-full"
                      disabled={googleLoading}
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
                        <span className="bg-background px-2 text-muted-foreground">{t("or")}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-signin-email">{t("Email")}</Label>
                      <Input
                        id="dialog-signin-email"
                        type="email"
                        placeholder={t("you@example.com")}
                        value={signInEmail}
                        onChange={(e) => setSignInEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSigninContinue()}
                        autoFocus
                      />
                    </div>
                    <Button
                      onClick={handleSigninContinue}
                      className="w-full"
                    >
                      {t("Continue")}
                    </Button>
                    <div className="text-center text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => {
                          setForgotPasswordEmail(normalizeEmail(signInEmail));
                          setForgotPasswordOpen(true);
                        }}
                        className="hover:text-foreground transition-colors underline underline-offset-2"
                      >
                        {t("Forgot password?")}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSigninStep(1)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={t("Back")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                      </button>
                      <div>
                        <h3 className="text-lg font-semibold mb-1">{t("Enter your password")}</h3>
                        <p className="text-sm text-muted-foreground">
                          {signInEmail}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="dialog-signin-password">{t("Password")}</Label>
                        <button
                          type="button"
                          onClick={() => {
                            setForgotPasswordEmail(normalizeEmail(signInEmail));
                            setForgotPasswordOpen(true);
                          }}
                          className="text-xs text-pink-300 hover:text-pink-400 transition-colors"
                        >
                          {t("Forgot password?")}
                        </button>
                      </div>
                      <Input
                        id="dialog-signin-password"
                        type="password"
                        placeholder={t("Enter your password")}
                        value={signInPassword}
                        onChange={(e) => setSignInPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                        autoFocus
                      />
                    </div>
                    <Button
                      onClick={handleSignIn}
                      className="w-full"
                      disabled={signInLoading}
                    >
                      {signInLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {t("Sign In")}
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="signup" className="space-y-4 mt-4">
                {signupStep === 1 ? (
                  <>
                    <div>
                      <h3 className="text-lg font-semibold mb-1">{t("Create your account")}</h3>
                      <p className="text-sm text-muted-foreground">
                        {t("Get started with AI-powered content creation")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleGoogleSignIn}
                      className="w-full"
                      disabled={googleLoading}
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
                        <span className="bg-background px-2 text-muted-foreground">{t("or")}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-signup-email">{t("Email")}</Label>
                      <Input
                        id="dialog-signup-email"
                        type="email"
                        placeholder={t("you@example.com")}
                        value={signUpEmail}
                        onChange={(e) => setSignUpEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleContinueToPassword()}
                        autoFocus
                      />
                    </div>
                    <Button
                      onClick={handleContinueToPassword}
                      className="w-full"
                    >
                      {t("Continue")}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSignupStep(1)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={t("Back")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                      </button>
                      <div>
                        <h3 className="text-lg font-semibold mb-1">{t("Set your password")}</h3>
                        <p className="text-sm text-muted-foreground">
                          {signUpEmail}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-signup-password">{t("Password")}</Label>
                      <Input
                        id="dialog-signup-password"
                        type="password"
                        placeholder={t("At least 6 characters")}
                        value={signUpPassword}
                        onChange={(e) => setSignUpPassword(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-signup-password-confirm">{t("Confirm password")}</Label>
                      <Input
                        id="dialog-signup-password-confirm"
                        type="password"
                        placeholder={t("Repeat your password")}
                        value={signUpConfirmPassword}
                        onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSignUp()}
                      />
                    </div>
                    <Button
                      onClick={handleSignUp}
                      className="w-full"
                      disabled={signUpLoading}
                    >
                      {signUpLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {t("Create Account")}
                    </Button>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}

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
        </div>

        <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("Forgot your password?")}</DialogTitle>
              <DialogDescription>
                {t("Enter your email and we will send a password reset link.")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="dialog-forgot-password-email">{t("Email")}</Label>
              <Input
                id="dialog-forgot-password-email"
                type="email"
                placeholder={t("you@example.com")}
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleForgotPassword()}
              />
            </div>
            <DialogFooter>
              <Button
                onClick={handleForgotPassword}
                disabled={forgotPasswordLoading}
              >
                {forgotPasswordLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("Send reset link")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
