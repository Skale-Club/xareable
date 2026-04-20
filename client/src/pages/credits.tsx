import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, Banknote, Settings2, BarChart3, Receipt } from "lucide-react";
import { PageLoader } from "@/components/page-loader";
import type {
  BillingLedgerResponse,
  BillingMeResponse,
  BillingOverviewResponse,
  BillingResourceUsageResponse,
  BillingSpendingControls,
} from "@shared/schema";

const liveBillingQueryOptions = {
  staleTime: 0,
  refetchOnMount: "always" as const,
};

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatEntryType(type: string): string {
  return type.replace(/_/g, " ");
}

function formatSubscriptionStatus(status: string | null | undefined): string {
  if (!status) {
    return "none";
  }
  return status.replace(/_/g, " ");
}

function isFreeBillingAccount(payload: BillingMeResponse | undefined): boolean {
  if (!payload) {
    return false;
  }

  const paidStatuses = new Set(["active", "trialing", "past_due", "incomplete"]);
  const hasPaidSubscription = paidStatuses.has(String(payload.profile.subscription_status || "none").toLowerCase());
  const planKey = String(payload.plan?.plan_key || "").toLowerCase();
  const displayName = String(payload.plan?.display_name || "").toLowerCase();
  return !hasPaidSubscription || planKey === "free" || displayName === "free";
}

function microsToCurrencyInput(micros: number | null | undefined): string {
  if (!micros || micros <= 0) {
    return "";
  }
  return (micros / 1_000_000).toFixed(2);
}

function currencyInputToMicros(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.round(numeric * 1_000_000);
}

function controlsPayloadFromInputs(params: {
  alertInput: string;
  budgetInput: string;
  budgetEnabled: boolean;
}): BillingSpendingControls | null {
  const alertMicros = currencyInputToMicros(params.alertInput);
  const budgetMicros = currencyInputToMicros(params.budgetInput);

  if (params.alertInput.trim() && alertMicros === null) {
    return null;
  }

  if (params.budgetEnabled && (!params.budgetInput.trim() || budgetMicros === null)) {
    return null;
  }

  return {
    usage_alert_micros: alertMicros,
    usage_budget_micros: params.budgetEnabled ? budgetMicros : null,
    usage_budget_enabled: params.budgetEnabled && (budgetMicros ?? 0) > 0,
    alert_reached: false,
    budget_reached: false,
    budget_remaining_micros: null,
  };
}

export default function CreditsPage() {
  const { profile: authProfile } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [manageOpen, setManageOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [alertInput, setAlertInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [selectedPackMicros, setSelectedPackMicros] = useState<string>("100000000");

  const { data: billingData, isLoading: loadingBilling, error: billingError } = useQuery<BillingMeResponse>({
    queryKey: ["/api/billing/me"],
    ...liveBillingQueryOptions,
  });

  const { data: overviewData, isLoading: loadingOverview, error: overviewError } = useQuery<BillingOverviewResponse>({
    queryKey: ["/api/billing/overview"],
    ...liveBillingQueryOptions,
  });

  const usageQueriesEnabled = Boolean(billingData) && !isFreeBillingAccount(billingData);

  const { data: resourceData, isLoading: loadingResources, error: resourceError } = useQuery<BillingResourceUsageResponse>({
    queryKey: ["/api/billing/resource-usage"],
    enabled: usageQueriesEnabled,
    ...liveBillingQueryOptions,
  });

  const { data: ledgerData, isLoading: loadingLedger, error: ledgerError } = useQuery<BillingLedgerResponse>({
    queryKey: ["/api/billing/ledger"],
    enabled: usageQueriesEnabled,
    ...liveBillingQueryOptions,
  });

  useEffect(() => {
    if (!overviewData) {
      return;
    }

    setAlertInput(microsToCurrencyInput(overviewData.controls.usage_alert_micros));
    setBudgetInput(microsToCurrencyInput(overviewData.controls.usage_budget_micros));
    setBudgetEnabled(overviewData.controls.usage_budget_enabled);

    const hasSelectedOption = overviewData.credit_pack_options_micros.includes(Number(selectedPackMicros));
    if (!hasSelectedOption) {
      if (overviewData.credit_pack_options_micros.length > 0) {
        setSelectedPackMicros(String(overviewData.credit_pack_options_micros[0]));
      } else {
        setSelectedPackMicros("");
      }
    }
  }, [overviewData, selectedPackMicros]);

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/subscribe", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error: Error) => {
      toast({ title: t("Subscription failed"), description: error.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error: Error) => {
      toast({ title: t("Portal unavailable"), description: error.message, variant: "destructive" });
    },
  });

  const controlsMutation = useMutation({
    mutationFn: async (payload: { usage_alert_micros: number | null; usage_budget_micros: number | null; usage_budget_enabled: boolean }) => {
      const res = await apiRequest("PATCH", "/api/billing/controls", payload);
      return res.json() as Promise<BillingSpendingControls>;
    },
    onSuccess: () => {
      setManageOpen(false);
      toast({ title: t("Spending controls updated") });
      void queryClient.invalidateQueries({ queryKey: ["/api/billing/overview"], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["/api/billing/me"], exact: true });
    },
    onError: (error: Error) => {
      toast({ title: t("Failed to update controls"), description: error.message, variant: "destructive" });
    },
  });

  const purchasePackMutation = useMutation({
    mutationFn: async (amountMicros: number) => {
      const res = await apiRequest("POST", "/api/billing/credit-packs/purchase", { amountMicros });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      setPurchaseOpen(false);
      window.location.href = url;
    },
    onError: (error: Error) => {
      toast({ title: t("Purchase failed"), description: error.message, variant: "destructive" });
    },
  });

  const statusLabel = useMemo(() => {
    return formatSubscriptionStatus(billingData?.profile.subscription_status);
  }, [billingData?.profile.subscription_status]);

  const hasPaidSubscription = useMemo(() => {
    const paidStatuses = new Set(["active", "trialing", "past_due", "incomplete"]);
    return paidStatuses.has(String(billingData?.profile.subscription_status || "none").toLowerCase());
  }, [billingData?.profile.subscription_status]);

  const isFreePlan = useMemo(() => {
    const planKey = String(billingData?.plan?.plan_key || "").toLowerCase();
    const displayName = String(billingData?.plan?.display_name || "").toLowerCase();
    return !hasPaidSubscription || planKey === "free" || displayName === "free";
  }, [billingData?.plan?.display_name, billingData?.plan?.plan_key, hasPaidSubscription]);

  const accountType = useMemo(() => {
    if (authProfile?.is_affiliate) {
      return "affiliate";
    }
    return isFreePlan ? "free" : "core";
  }, [authProfile?.is_affiliate, isFreePlan]);

  const selectedPackIsValid = Boolean(overviewData?.credit_pack_options_micros.includes(Number(selectedPackMicros)));
  const canOpenUsagePanel = !isFreePlan;

  const isLoading = loadingBilling || loadingOverview || loadingResources || loadingLedger;
  if (isLoading) {
    return <PageLoader />;
  }

  if (!billingData || !overviewData) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("Failed to load billing.")}
      </div>
    );
  }

  const plan = billingData.plan;
  const billingProfile = billingData.profile;
  const entries = (ledgerData?.entries ?? []).slice(0, 10);
  const resources = resourceData?.items ?? [];

  const submitControls = () => {
    const controls = controlsPayloadFromInputs({ alertInput, budgetInput, budgetEnabled });
    if (!controls) {
      toast({
        title: t("Invalid values"),
        description: t("Please enter valid values for alert and budget."),
        variant: "destructive",
      });
      return;
    }

    controlsMutation.mutate({
      usage_alert_micros: controls.usage_alert_micros,
      usage_budget_micros: controls.usage_budget_micros,
      usage_budget_enabled: controls.usage_budget_enabled,
    });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("Billing")}</h1>
        </div>

        {(billingError || overviewError || resourceError || ledgerError) && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">
              {t("Failed to load billing data")}: {String(
                (billingError as Error)?.message ||
                (overviewError as Error)?.message ||
                (resourceError as Error)?.message ||
                (ledgerError as Error)?.message ||
                t("unknown error"),
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t("Current plan")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="font-semibold">{plan?.display_name || t("Free")}</div>
                  <div className="text-muted-foreground">
                    {formatMicros(plan?.base_price_micros || 0)} / {plan?.billing_interval || "month"}
                  </div>
                  {statusLabel !== "none" && (
                    <div className="text-muted-foreground capitalize">{t("Status")}: {statusLabel}</div>
                  )}
                </CardContent>
              </Card>

              {isFreePlan ? (
                <Card className="border-border/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{t("Upgrade plan")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="text-muted-foreground">
                      {t("Move to Core to unlock the account usage panel and advanced controls.")}
                    </div>
                    <Button onClick={() => subscribeMutation.mutate()} disabled={subscribeMutation.isPending}>
                      {subscribeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {t("Upgrade to Core")}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-border/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{t("Billing status")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div>
                      {t("Period start")}: {billingProfile.current_period_start ? new Date(billingProfile.current_period_start).toLocaleDateString() : t("n/a")}
                    </div>
                    <div>
                      {t("Period end")}: {billingProfile.current_period_end ? new Date(billingProfile.current_period_end).toLocaleDateString() : t("n/a")}
                    </div>
                    <div>
                      {t("Pending overage")}: {formatMicros(billingProfile.pending_overage_micros || 0)}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {accountType === "affiliate" && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
                <div className="font-medium">{t("Affiliate account")}</div>
                <div className="text-muted-foreground mt-1">
                  {t("Referral payouts are managed in the Affiliate dashboard. Billing actions here apply to your own account usage.")}
                </div>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setLocation("/affiliate")}>
                  {t("Open Affiliate Dashboard")}
                </Button>
              </div>
            )}

            {!isFreePlan && (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">{t("Change plan")}</div>
                    <div className="text-sm text-muted-foreground">
                      {t("View or change your subscription plan.")}
                    </div>
                  </div>
                  <Button onClick={() => subscribeMutation.mutate()} disabled={subscribeMutation.isPending}>
                    {subscribeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("Change plan")}
                  </Button>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-4">
                  <div>
                    <div className="font-medium">{t("Update payment information")}</div>
                    <div className="text-sm text-muted-foreground">
                      {t("Manage your payment methods and billing details.")}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
                    {portalMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("Update payment method")}
                  </Button>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-4">
                  <div>
                    <div className="font-medium">{t("Cancel subscription")}</div>
                    <div className="text-sm text-muted-foreground">
                      {t("Open the billing portal to cancel your subscription.")}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
                    {portalMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("Cancel subscription")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {canOpenUsagePanel && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-pink-500" />
                {t("Account usage")}
              </CardTitle>
              <CardDescription>
                {t("Additional usage details are grouped here to keep billing simple.")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="overview" className="rounded-lg border px-4">
                  <AccordionTrigger className="hover:no-underline py-4">
                    <div className="text-left">
                      <div className="font-semibold">{t("Usage overview")}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("Credits, additional usage, and account limits.")}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-3">
                      <Card className="border-border/60">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{t("Total available credits")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 text-sm">
                          <div className="font-semibold">{formatMicros(overviewData.total_available_credits_micros)}</div>
                          <div className="text-muted-foreground">
                            {t("Resets at")} {billingProfile.current_period_end ? new Date(billingProfile.current_period_end).toLocaleDateString() : t("n/a")}
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-border/60">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{t("Credits used this month")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 text-sm">
                          <div className="font-semibold">{formatMicros(overviewData.included_used_this_month_micros)}</div>
                          <div className="text-muted-foreground">
                            {t("Included remaining")}: {formatMicros(overviewData.included_remaining_micros)}
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-border/60">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{t("Additional usage")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 text-sm">
                          <div className="font-semibold">{formatMicros(overviewData.additional_usage_this_month_micros)}</div>
                          <div className="text-muted-foreground">
                            {t("Alert")}: {overviewData.controls.usage_alert_micros ? formatMicros(overviewData.controls.usage_alert_micros) : t("Not set")}
                          </div>
                          <div className="text-muted-foreground">
                            {t("Budget")}: {overviewData.controls.usage_budget_enabled && overviewData.controls.usage_budget_micros
                              ? formatMicros(overviewData.controls.usage_budget_micros)
                              : t("Not set")}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{t("Credits breakdown")}</div>
                          <div className="text-sm text-muted-foreground">
                            {t("Available balances by source.")}
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setPurchaseOpen(true)} disabled={!selectedPackIsValid}>
                          <Banknote className="w-4 h-4 mr-2" />
                          {t("Purchase credit pack")}
                        </Button>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
                        <div>
                          <div className="text-muted-foreground">{t("Credit packs")}</div>
                          <div className="font-medium">{formatMicros(overviewData.credit_pack_balance_micros)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">{t("Promotional credits")}</div>
                          <div className="font-medium">{formatMicros(overviewData.promotional_credits_micros)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">{t("Gifted credits")}</div>
                          <div className="font-medium">{formatMicros(overviewData.gifted_credits_micros)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button variant="outline" onClick={() => setManageOpen(true)}>
                        <Settings2 className="w-4 h-4 mr-2" />
                        {t("Manage spending controls")}
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="details" className="mt-3 rounded-lg border px-4">
                  <AccordionTrigger className="hover:no-underline py-4">
                    <div className="text-left">
                      <div className="font-semibold">{t("Detailed logs")}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("Resource usage and latest billing ledger entries.")}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-5">
                    <div>
                      <div className="font-medium mb-3">{t("Resource usage")}</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("Resource")}</TableHead>
                            <TableHead className="text-right">{t("Usage total")}</TableHead>
                            <TableHead className="text-right">{t("Unit price")}</TableHead>
                            <TableHead className="text-right">{t("Cost accrued")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {resources.map((item) => (
                            <TableRow key={item.resource_key}>
                              <TableCell>
                                <div className="font-medium">{t(item.label)}</div>
                                <div className="text-xs text-muted-foreground">{item.usage_count} {t("events")}</div>
                              </TableCell>
                              <TableCell className="text-right">{formatMicros(item.usage_total_micros)}</TableCell>
                              <TableCell className="text-right">{t(item.unit_price_label)}</TableCell>
                              <TableCell className="text-right">{formatMicros(item.cost_accrued_micros)}</TableCell>
                            </TableRow>
                          ))}
                          {resources.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={4} className="text-sm text-muted-foreground">
                                {t("No resource usage yet for this month.")}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-3 font-medium">
                        <Receipt className="w-4 h-4" />
                        {t("Billing ledger")}
                      </div>
                      {entries.length === 0 ? (
                        <div className="text-sm text-muted-foreground">{t("No billing entries yet.")}</div>
                      ) : (
                        <div className="space-y-3">
                          {entries.map((entry) => (
                            <div key={entry.id} className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
                              <div>
                                <div className="font-medium capitalize">{t(formatEntryType(entry.entry_type))}</div>
                                <div className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</div>
                              </div>
                              <div className="text-right">
                                <div className={entry.amount_micros < 0 ? "text-destructive" : "text-green-600"}>
                                  {entry.amount_micros < 0 ? "-" : "+"}{formatMicros(Math.abs(entry.amount_micros))}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {t("Included")}: {formatMicros(entry.balance_included_after_micros || 0)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              {t("Manage monthly spending")}
            </DialogTitle>
            <DialogDescription>
              {t("Usage alerts and budgets help control additional usage beyond your included credits.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="usage-alert-input">{t("Set usage alert")}</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="usage-alert-input"
                type="number"
                min={0}
                step="0.01"
                value={alertInput}
                onChange={(event) => setAlertInput(event.target.value)}
                className="pl-7"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="usage-budget-toggle">{t("Set usage budget")}</Label>
              <Switch
                id="usage-budget-toggle"
                checked={budgetEnabled}
                onCheckedChange={setBudgetEnabled}
              />
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={budgetInput}
                onChange={(event) => setBudgetInput(event.target.value)}
                className="pl-7"
                placeholder="0.00"
                disabled={!budgetEnabled}
              />
            </div>
          </div>

          <Button onClick={submitControls} disabled={controlsMutation.isPending}>
            {controlsMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("Save")}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Purchase a credit pack")}</DialogTitle>
            <DialogDescription>
              {t("Credit packs provide upfront spend control and are consumed before overage charges.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>{t("Choose a credit pack size")}</Label>
            <Select value={selectedPackMicros} onValueChange={setSelectedPackMicros}>
              <SelectTrigger>
                <SelectValue placeholder={t("Select a credit pack")} />
              </SelectTrigger>
              <SelectContent>
                {(overviewData.credit_pack_options_micros || []).map((optionMicros) => (
                  <SelectItem key={optionMicros} value={String(optionMicros)}>
                    {formatMicros(optionMicros)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => purchasePackMutation.mutate(Number(selectedPackMicros))}
            disabled={purchasePackMutation.isPending || !selectedPackIsValid}
          >
            {purchasePackMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("Continue to payment")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
