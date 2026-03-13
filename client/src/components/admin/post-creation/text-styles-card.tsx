import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Languages, Plus, X } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { slugifyCatalogId } from "@/lib/admin/utils";
import { DEFAULT_STYLE_CATALOG, type StyleCatalog, type TextStyle } from "@shared/schema";

interface TextStylesCardProps {
  catalog: StyleCatalog;
  setCatalog: React.Dispatch<React.SetStateAction<StyleCatalog | null>>;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(values: string[] | undefined): string {
  return (values || []).join(", ");
}

export function TextStylesCard({ catalog, setCatalog }: TextStylesCardProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newFontFamily, setNewFontFamily] = useState("var(--font-sans)");
  const [newSampleText, setNewSampleText] = useState("Sample");

  const textStyles = useMemo(
    () => catalog.text_styles?.length ? catalog.text_styles : (DEFAULT_STYLE_CATALOG.text_styles || []),
    [catalog.text_styles]
  );

  function updateStyle(styleId: string, updater: (style: TextStyle) => TextStyle) {
    setCatalog((current) => {
      if (!current) return current;
      const currentStyles = current.text_styles?.length
        ? current.text_styles
        : (DEFAULT_STYLE_CATALOG.text_styles || []);

      return {
        ...current,
        text_styles: currentStyles.map((style) => style.id === styleId ? updater(style) : style),
      };
    });
  }

  function addStyle() {
    const label = newLabel.trim();
    if (!label) {
      toast({ title: t("Style name is required"), variant: "destructive" });
      return;
    }

    const baseId = slugifyCatalogId(label);
    if (!baseId) {
      toast({ title: t("Invalid style name"), variant: "destructive" });
      return;
    }

    let nextId = baseId;
    let suffix = 2;
    while (textStyles.some((style) => style.id === nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const nextStyle: TextStyle = {
      id: nextId,
      label,
      description: newDescription.trim(),
      categories: [],
      preview: {
        font_family: newFontFamily.trim() || "var(--font-sans)",
        sample_text: newSampleText.trim() || label,
        use_case: "",
      },
      prompt_hints: {
        typography: "",
        layout: "",
        emphasis: "",
        avoid: [],
      },
    };

    setCatalog((current) => {
      if (!current) return current;
      const currentStyles = current.text_styles?.length
        ? current.text_styles
        : (DEFAULT_STYLE_CATALOG.text_styles || []);

      return {
        ...current,
        text_styles: [...currentStyles, nextStyle],
      };
    });

    setNewLabel("");
    setNewDescription("");
    setNewFontFamily("var(--font-sans)");
    setNewSampleText("Sample");
    setIsDialogOpen(false);
  }

  function removeStyle(e: React.MouseEvent, styleId: string) {
    e.stopPropagation();
    if (textStyles.length <= 1) {
      toast({ title: t("At least one font style is required"), variant: "destructive" });
      return;
    }

    setCatalog((current) => {
      if (!current) return current;
      return {
        ...current,
        text_styles: textStyles.filter((style) => style.id !== styleId),
      };
    });
  }

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <GradientIcon icon={Languages} className="w-5 h-5" />
            {t("Font Styles")}
          </CardTitle>
          <CardDescription>{t("Manage the font directions available in post creation and editing.")}</CardDescription>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              {t("Add Font Style")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("Add Font Style")}</DialogTitle>
              <DialogDescription>
                {t("Create a new font style option for post creation and editing.")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="font-style-label">{t("Style Name")}</Label>
                  <Input
                    id="font-style-label"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={t("e.g. Bold Offer")}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="font-style-font-family">{t("Font Family")}</Label>
                  <Input
                    id="font-style-font-family"
                    value={newFontFamily}
                    onChange={(e) => setNewFontFamily(e.target.value)}
                    placeholder={t("e.g. Impact, Arial Black, sans-serif")}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="font-style-description">{t("Description")}</Label>
                <Input
                  id="font-style-description"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder={t("e.g. Strong promo styling with high contrast")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="font-style-sample-text">{t("Preview Text")}</Label>
                <Input
                  id="font-style-sample-text"
                  value={newSampleText}
                  onChange={(e) => setNewSampleText(e.target.value)}
                  placeholder={t("e.g. BOLD OFFER")}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" onClick={addStyle}>{t("Create Font Style")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {textStyles.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg border-dashed">
            {t("No font styles configured. Add one to get started.")}
          </div>
        ) : (
          <Accordion type="single" collapsible className="w-full space-y-2">
            {textStyles.map((style) => (
              <AccordionItem key={style.id} value={style.id} className="border rounded-lg px-3 bg-card data-[state=open]:shadow-sm transition-all">
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center justify-between w-full pr-4 gap-4">
                    {/* Left: Metadata */}
                    <div className="flex flex-col items-start gap-1 min-w-[120px] shrink-0">
                      <span className="font-medium text-sm truncate">
                        {style.label}
                      </span>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{style.id}</span>
                        {style.categories?.length ? (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                            {style.categories.length} {t("Tags")}
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    {/* Right/Center: Compact Visual Preview */}
                    <div className="flex-1 flex justify-end min-w-0 px-2 overflow-hidden">
                      <div 
                        className="max-w-full px-3 py-1.5 rounded-md bg-violet-400/5 border border-violet-400/10 truncate flex items-center justify-end"
                        style={{ fontFamily: style.preview.font_family }}
                        title={style.preview.sample_text || style.label}
                      >
                        <span className="text-base sm:text-lg truncate text-foreground/80 leading-none">
                          {style.preview.sample_text || style.label}
                        </span>
                      </div>
                    </div>

                    {/* Delete Action */}
                    <div
                      role="button"
                      tabIndex={0}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      onClick={(e) => removeStyle(e, style.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") removeStyle(e as any, style.id); }}
                      data-testid={`remove-text-style-${style.id}`}
                    >
                      <X className="w-4 h-4" />
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-1 pb-4">
                  <div className="space-y-6">
                    {/* Visual Preview (Large version for when expanded) */}
                    <div
                      className="rounded-xl border border-violet-400/20 bg-violet-400/5 px-6 py-8 flex items-center justify-center text-center overflow-hidden"
                      style={{ fontFamily: style.preview.font_family }}
                    >
                      <div className="text-3xl sm:text-4xl leading-tight text-foreground/90">
                        {style.preview.sample_text || t("Preview Text")}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="grid gap-6 sm:grid-cols-2">
                        {/* Core Details */}
                        <div className="space-y-4">
                          <h4 className="text-sm font-medium border-b pb-2">{t("Core Details")}</h4>
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("Style Name")}</Label>
                              <Input
                                value={style.label}
                                onChange={(e) => updateStyle(style.id, (current) => ({ ...current, label: e.target.value }))}
                                className="h-8 shadow-none focus-visible:ring-1"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("Font Family")}</Label>
                              <Input
                                value={style.preview.font_family}
                                onChange={(e) => updateStyle(style.id, (current) => ({
                                  ...current,
                                  preview: { ...current.preview, font_family: e.target.value },
                                }))}
                                className="h-8 shadow-none focus-visible:ring-1 font-mono text-xs"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("Preview Text")}</Label>
                              <Input
                                value={style.preview.sample_text}
                                onChange={(e) => updateStyle(style.id, (current) => ({
                                  ...current,
                                  preview: { ...current.preview, sample_text: e.target.value },
                                }))}
                                className="h-8 shadow-none focus-visible:ring-1"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Usage & Organization */}
                        <div className="space-y-4">
                          <h4 className="text-sm font-medium border-b pb-2">{t("Usage & Context")}</h4>
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("Description")}</Label>
                              <Input
                                value={style.description}
                                onChange={(e) => updateStyle(style.id, (current) => ({ ...current, description: e.target.value }))}
                                className="h-8 shadow-none focus-visible:ring-1"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("Use Case")}</Label>
                              <Input
                                value={style.preview.use_case}
                                onChange={(e) => updateStyle(style.id, (current) => ({
                                  ...current,
                                  preview: { ...current.preview, use_case: e.target.value },
                                }))}
                                className="h-8 shadow-none focus-visible:ring-1"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("Tags")}</Label>
                              <Input
                                value={joinCsv(style.categories)}
                                onChange={(e) => updateStyle(style.id, (current) => ({
                                  ...current,
                                  categories: splitCsv(e.target.value),
                                }))}
                                placeholder={t("e.g. promo, food, luxury")}
                                className="h-8 shadow-none focus-visible:ring-1"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Prompt Guidelines */}
                      <div className="space-y-4">
                        <h4 className="text-sm font-medium border-b pb-2">{t("AI Generation Guidelines")}</h4>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{t("Typography Hint")}</Label>
                            <Textarea
                              value={style.prompt_hints.typography}
                              onChange={(e) => updateStyle(style.id, (current) => ({
                                ...current,
                                prompt_hints: { ...current.prompt_hints, typography: e.target.value },
                              }))}
                              className="min-h-[80px] resize-none shadow-none focus-visible:ring-1 text-xs"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{t("Layout Hint")}</Label>
                            <Textarea
                              value={style.prompt_hints.layout}
                              onChange={(e) => updateStyle(style.id, (current) => ({
                                ...current,
                                prompt_hints: { ...current.prompt_hints, layout: e.target.value },
                              }))}
                              className="min-h-[80px] resize-none shadow-none focus-visible:ring-1 text-xs"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{t("Emphasis Hint")}</Label>
                            <Textarea
                              value={style.prompt_hints.emphasis}
                              onChange={(e) => updateStyle(style.id, (current) => ({
                                ...current,
                                prompt_hints: { ...current.prompt_hints, emphasis: e.target.value },
                              }))}
                              className="min-h-[80px] resize-none shadow-none focus-visible:ring-1 text-xs"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{t("Avoid Terms")}</Label>
                            <Textarea
                              value={joinCsv(style.prompt_hints.avoid)}
                              onChange={(e) => updateStyle(style.id, (current) => ({
                                ...current,
                                prompt_hints: { ...current.prompt_hints, avoid: splitCsv(e.target.value) },
                              }))}
                              placeholder={t("e.g. tiny text, weak contrast")}
                              className="min-h-[80px] resize-none shadow-none focus-visible:ring-1 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
