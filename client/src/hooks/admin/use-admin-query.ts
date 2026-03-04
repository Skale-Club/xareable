/**
 * useAdminQuery - Generic hook for admin data fetching
 * Automatically handles auth token injection
 */

import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin";

interface UseAdminQueryOptions<T> {
    /** The API endpoint path */
    path: string;
    /** Custom query key (defaults to [path]) */
    queryKey?: string[];
    /** Whether the query should be enabled */
    enabled?: boolean;
    /** Stale time in milliseconds (default: 0) */
    staleTime?: number;
}

export function useAdminQuery<T>(options: UseAdminQueryOptions<T>) {
    const { path, queryKey, enabled = true, staleTime = 0 } = options;

    return useQuery<T>({
        queryKey: queryKey || [path],
        queryFn: () => adminFetch<T>(path),
        enabled,
        staleTime,
    });
}
