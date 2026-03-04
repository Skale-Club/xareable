import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const catalog = {
  styles: [
    { id: "professional", label: "Professional", description: "Clean, corporate, trustworthy" },
    { id: "playful", label: "Playful", description: "Fun, colorful, energetic" },
    { id: "minimalist", label: "Minimalist", description: "Simple, elegant, refined" },
    { id: "bold", label: "Bold", description: "Strong, impactful, daring" },
    { id: "elegant", label: "Elegant", description: "Sophisticated, luxurious, graceful" },
    { id: "tech", label: "Tech / Cyber", description: "Futuristic, sharp, innovative" },
    { id: "vintage", label: "Vintage", description: "Nostalgic, retro, classic" },
    { id: "natural", label: "Natural", description: "Organic, earthy, calm" },
    { id: "sport", label: "Sport & Movement", description: "Dynamic, active, high-energy" }
  ],
  post_moods: [
    { id: "promo", label: "Promo", description: "Sales & offers", style_ids: ["professional", "playful", "bold", "sport"] },
    { id: "info", label: "Info", description: "Educational", style_ids: ["professional", "minimalist", "elegant", "natural"] },
    { id: "behind-the-scenes", label: "Behind the Scenes", description: "Company culture", style_ids: ["playful", "elegant", "vintage", "sport"] },
    { id: "testimonial", label: "Testimonial", description: "Customer reviews", style_ids: ["professional", "elegant", "vintage", "sport"] },
    { id: "quote", label: "Quote", description: "Inspirational quotes", style_ids: ["minimalist", "bold", "vintage", "sport"] },
    { id: "product-spotlight", label: "Product Spotlight", description: "Highlighting a feature", style_ids: ["minimalist", "bold", "tech", "sport"] },
    { id: "holiday", label: "Holiday", description: "Seasonal greetings", style_ids: ["playful", "elegant", "vintage", "natural"] },
    { id: "event", label: "Event", description: "Webinars & live events", style_ids: ["playful", "bold", "vintage", "sport"] },
    { id: "tips", label: "Tips & Tricks", description: "Helpful advice", style_ids: ["minimalist", "tech", "natural", "sport"] },
    { id: "poll", label: "Poll / Question", description: "Engagement questions", style_ids: ["playful", "tech", "sport"] },
    { id: "announcement", label: "Announcement", description: "Company news", style_ids: ["professional", "bold", "tech"] },
    { id: "hiring", label: "Hiring", description: "Job openings", style_ids: ["professional", "tech", "sport"] }
  ]
};

async function main() {
  const { data, error } = await supabase
    .from("platform_settings")
    .upsert(
      {
        setting_key: "style_catalog",
        setting_value: catalog,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "setting_key" }
    );

  if (error) {
    console.error("Error updating style catalog:", error);
  } else {
    console.log("Successfully updated style catalog!");
  }
}

main();
