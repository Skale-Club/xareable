import { createAdminSupabase } from "./server/supabase.ts";
import "dotenv/config";

async function main() {
    const sb = createAdminSupabase();
    const { data, error } = await sb.from("landing_content").select("*").limit(1);

    if (error) {
        console.error("Error fetching landing_content:", error);
    } else {
        console.log("Columns found:", Object.keys(data[0] || {}));
    }
}

main();
