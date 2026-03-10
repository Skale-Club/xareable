import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import type {
  AffiliateCommissionHistoryResponse,
  AffiliateDashboardResponse,
  AffiliateReferredAccountsResponse,
} from "@shared/schema";
import { Loader2, Copy, DollarSign, Check, Key } from "lucide-react";
import { PageLoader } from "@/components/page-loader";

const REFERRAL_CODE_REGEX = /^[a-z0-9][a-z0-9_-]{4,63}$/i;

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatTransactionAmount(micros: number): string {
  const sign = micros < 0 ? "-" : "+";
  return `${sign}${formatMicros(Math.abs(micros))}`;
}

export default function AffiliateDashboardPage() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [referralCodeInput, setReferralCodeInput] = useState("");
  const [affiliateApiKey, setAffiliateApiKey] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const { data, isLoading } = useQuery<AffiliateDashboardResponse>({
    queryKey: ["/api/affiliate/dashboard"],
    enabled: !!user,
  });
  const { data: commissionsData, isLoading: commissionsLoading } = useQuery<AffiliateCommissionHistoryResponse>({
    queryKey: ["/api/affiliate/commissions"],
    enabled: !!user && profile?.is_affiliate === true,
  });
  const { data: referredAccountsData, isLoading: referredAccountsLoading } = useQuery<AffiliateReferredAccountsResponse>({
    queryKey: ["/api/affiliate/referred-users"],
    enabled: !!user && profile?.is_affiliate === true,
  });

  useEffect(() => {
    setReferralCodeInput(data?.referral_code || "");
  }, [data?.referral_code]);

  useEffect(() => {
    setAffiliateApiKey(profile?.api_key || "");
  }, [profile?.api_key]);

  const updateReferralCodeMutation = useMutation({
    mutationFn: async (referral_code: string) => {
      const res = await apiRequest("PATCH", "/api/affiliate/referral-code", { referral_code });
      return res.json() as Promise<{ referral_code: string }>;
    },
    onSuccess: ({ referral_code }) => {
      setReferralCodeInput(referral_code);
      toast({ title: t("Referral code updated") });
      void queryClient.invalidateQueries({ queryKey: ["/api/affiliate/dashboard"] });
    },
    onError: (error: Error) => {
      toast({ title: t("Failed to update referral code"), description: error.message, variant: "destructive" });
    },
  });

  async function handleSaveApiKey() {
    if (!user) return;
    const key = affiliateApiKey.trim();
    if (!key) {
      toast({ title: t("API Key cannot be empty"), variant: "destructive" });
      return;
    }

    setSavingApiKey(true);
    const sb = supabase();
    const { error } = await sb.from("profiles").update({ api_key: key }).eq("id", user.id);
    setSavingApiKey(false);

    if (error) {
      toast({ title: t("Failed to save API Key"), description: error.message, variant: "destructive" });
      return;
    }

    await refreshProfile();
    toast({ title: t("Gemini API Key saved successfully") });
  }

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/affiliate/connect", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error: Error) => {
      toast({ title: t("Connect failed"), description: error.message, variant: "destructive" });
    },
  });
  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/affiliate/connect/login");
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (error: Error) => {
      toast({ title: t("Login link failed"), description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <PageLoader />;
  }

  if (!profile?.is_affiliate || !data?.is_affiliate) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("Affiliate Access Required")}</CardTitle>
            <CardDescription>{t("This area is available only for users marked as affiliates.")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const normalizedReferralCode = referralCodeInput.trim().toLowerCase();
  const savedReferralCode = (data?.referral_code || "").trim().toLowerCase();
  const referralCodeDirty = normalizedReferralCode !== savedReferralCode;
  const referralCodeValid = REFERRAL_CODE_REGEX.test(normalizedReferralCode);

  const referralLink = savedReferralCode
    ? `${appOrigin}/r/${savedReferralCode}`
    : `${appOrigin}?ref=${user?.id}`;
  const referralLinkPreview = normalizedReferralCode && referralCodeValid
    ? `${appOrigin}/r/${normalizedReferralCode}`
    : referralLink;
  const commissionTransactions = commissionsData?.transactions ?? [];
  const linkedAccounts = referredAccountsData?.accounts ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("Affiliate Dashboard")}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("Track referrals, commissions, and payout activity.")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("Gemini API Key (Affiliate)")}</CardTitle>
          <CardDescription>
            {t("As an affiliate, you use your own Google Gemini API key. Your generations do not cost the platform.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="affiliate-api-key">{t("Gemini API Key")}</Label>
            <div className="flex gap-2">
              <Input
                id="affiliate-api-key"
                type={showApiKey ? "text" : "password"}
                value={affiliateApiKey}
                onChange={(event) => setAffiliateApiKey(event.target.value)}
                placeholder="AIza..."
                className="font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowApiKey((value) => !value)}
                className="shrink-0"
              >
                <Key className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Get your key at")}{" "}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                aistudio.google.com
              </a>
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveApiKey} disabled={savingApiKey}>
              {savingApiKey ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              {t("Save API Key")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>{t("Total Earned")}</CardDescription>
            <CardTitle>{formatMicros(data.total_commission_earned_micros)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("Pending Payout")}</CardDescription>
            <CardTitle>{formatMicros(data.pending_commission_micros)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("Total Paid")}</CardDescription>
            <CardTitle>{formatMicros(data.total_commission_paid_micros)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("Referred Users")}</CardDescription>
            <CardTitle>{data.referred_users_count}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>{t("Total Clicks")}</CardDescription>
            <CardTitle>{data.total_clicks}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("Clicks (30 days)")}</CardDescription>
            <CardTitle>{data.clicks_last_30_days}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Referral Link")}</CardTitle>
          <CardDescription>{t("Share this link and customize your referral code.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm break-all">
            {referralLinkPreview}
          </div>
          <div className="space-y-2">
            <label htmlFor="referral-code-input" className="text-sm font-medium">
              {t("Referral code")}
            </label>
            <Input
              id="referral-code-input"
              value={referralCodeInput}
              onChange={(event) => setReferralCodeInput(event.target.value.toLowerCase())}
              placeholder="your-company"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              {t("Use 5-64 characters: letters, numbers, hyphen, or underscore.")}
            </p>
            {!referralCodeValid && normalizedReferralCode.length > 0 && (
              <p className="text-xs text-destructive">
                {t("Invalid referral code format.")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(referralLinkPreview);
                toast({ title: t("Referral link copied") });
              }}
              disabled={!referralCodeValid && normalizedReferralCode.length > 0}
            >
              <Copy className="w-4 h-4 mr-2" />
              {t("Copy Link")}
            </Button>
            <Button
              onClick={() => updateReferralCodeMutation.mutate(normalizedReferralCode)}
              disabled={!referralCodeValid || !referralCodeDirty || updateReferralCodeMutation.isPending}
            >
              {updateReferralCodeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("Save Referral Code")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Payout Settings")}</CardTitle>
          <CardDescription>{t("Manage Stripe Connect and payout behavior.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("Stripe Connect")}</span>
            {data.stripe_connect_onboarded ? (
              <Badge>{t("Connected")}</Badge>
            ) : (
              <Badge variant="outline">{t("Not Connected")}</Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("Minimum Payout")}</span>
            <span>{formatMicros(data.minimum_payout_micros)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("Commission Share")}</span>
            <span>{data.commission_share_percent.toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("Auto Payout")}</span>
            <span>{data.auto_payout_enabled ? t("Enabled") : t("Disabled")}</span>
          </div>
          <div className="flex gap-2 pt-2">
            {!data.stripe_connect_account_id ? (
              <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                {connectMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("Connect Stripe")}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending}>
                {loginMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("Open Stripe Dashboard")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Linked Accounts")}</CardTitle>
          <CardDescription>{t("Accounts currently attributed to your referral link.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {referredAccountsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("Loading linked accounts...")}
            </div>
          ) : linkedAccounts.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t("No linked accounts yet.")}</div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>{t("Email")}</span>
                <span>{t("Company")}</span>
                <span>{t("Joined")}</span>
              </div>
              <div className="divide-y divide-border/60">
                {linkedAccounts.map((account) => (
                  <div key={account.id} className="grid grid-cols-1 md:grid-cols-3 gap-2 px-3 py-3 text-sm">
                    <span className="break-all">{account.email || t("No email")}</span>
                    <span>{account.company_name || t("No company yet")}</span>
                    <span className="text-muted-foreground">
                      {new Date(account.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              {t("Commission History")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {commissionsLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("Loading...")}
              </div>
            ) : commissionTransactions.length === 0 ? (
              t("No commission transactions yet.")
            ) : (
              <div className="space-y-3">
                {commissionTransactions.map((transaction) => (
                  <div key={transaction.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">
                        {transaction.kind === "payout" ? t("Payout") : t("Commission")}
                      </div>
                      <div className={transaction.amount_micros < 0 ? "text-destructive" : "text-green-600"}>
                        {formatTransactionAmount(transaction.amount_micros)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(transaction.created_at).toLocaleString()}
                    </div>
                    {transaction.description && (
                      <div className="mt-2 text-xs text-muted-foreground">{transaction.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
