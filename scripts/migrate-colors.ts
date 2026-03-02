import { Pool } from "pg";
import * as dotenv from "dotenv";

// Load environment variables from current directory
dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error("Missing DATABASE_URL");
    process.exit(1);
}

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
});

async function runMigration() {
    console.log("Running migration: Add color_4 to brands...\n");

    try {
        // Make color_3 nullable
        console.log("Step 1: Making color_3 nullable...");
        await pool.query("ALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;");
        console.log("✓ color_3 is now nullable\n");
    } catch (error: any) {
        if (error.message.includes("cannot drop NOT NULL") || error.message.includes("does not exist")) {
            console.log("⚠ color_3 might already be nullable or column doesn't exist, continuing...\n");
        } else {
            console.error("Error making color_3 nullable:", error.message);
        }
    }

    try {
        // Add color_4 column
        console.log("Step 2: Adding color_4 column...");
        await pool.query("ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;");
        console.log("✓ color_4 column added\n");
    } catch (error: any) {
        if (error.message.includes("already exists")) {
            console.log("⚠ color_4 column already exists\n");
        } else {
            console.error("Error adding color_4:", error.message);
        }
    }

    console.log("Migration completed successfully!");
    await pool.end();
}

runMigration().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
