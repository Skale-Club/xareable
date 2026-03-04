import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { AddCreditsModal } from "@/components/add-credits-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Wallet, Sparkles } from "lucide-react";
import type {
  CreditTransactionsResponse,
  CreditsResponse,
} from "@shared/schema";

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatTransactionAmount(micros: number): string {
  const sign = micros < 0 ? "-" : "+";
  return `${sign}${formatMicros(Math.abs(micros))}`;
}

function CurrencyInput({
  id,
  value,
  min,
  step,
  onChange,
}: {
  id: string;
  value: string;
  min: number;
  step: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        id={id}
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={onChange}
        className="pl-7"
      />
    </div>
  );
}

export default function CreditsPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isAddCreditsOpen, setIsAddCreditsOpen] = useState(false);
  const [selectedTopUpAmount, setSelectedTopUpAmount] = useState(10);
  const [customTopUp, setCustomTopUp] = useState("10");
  const [autoRechargeEnabled, setAutoRechargeEnabled] = useState(false);
  const [autoRechargeThreshold, setAutoRechargeThreshold] = useState("5");
  const [autoRechargeAmount, setAutoRechargeAmount] = useState("10");

  const { data: creditsData, isLoading: loadingCredits } = useQuery<CreditsResponse>({
    queryKey: ["/api/credits"],
  });

  const { data: transactionsData, isLoading: loadingTransactions } = useQuery<CreditTransactionsResponse>({
    queryKey: ["/api/credits/transactions"],
  });

  const autoRechargeMutation = useMutation({
    mutationFn: async (payload: { enabled: boolean; thresholdMicros: number; amountMicros: number }) => {
      const res = await apiRequest("PATCH", "/api/credits/auto-recharge", payload);
      return res.json() as Promise<CreditsResponse>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/credits"], data);
      setAutoRechargeEnabled(data.credits.auto_recharge_enabled);
      setAutoRechargeThreshold(String(data.credits.auto_recharge_threshold_micros / 1_000_000));
      setAutoRechargeAmount(String(data.credits.auto_recharge_amount_micros / 1_000_000));
      toast({ title: t("Auto-recharge updated") });
    },
    onError: (error: Error) => {
      toast({ title: t("Update failed"), description: error.message, variant: "destructive" });
    },
  });

  const presetAmounts = useMemo(() => [10, 25, 50, 100], []);

  useEffect(() => {
    if (!creditsData?.credits) {
      return;
    }

    setAutoRechargeEnabled(creditsData.credits.auto_recharge_enabled);
    setAutoRechargeThreshold(String(creditsData.credits.auto_recharge_threshold_micros / 1_000_000));
    setAutoRechargeAmount(String(creditsData.credits.auto_recharge_amount_micros / 1_000_000));
  }, [creditsData]);

  if (loadingCredits || loadingTransactions) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const credits = creditsData?.credits;
  const status = creditsData?.status;
  const transactions = transactionsData?.transactions ?? [];

  if (!credits || !status) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("Failed to load credits.")}
      </div>
    );
  }

  const submitAutoRecharge = () => {
    autoRechargeMutation.mutate({
      enabled: autoRechargeEnabled,
      thresholdMicros: Math.round(Number(autoRechargeThreshold || 0) * 1_000_000),
      amountMicros: Math.round(Number(autoRechargeAmount || 0) * 1_000_000),
    });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("Credits")}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("You are now billed per use based on actual AI cost plus markup.")}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-violet-500" />
                {t("Current Balance")}
              </CardTitle>
              <CardDescription>{t("Available credit for future generations.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-4xl font-bold">{formatMicros(credits.balance_micros)}</div>
              <div className="text-sm text-muted-foreground">
                {status.free_generations_remaining > 0
                  ? `${status.free_generations_remaining} ${t(
                    status.free_generations_remaining === 1
                      ? "free generation remaining"
                      : "free generations remaining"
                  )}`
                  : `${t("Estimated next charge")}: ${formatMicros(status.estimated_cost_micros)}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("Markup")}: {status.markup_multiplier.toFixed(1)}x
              </div>
              <Button onClick={() => setIsAddCreditsOpen(true)}>{t("Add Credits")}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-pink-500" />
                {t("Add Credits")}
              </CardTitle>
              <CardDescription>{t("Buy credits instantly with Stripe Checkout.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {presetAmounts.map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    onClick={() => {
                      setCustomTopUp(String(amount));
                      setSelectedTopUpAmount(amount);
                      setIsAddCreditsOpen(true);
                    }}
                  >
                    ${amount}
                  </Button>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-topup">{t("Custom Amount")}</Label>
                <CurrencyInput
                  id="custom-topup"
                  min={10}
                  step={1}
                  value={customTopUp}
                  onChange={(event) => setCustomTopUp(event.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  setSelectedTopUpAmount(Number(customTopUp || 10));
                  setIsAddCreditsOpen(true);
                }}
              >
                {t("Open Add Credits Modal")}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("Auto-Recharge")}</CardTitle>
            <CardDescription>
              {t("After the first successful top-up, Stripe can reuse the saved payment method for automatic recharges.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="font-medium">{t("Enable Auto-Recharge")}</div>
                <div className="text-xs text-muted-foreground">{t("Turn on automatic top-up settings.")}</div>
              </div>
              <Switch checked={autoRechargeEnabled} onCheckedChange={setAutoRechargeEnabled} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="threshold">{t("Threshold (USD)")}</Label>
                <CurrencyInput
                  id="threshold"
                  min={0}
                  step={1}
                  value={autoRechargeThreshold}
                  onChange={(event) => setAutoRechargeThreshold(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">{t("Top-Up Amount (USD)")}</Label>
                <CurrencyInput
                  id="amount"
                  min={0}
                  step={1}
                  value={autoRechargeAmount}
                  onChange={(event) => setAutoRechargeAmount(event.target.value)}
                />
              </div>
            </div>

            <Button onClick={submitAutoRecharge} disabled={autoRechargeMutation.isPending}>
              {autoRechargeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("Save Auto-Recharge Settings")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Recent Transactions")}</CardTitle>
            <CardDescription>{t("Your last 50 credit movements.")}</CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("No transactions yet.")}</div>
            ) : (
              <div className="space-y-3">
                {transactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium capitalize">{t(transaction.type.replace("_", " "))}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(transaction.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={transaction.amount_micros < 0 ? "text-destructive" : "text-green-600"}>
                        {formatTransactionAmount(transaction.amount_micros)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("Balance")}: {formatMicros(transaction.balance_after_micros)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <AddCreditsModal
          open={isAddCreditsOpen}
          onOpenChange={setIsAddCreditsOpen}
          initialAmount={selectedTopUpAmount}
        />
      </div>
    </div>
  );
}
