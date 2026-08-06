/**
 * StyleReferenceBoardsCard — Phase 25 (PLAN-07)
 *
 * Unlike every sibling card in this directory, this card does NOT
 * participate in the batched catalog-state save (no catalog-mutation prop
 * is accepted). `style_reference_photos` is a real relational table, not
 * part of the `style_catalog` JSONB blob, so this card owns its own
 * useQuery/useMutation pair with immediate persistence on every
 * upload/delete — see 25-RESEARCH.md "Critical architectural note".
 */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { uploadViaPresign } from "@/lib/upload";
import { adminFetch } from "@/lib/admin";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Images, Loader2, Plus, X } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import {
  MAX_STYLE_REFERENCE_PHOTOS,
  STYLE_REFERENCE_SCOPES,
  type StyleCatalog,
  type StyleReferencePhoto,
  type StyleReferencePhotosResponse,
  type StyleReferenceScope,
} from "@shared/schema";

interface StyleReferenceBoardsCardProps {
  catalog: StyleCatalog; // read-only: supplies the style/mood ids + labels to group by
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function StyleReferenceBoardsCard({ catalog }: StyleReferenceBoardsCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data, isLoading } = useQuery<StyleReferencePhotosResponse>({
    queryKey: ["/api/admin/style-reference-photos"],
    queryFn: () => adminFetch("/api/admin/style-reference-photos"),
  });

  // Group the single unfiltered fetch into scope -> style_id -> sorted photo list.
  const photosByScope = useMemo(() => {
    const map = new Map<StyleReferenceScope, Map<string, StyleReferencePhoto[]>>();
    STYLE_REFERENCE_SCOPES.forEach((scope) => map.set(scope, new Map()));
    (data?.photos ?? []).forEach((photo) => {
      const scopeMap = map.get(photo.scope);
      if (!scopeMap) return;
      const list = scopeMap.get(photo.style_id) ?? [];
      list.push(photo);
      scopeMap.set(photo.style_id, list);
    });
    Array.from(map.values()).forEach((scopeMap) => {
      Array.from(scopeMap.entries()).forEach(([id, list]) => {
        scopeMap.set(id, [...list].sort((a, b) => a.position - b.position));
      });
    });
    return map;
  }, [data]);

  function photosFor(scope: StyleReferenceScope, styleId: string): StyleReferencePhoto[] {
    return photosByScope.get(scope)?.get(styleId) ?? [];
  }

  async function authFetch(path: string, init: RequestInit): Promise<Response> {
    const sb = supabase();
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${session?.access_token}`,
      },
    });
    if (!res.ok) throw new Error(await res.text());
    return res;
  }

  const addMutation = useMutation({
    mutationFn: async (payload: { scope: StyleReferenceScope; style_id: string; photo_url: string }) => {
      const res = await authFetch("/api/admin/style-reference-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/style-reference-photos"] });
      toast({ title: t("Reference image added") });
    },
    onError: (e: any) => {
      toast({ title: t("Failed to add reference image"), description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await authFetch(`/api/admin/style-reference-photos/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/style-reference-photos"] });
      toast({ title: t("Reference image removed") });
    },
    onError: (e: any) => {
      toast({ title: t("Failed to remove reference image"), description: e.message, variant: "destructive" });
    },
  });

  async function handleUpload(scope: StyleReferenceScope, styleId: string, file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: t("Only image files are allowed"), variant: "destructive" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: t("Image must be under 5 MB"), variant: "destructive" });
      return;
    }
    if (!user) {
      toast({ title: t("Not signed in"), variant: "destructive" });
      return;
    }

    const key = `${scope}-${styleId}`;
    setUploadingKey(key);
    try {
      let publicUrl: string;
      try {
        publicUrl = await uploadViaPresign({
          kind: "style-board",
          file,
          scope,
          styleId,
        });
      } catch (uploadError) {
        toast({
          title: t("Failed to add reference image"),
          description: uploadError instanceof Error ? uploadError.message : String(uploadError),
          variant: "destructive",
        });
        return;
      }
      await addMutation.mutateAsync({ scope, style_id: styleId, photo_url: publicUrl });
    } finally {
      setUploadingKey(null);
    }
  }

  function renderBoard(scope: StyleReferenceScope, id: string) {
    const list = photosFor(scope, id);
    const key = `${scope}-${id}`;
    const isUploading = uploadingKey === key;

    return (
      <div className="grid grid-cols-4 gap-2">
        {list.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-square rounded-md overflow-hidden border bg-muted/30 group"
          >
            <img src={photo.photo_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => deleteMutation.mutate(photo.id)}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={t("Remove reference image")}
              data-testid={`remove-style-reference-photo-${photo.id}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {list.length < MAX_STYLE_REFERENCE_PHOTOS && (
          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRefs.current[key]?.click()}
            className="aspect-square rounded-md border border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted/40 transition-colors text-[10px] disabled:opacity-60"
            data-testid={`add-style-reference-photo-${key}`}
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>{t("Add image")}</span>
          </button>
        )}

        <input
          ref={(el) => { fileInputRefs.current[key] = el; }}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (file) void handleUpload(scope, id, file);
          }}
        />
      </div>
    );
  }

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2">
          <GradientIcon icon={Images} className="w-5 h-5" />
          {t("Style Reference Boards")}
        </CardTitle>
        <CardDescription>
          {t("Platform-curated reference images attached to generation when a style or mood is selected.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-11 rounded-md border border-dashed animate-pulse bg-muted/30" />
            <div className="h-11 rounded-md border border-dashed animate-pulse bg-muted/30" />
            <div className="h-11 rounded-md border border-dashed animate-pulse bg-muted/30" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground block">{t("Brand Styles")}</Label>
              {catalog.styles.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg border-dashed">
                  {t("No styles configured. Add one to get started.")}
                </div>
              ) : (
                <Accordion type="single" collapsible className="w-full space-y-2">
                  {catalog.styles.map((style) => {
                    const count = photosFor("style", style.id).length;
                    return (
                      <AccordionItem
                        key={style.id}
                        value={`style-${style.id}`}
                        className="border rounded-lg px-3 bg-card data-[state=open]:shadow-sm transition-all"
                      >
                        <AccordionTrigger className="hover:no-underline py-3">
                          <div className="flex items-center justify-between w-full pr-4">
                            <span className="font-medium text-sm">{style.label}</span>
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                              {count}/{MAX_STYLE_REFERENCE_PHOTOS}
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-1 pb-4">
                          {renderBoard("style", style.id)}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground block">{t("Post Moods")}</Label>
              {catalog.post_moods.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg border-dashed">
                  {t("No moods configured. Add one to get started.")}
                </div>
              ) : (
                <Accordion type="single" collapsible className="w-full space-y-2">
                  {catalog.post_moods.map((mood) => {
                    const count = photosFor("post_mood", mood.id).length;
                    return (
                      <AccordionItem
                        key={mood.id}
                        value={`mood-${mood.id}`}
                        className="border rounded-lg px-3 bg-card data-[state=open]:shadow-sm transition-all"
                      >
                        <AccordionTrigger className="hover:no-underline py-3">
                          <div className="flex items-center justify-between w-full pr-4">
                            <span className="font-medium text-sm">{mood.label}</span>
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                              {count}/{MAX_STYLE_REFERENCE_PHOTOS}
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-1 pb-4">
                          {renderBoard("post_mood", mood.id)}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
