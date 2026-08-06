/**
 * ObjectStorageSection — R2 migration
 *
 * Admin card for the Cloudflare R2 credentials, following the same pattern as
 * PlatformApiKeysSection: values live in platform_settings, the server never
 * returns a secret in full, and a save takes effect immediately with no
 * redeploy.
 *
 * The point of this card is that turning object storage on — or rotating a
 * leaked key — should not require touching the deploy environment.
 *
 * Each field reports whether its value came from `env` or `database`. That
 * distinction matters: an env var always wins, so a value typed here that shows
 * up as "env" afterwards means the host is overriding it and the edit had no
 * effect on what production actually uses.
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
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type FieldState = {
  key: string;
  configured: boolean;
  source: "env" | "database" | "unset";
  preview: string;
};

type StorageStatus = {
  enabled: boolean;
  fields: FieldState[];
};

const FIELDS: Array<{
  key: string;
  label: string;
  secret: boolean;
  placeholder: string;
  hint?: string;
}> = [
  {
    key: "r2_account_id",
    label: "Account ID",
    secret: false,
    placeholder: "2f6b31…",
    hint: "Cloudflare account ID — visible in the dashboard URL.",
  },
  {
    key: "r2_access_key_id",
    label: "Access Key ID",
    secret: true,
    placeholder: "From R2 → Manage API Tokens",
  },
  {
    key: "r2_secret_access_key",
    label: "Secret Access Key",
    secret: true,
    placeholder: "Shown only once when the token is created",
  },
  {
    key: "r2_bucket",
    label: "Bucket",
    secret: false,
    placeholder: "xareable-assets",
  },
  {
    key: "r2_public_base_url",
    label: "Public origin",
    secret: false,
    placeholder: "https://cdn.xareable.com",
    hint: "Custom domain connected to the bucket. No trailing slash. Do not use the r2.dev URL.",
  },
];

export function ObjectStorageSection() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<StorageStatus>({
    queryKey: ["admin", "storage-settings"],
    queryFn: () => apiRequest("GET", "/api/admin/storage-settings").then((r) => r.json()),
  });

  const [inputs, setInputs] = useState<Record<string, string>>({});

  // Clear the local buffer once the server state refreshes after a save.
  useEffect(() => {
    if (!isLoading) setInputs({});
  }, [data, isLoading]);

  const mutation = useMutation({
    mutationFn: (patch: Record<string, string>) =>
      apiRequest("PATCH", "/api/admin/storage-settings", patch).then((r) => r.json()),
    onSuccess: (result: StorageStatus) => {
      qc.invalidateQueries({ queryKey: ["admin", "storage-settings"] });
      toast({
        title: result.enabled
          ? "Object storage saved — R2 is active"
          : "Saved, but R2 is still inactive (some fields are missing)",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save object storage settings",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (isLoading) return null;

  const byKey = new Map((data?.fields ?? []).map((f) => [f.key, f]));
  const patch = Object.fromEntries(
    Object.entries(inputs).filter(([, v]) => v.trim().length > 0).map(([k, v]) => [k, v.trim()]),
  );
  const hasChanges = Object.keys(patch).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Object Storage (Cloudflare R2)
          {data?.enabled ? (
            <Badge variant="default" data-testid="badge-r2-active">Active</Badge>
          ) : (
            <Badge variant="secondary" data-testid="badge-r2-inactive">
              Falling back to Supabase
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Where generated images, carousel slides, logos and reference photos are
          stored. All five fields are required — with any of them missing,
          uploads keep going to the legacy Supabase bucket. Saved to
          platform_settings; takes effect immediately, no redeploy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {FIELDS.map(({ key, label, secret, placeholder, hint }) => {
          const state = byKey.get(key);
          return (
            <div key={key} className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`storage-${key}`}>{label}</Label>
                {state?.source === "env" && (
                  <Badge variant="outline" className="text-[10px]">
                    set by env — overrides this field
                  </Badge>
                )}
              </div>
              {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
              <div className="text-xs text-muted-foreground">
                Current:{" "}
                {state?.configured ? (
                  <span className="font-mono">{state.preview}</span>
                ) : (
                  <span className="text-destructive">Not configured</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id={`storage-${key}`}
                  type={secret ? "password" : "text"}
                  placeholder={state?.configured ? "Enter new value to replace…" : placeholder}
                  value={inputs[key] ?? ""}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                  data-testid={`input-${key.replace(/_/g, "-")}`}
                />
                {state?.configured && state.source === "database" && (
                  <Button
                    variant="outline"
                    onClick={() => mutation.mutate({ [key]: "" })}
                    disabled={mutation.isPending}
                    data-testid={`button-clear-${key.replace(/_/g, "-")}`}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex justify-end">
          <Button
            onClick={() => mutation.mutate(patch)}
            disabled={!hasChanges || mutation.isPending}
            data-testid="button-save-object-storage"
          >
            {mutation.isPending ? "Saving…" : "Save Storage Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
