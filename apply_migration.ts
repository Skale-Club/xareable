import pkg from 'pg';
const { Client } = pkg;
import "dotenv/config";

async function runSQL() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log("Connected to database.");

        const sql = `ALTER TABLE public.landing_content ADD COLUMN IF NOT EXISTS cta_image_url text;`;
        await client.query(sql);
        console.log("Success: Added cta_image_url column to landing_content table.");
    } catch (err) {
        console.error("Error executing SQL:", err.message);
    } finally {
        await client.end();
    }
}

runSQL();
