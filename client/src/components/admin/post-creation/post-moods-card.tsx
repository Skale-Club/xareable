import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { slugifyCatalogId } from "@/lib/admin/utils";
import type { StyleCatalog } from "@shared/schema";

import { GradientIcon } from "@/components/ui/gradient-icon";

interface PostMoodsCardProps {
    catalog: StyleCatalog;
    setCatalog: React.Dispatch<React.SetStateAction<StyleCatalog | null>>;
}

export function PostMoodsCard({ catalog, setCatalog }: PostMoodsCardProps) {
    const { toast } = useToast();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [newLabel, setNewLabel] = useState("");
    const [newDescription, setNewDescription] = useState("");

    const updateField = (moodId: string, field: "label" | "description", value: string) => {
        setCatalog((current) => {
            if (!current) return current;
            return {
                ...current,
                post_moods: current.post_moods.map((item) => item.id === moodId ? { ...item, [field]: value } : item),
            };
        });
    };

    const toggleStyle = (moodId: string, styleId: string) => {
        setCatalog((current) => {
            if (!current) return current;
            return {
                ...current,
                post_moods: current.post_moods.map((item) => {
                    if (item.id !== moodId) return item;
                    const nextStyleIds = item.style_ids.includes(styleId)
                        ? item.style_ids.filter((id) => id !== styleId)
                        : [...item.style_ids, styleId];
                    return { ...item, style_ids: nextStyleIds };
                }),
            };
        });
    };

    const addMood = () => {
        const label = newLabel.trim();
        if (!label) {
            toast({ title: "Mood name is required", variant: "destructive" });
            return;
        }

        const baseId = slugifyCatalogId(label);
        if (!baseId) {
            toast({ title: "Invalid mood name", variant: "destructive" });
            return;
        }

        let nextId = baseId;
        let suffix = 2;
        while (catalog.post_moods.some((item) => item.id === nextId)) {
            nextId = `${baseId}-${suffix}`;
            suffix += 1;
        }

        setCatalog({
            ...catalog,
            post_moods: [
                ...catalog.post_moods,
                { id: nextId, label, description: newDescription.trim(), style_ids: [] },
            ],
        });
        setNewLabel("");
        setNewDescription("");
        setIsDialogOpen(false);
    };

    const removeMood = (e: React.MouseEvent, moodId: string) => {
        e.stopPropagation();
        if (catalog.post_moods.length === 1) {
            toast({ title: "At least one post mood is required", variant: "destructive" });
            return;
        }

        setCatalog({
            ...catalog,
            post_moods: catalog.post_moods.filter((item) => item.id !== moodId),
        });
    };

    return (
        <Card className="shadow-none border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                        <GradientIcon icon={Sparkles} className="w-5 h-5" />
                        Post Moods
                    </CardTitle>
                    <CardDescription>Moods that depend on the assigned styles.</CardDescription>
                </div>

                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" className="gap-2">
                            <Plus className="w-4 h-4" />
                            Add Mood
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Add Post Mood</DialogTitle>
                            <DialogDescription>
                                Create a new tone or context for AI posts.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="mood-label">Mood Name</Label>
                                <Input
                                    id="mood-label"
                                    value={newLabel}
                                    onChange={(e) => setNewLabel(e.target.value)}
                                    placeholder="e.g. Promo"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="mood-desc">Description</Label>
                                <Input
                                    id="mood-desc"
                                    value={newDescription}
                                    onChange={(e) => setNewDescription(e.target.value)}
                                    placeholder="e.g. Sales, offers, urgency"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" onClick={addMood}>Create Mood</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {catalog.post_moods.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg border-dashed">
                        No moods configured. Add one to get started.
                    </div>
                ) : (
                    <Accordion type="single" collapsible className="w-full space-y-2">
                        {catalog.post_moods.map((mood) => (
                            <AccordionItem key={mood.id} value={mood.id} className="border rounded-lg px-3 bg-card data-[state=open]:shadow-sm transition-all">
                                <AccordionTrigger className="hover:no-underline py-3">
                                    <div className="flex items-center justify-between w-full pr-4">
                                        <div className="flex flex-col items-start gap-1">
                                            <span className="font-medium text-sm">{mood.label}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{mood.id}</span>
                                                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{mood.style_ids.length} Styles</Badge>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                onClick={(e) => removeMood(e, mood.id)}
                                                onKeyDown={(e) => { if(e.key==='Enter' || e.key===' ') removeMood(e as any, mood.id); }}
                                                data-testid={`remove-post-mood-${mood.id}`}
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
                                                <Label className="text-xs text-muted-foreground">Mood Label</Label>
                                                <Input
                                                    value={mood.label}
                                                    onChange={(e) => updateField(mood.id, "label", e.target.value)}
                                                    className="h-8 shadow-none focus-visible:ring-1"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-muted-foreground">Description</Label>
                                                <Input
                                                    value={mood.description}
                                                    onChange={(e) => updateField(mood.id, "description", e.target.value)}
                                                    className="h-8 shadow-none focus-visible:ring-1"
                                                />
                                            </div>
                                        </div>

                                        <div className="border-t pt-3">
                                            <Label className="text-xs text-muted-foreground mb-2 block">Compatible Styles</Label>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                {catalog.styles.map((style) => {
                                                    const isSelected = mood.style_ids.includes(style.id);
                                                    return (
                                                        <div
                                                            key={`${mood.id}-${style.id}`}
                                                            role="button"
                                                            tabIndex={0}
                                                            className={`flex items-center gap-2 p-2 rounded-md border text-sm cursor-pointer transition-colors ${
                                                                isSelected 
                                                                    ? "border-primary bg-primary/5 text-primary" 
                                                                    : "border-border hover:border-primary/50 text-muted-foreground"
                                                            }`}
                                                            onClick={() => toggleStyle(mood.id, style.id)}
                                                            onKeyDown={(e) => { if(e.key==='Enter' || e.key===' ') toggleStyle(mood.id, style.id); }}
                                                        >
                                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                                                isSelected ? "bg-primary border-primary" : "border-input"
                                                            }`}>
                                                                {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                                                            </div>
                                                            <span className="truncate flex-1">{style.label}</span>
                                                        </div>
                                                    );
                                                })}
                                                {catalog.styles.length === 0 && (
                                                    <div className="col-span-full text-xs text-muted-foreground italic">
                                                        No styles available. Add brand styles first.
                                                    </div>
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
