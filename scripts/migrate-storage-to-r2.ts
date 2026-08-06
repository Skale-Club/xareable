/**
 * Supabase Storage → Cloudflare R2 backfill.
 *
 * Two independent, separately-runnable phases:
 *
 *   1. COPY    — walk the `user_assets` bucket and mirror every object into R2
 *                under the *same key*. Idempotent: an object already present in
 *                R2 with a matching size is skipped, so an interrupted run just
 *                resumes.
 *
 *   2. REWRITE — swap the origin on every asset URL stored in the database,
 *                Supabase public URL → R2 public URL. Because keys are
 *                identical this is a pure origin swap and is also idempotent
 *                (rows already pointing at R2 are not matched).
 *
 * Order matters: COPY must fully succeed before REWRITE, otherwise the app
 * serves URLs for objects that do not exist yet. Run COPY, verify, then REWRITE.
 *
 * NOTHING is written without `--execute`. The default is a dry run that reports
 * exactly what would change.
 *
 *   npx tsx scripts/migrate-storage-to-r2.ts                      # dry run, both phases
 *   npx tsx scripts/migrate-storage-to-r2.ts --copy --execute
 *   npx tsx scripts/migrate-storage-to-r2.ts --rewrite --execute
 *   npx tsx scripts/migrate-storage-to-r2.ts --verify             # post-cutover audit
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the full R2_* block.
 */

import * as dotenv from "dotenv";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

dotenv.config();

/**
 * The server modules below MUST be imported dynamically, after dotenv has run.
 *
 * `server/config/index.ts` validates and freezes the env at module-evaluation
 * time, and ESM hoists every static `import` above the `dotenv.config()` call
 * regardless of source order. A static import here therefore snapshots an empty
 * environment and leaves `hasR2Config` permanently false — the script would
 * refuse to run against a perfectly valid .env.
 */
const { createAdminSupabase } = await import("../server/supabase.js");
const { config, hasR2Config } = await import("../server/config/index.js");
const {
    r2Client,
    parseAssetUrl,
    publicUrlForKey,
    LEGACY_BUCKET,
    IMMUTABLE_CACHE_CONTROL,
    MUTABLE_CACHE_CONTROL,
} = await import("../server/lib/r2.js");

// ── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const VERIFY_ONLY = argv.includes("--verify");
const INSPECT_ONLY = argv.includes("--inspect");
const EXCLUSIVE = VERIFY_ONLY || INSPECT_ONLY;
const WANT_COPY = argv.includes("--copy") || (!argv.includes("--rewrite") && !EXCLUSIVE);
const WANT_REWRITE = argv.includes("--rewrite") || (!argv.includes("--copy") && !EXCLUSIVE);
const CONCURRENCY = Number(
    argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 8,
);

/**
 * Every DB location that can hold a `user_assets` URL.
 *
 * Columns that hold external links (terms_url, privacy_url) are included on
 * purpose: rewriting is guarded by parseAssetUrl, which returns null for
 * anything that is not a legacy bucket URL, so listing them is free insurance
 * against an admin having uploaded a document there.
 */
const URL_COLUMNS: Array<{ table: string; columns: string[] }> = [
    { table: "posts", columns: ["image_url", "thumbnail_url"] },
    // NB: `original_image_url` is NOT a column — it is a derived field on the
    // gallery API response (postGalleryItemSchema), computed from posts.image_url.
    { table: "post_versions", columns: ["image_url", "thumbnail_url"] },
    { table: "post_slides", columns: ["image_url", "thumbnail_url"] },
    { table: "post_slide_versions", columns: ["image_url", "thumbnail_url"] },
    { table: "brands", columns: ["logo_url"] },
    { table: "brand_reference_photos", columns: ["photo_url"] },
    {
        table: "landing_content",
        columns: ["hero_image_url", "cta_image_url", "logo_url", "alt_logo_url", "icon_url"],
    },
    {
        table: "app_settings",
        columns: ["logo_url", "favicon_url", "og_image_url", "terms_url", "privacy_url"],
    },
];

const PAGE = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(...args: unknown[]): void {
    console.log(...args);
}

function fail(message: string): never {
    console.error(`\n❌ ${message}\n`);
    process.exit(1);
}

/** Run `worker` over `items` with a bounded number of in-flight promises. */
async function pool<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}

/**
 * Cache policy must match what the app would write today, so a backfilled
 * object behaves identically to a freshly uploaded one. Brand logos live at a
 * stable key and are overwritten in place — they must not be cached immutably.
 */
function cacheControlForKey(key: string): string {
    return /\/logo\.[a-z0-9]+$/i.test(key) ? MUTABLE_CACHE_CONTROL : IMMUTABLE_CACHE_CONTROL;
}

// ── Phase 1: copy objects ────────────────────────────────────────────────────

interface StorageObject {
    key: string;
    size: number;
    mimetype: string;
}

/** Depth-first walk of the Supabase bucket; it has no flat-list API. */
async function listAllObjects(prefix = ""): Promise<StorageObject[]> {
    const supabase = createAdminSupabase();
    const found: StorageObject[] = [];
    let offset = 0;

    for (;;) {
        const { data, error } = await supabase.storage
            .from(LEGACY_BUCKET)
            .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });

        if (error) fail(`Failed to list "${prefix}": ${error.message}`);
        if (!data || data.length === 0) break;

        for (const entry of data) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            // Supabase reports pseudo-directories as rows with a null id.
            if (entry.id === null) {
                found.push(...(await listAllObjects(path)));
            } else {
                found.push({
                    key: path,
                    size: entry.metadata?.size ?? 0,
                    mimetype: entry.metadata?.mimetype ?? "application/octet-stream",
                });
            }
        }

        if (data.length < PAGE) break;
        offset += PAGE;
    }

    return found;
}

/** True when R2 already holds this key at the same byte length. */
async function alreadyCopied(key: string, size: number): Promise<boolean> {
    try {
        const head = await r2Client().send(
            new HeadObjectCommand({ Bucket: config.R2_BUCKET!, Key: key }),
        );
        // Size 0 in the Supabase listing means "unknown", so fall back to presence.
        return size === 0 || head.ContentLength === size;
    } catch {
        return false;
    }
}

async function runCopy(): Promise<void> {
    log("\n── Phase 1: copy objects ──────────────────────────────────────────");
    log("Enumerating the Supabase bucket (this walks every prefix)…");

    const objects = await listAllObjects();
    const totalBytes = objects.reduce((sum, o) => sum + o.size, 0);
    log(`Found ${objects.length} objects, ${(totalBytes / 1024 ** 3).toFixed(2)} GB total.`);

    if (objects.length === 0) return;

    let copied = 0;
    let skipped = 0;
    let failed = 0;
    let processed = 0;

    const supabase = createAdminSupabase();

    await pool(objects, CONCURRENCY, async (object) => {
        processed++;
        if (processed % 250 === 0) {
            log(`  …${processed}/${objects.length} (copied ${copied}, skipped ${skipped})`);
        }

        if (await alreadyCopied(object.key, object.size)) {
            skipped++;
            return;
        }

        if (!EXECUTE) {
            copied++;
            return;
        }

        try {
            const { data, error } = await supabase.storage
                .from(LEGACY_BUCKET)
                .download(object.key);
            if (error || !data) throw new Error(error?.message ?? "empty download");

            const body = Buffer.from(await data.arrayBuffer());

            await r2Client().send(
                new PutObjectCommand({
                    Bucket: config.R2_BUCKET!,
                    Key: object.key,
                    Body: body,
                    ContentType: object.mimetype || data.type || "application/octet-stream",
                    CacheControl: cacheControlForKey(object.key),
                }),
            );
            copied++;
        } catch (err) {
            failed++;
            console.error(
                `  ✗ ${object.key}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    });

    log(
        `\n${EXECUTE ? "Copied" : "Would copy"} ${copied}, skipped ${skipped} already present` +
        (failed > 0 ? `, ${failed} FAILED` : ""),
    );

    if (failed > 0) {
        fail(
            `${failed} objects failed to copy. Re-run the same command — it resumes and only ` +
            `retries what is missing. Do NOT run --rewrite until this reports 0 failures.`,
        );
    }
}

// ── Phase 2: rewrite DB URLs ─────────────────────────────────────────────────

/** Legacy URL → R2 URL, or null when the value is not a legacy bucket URL. */
function rewriteUrl(value: string | null): string | null {
    if (!value) return null;
    const parsed = parseAssetUrl(value);
    if (!parsed || parsed.backend !== "supabase") return null;
    return publicUrlForKey(parsed.key);
}

/**
 * Narrow a column list to the ones this deployment actually has.
 *
 * Probing per column matters: a single unknown column makes PostgREST reject
 * the whole `select`, so without this a stale entry in URL_COLUMNS would
 * silently skip an entire table and leave its URLs pointing at Supabase
 * forever. Failing loudly per column keeps the rest of the table migrating.
 */
async function existingColumns(table: string, columns: string[]): Promise<string[]> {
    const supabase = createAdminSupabase();
    const present: string[] = [];

    for (const column of columns) {
        const { error } = await supabase.from(table).select(column).limit(1);
        if (error) {
            console.warn(`  ⚠ ${table}.${column} not present — skipped (${error.message})`);
            continue;
        }
        present.push(column);
    }

    return present;
}

async function rewriteTable(table: string, requested: string[]): Promise<number> {
    const supabase = createAdminSupabase();

    const columns = await existingColumns(table, requested);
    if (columns.length === 0) {
        console.warn(`  ⚠ ${table}: no usable URL columns — skipped`);
        return 0;
    }

    let changedRows = 0;
    let offset = 0;

    for (;;) {
        const { data, error } = await supabase
            .from(table)
            .select(["id", ...columns].join(", "))
            .range(offset, offset + PAGE - 1);

        if (error) {
            console.warn(`  ⚠ ${table}: ${error.message} — skipped`);
            return 0;
        }
        if (!data || data.length === 0) break;

        const updates: Array<{ id: string; patch: Record<string, string> }> = [];

        for (const row of data as unknown as Array<Record<string, string | null>>) {
            const patch: Record<string, string> = {};
            for (const column of columns) {
                const next = rewriteUrl(row[column] ?? null);
                if (next) patch[column] = next;
            }
            if (Object.keys(patch).length > 0) {
                updates.push({ id: String(row.id), patch });
            }
        }

        if (updates.length > 0) {
            changedRows += updates.length;
            if (EXECUTE) {
                await pool(updates, CONCURRENCY, async ({ id, patch }) => {
                    const { error: updateError } = await supabase
                        .from(table)
                        .update(patch)
                        .eq("id", id);
                    if (updateError) {
                        console.error(`  ✗ ${table}#${id}: ${updateError.message}`);
                    }
                });
            }
        }

        if (data.length < PAGE) break;
        offset += PAGE;
    }

    if (changedRows > 0) {
        log(`  ${EXECUTE ? "updated" : "would update"} ${changedRows} rows in ${table}`);
    }
    return changedRows;
}

/**
 * The scenery catalog lives as JSON inside platform_settings, so it needs a
 * parse → walk → write pass rather than a column update.
 */
async function rewriteStyleCatalog(): Promise<number> {
    const supabase = createAdminSupabase();

    const { data, error } = await supabase
        .from("platform_settings")
        .select("setting_value")
        .eq("setting_key", "style_catalog")
        .maybeSingle();

    if (error || !data?.setting_value) {
        if (error) console.warn(`  ⚠ style_catalog: ${error.message} — skipped`);
        return 0;
    }

    const raw = data.setting_value;
    const catalog = typeof raw === "string" ? JSON.parse(raw) : raw;
    const sceneries = catalog?.sceneries;
    if (!Array.isArray(sceneries)) return 0;

    let changed = 0;
    for (const scenery of sceneries) {
        const next = rewriteUrl(scenery?.preview_image_url ?? null);
        if (next) {
            scenery.preview_image_url = next;
            changed++;
        }
    }

    if (changed > 0) {
        log(`  ${EXECUTE ? "updated" : "would update"} ${changed} scenery preview URLs`);
        if (EXECUTE) {
            const { error: updateError } = await supabase
                .from("platform_settings")
                .update({
                    setting_value: typeof raw === "string" ? JSON.stringify(catalog) : catalog,
                })
                .eq("setting_key", "style_catalog");
            if (updateError) console.error(`  ✗ style_catalog: ${updateError.message}`);
        }
    }

    return changed;
}

async function runRewrite(): Promise<void> {
    log("\n── Phase 2: rewrite DB URLs ───────────────────────────────────────");

    let total = 0;
    for (const { table, columns } of URL_COLUMNS) {
        total += await rewriteTable(table, columns);
    }
    total += await rewriteStyleCatalog();

    log(`\n${EXECUTE ? "Rewrote" : "Would rewrite"} ${total} rows in total.`);
}

// ── Verify ───────────────────────────────────────────────────────────────────

/** Count rows still holding a legacy URL — should be 0 after a full cutover. */
async function runVerify(): Promise<void> {
    log("\n── Verification: rows still pointing at Supabase Storage ──────────");
    const supabase = createAdminSupabase();
    let remaining = 0;

    for (const { table, columns } of URL_COLUMNS) {
        for (const column of columns) {
            const { count, error } = await supabase
                .from(table)
                .select(column, { count: "exact", head: true })
                .like(column, `%/${LEGACY_BUCKET}/%`);

            if (error) continue;
            if (count && count > 0) {
                log(`  ${table}.${column}: ${count}`);
                remaining += count;
            }
        }
    }

    log(
        remaining === 0
            ? "\n✓ No legacy Supabase Storage URLs remain in the database."
            : `\n⚠ ${remaining} column values still point at Supabase Storage.`,
    );
}

// ── Entrypoint ───────────────────────────────────────────────────────────────

/**
 * Read-only sizing pass over the source bucket. Deliberately does NOT require
 * R2 credentials — it exists so you can size the migration (object count, bytes,
 * shape of the data) before the bucket on the other side even exists.
 */
async function runInspect(): Promise<void> {
    log("\n── Source bucket inventory (read-only) ────────────────────────────");
    const objects = await listAllObjects();

    if (objects.length === 0) {
        log("Bucket is empty — nothing to back-fill.");
        return;
    }

    const totalBytes = objects.reduce((sum, o) => sum + o.size, 0);

    // Group by the second path segment, which is the asset class in every key
    // shape the app writes ({userId}/<class>/… or {userId}/<file>).
    const byClass = new Map<string, { count: number; bytes: number }>();
    for (const object of objects) {
        const segments = object.key.split("/");
        const cls = segments.length > 2 ? segments[1] : "(root files)";
        const entry = byClass.get(cls) ?? { count: 0, bytes: 0 };
        entry.count++;
        entry.bytes += object.size;
        byClass.set(cls, entry);
    }

    const owners = new Set(objects.map((o) => o.key.split("/")[0]));

    log(`\nObjects : ${objects.length}`);
    log(`Size    : ${(totalBytes / 1024 ** 3).toFixed(3)} GB`);
    log(`Prefixes: ${owners.size} (users + shared prefixes)\n`);

    const rows = Array.from(byClass.entries()).sort((a, b) => b[1].bytes - a[1].bytes);
    log("  class                 objects        size");
    for (const [cls, { count, bytes }] of rows) {
        log(
            `  ${cls.padEnd(20)}  ${String(count).padStart(7)}  ${(bytes / 1024 ** 2)
                .toFixed(1)
                .padStart(9)} MB`,
        );
    }

    // R2 Class A (writes) are $4.50/million; the copy is one PUT per object.
    const writeCost = (objects.length / 1_000_000) * 4.5;
    const monthlyStorage = (totalBytes / 1024 ** 3) * 0.015;
    log(`\nOne-off copy cost : ~$${writeCost.toFixed(2)} (${objects.length} Class A writes)`);
    log(`R2 storage        : ~$${monthlyStorage.toFixed(2)}/month at this size`);
}

async function main(): Promise<void> {
    if (INSPECT_ONLY) {
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            fail("SUPABASE_SERVICE_ROLE_KEY is required to read the source bucket.");
        }
        log(`Source : Supabase ${LEGACY_BUCKET}`);
        await runInspect();
        return;
    }

    if (!hasR2Config) {
        fail(
            "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
            "R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL before migrating.",
        );
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        fail("SUPABASE_SERVICE_ROLE_KEY is required to read the source bucket.");
    }

    log(`Source : Supabase ${LEGACY_BUCKET}`);
    log(`Target : R2 ${config.R2_BUCKET} → ${config.R2_PUBLIC_BASE_URL}`);
    log(`Mode   : ${EXECUTE ? "EXECUTE (writes)" : "DRY RUN (no writes)"}`);

    if (VERIFY_ONLY) {
        await runVerify();
        return;
    }

    if (WANT_COPY) await runCopy();
    if (WANT_REWRITE) await runRewrite();

    if (!EXECUTE) {
        log("\nDry run only. Re-run with --execute to apply.");
        log("Recommended order:  --copy --execute   →   --rewrite --execute   →   --verify");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
