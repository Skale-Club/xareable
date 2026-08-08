/**
 * Cleanup cron service (Phase 11 + 12; HTTP-trigger path added in Phase 14;
 * social publication sweep added by the Zernio social publishing integration, P2)
 *
 * Four scheduled jobs:
 *   1. runTrashSweep — soft-delete posts past expires_at (sets trashed_at)
 *   2. runPurgeSweep — permanently delete posts in trash > TRASH_RETENTION_DAYS
 *   3. runOverageBillingBatch (in server/stripe.ts) — weekly Stripe overage invoices
 *   4. runPublicationStatusSweep (in social-publish.service.ts) — every 15 min,
 *      refresh post_publications stuck in pending/scheduled (safety net behind webhooks)
 *
 * TWO trigger paths coexist:
 *   A) HTTP triggers via /api/internal/cleanup/* + /api/internal/billing/run-overage-batch
 *      Active on Vercel (and any serverless host). Disp via GitHub Actions schedule.
 *      See .github/workflows/cron.yml.
 *
 *   B) Internal node-cron via startCronJobs() called from server/index.ts:httpServer.listen
 *      Active on Hetzner (and any long-running Node host) when running `npm run start`.
 *      NOT active on Vercel because Vercel uses api/handler.ts as the entry, not server/index.ts.
 *
 * Both paths invoke the SAME functions; no logic divergence. Pick the one that matches the
 * deployment. If both are active simultaneously (e.g. Hetzner with GH Actions also enabled),
 * the in-process overageBatchRunning lock prevents double-charges within a single process,
 * but cross-process double-charging IS possible — disable one trigger when running on Hetzner.
 */

import cron from "node-cron";
import { createAdminSupabase } from "../supabase.js";
import { TRASH_RETENTION_DAYS } from "../../shared/schema.js";
import {
  runOverageBillingBatch,
  getOverageBillingCadenceDays,
} from "../stripe.js";
import { captureException } from "../lib/observability.js";
import { deleteAssetsByUrl } from "../lib/r2.js";
import { runPublicationStatusSweep } from "./social-publish.service.js";

/** Cap how many posts a single purge run may process to avoid unbounded batches. */
const PURGE_BATCH_LIMIT = 50;

/** Compute the enhancement source path: image_url with `.webp` -> `-source.webp`. */
function deriveEnhancementSourceUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (!/\.webp(\?.*)?$/i.test(imageUrl)) return null;
  return imageUrl.replace(/\.webp(\?.*)?$/i, (_m, qs) => `-source.webp${qs || ""}`);
}

/**
 * Trash sweep: set trashed_at = now() for posts whose expires_at has passed
 * and that are not already in trash.
 * @returns number of posts moved to trash
 */
export async function runTrashSweep(): Promise<number> {
  const supabase = createAdminSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("posts")
    .update({ trashed_at: now })
    .lte("expires_at", now)
    .is("trashed_at", null)
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Purge sweep: permanently delete posts that have been trashed for >= TRASH_RETENTION_DAYS.
 * Storage deletion happens BEFORE the DB row delete (orphan-prevention order).
 * @returns number of posts purged
 */
export async function runPurgeSweep(): Promise<number> {
  const supabase = createAdminSupabase();
  const cutoffMs = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, image_url, thumbnail_url, content_type")
    .not("trashed_at", "is", null)
    .lte("trashed_at", cutoff)
    .limit(PURGE_BATCH_LIMIT);

  if (error) throw error;
  if (!posts || posts.length === 0) return 0;

  let purgedCount = 0;
  const postIds = posts.map((p) => p.id);

  // Collect all asset URLs up front: post primary + thumbnail + post_versions + post_slides + enhancement -source.
  // URLs (not paths) because a purge batch can legitimately mix R2-hosted and
  // not-yet-backfilled Supabase-hosted assets; deleteAssetsByUrl routes each.
  const filesToDelete: (string | null | undefined)[] = [];

  // 1. Post-level images
  for (const post of posts) {
    filesToDelete.push(post.image_url, post.thumbnail_url);

    // 2. Enhancement source sibling file
    if (post.content_type === "enhancement") {
      filesToDelete.push(deriveEnhancementSourceUrl(post.image_url));
    }
  }

  // 3. Slide images for carousel posts
  const { data: slides } = await supabase
    .from("post_slides")
    .select("image_url, thumbnail_url")
    .in("post_id", postIds);
  for (const slide of slides || []) {
    filesToDelete.push(slide.image_url, slide.thumbnail_url);
  }

  // 4. Post versions (edited variants)
  const { data: versions } = await supabase
    .from("post_versions")
    .select("image_url, thumbnail_url")
    .in("post_id", postIds);
  for (const v of versions || []) {
    filesToDelete.push(v.image_url, v.thumbnail_url);
  }

  // STORAGE DELETE FIRST (chunking + de-duplication handled inside)
  const deletion = await deleteAssetsByUrl(filesToDelete);
  if (deletion.failed) {
    console.error("[Cron Purge] Storage delete failed — aborting before DB delete");
    // Abort: do not delete DB rows if storage failed (avoid orphan files).
    return purgedCount;
  }

  // 5. DB delete — CASCADE removes post_slides + post_versions automatically.
  const { error: deleteError } = await supabase
    .from("posts")
    .delete()
    .in("id", postIds);

  if (deleteError) {
    console.error("[Cron Purge] DB delete failed:", deleteError.message);
    return purgedCount;
  }

  // 6. Clear version_cleanup_log entries for these posts (best-effort)
  // post_slides + post_versions cascade-delete fires triggers that enqueue rows
  // into version_cleanup_log; clear them since we already removed storage above.
  // (Best-effort: failure here is non-fatal — the drain will no-op.)
  // Note: version_cleanup_log uses version_id from the deleted slide/version rows
  // which are gone after CASCADE; clean by joining on missing references is not
  // possible. Instead delete log entries created in the last 60s for safety.
  try {
    const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
    await supabase
      .from("version_cleanup_log")
      .delete()
      .gte("created_at", sixtySecAgo);
  } catch (err) {
    console.warn("[Cron Purge] version_cleanup_log cleanup skipped:", err);
  }

  purgedCount = posts.length;
  return purgedCount;
}

/**
 * Resolve a cron expression for the overage billing batch from
 * billing_settings.overage_billing_cadence_days (read via stripe.ts helper).
 *
 * Mapping:
 *   1   → daily   ("0 0 * * *")   midnight UTC
 *   7   → weekly  ("0 0 * * 0")   Sunday 00:00 UTC (default)
 *   30  → monthly ("0 0 1 * *")   1st of month 00:00 UTC
 *
 * Any other value falls back to weekly with a console.warn so admins
 * notice and either align the setting or extend the mapping. The
 * inner per-user cadence-due gate inside runOverageBillingBatch()
 * still enforces the exact day count regardless of cron frequency.
 */
async function resolveOverageCronExpression(): Promise<string> {
  let days: number;
  try {
    days = await getOverageBillingCadenceDays();
  } catch (err) {
    console.warn(
      "[Cron] Overage cadence read failed; defaulting to weekly:",
      err,
    );
    return "0 0 * * 0";
  }

  switch (days) {
    case 1:
      return "0 0 * * *";
    case 7:
      return "0 0 * * 0";
    case 30:
      return "0 0 1 * *";
    default:
      console.warn(
        `[Cron] Unrecognized overage cadence ${days} day(s); defaulting to weekly (0 0 * * 0)`,
      );
      return "0 0 * * 0";
  }
}

/**
 * In-process lock: skip a new overage tick if the previous tick is still
 * running. Prevents double-charging users from overlapping cron invocations
 * (per CONTEXT.md decisions — concurrency).
 */
let overageBatchRunning = false;

/**
 * Register all cron jobs. Called from server/index.ts inside httpServer.listen callback.
 * Trash sweep: every 6 hours at minute 0.
 * Purge sweep: every 6 hours at minute 30 (offset to avoid overlap).
 * Overage batch: cadence resolved at startup from billing_settings.overage_billing_cadence_days.
 * Social publication status sweep: every 15 minutes (safety net behind Zernio webhooks).
 */
export async function startCronJobs(): Promise<void> {
  cron.schedule("0 */6 * * *", async () => {
    console.log("[Cron] Trash sweep starting");
    try {
      const count = await runTrashSweep();
      if (count > 0) console.log(`[Cron] Trash sweep: ${count} post(s) trashed`);
    } catch (err) {
      captureException(err, { job: "trash_sweep", trigger: "node-cron" });
    }
  });

  cron.schedule("30 */6 * * *", async () => {
    console.log("[Cron] Purge sweep starting");
    try {
      const count = await runPurgeSweep();
      if (count > 0) console.log(`[Cron] Purge sweep: ${count} post(s) purged`);
    } catch (err) {
      captureException(err, { job: "purge_sweep", trigger: "node-cron" });
    }
  });

  const overageCronExpr = await resolveOverageCronExpression();
  cron.schedule(overageCronExpr, async () => {
    if (overageBatchRunning) {
      console.log("[Cron] Overage batch skipped — previous run still in progress");
      return;
    }
    overageBatchRunning = true;
    console.log("[Cron] Overage batch starting");
    try {
      const result = await runOverageBillingBatch();
      console.log(
        `[Cron] Overage batch: processed ${result.processed} user(s) (charged ${result.charged}, skipped ${result.skipped})`,
      );
    } catch (err) {
      captureException(err, { job: "overage_batch", trigger: "node-cron" });
    } finally {
      overageBatchRunning = false;
    }
  });

  cron.schedule("*/15 * * * *", async () => {
    console.log("[Cron] Social publication status sweep starting");
    try {
      const count = await runPublicationStatusSweep();
      if (count > 0) console.log(`[Cron] Social publication status sweep: ${count} publication(s) refreshed`);
    } catch (err) {
      captureException(err, { job: "social_publication_status_sweep", trigger: "node-cron" });
    }
  });

  console.log(
    `[Cron] Jobs registered: trash-sweep (every 6h), purge-sweep (every 6h +30m), overage-batch (${overageCronExpr}), social-publication-status-sweep (every 15m)`,
  );
}
