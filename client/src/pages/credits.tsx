import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2,
  CreditCard,
  CalendarDays,
  Receipt,
  Settings2,
  Banknote,
  Coins,
  ArrowUpRight,
} from "lucide-react";
import type {
  BillingLedgerResponse,
  BillingMeResponse,
  BillingOverviewResponse,
  BillingResourceUsageResponse,
  BillingStatementResponse,
  BillingSpendingControls,
} from "@shared/schema";

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatEntryType(type: string): string {
  return type.replace(/_/g, " ");
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
  });

  const { data: overviewData, isLoading: loadingOverview, error: overviewError } = useQuery<BillingOverviewResponse>({
    queryKey: ["/api/billing/overview"],
  });

  const { data: resourceData, isLoading: loadingResources, error: resourceError } = useQuery<BillingResourceUsageResponse>({
    queryKey: ["/api/billing/resource-usage"],
  });

  const { data: ledgerData, isLoading: loadingLedger, error: ledgerError } = useQuery<BillingLedgerResponse>({
    queryKey: ["/api/billing/ledger"],
  });

  const { data: statementData, isLoading: loadingStatement, error: statementError } = useQuery<BillingStatementResponse>({
    queryKey: ["/api/billing/statement"],
  });

  useEffect(() => {
    if (!overviewData) {
      return;
    }

    setAlertInput(microsToCurrencyInput(overviewData.controls.usage_alert_micros));
    setBudgetInput(microsToCurrencyInput(overviewData.controls.usage_budget_micros));
    setBudgetEnabled(overviewData.controls.usage_budget_enabled);

    const hasSelectedOption = overviewData.credit_pack_options_micros.includes(Number(selectedPackMicros));
    if (!hasSelectedOption && overviewData.credit_pack_options_micros.length > 0) {
      setSelectedPackMicros(String(overviewData.credit_pack_options_micros[0]));
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
      void queryClient.invalidateQueries({ queryKey: ["/api/billing/overview"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/billing/me"] });
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

  const refreshBilling = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/billing/me"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/billing/overview"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/billing/resource-usage"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/billing/statement"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/billing/ledger"] });
  };

  const statusLabel = useMemo(() => {
    const status = billingData?.profile.subscription_status || "none";
    return status;
  }, [billingData]);

  const isLoading = loadingBilling || loadingOverview || loadingResources || loadingStatement || loadingLedger;
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!billingData || !overviewData) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("Failed to load billing.")}
      </div>
    );
  }

  const plan = billingData.plan;
  const profile = billingData.profile;
  const entries = ledgerData?.entries ?? [];
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
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">{t("Billing")}</h1>
          <Button variant="outline" onClick={refreshBilling}>{t("Refresh")}</Button>
        </div>

        {(billingError || overviewError || resourceError || statementError || ledgerError) && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">
              {t("Failed to load billing data")}: {String(
                (billingError as Error)?.message ||
                (overviewError as Error)?.message ||
                (resourceError as Error)?.message ||
                (statementError as Error)?.message ||
                (ledgerError as Error)?.message ||
                t("unknown error"),
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>{t("Usage overview")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("Total available credits")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div>{t("Remaining")} <span className="font-semibold">{formatMicros(overviewData.total_available_credits_micros)}</span></div>
                  <button
                    type="button"
                    className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
                    onClick={() => document.getElementById("billing-breakdown")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    {t("View breakdown")}
                  </button>
                  <div className="text-muted-foreground">
                    {t("Resets at")} {profile.current_period_end ? new Date(profile.current_period_end).toLocaleDateString() : t("n/a")}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("Credits used this month")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div>{t("Used")} <span className="font-semibold">{formatMicros(overviewData.included_used_this_month_micros)}</span></div>
                  <button
                    type="button"
                    className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
                    onClick={() => document.getElementById("billing-breakdown")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    {t("View breakdown")}
                  </button>
                  <div className="text-muted-foreground">
                    {t("Included remaining")}: {formatMicros(overviewData.included_remaining_micros)}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("Additional usage")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div>{t("Spent")} <span className="font-semibold">{formatMicros(overviewData.additional_usage_this_month_micros)}</span></div>
                  <div className="text-muted-foreground">
                    {t("Alert")}: {overviewData.controls.usage_alert_micros ? formatMicros(overviewData.controls.usage_alert_micros) : t("Not set")}
                    {" | "}
                    {t("Budget")}: {overviewData.controls.usage_budget_enabled && overviewData.controls.usage_budget_micros
                      ? formatMicros(overviewData.controls.usage_budget_micros)
                      : t("Not set")}
                  </div>
                  <button
                    type="button"
                    onClick={() => setManageOpen(true)}
                    className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300"
                  >
                    {t("Manage")} <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-violet-500" />
                {t("Plan")}
              </CardTitle>
              <CardDescription>{t("Your active subscription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-xl font-semibold">{plan?.display_name || t("No plan")}</div>
              <div className="text-sm text-muted-foreground">{t("Status")}: {statusLabel}</div>
              <div className="text-sm text-muted-foreground">
                {t("Price")}: {formatMicros(plan?.base_price_micros || 0)} / {plan?.billing_interval || "month"}
              </div>
              <div className="text-sm text-muted-foreground">
                {t("Billing model")}: {billingData.billing_model}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("Overage Billing")}</CardTitle>
              <CardDescription>{t("Current additional spend controls")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>{t("Pending overage")}: {formatMicros(profile.pending_overage_micros || 0)}</div>
              <div>{t("Cadence")}: {billingData.overage_billing_cadence_days} {t("days")}</div>
              <div>{t("Minimum invoice")}: {formatMicros(billingData.overage_min_invoice_micros)}</div>
              <div>{t("Next run")}: {billingData.next_overage_billing_at ? new Date(billingData.next_overage_billing_at).toLocaleString() : t("n/a")}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-pink-500" />
                {t("Subscription Period")}
              </CardTitle>
              <CardDescription>{t("Current cycle dates")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>{t("Period start")}: {profile.current_period_start ? new Date(profile.current_period_start).toLocaleString() : t("n/a")}</div>
              <div>{t("Period end")}: {profile.current_period_end ? new Date(profile.current_period_end).toLocaleString() : t("n/a")}</div>
            </CardContent>
          </Card>
        </div>

        <Card id="billing-breakdown">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{t("Credits")}</CardTitle>
                <CardDescription>{t("Manage credit packs and available balances.")}</CardDescription>
              </div>
              <Button onClick={() => setPurchaseOpen(true)} className="gap-2">
                <Banknote className="w-4 h-4" />
                {t("Purchase credit pack")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Coins className="w-4 h-4 text-violet-400" />
                    {t("Credit packs")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {overviewData.credit_pack_balance_micros > 0 ? (
                    <span className="font-semibold">{formatMicros(overviewData.credit_pack_balance_micros)}</span>
                  ) : (
                    <span className="text-muted-foreground">{t("You do not have any credit pack")}</span>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("Promotional credits")}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {overviewData.promotional_credits_micros > 0 ? (
                    <span className="font-semibold">{formatMicros(overviewData.promotional_credits_micros)}</span>
                  ) : (
                    <span className="text-muted-foreground">{t("You do not have any referral credits")}</span>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("Gifted credits")}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {overviewData.gifted_credits_micros > 0 ? (
                    <span className="font-semibold">{formatMicros(overviewData.gifted_credits_micros)}</span>
                  ) : (
                    <span className="text-muted-foreground">{t("You do not have any gifted credits")}</span>
                  )}
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Resource usage")}</CardTitle>
            <CardDescription>{t("Monthly usage grouped by resource type.")}</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Usage Statement")}</CardTitle>
            <CardDescription>{t("Detailed financial statement per generated event.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5 text-sm">
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground">{t("Raw Cost")}</div>
                <div className="font-semibold">{formatMicros(statementData?.totals.raw_cost_micros || 0)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground">{t("Charged")}</div>
                <div className="font-semibold">{formatMicros(statementData?.totals.charged_cost_micros || 0)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground">{t("Gross Profit")}</div>
                <div className="font-semibold">{formatMicros(statementData?.totals.gross_profit_micros || 0)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground">{t("Affiliate Commission")}</div>
                <div className="font-semibold">{formatMicros(statementData?.totals.affiliate_commission_micros || 0)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground">{t("Platform Net")}</div>
                <div className="font-semibold">{formatMicros(statementData?.totals.platform_net_micros || 0)}</div>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Date")}</TableHead>
                  <TableHead>{t("Type")}</TableHead>
                  <TableHead className="text-right">{t("Tokens")}</TableHead>
                  <TableHead className="text-right">{t("Raw Cost")}</TableHead>
                  <TableHead className="text-right">{t("Charged")}</TableHead>
                  <TableHead className="text-right">{t("Profit")}</TableHead>
                  <TableHead className="text-right">{t("Affiliate")}</TableHead>
                  <TableHead className="text-right">{t("Net")}</TableHead>
                  <TableHead className="text-right">{t("Included")}</TableHead>
                  <TableHead className="text-right">{t("Credit Pack")}</TableHead>
                  <TableHead className="text-right">{t("Overage")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(statementData?.items || []).map((item) => (
                  <TableRow key={item.usage_event_id}>
                    <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{item.event_type}</TableCell>
                    <TableCell className="text-right">{item.total_tokens.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{formatMicros(item.raw_cost_micros)}</TableCell>
                    <TableCell className="text-right">{formatMicros(item.charged_cost_micros)}</TableCell>
                    <TableCell className="text-right">{formatMicros(item.gross_profit_micros)}</TableCell>
                    <TableCell className="text-right">{formatMicros(item.affiliate_commission_micros)}</TableCell>
                    <TableCell className="text-right">{formatMicros(item.platform_net_micros)}</TableCell>
                    <TableCell className="text-right">{formatMicros(item.included_usage_micros)}</TableCell>
                    <TableCell className="text-right">{formatMicros(item.credit_pack_usage_micros)}</TableCell>
                    <TableCell className="text-right">{formatMicros(item.overage_usage_micros)}</TableCell>
                  </TableRow>
                ))}
                {(statementData?.items?.length || 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-sm text-muted-foreground">
                      {t("No usage statement entries yet.")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => subscribeMutation.mutate()} disabled={subscribeMutation.isPending}>
            {subscribeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("Subscribe / Change Plan")}
          </Button>
          <Button variant="outline" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
            {portalMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("Manage Billing")}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              {t("Billing Ledger")}
            </CardTitle>
            <CardDescription>{t("Latest billing movements")}</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              {t("Manage your monthly spending")}
            </DialogTitle>
            <DialogDescription>
              {t("Usage alerts and budgets help you control additional usage beyond your monthly credit included in your plan.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="usage-alert-input">{t("Set a usage alert")}</Label>
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
              <Label htmlFor="usage-budget-toggle">{t("Set a usage budget")}</Label>
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
              {t("Credit packs offer predictable upfront spend and are consumed before additional overage charges.")}
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
            disabled={purchasePackMutation.isPending || !selectedPackMicros}
          >
            {purchasePackMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("Continue to payment")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
