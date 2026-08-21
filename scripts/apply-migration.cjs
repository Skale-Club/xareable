/**
 * Apply one migration file to the database in a transaction, and record it in
 * supabase_migrations.schema_migrations under the version taken FROM ITS
 * FILENAME.
 *
 * Why this exists: the previous ad-hoc paths both have a flaw.
 * scripts/apply-migration-13.cjs hard-codes a single filename and never records
 * the migration at all, so the DB silently drifts from the ledger. Applying
 * through the Supabase MCP records it, but stamps a version generated from the
 * CURRENT time rather than the filename, so `supabase/migrations/*.sql` and
 * `schema_migrations` end up with different version numbers for the same
 * migration and a later `db push` tries to re-apply it.
 *
 * This script keeps filename and ledger in lockstep, which is what makes
 * "is this migration applied?" answerable by comparing the two.
 *
 * Usage:
 *   node scripts/apply-migration.cjs supabase/migrations/2026..._name.sql
 *   node scripts/apply-migration.cjs --check supabase/migrations/2026..._name.sql
 *
 * --check reports whether the version is already recorded and exits without
 * writing anything.
 *
 * Requires DATABASE_URL in .env (the pooler/direct Postgres connection string).
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
require("dotenv").config();

function fail(message) {
    console.error(`\n[FAIL] ${message}\n`);
    process.exit(1);
}

/** "20260821000100_fix_deduction....sql" -> { version, name } */
function parseFilename(file) {
    const base = path.basename(file, ".sql");
    const match = /^(\d{14})_(.+)$/.exec(base);
    if (!match) {
        fail(
            `Filename "${base}" is not <14-digit-version>_<name>. ` +
                "Supabase orders and de-duplicates migrations by that version, so it must be exact.",
        );
    }
    return { version: match[1], name: match[2] };
}

(async () => {
    const args = process.argv.slice(2);
    const checkOnly = args.includes("--check");
    const file = args.find((a) => !a.startsWith("--"));

    if (!file) fail("Usage: node scripts/apply-migration.cjs [--check] <path/to/migration.sql>");
    if (!fs.existsSync(file)) fail(`No such file: ${file}`);
    if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set in .env");

    const { version, name } = parseFilename(file);
    const sql = fs.readFileSync(file, "utf8");

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        const { rows } = await client.query(
            "select version, name from supabase_migrations.schema_migrations where version = $1",
            [version],
        );

        if (rows.length > 0) {
            console.log(`[=] ${version}_${name} is ALREADY recorded as applied - nothing to do.`);
            return;
        }

        if (checkOnly) {
            console.log(`[X] ${version}_${name} is NOT applied (${sql.length} bytes pending).`);
            process.exitCode = 1;
            return;
        }

        console.log(`Applying ${version}_${name} (${sql.length} bytes)...`);

        // The migration body AND its ledger row go in ONE transaction: a
        // migration that half-applied and still got recorded is the worst
        // possible outcome, since every later run would skip it.
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
            "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
            [version, name],
        );
        await client.query("COMMIT");

        console.log(`[+] Applied and recorded ${version}_${name}.`);
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        fail(`${version}_${name}: ${err.message}`);
    } finally {
        await client.end();
    }
})();
