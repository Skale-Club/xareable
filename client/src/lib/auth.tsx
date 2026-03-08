import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile, Brand, ClaimAffiliateReferralResponse } from "@shared/schema";
import {
  captureAffiliateRefFromCurrentUrl,
  clearStoredAffiliateRef,
  getStoredAffiliateRef,
} from "./affiliate-ref";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  brand: Brand | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  refreshBrand: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);

  const tryClaimAffiliateReferral = useCallback(
    async (accessToken: string, userId: string, currentProfile: Profile | null): Promise<Profile | null> => {
      const storedRef = getStoredAffiliateRef();
      if (storedRef && storedRef === userId) {
        clearStoredAffiliateRef();
        return currentProfile;
      }

      if (currentProfile?.referred_by_affiliate_id) {
        clearStoredAffiliateRef();
        return currentProfile;
      }

      try {
        const response = await fetch("/api/affiliate/claim", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(storedRef ? { ref: storedRef } : {}),
          credentials: "include",
        });

        if (!response.ok) {
          return currentProfile;
        }

        const payload = (await response.json()) as ClaimAffiliateReferralResponse;

        if (
          payload.reason === "claimed" ||
          payload.reason === "already_referred" ||
          payload.reason === "invalid_referrer" ||
          payload.reason === "self_referral"
        ) {
          clearStoredAffiliateRef();
        }

        if (payload.referred_by_affiliate_id) {
          return {
            ...(currentProfile || ({} as Profile)),
            id: currentProfile?.id || userId,
            api_key: currentProfile?.api_key ?? null,
            is_admin: currentProfile?.is_admin ?? false,
            is_affiliate: currentProfile?.is_affiliate ?? false,
            created_at: currentProfile?.created_at || new Date().toISOString(),
            referred_by_affiliate_id: payload.referred_by_affiliate_id,
          };
        }
      } catch (err) {
        console.error("Affiliate claim failed:", err);
      }

      return currentProfile;
    },
    [],
  );

  const notifyTelegramOnSignup = useCallback(async (accessToken: string) => {
    try {
      await fetch("/api/telegram/notify-signup", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch (err) {
      console.error("Telegram signup notification failed:", err);
    }
  }, []);

  const fetchUserData = useCallback(async (userId: string, session: Session | null = null) => {
    const sb = supabase();
    const normalizedEmail = session?.user?.email?.trim().toLowerCase() || null;
    try {
      const [profileRes, brandRes] = await Promise.all([
        sb.from("profiles").select("*").eq("id", userId).maybeSingle(),
        sb.from("brands").select("*").eq("user_id", userId).maybeSingle(),
      ]);

      let profileData = profileRes.data || null;

      if (profileRes.data) {
        const profileEmail =
          typeof (profileRes.data as any).email === "string"
            ? (profileRes.data as any).email.trim().toLowerCase()
            : null;

        if (profileEmail !== normalizedEmail) {
          const { error: profileEmailError } = await sb
            .from("profiles")
            .update({ email: normalizedEmail })
            .eq("id", userId);

          if (!profileEmailError) {
            profileData = { ...profileRes.data, email: normalizedEmail };
          }
        }

        if (session?.access_token) {
          profileData = await tryClaimAffiliateReferral(session.access_token, userId, profileRes.data);
        }
        setProfile(profileData);
      } else {
        const insertProfilePayload: Record<string, unknown> = { id: userId };
        if (normalizedEmail) {
          insertProfilePayload.email = normalizedEmail;
        }

        const { data: newProfile } = await sb
          .from("profiles")
          .insert(insertProfilePayload)
          .select()
          .single();
        profileData = newProfile;

        if (session?.access_token) {
          profileData = await tryClaimAffiliateReferral(session.access_token, userId, newProfile);
        }

        setProfile(profileData);
      }
      setBrand(brandRes.data);
    } catch (err) {
      console.error("Error fetching user data:", err);
    }

    if (session?.access_token) {
      void notifyTelegramOnSignup(session.access_token);
    }

    setLoading(false);
  }, [notifyTelegramOnSignup, tryClaimAffiliateReferral]);

  useEffect(() => {
    captureAffiliateRefFromCurrentUrl();
    const sb = supabase();

    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id, session);
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id, session);
      } else {
        setProfile(null);
        setBrand(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchUserData]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const sb = supabase();
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
    setProfile(data);
  }, [user]);

  const refreshBrand = useCallback(async () => {
    if (!user) return;
    const sb = supabase();
    const { data } = await sb.from("brands").select("*").eq("user_id", user.id).maybeSingle();
    setBrand(data);
  }, [user]);

  const signOut = useCallback(async () => {
    const sb = supabase();
    try {
      await sb.auth.signOut();
    } finally {
      setSession(null);
      setUser(null);
      setProfile(null);
      setBrand(null);
      if (typeof window !== "undefined") {
        window.location.assign("/");
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, user, profile, brand, loading, refreshProfile, refreshBrand, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
