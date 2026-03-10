import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Sparkles, Check } from "lucide-react";

interface UpgradePlanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpgradePlanModal({ open, onOpenChange }: UpgradePlanModalProps) {
  const { toast } = useToast();
  const { t } = useTranslation();

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/subscribe", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      onOpenChange(false);
      window.location.href = url;
    },
    onError: (error: Error) => {
      toast({
        title: t("Subscription failed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-500" />
            {t("Upgrade to Core")}
          </DialogTitle>
          <DialogDescription>
            {t("Your free generation has been used. Upgrade to the Core plan to unlock unlimited creations.")}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
          <div className="text-lg font-semibold">
            Core — $9.90<span className="text-sm font-normal text-muted-foreground">/{t("month")}</span>
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-violet-500 shrink-0" />
              {t("$10.00 in included credits per month")}
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-violet-500 shrink-0" />
              {t("AI image & video generation")}
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-violet-500 shrink-0" />
              {t("Overage billing (pay only for what you use)")}
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-violet-500 shrink-0" />
              {t("Spending controls & usage alerts")}
            </li>
          </ul>
        </div>

        <Button
          onClick={() => subscribeMutation.mutate()}
          disabled={subscribeMutation.isPending}
          className="w-full bg-gradient-to-r from-violet-600 to-pink-500 hover:from-violet-700 hover:to-pink-600"
        >
          {subscribeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {t("Subscribe to Core")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
