import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SETTINGS = {
  id: null,
  app_name: "Xareable",
  app_tagline: "AI-Powered Social Media Content Creation",
  app_description: null,
  logo_url: null,
  favicon_url: null,
  primary_color: "#8b5cf6",
  secondary_color: "#ec4899",
  meta_title: "Xareable - AI Social Media Content Creator",
  meta_description:
    "Create stunning social media images and captions with AI, tailored to your brand identity.",
  og_image_url: null,
  terms_url: null,
  privacy_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  updated_by: null,
};

function createAdminSupabase() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
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
