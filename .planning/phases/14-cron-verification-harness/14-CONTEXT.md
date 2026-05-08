# Phase 14: Cron Verification Harness - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Direct authoring from REQUIREMENTS.md VRFY-01 + reading actual cron service implementations

<domain>
## Phase Boundary

Build a runtime verification harness — `scripts/verify-cron-jobs.ts` — that exercises the three destructive scheduled jobs shipped in Phase 11 + 12 against deterministic seeded test data and asserts their observable side effects. Closes the UAT gap for cron operations that were never exercised in production-like conditions.

**In scope:**
- New script: `scripts/verify-cron-jobs.ts`
- Seeds test data into `posts`, `post_slides`, `post_versions`, `user_billing_profiles`, `billing_ledger` tables and Supabase Storage (`user_assets/` paths)
- Directly imports and invokes `runTrashSweep()`, `runPurgeSweep()`, `runOverageBillingBatch()` (NOT via cron schedule — direct call so verification is deterministic)
- Asserts observable side effects after each invocation
- ALWAYS cleans up seeded data, even on assertion failure (try/finally pattern)
- Exits 0 only when all enabled checks pass; non-zero with itemized failure report otherwise

**Out of scope:**
- Live Stripe / GA4 / Facebook integration testing — explicitly deferred to SEED-002
- Modifying any cron service code (Phase 11 + 12 are sealed; this only verifies them)
- New tables or migrations
- CI/CD integration (the harness is run manually for now; future automation is its own concern)

</domain>

<decisions>
## Implementation Decisions

### Test isolation — dedicated test user + deterministic markers

- **Seeding strategy:** create a dedicated test user at the start of the run via `supabase.auth.admin.createUser` with a deterministic email pattern: `cron-verify-${timestamp}@xareable.test`. All seeded posts/slides/versions/profiles belong to this user. At end of run, delete the user (cascade removes all owned rows). NEVER mix seeded data with real users.
- **Why this approach:** clean isolation, no contamination risk, simple cleanup contract (delete user → cascade everything).
- **Alternative rejected:** marking real-user data with metadata flags. Too easy to leave stragglers.
- **Cleanup guarantee:** wrap the entire verification in `try { ... } finally { await cleanupTestUser(testUserId); }`. Cleanup runs even on test failure or unhandled exception.

### Trash sweep verification (always runs)

- **Seed:** insert 2 posts owned by test user with `expires_at = now() - 1 day` and `trashed_at = null` (eligible for trash sweep). Insert 1 control post with `expires_at = now() + 30 days` (NOT eligible — must remain untouched).
- **Invoke:** `await runTrashSweep()`
- **Assert:**
  1. The 2 eligible posts now have `trashed_at IS NOT NULL`
  2. The control post still has `trashed_at IS NULL`
  3. No DB rows deleted (sweep only updates `trashed_at`, never deletes)
  4. The return value of `runTrashSweep()` (count of swept posts) equals 2

### Purge sweep verification (always runs)

- **Seed:** insert 1 post owned by test user with `trashed_at = now() - (TRASH_RETENTION_DAYS + 1) days` and full storage objects:
  - Image at `user_assets/{userId}/{postId}.webp` (small valid PNG buffer is fine)
  - Thumbnail at `user_assets/{userId}/thumbnails/{postId}.webp`
  - 2 slide rows in `post_slides` with their own image + thumbnail storage objects
  - 1 version row in `post_versions` with image + thumbnail
  - For carousel/enhancement coverage, ALSO seed 1 enhancement post with its source file at `user_assets/{userId}/{postId}-source.webp`
- **Invoke:** `await runPurgeSweep()`
- **Assert (storage-then-DB ordering, per Phase 11 contract):**
  1. All seeded storage objects are gone (verify with `supabase.storage.from("user_assets").list(...)` or per-object existence check)
  2. Post DB rows are deleted
  3. Cascade-removed: no orphan `post_slides` or `post_versions` rows for the purged post
  4. The return value of `runPurgeSweep()` (purged count) equals number of seeded over-retention posts
  5. Non-eligible posts (e.g., recently-trashed posts in the test data, if any) are NOT touched

### Overage batch verification (TWO modes)

The overage batch function (`server/stripe.ts:527 runOverageBillingBatch`) is inherently coupled to Stripe — it calls `stripe.invoiceItems.create`, `stripe.invoices.create`, `stripe.invoices.finalizeInvoice`, `stripe.invoices.pay`. There is no compute-only path; an integration with Stripe is unavoidable for full verification.

**Mode A — Empty-case test (always runs):**
- **Seed:** ensure NO `user_billing_profiles` rows match the criteria (`pending_overage_micros > 0` for the test user — explicitly set to 0 or skip seeding)
- **Invoke:** `await runOverageBillingBatch()`
- **Assert:**
  1. Function returns `{ processed: 0, charged: 0, skipped: 0 }` (or processed > 0 only if seeded scenario matches; for the empty case, all-zeros)
  2. No `billing_ledger` rows inserted for the test user
  3. Function doesn't throw

**Mode B — Full Stripe path (only runs when `STRIPE_SECRET_KEY` starts with `sk_test_`):**
- If env not set or starts with `sk_live_`, log SKIPPED with a clear message: "Overage Stripe path skipped — set STRIPE_SECRET_KEY=sk_test_* to enable" and continue.
- If test creds present:
  - **Seed:** create test Stripe customer for the test user (Stripe API), upsert `user_billing_profiles` with `stripe_customer_id` + `subscription_status = "active"` + `pending_overage_micros = 5_000_000` (5 USD, above default min-invoice).
  - **Invoke:** `await runOverageBillingBatch()`
  - **Assert:**
    1. Return value: `{ processed: 1, charged: 1, skipped: 0 }`
    2. `pending_overage_micros` reset to 0
    3. `overage_last_billed_at` updated to a recent timestamp
    4. Two `billing_ledger` rows inserted for the test user: one `overage_invoice`, one `overage_payment`
  - **Cleanup also deletes the Stripe test customer.**

This mode-split is justified in the SUMMARY.md as: "VRFY-01 verifies what's verifiable without external creds; SEED-002 picks up the rest."

### Script structure

```typescript
// scripts/verify-cron-jobs.ts
async function main() {
  const testUserId = await createTestUser();
  let exitCode = 0;
  try {
    exitCode |= await testTrashSweep(testUserId);
    exitCode |= await testPurgeSweep(testUserId);
    exitCode |= await testOverageBatchEmpty(testUserId);
    if (process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      exitCode |= await testOverageBatchFull(testUserId);
    } else {
      console.log("⊘ Overage Stripe path SKIPPED (no STRIPE_SECRET_KEY=sk_test_*)");
    }
  } finally {
    await cleanupTestUser(testUserId);
  }
  process.exit(exitCode);
}
main().catch((err) => { console.error(err); process.exit(1); });
```

### Output format

- Each test prints a header (`▶ Test: trash sweep`), green check (`  ✓ assertion`) or red X (`  ✗ assertion + reason`), and a result line (`Result: PASS` / `FAIL`).
- Final line: `verify-cron-jobs.ts: N tests, M passed, K failed, S skipped`.
- Non-zero exit if any FAIL.

### Claude's Discretion
- Specific size of the seed PNG buffers (any small valid image works; can be 1x1 transparent)
- Whether to log seeded IDs for debug visibility (recommended)
- Exact assertion library (custom `assert(cond, msg)` is fine — don't add Jest just for this)
- Whether to support a `--keep-seed` CLI flag for manual inspection (nice-to-have, not required)

</decisions>

<canonical_refs>
## Canonical References

### Existing harness patterns to follow
- [scripts/verify-phase-11.ts](scripts/verify-phase-11.ts) — STATIC verification (grep + file checks). Phase 14 harness is RUNTIME verification (seed + invoke + assert), so the structure differs but the output format conventions can be borrowed (`ok` / `FAIL` markers, exit-code accumulation).
- [scripts/verify-phase-05.ts](scripts/verify-phase-05.ts) and [scripts/verify-phase-06.ts](scripts/verify-phase-06.ts) — earlier verification patterns
- [.planning/phases/11-post-trash-and-automated-cleanup/11-RESEARCH.md](.planning/phases/11-post-trash-and-automated-cleanup/11-RESEARCH.md) — research that established the cron architecture

### Cron functions being verified (do NOT modify)
- [server/services/cleanup-cron.service.ts](server/services/cleanup-cron.service.ts) — exports `runTrashSweep()`, `runPurgeSweep()`, `resolveOverageCronExpression()`, `startCronJobs()`. Phase 14 imports the first two directly.
- [server/stripe.ts:527](server/stripe.ts:527) — `runOverageBillingBatch()` definition. Returns `{ processed, charged, skipped }`.

### Schema references
- `posts` table: columns `id`, `user_id`, `content_type`, `image_url`, `thumbnail_url`, `slide_count`, `expires_at`, `trashed_at`, `created_at`
- `post_slides` table: `id`, `post_id`, `slide_number`, `image_url`, `thumbnail_url`
- `post_versions` table: `id`, `post_id`, `version_number`, `image_url`, `thumbnail_url`
- `user_billing_profiles` table: `user_id`, `stripe_customer_id`, `subscription_status`, `pending_overage_micros`, `overage_last_billed_at`
- `billing_ledger` table: `user_id`, `entry_type`, `amount_micros`, `pending_overage_after_micros`, `stripe_invoice_id`, `metadata`, `created_at`
- `TRASH_RETENTION_DAYS` constant exported from [shared/schema.ts](shared/schema.ts)

### Storage path conventions
- Images: `user_assets/{userId}/{postId}.webp` and `user_assets/{userId}/thumbnails/{postId}.webp`
- Enhancement source: `user_assets/{userId}/{postId}-source.webp` (sibling derivation in `cleanup-cron.service.ts:35`)
- Slides: same pattern, with slide-specific suffix per existing convention

### Auth + Supabase clients
- [server/supabase.ts](server/supabase.ts) — `createAdminSupabase()` for cross-user writes (service role)
- Test user creation via `supabase.auth.admin.createUser({ email, email_confirm: true })`
- Test user deletion via `supabase.auth.admin.deleteUser(userId)` (cascades through all owned tables thanks to `ON DELETE CASCADE`)

### Project conventions
- [CLAUDE.md](CLAUDE.md) — TypeScript, Express, Supabase, no new deps without justification
- Run with: `npx tsx scripts/verify-cron-jobs.ts`

</canonical_refs>

<specifics>
## Specific Ideas

### Seed-test-user helper

```typescript
async function createTestUser(): Promise<string> {
  const sb = createAdminSupabase();
  const email = `cron-verify-${Date.now()}@xareable.test`;
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`);
  console.log(`  → seeded test user: ${email} (${data.user.id})`);
  return data.user.id;
}

async function cleanupTestUser(userId: string): Promise<void> {
  const sb = createAdminSupabase();
  // Storage objects under user_assets/{userId}/* — list and remove in chunks
  const { data: storageObjects } = await sb.storage.from("user_assets").list(userId);
  if (storageObjects?.length) {
    const paths = storageObjects.map((o) => `${userId}/${o.name}`);
    await sb.storage.from("user_assets").remove(paths);
  }
  // Recursive: thumbnails subfolder
  const { data: thumbObjects } = await sb.storage.from("user_assets").list(`${userId}/thumbnails`);
  if (thumbObjects?.length) {
    const paths = thumbObjects.map((o) => `${userId}/thumbnails/${o.name}`);
    await sb.storage.from("user_assets").remove(paths);
  }
  // Auth user delete cascades through posts/post_slides/post_versions/user_billing_profiles/billing_ledger
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) console.error(`  ⚠ test user delete failed: ${error.message}`);
  else console.log(`  → cleaned up test user ${userId}`);
}
```

### Storage seeding helper

```typescript
async function uploadTestImage(path: string): Promise<string> {
  const sb = createAdminSupabase();
  // 1x1 transparent PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const { error } = await sb.storage.from("user_assets").upload(path, png, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
  const { data } = sb.storage.from("user_assets").getPublicUrl(path);
  return data.publicUrl;
}
```

### Trash sweep test sketch

```typescript
async function testTrashSweep(userId: string): Promise<number> {
  console.log("\n▶ Test: trash sweep");
  const sb = createAdminSupabase();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Seed 2 eligible + 1 control
  const { data: seeded } = await sb.from("posts").insert([
    { user_id: userId, content_type: "image", image_url: "test://1", expires_at: yesterday, trashed_at: null },
    { user_id: userId, content_type: "image", image_url: "test://2", expires_at: yesterday, trashed_at: null },
    { user_id: userId, content_type: "image", image_url: "test://3", expires_at: future, trashed_at: null },
  ]).select("id, expires_at");

  // Invoke
  const swept = await runTrashSweep();

  // Assert
  let failed = 0;
  const { data: after } = await sb.from("posts").select("id, trashed_at").in("id", seeded!.map((s) => s.id));
  const trashedIds = new Set(after!.filter((p) => p.trashed_at !== null).map((p) => p.id));
  const eligibleIds = seeded!.filter((s) => s.expires_at === yesterday).map((s) => s.id);
  const controlId = seeded!.find((s) => s.expires_at === future)!.id;

  for (const id of eligibleIds) {
    if (!trashedIds.has(id)) {
      console.log(`  ✗ eligible post ${id} not trashed`);
      failed++;
    } else {
      console.log(`  ✓ eligible post ${id} trashed`);
    }
  }
  if (trashedIds.has(controlId)) {
    console.log(`  ✗ control post ${controlId} was incorrectly trashed`);
    failed++;
  } else {
    console.log(`  ✓ control post ${controlId} preserved`);
  }
  if (swept !== 2) {
    console.log(`  ✗ expected runTrashSweep to report 2, got ${swept}`);
    failed++;
  } else {
    console.log(`  ✓ runTrashSweep returned 2`);
  }

  console.log(`  Result: ${failed === 0 ? "PASS" : "FAIL"}`);
  return failed === 0 ? 0 : 1;
}
```

(The plan should produce similar sketches for purge and overage tests.)

### Mode-B Stripe gating

```typescript
const stripeKey = process.env.STRIPE_SECRET_KEY;
const isTestMode = stripeKey?.startsWith("sk_test_");
if (isTestMode) {
  exitCode |= await testOverageBatchFull(testUserId);
} else {
  console.log("\n⊘ Test: overage batch (Stripe full path) — SKIPPED");
  console.log("  → set STRIPE_SECRET_KEY=sk_test_* to enable this test");
  console.log("  → covered separately by SEED-002 (live billing E2E harness)");
}
```

</specifics>

<deferred>
## Deferred Ideas

- CI/CD integration (run on every push) — defer; manual invocation is fine for now
- Webhook-side verification for Stripe (e.g., assert webhook handler reconciles after `invoice.paid`) — that's SEED-002 scope
- Property-based fuzzing of seeding scenarios — overkill for v1.2
- Performance benchmarks (how long does each sweep take?) — different concern, separate phase if it ever matters
- Multi-instance / concurrency tests — single-instance assumption locked in by Phase 11/12 decisions
- A `--keep-seed` flag to leave seeded data for manual inspection — could add later if debugging the harness gets painful

</deferred>

---

*Phase: 14-cron-verification-harness*
*Context gathered: 2026-05-08*
