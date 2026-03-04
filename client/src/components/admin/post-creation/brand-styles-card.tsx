import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Palette, Plus, X } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import { useToast } from "@/hooks/use-toast";
import { slugifyCatalogId } from "@/lib/admin/utils";
import type { StyleCatalog } from "@shared/schema";

interface BrandStylesCardProps {
    catalog: StyleCatalog;
    setCatalog: React.Dispatch<React.SetStateAction<StyleCatalog | null>>;
}

export function BrandStylesCard({ catalog, setCatalog }: BrandStylesCardProps) {
    const { toast } = useToast();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [newLabel, setNewLabel] = useState("");
    const [newDescription, setNewDescription] = useState("");

    const updateField = (styleId: string, field: "label" | "description", value: string) => {
        setCatalog((current) => {
            if (!current) return current;
            return {
                ...current,
                styles: current.styles.map((item) => item.id === styleId ? { ...item, [field]: value } : item),
            };
        });
    };

    const addStyle = () => {
        const label = newLabel.trim();
        if (!label) {
            toast({ title: "Style name is required", variant: "destructive" });
            return;
        }

        const baseId = slugifyCatalogId(label);
        if (!baseId) {
            toast({ title: "Invalid style name", variant: "destructive" });
            return;
        }

        let nextId = baseId;
        let suffix = 2;
        while (catalog.styles.some((item) => item.id === nextId)) {
            nextId = `${baseId}-${suffix}`;
            suffix += 1;
        }

        setCatalog({
            ...catalog,
            styles: [
                ...catalog.styles,
                { id: nextId, label, description: newDescription.trim() },
            ],
        });
        setNewLabel("");
        setNewDescription("");
        setIsDialogOpen(false);
    };

    const removeStyle = (e: React.MouseEvent, styleId: string) => {
        e.stopPropagation(); // prevent accordion from toggling
        if (catalog.styles.length === 1) {
            toast({ title: "At least one style is required", variant: "destructive" });
            return;
        }

        setCatalog({
            styles: catalog.styles.filter((item) => item.id !== styleId),
            post_moods: catalog.post_moods.map((item) => ({
                ...item,
                style_ids: item.style_ids.filter((id) => id !== styleId),
            })),
        });
    };

    const unlinkMood = (styleId: string, moodId: string) => {
        setCatalog((current) => {
            if (!current) return current;
            return {
                ...current,
                post_moods: current.post_moods.map(mood => {
                    if (mood.id === moodId) {
                        return {
                            ...mood,
                            style_ids: mood.style_ids.filter(id => id !== styleId)
                        };
                    }
                    return mood;
                })
            };
        });
    };

    return (
        <Card className="shadow-none border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                        <GradientIcon icon={Palette} className="w-5 h-5" />
                        Brand Styles
                    </CardTitle>
                    <CardDescription>Visual styles users choose for their brand.</CardDescription>
                </div>

                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" className="gap-2">
                            <Plus className="w-4 h-4" />
                            Add Style
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Add Brand Style</DialogTitle>
                            <DialogDescription>
                                Create a new visual style option for brands.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="style-label">Style Name</Label>
                                <Input
                                    id="style-label"
                                    value={newLabel}
                                    onChange={(e) => setNewLabel(e.target.value)}
                                    placeholder="e.g. Business"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="style-desc">Description</Label>
                                <Input
                                    id="style-desc"
                                    value={newDescription}
                                    onChange={(e) => setNewDescription(e.target.value)}
                                    placeholder="e.g. Professional, trusted, polished"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" onClick={addStyle}>Create Style</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {catalog.styles.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg border-dashed">
                        No styles configured. Add one to get started.
                    </div>
                ) : (
                    <Accordion type="single" collapsible className="w-full space-y-2">
                        {catalog.styles.map((style) => (
                            <AccordionItem key={style.id} value={style.id} className="border rounded-lg px-3 bg-card data-[state=open]:shadow-sm transition-all">
                                <AccordionTrigger className="hover:no-underline py-3">
                                    <div className="flex items-center justify-between w-full pr-4">
                                        <div className="flex flex-col items-start gap-1">
                                            <span className="font-medium text-sm">{style.label}</span>
                                            <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{style.id}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                onClick={(e) => removeStyle(e, style.id)}
                                                onKeyDown={(e) => { if(e.key==='Enter' || e.key===' ') removeStyle(e as any, style.id); }}
                                                data-testid={`remove-style-${style.id}`}
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
                                                <Label className="text-xs text-muted-foreground">Style Label</Label>
                                                <Input
                                                    value={style.label}
                                                    onChange={(e) => updateField(style.id, "label", e.target.value)}
                                                    className="h-8 shadow-none focus-visible:ring-1"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-muted-foreground">Description</Label>
                                                <Input
                                                    value={style.description}
                                                    onChange={(e) => updateField(style.id, "description", e.target.value)}
                                                    className="h-8 shadow-none focus-visible:ring-1"
                                                />
                                            </div>
                                        </div>

                                        <div className="border-t pt-3">
                                            <Label className="text-xs text-muted-foreground mb-2 block">Linked Moods</Label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {catalog.post_moods
                                                    .filter(mood => mood.style_ids.includes(style.id))
                                                    .map(mood => (
                                                        <Badge key={`${style.id}-${mood.id}`} variant="secondary" className="font-normal pr-1 flex items-center gap-1 group/badge">
                                                            {mood.label}
                                                            <div 
                                                                role="button"
                                                                tabIndex={0}
                                                                className="h-3.5 w-3.5 rounded-full flex items-center justify-center hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    unlinkMood(style.id, mood.id);
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if(e.key==='Enter' || e.key===' ') {
                                                                        e.stopPropagation();
                                                                        unlinkMood(style.id, mood.id);
                                                                    }
                                                                }}
                                                            >
                                                                <X className="w-2.5 h-2.5" />
                                                            </div>
                                                        </Badge>
                                                    ))}
                                                {catalog.post_moods.filter(mood => mood.style_ids.includes(style.id)).length === 0 && (
                                                    <span className="text-xs text-muted-foreground italic">No linked moods</span>
                                                )}
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
