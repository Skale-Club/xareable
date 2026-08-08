/**
 * ZernioGlobalCard — Admin card for the platform-wide Zernio API key.
 *
 * Mirrors the conventions of client/src/components/admin/post-creation/ai-models-card.tsx
 * (Card + GradientIcon header) combined with the key-management pattern used by
 * PlatformApiKeysSection / ObjectStorageSection (masked key display, save/clear).
 *
 * When enabled, users without their own Zernio key (Settings → Social) publish
 * through this platform key instead. See docs/zernio-social-publishing.md.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { GradientIcon } from "@/components/ui/gradient-icon";
import { Share2, Loader2, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import type { AdminZernioSettingsResponse, AdminZernioSettingsPatch } from "@shared/schema";

export function ZernioGlobalCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<AdminZernioSettingsResponse>({
    queryKey: ["/api/admin/social/zernio"],
    queryFn: () => apiRequest("GET", "/api/admin/social/zernio").then((r) => r.json()),
  });

  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  // Clear the local input buffer once the server status refreshes after a save.
  useEffect(() => {
    if (!isLoading) setKeyInput("");
  }, [data?.key_masked, isLoading]);

  async function applyPatch(patch: AdminZernioSettingsPatch) {
    const res = await apiRequest("PATCH", "/api/admin/social/zernio", patch);
    return (await res.json()) as AdminZernioSettingsResponse;
  }

  async function handleSaveKey() {
    const key = keyInput.trim();
    if (!key) return;
    setSavingKey(true);
    try {
      await applyPatch({ api_key: key });
      qc.invalidateQueries({ queryKey: ["/api/admin/social/zernio"] });
      setKeyInput("");
      toast({ title: t("Zernio key saved") });
    } catch (error: any) {
      toast({
        title: t("Failed to save Zernio key"),
        description: String(error?.message || t("The key could not be validated.")),
        variant: "destructive",
      });
    } finally {
      setSavingKey(false);
    }
  }

  async function handleRemoveKey() {
    setRemovingKey(true);
    try {
      await applyPatch({ api_key: null });
      qc.invalidateQueries({ queryKey: ["/api/admin/social/zernio"] });
      toast({ title: t("Zernio key removed") });
    } catch (error: any) {
      toast({
        title: t("Failed to remove Zernio key"),
        description: String(error?.message || ""),
        variant: "destructive",
      });
    } finally {
      setRemovingKey(false);
    }
  }

  async function handleToggleEnabled(next: boolean) {
    setTogglingEnabled(true);
    try {
      await applyPatch({ enabled: next });
      qc.invalidateQueries({ queryKey: ["/api/admin/social/zernio"] });
      toast({
        title: next ? t("Global Zernio publishing enabled") : t("Global Zernio publishing disabled"),
      });
    } catch (error: any) {
      toast({
        title: t("Failed to update Zernio settings"),
        description: String(error?.message || ""),
        variant: "destructive",
      });
    } finally {
      setTogglingEnabled(false);
    }
  }

  if (isLoading) return null;

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <GradientIcon icon={Share2} className="w-5 h-5" />
          {t("Zernio (Global)")}
        </CardTitle>
        <CardDescription>
          {t(
            "A single platform-wide Zernio API key. When enabled, users without their own Zernio key publish through this platform key.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="admin-zernio-key">{t("Zernio API Key")}</Label>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>
              {t("Current key")}:{" "}
              {data?.key_masked ? (
                <span className="font-mono">{data.key_masked}</span>
              ) : (
                <span className="text-destructive">{t("Not configured")}</span>
              )}
            </span>
            {data?.key_masked && (
              data.verified ? (
                <Badge className="text-white" style={{ backgroundColor: "var(--app-success-color)" }} data-testid="badge-admin-zernio-verified">
                  {t("Verified")}
                </Badge>
              ) : (
                <Badge variant="secondary" data-testid="badge-admin-zernio-unverified">
                  {t("Unverified")}
                </Badge>
              )
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="admin-zernio-key"
              type="password"
              placeholder={data?.key_masked ? t("Enter new key to replace…") : "zk_..."}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              data-testid="input-admin-zernio-key"
            />
            <Button
              onClick={handleSaveKey}
              disabled={!keyInput.trim() || savingKey}
              data-testid="button-save-admin-zernio-key"
            >
              {savingKey ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              {t("Save key")}
            </Button>
            {data?.key_masked && (
              <Button
                variant="outline"
                onClick={handleRemoveKey}
                disabled={removingKey}
                data-testid="button-remove-admin-zernio-key"
              >
                {removingKey ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t("Remove")}
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
          <div className="space-y-0.5">
            <Label htmlFor="admin-zernio-enabled">{t("Enable global publishing")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("Users without their own Zernio key will publish through the platform key.")}
            </p>
          </div>
          <Switch
            id="admin-zernio-enabled"
            checked={data?.enabled ?? false}
            onCheckedChange={handleToggleEnabled}
            disabled={!data?.key_masked || togglingEnabled}
            data-testid="switch-admin-zernio-enabled"
          />
        </div>
      </CardContent>
    </Card>
  );
}
