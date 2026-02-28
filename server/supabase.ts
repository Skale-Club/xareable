import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function createServerSupabase(userToken?: string): SupabaseClient {
  const options: any = {};
  if (userToken) {
    options.global = {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    };
  }
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    options,
  );
}
