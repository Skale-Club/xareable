import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import { Cpu } from "lucide-react";
import { GradientIcon } from "@/components/ui/gradient-icon";
import { apiRequest } from "@/lib/queryClient";
import type { StyleCatalog, AIModels } from "@shared/schema";

interface AIModelsCardProps {
    catalog: StyleCatalog;
    setCatalog: React.Dispatch<React.SetStateAction<StyleCatalog | null>>;
}

type ProviderName = "gemini" | "openai";
const OPENAI_SENTINEL = "openai:gpt-image-2";

export function AIModelsCard({ catalog, setCatalog }: AIModelsCardProps) {
    const { t } = useTranslation();
    const qc = useQueryClient();

    const aiModels = catalog.ai_models || {
        image_generation: "gemini-3.1-flash-image-preview",
        text_generation: "gemini-2.5-flash",
        audio_transcription: "gemini-2.5-flash",
        video_generation: "veo-3.1-generate-preview",
    };

    const { data: providerData } = useQuery<{ provider: ProviderName }>({
        queryKey: ["admin", "image-provider"],
        queryFn: () => apiRequest("GET", "/api/admin/image-provider").then((r) => r.json()),
    });
    const provider: ProviderName = providerData?.provider ?? "gemini";

    const providerMutation = useMutation({
        mutationFn: (p: ProviderName) =>
            apiRequest("PATCH", "/api/admin/image-provider", { provider: p }).then((r) => r.json()),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "image-provider"] }),
    });

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

    const imageSelectValue = useMemo(
        () => (provider === "openai" ? OPENAI_SENTINEL : aiModels.image_generation),
        [provider, aiModels.image_generation]
    );

    const handleImageSelect = (value: string) => {
        if (value === OPENAI_SENTINEL) {
            if (provider !== "openai") providerMutation.mutate("openai");
            return;
        }
        if (provider !== "gemini") providerMutation.mutate("gemini");
        updateModel("image_generation", value);
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
            <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("Image Generation")}</Label>
                    <Select
                        value={imageSelectValue}
                        onValueChange={handleImageSelect}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("Select a model")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectLabel>Gemini</SelectLabel>
                                <SelectItem value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image</SelectItem>
                                <SelectItem value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</SelectItem>
                                <SelectItem value="imagen-3">Imagen 3 (Vertex AI)</SelectItem>
                            </SelectGroup>
                            <SelectSeparator />
                            <SelectGroup>
                                <SelectLabel>OpenAI</SelectLabel>
                                <SelectItem value={OPENAI_SENTINEL}>gpt-image-2 (Responses API)</SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {provider === "openai"
                            ? t("Active provider: OpenAI. Affects all image flows (single, edit, carousel, enhancement).")
                            : t("Used for generating post images and editing images.")}
                    </p>
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
                            <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                            <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("Used for transcribing voice notes into text inputs.")}</p>
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("Video Generation")}</Label>
                    <Select
                        value={aiModels.video_generation}
                        onValueChange={(value) => updateModel("video_generation", value)}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("Select a model")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="veo-3.1-generate-preview">Veo 3.1 Generate Preview</SelectItem>
                            <SelectItem value="veo-3.1-fast-generate-preview">Veo 3.1 Fast Generate Preview</SelectItem>
                            <SelectItem value="veo-2">Veo 2</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("Used for generating videos with AI. Supports text-to-video and image-to-video.")}</p>
                </div>
            </CardContent>
        </Card>
    );
}
