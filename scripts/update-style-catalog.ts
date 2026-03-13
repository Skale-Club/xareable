import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { DEFAULT_STYLE_CATALOG } from "../shared/schema.js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const { data, error } = await supabase
    .from("platform_settings")
    .upsert(
      {
        setting_key: "style_catalog",
        setting_value: DEFAULT_STYLE_CATALOG,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "setting_key" }
    );

  if (error) {
    console.error("Error updating style catalog:", error);
  } else {
    console.log("Successfully updated style catalog with defaults from schema!");
  }
}

main();
