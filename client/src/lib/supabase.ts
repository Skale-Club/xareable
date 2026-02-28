import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let initPromise: Promise<SupabaseClient> | null = null;

export function initializeSupabase(): Promise<SupabaseClient> {
  if (client) return Promise.resolve(client);
  if (initPromise) return initPromise;

  initPromise = fetch("/api/config")
    .then((res) => {
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    })
    .then((config) => {
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error("Missing Supabase configuration");
      }
      client = createClient(config.supabaseUrl, config.supabaseAnonKey);
      return client;
    })
    .catch((err) => {
      initPromise = null;
      throw err;
    });

  return initPromise;
}

export function supabase(): SupabaseClient {
  if (!client) throw new Error("Supabase not initialized");
  return client;
}
