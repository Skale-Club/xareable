import pkg from 'pg';
const { Client } = pkg;
import "dotenv/config";
import fs from "fs/promises";
import path from "path";

async function runSQL() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log("Connected to database.");

        const sql = await fs.readFile(path.join(process.cwd(), "supabase", "migrations", "20260309020000_billing_optimizations_and_acid.sql"), "utf-8");
        await client.query(sql);
        console.log("Success: Applied billing_optimizations_and_acid.sql");
    } catch (err: any) {
        console.error("Error executing SQL:", err.message);
    } finally {
        await client.end();
    }
}

runSQL();
