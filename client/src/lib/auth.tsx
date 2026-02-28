import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile, Brand } from "@shared/schema";

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

  const fetchUserData = useCallback(async (userId: string) => {
    const sb = supabase();
    try {
      const [profileRes, brandRes] = await Promise.all([
        sb.from("profiles").select("*").eq("id", userId).maybeSingle(),
        sb.from("brands").select("*").eq("user_id", userId).maybeSingle(),
      ]);

      if (profileRes.data) {
        setProfile(profileRes.data);
      } else {
        const { data: newProfile } = await sb
          .from("profiles")
          .insert({ id: userId })
          .select()
          .single();
        setProfile(newProfile);
      }
      setBrand(brandRes.data);
    } catch (err) {
      console.error("Error fetching user data:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const sb = supabase();

    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id);
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
        fetchUserData(session.user.id);
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
    await sb.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setBrand(null);
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
