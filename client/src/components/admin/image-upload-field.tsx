/**
 * ImageUploadField - Reusable image upload component with preview
 */

import { Label } from "@/components/ui/label";
import { useTranslation } from "@/hooks/useTranslation";
import { Loader2, Upload } from "lucide-react";

interface ImageUploadFieldProps {
    /** Current image URL (if any) */
    value?: string;
    /** Upload handler - receives file input change event */
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    /** Whether an upload is in progress */
    uploading?: boolean;
    /** Accepted MIME types */
    acceptedTypes: string[];
    /** Field label */
    label: string;
    /** Help text shown below the field */
    description?: string;
    /** Preview container height (default: "h-40") */
    previewHeight?: string;
    /** Test ID for the component */
    testId?: string;
}

export function ImageUploadField({
    value,
    onChange,
    uploading = false,
    acceptedTypes,
    label,
    description,
    previewHeight = "h-40",
    testId,
}: ImageUploadFieldProps) {
    const { t } = useTranslation();

    return (
        <div className="space-y-2" data-testid={testId}>
            <Label>{t(label)}</Label>
            <label className="cursor-pointer">
                <input
                    type="file"
                    accept={acceptedTypes.join(",")}
                    onChange={onChange}
                    className="hidden"
                    disabled={uploading}
                />
                {value ? (
                    <div className={`relative w-full ${previewHeight} rounded-lg border bg-muted flex items-center justify-center overflow-hidden group hover:border-primary/50 transition-colors`}>
                        <img
                            src={value}
                            alt={`${t(label)} ${t("Preview")}`}
                            className="max-w-full max-h-full object-contain"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="text-center text-white">
                                {uploading ? (
                                    <>
                                        <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                                        <p className="text-sm font-medium">{t("Uploading...")}</p>
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-6 h-6 mx-auto mb-2" />
                                        <p className="text-sm font-medium">{t("Replace")} {t(label)}</p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className={`w-full ${previewHeight} rounded-lg border-2 border-dashed bg-muted/20 flex items-center justify-center hover:border-primary/50 hover:bg-muted/40 transition-colors`}>
                        <div className="text-center">
                            {uploading ? (
                                <>
                                    <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground font-medium">{t("Uploading...")}</p>
                                </>
                            ) : (
                                <>
                                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground font-medium">{t("Upload")} {t(label)}</p>
                                    <p className="text-xs text-muted-foreground mt-1">{t("Click to browse")}</p>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </label>
            {description && (
                <p className="text-xs text-muted-foreground">{t(description)}</p>
            )}
        </div>
    );
}
