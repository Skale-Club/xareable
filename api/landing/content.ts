import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_LANDING_CONTENT = {
  id: null,
  hero_headline: "Create and Post Stunning Social Posts in Seconds",
  hero_subtext:
    "Generate brand-consistent social media images and captions with AI. Just type your message, pick a style, and let the AI do the rest.",
  hero_cta_text: "Start Creating for Free",
  hero_secondary_cta_text: "See How It Works",
  features_title: "Everything You Need to Automate Content",
  features_subtitle:
    "From brand setup to publish-ready graphics, every feature is designed to save you time and keep your content on-brand.",
  how_it_works_title: "How It Works",
  how_it_works_subtitle:
    "Three simple steps from idea to publish-ready social media content.",
  testimonials_title: "Loved by Marketers",
  testimonials_subtitle: "See what our users are saying about their experience.",
  cta_title: "Ready to Automate Your Content?",
  cta_subtitle:
    "Join thousands of marketers who create branded social media content in seconds, not hours.",
  cta_button_text: "Get Started Free",
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
      return res.status(200).json(DEFAULT_LANDING_CONTENT);
    }

    const { data, error } = await supabase
      .from("landing_content")
      .select("*")
      .single();

    if (error || !data) {
      return res.status(200).json(DEFAULT_LANDING_CONTENT);
    }

    return res.status(200).json(data);
  } catch {
    return res.status(200).json(DEFAULT_LANDING_CONTENT);
  }
}
