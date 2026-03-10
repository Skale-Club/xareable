/**
 * LandingPageTab - Admin landing page content editor
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageLoader } from "@/components/page-loader";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { AdminFloatingSaveButton, ImageUploadField } from ".";
import type { LandingContent } from "@shared/schema";

export function LandingPageTab() {
    const { toast } = useToast();
    const { t } = useTranslation();
    const [content, setContent] = useState<Partial<LandingContent>>({});
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [uploadingAltLogo, setUploadingAltLogo] = useState(false);
    const [uploadingIcon, setUploadingIcon] = useState(false);
    const [uploadingHeroImage, setUploadingHeroImage] = useState(false);
    const [uploadingCtaImage, setUploadingCtaImage] = useState(false);

    const readFileAsBase64 = (file: File) =>
        new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(",")[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

    const uploadLandingImage = async ({
        file,
        endpoint,
        responseKey,
        setUploading,
    }: {
        file: File;
        endpoint: string;
        responseKey: "logo_url" | "alt_logo_url" | "icon_url" | "hero_image_url" | "cta_image_url";
        setUploading: React.Dispatch<React.SetStateAction<boolean>>;
    }) => {
        setUploading(true);

        try {
            const base64 = await readFileAsBase64(file);
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();

            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ file: base64, contentType: file.type }),
            });

            if (!res.ok) throw new Error(await res.text());

            const data = await res.json();
            const url = data[responseKey];

            setContent(prev => ({ ...prev, [responseKey]: url }));
            queryClient.invalidateQueries({ queryKey: ["/api/landing/content"] });
            toast({ title: `${labelFromResponseKey(responseKey)} ${t("uploaded successfully")}` });
        } catch (error: any) {
            toast({ title: t("Upload failed"), description: error.message, variant: "destructive" });
        } finally {
            setUploading(false);
        }
    };

    const labelFromResponseKey = (responseKey: "logo_url" | "alt_logo_url" | "icon_url" | "hero_image_url" | "cta_image_url") => {
        switch (responseKey) {
            case "logo_url":
                return t("Logo");
            case "alt_logo_url":
                return t("Alternative Logo");
            case "icon_url":
                return t("Icon");
            case "hero_image_url":
                return t("Hero image");
            case "cta_image_url":
                return t("CTA image");
        }
    };

    const { data: landingContent, isLoading } = useQuery<LandingContent>({
        queryKey: ["/api/landing/content"],
        queryFn: () => fetch("/api/landing/content").then(res => res.json()),
    });

    useEffect(() => {
        if (landingContent) {
            setContent(landingContent);
        }
    }, [landingContent]);

    const updateMutation = useMutation({
        mutationFn: async (data: Partial<LandingContent>) => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch("/api/admin/landing/content", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/landing/content"] });
            toast({ title: t("Landing page content updated successfully") });
        },
        onError: (e: any) => {
            toast({ title: t("Failed to update"), description: e.message, variant: "destructive" });
        },
    });

    const handleSave = () => {
        updateMutation.mutate(content);
    };

    const handleChange = (field: keyof LandingContent, value: string) => {
        setContent(prev => ({ ...prev, [field]: value }));
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/jpg"];
        if (!validTypes.includes(file.type)) {
            toast({ title: t("Invalid file type"), description: t("Only SVG, PNG, and JPEG are supported"), variant: "destructive" });
            return;
        }

        await uploadLandingImage({
            file,
            endpoint: "/api/admin/landing/upload-logo",
            responseKey: "logo_url",
            setUploading: setUploadingLogo,
        });
    };

    const handleAltLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/jpg"];
        if (!validTypes.includes(file.type)) {
            toast({ title: t("Invalid file type"), description: t("Only SVG, PNG, and JPEG are supported"), variant: "destructive" });
            return;
        }

        await uploadLandingImage({
            file,
            endpoint: "/api/admin/landing/upload-alt-logo",
            responseKey: "alt_logo_url",
            setUploading: setUploadingAltLogo,
        });
    };

    const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ["image/svg+xml", "image/png", "image/x-icon", "image/vnd.microsoft.icon"];
        if (!validTypes.includes(file.type)) {
            toast({ title: t("Invalid file type"), description: t("Only SVG, PNG, and ICO are supported"), variant: "destructive" });
            return;
        }

        await uploadLandingImage({
            file,
            endpoint: "/api/admin/landing/upload-icon",
            responseKey: "icon_url",
            setUploading: setUploadingIcon,
        });
    };

    const handleHeroImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
        if (!validTypes.includes(file.type)) {
            toast({ title: t("Invalid file type"), description: t("Only PNG, JPEG, and WEBP are supported"), variant: "destructive" });
            return;
        }

        await uploadLandingImage({
            file,
            endpoint: "/api/admin/landing/upload-hero-image",
            responseKey: "hero_image_url",
            setUploading: setUploadingHeroImage,
        });
    };

    const handleCtaImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
        if (!validTypes.includes(file.type)) {
            toast({ title: t("Invalid file type"), description: t("Only PNG, JPEG, and WEBP are supported"), variant: "destructive" });
            return;
        }

        await uploadLandingImage({
            file,
            endpoint: "/api/admin/landing/upload-cta-image",
            responseKey: "cta_image_url",
            setUploading: setUploadingCtaImage,
        });
    };

    if (isLoading) {
        return <PageLoader />;
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t("Landing Background")}</CardTitle>
                    <CardDescription>{t("Choose which landing background variation is active for all visitors")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                        <div className="space-y-1">
                            <p className="text-sm font-medium">{t("Alternative background")}</p>
                            <p className="text-xs text-muted-foreground">
                                {(content.background_variant ?? "solid") === "alternative"
                                    ? t("Alternative version active")
                                    : t("Solid version active")}
                            </p>
                        </div>
                        <Switch
                            checked={(content.background_variant ?? "solid") === "alternative"}
                            onCheckedChange={(checked) =>
                                setContent(prev => ({ ...prev, background_variant: checked ? "alternative" : "solid" }))
                            }
                            aria-label={t("Toggle landing background variation")}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Hero Section */}
            <Card>
                <CardHeader>
                    <CardTitle>{t("Hero Section")}</CardTitle>
                    <CardDescription>{t("Main headline and call-to-action buttons at the top of the page")}</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="hero_badge_text">{t("Badge Text")}</Label>
                            <Input
                                id="hero_badge_text"
                                value={content.hero_badge_text || ""}
                                onChange={(e) => handleChange("hero_badge_text", e.target.value)}
                                placeholder={t("AI-Powered Social Media Content")}
                            />
                            <p className="text-xs text-muted-foreground">{t("Small badge text that appears above the headline")}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hero_headline">{t("Headline")}</Label>
                            <Input
                                id="hero_headline"
                                value={content.hero_headline || ""}
                                onChange={(e) => handleChange("hero_headline", e.target.value)}
                                placeholder={t("Create and Post Stunning Social Posts in Seconds")}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hero_subtext">{t("Subtext")}</Label>
                            <Textarea
                                id="hero_subtext"
                                value={content.hero_subtext || ""}
                                onChange={(e) => handleChange("hero_subtext", e.target.value)}
                                placeholder={t("Generate brand-consistent social media images and captions with AI...")}
                                rows={3}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="hero_cta_text">{t("Primary CTA Button")}</Label>
                                <Input
                                    id="hero_cta_text"
                                    value={content.hero_cta_text || ""}
                                    onChange={(e) => handleChange("hero_cta_text", e.target.value)}
                                    placeholder={t("Start Creating for Free")}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="hero_secondary_cta_text">{t("Secondary CTA Button")}</Label>
                                <Input
                                    id="hero_secondary_cta_text"
                                    value={content.hero_secondary_cta_text || ""}
                                    onChange={(e) => handleChange("hero_secondary_cta_text", e.target.value)}
                                    placeholder={t("See How It Works")}
                                />
                            </div>
                        </div>
                    </div>
                    <div>
                        <ImageUploadField
                            value={content.hero_image_url ?? undefined}
                            onChange={handleHeroImageUpload}
                            uploading={uploadingHeroImage}
                            acceptedTypes={["image/png", "image/jpeg", "image/webp"]}
                            label="Hero Image"
                            description="Optional image that appears on the right side of the hero section on desktop screens (PNG, JPEG, WEBP)"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Branding Section */}
            <Card>
                <CardHeader>
                    <CardTitle>{t("Branding")}</CardTitle>
                    <CardDescription>{t("Logo and icon for the landing page header/footer and browser tab")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Logo Upload */}
                        <ImageUploadField
                            value={content.logo_url ?? undefined}
                            onChange={handleLogoUpload}
                            uploading={uploadingLogo}
                            acceptedTypes={["image/svg+xml", "image/png", "image/jpeg", "image/jpg"]}
                            label="Landing Page Logo"
                            description="Appears in header and footer (SVG, PNG, or JPEG)"
                        />

                        {/* Alternative Logo Upload */}
                        <ImageUploadField
                            value={content.alt_logo_url ?? undefined}
                            onChange={handleAltLogoUpload}
                            uploading={uploadingAltLogo}
                            acceptedTypes={["image/svg+xml", "image/png", "image/jpeg", "image/jpg"]}
                            label="Alternative Landing Logo"
                            description="Colored mask logo to be revealed on hover (SVG, PNG, or JPEG)"
                        />

                        {/* Icon Upload */}
                        <ImageUploadField
                            value={content.icon_url ?? undefined}
                            onChange={handleIconUpload}
                            uploading={uploadingIcon}
                            acceptedTypes={["image/svg+xml", "image/png", "image/x-icon", "image/vnd.microsoft.icon"]}
                            label="Favicon / Icon"
                            description="Browser tab icon (SVG, PNG, or ICO)"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Features Section */}
            <Card>
                <CardHeader>
                    <CardTitle>{t("Features Section")}</CardTitle>
                    <CardDescription>{t("Section showcasing the platform's features")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="features_title">{t("Section Title")}</Label>
                        <Input
                            id="features_title"
                            value={content.features_title || ""}
                            onChange={(e) => handleChange("features_title", e.target.value)}
                            placeholder={t("Everything You Need to Automate Content")}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="features_subtitle">{t("Section Subtitle")}</Label>
                        <Textarea
                            id="features_subtitle"
                            value={content.features_subtitle || ""}
                            onChange={(e) => handleChange("features_subtitle", e.target.value)}
                            placeholder={t("From brand setup to publish-ready graphics...")}
                            rows={2}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* How It Works Section */}
            <Card>
                <CardHeader>
                    <CardTitle>{t("How It Works Section")}</CardTitle>
                    <CardDescription>{t("Section explaining the three-step process")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="how_it_works_title">{t("Section Title")}</Label>
                        <Input
                            id="how_it_works_title"
                            value={content.how_it_works_title || ""}
                            onChange={(e) => handleChange("how_it_works_title", e.target.value)}
                            placeholder={t("How It Works")}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="how_it_works_subtitle">{t("Section Subtitle")}</Label>
                        <Textarea
                            id="how_it_works_subtitle"
                            value={content.how_it_works_subtitle || ""}
                            onChange={(e) => handleChange("how_it_works_subtitle", e.target.value)}
                            placeholder={t("Three simple steps from idea to publish-ready social media content.")}
                            rows={2}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Testimonials Section */}
            <Card>
                <CardHeader>
                    <CardTitle>{t("Testimonials Section")}</CardTitle>
                    <CardDescription>{t("Section displaying user testimonials")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="testimonials_title">{t("Section Title")}</Label>
                        <Input
                            id="testimonials_title"
                            value={content.testimonials_title || ""}
                            onChange={(e) => handleChange("testimonials_title", e.target.value)}
                            placeholder={t("Loved by Marketers")}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="testimonials_subtitle">{t("Section Subtitle")}</Label>
                        <Textarea
                            id="testimonials_subtitle"
                            value={content.testimonials_subtitle || ""}
                            onChange={(e) => handleChange("testimonials_subtitle", e.target.value)}
                            placeholder={t("See what our users are saying about their experience.")}
                            rows={2}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* CTA Section */}
            <Card>
                <CardHeader>
                    <CardTitle>{t("Bottom CTA Section")}</CardTitle>
                    <CardDescription>{t("Final call-to-action section at the bottom of the page")}</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="cta_title">{t("Section Title")}</Label>
                            <Input
                                id="cta_title"
                                value={content.cta_title || ""}
                                onChange={(e) => handleChange("cta_title", e.target.value)}
                                placeholder={t("Ready to Automate Your Content?")}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="cta_subtitle">{t("Section Subtitle")}</Label>
                            <Textarea
                                id="cta_subtitle"
                                value={content.cta_subtitle || ""}
                                onChange={(e) => handleChange("cta_subtitle", e.target.value)}
                                placeholder={t("Join thousands of marketers who create branded social media content...")}
                                rows={2}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="cta_button_text">{t("Button Text")}</Label>
                            <Input
                                id="cta_button_text"
                                value={content.cta_button_text || ""}
                                onChange={(e) => handleChange("cta_button_text", e.target.value)}
                                placeholder={t("Get Started Free")}
                            />
                        </div>
                    </div>
                    <div>
                        <ImageUploadField
                            value={content.cta_image_url ?? undefined}
                            onChange={handleCtaImageUpload}
                            uploading={uploadingCtaImage}
                            acceptedTypes={["image/png", "image/jpeg", "image/webp"]}
                            label="CTA Background Image"
                            description="Optional background image for the bottom CTA section (PNG, JPEG, WEBP)"
                        />
                    </div>
                </CardContent>
            </Card>

            <AdminFloatingSaveButton
                onClick={handleSave}
                disabled={updateMutation.isPending}
                label="Save Changes"
            />
        </div>
    );
}
