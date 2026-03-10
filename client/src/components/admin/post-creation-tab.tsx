/**
 * PostCreationTab - Admin style catalog management tab
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin";
import { queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageLoader } from "@/components/page-loader";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { AdminFloatingSaveButton } from ".";
import { BrandStylesCard, PostMoodsCard, AIModelsCard, PostFormatsCard } from "./post-creation";
import { DEFAULT_STYLE_CATALOG, type StyleCatalog } from "@shared/schema";

export function PostCreationTab() {
    const { toast } = useToast();
    const { t } = useTranslation();
    const [catalog, setCatalog] = useState<StyleCatalog | null>(null);

    const { data, isLoading, error } = useQuery<StyleCatalog>({
        queryKey: ["/api/admin/style-catalog"],
        queryFn: () => adminFetch("/api/admin/style-catalog"),
    });

    useEffect(() => {
        if (data) {
            setCatalog(data);
        }
    }, [data]);

    const updateMutation = useMutation({
        mutationFn: async (payload: StyleCatalog) => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/style-catalog", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json() as Promise<StyleCatalog>;
        },
        onSuccess: (next) => {
            setCatalog(next);
            queryClient.invalidateQueries({ queryKey: ["/api/admin/style-catalog"] });
            queryClient.invalidateQueries({ queryKey: ["/api/style-catalog"] });
            toast({ title: t("Post settings updated successfully") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to update post settings"), description: e.message, variant: "destructive" });
        },
    });

    if (isLoading) {
        return <PageLoader />;
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertTitle>{t("Post settings failed to load")}</AlertTitle>
                <AlertDescription>
                    {error.message || t("The server rejected the request.")}
                </AlertDescription>
            </Alert>
        );
    }

    const currentCatalog = catalog || DEFAULT_STYLE_CATALOG;

    return (
        <div className="space-y-6 pb-24">
            <div className="grid gap-6">
                <AIModelsCard catalog={currentCatalog} setCatalog={setCatalog} />

                {/* Side-by-side Layout on Desktop */}
                <div className="grid gap-6 lg:grid-cols-2 lg:items-start w-full">
                    <BrandStylesCard catalog={currentCatalog} setCatalog={setCatalog} />
                    <PostMoodsCard catalog={currentCatalog} setCatalog={setCatalog} />
                </div>
                <div className="grid gap-6 w-full">
                    <PostFormatsCard catalog={currentCatalog} setCatalog={setCatalog} formatKey="post_formats" title="Image Formats" description="Manage available aspect ratios for image posts." />
                    <PostFormatsCard catalog={currentCatalog} setCatalog={setCatalog} formatKey="video_formats" title="Video Formats" description="Manage available aspect ratios for video posts." />
                </div>
            </div>

            <AdminFloatingSaveButton
                onClick={() => updateMutation.mutate(currentCatalog)}
                disabled={updateMutation.isPending}
                label="Save Post Settings"
            />
        </div>
    );
}
