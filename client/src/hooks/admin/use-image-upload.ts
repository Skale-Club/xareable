/**
 * useImageUpload - Hook for handling image uploads in admin
 * Manages file validation, base64 conversion, and upload state
 */

import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface UseImageUploadOptions {
    /** The API endpoint for upload */
    endpoint: string;
    /** Accepted MIME types */
    acceptedTypes: string[];
    /** Response key for the URL (e.g., "logo_url", "icon_url") */
    responseKey: string;
    /** Success toast message */
    successMessage?: string;
    /** Called on successful upload with the URL */
    onSuccess?: (url: string) => void;
}

interface UseImageUploadReturn {
    /** Whether an upload is in progress */
    uploading: boolean;
    /** The current preview URL (if any) */
    previewUrl: string | null;
    /** Handle file input change */
    handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<string | null>;
    /** Set preview URL manually */
    setPreviewUrl: (url: string | null) => void;
}

export function useImageUpload(options: UseImageUploadOptions): UseImageUploadReturn {
    const { endpoint, acceptedTypes, responseKey, successMessage = "Image uploaded successfully", onSuccess } = options;

    const [uploading, setUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const { toast } = useToast();

    const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<string | null> => {
        const file = e.target.files?.[0];
        if (!file) return null;

        // Validate file type
        if (!acceptedTypes.includes(file.type)) {
            toast({
                title: "Invalid file type",
                description: `Only ${acceptedTypes.join(", ")} are supported`,
                variant: "destructive",
            });
            return null;
        }

        setUploading(true);

        try {
            // Convert to base64
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result as string;
                    resolve(result.split(",")[1]);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // Get auth token
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();

            // Upload to server
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

            // Update preview
            setPreviewUrl(url);

            // Show success toast
            toast({ title: successMessage });

            // Call success callback
            onSuccess?.(url);

            return url;
        } catch (error: any) {
            toast({
                title: "Upload failed",
                description: error.message,
                variant: "destructive",
            });
            return null;
        } finally {
            setUploading(false);
        }
    }, [endpoint, acceptedTypes, responseKey, successMessage, toast, onSuccess]);

    return {
        uploading,
        previewUrl,
        handleUpload,
        setPreviewUrl,
    };
}
