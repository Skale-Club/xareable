import { Request, Response, NextFunction } from "express";
import { createServerSupabase, createAdminSupabase } from "../supabase.js";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../../shared/schema.js";

/**
 * Extended Request interface with authentication data
 */
export interface AuthenticatedRequest extends Request {
    user: User;
    supabase: SupabaseClient;
    profile: Profile;
}

export interface AuthResult {
    success: true;
    user: User;
    supabase: SupabaseClient;
    profile: Profile;
}

export interface AuthError {
    success: false;
    statusCode: number;
    message: string;
}

/**
 * Extracts and validates the Bearer token from request headers
 */
export function extractToken(req: AuthenticatedRequest): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    return authHeader.replace("Bearer ", "");
}

/**
 * Authenticates a user via Bearer token and fetches their profile
 * Returns either a successful auth result or an error response object
 */
export async function authenticateUser(
    req: AuthenticatedRequest
): Promise<AuthResult | AuthError> {
    const token = extractToken(req);

    if (!token) {
        return {
            success: false,
            statusCode: 401,
            message: "Authentication required",
        };
    }

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        return {
            success: false,
            statusCode: 401,
            message: "Invalid authentication",
        };
    }

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
        return {
            success: false,
            statusCode: 500,
            message: "Failed to fetch user profile",
        };
    }

    return {
        success: true,
        user,
        supabase,
        profile,
    };
}

/**
 * Express middleware that requires authentication
 * Attaches user, supabase client, and profile to the request object
 */
export async function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const result = await authenticateUser(req);

    if (!result.success) {
        res.status(result.statusCode).json({ message: result.message });
        return;
    }

    // Attach auth data to request for use in route handlers
    (req as any).user = result.user;
    (req as any).supabase = result.supabase;
    (req as any).profile = result.profile;

    next();
}

/**
 * Express middleware that requires admin privileges
 * Must be used after requireAuth middleware
 */
export async function requireAdmin(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const token = extractToken(req);

    if (!token) {
        res.status(401).json({ message: "Authentication required" });
        return;
    }

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        res.status(401).json({ message: "Invalid authentication" });
        return;
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

    if (!profile?.is_admin) {
        res.status(403).json({ message: "Admin access required" });
        return;
    }

    // Attach for use in route handlers
    (req as any).user = user;
    (req as any).supabase = supabase;

    next();
}

/**
 * Admin guard for inline use in route handlers
 * Returns { userId: string } on success, or sends error response and returns null
 */
export async function requireAdminGuard(
    req: Request,
    res: Response
): Promise<{ userId: string } | null> {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
        res.status(401).json({ message: "Authentication required" });
        return null;
    }

    const supabase = createServerSupabase(token);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        res.status(401).json({ message: "Invalid authentication" });
        return null;
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

    if (!profile?.is_admin) {
        res.status(403).json({ message: "Admin access required" });
        return null;
    }

    return { userId: user.id };
}

/**
 * Helper to check if user uses their own API key (admin or affiliate)
 * Accepts partial profile with just is_admin and is_affiliate fields
 */
export function usesOwnApiKey(profile: { is_admin?: boolean; is_affiliate?: boolean } | null): boolean {
    return profile?.is_admin === true || profile?.is_affiliate === true;
}

/**
 * Helper to get the appropriate Gemini API key for a user
 * Accepts partial profile with api_key, is_admin, and is_affiliate fields
 */
export async function getGeminiApiKey(
    profile: { api_key?: string | null; is_admin?: boolean; is_affiliate?: boolean } | null
): Promise<{ key: string; error?: string }> {
    const ownKey = usesOwnApiKey(profile);

    if (ownKey) {
        if (!profile?.api_key) {
            return {
                key: "",
                error: "Admin and affiliate accounts must configure their own Gemini API key in Settings before generating.",
            };
        }
        return { key: profile.api_key };
    }

    const serverKey = process.env.GEMINI_API_KEY;
    if (!serverKey) {
        return {
            key: "",
            error: "Gemini API key not configured on the server.",
        };
    }

    return { key: serverKey };
}
