import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CreditsResponse } from "@shared/schema";
import { Loader2 } from "lucide-react";

interface AddCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAmount?: number;
}

export function AddCreditsModal({ open, onOpenChange, initialAmount = 10 }: AddCreditsModalProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [customAmount, setCustomAmount] = useState(String(initialAmount));
  const { data } = useQuery<CreditsResponse>({
    queryKey: ["/api/credits"],
    enabled: open,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (amountMicros: number) => {
      const res = await apiRequest("POST", "/api/credits/purchase", { amountMicros });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      onOpenChange(false);
      window.location.href = url;
    },
    onError: (error: Error) => {
      toast({ title: t("Purchase failed"), description: error.message, variant: "destructive" });
    },
  });

  const presets = [10, 25, 50, 100, 250];
  const currentBalance = data?.credits?.balance_micros ?? 0;

  useEffect(() => {
    setCustomAmount(String(initialAmount));
  }, [initialAmount, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Add Credits")}</DialogTitle>
          <DialogDescription>
            {t("Current balance")}: ${(currentBalance / 1_000_000).toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {presets.map((amount) => (
            <Button
              key={amount}
              variant="outline"
              onClick={() => purchaseMutation.mutate(amount * 1_000_000)}
              disabled={purchaseMutation.isPending}
            >
              ${amount}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-credit-amount">{t("Custom Amount")}</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input
              id="custom-credit-amount"
              type="number"
              min={10}
              step={1}
              value={customAmount}
              onChange={(event) => setCustomAmount(event.target.value)}
              className="pl-7"
            />
          </div>
        </div>

        <Button
          onClick={() => purchaseMutation.mutate(Math.round(Number(customAmount || 0) * 1_000_000))}
          disabled={purchaseMutation.isPending}
        >
          {purchaseMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {t("Continue to Stripe")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
