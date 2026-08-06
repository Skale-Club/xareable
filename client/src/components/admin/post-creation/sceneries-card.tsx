import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { uploadViaPresign } from "@/lib/upload";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon, Plus, Pencil, Trash2, Upload, X, Loader2 } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { slugifyCatalogId } from "@/lib/admin/utils";
import type { Scenery, StyleCatalog } from "@shared/schema";

interface SceneriesCardProps {
  catalog: StyleCatalog;
  setCatalog: React.Dispatch<React.SetStateAction<StyleCatalog | null>>;
}

type DialogMode = { type: "create" } | { type: "edit"; scenery: Scenery };

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

export function SceneriesCard({ catalog, setCatalog }: SceneriesCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Scenery | null>(null);

  const [formLabel, setFormLabel] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formPreviewUrl, setFormPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; objectUrl: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sceneries = useMemo<Scenery[]>(
    () => catalog.sceneries ?? [],
    [catalog.sceneries]
  );

  useEffect(() => {
    return () => {
      if (pendingFile) URL.revokeObjectURL(pendingFile.objectUrl);
    };
  }, [pendingFile]);

  function openCreate() {
    setFormLabel("");
    setFormPrompt("");
    setFormPreviewUrl(null);
    setPendingFile(null);
    setDialogMode({ type: "create" });
  }

  function openEdit(scenery: Scenery) {
    setFormLabel(scenery.label);
    setFormPrompt(scenery.prompt_snippet);
    setFormPreviewUrl(scenery.preview_image_url);
    setPendingFile(null);
    setDialogMode({ type: "edit", scenery });
  }

  function closeDialog() {
    if (pendingFile) URL.revokeObjectURL(pendingFile.objectUrl);
    setPendingFile(null);
    setDialogMode(null);
  }

  function selectFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: t("Invalid file type"),
        description: t("Please select an image."),
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_PREVIEW_BYTES) {
      toast({
        title: t("File too large"),
        description: t("Images must be under 5MB"),
        variant: "destructive",
      });
      return;
    }
    if (pendingFile) URL.revokeObjectURL(pendingFile.objectUrl);
    setPendingFile({ file, objectUrl: URL.createObjectURL(file) });
  }

  function clearPreview() {
    if (pendingFile) URL.revokeObjectURL(pendingFile.objectUrl);
    setPendingFile(null);
    setFormPreviewUrl(null);
  }

  async function uploadPendingFile(sceneryId: string): Promise<string | null> {
    if (!pendingFile) return formPreviewUrl;
    if (!user) {
      toast({ title: t("Not signed in"), variant: "destructive" });
      return null;
    }
    try {
      return await uploadViaPresign({
        kind: "scenery-preview",
        file: pendingFile.file,
        sceneryId,
      });
    } catch (uploadError) {
      toast({
        title: t("Upload failed"),
        description: uploadError instanceof Error ? uploadError.message : String(uploadError),
        variant: "destructive",
      });
      return null;
    }
  }

  async function submitForm() {
    if (!dialogMode) return;
    const label = formLabel.trim();
    const prompt = formPrompt.trim();

    if (!label) {
      toast({ title: t("Scenery label is required"), variant: "destructive" });
      return;
    }
    if (!prompt) {
      toast({ title: t("Prompt snippet is required"), variant: "destructive" });
      return;
    }

    let targetId: string;
    if (dialogMode.type === "edit") {
      targetId = dialogMode.scenery.id;
    } else {
      const baseId = slugifyCatalogId(label);
      if (!baseId) {
        toast({ title: t("Invalid scenery label"), variant: "destructive" });
        return;
      }
      let candidate = baseId;
      let suffix = 2;
      while (sceneries.some((s) => s.id === candidate)) {
        candidate = `${baseId}-${suffix}`;
        suffix += 1;
      }
      targetId = candidate;
    }

    setUploading(true);
    let nextPreviewUrl: string | null = formPreviewUrl;
    if (pendingFile) {
      nextPreviewUrl = await uploadPendingFile(targetId);
      if (nextPreviewUrl === null) {
        setUploading(false);
        return;
      }
    }
    setUploading(false);

    const next: Scenery = {
      id: targetId,
      label,
      prompt_snippet: prompt,
      preview_image_url: nextPreviewUrl,
      is_active: dialogMode.type === "edit" ? dialogMode.scenery.is_active : true,
    };

    setCatalog((current) => {
      if (!current) return current;
      const list = current.sceneries ?? [];
      if (dialogMode.type === "edit") {
        return { ...current, sceneries: list.map((s) => (s.id === targetId ? next : s)) };
      }
      return { ...current, sceneries: [...list, next] };
    });

    if (pendingFile) URL.revokeObjectURL(pendingFile.objectUrl);
    setPendingFile(null);
    setDialogMode(null);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setCatalog((current) => {
      if (!current) return current;
      const list = current.sceneries ?? [];
      return { ...current, sceneries: list.filter((s) => s.id !== id) };
    });
    setPendingDelete(null);
  }

  function toggleActive(id: string, next: boolean) {
    setCatalog((current) => {
      if (!current) return current;
      const list = current.sceneries ?? [];
      return {
        ...current,
        sceneries: list.map((s) => (s.id === id ? { ...s, is_active: next } : s)),
      };
    });
  }

  const previewSource = pendingFile?.objectUrl ?? formPreviewUrl ?? null;

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-1 min-w-0">
          <CardTitle className="flex items-center gap-2">
            <GradientIcon icon={ImageIcon} className="w-5 h-5" />
            {t("Sceneries")}
          </CardTitle>
          <CardDescription>
            {t("Manage scenery presets available in product photo enhancement.")}
          </CardDescription>
        </div>
        <Button size="sm" className="gap-2 shrink-0" onClick={openCreate} data-testid="add-scenery-button">
          <Plus className="w-4 h-4" />
          {t("Add Scenery")}
        </Button>
      </CardHeader>

      <CardContent>
        {sceneries.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg border-dashed">
            {t("No sceneries configured. Add one to get started.")}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {sceneries.map((s) => (
              <article
                key={s.id}
                className="rounded-lg border bg-card overflow-hidden flex flex-col"
                data-testid={`scenery-card-${s.id}`}
              >
                <div className="relative aspect-video bg-muted/40 flex items-center justify-center">
                  {s.preview_image_url ? (
                    <img
                      src={s.preview_image_url}
                      alt={s.label}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
                  )}
                  {!s.is_active && (
                    <Badge variant="secondary" className="absolute top-2 left-2 text-[10px]">
                      {t("Inactive")}
                    </Badge>
                  )}
                </div>
                <div className="p-3 flex flex-col gap-2 flex-1 min-w-0">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium truncate" title={s.label}>{s.label}</h3>
                    <span className="text-[10px] text-muted-foreground font-mono truncate block">
                      {s.id}
                    </span>
                  </div>
                  <p
                    className="text-xs text-muted-foreground line-clamp-2 break-words"
                    title={s.prompt_snippet}
                  >
                    {s.prompt_snippet}
                  </p>
                  <div className="flex items-center justify-between gap-2 pt-1 mt-auto">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                      <Switch
                        checked={s.is_active}
                        onCheckedChange={(next) => toggleActive(s.id, next)}
                        data-testid={`toggle-active-scenery-${s.id}`}
                      />
                      <span>{s.is_active ? t("Active") : t("Inactive")}</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => openEdit(s)}
                        data-testid={`edit-scenery-${s.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        {t("Edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(s)}
                        data-testid={`delete-scenery-${s.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialogMode?.type === "edit" ? t("Edit Scenery") : t("Add Scenery")}
            </DialogTitle>
            <DialogDescription>
              {t("Configure scenery preset for product photo enhancement.")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>{t("Preview Image")}</Label>
              <div className="rounded-lg border border-dashed bg-muted/30 overflow-hidden">
                {previewSource ? (
                  <div className="relative aspect-video">
                    <img
                      src={previewSource}
                      alt={t("Preview")}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={clearPreview}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                      aria-label={t("Remove preview image")}
                      data-testid="clear-scenery-preview"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/60 text-white text-xs flex items-center gap-1 hover:bg-black/80 transition-colors"
                      data-testid="replace-scenery-preview"
                    >
                      <Upload className="w-3 h-3" />
                      {t("Replace")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full aspect-video flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
                    data-testid="upload-scenery-preview"
                  >
                    <Upload className="w-6 h-6" />
                    <span className="font-medium">{t("Click to upload")}</span>
                    <span className="text-xs">{t("PNG, JPG, WEBP up to 5 MB")}</span>
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                onChange={(e) => {
                  selectFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
                className="hidden"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scenery-label">{t("Label")}</Label>
              <Input
                id="scenery-label"
                autoFocus
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder={t("e.g. Marble Light")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scenery-prompt-snippet">{t("Prompt Snippet")}</Label>
              <Textarea
                id="scenery-prompt-snippet"
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                placeholder={t("e.g. Clean light marble surface with soft natural window light...")}
                className="min-h-[100px] resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={uploading}>
              {t("Cancel")}
            </Button>
            <Button type="button" onClick={submitForm} disabled={uploading}>
              {uploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {dialogMode?.type === "edit" ? t("Save Changes") : t("Create Scenery")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete Scenery")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This will remove")} <strong>{pendingDelete?.label}</strong>{" "}
              {t("from the catalog. Save the post settings to persist this change.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              data-testid={`confirm-delete-scenery-${pendingDelete?.id}`}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
