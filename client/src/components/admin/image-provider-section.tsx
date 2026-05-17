/**
 * ImageProviderSection - Admin card to toggle the active AI image provider
 * PROV-05: Writes to platform_settings.image_provider via PATCH /api/admin/image-provider
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

type ProviderName = "gemini" | "openai";

export function ImageProviderSection() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ provider: ProviderName }>({
    queryKey: ["admin", "image-provider"],
    queryFn: () =>
      apiRequest("GET", "/api/admin/image-provider").then((r) => r.json()),
  });

  const current = data?.provider ?? "gemini";
  const [selected, setSelected] = useState<ProviderName>(current);

  const mutation = useMutation({
    mutationFn: (p: ProviderName) =>
      apiRequest("PATCH", "/api/admin/image-provider", { provider: p }).then(
        (r) => r.json()
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin", "image-provider"] }),
  });

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Image Provider</CardTitle>
        <CardDescription>
          Switch the image-generation backend for ALL flows (single image,
          edit, carousel, enhancement). Change takes effect immediately —
          no server restart needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={selected}
          onValueChange={(v) => setSelected(v as ProviderName)}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="gemini" id="prov-gemini" />
            <Label htmlFor="prov-gemini">
              Gemini (gemini-3.1-flash-image-preview) — current default, lower
              cost
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="openai" id="prov-openai" />
            <Label htmlFor="prov-openai">
              OpenAI (gpt-image-2 via Responses API, model: gpt-5.5) — approx
              $0.05–$0.21/image
            </Label>
          </div>
        </RadioGroup>
        <Button
          onClick={() => mutation.mutate(selected)}
          disabled={mutation.isPending || selected === current}
        >
          {mutation.isPending
            ? "Saving..."
            : `Save (current: ${current})`}
        </Button>
      </CardContent>
    </Card>
  );
}
