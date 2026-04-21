/**
 * Phase 05 Verification Script
 *
 * Validates all 6 ROADMAP.md Phase 5 success criteria against a live Supabase
 * database AFTER `supabase db push` has applied the v1.1 schema foundation
 * migration (supabase/migrations/20260421000000_v1_1_schema_foundation.sql).
 *
 * Usage:
 *   npx tsx scripts/verify-phase-05.ts
 *
 * Required env (loaded from .env via dotenv, or from the shell):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TEST_USER_ACCESS_TOKEN  (JWT for any non-admin Supabase auth user in this project)
 *   TEST_USER_ID            (the user_id matching the JWT above — used for ownership checks)
 *
 * Exits 0 on full pass (6/6), 1 on any failure.
 *
 * Self-cleaning: all test inserts into `posts` are wrapped in try/finally and
 * removed at the end. Cascading deletes take care of `post_slides` rows.
 * Does NOT mutate `app_settings` — the scenery check is read-only.
 */

import { randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import { createServerSupabase, createAdminSupabase } from "../server/supabase.js";

dotenv.config();

const TEST_USER_ACCESS_TOKEN = process.env.TEST_USER_ACCESS_TOKEN;
const TEST_USER_ID = process.env.TEST_USER_ID;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "FAIL: SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must be set (either in .env or the shell).",
  );
  process.exit(1);
}

if (!TEST_USER_ACCESS_TOKEN || !TEST_USER_ID) {
  console.error(
    "FAIL: TEST_USER_ACCESS_TOKEN and TEST_USER_ID must be set in env. See script header for how to obtain them.",
  );
  process.exit(1);
}

type CheckResult = { name: string; pass: boolean; detail: string };
const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name} — ${detail}`);
}

async function main() {
  const admin = createAdminSupabase();
  const user = createServerSupabase(TEST_USER_ACCESS_TOKEN!);

  const createdPostIds: string[] = [];

  try {
    // --- Criterion 1 (SCHM-02): post_slides exists AND RLS is enforced via user-scoped client ---
    // Seed a post for TEST_USER_ID with a slide via admin client, then query via user client.
    // If RLS policies didn't land, the user-scoped select silently returns [] — the signature
    // failure mode documented from v1.0 Phase 2.
    const postIdRls = randomUUID();
    const slideImageUrl = `https://example.com/phase05-verify/${postIdRls}/slide-1.webp`;
    const slideThumbUrl = `https://example.com/phase05-verify/${postIdRls}/slide-1-thumb.webp`;

    const { error: postInsErr } = await admin.from("posts").insert({
      id: postIdRls,
      user_id: TEST_USER_ID,
      image_url: "https://example.com/phase05-verify/placeholder.webp",
      content_type: "carousel",
      slide_count: 1,
      status: "draft",
    });
    if (postInsErr) throw new Error(`setup post failed: ${postInsErr.message}`);
    createdPostIds.push(postIdRls);

    const { error: slideInsErr } = await admin.from("post_slides").insert({
      post_id: postIdRls,
      slide_number: 1,
      image_url: slideImageUrl,
      thumbnail_url: slideThumbUrl,
    });
    if (slideInsErr) throw new Error(`setup slide failed: ${slideInsErr.message}`);

    const { data: userSlides, error: userSlidesErr } = await user
      .from("post_slides")
      .select("id, slide_number")
      .eq("post_id", postIdRls);

    if (userSlidesErr) {
      record(
        "SCHM-02 (post_slides + RLS)",
        false,
        `user-scoped select errored: ${userSlidesErr.message}`,
      );
    } else if (!userSlides || userSlides.length !== 1) {
      record(
        "SCHM-02 (post_slides + RLS)",
        false,
        `user-scoped select returned ${userSlides?.length ?? 0} rows (expected 1). This is the 'silent empty array' signature of missing RLS.`,
      );
    } else {
      record(
        "SCHM-02 (post_slides + RLS)",
        true,
        "post_slides readable via user-scoped client with matching JWT ownership",
      );
    }

    // --- Criterion 2 (SCHM-01): content_type CHECK rejects unknown values ---
    const { error: badTypeErr } = await admin.from("posts").insert({
      id: randomUUID(),
      user_id: TEST_USER_ID,
      image_url: "https://example.com/phase05-verify/x.webp",
      content_type: "unknown",
      status: "draft",
    });
    const badCodeSqlState = (badTypeErr as any)?.code;
    if (badTypeErr && badCodeSqlState === "23514") {
      record(
        "SCHM-01 (content_type CHECK)",
        true,
        `CHECK violation raised as expected (SQLSTATE 23514)`,
      );
    } else {
      record(
        "SCHM-01 (content_type CHECK)",
        false,
        `expected CHECK violation (23514) — got: ${badTypeErr ? `${badCodeSqlState}: ${badTypeErr.message}` : "no error (row inserted!)"}`,
      );
    }

    // --- Criterion 3 (SCHM-03): slide_count is nullable + accepts positive int ---
    const postIdSingle = randomUUID();
    const { error: singleErr } = await admin.from("posts").insert({
      id: postIdSingle,
      user_id: TEST_USER_ID,
      image_url: "https://example.com/phase05-verify/y.webp",
      content_type: "image",
      slide_count: null,
      status: "draft",
    });
    if (singleErr) {
      record(
        "SCHM-03 (slide_count nullable)",
        false,
        `single-image insert with slide_count=null failed: ${singleErr.message}`,
      );
    } else {
      createdPostIds.push(postIdSingle);
      // Now verify a carousel post with slide_count=5 saves too.
      const postIdCar = randomUUID();
      const { error: carErr } = await admin.from("posts").insert({
        id: postIdCar,
        user_id: TEST_USER_ID,
        image_url: "https://example.com/phase05-verify/z.webp",
        content_type: "carousel",
        slide_count: 5,
        status: "draft",
      });
      if (carErr) {
        record(
          "SCHM-03 (slide_count nullable)",
          false,
          `carousel insert with slide_count=5 failed: ${carErr.message}`,
        );
      } else {
        createdPostIds.push(postIdCar);
        record(
          "SCHM-03 (slide_count nullable)",
          true,
          "slide_count accepts NULL for image posts and positive int for carousel posts",
        );
      }
    }

    // --- Criterion 4 (SCHM-05): idempotency_key UNIQUE constraint ---
    const key = randomUUID();
    const postIdDup1 = randomUUID();
    const postIdDup2 = randomUUID();
    const { error: firstKeyErr } = await admin.from("posts").insert({
      id: postIdDup1,
      user_id: TEST_USER_ID,
      image_url: "https://example.com/phase05-verify/dup1.webp",
      content_type: "carousel",
      slide_count: 3,
      idempotency_key: key,
      status: "draft",
    });
    if (firstKeyErr) {
      record(
        "SCHM-05 (idempotency_key UNIQUE)",
        false,
        `first insert with idempotency_key failed: ${firstKeyErr.message}`,
      );
    } else {
      createdPostIds.push(postIdDup1);
      const { error: secondKeyErr } = await admin.from("posts").insert({
        id: postIdDup2,
        user_id: TEST_USER_ID,
        image_url: "https://example.com/phase05-verify/dup2.webp",
        content_type: "carousel",
        slide_count: 3,
        idempotency_key: key,
        status: "draft",
      });
      const dupCode = (secondKeyErr as any)?.code;
      if (secondKeyErr && dupCode === "23505") {
        record(
          "SCHM-05 (idempotency_key UNIQUE)",
          true,
          `duplicate idempotency_key raised 23505 as expected`,
        );
      } else {
        if (!secondKeyErr) createdPostIds.push(postIdDup2);
        record(
          "SCHM-05 (idempotency_key UNIQUE)",
          false,
          `expected unique-violation (23505) — got: ${secondKeyErr ? `${dupCode}: ${secondKeyErr.message}` : "no error (duplicate inserted!)"}`,
        );
      }
    }

    // --- Criterion 5 (SCHM-06): Cleanup trigger enqueues version_cleanup_log on slide delete ---
    // Reuse postIdRls (has 1 slide). Delete the post → CASCADE to slides → BEFORE DELETE trigger
    // on post_slides logs a row into version_cleanup_log.
    const { data: preCleanupRows, error: preErr } = await admin
      .from("version_cleanup_log")
      .select("id")
      .eq("image_url", slideImageUrl);
    if (preErr) {
      record(
        "SCHM-06 (cleanup trigger)",
        false,
        `pre-check read version_cleanup_log failed: ${preErr.message}`,
      );
    } else {
      const before = preCleanupRows?.length ?? 0;
      const { error: delErr } = await admin.from("posts").delete().eq("id", postIdRls);
      if (delErr) {
        record(
          "SCHM-06 (cleanup trigger)",
          false,
          `post delete failed: ${delErr.message}`,
        );
      } else {
        // Remove from cleanup list — row is already gone.
        const idx = createdPostIds.indexOf(postIdRls);
        if (idx >= 0) createdPostIds.splice(idx, 1);

        const { data: postCleanupRows, error: postErr } = await admin
          .from("version_cleanup_log")
          .select("id, image_url")
          .eq("image_url", slideImageUrl);
        if (postErr) {
          record(
            "SCHM-06 (cleanup trigger)",
            false,
            `post-check read version_cleanup_log failed: ${postErr.message}`,
          );
        } else {
          const after = postCleanupRows?.length ?? 0;
          if (after > before) {
            record(
              "SCHM-06 (cleanup trigger)",
              true,
              `version_cleanup_log gained ${after - before} row(s) after carousel post delete (slide cascade + trigger fired)`,
            );
          } else {
            record(
              "SCHM-06 (cleanup trigger)",
              false,
              `version_cleanup_log did not gain a row after post delete (before=${before}, after=${after}) — trigger not firing?`,
            );
          }
        }
      }
    }

    // --- Criterion 6 (ADMN-02 prerequisite): 12 scenery presets seeded ---
    const EXPECTED_SCENERY_IDS = [
      "white-studio",
      "marble-light",
      "marble-dark",
      "wooden-table",
      "concrete-urban",
      "outdoor-natural",
      "kitchen-counter",
      "dark-premium",
      "softbox-studio",
      "pastel-flat",
      "seasonal-festive",
      "cafe-ambience",
    ];
    const { data: appSettings, error: appErr } = await admin
      .from("app_settings")
      .select("style_catalog")
      .limit(1)
      .maybeSingle();
    if (appErr || !appSettings) {
      record(
        "Scenery seed (ADMN-02 prereq)",
        false,
        `app_settings read failed: ${appErr?.message ?? "no row"}`,
      );
    } else {
      const sceneries = (appSettings as any).style_catalog?.sceneries ?? [];
      const seededIds = new Set(sceneries.map((s: any) => s.id));
      const missing = EXPECTED_SCENERY_IDS.filter((id) => !seededIds.has(id));
      if (sceneries.length >= 12 && missing.length === 0) {
        record(
          "Scenery seed (ADMN-02 prereq)",
          true,
          `all 12 expected scenery IDs present (found ${sceneries.length} total)`,
        );
      } else {
        record(
          "Scenery seed (ADMN-02 prereq)",
          false,
          `scenery seed incomplete — count=${sceneries.length}, missing=[${missing.join(",")}]`,
        );
      }
    }
  } finally {
    // Cleanup any test posts we created. Slides cascade; version_cleanup_log rows are retained
    // for audit (they represent intentional enqueue activity, and the real cleanup worker in
    // server/services/storage-cleanup.service.ts will skip them harmlessly since the URLs
    // point to example.com paths that don't exist in Supabase Storage).
    if (createdPostIds.length > 0) {
      const { error: cleanupErr } = await admin.from("posts").delete().in("id", createdPostIds);
      if (cleanupErr) {
        console.error(
          `[cleanup] failed to remove ${createdPostIds.length} test posts: ${cleanupErr.message}`,
        );
      }
    }
  }

  const passes = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log("");
  if (passes === total) {
    console.log(`VERIFY PHASE 05: PASS (${passes}/${total} criteria)`);
  } else {
    console.log(`VERIFY PHASE 05: FAIL (${passes}/${total} criteria)`);
  }
  process.exit(passes === total ? 0 : 1);
}

main().catch((err) => {
  console.error("VERIFY PHASE 05: FAIL — unhandled error:", err);
  process.exit(1);
});
