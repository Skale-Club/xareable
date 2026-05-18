/**
 * PlatformApiKeysSection — Phase 12.2
 *
 * Admin card to manage platform-default Gemini + OpenAI API keys.
 * These keys are used by regular (non-admin, non-affiliate) users for
 * image generation. Admin/affiliate users keep using their own per-profile keys.
 *
 * Values are stored in platform_settings.gemini_api_key / openai_api_key.
 * Server never returns the raw key — only a short preview (e.g. "sk-1…ab").
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ApiKeysStatus = {
  gemini_configured: boolean;
  openai_configured: boolean;
  gemini_preview: string;
  openai_preview: string;
};

export function PlatformApiKeysSection() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ApiKeysStatus>({
    queryKey: ["admin", "api-keys"],
    queryFn: () => apiRequest("GET", "/api/admin/api-keys").then((r) => r.json()),
  });

  const [geminiInput, setGeminiInput] = useState("");
  const [openaiInput, setOpenaiInput] = useState("");

  // Clear local inputs whenever server status refreshes (post-save)
  useEffect(() => {
    if (!isLoading) {
      setGeminiInput("");
      setOpenaiInput("");
    }
  }, [data?.gemini_preview, data?.openai_preview, isLoading]);

  const mutation = useMutation({
    mutationFn: (patch: { gemini_api_key?: string; openai_api_key?: string }) =>
      apiRequest("PATCH", "/api/admin/api-keys", patch).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "api-keys"] });
      toast({ title: "API keys saved" });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save API keys",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (isLoading) return null;

  function buildPatch() {
    const patch: { gemini_api_key?: string; openai_api_key?: string } = {};
    if (geminiInput.trim().length > 0) patch.gemini_api_key = geminiInput.trim();
    if (openaiInput.trim().length > 0) patch.openai_api_key = openaiInput.trim();
    return patch;
  }

  function handleClearGemini() {
    mutation.mutate({ gemini_api_key: "" });
  }
  function handleClearOpenai() {
    mutation.mutate({ openai_api_key: "" });
  }

  const patch = buildPatch();
  const hasChanges = Object.keys(patch).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform API Keys</CardTitle>
        <CardDescription>
          Default keys used by regular users. Admin/affiliate accounts keep using
          their own per-profile keys configured in /settings. Stored in
          platform_settings; takes effect immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Gemini */}
        <div className="space-y-2">
          <Label htmlFor="platform-gemini-key">Gemini API Key</Label>
          <div className="text-xs text-muted-foreground">
            Current:{" "}
            {data?.gemini_configured ? (
              <span className="font-mono">{data.gemini_preview}</span>
            ) : (
              <span className="text-destructive">Not configured</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="platform-gemini-key"
              type="password"
              placeholder={
                data?.gemini_configured
                  ? "Enter new key to replace…"
                  : "AIza…"
              }
              value={geminiInput}
              onChange={(e) => setGeminiInput(e.target.value)}
              data-testid="input-platform-gemini-key"
            />
            {data?.gemini_configured && (
              <Button
                variant="outline"
                onClick={handleClearGemini}
                disabled={mutation.isPending}
                data-testid="button-clear-platform-gemini-key"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* OpenAI */}
        <div className="space-y-2">
          <Label htmlFor="platform-openai-key">OpenAI API Key</Label>
          <div className="text-xs text-muted-foreground">
            Current:{" "}
            {data?.openai_configured ? (
              <span className="font-mono">{data.openai_preview}</span>
            ) : (
              <span className="text-destructive">Not configured</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="platform-openai-key"
              type="password"
              placeholder={
                data?.openai_configured
                  ? "Enter new key to replace…"
                  : "sk-…"
              }
              value={openaiInput}
              onChange={(e) => setOpenaiInput(e.target.value)}
              data-testid="input-platform-openai-key"
            />
            {data?.openai_configured && (
              <Button
                variant="outline"
                onClick={handleClearOpenai}
                disabled={mutation.isPending}
                data-testid="button-clear-platform-openai-key"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => mutation.mutate(patch)}
            disabled={!hasChanges || mutation.isPending}
            data-testid="button-save-platform-api-keys"
          >
            {mutation.isPending ? "Saving…" : "Save Keys"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
