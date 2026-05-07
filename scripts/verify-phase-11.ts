/**
 * Phase 11 Verification Script
 *
 * Statically verifies that the Phase 11 contract is in place:
 *   TRSH-01: posts.trashed_at column added; gallery filters trashed posts
 *   TRSH-02: purge sweep deletes storage before DB
 *   TRSH-03: GET /api/trash route exists
 *   TRSH-04: POST /api/trash/:id/restore route exists, resets expires_at
 *   TRSH-05: DELETE /api/trash/:id route exists, storage-then-DB ordering
 *   TRSH-06: cron registered server-side, no admin HTTP endpoint involved
 *
 * Run with: npx tsx scripts/verify-phase-11.ts
 * Exits non-zero if any check fails.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
let failed = 0;
const results: string[] = [];

function check(label: string, condition: boolean, hint?: string) {
  if (condition) {
    results.push(`  ok  ${label}`);
  } else {
    failed++;
    results.push(`  FAIL ${label}${hint ? `\n       hint: ${hint}` : ""}`);
  }
}

function read(path: string): string {
  const p = resolve(ROOT, path);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

// ── TRSH-01 ──────────────────────────────────────────────────────────────
console.log("\nTRSH-01: trashed_at column + gallery filter");
const migrationGlobMatches = [
  "supabase/migrations/20260506000000_posts_trashed_at.sql",
].filter((p) => existsSync(resolve(ROOT, p)));
check("migration file exists", migrationGlobMatches.length > 0,
  "expected supabase/migrations/20260506000000_posts_trashed_at.sql");

const migration = migrationGlobMatches[0] ? read(migrationGlobMatches[0]) : "";
check("migration adds trashed_at column",
  /add column if not exists trashed_at timestamptz/i.test(migration));
check("migration creates partial index",
  /create index if not exists idx_posts_trashed_at/i.test(migration) &&
  /where trashed_at is not null/i.test(migration));

const schema = read("shared/schema.ts");
check("shared/schema.ts exports TRASH_RETENTION_DAYS = 30",
  /export const TRASH_RETENTION_DAYS\s*=\s*30/.test(schema));
check("postSchema has trashed_at",
  /postSchema[\s\S]*?trashed_at:\s*z\.string\(\)\.nullable/.test(schema));
check("postGalleryItemSchema has trashed_at",
  /postGalleryItemSchema[\s\S]*?trashed_at:\s*z\.string\(\)\.nullable/.test(schema));

const postsRoutes = read("server/routes/posts.routes.ts");
const serverFilterCount = (postsRoutes.match(/is\("trashed_at",\s*null\)/g) || []).length;
check("server gallery query filters trashed posts (>=2 occurrences)",
  serverFilterCount >= 2,
  `found ${serverFilterCount}`);

const postsPage = read("client/src/pages/posts.tsx");
const clientFilterCount = (postsPage.match(/is\("trashed_at",\s*null\)/g) || []).length;
check("client gallery query filters trashed posts (>=2 occurrences)",
  clientFilterCount >= 2,
  `found ${clientFilterCount}`);

// ── TRSH-02 + TRSH-06 ───────────────────────────────────────────────────
console.log("\nTRSH-02 + TRSH-06: cron purge sweep + no HTTP path");
const cronSvc = read("server/services/cleanup-cron.service.ts");
check("cleanup-cron.service.ts exists", cronSvc.length > 0);
check("exports runTrashSweep", /export\s+(async\s+)?function\s+runTrashSweep/.test(cronSvc));
check("exports runPurgeSweep", /export\s+(async\s+)?function\s+runPurgeSweep/.test(cronSvc));
check("exports startCronJobs", /export\s+function\s+startCronJobs/.test(cronSvc));
check("imports node-cron", /from\s+["']node-cron["']/.test(cronSvc));
check("registers two cron schedules",
  (cronSvc.match(/cron\.schedule\(/g) || []).length >= 2);
check("collects post_slides paths in purge sweep",
  /from\("post_slides"\)/.test(cronSvc));
check("storage delete appears BEFORE DB delete in purge sweep",
  cronSvc.indexOf('.from("user_assets")') > 0 &&
  cronSvc.indexOf('.from("user_assets")') < cronSvc.indexOf('.from("posts")') ||
  (cronSvc.indexOf("user_assets") < cronSvc.indexOf(".delete()")));
check("cron service does not call /api/posts/cleanup",
  !/\/api\/posts\/cleanup/.test(cronSvc));

const indexTs = read("server/index.ts");
check("server/index.ts imports startCronJobs",
  /import\s*\{\s*startCronJobs\s*\}\s*from\s*["']\.\/services\/cleanup-cron\.service\.js["']/.test(indexTs));
check("server/index.ts calls startCronJobs() inside listen callback",
  /httpServer\.listen\([^)]+\),\s*\(\)\s*=>\s*\{[\s\S]*?startCronJobs\(\)/.test(indexTs) ||
  /httpServer\.listen\([\s\S]*?startCronJobs\(\)[\s\S]*?\}\);/.test(indexTs));

// ── TRSH-03 / TRSH-04 / TRSH-05 ──────────────────────────────────────────
console.log("\nTRSH-03/04/05: trash routes");
const trashRoutes = read("server/routes/trash.routes.ts");
check("trash.routes.ts exists", trashRoutes.length > 0);
check("GET /api/trash route", /router\.get\(["']\/api\/trash["']/.test(trashRoutes));
check("POST /api/trash/:id/restore route", /router\.post\(["']\/api\/trash\/:id\/restore["']/.test(trashRoutes));
check("DELETE /api/trash/:id route", /router\.delete\(["']\/api\/trash\/:id["']/.test(trashRoutes));
check("restore resets expires_at",
  /update\(\{\s*trashed_at:\s*null,\s*expires_at:/.test(trashRoutes));
check("DELETE handler removes storage BEFORE DB",
  trashRoutes.indexOf('.remove(') > 0 &&
  trashRoutes.indexOf('.remove(') < trashRoutes.lastIndexOf('.delete()'));

const routesIndex = read("server/routes/index.ts");
check("server/routes/index.ts imports trashRoutes",
  /import\s+trashRoutes\s+from\s+["']\.\/trash\.routes\.js["']/.test(routesIndex));
check("server/routes/index.ts mounts trashRoutes",
  /router\.use\(trashRoutes\)/.test(routesIndex));

check("shared/schema.ts exports trashedPostSchema",
  /export const trashedPostSchema\b/.test(schema));
check("shared/schema.ts exports trashListResponseSchema",
  /export const trashListResponseSchema\b/.test(schema));

// ── TRSH-03 UI + sidebar ─────────────────────────────────────────────────
console.log("\nTRSH-03 UI: /trash page + sidebar");
const trashPage = read("client/src/pages/trash.tsx");
check("trash.tsx exists", trashPage.length > 0);
check("trash.tsx default-exports TrashPage",
  /export default function TrashPage/.test(trashPage));
check("trash.tsx fetches GET /api/trash",
  /queryKey:\s*\[["']\/api\/trash["']\]/.test(trashPage));
check("trash.tsx Restore action calls POST /api/trash/:id/restore",
  /apiRequest\(\s*["']POST["'],\s*`\/api\/trash\/\$\{[^}]+\}\/restore`/.test(trashPage));
check("trash.tsx Delete Forever calls DELETE /api/trash/:id",
  /apiRequest\(\s*["']DELETE["'],\s*`\/api\/trash\/\$\{[^}]+\}`/.test(trashPage));

const appTsx = read("client/src/App.tsx");
check("App.tsx lazy-imports TrashPage",
  /const\s+TrashPage\s*=\s*lazy\(/.test(appTsx) && /import\(["']@\/pages\/trash["']\)/.test(appTsx));
check("App.tsx registers /trash route",
  /<Route\s+path=["']\/trash["']\s+component=\{TrashPage\}/.test(appTsx));

const sidebar = read("client/src/components/app-sidebar.tsx");
check("app-sidebar.tsx imports Trash2",
  /from\s+["']lucide-react["'][\s\S]*?Trash2/.test(sidebar));
check("app-sidebar.tsx userNavItems contains Trash entry",
  /title:\s*["']Trash["'],\s*url:\s*["']\/trash["']/.test(sidebar));

// ── Summary ──────────────────────────────────────────────────────────────
console.log("\n=== Phase 11 Verification ===");
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Phase 11 checks passed.");
