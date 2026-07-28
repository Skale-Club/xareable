# Phase 11: Post Trash & Automated Cleanup - Research

**Researched:** 2026-05-06
**Domain:** Soft-delete lifecycle, server-side cron, Supabase Storage bulk deletion, React gallery filtering
**Confidence:** HIGH

---

## Summary

Phase 11 adds a two-stage expiry lifecycle to posts: expired posts (after 30 days) are soft-deleted into a trash bin by setting `trashed_at`, then permanently purged (DB row + all storage files) after another 30 days in trash. A `/trash` route lets users see, restore, or force-delete trashed posts. Automation runs entirely server-side — no admin HTTP call is needed.

The project has no cron library installed. `node-cron` v4.2.1 is the standard choice for this Express/tsx stack; pg_cron is technically available on Supabase free tier but introduces a dependency on a Supabase-specific extension and cannot be verified without live credentials. The server-cron approach (node-cron started inside `server/index.ts`) is simpler, self-contained, and fully consistent with the project's existing service architecture.

The existing `POST /api/posts/cleanup` endpoint hard-deletes posts where `expires_at <= now()` with no trash stage. Phase 11 replaces that logic with a two-phase flow: a trash sweep (set `trashed_at`) and a purge sweep (delete DB row + storage). Both sweeps are invoked by the cron scheduler, not by HTTP endpoints.

**Primary recommendation:** Use `node-cron` for automated scheduling. Add a single `trashed_at TIMESTAMPTZ` column to `posts` via a new Supabase migration. Run two cron jobs inside `server/lib/cron.ts` started from `server/index.ts` after the HTTP server binds. Filter the gallery by `trashed_at IS NULL` at the Supabase query level — no RLS change needed.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRSH-01 | Posts auto-moved to trash when `expires_at <= now()` — `trashed_at` set, disappear from gallery | node-cron trash sweep sets `trashed_at = now()` where `expires_at <= now() AND trashed_at IS NULL`; gallery query adds `.is('trashed_at', null)` filter |
| TRSH-02 | Posts in trash 30+ days permanently deleted — DB row removed, all storage deleted, version_cleanup_log resolved | node-cron purge sweep fetches posts where `trashed_at <= now() - interval '30 days'`, deletes storage files (image, thumbnail, slides, enhancement source), then deletes DB row (CASCADE handles slides + versions) |
| TRSH-03 | `/trash` route lists trashed posts with days-remaining, sorted by `trashed_at DESC` | New page queries posts where `trashed_at IS NOT NULL`, computes `30 - floor((now - trashed_at) / day)` client-side |
| TRSH-04 | User can restore a post — `trashed_at` cleared, `expires_at` reset to `now() + 30 days` | `PATCH /api/posts/:id/restore` sets `trashed_at = null, expires_at = now() + 30 days` via admin client |
| TRSH-05 | User can force-delete a post from trash — storage + DB row removed immediately | `DELETE /api/posts/:id` extended with trash-aware storage path collection; or a dedicated `DELETE /api/posts/:id/permanent` |
| TRSH-06 | Automated cleanup runs on schedule without any HTTP request to `/api/posts/cleanup` | Two cron schedules registered in `server/lib/cron.ts`; existing `/api/posts/cleanup` endpoint kept for backwards compatibility but is not invoked by the scheduler |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-cron | 4.2.1 | Server-side cron scheduling | Zero dependencies, pure JS, direct ESM import, active maintenance (v4.0.0 May 2025) |
| @supabase/supabase-js | already installed (^2.98.0) | DB mutations + storage deletion | Already in project; admin client used for cross-user writes |

### Not Needed
| Excluded | Reason |
|----------|--------|
| pg_cron (Supabase extension) | Requires Supabase dashboard config, adds infrastructure dependency, no gain over server cron for this use case |
| node-schedule | Heavier API; node-cron is simpler for fixed interval jobs |
| setInterval | Not timezone-aware, no cron expression support, resets on server restart without wall-clock alignment |

**Installation:**
```bash
npm install node-cron
npm install --save-dev @types/node-cron
```

**Version verification:** `npm view node-cron version` → `4.2.1` (confirmed 2026-05-06)

---

## Architecture Patterns

### Recommended Project Structure Changes
```
server/
├── lib/
│   └── cron.ts              # NEW — registers and starts all cron jobs
├── services/
│   └── trash-cleanup.service.ts  # NEW — trash sweep + purge sweep logic
├── routes/
│   ├── posts.routes.ts      # MODIFY — add /restore endpoint + gallery filter
│   └── trash.routes.ts      # NEW — GET /api/trash, DELETE /api/posts/:id/permanent
├── index.ts                 # MODIFY — call startCronJobs() after server.listen()
client/src/
├── pages/
│   └── trash.tsx            # NEW — /trash route
```

### Pattern 1: Server Cron Startup

node-cron v4 ships with a default ESM export. Call `startCronJobs()` inside the `httpServer.listen()` callback so jobs only start after the port is bound (avoids running jobs on failed starts).

```typescript
// server/lib/cron.ts
import cron from "node-cron";
import { runTrashSweep, runPurgeSweep } from "../services/trash-cleanup.service.js";

export function startCronJobs(): void {
  // Move expired posts to trash — runs every hour
  cron.schedule("0 * * * *", async () => {
    console.log("[Cron] Trash sweep starting");
    try {
      const count = await runTrashSweep();
      if (count > 0) console.log(`[Cron] Trash sweep: ${count} post(s) trashed`);
    } catch (err) {
      console.error("[Cron] Trash sweep failed:", err);
    }
  });

  // Permanently purge old trash — runs once daily at 03:00 UTC
  cron.schedule("0 3 * * *", async () => {
    console.log("[Cron] Purge sweep starting");
    try {
      const count = await runPurgeSweep();
      if (count > 0) console.log(`[Cron] Purge sweep: ${count} post(s) purged`);
    } catch (err) {
      console.error("[Cron] Purge sweep failed:", err);
    }
  });

  console.log("[Cron] Jobs registered: trash-sweep (hourly), purge-sweep (daily 03:00 UTC)");
}
```

```typescript
// server/index.ts — inside httpServer.listen() callback
import { startCronJobs } from "./lib/cron.js";
httpServer.listen(port, "0.0.0.0", () => {
  log(`serving on port ${port}`);
  startCronJobs();  // ADD THIS LINE
});
```

### Pattern 2: Trash Sweep Service

The sweep uses the admin Supabase client (bypasses RLS). It targets posts where `expires_at <= now()` AND `trashed_at IS NULL`, then sets `trashed_at = now()`. The existing `delete_expired_posts()` DB function is NOT called — the cron replaces its job.

```typescript
// server/services/trash-cleanup.service.ts
import { createAdminSupabase } from "../supabase.js";

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
```

### Pattern 3: Purge Sweep — Storage Before DB Delete

Storage deletion MUST happen before the DB row is deleted. If the DB delete succeeds but storage delete fails, files are orphaned. Collect all file paths first, delete storage, then delete DB row. Use the existing `extractPathFromUrl` pattern already present in `posts.routes.ts` and `storage-cleanup.service.ts`.

The purge sweep must handle:
- `posts.image_url` + `posts.thumbnail_url`
- All `post_versions` rows (image_url + thumbnail_url)
- All `post_slides` rows (image_url + thumbnail_url)
- Enhancement source file: `image_url` with `.webp` replaced by `-source.webp`

```typescript
export async function runPurgeSweep(): Promise<number> {
  const supabase = createAdminSupabase();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, image_url, thumbnail_url, content_type")
    .not("trashed_at", "is", null)
    .lte("trashed_at", cutoff);

  if (error) throw error;
  if (!posts || posts.length === 0) return 0;

  for (const post of posts) {
    await purgeOnePost(supabase, post);
  }
  return posts.length;
}
```

### Pattern 4: Gallery Exclusion (DB Query Filter)

The gallery query in `client/src/pages/posts.tsx` currently selects from `posts` without any trash filter. After adding `trashed_at`, the filter `.is("trashed_at", null)` must be added to both the count query and the posts query. This is the correct approach — not an RLS policy change, because users need to read their own trashed posts for the `/trash` view.

The count query in `posts.routes.ts` (server-side) and the direct Supabase query in `posts.tsx` (client-side) both need the filter. Pattern: add `.is("trashed_at", null)` to every `from("posts").select(...)` call in the gallery context.

### Pattern 5: Restore Endpoint

```typescript
// PATCH /api/posts/:id/restore
// Sets trashed_at = null, expires_at = now() + 30 days
router.patch("/api/posts/:id/restore", async (req, res) => {
  // authenticate, verify ownership
  const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await adminSb
    .from("posts")
    .update({ trashed_at: null, expires_at: newExpiresAt })
    .eq("id", id)
    .eq("user_id", user.id);
  // invalidate gallery cache on client via response
});
```

### Pattern 6: Force-Delete from Trash

Reuse the existing `DELETE /api/posts/:id` logic — it already collects storage paths, deletes storage, then deletes the DB row. The only addition needed is ensuring the post's `trashed_at IS NOT NULL` (already in trash) before allowing this deletion path, OR simply extend the existing DELETE to work regardless of trash status (simpler). The existing endpoint already handles cascade + storage cleanup, so extending it is the cleanest path.

### Anti-Patterns to Avoid

- **Using RLS to hide trashed posts:** Would block the `/trash` view without a separate RLS policy. API-level filter is simpler and already the pattern.
- **Calling `delete_expired_posts()` DB function from cron:** The existing function hard-deletes immediately; trash requires a soft-delete. The DB function must be bypassed, not called.
- **Running purge sweep before trash sweep:** Purge only targets rows where `trashed_at IS NOT NULL`; trash sweep must have run first to populate that column.
- **Batch storage deletion with >1000 files:** Supabase Storage `remove()` accepts an array; batch in chunks of 100 to avoid payload limits.
- **Setting cron job interval to seconds in production:** Hourly trash sweep and daily purge are sufficient; sub-minute intervals waste resources on this use case.

---

## DB Migration Requirements

### New Column
```sql
-- Add to posts table
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_posts_trashed_at
  ON public.posts (trashed_at)
  WHERE trashed_at IS NOT NULL;
```

No RLS changes needed. Existing user-scoped RLS (`user_id = auth.uid()`) already covers trashed posts correctly for the restore/trash-view flow. The admin client bypasses RLS for cron operations.

### Schema Extension (shared/schema.ts)
Add `trashed_at` to `postSchema` and `postGalleryItemSchema`:
```typescript
trashed_at: z.string().nullable().optional(),
```

Add a new `trashedPostSchema` for the trash view response (includes `days_remaining` computed at API or client level).

### Existing DB Functions
- `delete_expired_posts()` — already exists, becomes UNUSED after this phase (the cron replaces it). Do not drop it; it's referenced nowhere critical and is harmless.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | Custom setInterval with wall-clock drift | node-cron | setInterval does not survive server restarts with correct alignment; node-cron handles DST, leap seconds |
| Storage path extraction | New URL parser | `extractPathFromUrl()` — already in `posts.routes.ts` and `storage-cleanup.service.ts` | Identical logic already exists; extract to shared helper |
| Storage bulk delete | Loop with individual remove() calls | `supabase.storage.from("user_assets").remove([...paths])` | Single round-trip; already used in existing cleanup endpoint |
| Days remaining calculation | DB computed column | Client-side arithmetic: `30 - Math.floor((Date.now() - new Date(trashed_at).getTime()) / 86400000)` | Simple, no schema change |

---

## Common Pitfalls

### Pitfall 1: Storage Deleted After DB Row Gone
**What goes wrong:** If DB row is deleted first and the storage delete fails, files are permanently orphaned.
**Why it happens:** Storage and DB are separate systems; no transaction spans both.
**How to avoid:** Always delete storage files first in purge sweep. If storage delete fails, log error and skip DB delete for that post (leave it for next sweep run).
**Warning signs:** Supabase Storage objects accumulating without matching DB rows.

### Pitfall 2: Gallery Count Includes Trashed Posts
**What goes wrong:** The count query does not filter by `trashed_at IS NULL`, so pagination math is wrong even if row display is filtered.
**Why it happens:** The count query and data query are separate; easy to update one and miss the other.
**How to avoid:** Add `.is("trashed_at", null)` to BOTH the count query and the data query in both `posts.routes.ts` (server) and `posts.tsx` (client).

### Pitfall 3: Posts Trashed During Server Downtime Accumulate
**What goes wrong:** If the server is down for > 30 days, many posts accumulate in trash. On restart, purge sweep attempts to delete all at once and times out.
**Why it happens:** Batch size is unbounded.
**How to avoid:** Implement a batch size cap in `runPurgeSweep()` (e.g., process at most 50 posts per run) and log when the batch is capped.

### Pitfall 4: Restoring a Post with an Expired `expires_at`
**What goes wrong:** User restores a post; `trashed_at` is cleared but `expires_at` is still in the past, so the next trash sweep immediately re-trashes it.
**Why it happens:** Restore only clears `trashed_at` without resetting `expires_at`.
**How to avoid:** Restore endpoint always sets `expires_at = now() + 30 days` atomically with `trashed_at = null`.

### Pitfall 5: node-cron Started Before Server Binds Port
**What goes wrong:** A job fires before the HTTP server is ready, causing a crash or incorrect state.
**Why it happens:** `startCronJobs()` called before `listen()` callback.
**How to avoid:** Call `startCronJobs()` inside the `httpServer.listen(port, host, () => { ... })` callback, as shown in Pattern 1.

### Pitfall 6: Slide Cleanup Missing From Purge Sweep
**What goes wrong:** Carousel post is purged from DB (with CASCADE deleting `post_slides` rows), but the slide image files in Storage are not deleted — they are orphaned.
**Why it happens:** The purge sweep only collects `posts.image_url` + `posts.thumbnail_url`; slide URLs are in `post_slides`.
**How to avoid:** Before deleting the DB row, join `post_slides` for carousel posts to collect all slide `image_url` + `thumbnail_url` paths. The existing `log_post_slide_cleanup` trigger only fires on explicit DELETE of slide rows, not when the parent post is deleted by the cron without first manually deleting slides.

**Key insight:** The `ON DELETE CASCADE` from `posts` to `post_slides` deletes the rows in the DB but does NOT fire the `log_post_slide_cleanup` trigger (row-level triggers fire for each deleted row including cascades in PostgreSQL — VERIFY this assumption; see Open Questions).

---

## Code Examples

### Registering Cron Jobs (node-cron v4 ESM)
```typescript
// Source: https://github.com/node-cron/node-cron (v4.0.0, May 2025)
import cron from "node-cron";

// Runs every hour at minute 0
cron.schedule("0 * * * *", callback);

// Runs daily at 03:00 UTC
cron.schedule("0 3 * * *", callback);
```

### Supabase Soft-Delete (update trashed_at)
```typescript
// Source: @supabase/supabase-js v2 — update with filter
const { data, error } = await supabase
  .from("posts")
  .update({ trashed_at: new Date().toISOString() })
  .lte("expires_at", new Date().toISOString())
  .is("trashed_at", null)
  .select("id");
```

### Gallery Filter for Trashed Posts
```typescript
// Add to every gallery SELECT — both count and data queries
sb.from("posts")
  .select("id", { count: "exact", head: true })
  .eq("user_id", user.id)
  .is("trashed_at", null)   // ADD THIS
```

### Trash View Query
```typescript
// Fetch trashed posts for /trash route
sb.from("posts")
  .select("id, created_at, image_url, thumbnail_url, content_type, slide_count, trashed_at, caption")
  .eq("user_id", user.id)
  .not("trashed_at", "is", null)
  .order("trashed_at", { ascending: false })
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hard-delete expired posts via admin HTTP endpoint | Two-phase soft-delete with server-side cron | Phase 11 | Users get 30-day trash window; no manual admin action |
| `delete_expired_posts()` DB function | Unused after Phase 11 (cron replaces it) | Phase 11 | DB function stays in place but is not called |

**Deprecated/outdated:**
- `POST /api/posts/cleanup`: The admin endpoint stays in the codebase for backwards compat but is no longer the automation mechanism. TRSH-06 specifically requires zero HTTP calls for automation.

---

## Open Questions

1. **Does PostgreSQL CASCADE trigger the `log_post_slide_cleanup` row-level trigger?**
   - What we know: The trigger is `BEFORE DELETE ON post_slides FOR EACH ROW`. In PostgreSQL, row-level triggers DO fire for rows deleted by CASCADE. This is standard PostgreSQL behavior (confirmed in Postgres docs: "Row-level triggers fired on a CASCADE DELETE will fire for each deleted row").
   - What's unclear: Whether Supabase's connection pooler or RLS wrapper alters this behavior.
   - Recommendation: The purge sweep should collect slide paths explicitly (join `post_slides` before deleting the parent post) to guarantee storage cleanup regardless of trigger behavior. This is safer than relying on trigger + `version_cleanup_log` drain.
   - **Confidence: MEDIUM** — PostgreSQL spec says yes, but explicit path collection is the safe path.

2. **Should `trashed_at` be visible to the user-scoped Supabase client?**
   - What we know: The existing RLS for `posts` allows users to SELECT their own rows (`user_id = auth.uid()`). Adding `trashed_at` to the SELECT list requires no RLS change — the policy already permits it.
   - Recommendation: Use `trashed_at` in the client query for the trash view; it is safe under existing RLS.
   - **Confidence: HIGH**

3. **pg_cron as alternative to node-cron?**
   - What we know: pg_cron is technically available on Supabase free tier (confirmed via GitHub discussions and Supabase docs). It runs SQL functions on a schedule. It can call `delete_expired_posts()` or a new purge function.
   - Why not chosen: (a) Requires enabling the extension via Supabase dashboard — not captured in migration SQL. (b) Storage deletion cannot be done from a SQL function — it requires calling the Supabase Storage API, which is not accessible from pg_cron SQL snippets. (c) The two-phase soft-delete + storage purge requires application-level code, not SQL alone. pg_cron cannot handle the storage deletion step.
   - **Decision: Use node-cron. pg_cron cannot delete Supabase Storage objects; it is not viable for TRSH-02.**
   - **Confidence: HIGH**

---

## Environment Availability

Step 2.6: All dependencies are Node.js packages or existing Supabase infrastructure. node-cron is not yet installed — the planner must include an install step.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node-cron | Automated cleanup scheduling | Not installed | — (latest: 4.2.1) | — (required) |
| @types/node-cron | TypeScript types | Not installed | — | — (required for dev) |
| @supabase/supabase-js | DB mutations + storage | Already installed | ^2.98.0 | — |
| Supabase admin client | Cross-user writes for cron | Already in project | — | — |

**Missing dependencies with no fallback:**
- `node-cron` — must be installed before implementing cron service. `npm install node-cron && npm install --save-dev @types/node-cron`

---

## Validation Architecture

`workflow.nyquist_validation` key is absent from `.planning/config.json` — treat as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no jest.config, vitest.config, or test directory found |
| Config file | None — Wave 0 must establish if automated tests are added |
| Quick run | Manual: run dev server, simulate past `expires_at`, verify trash sweep |
| Full suite | Manual E2E: trash sweep + purge sweep + restore flow + gallery filter |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRSH-01 | Post with `expires_at` in past is trashed on next sweep | manual-smoke | — | — |
| TRSH-02 | Post with `trashed_at` 31 days ago is purged (DB + storage) | manual-smoke | — | — |
| TRSH-03 | `/trash` shows trashed posts, days-remaining, sorted correctly | manual-UI | — | — |
| TRSH-04 | Restore clears `trashed_at`, resets `expires_at`, post reappears in gallery | manual-UI | — | — |
| TRSH-05 | Force-delete from trash removes storage + DB row immediately | manual-UI | — | — |
| TRSH-06 | Cleanup fires without HTTP call to `/api/posts/cleanup` | manual-smoke | — | — |

### Wave 0 Gaps
- No automated test infrastructure in project. All verification is manual smoke testing via `POST /api/debug/run-trash-sweep` (a temporary debug endpoint in dev mode) or direct Supabase row manipulation to simulate time passage.

*(Note: The project has no existing test infrastructure. Manual verification is the established pattern for this codebase based on prior phases.)*

---

## Sources

### Primary (HIGH confidence)
- github.com/node-cron/node-cron — v4.0.0 released May 2025; ESM default import confirmed; cron expression format confirmed
- npm registry — `node-cron@4.2.1` current version as of 2026-05-06 (verified via `npm view node-cron version`)
- `server/routes/posts.routes.ts` — existing storage path extraction, admin client usage, cleanup endpoint pattern
- `server/services/storage-cleanup.service.ts` — existing `extractPathFromUrl`, `processStorageCleanup`, batch pattern
- `supabase/migrations/20260310180000_version_limit_and_storage_cleanup.sql` — version_cleanup_log + RLS pattern
- `supabase/migrations/20260421000000_v1_1_schema_foundation.sql` — migration file pattern, trigger pattern, RLS mirror pattern
- `supabase/migrations/20260321000000_posts_expires_at.sql` — existing `expires_at` column and `delete_expired_posts()` function
- `shared/schema.ts` — existing `postSchema`, `postGalleryItemSchema`, `POST_EXPIRATION_DAYS = 30`

### Secondary (MEDIUM confidence)
- supabase.com/docs/guides/cron — pg_cron available on all tiers; jobs stored in `cron.job`; cannot delete Storage objects from SQL
- github.com/orgs/supabase/discussions/37405 — community confirmation pg_cron works on free tier

### Tertiary (LOW confidence)
- Medium articles on node-cron + Express patterns — consistent with official docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — node-cron v4.2.1 confirmed via npm; pg_cron exclusion well-reasoned
- Architecture: HIGH — all patterns derived directly from existing codebase code
- DB migration: HIGH — follows established migration file pattern exactly
- Pitfalls: HIGH — derived from direct code inspection of existing cleanup logic
- pg_cron exclusion: HIGH — storage deletion from SQL is architecturally impossible

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (node-cron is stable; Supabase API patterns are stable)
