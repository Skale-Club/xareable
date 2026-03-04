import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import { Cpu } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import type { StyleCatalog, AIModels } from "@shared/schema";

interface AIModelsCardProps {
    catalog: StyleCatalog;
    setCatalog: React.Dispatch<React.SetStateAction<StyleCatalog | null>>;
}

export function AIModelsCard({ catalog, setCatalog }: AIModelsCardProps) {
    const { t } = useTranslation();
    const aiModels = catalog.ai_models || {
        image_generation: "gemini-3.1-flash-image-preview",
        text_generation: "gemini-2.5-flash",
        audio_transcription: "gemini-2.5-flash",
    };

    const updateModel = (field: keyof AIModels, value: string) => {
        setCatalog((current) => {
            if (!current) return current;
            return {
                ...current,
                ai_models: {
                    ...aiModels,
                    [field]: value
                }
            };
        });
    };

    return (
        <Card className="shadow-none border-border">
            <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                    <GradientIcon icon={Cpu} className="w-5 h-5" />
                    {t("AI Models")}
                </CardTitle>
                <CardDescription>{t("Select which AI models handle specific tasks across the platform.")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("Image Generation")}</Label>
                    <Select 
                        value={aiModels.image_generation} 
                        onValueChange={(value) => updateModel("image_generation", value)}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("Select a model")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image Preview</SelectItem>
                            <SelectItem value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</SelectItem>
                            <SelectItem value="imagen-3">Imagen 3 (Vertex AI)</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("Used for generating post images and editing images.")}</p>
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("Text Generation & Prompts")}</Label>
                    <Select 
                        value={aiModels.text_generation} 
                        onValueChange={(value) => updateModel("text_generation", value)}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("Select a model")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                            <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                            <SelectItem value="gemini-3.1-flash">Gemini 3.1 Flash</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("Used for expanding user prompts, writing captions, and generating ideas.")}</p>
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("Audio Transcription")}</Label>
                    <Select 
                        value={aiModels.audio_transcription} 
                        onValueChange={(value) => updateModel("audio_transcription", value)}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("Select a model")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (Audio Native)</SelectItem>
                            <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro (Audio Native)</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("Used for transcribing voice notes into text inputs.")}</p>
                </div>
            </CardContent>
        </Card>
    );
}
