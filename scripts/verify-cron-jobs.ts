/**
 * Phase 15 Verification Script — Cron Job Runtime Harness (VRFY-01)
 *
 * RUNTIME verification of the three destructive scheduled jobs:
 *   1. runTrashSweep()           → asserts soft-delete on past-due posts
 *   2. runPurgeSweep()           → asserts storage-then-DB delete on over-retention posts
 *   3. runOverageBillingBatch()  → empty case (always) + Stripe full case (sk_test_* gated)
 *
 * Test isolation: a dedicated user (cron-verify-{timestamp}@xareable.test) is created at
 * start, owns ALL seeded data, and is deleted in a finally block. Cascade FKs remove
 * posts/post_slides/post_versions/user_billing_profiles/billing_ledger automatically.
 *
 * Run with: npx tsx scripts/verify-cron-jobs.ts
 * Required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (loaded via dotenv).
 * Optional env: STRIPE_SECRET_KEY=sk_test_* enables the full overage Stripe path test.
 *
 * Exits 0 only when all enabled tests pass. Non-zero with itemized failure report otherwise.
 */

import * as dotenv from "dotenv";
import { createAdminSupabase } from "../server/supabase.js";
import {
  runTrashSweep,
  runPurgeSweep,
} from "../server/services/cleanup-cron.service.js";
import { runOverageBillingBatch } from "../server/stripe.js";
import { TRASH_RETENTION_DAYS } from "../shared/schema.js";

dotenv.config();

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_ANON_KEY ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  console.error(
    "FAIL: SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must be set (env or .env).",
  );
  process.exit(1);
}

// ── Tiny assert helper (no Jest, no Vitest — keep deps zero) ────────────────
class AssertionError extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new AssertionError(msg);
}

// ── Test user lifecycle ─────────────────────────────────────────────────────
async function createTestUser(): Promise<string> {
  const sb = createAdminSupabase();
  const email = `cron-verify-${Date.now()}@xareable.test`;
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`Failed to create test user: ${error?.message}`);
  console.log(`  → seeded test user: ${email} (${data.user.id})`);
  return data.user.id;
}

async function cleanupTestUser(userId: string): Promise<void> {
  const sb = createAdminSupabase();
  // Storage objects under user_assets/{userId}/* — list and remove root + thumbnails subfolder.
  // (Recursive listing isn't supported by the Supabase JS SDK in one call; do two passes.)
  const { data: rootObjects } = await sb.storage
    .from("user_assets")
    .list(userId);
  if (rootObjects?.length) {
    const paths = rootObjects.map((o) => `${userId}/${o.name}`);
    await sb.storage.from("user_assets").remove(paths);
  }
  const { data: thumbObjects } = await sb.storage
    .from("user_assets")
    .list(`${userId}/thumbnails`);
  if (thumbObjects?.length) {
    const paths = thumbObjects.map((o) => `${userId}/thumbnails/${o.name}`);
    await sb.storage.from("user_assets").remove(paths);
  }
  // Auth user delete cascades through posts/post_slides/post_versions/user_billing_profiles/billing_ledger.
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) console.error(`  ⚠ test user delete failed: ${error.message}`);
  else console.log(`  → cleaned up test user ${userId}`);
}

// ── 1×1 transparent PNG upload helper ───────────────────────────────────────
async function uploadTestImage(path: string): Promise<string> {
  const sb = createAdminSupabase();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const { error } = await sb.storage.from("user_assets").upload(path, png, {
    contentType: "image/png",
    upsert: true,
  });
  if (error)
    throw new Error(`Storage upload failed for ${path}: ${error.message}`);
  const { data } = sb.storage.from("user_assets").getPublicUrl(path);
  return data.publicUrl;
}

async function storageObjectExists(path: string): Promise<boolean> {
  const sb = createAdminSupabase();
  const lastSlash = path.lastIndexOf("/");
  const folder = path.slice(0, lastSlash);
  const name = path.slice(lastSlash + 1);
  const { data } = await sb.storage
    .from("user_assets")
    .list(folder, { search: name });
  return !!data?.find((o) => o.name === name);
}

// ── Output format helpers (mirror verify-phase-11.ts conventions) ───────────
type TestResult = {
  name: string;
  passed: number;
  failed: number;
  skipped: boolean;
};
function fmtResult(r: TestResult): string {
  if (r.skipped) return `⊘ ${r.name} — SKIPPED`;
  return r.failed === 0
    ? `✓ ${r.name} — PASS (${r.passed} assertion${r.passed === 1 ? "" : "s"})`
    : `✗ ${r.name} — FAIL (${r.failed} of ${r.passed + r.failed} assertions failed)`;
}

// ── Test stubs (real bodies in subsequent tasks) ────────────────────────────
async function testTrashSweep(userId: string): Promise<TestResult> {
  console.log("\n▶ Test: trash sweep");
  const sb = createAdminSupabase();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const future = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result: TestResult = {
    name: "trash sweep",
    passed: 0,
    failed: 0,
    skipped: false,
  };
  const tally = (label: string, ok: boolean, detail?: string) => {
    if (ok) {
      console.log(`  ✓ ${label}`);
      result.passed += 1;
    } else {
      console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
      result.failed += 1;
    }
  };

  // Seed: 2 eligible (expires_at in the past, trashed_at null) + 1 control (expires_at in the future).
  // image_url uses test:// scheme so trash sweep ignores it for storage purposes (sweep only updates trashed_at).
  const { data: seeded, error: seedErr } = await sb
    .from("posts")
    .insert([
      {
        user_id: userId,
        content_type: "image",
        image_url: "test://trash-1.webp",
        expires_at: yesterday,
        trashed_at: null,
        status: "draft",
      },
      {
        user_id: userId,
        content_type: "image",
        image_url: "test://trash-2.webp",
        expires_at: yesterday,
        trashed_at: null,
        status: "draft",
      },
      {
        user_id: userId,
        content_type: "image",
        image_url: "test://trash-control.webp",
        expires_at: future,
        trashed_at: null,
        status: "draft",
      },
    ])
    .select("id, expires_at");

  if (seedErr || !seeded || seeded.length !== 3) {
    tally(
      "seed 3 posts",
      false,
      `insert error: ${seedErr?.message ?? "no rows returned"}`,
    );
    return result;
  }
  tally("seed 3 posts (2 eligible + 1 control)", true);

  // IMPORTANT: runTrashSweep is global — it might trash other expired posts too.
  // We only assert about the rows WE inserted, identified by id.
  const eligibleIds = seeded
    .filter((s) => s.expires_at === yesterday)
    .map((s) => s.id);
  const controlId = seeded.find((s) => s.expires_at === future)!.id;

  let swept = 0;
  try {
    swept = await runTrashSweep();
    tally("runTrashSweep() did not throw", true);
  } catch (err) {
    tally("runTrashSweep() did not throw", false, (err as Error).message);
    return result;
  }

  // Re-read our 3 rows.
  const { data: after, error: afterErr } = await sb
    .from("posts")
    .select("id, trashed_at")
    .in(
      "id",
      seeded.map((s) => s.id),
    );
  if (afterErr || !after) {
    tally("re-read seeded posts", false, afterErr?.message);
    return result;
  }

  const byId = new Map(after.map((p) => [p.id, p.trashed_at]));
  for (const id of eligibleIds) {
    const t = byId.get(id);
    tally(
      `eligible post ${id.slice(0, 8)} trashed_at set`,
      t !== null && t !== undefined,
    );
  }
  const controlTrashed = byId.get(controlId);
  tally(
    `control post ${controlId.slice(0, 8)} preserved (trashed_at null)`,
    controlTrashed === null,
  );

  // The sweep is global; we can't assert exact return count, but it MUST be ≥ 2 (our two eligible).
  tally(`runTrashSweep() returned ≥ 2 (got ${swept})`, swept >= 2);

  console.log(
    `  Result: ${result.failed === 0 ? "PASS" : "FAIL"} (${result.passed}/${result.passed + result.failed})`,
  );
  return result;
}
async function testPurgeSweep(userId: string): Promise<TestResult> {
  console.log("\n▶ Test: purge sweep");
  const sb = createAdminSupabase();
  const result: TestResult = {
    name: "purge sweep",
    passed: 0,
    failed: 0,
    skipped: false,
  };
  const tally = (label: string, ok: boolean, detail?: string) => {
    if (ok) {
      console.log(`  ✓ ${label}`);
      result.passed += 1;
    } else {
      console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
      result.failed += 1;
    }
  };

  // (TRASH_RETENTION_DAYS + 1) days ago — past the retention cutoff so the purge sweep selects our rows.
  const overRetention = new Date(
    Date.now() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
  ).toISOString();

  // ── Carousel post: image + thumb + 2 slides (image + thumb each) + 1 version (image + thumb) ──
  const carouselPostId = crypto.randomUUID();
  const carPaths = {
    image: `${userId}/${carouselPostId}.webp`,
    thumb: `${userId}/thumbnails/${carouselPostId}.webp`,
    slide1Img: `${userId}/${carouselPostId}-slide-1.webp`,
    slide1Thm: `${userId}/thumbnails/${carouselPostId}-slide-1.webp`,
    slide2Img: `${userId}/${carouselPostId}-slide-2.webp`,
    slide2Thm: `${userId}/thumbnails/${carouselPostId}-slide-2.webp`,
    versImg: `${userId}/${carouselPostId}-v2.webp`,
    versThm: `${userId}/thumbnails/${carouselPostId}-v2.webp`,
  };
  const carUrls = {
    image: await uploadTestImage(carPaths.image),
    thumb: await uploadTestImage(carPaths.thumb),
    slide1Img: await uploadTestImage(carPaths.slide1Img),
    slide1Thm: await uploadTestImage(carPaths.slide1Thm),
    slide2Img: await uploadTestImage(carPaths.slide2Img),
    slide2Thm: await uploadTestImage(carPaths.slide2Thm),
    versImg: await uploadTestImage(carPaths.versImg),
    versThm: await uploadTestImage(carPaths.versThm),
  };

  const { error: carInsErr } = await sb.from("posts").insert({
    id: carouselPostId,
    user_id: userId,
    content_type: "carousel",
    slide_count: 2,
    image_url: carUrls.image,
    thumbnail_url: carUrls.thumb,
    trashed_at: overRetention,
    status: "draft",
  });
  if (carInsErr) {
    tally("seed carousel post", false, carInsErr.message);
    return result;
  }
  const { error: slideInsErr } = await sb.from("post_slides").insert([
    {
      post_id: carouselPostId,
      slide_number: 1,
      image_url: carUrls.slide1Img,
      thumbnail_url: carUrls.slide1Thm,
    },
    {
      post_id: carouselPostId,
      slide_number: 2,
      image_url: carUrls.slide2Img,
      thumbnail_url: carUrls.slide2Thm,
    },
  ]);
  if (slideInsErr) {
    tally("seed slides", false, slideInsErr.message);
    return result;
  }
  const { error: verInsErr } = await sb.from("post_versions").insert({
    post_id: carouselPostId,
    version_number: 2,
    image_url: carUrls.versImg,
    thumbnail_url: carUrls.versThm,
  });
  if (verInsErr) {
    tally("seed version", false, verInsErr.message);
    return result;
  }
  tally(
    "seed carousel post + 2 slides + 1 version + 8 storage objects",
    true,
  );

  // ── Enhancement post: image + thumb + sibling -source.webp ──
  const enhPostId = crypto.randomUUID();
  const enhPaths = {
    image: `${userId}/${enhPostId}.webp`,
    thumb: `${userId}/thumbnails/${enhPostId}.webp`,
    source: `${userId}/${enhPostId}-source.webp`, // matches deriveEnhancementSourceUrl
  };
  const enhUrls = {
    image: await uploadTestImage(enhPaths.image),
    thumb: await uploadTestImage(enhPaths.thumb),
    source: await uploadTestImage(enhPaths.source),
  };
  const { error: enhInsErr } = await sb.from("posts").insert({
    id: enhPostId,
    user_id: userId,
    content_type: "enhancement",
    image_url: enhUrls.image,
    thumbnail_url: enhUrls.thumb,
    trashed_at: overRetention,
    status: "draft",
  });
  if (enhInsErr) {
    tally("seed enhancement post", false, enhInsErr.message);
    return result;
  }
  tally("seed enhancement post + source sibling (3 storage objects)", true);

  // Pre-flight: verify uploads landed.
  const allPaths = [
    carPaths.image,
    carPaths.thumb,
    carPaths.slide1Img,
    carPaths.slide1Thm,
    carPaths.slide2Img,
    carPaths.slide2Thm,
    carPaths.versImg,
    carPaths.versThm,
    enhPaths.image,
    enhPaths.thumb,
    enhPaths.source,
  ];
  for (const p of allPaths) {
    const exists = await storageObjectExists(p);
    if (!exists) {
      tally(`pre-flight: ${p} uploaded`, false);
      return result;
    }
  }
  tally(`pre-flight: all 11 storage objects uploaded`, true);

  // ── Invoke ──
  let purged = 0;
  try {
    purged = await runPurgeSweep();
    tally("runPurgeSweep() did not throw", true);
  } catch (err) {
    tally("runPurgeSweep() did not throw", false, (err as Error).message);
    return result;
  }

  // ── Assert: storage gone ──
  let allGone = true;
  for (const p of allPaths) {
    const stillThere = await storageObjectExists(p);
    if (stillThere) {
      tally(
        `storage object removed: ${p}`,
        false,
        "still exists — orphan!",
      );
      allGone = false;
    }
  }
  if (allGone) tally(`all 11 storage objects removed (orphan-free)`, true);

  // ── Assert: DB rows gone ──
  const { data: postsAfter } = await sb
    .from("posts")
    .select("id")
    .in("id", [carouselPostId, enhPostId]);
  tally(
    `post rows deleted (got ${postsAfter?.length ?? 0}, expected 0)`,
    !postsAfter || postsAfter.length === 0,
  );

  const { data: slidesAfter } = await sb
    .from("post_slides")
    .select("id")
    .eq("post_id", carouselPostId);
  tally(
    `post_slides cascade-removed (got ${slidesAfter?.length ?? 0}, expected 0)`,
    !slidesAfter || slidesAfter.length === 0,
  );

  const { data: versionsAfter } = await sb
    .from("post_versions")
    .select("id")
    .eq("post_id", carouselPostId);
  tally(
    `post_versions cascade-removed (got ${versionsAfter?.length ?? 0}, expected 0)`,
    !versionsAfter || versionsAfter.length === 0,
  );

  // The sweep is global; we asserted ≥ 2 of OUR rows were purged.
  tally(`runPurgeSweep() returned ≥ 2 (got ${purged})`, purged >= 2);

  console.log(
    `  Result: ${result.failed === 0 ? "PASS" : "FAIL"} (${result.passed}/${result.passed + result.failed})`,
  );
  return result;
}
// ── Mode A: empty case (always runs) ────────────────────────────────────────
async function testOverageBatchEmpty(userId: string): Promise<TestResult> {
  console.log("\n▶ Test: overage batch (empty case)");
  const sb = createAdminSupabase();
  const result: TestResult = {
    name: "overage batch (empty case)",
    passed: 0,
    failed: 0,
    skipped: false,
  };
  const tally = (label: string, ok: boolean, detail?: string) => {
    if (ok) {
      console.log(`  ✓ ${label}`);
      result.passed += 1;
    } else {
      console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
      result.failed += 1;
    }
  };

  // The handle_new_user_billing_profile trigger already created a row with
  // pending_overage_micros=0 when createTestUser ran. Belt-and-braces: explicitly upsert
  // pending_overage_micros=0 and stripe_customer_id=null so the user is skipped.
  const { error: upsertErr } = await sb.from("user_billing_profiles").upsert(
    {
      user_id: userId,
      pending_overage_micros: 0,
      stripe_customer_id: null,
      subscription_status: null,
    },
    { onConflict: "user_id" },
  );
  if (upsertErr) {
    tally(
      "zero pending_overage_micros for test user",
      false,
      upsertErr.message,
    );
    return result;
  }
  tally("zero pending_overage_micros for test user", true);

  // Snapshot ledger BEFORE so we can assert nothing was inserted FOR OUR USER.
  const { data: ledgerBefore } = await sb
    .from("billing_ledger")
    .select("id")
    .eq("user_id", userId);
  const before = ledgerBefore?.length ?? 0;

  // Invoke (the batch is global; other users may be processed; we only assert about OUR user).
  let invoked = false;
  let returnShape: Awaited<ReturnType<typeof runOverageBillingBatch>> | null =
    null;
  try {
    returnShape = await runOverageBillingBatch();
    invoked = true;
  } catch (err) {
    tally(
      "runOverageBillingBatch() did not throw",
      false,
      (err as Error).message,
    );
    return result;
  }
  tally("runOverageBillingBatch() did not throw", invoked);
  tally(
    `return shape has processed/charged/skipped`,
    returnShape !== null &&
      typeof returnShape.processed === "number" &&
      typeof returnShape.charged === "number" &&
      typeof returnShape.skipped === "number",
  );

  // Assert: NO ledger rows inserted for our user.
  const { data: ledgerAfter } = await sb
    .from("billing_ledger")
    .select("id")
    .eq("user_id", userId);
  const after = ledgerAfter?.length ?? 0;
  tally(
    `no billing_ledger rows added for test user (before=${before}, after=${after})`,
    after === before,
  );

  console.log(
    `  Result: ${result.failed === 0 ? "PASS" : "FAIL"} (${result.passed}/${result.passed + result.failed})`,
  );
  return result;
}

// ── Mode B: full Stripe path (sk_test_* gated) ──────────────────────────────
async function testOverageBatchFull(userId: string): Promise<TestResult> {
  console.log("\n▶ Test: overage batch (full Stripe path)");
  const sb = createAdminSupabase();
  const result: TestResult = {
    name: "overage batch (full Stripe path)",
    passed: 0,
    failed: 0,
    skipped: false,
  };
  const tally = (label: string, ok: boolean, detail?: string) => {
    if (ok) {
      console.log(`  ✓ ${label}`);
      result.passed += 1;
    } else {
      console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
      result.failed += 1;
    }
  };

  // Defensive re-check of the env (caller already gated, but make the function safe to call directly).
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) {
    result.skipped = true;
    console.log("  ⊘ Mode B requires STRIPE_SECRET_KEY=sk_test_*");
    return result;
  }

  // Lazy-import Stripe so Node doesn't try to instantiate it when the gate is closed.
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(key, { apiVersion: "2024-06-20" as any });

  let testCustomerId: string | null = null;
  try {
    // 1. Create test-mode Stripe customer with a default payment method that ALWAYS succeeds.
    //    Stripe test card 4242 4242 4242 4242 → use the magic test PaymentMethod 'pm_card_visa'.
    const customer = await stripe.customers.create({
      email: `cron-verify-${Date.now()}@xareable.test`,
      metadata: { source: "phase-15-verification-harness" },
    });
    testCustomerId = customer.id;
    const pm = await stripe.paymentMethods.attach("pm_card_visa", {
      customer: customer.id,
    });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: pm.id },
    });
    tally("created Stripe test customer + attached pm_card_visa", true);

    // 2. Upsert user_billing_profiles with pending_overage_micros=5_000_000 (5 USD,
    //    above default min-invoice 1_000_000 = 1 USD). Force overage_last_billed_at far in the
    //    past so the cadence-due gate passes.
    const longAgo = new Date(
      Date.now() - 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { error: upErr } = await sb.from("user_billing_profiles").upsert(
      {
        user_id: userId,
        stripe_customer_id: customer.id,
        subscription_status: "active",
        pending_overage_micros: 5_000_000,
        overage_last_billed_at: longAgo,
      },
      { onConflict: "user_id" },
    );
    if (upErr) {
      tally(
        "upsert billing profile with pending overage",
        false,
        upErr.message,
      );
      return result;
    }
    tally(
      "upsert billing profile (pending=5M micros, status=active, customer attached)",
      true,
    );

    // 3. Invoke
    const before = await sb
      .from("billing_ledger")
      .select("id, entry_type")
      .eq("user_id", userId);
    const ret = await runOverageBillingBatch();
    tally("runOverageBillingBatch() did not throw", true);

    // 4. Assert return shape (charged ≥ 1 — the batch is global so other users may be charged too).
    tally(`charged ≥ 1 (got ${ret.charged})`, ret.charged >= 1);

    // 5. Assert pending_overage_micros reset.
    const { data: profileAfter } = await sb
      .from("user_billing_profiles")
      .select("pending_overage_micros, overage_last_billed_at")
      .eq("user_id", userId)
      .single();
    tally(
      `pending_overage_micros reset to 0 (got ${profileAfter?.pending_overage_micros ?? "null"})`,
      profileAfter?.pending_overage_micros === 0,
    );
    tally(
      `overage_last_billed_at advanced past seed value`,
      !!profileAfter?.overage_last_billed_at &&
        profileAfter.overage_last_billed_at !== longAgo,
    );

    // 6. Assert two new ledger rows for our user (entry_type 'overage_invoice' + 'overage_payment').
    const { data: ledgerAfter } = await sb
      .from("billing_ledger")
      .select("id, entry_type")
      .eq("user_id", userId);
    const beforeIds = new Set((before.data ?? []).map((r) => r.id));
    const newRows = (ledgerAfter ?? []).filter((r) => !beforeIds.has(r.id));
    const types = new Set(newRows.map((r) => r.entry_type));
    tally(`new ledger rows include 'overage_invoice'`, types.has("overage_invoice"));
    tally(`new ledger rows include 'overage_payment'`, types.has("overage_payment"));
  } finally {
    // Clean up the Stripe test customer (test mode — safe to delete).
    if (testCustomerId) {
      try {
        await stripe.customers.del(testCustomerId);
        console.log(`  → deleted Stripe test customer ${testCustomerId}`);
      } catch (e) {
        console.error(
          `  ⚠ Stripe test customer cleanup failed: ${(e as Error).message}`,
        );
      }
    }
  }

  console.log(
    `  Result: ${result.failed === 0 ? "PASS" : "FAIL"} (${result.passed}/${result.passed + result.failed})`,
  );
  return result;
}

// Reference helpers not yet wired in by later tasks (keeps type-check green between tasks).
void assert;
void fmtResult;

// ── Orchestrator stub (real body in Task 5) ─────────────────────────────────
async function main(): Promise<void> {
  const testUserId = await createTestUser();
  try {
    console.log("(test bodies wired in subsequent tasks)");
    void testTrashSweep;
    void testPurgeSweep;
    void testOverageBatchEmpty;
    void testOverageBatchFull;
  } finally {
    await cleanupTestUser(testUserId);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-cron-jobs.ts: unhandled error:", err);
  process.exit(1);
});
