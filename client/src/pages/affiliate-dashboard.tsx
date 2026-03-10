import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import type { AffiliateCommissionHistoryResponse, AffiliateDashboardResponse } from "@shared/schema";
import { Loader2, Copy, Users, DollarSign } from "lucide-react";
import { PageLoader } from "@/components/page-loader";

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatTransactionAmount(micros: number): string {
  const sign = micros < 0 ? "-" : "+";
  return `${sign}${formatMicros(Math.abs(micros))}`;
}

export default function AffiliateDashboardPage() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<AffiliateDashboardResponse>({
    queryKey: ["/api/affiliate/dashboard"],
    enabled: !!user,
  });
  const { data: commissionsData, isLoading: commissionsLoading } = useQuery<AffiliateCommissionHistoryResponse>({
    queryKey: ["/api/affiliate/commissions"],
    enabled: !!user && profile?.is_affiliate === true,
  });
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
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>{t("Affiliate Access Required")}</CardTitle>
            <CardDescription>{t("This area is available only for users marked as affiliates.")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const referralLink = data?.referral_code
    ? `${window.location.origin}/r/${data.referral_code}`
    : `${window.location.origin}?ref=${user?.id}`;
  const commissionTransactions = commissionsData?.transactions ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("Affiliate Dashboard")}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("Track referrals, commissions, and payout activity.")}
        </p>
      </div>

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
          <CardDescription>{t("Share this link to attribute new users to your affiliate account.")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row">
          <div className="flex-1 rounded-md border bg-muted/30 px-3 py-2 text-sm break-all">
            {referralLink}
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(referralLink);
            }}
          >
            <Copy className="w-4 h-4 mr-2" />
            {t("Copy Link")}
          </Button>
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              {t("Referral Snapshot")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t("Referred users are already counted through `profiles.referred_by_affiliate_id`.")}
          </CardContent>
        </Card>
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
