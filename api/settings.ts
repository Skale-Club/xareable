import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SETTINGS = {
  id: "",
  app_name: "",
  app_tagline: null,
  app_description: null,
  logo_url: null,
  favicon_url: null,
  primary_color: "#8b5cf6",
  secondary_color: "#ec4899",
  meta_title: null,
  meta_description: null,
  og_image_url: null,
  terms_url: null,
  privacy_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  updated_by: null,
};

function createAdminSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(_req: any, res: any) {
  try {
    const supabase = createAdminSupabase();

    if (!supabase) {
      return res.status(200).json(DEFAULT_SETTINGS);
    }

    const { data, error } = await supabase.from("app_settings").select("*").single();

    if (error || !data) {
      return res.status(200).json(DEFAULT_SETTINGS);
    }

    return res.status(200).json(data);
  } catch {
    return res.status(200).json(DEFAULT_SETTINGS);
  }
}
