import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Frame, Plus, X, Square, RectangleHorizontal, RectangleVertical, ArrowUp, ArrowDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { slugifyCatalogId } from "@/lib/admin/utils";
import { type StyleCatalog, DEFAULT_STYLE_CATALOG } from "@shared/schema";

import { GradientIcon } from "@/components/ui/gradient-icon";

const AVAILABLE_ICONS = [
    { value: "Square", label: "Square", icon: Square },
    { value: "RectangleVertical", label: "Vertical Rectangle", icon: RectangleVertical },
    { value: "RectangleHorizontal", label: "Horizontal Rectangle", icon: RectangleHorizontal },
];

interface PostFormatsCardProps {
    catalog: StyleCatalog;
    setCatalog: React.Dispatch<React.SetStateAction<StyleCatalog | null>>;
}

export function PostFormatsCard({ catalog, setCatalog }: PostFormatsCardProps) {
    const { toast } = useToast();
    const { t } = useTranslation();
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // New format state
    const [newLabel, setNewLabel] = useState("");
    const [newSubtitle, setNewSubtitle] = useState("");
    const [newValue, setNewValue] = useState("");
    const [newIcon, setNewIcon] = useState("Square");

    // Fallback to defaults if not present in catalog
    const formats = catalog.post_formats || DEFAULT_STYLE_CATALOG.post_formats || [];

    const updateField = (formatId: string, field: "label" | "subtitle" | "value" | "icon", value: string) => {
        setCatalog((current) => {
            if (!current) return current;
            const currentFormats = current.post_formats || DEFAULT_STYLE_CATALOG.post_formats || [];
            return {
                ...current,
                post_formats: currentFormats.map((item) => item.id === formatId ? { ...item, [field]: value } : item),
            };
        });
    };

    const addFormat = () => {
        const label = newLabel.trim();
        const value = newValue.trim();

        if (!label || !value) {
            toast({ title: t("Label and Value are required"), variant: "destructive" });
            return;
        }

        const baseId = slugifyCatalogId(label);
        if (!baseId) {
            toast({ title: t("Invalid format label"), variant: "destructive" });
            return;
        }

        let nextId = baseId;
        let suffix = 2;
        while (formats.some((item) => item.id === nextId)) {
            nextId = `${baseId}-${suffix}`;
            suffix += 1;
        }

        setCatalog((current) => {
            if (!current) return current;
            const currentFormats = current.post_formats || DEFAULT_STYLE_CATALOG.post_formats || [];
            return {
                ...current,
                post_formats: [
                    ...currentFormats,
                    {
                        id: nextId,
                        label,
                        subtitle: newSubtitle.trim(),
                        value,
                        icon: newIcon
                    },
                ],
            };
        });

        setNewLabel("");
        setNewSubtitle("");
        setNewValue("");
        setNewIcon("Square");
        setIsDialogOpen(false);
    };

    const removeFormat = (e: React.MouseEvent, formatId: string) => {
        e.stopPropagation();
        if (formats.length <= 1) {
            toast({ title: t("At least one format is required"), variant: "destructive" });
            return;
        }

        setCatalog((current) => {
            if (!current) return current;
            const currentFormats = current.post_formats || DEFAULT_STYLE_CATALOG.post_formats || [];
            return {
                ...current,
                post_formats: currentFormats.filter((item) => item.id !== formatId),
            };
        });
    };

    const moveFormat = (e: React.MouseEvent, index: number, direction: "up" | "down") => {
        e.stopPropagation();

        setCatalog((current) => {
            if (!current) return current;
            const currentFormats = [...(current.post_formats || DEFAULT_STYLE_CATALOG.post_formats || [])];

            if (direction === "up" && index > 0) {
                const temp = currentFormats[index];
                currentFormats[index] = currentFormats[index - 1];
                currentFormats[index - 1] = temp;
            } else if (direction === "down" && index < currentFormats.length - 1) {
                const temp = currentFormats[index];
                currentFormats[index] = currentFormats[index + 1];
                currentFormats[index + 1] = temp;
            } else {
                return current;
            }

            return {
                ...current,
                post_formats: currentFormats,
            };
        });
    };

    return (
        <Card className="shadow-none border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                        <GradientIcon icon={Frame} className="w-5 h-5" />
                        {t("Post Formats")}
                    </CardTitle>
                    <CardDescription>{t("Manage available aspect ratios and dimensions.")}</CardDescription>
                </div>

                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" className="gap-2">
                            <Plus className="w-4 h-4" />
                            {t("Add Format")}
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{t("Add Post Format")}</DialogTitle>
                            <DialogDescription>
                                {t("Create a new format for the post creator.")}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="format-label">{t("Label")}</Label>
                                <Input
                                    id="format-label"
                                    value={newLabel}
                                    onChange={(e) => setNewLabel(e.target.value)}
                                    placeholder={t("e.g. Square")}
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="format-value">{t("Value / Aspect Ratio")}</Label>
                                <Input
                                    id="format-value"
                                    value={newValue}
                                    onChange={(e) => setNewValue(e.target.value)}
                                    placeholder={t("e.g. 1:1, 16:9, 1200:628")}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="format-subtitle">{t("Subtitle (Optional)")}</Label>
                                <Input
                                    id="format-subtitle"
                                    value={newSubtitle}
                                    onChange={(e) => setNewSubtitle(e.target.value)}
                                    placeholder={t("e.g. Instagram Post")}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t("Icon")}</Label>
                                <Select value={newIcon} onValueChange={setNewIcon}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {AVAILABLE_ICONS.map((icon) => (
                                            <SelectItem key={icon.value} value={icon.value}>
                                                <div className="flex items-center gap-2">
                                                    <icon.icon className="w-4 h-4" />
                                                    {t(icon.label)}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" onClick={addFormat}>{t("Create Format")}</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {formats.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg border-dashed">
                        {t("No formats configured. Add one to get started.")}
                    </div>
                ) : (
                    <Accordion type="single" collapsible className="w-full space-y-2">
                        {formats.map((format, index) => {
                            const IconComponent = AVAILABLE_ICONS.find(i => i.value === format.icon)?.icon || Square;

                            return (
                                <AccordionItem key={format.id} value={format.id} className="border rounded-lg px-3 bg-card data-[state=open]:shadow-sm transition-all">
                                    <AccordionTrigger className="hover:no-underline py-3">
                                        <div className="flex items-center justify-between w-full pr-4">
                                            <div className="flex flex-col items-start gap-1">
                                                <div className="flex items-center gap-2">
                                                    <IconComponent className="w-4 h-4 text-muted-foreground" />
                                                    <span className="font-medium text-sm">{format.label}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{format.value}</span>
                                                    {format.subtitle && (
                                                        <span className="text-[10px] text-muted-foreground">{format.subtitle}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${index === 0 ? "opacity-30 cursor-default" : "text-muted-foreground hover:bg-muted"}`}
                                                    onClick={(e) => index > 0 && moveFormat(e, index, "up")}
                                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { index > 0 && moveFormat(e as any, index, "up"); } }}
                                                    title={t("Move up")}
                                                >
                                                    <ArrowUp className="w-4 h-4" />
                                                </div>
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${index === formats.length - 1 ? "opacity-30 cursor-default" : "text-muted-foreground hover:bg-muted"}`}
                                                    onClick={(e) => index < formats.length - 1 && moveFormat(e, index, "down")}
                                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { index < formats.length - 1 && moveFormat(e as any, index, "down"); } }}
                                                    title={t("Move down")}
                                                >
                                                    <ArrowDown className="w-4 h-4" />
                                                </div>
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    className="h-7 w-7 ml-1 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                    onClick={(e) => removeFormat(e, format.id)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') removeFormat(e as any, format.id); }}
                                                    data-testid={`remove-format-${format.id}`}
                                                    title={t("Remove format")}
                                                >
                                                    <X className="w-4 h-4" />
                                                </div>
                                            </div>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="pt-1 pb-4">
                                        <div className="flex flex-col gap-4">
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div className="space-y-1.5">
                                                    <Label className="text-xs text-muted-foreground">{t("Label")}</Label>
                                                    <Input
                                                        value={format.label}
                                                        onChange={(e) => updateField(format.id, "label", e.target.value)}
                                                        className="h-8 shadow-none focus-visible:ring-1"
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <Label className="text-xs text-muted-foreground">{t("Value / Ratio")}</Label>
                                                    <Input
                                                        value={format.value}
                                                        onChange={(e) => updateField(format.id, "value", e.target.value)}
                                                        className="h-8 shadow-none focus-visible:ring-1 font-mono text-sm"
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <Label className="text-xs text-muted-foreground">{t("Subtitle")}</Label>
                                                    <Input
                                                        value={format.subtitle}
                                                        onChange={(e) => updateField(format.id, "subtitle", e.target.value)}
                                                        className="h-8 shadow-none focus-visible:ring-1"
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <Label className="text-xs text-muted-foreground">{t("Icon")}</Label>
                                                    <Select value={format.icon} onValueChange={(value) => updateField(format.id, "icon", value)}>
                                                        <SelectTrigger className="h-8 shadow-none">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {AVAILABLE_ICONS.map((icon) => (
                                                                <SelectItem key={icon.value} value={icon.value}>
                                                                    <div className="flex items-center gap-2">
                                                                        <icon.icon className="w-4 h-4" />
                                                                        {t(icon.label)}
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            )
                        })}
                    </Accordion>
                )}
            </CardContent>
        </Card>
    );
}
