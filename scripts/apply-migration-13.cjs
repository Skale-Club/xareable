const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const sqlPath = path.join(process.cwd(), 'supabase/migrations/20260518000000_post_slide_versions.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log(`Applying: ${path.basename(sqlPath)} (${sql.length} bytes)`);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
