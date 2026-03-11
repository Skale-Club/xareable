/**
 * Admin utility functions
 * Extracted from admin.tsx for better maintainability
 */

import { supabase } from "@/lib/supabase";
import type { AdminUser, StatusFilter } from "./types";

/**
 * Authenticated fetch helper for admin API calls
 * Automatically injects the user's access token
 */
export async function adminFetch<T>(path: string): Promise<T> {
    const sb = supabase();
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(path, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const raw = await res.text();
    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!res.ok) {
        if (isJson) {
            try {
                const parsed = JSON.parse(raw);
                throw new Error(parsed?.message || raw);
            } catch {
                throw new Error(raw || "Request failed");
            }
        }

        throw new Error(raw || "Request failed");
    }

    if (!isJson) {
        throw new Error(`Unexpected non-JSON response from ${path}. Restart the API server and try again.`);
    }

    try {
        return JSON.parse(raw) as T;
    } catch {
        throw new Error(`Invalid JSON response from ${path}.`);
    }
}

/**
 * Convert a string to a URL-safe slug for catalog IDs
 */
export function slugifyCatalogId(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Format micros (millionths of a dollar) to a display string
 */
export function formatCost(micros: number): string {
    return `$${(micros / 1_000_000).toFixed(4)}`;
}

/**
 * Format micros to a balance display string (2 decimal places)
 */
export function formatBalance(micros: number): string {
    return `$${(micros / 1_000_000).toFixed(2)}`;
}

/**
 * Check if a user matches a given status filter
 */
export function matchStatus(u: AdminUser, filter: StatusFilter): boolean {
    if (filter === "all") return true;
    if (filter === "affiliate") return u.is_affiliate === true;
    if (filter === "active") return u.is_paid === true;
    if (filter === "trialing") return u.free_generations_remaining > 0;
    if (filter === "exhausted") {
        if (u.is_admin) return false;
        return u.free_generations_remaining <= 0 && u.balance_micros <= 0;
    }
    return true;
}
