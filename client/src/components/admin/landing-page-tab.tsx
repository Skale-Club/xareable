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
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { AdminFloatingSaveButton, ImageUploadField } from ".";
import type { LandingContent } from "@shared/schema";

export function LandingPageTab() {
    const { toast } = useToast();
    const [content, setContent] = useState<Partial<LandingContent>>({});
    const [uploadingLogo, setUploadingLogo] = useState(false);
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
        responseKey: "logo_url" | "icon_url" | "hero_image_url" | "cta_image_url";
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
            toast({ title: `${labelFromResponseKey(responseKey)} uploaded successfully` });
        } catch (error: any) {
            toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        } finally {
            setUploading(false);
        }
    };

    const labelFromResponseKey = (responseKey: "logo_url" | "icon_url" | "hero_image_url" | "cta_image_url") => {
        switch (responseKey) {
            case "logo_url":
                return "Logo";
            case "icon_url":
                return "Icon";
            case "hero_image_url":
                return "Hero image";
            case "cta_image_url":
                return "CTA image";
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
            toast({ title: "Landing page content updated successfully" });
        },
        onError: (e: any) => {
            toast({ title: "Failed to update", description: e.message, variant: "destructive" });
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
            toast({ title: "Invalid file type", description: "Only SVG, PNG, and JPEG are supported", variant: "destructive" });
            return;
        }

        await uploadLandingImage({
            file,
            endpoint: "/api/admin/landing/upload-logo",
            responseKey: "logo_url",
            setUploading: setUploadingLogo,
        });
    };

    const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ["image/svg+xml", "image/png", "image/x-icon", "image/vnd.microsoft.icon"];
        if (!validTypes.includes(file.type)) {
            toast({ title: "Invalid file type", description: "Only SVG, PNG, and ICO are supported", variant: "destructive" });
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
            toast({ title: "Invalid file type", description: "Only PNG, JPEG, and WEBP are supported", variant: "destructive" });
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
            toast({ title: "Invalid file type", description: "Only PNG, JPEG, and WEBP are supported", variant: "destructive" });
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
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Hero Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Hero Section</CardTitle>
                    <CardDescription>Main headline and call-to-action buttons at the top of the page</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="hero_headline">Headline</Label>
                            <Input
                                id="hero_headline"
                                value={content.hero_headline || ""}
                                onChange={(e) => handleChange("hero_headline", e.target.value)}
                                placeholder="Create and Post Stunning Social Posts in Seconds"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hero_subtext">Subtext</Label>
                            <Textarea
                                id="hero_subtext"
                                value={content.hero_subtext || ""}
                                onChange={(e) => handleChange("hero_subtext", e.target.value)}
                                placeholder="Generate brand-consistent social media images and captions with AI..."
                                rows={3}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="hero_cta_text">Primary CTA Button</Label>
                                <Input
                                    id="hero_cta_text"
                                    value={content.hero_cta_text || ""}
                                    onChange={(e) => handleChange("hero_cta_text", e.target.value)}
                                    placeholder="Start Creating for Free"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="hero_secondary_cta_text">Secondary CTA Button</Label>
                                <Input
                                    id="hero_secondary_cta_text"
                                    value={content.hero_secondary_cta_text || ""}
                                    onChange={(e) => handleChange("hero_secondary_cta_text", e.target.value)}
                                    placeholder="See How It Works"
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
                    <CardTitle>Branding</CardTitle>
                    <CardDescription>Logo and icon for the landing page header/footer and browser tab</CardDescription>
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
                    <CardTitle>Features Section</CardTitle>
                    <CardDescription>Section showcasing the platform's features</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="features_title">Section Title</Label>
                        <Input
                            id="features_title"
                            value={content.features_title || ""}
                            onChange={(e) => handleChange("features_title", e.target.value)}
                            placeholder="Everything You Need to Automate Content"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="features_subtitle">Section Subtitle</Label>
                        <Textarea
                            id="features_subtitle"
                            value={content.features_subtitle || ""}
                            onChange={(e) => handleChange("features_subtitle", e.target.value)}
                            placeholder="From brand setup to publish-ready graphics..."
                            rows={2}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* How It Works Section */}
            <Card>
                <CardHeader>
                    <CardTitle>How It Works Section</CardTitle>
                    <CardDescription>Section explaining the three-step process</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="how_it_works_title">Section Title</Label>
                        <Input
                            id="how_it_works_title"
                            value={content.how_it_works_title || ""}
                            onChange={(e) => handleChange("how_it_works_title", e.target.value)}
                            placeholder="How It Works"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="how_it_works_subtitle">Section Subtitle</Label>
                        <Textarea
                            id="how_it_works_subtitle"
                            value={content.how_it_works_subtitle || ""}
                            onChange={(e) => handleChange("how_it_works_subtitle", e.target.value)}
                            placeholder="Three simple steps from idea to publish-ready social media content."
                            rows={2}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Testimonials Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Testimonials Section</CardTitle>
                    <CardDescription>Section displaying user testimonials</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="testimonials_title">Section Title</Label>
                        <Input
                            id="testimonials_title"
                            value={content.testimonials_title || ""}
                            onChange={(e) => handleChange("testimonials_title", e.target.value)}
                            placeholder="Loved by Marketers"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="testimonials_subtitle">Section Subtitle</Label>
                        <Textarea
                            id="testimonials_subtitle"
                            value={content.testimonials_subtitle || ""}
                            onChange={(e) => handleChange("testimonials_subtitle", e.target.value)}
                            placeholder="See what our users are saying about their experience."
                            rows={2}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* CTA Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Bottom CTA Section</CardTitle>
                    <CardDescription>Final call-to-action section at the bottom of the page</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="cta_title">Section Title</Label>
                            <Input
                                id="cta_title"
                                value={content.cta_title || ""}
                                onChange={(e) => handleChange("cta_title", e.target.value)}
                                placeholder="Ready to Automate Your Content?"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="cta_subtitle">Section Subtitle</Label>
                            <Textarea
                                id="cta_subtitle"
                                value={content.cta_subtitle || ""}
                                onChange={(e) => handleChange("cta_subtitle", e.target.value)}
                                placeholder="Join thousands of marketers who create branded social media content..."
                                rows={2}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="cta_button_text">Button Text</Label>
                            <Input
                                id="cta_button_text"
                                value={content.cta_button_text || ""}
                                onChange={(e) => handleChange("cta_button_text", e.target.value)}
                                placeholder="Get Started Free"
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
