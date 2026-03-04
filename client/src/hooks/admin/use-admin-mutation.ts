/**
 * useAdminMutation - Generic hook for admin mutations
 * Handles auth token injection, toast notifications, and query invalidation
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface UseAdminMutationOptions<TData, TPayload> {
    /** The API endpoint path */
    path: string;
    /** HTTP method (default: PATCH) */
    method?: "POST" | "PATCH" | "DELETE";
    /** Success toast title */
    successTitle?: string;
    /** Error toast title */
    errorTitle?: string;
    /** Query keys to invalidate on success */
    invalidateKeys?: string[][];
    /** Custom success handler */
    onSuccess?: (data: TData) => void;
    /** Custom error handler */
    onError?: (error: Error) => void;
}

export function useAdminMutation<TData = unknown, TPayload = unknown>(
    options: UseAdminMutationOptions<TData, TPayload>
) {
    const {
        path,
        method = "PATCH",
        successTitle = "Saved successfully",
        errorTitle = "Failed to save",
        invalidateKeys = [],
        onSuccess,
        onError,
    } = options;

    const { toast } = useToast();
    const queryClient = useQueryClient();

    return useMutation<TData, Error, TPayload>({
        mutationFn: async (payload: TPayload) => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch(path, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: payload ? JSON.stringify(payload) : undefined,
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: (data) => {
            // Invalidate specified query keys
            invalidateKeys.forEach((key) => {
                queryClient.invalidateQueries({ queryKey: key });
            });

            // Show success toast
            toast({ title: successTitle });

            // Call custom handler
            onSuccess?.(data);
        },
        onError: (error) => {
            // Show error toast
            toast({
                title: errorTitle,
                description: error.message,
                variant: "destructive",
            });

            // Call custom handler
            onError?.(error);
        },
    });
}
