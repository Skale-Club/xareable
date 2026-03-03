import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AffiliateDashboardResponse } from "@shared/schema";
import { Loader2, Copy, Users, DollarSign } from "lucide-react";

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export default function AffiliateDashboardPage() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<AffiliateDashboardResponse>({
    queryKey: ["/api/affiliate/dashboard"],
    enabled: !!user,
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
      toast({ title: "Connect failed", description: error.message, variant: "destructive" });
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
      toast({ title: "Login link failed", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile?.is_affiliate || !data?.is_affiliate) {
    return (
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Affiliate Access Required</CardTitle>
            <CardDescription>This area is available only for users marked as affiliates.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const referralLink = `${window.location.origin}?ref=${user?.id}`;

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Affiliate Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track referrals and commission state. Stripe Connect payout flow is the next layer to wire.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total Earned</CardDescription>
            <CardTitle>{formatMicros(data.total_commission_earned_micros)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Pending Payout</CardDescription>
            <CardTitle>{formatMicros(data.pending_commission_micros)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total Paid</CardDescription>
            <CardTitle>{formatMicros(data.total_commission_paid_micros)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Referred Users</CardDescription>
            <CardTitle>{data.referred_users_count}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Referral Link</CardTitle>
          <CardDescription>Share this link to attribute new users to your affiliate account.</CardDescription>
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
            Copy Link
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payout Settings</CardTitle>
          <CardDescription>Connect onboarding is not wired yet, but these values are already tracked.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Stripe Connect</span>
            {data.stripe_connect_onboarded ? (
              <Badge>Connected</Badge>
            ) : (
              <Badge variant="outline">Not Connected</Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Minimum Payout</span>
            <span>{formatMicros(data.minimum_payout_micros)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Auto Payout</span>
            <span>{data.auto_payout_enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <div className="flex gap-2 pt-2">
            {!data.stripe_connect_account_id ? (
              <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                {connectMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Connect Stripe
              </Button>
            ) : (
              <Button variant="outline" onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending}>
                {loginMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Open Stripe Dashboard
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
              Referral Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Referred users are already counted through `profiles.referred_by_affiliate_id`.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Commission Ledger
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Commission payout transactions will appear here once Stripe Connect transfers are implemented.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
